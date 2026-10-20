# Handoff: Mercado Preto / MAB marketplace

**Atualizado**: 2026-10-20

**Fluxo de branches deste projeto:** `develop → release → main`. Este projeto
não usa `alpha` nem `beta` (decisão do usuário em 17/10).

## Fila de pendências (por prioridade)

1. **[produção] `docker-compose.prod.yml` fora do modelo do OCI:** falta
   nginx no compose, portas em `127.0.0.1` e `PUBLIC_URL`. Bloqueia a ida a
   produção. **Parado:** a produção vai rodar em outro provedor, ainda não
   escolhido, no domínio `mercadopreto.com.br`. O domínio hoje aponta para a
   loja atual, então a troca do DNS precisa ser planejada.
2. **[produção] Autenticar o domínio `mercadopreto.com.br` no Brevo**
   (DKIM/DMARC no DNS). Sem isso, o Brevo recusa `noreply@mercadopreto.com.br`.
   Depois, voltar o `EMAIL_FROM` do `.env.oci` para esse endereço (hoje é
   `lupontes@gmail.com`, o único remetente verificado).
3. **[produção] Evolution API parada:** não há container. As confirmações de
   pedido por WhatsApp não saem. A `.env.oci` tem `EVOLUTION_API_KEY` e
   `EVOLUTION_API_INSTANCE`, e `EVOLUTION_WEBHOOK_SECRET` está vazio.
   O banco `evolution` não existe mais, e a imagem `2.4.0-rc2` não está
   baixada. Para reativar, é preciso escanear o QR Code com o celular do
   número de envio. **Adiado pelo usuário em 17/10.**
4. **[vitrine] Resumo do pedido sem o desconto em pontos na etapa de entrega:**
   depois de "Usar R$ X", a linha "Desconto em pontos" só aparece na etapa de
   pagamento.
5. **[usuário]**
   - Apagar o admin de teste `admin2@mercadopreto.com.br` no painel master
     (Configurações → Usuários).
   - Apagar no Brevo a chave `marketplace-dev` (tipo MCP, desativada).
   - ClearSale: ainda não contratada. Se for, a URL de teste é
     `https://teste.mercadopreto.com.br/api/webhooks/clearsale`.
6. ~~Concluídos em 17–20/10~~: #69/#70, #72 (falta um upload logado de foto no
   servidor), #74/#75/#77, #79 e a **Task 7 do programa de pontos**
   (20/10: compra A `1353943231` com `earn` 182; compra B `1353946303` com
   `redeem` −182, `loyaltyDiscount` 182, `earn` 180 e `sellerPayout` igual ao
   da compra A). **NSG da OCI** limpo em 20/10 (ficaram ICMP, 22, 80 e 443).
   Infra: o pnpm 11 reinstala o backend (npm) a cada `pnpm`; usar
   `npx vitest` na vitrine (ver claude-mem).

**Do usuário, fora do código:** a validação jurídica e contábil
(`docs/juridico/2026-09-05-memo-titularidade-consignacao.md`). Anexar ao
próximo e-mail para o Ailton. A ativação do Mercado Livre fica pausada até
essa validação (`docs/deploy/2026-09-04-mercado-livre-integration-runbook.md`).

## Servidor de teste (168.138.148.67, instância `ambiente-b` na OCI)

- Roda `develop` (`eefdd7e`). O procedimento de deploy está em
  `docs/DEPLOY_OCI.md`: migrations antes de subir o container, e o backend
  antes da vitrine.
- Backups: banco `~/db-backup-20261018035801.sql.gz` e imagem
  `mercado-preto-api:oci-bak-20261018035801` (antes do #79). O `.env.oci`
  anterior a 20/10 está em `infra/.env.oci.bak-*`.
- **E-mail (funcionando desde 20/10):** Brevo com a chave restrita
  `mercado-preto-teste` (só e-mails transacionais) e o IP do servidor
  autorizado. Em sandbox, **todos** os e-mails vão para
  `TEST_EMAIL_RECIPIENT=adm@fixsistemas.com` (Ailton, responsável pelos
  testes). Remetente: `EMAIL_FROM=lupontes@gmail.com` (ver pendência 2).
- **Sandbox do Mercado Pago:** o pagador não pode ter e-mail
  `@testuser.com` (erro 2034).
- O banco tem dados de teste das lojas Axé e FIX, os pedidos #38 a #43 e os
  dois pedidos do teste de pontos de 20/10 (CPF 12345678909).
