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
   produção.
4. **[produção] Evolution API parada:** não há container. As confirmações de
   pedido por WhatsApp não saem. A `.env.oci` tem `EVOLUTION_API_KEY` e
   `EVOLUTION_API_INSTANCE`, e `EVOLUTION_WEBHOOK_SECRET` está vazio.
   O banco `evolution` não existe mais, e a imagem `2.4.0-rc2` não está
   baixada. Para reativar, é preciso escanear o QR Code com o celular do
   número de envio. **Adiado pelo usuário em 17/10.**
5. **[usuário]** Conferir a URL do webhook da ClearSale e apagar o admin de
   teste `admin2@mercadopreto.com.br`.
6. **[UX] Erros do checkout:**
   - o Brick mostra só "Erro ao processar pagamento.", mesmo quando o
     Mercado Pago explica o motivo (por exemplo, o código 2034);
   - depois de um 422 de frete, a seleção é apagada em vez de pré-selecionar
     a opção que sobrou.
7. **[feature] Painel do vendedor sem upload de foto:** só aceita URL externa.
8. **[qualidade] Lacunas de cobertura de testes:** 4 subscribers, 4 scripts,
   cerca de 22 rotas e 14 páginas. Precisa de spec própria.
9. **[produto] Programa de fidelidade:** só existe o spec
   (`docs/superpowers/specs/2026-09-07-loyalty-points-design.md`).
10. **[limpeza]**
    - a branch local `fix/rate-limit-ipv6-keygen` (`f68cf82`) está obsoleta,
      porque `develop` já usa `ipKeyGenerator`. Apagar, com confirmação do
      usuário;
    - 39 `checkout_snapshot` com `status` nulo, anteriores a 17/10, ainda
      guardam o preço enviado pelo cliente. Não afetam pedidos novos.

**Do usuário, fora do código:** a validação jurídica e contábil
(`docs/juridico/2026-09-05-memo-titularidade-consignacao.md`). Anexar ao
próximo e-mail para o Ailton. A ativação do Mercado Livre fica pausada até
essa validação (`docs/deploy/2026-09-04-mercado-livre-integration-runbook.md`).

## Sessão 2026-10-17

- **Mergeados e no servidor de teste** (`develop` em `f263272`):
  - #65: preço do checkout calculado no servidor;
  - #66: correção do build;
  - #67: Econômico com loja local.

  Também ficou no ar o #63 (frete por loja), com as migrations `seller` e
  `checkout` aplicadas.
- **Testado ponta a ponta no sandbox:**
  - preço adulterado responde 409;
  - o Mercado Pago cobra o total do snapshot;
  - um pagamento aprovado gerou 2 pedidos, um por loja (#41 e #42);
  - uma nova cobrança no pedido pago responde 409;
  - frete com os Correios reais para loja local e para loja distante.
- **Lição:** rodar `npx tsc --noEmit -p .` no backend antes do PR. O build
  Docker quebra com erros de tipo que o Jest não pega.

## Servidor de teste (168.138.148.67)

- Roda `develop`. O procedimento de deploy está em `docs/DEPLOY_OCI.md`:
  migrations antes de subir o container, e o backend antes da vitrine.
- Backups de 17/10:
  - banco: `~/db-backup-20261017101227.sql.gz`;
  - imagens: `mercado-preto-api:oci-bak-20261017101227` e
    `mercado-preto-api:oci-bak-20261017111607`.
- **Sandbox do Mercado Pago:** o pagador não pode ter e-mail
  `@testuser.com` (erro 2034).
- O banco tem dados de teste das lojas Axé e FIX, e os pedidos #38 a #42.
