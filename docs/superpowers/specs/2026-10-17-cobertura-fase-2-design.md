# Cobertura de Testes, Fase 2 — Design

**Status**: Aprovado (17/10/2026). O usuário pediu para
decidir pelas melhores práticas; as decisões abaixo são de quem escreveu o spec.

Branch: `test/cobertura-fase-2` (a partir de `develop`).

## Contexto e motivo

Item 8 do HANDOFF. A fase 1 virou as correções #74 e #75. A fase 2 cobre o
que sobrou e corrige os bugs que a leitura já mostrou:

1. **`GET /admin/reports`:**
   - um `period_end` só com a data (`2026-10-31`) vira 00:00, e o último dia
     inteiro fica de fora do relatório;
   - uma data inválida vira `NaN`, e o relatório sai zerado, sem erro.
2. **`GET /admin/fiscal`:** o `count` é o tamanho da página, o mesmo bug que
   as comissões tinham.
3. **Sitemap:**
   - `GET /store/sitemap` gera `/lojas/:id` e `/produtos/:handle`, mas as
     rotas da vitrine são `/loja/[id]` e `/produto/[handle]`;
   - inclui `/contato`, que não existe;
   - inclui produtos de loja não ativa;
   - ninguém o publica: a rota exige o cabeçalho com a chave pública, e a
     vitrine não tem `sitemap.xml` nem `robots.txt`.
4. **Sem nenhum teste:**
   - `seller/dashboard`;
   - `admin/settings`;
   - `admin/fiscal/[id]`;
   - `admin/search/reindex`;
   - `store/analytics`;
   - os subscribers `order-shipped-whatsapp` e `order-completed-whatsapp`;
   - as páginas da vitrine: carrinho, produto, e no painel as comissões, os
     pedidos e o dashboard.

## Decisões

### Relatórios

- `period_start` e `period_end` aceitam data (`YYYY-MM-DD`) ou data e hora
  ISO.
- Com só a data, o fim vai até **23:59:59.999 daquele dia, em UTC**. As datas
  do banco estão em UTC, e o admin envia ISO.
- Uma data inválida responde 400 `Período inválido`.
- `period_start` depois de `period_end` também responde 400.

### Fiscal

`listAndCountNfDocuments` para a página e o `count` total.

### Sitemap

- **`GET /store/sitemap`:**
  - URLs `/loja/:id` e `/produto/:handle`;
  - as rotas estáticas passam a ser `/`, `/lojas`, `/produtos`, `/categorias`
    e `/sobre`, e `/contato` sai;
  - só entram produtos publicados de lojas `active`.
- **Vitrine:**
  - `app/sitemap.xml/route.ts` busca o sitemap do backend no servidor,
    mandando a chave pública, e devolve o XML com
    `Content-Type: application/xml`;
  - se o backend falhar, responde 503;
  - `app/robots.ts` libera tudo, menos `/painel`, `/checkout` e `/carrinho`,
    e aponta para `<site>/sitemap.xml`. `<site>` vem de
    `NEXT_PUBLIC_SITE_URL`.

### Analytics

- `POST /store/analytics` passa a usar o mesmo IP confiável do limite de
  tentativas do login (`rateLimitKeyGenerator`). Hoje ele confia no primeiro
  `X-Forwarded-For` enviado pelo cliente.
- O corpo é validado: `name` e `url` obrigatórios, strings de até 500
  caracteres. Um corpo inválido responde 400 e não vai para o Plausible.

### Só testes, sem mudança de comportamento

- **`seller/dashboard`:** os números somam só as comissões da vendedora da
  sessão.
- **`admin/settings`:**
  - o GET devolve a taxa;
  - o PATCH valida de 0 a 100 e grava.
- **`admin/fiscal/[id]`:** 404 e 200.
- **`admin/search/reindex`:** sem Meilisearch responde 503 ou o código que a
  rota devolve hoje, e com ele reindexa.
- **Subscribers de WhatsApp:**
  - enviam a mensagem certa para o telefone do endereço;
  - sem telefone, não enviam;
  - pedido inexistente não lança.
- **Páginas da vitrine:**
  - carrinho: soma, alterar quantidade e remover;
  - produto: renderiza, adiciona ao carrinho e responde 404 para o
    inexistente;
  - painel de comissões: mostra os totais da API, que agora contam todas as
    vendas;
  - painel de pedidos: lista e status;
  - painel do dashboard: números.

Se um desses testes revelar um bug, ele é corrigido no mesmo ciclo quando for
pequeno. Se for grande, vira pendência no HANDOFF.

## Não objetivos

- Testes dos scripts de importação (`import-*`, `export-*`). São de uso
  único, e o risco é baixo.
- Mudar o layout das páginas.

## Testes

São os listados acima, um arquivo por rota, subscriber ou página, no estilo
de cada pasta. Na vitrine, rodar com `npx vitest` e `npx tsc`, porque `pnpm`
reinstala o backend.
