# Design: Migração da loja "Mulheres de Axé do Brasil" (MAB) da Nuvemshop para o Mercado Preto

**Data**: 2026-07-02
**Status**: Em revisão
**Contexto de negócio**: Primeira loja do marketplace Mercado Preto. Origem: loja Nuvemshop hospedada em `www.mercadopreto.com.br`, que deixará de existir como loja própria e passará a operar como o vendedor "Mulheres de Axé do Brasil" (MAB) dentro do marketplace multi-vendedor.

## Contexto

A loja de origem já opera comercialmente na Nuvemshop. O objetivo desta migração é **apenas popular o catálogo** (produtos, imagens, descrições, categorias, variantes) do vendedor MAB no Mercado Preto — não é uma ativação comercial completa. Não há repasse de comissão/pagamento configurado para este vendedor nesta fase.

Acesso à API da Nuvemshop já foi configurado e testado:
- App de parceiro privado criado (`App ID 35695`, distribuição "para seus clientes")
- OAuth autorizado na loja real, `access_token` permanente obtido e validado com uma chamada de teste (`GET /products` retornou 200)
- Credenciais salvas em `scripts/nuvemshop-migration/.env` (fora do controle de versão)

## Decisão

Migração via **script `medusa exec`** rodado uma única vez dentro do backend, usando os workflows nativos do Medusa (acesso direto ao container, sem precisar de autenticação HTTP separada).

### Alternativas consideradas e descartadas

| Alternativa | Por que não |
|---|---|
| Feature reutilizável (workflow/admin API para outros sellers no futuro) | Escopo maior do que o necessário agora — só há uma loja de origem conhecida. Pode virar uma feature real depois, se surgir demanda repetida. |
| Script standalone via Admin REST API (fora do backend) | Duplicaria validações e não reaproveitaria os workflows/efeitos colaterais nativos do Medusa (indexação Meilisearch, eventos de domínio). |
| Referenciar URLs de imagem direto do CDN da Nuvemshop | Cria dependência permanente da loja Nuvemshop continuar no ar. Rejeitado — imagens serão baixadas e re-hospedadas. |

## Componentes

### 1. `packages/medusa-backend/apps/backend/src/scripts/import-nuvemshop.ts` (novo)

Script `medusa exec`, executado manualmente:
```bash
pnpm medusa exec ./src/scripts/import-nuvemshop.ts
```

Fluxo:
1. Lê `NUVEMSHOP_ACCESS_TOKEN`, `NUVEMSHOP_STORE_ID` de `scripts/nuvemshop-migration/.env`.
2. **Cria o seller MAB** (não existe ainda no marketplace):
   - Busca `GET /store` na API da Nuvemshop para obter `email`, `phone`, `business_id` (CPF/CNPJ), `business_name`, `address`.
   - `name` do seller é fixado como **"Mulheres de Axé do Brasil"** (não vem da API).
   - Campos bancários/PIX ficam `null` — não há repasse configurado nesta fase; podem ser preenchidos depois manualmente no admin.
   - `ownerName`: **placeholder pendente de preenchimento manual** (a API da Nuvemshop não fornece nome do responsável) — a ser confirmado com o usuário ou completado no admin após a migração.
   - `status = "active"` — **obrigatório**, não opcional: as rotas de storefront (`api/store/sellers/route.ts`, `api/store/search/route.ts`, `api/store/sellers/[id]/products/route.ts`) só listam/exibem sellers e produtos com `status = "active"`. Sem isso, o cliente não-admin não conseguiria visualizar a loja para aprovação.
3. Busca categorias (`GET /categories`) e cria/mapeia hierarquia (parent/child) em `product_category`.
4. Pagina produtos (`GET /products?page=N&per_page=30`) até esgotar.
5. Para cada produto:
   - Baixa cada imagem do CDN da Nuvemshop e faz upload via `FileModuleService` (storage local do Medusa).
   - Sanitiza a `description` (HTML vindo de fonte externa) com `sanitize-html` antes de gravar, prevenindo XSS quando o storefront renderizar.
   - Mapeia `variants`/`attributes` da Nuvemshop para `options`/`variants` do Medusa.
   - Cria o produto via `createProductsWorkflow`, vinculado ao seller via o link `seller-product` já existente.
   - **Status do produto: `published`** — decisão explícita do usuário para permitir que um cliente não-admin revise a loja/identidade visual diretamente na storefront real (`mercadopreto.com.br`), consultando e aprovando antes do lançamento oficial.
6. **Idempotência**: usa o `id` do produto na Nuvemshop como `external_id` em metadata. Reexecuções fazem upsert (skip/update) em vez de duplicar.

### 2. `infra/docker-compose.prod.yml`

Adiciona volume nomeado para persistir `uploads/` do backend entre deploys/recriações de container:
```yaml
services:
  medusa-backend:
    volumes:
      - backend_uploads:/app/uploads   # runner stage roda com WORKDIR /app (Dockerfile:27)

volumes:
  backend_uploads:
```
Sem isso, imagens re-hospedadas localmente seriam perdidas na próxima recriação do container — gap identificado durante o design (hoje só `postgres_data`, `redis_data` e `meilisearch_data` têm volumes).

### 3. Dependência nova

`sanitize-html` (ou equivalente) adicionado ao `package.json` do backend, para sanitização de descrições HTML vindas da Nuvemshop.

## Riscos aceitos (explícitos, decisão do usuário)

- **Checkout real possível durante a fase de aprovação**: como os produtos entram `published` e o seller `active`, um visitante comum tecnicamente consegue tentar comprar antes da aprovação final do cliente e antes de repasses estarem configurados. Usuário optou por aceitar esse risco nesta fase (site ainda não divulgado publicamente) em vez de adicionar travas de checkout.
- **Dados bancários/PIX e `ownerName` ausentes**: seller é criado com esses campos em aberto; precisam ser preenchidos manualmente no admin antes de qualquer repasse real ser habilitado.

## Fora de escopo

- Migração de clientes, pedidos ou histórico de vendas da Nuvemshop.
- Configuração de comissão/repasse para o seller MAB.
- Ambiente de preview/staging separado (decisão explícita: usar a storefront de produção).
- Tornar o importador uma feature reutilizável para futuros sellers.

## Testes

- Idempotência: rodar o script duas vezes sobre a mesma loja e confirmar que não duplica produtos/categorias.
- Sanitização: produto de teste com descrição contendo `<script>` deve ter a tag removida/neutralizada no Medusa.
- Mapeamento de imagens: produto com múltiplas imagens deve preservar a ordem (`position`) e todas devem resolver para URLs servidas pelo próprio backend, não pelo CDN da Nuvemshop.
