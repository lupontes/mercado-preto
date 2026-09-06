# Handoff: Mercado Preto / MAB marketplace

**Atualizado**: 2026-09-06

## Estado atual de `develop`

Todas as pendências conhecidas foram reconciliadas em `develop`:

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

## Pendente

- Validação jurídica/contábil do modelo de consignação — memo já preparado
  (Artifact privado, fora do repo), sem registro de resolução ainda.
- Ativar a integração com o Mercado Livre de verdade (cadastro do app,
  variáveis de ambiente, primeira autorização OAuth) — ver o runbook.
- Lacunas de cobertura de teste identificadas no Raio-X, não atacadas ainda:
  4 subscribers, 4 scripts (um é migração de dados real — `import-mab-catalog.ts`),
  ~22 rotas de API, 14 páginas do storefront sem teste.
