# Handoff: Mercado Preto / MAB marketplace

**Atualizado**: 2026-10-18

**Fluxo de branches deste projeto:** `develop → release → main`. Este projeto
não usa `alpha` nem `beta` (decisão do usuário em 17/10).

## Fila de pendências (por prioridade)

1. **[segurança, usuário] NSG da OCI:** remover as regras das portas 3000,
   7700, 8080 e 9000. Hoje o iptables já bloqueia essas portas.
2. **[produção] `docker-compose.prod.yml` fora do modelo do OCI:** falta
   nginx no compose, portas em `127.0.0.1` e `PUBLIC_URL`. Bloqueia a ida a
   produção. **Parado:** a produção vai rodar em outro provedor, ainda não
   escolhido, no domínio `mercadopreto.com.br`. O domínio hoje aponta para a
   loja atual, então a troca do DNS precisa ser planejada.
3. **[produção] Evolution API parada:** não há container. As confirmações de
   pedido por WhatsApp não saem. A `.env.oci` tem `EVOLUTION_API_KEY` e
   `EVOLUTION_API_INSTANCE`, e `EVOLUTION_WEBHOOK_SECRET` está vazio.
   O banco `evolution` não existe mais, e a imagem `2.4.0-rc2` não está
   baixada. Para reativar, é preciso escanear o QR Code com o celular do
   número de envio. **Adiado pelo usuário em 17/10.**
4. **[usuário]** Apagar o admin de teste `admin2@mercadopreto.com.br` no
   painel master (Configurações → Usuários). ClearSale: ainda não contratada,
   então não há webhook a conferir. Se for contratada, a URL de teste é
   `https://teste.mercadopreto.com.br/api/webhooks/clearsale`.
5. ~~Concluídos em 17–18/10~~: #69/#70 (erros do checkout), #72 (foto do
   produto; falta um upload logado no servidor), #74/#75/#77 (cobertura de
   testes e correções). Pendências menores no "Para depois" de cada PR. Infra:
   o pnpm 11 reinstala o backend (npm) a cada `pnpm`; usar `npx vitest` na
   vitrine (ver claude-mem).
6. **[produto] Programa de pontos — no servidor (#79); falta o ponta a ponta.**
   Spec `docs/superpowers/specs/2026-10-17-programa-de-pontos-design.md` e
   plano `docs/superpowers/plans/2026-10-18-programa-de-pontos.md`. O código do
   resgate vai para o e-mail da **primeira** compra paga do CPF (decisão do
   usuário). **Próximo passo:** a Task 7 do plano. Em 18/10 ela travou porque o
   sandbox do Mercado Pago estava fora do ar para criar pagamentos ("http is
   unavailable for request create_ti", 500, com cartão e com Pix).
   **Roteiro:**
   1. trocar o `TEST_EMAIL_RECIPIENT` do `.env.oci` para `lupontes@gmail.com`
      e recriar o `medusa`;
   2. compra A paga com o cartão sandbox, pela vitrine local + túnel ssh na
      porta **9100** (a 9000 local está ocupada por um Medusa que não é desta
      sessão);
   3. compra B: o usuário repassa o código, verificar e usar os pontos;
   4. conferir no banco o `earn`, o `redeem`, o `loyaltyDiscount` e o
      `sellerPayout` igual;
   5. **voltar o destinatário para `adm@fixsistemas.com`.**
7. ~~Limpeza~~: a branch `fix/rate-limit-ipv6-keygen` foi apagada em 17/10.
    Os 39 `checkout_snapshot` com `status` nulo ficam como estão: não
    afetam pedidos novos.

**Do usuário, fora do código:** a validação jurídica e contábil
(`docs/juridico/2026-09-05-memo-titularidade-consignacao.md`). Anexar ao
próximo e-mail para o Ailton. A ativação do Mercado Livre fica pausada até
essa validação (`docs/deploy/2026-09-04-mercado-livre-integration-runbook.md`).

## Sessão 2026-10-17

- **No servidor de teste** (`develop` em `eefdd7e`): #63, #65 a #67, #69,
  #70, #72 a #75, #77, #79 e #80, com todas as migrations aplicadas (inclusive
  `seller_password_token`). Tudo testado ponta a ponta.
- Como testar cartão e login de vendedora sem digitar segredos no servidor,
  e as lições de build: claude-mem.

## Servidor de teste (168.138.148.67)

- Roda `develop`. O procedimento de deploy está em `docs/DEPLOY_OCI.md`:
  migrations antes de subir o container, e o backend antes da vitrine.
- Backups de 17/10:
  - banco: `~/db-backup-20261017202917.sql.gz` (antes do #74);
  - imagens `mercado-preto-api:oci-bak-<timestamp>`, uma por deploy. A mais
    recente é `oci-bak-20261018035801`, com o banco
    `~/db-backup-20261018035801.sql.gz` (antes do #79).
- A busca precisou de um reindex manual em 17/10. Depois do #75, as
  configurações dos índices são aplicadas sozinhas.
- **E-mail:** desde o #80, o backend recebe `MARKETPLACE_SANDBOX`,
  `TEST_EMAIL_RECIPIENT` (hoje `adm@fixsistemas.com`, só o Ailton lê) e a
  `BREVO_API_KEY`, copiada pelo usuário. Nenhum envio real foi confirmado
  ainda.
- **Sandbox do Mercado Pago:** o pagador não pode ter e-mail
  `@testuser.com` (erro 2034).
- O banco tem dados de teste das lojas Axé e FIX, e os pedidos #38 a #43.
