# Handoff: Mercado Preto / MAB marketplace

**Atualizado**: 2026-10-20

**Fluxo de branches deste projeto:** `develop → release → main`. Este projeto
não usa `alpha` nem `beta` (decisão do usuário em 17/10).

## Fila de pendências (por prioridade)

1. **[teste] Confirmar com o Ailton a entrega do e-mail com o remetente do
   domínio.** Em 20/10 às 12:46, depois da autenticação de
   `mercadopreto.com.br` no Brevo, um código de pontos foi pedido e o backend
   não registrou erro. Mesmo assim, o envio não apareceu em Transacional →
   Logs do Brevo. Se não chegou, investigar por ali.
2. **[teste] Upload de foto logado como vendedora no servidor (#72).**
3. **[produção] `docker-compose.prod.yml` fora do modelo do OCI:** falta
   nginx no compose, portas em `127.0.0.1` e `PUBLIC_URL`. Bloqueia a ida a
   produção. **Parado:** a produção vai rodar em outro provedor, ainda não
   escolhido, no domínio `mercadopreto.com.br`. O domínio hoje aponta para a
   loja atual, então a troca do DNS precisa ser planejada.
4. **[produção] Número de WhatsApp próprio da loja para o Evolution.** No
   teste, o número pareado é o do usuário, e as mensagens aparecem no celular
   dele como enviadas por ele.
5. **[usuário]**
   - Apagar o admin de teste `admin2@mercadopreto.com.br` no painel master
     (Configurações → Usuários).
   - Apagar no Brevo a chave `marketplace-dev` (tipo MCP, desativada).
   - ClearSale: ainda não contratada. Se for, a URL de teste é
     `https://teste.mercadopreto.com.br/api/webhooks/clearsale`.
6. **[vitrine, menor]** Ao voltar do pagamento para a entrega, a
   `preferenceData` antiga fica no estado (ver "Para depois" do #83).
7. ~~Concluídos em 17–20/10~~: #69/#70, #72, #74/#75/#77, #79, a **Task 7 do
   programa de pontos** (compra A `1353943231`; compra B `1353946303` com
   `redeem`, `loyaltyDiscount` e `sellerPayout` conferidos no banco), **#83**
   (teto de pontos na cotação e desconto no resumo), **#84** (erro 500 ao
   editar produto no painel), NSG da OCI limpo, domínio autenticado no Brevo
   e Evolution ativo. Infra: o pnpm 11 reinstala o backend (npm) a cada
   `pnpm`; usar `npx vitest` na vitrine (ver claude-mem).

**Do usuário, fora do código:** a validação jurídica e contábil
(`docs/juridico/2026-09-05-memo-titularidade-consignacao.md`). Anexar ao
próximo e-mail para o Ailton. A ativação do Mercado Livre fica pausada até
essa validação (`docs/deploy/2026-09-04-mercado-livre-integration-runbook.md`).

## Servidor de teste (168.138.148.67, instância `ambiente-b` na OCI)

- Roda `develop` em `c191a15` (#83 e #84), com o deploy de 20/10. O
  procedimento está em `docs/DEPLOY_OCI.md`.
- Backups antes desse deploy: banco `~/db-backup-20261020145929.sql.gz` e
  imagem `mercado-preto-api:oci-bak-20261020145929`.
- **E-mail:** Brevo com a chave restrita `mercado-preto-teste`, o IP do
  servidor autorizado e o domínio autenticado (DNS na Locaweb, mantido pelo
  Ailton). `EMAIL_FROM=noreply@mercadopreto.com.br`. Em sandbox, todos os
  e-mails vão para `TEST_EMAIL_RECIPIENT=adm@fixsistemas.com` (Ailton).
- **WhatsApp:** Evolution 2.4.0 com licença community ativa e instância
  `mercadopreto` pareada com o número de teste do usuário. Em sandbox, tudo
  vai para `TEST_WHATSAPP_RECIPIENT=5598984156828` (Ailton).
- **Sandbox do Mercado Pago:** o pagador não pode ter e-mail
  `@testuser.com` (erro 2034).
- O banco tem dados de teste das lojas Axé e FIX, os pedidos #38 a #43 e os
  dois pedidos do teste de pontos de 20/10 (CPF 12345678909).
