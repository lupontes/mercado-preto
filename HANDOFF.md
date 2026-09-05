# Handoff: Mercado Preto / MAB marketplace

**Atualizado**: 2026-09-05

## Estado atual de `develop`

Todas as pendências conhecidas foram reconciliadas em `develop` nesta sessão:

- Integração com o Mercado Livre completa (módulo `marketplace-channel`, cliente HTTP,
  job de renovação de token, rota de publicação, webhook de pedido, fluxo de
  autorização OAuth com PKCE, endereço/CPF reais do comprador via API do ML) —
  ver `docs/deploy/2026-09-04-mercado-livre-integration-runbook.md` pra ativar.
- `fix/seller-session-cookie` (token do vendedor em cookie HttpOnly) — mergeado.
- `fix/multi-seller-cart-order-split` (split de pedido por vendedor, rateio de
  taxa fixa entre pedidos-irmãos, consolidação de WhatsApp por pagamento) —
  mergeado, reconciliado à mão com a integração do Mercado Livre em
  `commission-on-payment.ts` e `order-placed-whatsapp.ts` (os dois recursos são
  ortogonais: um decide por `mercadopago_external_reference`, o outro por
  `metadata.channel === "mercado_livre"`).
- `fix/commission-mercadopago-order-approved-event` — bug real corrigido (o
  subscriber de comissão escutava um evento que nunca era emitido; comissões
  nunca eram calculadas pro checkout próprio).
- PRs #12, #14 (ClearSale webhook, com correção de uma regressão de segurança
  que seria reintroduzida por um merge ingênuo) — mergeados.

## Pendente

- Validação jurídica/contábil do modelo de conta única/consignação — ver
  memo publicado nesta sessão (fora do repositório, artifact privado).
- Ativar a integração com o Mercado Livre de verdade (cadastro do app,
  variáveis de ambiente, primeira autorização OAuth) — ver o runbook.
- `main` ainda está atrás de `develop` (main nunca recebeu o trabalho mais
  recente) — GitFlow normal resolve isso no próximo ciclo de release.
