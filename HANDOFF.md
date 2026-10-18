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
6. ~~Erros do checkout~~: #69 e #70, testados no servidor.
7. ~~Upload de foto do produto~~: #72. **Falta:** um upload com vendedora
   logada no servidor de teste (o usuário faz o login). Para depois:
   500 em multipart malformado, `nosniff` em `/static`, rótulo e botão de
   remover a foto, limpeza das fotos órfãs.
8. ~~Cobertura de testes~~: fase 1 = #74 e #75; fase 2 = #77 (relatórios,
   fiscal, sitemap/robots publicados, analytics, DDD 55 no WhatsApp, erros no
   painel, testes de rotas, subscribers e páginas). Tudo no servidor. Ficou
   sem teste só o que é de uso único (`scripts/import-*`, `export-*`).
   **Pendências menores** (ver o "Para depois" de cada PR):
   - sitemap: produtos de loja não ativa já saem, mas editar a loja não
     reindexa os produtos dela na busca;
   - `create-payout-modal` manda `periodEnd` como `T00:00Z`
     (provável bug do último dia em `payouts/preview`);
   - `robots.txt` fixa `NEXT_PUBLIC_SITE_URL` no build, que o
     `docker-compose.prod.yml` não passa (ver item 3);
   - senha: emissão do token sem transação, link "pedir novo" em qualquer
     erro, nome sem escape no HTML do e-mail;
   - **infra:** o pnpm 11 reinstala o backend (npm) a cada `pnpm` no
     workspace. Contorno: `npx vitest` na vitrine (ver claude-mem).
9. **[produto] Programa de pontos — EM ANDAMENTO, próximo passo.**
   Spec novo em rascunho, aguardando aprovação do usuário:
   `docs/superpowers/specs/2026-10-17-programa-de-pontos-design.md`, na
   branch `feature/programa-de-pontos` (já no remoto). Ele substitui o de
   07/09, que tinha resgate só por CPF (qualquer um gastaria os pontos de
   outro) e débito antes do pagamento.
   - **Decisões do usuário:** o desconto é pago pela plataforma; 1 ponto por
     R$ 1 em produtos; cada ponto vale R$ 0,01; resgate confirmado por código
     no e-mail (este último ficou "sem preferência", então vale o
     recomendado).
   - **Retomar:**
     1. pegar o "aprovo" do usuário no spec;
     2. escrever o plano com `superpowers:writing-plans`, em umas 7 tasks:
        módulo, código, checkout, webhook, comissão e relatório, vitrine,
        ponta a ponta;
     3. executar no mesmo modo dos ciclos anteriores.
10. ~~Limpeza~~: a branch `fix/rate-limit-ipv6-keygen` foi apagada em 17/10.
    Os 39 `checkout_snapshot` com `status` nulo ficam como estão: não
    afetam pedidos novos.

**Do usuário, fora do código:** a validação jurídica e contábil
(`docs/juridico/2026-09-05-memo-titularidade-consignacao.md`). Anexar ao
próximo e-mail para o Ailton. A ativação do Mercado Livre fica pausada até
essa validação (`docs/deploy/2026-09-04-mercado-livre-integration-runbook.md`).

## Sessão 2026-10-17

- **No servidor de teste** (`develop` em `5f5966e`): #63, #65 a #67, #69,
  #70, #72 a #75 e #77, com todas as migrations aplicadas (inclusive
  `seller_password_token`). Tudo testado ponta a ponta.
- Como testar cartão e login de vendedora sem digitar segredos no servidor,
  e as lições de build: claude-mem.

## Servidor de teste (168.138.148.67)

- Roda `develop`. O procedimento de deploy está em `docs/DEPLOY_OCI.md`:
  migrations antes de subir o container, e o backend antes da vitrine.
- Backups de 17/10:
  - banco: `~/db-backup-20261017202917.sql.gz` (antes do #74);
  - imagens `mercado-preto-api:oci-bak-<timestamp>`, uma por deploy. A mais
    recente é `oci-bak-20261017215938` (antes do #77).
- A busca precisou de um reindex manual em 17/10. Depois do #75, as
  configurações dos índices são aplicadas sozinhas.
- **Sandbox do Mercado Pago:** o pagador não pode ter e-mail
  `@testuser.com` (erro 2034).
- O banco tem dados de teste das lojas Axé e FIX, e os pedidos #38 a #43.
