# Handoff: Mercado Preto / MAB marketplace

**Atualizado**: 2026-10-17

**Fluxo de branches deste projeto:** `develop → release → main`. Este projeto
não usa `alpha` nem `beta` (decisão do usuário em 17/10).

## Fila de pendências (por prioridade)

1. ~~Regra `ACCEPT 19999` no iptables~~: removida em 17/10. Ela só existia
   em memória, e o backup está em `~/iptables.bak.*`.
2. **[segurança, usuário] NSG da OCI:** remover as regras das portas 3000,
   7700, 8080 e 9000. Hoje o iptables já bloqueia essas portas.
3. **[produção] `docker-compose.prod.yml` fora do modelo do OCI:** falta
   nginx no compose, portas em `127.0.0.1` e `PUBLIC_URL`. Bloqueia a ida a
   produção. **Parado:** a produção vai rodar em outro provedor, ainda não
   escolhido, no domínio `mercadopreto.com.br`. O domínio hoje aponta para a
   loja atual, então a troca do DNS precisa ser planejada.
4. **[produção] Evolution API parada:** não há container. As confirmações de
   pedido por WhatsApp não saem. A `.env.oci` tem `EVOLUTION_API_KEY` e
   `EVOLUTION_API_INSTANCE`, e `EVOLUTION_WEBHOOK_SECRET` está vazio.
   O banco `evolution` não existe mais, e a imagem `2.4.0-rc2` não está
   baixada. Para reativar, é preciso escanear o QR Code com o celular do
   número de envio. **Adiado pelo usuário em 17/10.**
5. **[usuário]** Conferir a URL do webhook da ClearSale e apagar o admin de
   teste `admin2@mercadopreto.com.br`.
6. ~~Erros do checkout~~: feito no #69 e no #70, que corrigiu as
   pendências deixadas pelo #69 (log do pagador no console, erro cru do
   Brick, `JSON.stringify` que podia lançar, chaves do protótipo). Os dois
   estão testados no servidor. O formulário do cartão continua voltando em
   branco depois de uma recusa (decisão: força um token novo).
7. ~~Upload de foto do produto~~: feito no #72. Testado localmente de ponta
   a ponta; no servidor, só o 401 sem login. **Falta:** um upload com
   vendedora logada no servidor de teste (o usuário faz o login). Ficaram
   para depois:
   - multipart malformado responde 500 genérico;
   - incluir `nosniff` em `/static` no nginx;
   - rótulo "Foto principal" sem associação ao campo e sem botão de remover;
   - limpeza das fotos órfãs no volume de uploads.
8. **[qualidade] Cobertura de testes (em andamento).** A fase 1 virou
   correções, todas no servidor: #74 (senha da vendedora por link com token,
   admin sem `passwordHash`) e #75 (busca resiliente e sem injeção, índices
   em dia, páginas públicas só de lojas ativas, totais de comissão).
   **Próximo:** fase 2, com o dashboard do vendedor, os subscribers de
   WhatsApp, as rotas do admin (`reports`, `fiscal`, `settings`) e as páginas
   da vitrine (carrinho, produto, painel). Ficaram para depois:
   - sitemap com `/lojas/:id` e `/produtos/:handle`; as rotas certas são
     `/loja/[id]` e `/produto/[handle]` (SEO);
   - produtos de loja não ativa seguem publicados na busca e no sitemap;
   - editar a loja não reindexa os produtos dela;
   - senha: emissão do token sem transação, link "pedir novo" em qualquer
     erro, nome sem escape no HTML do e-mail;
   - **infra:** o pnpm 11 reinstala o backend (npm) a cada `pnpm` no
     workspace. Contorno: `npx vitest` na vitrine (ver claude-mem).
9. **[produto] Programa de fidelidade:** só existe o spec
   (`docs/superpowers/specs/2026-09-07-loyalty-points-design.md`).
10. ~~Limpeza~~: a branch `fix/rate-limit-ipv6-keygen` foi apagada em 17/10.
    Os 39 `checkout_snapshot` com `status` nulo ficam como estão: não
    afetam pedidos novos.

**Do usuário, fora do código:** a validação jurídica e contábil
(`docs/juridico/2026-09-05-memo-titularidade-consignacao.md`). Anexar ao
próximo e-mail para o Ailton. A ativação do Mercado Livre fica pausada até
essa validação (`docs/deploy/2026-09-04-mercado-livre-integration-runbook.md`).

## Sessão 2026-10-17

- **No servidor de teste** (`develop` em `ce7333c`): #63, #65 a #67, #69,
  #70 e #72 a #75, com todas as migrations aplicadas (inclusive
  `seller_password_token`). Tudo testado ponta a ponta.
- Como testar cartão e login de vendedora sem digitar segredos no servidor,
  e as lições de build: claude-mem.

## Servidor de teste (168.138.148.67)

- Roda `develop`. O procedimento de deploy está em `docs/DEPLOY_OCI.md`:
  migrations antes de subir o container, e o backend antes da vitrine.
- Backups de 17/10:
  - banco: `~/db-backup-20261017202917.sql.gz` (antes do #74);
  - imagens `mercado-preto-api:oci-bak-<timestamp>`, uma por deploy. A mais
    recente é `oci-bak-20261017211103` (antes do #75).
- A busca precisou de um reindex manual em 17/10. Depois do #75, as
  configurações dos índices são aplicadas sozinhas.
- **Sandbox do Mercado Pago:** o pagador não pode ter e-mail
  `@testuser.com` (erro 2034).
- O banco tem dados de teste das lojas Axé e FIX, e os pedidos #38 a #43.
