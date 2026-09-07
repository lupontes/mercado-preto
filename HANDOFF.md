# Handoff: Mercado Preto / MAB marketplace

**Atualizado**: 2026-09-07

## Estado atual de `develop`

Todas as pendências conhecidas foram reconciliadas em `develop`:

- **Sistema de avaliação de produtos** (módulo `review`, 10 tasks via SDD +
  1 leva de fix da revisão final): comprador recebe e-mail (Brevo) com link
  assinado (JWT, 30 dias) quando o pedido é concluído, avalia cada produto
  do pedido em `/avaliar/{token}` sem precisar de conta, avaliação fica
  `pending` até o vendedor aprovar na aba nova "Avaliações" do painel, só
  então aparece na página do produto (nota média + comentários, nome
  truncado por privacidade). Achado crítico da revisão final e já corrigido
  antes do merge: `POST /store/reviews` não conferia se o `productId`
  pertencia ao pedido do token — um comprador podia avaliar produto de
  vendedor diferente do seu; corrigido com um helper compartilhado
  (`utils/order-review-helpers.ts`) usado também pela rota de convite.
  Achado à parte, fora do escopo: 170 erros de `tsc` pré-existentes no
  backend (`admin/routes/*`, incompatibilidade React 19 com o UI kit do
  Medusa admin) — confirmados anteriores a esta branch, não é regressão.
- Botão "Falar com o vendedor" (WhatsApp) na página do produto — reaproveita
  o campo `phone` já existente no cadastro do vendedor, sem migração nova.
- **Bug crítico corrigido: painel do vendedor estava com login quebrado desde
  4/9.** O merge de `fix/seller-session-cookie` só executou as Tasks 1-5 do
  plano (`docs/superpowers/plans/2026-08-25-seller-session-cookie.md`) —
  Tasks 6-9 (drop de `token` em `seller-store.ts` e nas 6 páginas do painel)
  nunca foram feitas. Resultado: `isAuthenticated()` nunca era `true` após
  login (o backend não retorna mais `token`, só cookie HttpOnly), então o
  painel bounceava pra tela de login (ou ficava em loading infinito nas
  páginas com `if (!token) return`). Completadas as 4 tasks que faltavam,
  seguindo o plano já escrito à risca (TDD). Revisão feita em todo o
  storefront confirmando que não sobrou nenhuma referência a
  `token`/`isAuthenticated`/`persist` ligada à sessão do vendedor.
- Integração com o Mercado Livre completa (módulo `marketplace-channel`, cliente HTTP,
  job de renovação de token, rota de publicação, webhook de pedido, fluxo de
  autorização OAuth com PKCE, endereço/CPF reais do comprador via API do ML) —
  ver `docs/deploy/2026-09-04-mercado-livre-integration-runbook.md` pra ativar.
  **Sem sandbox no ML** — teste com "usuários de teste" (até 10 por conta real),
  mesmos endpoints de produção (ver claude-mem, achado 2026-09-06).
- `fix/seller-session-cookie` e `fix/multi-seller-cart-order-split` (ponta real
  `348cecc`, não o snapshot antigo que foi pra `main` via PR #39) — mergeados e
  reconciliados à mão em `commission-on-payment.ts`/`order-placed-whatsapp.ts`.
- `fix/commission-mercadopago-order-approved-event` (PR #40) — bug real
  corrigido (comissão nunca era calculada pro checkout próprio).
- PRs #12/#14 (ClearSale webhook) — mergeados, com correção de uma regressão
  de segurança que um merge ingênuo teria reintroduzido.
- `main` e `develop` reconciliados (só 2 commits-bolha de merge do GitHub
  separam, sem conteúdo pendente).
- Erro de `tsc` pré-existente corrigido (`nuvemshop-import`); duplicação de
  verificação de JWT do vendedor unificada em `utils/seller-jwt.ts`.
- Raio-X de completude do projeto publicado (Artifact) — cobre cobertura de
  teste por módulo/rota/página, pendências documentadas, prontidão de deploy.

## Deploy de teste — 2026-09-07

Sistema de avaliação de produtos e botão "Falar com o vendedor" (WhatsApp)
publicados no servidor de teste OCI (`168.138.148.67`). Backend com as
migrações novas aplicadas (`channel_credential`, `channel_listing`,
`review`), storefront reconstruído e servindo via PM2. Ambos respondendo
200 no health check.

**Bug de infra root-caused e corrigido nesta sessão**: `DATABASE_URL` sem
`?sslmode=disable` fazia o driver `pg` travar indefinidamente (retry mudo
a cada 60s) negociando TLS com um Postgres sem SSL — travava
`medusa db:migrate` por horas sem nenhum erro logado. Corrigido em
`infra/docker-compose.oci.yml`; documentado em `docs/DEPLOY_OCI.md`.

**Achados à parte, não corrigidos ainda:**
- `express-rate-limit` loga um `ValidationError` (`ERR_ERL_KEY_GEN_IPV6`)
  na subida do backend — keyGenerator customizado em `api/middlewares.ts:46`
  não usa o helper `ipKeyGenerator` pra IPv6. Não impede o servidor de
  subir, mas vale corrigir.
- PM2 do storefront loga `"next start" does not work with "output: standalone"`
  e alguns ciclos de `[ELIFECYCLE] Command failed` no histórico — parece
  pré-existente (config do `next.config` usa `output: standalone` mas o
  `pm2` chama `next start` em vez de `node .next/standalone/server.js`).
  Instância atual está estável (sem restart desde o deploy de hoje), mas é
  provável causa de instabilidades esporádicas já vistas antes.
- Manual do sistema atualizado (`docs/manual/manual-mercado-preto.html`,
  também publicado como Artifact) com as duas funcionalidades novas,
  seguindo o padrão de destaque "novidade" (badge no índice + moldura na
  seção) — **convenção a reaplicar em toda atualização futura de manual**.

## Pendente

- **Programa de fidelidade (pontos) — só desenho registrado, sem
  implementação.** Spec em `docs/superpowers/specs/2026-09-07-loyalty-points-design.md`:
  programa único da plataforma, saldo identificado por CPF/CNPJ (já
  coletado no checkout, sem exigir conta), ganho automático em
  `order.completed`, resgate como desconto direto na rota de checkout
  (sem usar o módulo Promotions do Medusa). Retomar via
  `superpowers:writing-plans` quando priorizado.
- Validação jurídica/contábil do modelo de venda — memo em
  `docs/juridico/2026-09-05-memo-titularidade-consignacao.md` (também
  publicado como Artifact). **Hipótese revisada em 2026-09-06**: de
  consignação para compra-e-revenda formal via nota fiscal de entrada, pra
  satisfazer a exigência de "titularidade e direito de vender" do Mercado
  Livre e do TikTok Shop — insolvência do Mercado Preto descartada como
  risco pelo próprio operador do negócio. Sem confirmação de contador/
  advogado ainda (ver §7 do memo pras perguntas pendentes).
- **Lembrete permanente**: no próximo e-mail disparado para o Ailton,
  anexar `docs/juridico/2026-09-05-memo-titularidade-consignacao.md` (ou o
  link do Artifact acima).
- **Ativação do Mercado Livre pausada deliberadamente em 2026-09-06** —
  usuário decidiu não cadastrar a empresa Mercado Preto (CNPJ) como app/
  vendedor real no ML antes da validação jurídica acima ser resolvida.
  Nada foi cadastrado no painel do ML. Retomar pelo runbook
  (`docs/deploy/2026-09-04-mercado-livre-integration-runbook.md`) depois
  que a validação sair. Ambiente de dev (backend local + túnel) também não
  chegou a subir nesta sessão.
- Lacunas de cobertura de teste identificadas no Raio-X, não atacadas ainda:
  4 subscribers, 4 scripts (um é migração de dados real — `import-mab-catalog.ts`),
  ~22 rotas de API, 14 páginas do storefront sem teste.
- **170 erros de `tsc` pré-existentes no backend** (`packages/medusa-backend/apps/backend`),
  todos em `src/admin/routes/{sellers,payouts,commissions}/*` — incompatibilidade
  de tipos JSX entre React 19 e o UI kit do Medusa admin (`error TS2786`).
  Confirmados anteriores à branch do sistema de avaliação (verificado num
  worktree descartável no commit-base) — não é regressão de nenhum trabalho
  recente, mas nunca foi corrigido. Não afeta o funcionamento em runtime, só
  o typecheck.
