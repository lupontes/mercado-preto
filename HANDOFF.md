# Handoff: Mercado Preto / MAB marketplace

**Atualizado**: 2026-10-17

## Próximo passo

1. **Falha de preço no checkout (segurança, bloqueia produção)** — em
   brainstorming na branch `fix/checkout-server-side-pricing` (a partir de
   `develop`). O backend confia no preço vindo do navegador:
   - `api/store/checkout/preference/route.ts`: o preço dos itens vem do
     cliente. O frete já é recalculado no servidor (#63);
   - `api/store/checkout/payment/route.ts`: `transaction_amount` vem do
     cliente e não é conferido com o snapshot;
   - `api/webhooks/mercadopago/route.ts`: não compara o valor pago com o
     total esperado.
2. **Deploy do #63 no servidor de teste ainda não feito.** Antes: rodar a
   migration do módulo seller, configurar `MELHOR_ENVIO_TOKEN`, manter
   `MARKETPLACE_SANDBOX` coerente com o ambiente.
3. **Branch local `fix/rate-limit-ipv6-keygen`** (`f68cf82`, 14/09, não está
   no remoto): verificar se ficou obsoleta após o #56.

## Sessão 2026-10-16/17

- Mergeados: #62 (campos privados do vendedor em `develop`), #63
  (`feature/shipping-per-seller`, 11 achados da revisão final corrigidos),
  #64 (tipagem jest-dom do admin). Worktree `../marketplace-shipping` removido.

## Sessão 2026-10-15/16

- **Borda do OCI (#59, mergeado e em produção no servidor de teste):** o
  nginx é gerenciado pelo `docker-compose.oci.yml` e só as portas 22, 80 e
  443 ficam públicas. Validado com smoke externo, com o medusa recriado com
  outro IP (o nginx não reiniciou) e com teste ponta a ponta: vendedor,
  `/app`, upload de 5 MB e checkout no sandbox com webhook (pedido #40).
- **Mergeados:**
  - #52 (PM2 standalone);
  - #53 (overrides do pnpm no `pnpm-workspace.yaml`);
  - #55 (`test:admin` com vitest 3.2.7);
  - #56 (rate limit do login por IP do socket);
  - #57 (volume de uploads);
  - #58 (`next/image` com o host do site).
- **Regressão do #55:** ele não atualizou
  `packages/medusa-backend/package-lock.json`, e o build Docker do backend
  quebrou (`npm ci`). A correção está em `fix/backend-npm-lockfile-vitest`.
  **O backend usa npm, não pnpm:** mudar dependência dele exige
  `npm install` em `packages/medusa-backend`.
- **Limpeza:**
  - removidos 3 worktrees mergeados;
  - removidas as branches locais e remotas já mergeadas;
  - restam no remoto: `develop`, `main` e `feature/shipping-per-seller`.

## Servidor de teste (168.138.148.67)

- Deve rodar `develop`. **Sempre rebuildar o backend a partir da branch que
  está no servidor:** em 16/10 a imagem `mercado-preto-api:oci` tinha sido
  gerada a partir de `shipping-per-seller` e quebrou o frete da vitrine
  (`/store/shipping/estimate` 404). A imagem antiga ficou como
  `mercado-preto-api:oci-shipping-per-seller-bak`.
- O banco já tem a migration de endereço do vendedor
  (`Migration20261015120000`, colunas que aceitam vazio). Também tem dados
  temporários do teste do frete por loja (lojas Axé e FIX, 6 produtos com
  `package_review`). Ver `progress.md` do worktree.
- Backups do deploy da borda, timestamp `20261016162327`: `.env.oci`,
  `.env.local` e `~/iptables.bak.*`.
- **Ações do usuário pendentes:**
  - remover na NSG da OCI as regras de 3000, 7700, 8080 e 9000;
  - conferir a URL do webhook da ClearSale;
  - apagar o admin de teste `admin2@mercadopreto.com.br`.

## Achados abertos (fora de escopo)

- **Painel do vendedor sem upload de foto:** só aceita URL de imagem
  externa. Feature a planejar.
- **Evolution API parada:** as notificações por WhatsApp não saem.
- **Regra `ACCEPT 19999` no iptables** sem nada escutando.
- **`docker-compose.prod.yml`** ainda não segue o modelo do OCI (nginx no
  compose, portas em `127.0.0.1`, `PUBLIC_URL`).

## Pendente (produto)

- **Programa de fidelidade:** só o spec
  (`docs/superpowers/specs/2026-09-07-loyalty-points-design.md`).
- **Validação jurídica/contábil do modelo de venda:**
  `docs/juridico/2026-09-05-memo-titularidade-consignacao.md`. **Lembrete:**
  anexar ao próximo e-mail para o Ailton.
- **Ativação do Mercado Livre:** pausada até a validação jurídica; ver o
  runbook `docs/deploy/2026-09-04-mercado-livre-integration-runbook.md`.
- **Lacunas de cobertura de teste (item 5):** 4 subscribers, 4 scripts,
  cerca de 22 rotas e 14 páginas. Precisa de spec própria.
