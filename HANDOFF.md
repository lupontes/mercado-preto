# Handoff: Mercado Preto / MAB marketplace

**Updated**: 2026-08-25
**Branch**: `develop` é atual — PRs #34 (Focus NFe), #36 (NCM por categoria), #37 (CPF/CNPJ no checkout) todas mergeadas.

## EM ANDAMENTO AGORA: fix do token do vendedor em localStorage → cookie HttpOnly

Branch **`fix/seller-session-cookie`** (a partir de `develop`, já com push feito). Corrige o achado do pentest de 29/jul (token do vendedor em `localStorage`, risco de takeover via XSS) — ver `docs/superpowers/specs/2026-08-25-seller-session-cookie-design.md` (spec) e `docs/superpowers/plans/2026-08-25-seller-session-cookie.md` (plano, 9 tasks, executado via subagent-driven-development). Ambos os docs já estão commitados nessa branch (cherry-pick da branch `docs/seller-session-cookie-design`, que fica só de referência, não mexer nela).

**Progresso**: Task 1 (`utils/cookies.ts`) e Task 2 (login seta `Set-Cookie` em vez de devolver token no corpo) — completas, revisadas, commits `17564c9` e `b30c4bb`. Faltam Tasks 3-9: rota de logout, middleware `sellerAuth` lendo cookie em vez de header, `seller-api.ts`/`seller-store.ts` sem token, `painel/layout.tsx` validando sessão via `/seller/me`, `painel/login/page.tsx`, e as 7 páginas restantes do painel do vendedor.

**Para retomar em outra máquina**: `git fetch && git checkout fix/seller-session-cookie`, reinvocar a skill `superpowers:subagent-driven-development` apontando pro plano acima. O ledger local (`.superpowers/sdd/`) é gitignored e não existe num checkout novo — mas o `git log` da branch mostra exatamente quais tasks já têm commit (mensagens seguem o padrão sugerido em cada task do plano), então a skill consegue reconstruir o progresso a partir daí. **Nota**: `claude-mem` `observation_add` continua quebrado (erro 400, `content` chega como `undefined` no servidor) — não dá pra confiar em memória de longo prazo pra isso, só neste arquivo + git.

## Marco da sessão anterior: fluxo completo de compra provado ponta a ponta (fase de teste)

O "botão Pagar travado" documentado há semanas **não era bug de UI**. Causa raiz real: `MERCADOPAGO_WEBHOOK_SECRET` no `.env` do servidor tinha um caractere errado (`f` em vez de `1`), então a verificação de assinatura do webhook sempre falhava com 401 ("v1 mismatch") — confirmado via `notifications_history` (MCP MercadoPago): 0% de sucesso desde pelo menos 16/08. O Checkout Bricks em si sempre funcionou.

**Correção**: valor certo do secret obtido no painel MercadoPago (ícone de olho + zoom pra conferir caractere a caractere), corrigido em `~/marketplace/infra/.env` no servidor, container medusa recriado. Nenhuma mudança de código — foi puramente config.

**Prova definitiva**: pagamento de teste real via Bricks → assinatura HMAC calculada manualmente com o secret novo → POST pro webhook → `200 OK` → pedido novo criado (`order_01M0XGSZHMWJ65ZS9F7VFE4BZW`) com `mercadopago_payment_id`/`external_reference` batendo com a tela de sucesso → NF-e emitida automaticamente (`status: issued`, `ncmFallbackUsed: false`, `amountCents: 19725`). Fluxo completo sem intervenção manual: pagamento → webhook → pedido → nota fiscal.

Com isso, dos "5 bloqueadores críticos" listados no levantamento de 25/08, os dois que ainda cabiam no escopo de "teste completo, não produção" (botão Pagar travado, estoque artificial) estão **resolvidos**. Os outros três (token de produção MercadoPago, sair do sandbox, domínio de produção) foram explicitamente de-escopados pelo usuário nesta sessão — não são meta agora.

## Pendências para a próxima sessão

1. **Questão fiscal com a contadora** (não é código, é decisão de negócio): (a) CNPJ da MAB é MEI — confirmar se volume atual/projetado é compatível com teto do MEI; (b) verificar se algum vendedor tem Carteira do Artesão (isenção ICMS) — se sim, `icms_situacao_tributaria: "102"` fixo em `helpers.ts` pode estar errado.
2. **Revisar com a contadora os 4 NCMs de confiança baixa/média** já semeados (ficaram "corretos" sem aviso): `KITS PARA COZINHA`/`PETISQUEIRAS` (assume cerâmica), `CANECAS/COPOS/GARRAFAS` (assume cerâmica não vidro), `CHAPÉUS` (assume construção entrançada). Tabela completa: `docs/superpowers/specs/2026-08-25-fiscal-ncm-classification-design.md`.
3. **Rodar o teste multi-loja do Ailton** (`docs/qa/2026-08-25-multi-seller-order-test.md`) — loja de teste já criada, teste em si ainda não executado. Risco: carrinho não distingue vendedores, checkout/emissão fiscal assumem um vendedor só por pedido.
4. **Configurar e-mail de cópia pra contadora** (Lorena, `lorenapassoscontadora@gmail.com`) no painel Focus NFe (Configurações → Envio de notas fiscais emitidas) — ação manual no painel deles, não dá via API.
5. **Levantamento completo de prontidão pro lançamento** (25/08, artefato publicado) — achados fora do escopo desta sessão: ClearSale só recebe webhook, nenhum código envia pedidos pra análise antifraude de verdade; pentest de 29/jul (`docs/pentest-seguranca-2026-07-29`, nunca mergeada) tem achado sério não corrigido — token de sessão do vendedor em `localStorage` em vez de cookie `HttpOnly`; domínio de produção real ainda não configurado em lugar nenhum (registrado, mas não em uso).
6. WhatsApp/Evolution API está vazio (4 variáveis em branco) apesar de `docs/stack/STACK.md` dizer "✅ funcionando" — doc desatualizada, nenhuma notificação de WhatsApp sai hoje (código trata isso com segurança). Credenciais de teste do admin (`admin@mercadopreto.com.br`, `contato@mercadopreto.com.br`, senha `teste1234`) precisam trocar antes de produção real.

## O que já está pronto e testado

- **Focus NFe (NF-e)**: emissão ponta a ponta em homologação, verificado com pedido real.
- **NCM por categoria**: resolvido automaticamente, fallback nunca bloqueia venda, só marca `ncmFallbackUsed` pra revisão.
- **CPF/CNPJ no checkout**: campo validado por dígito verificador nos dois lados.
- **MercadoPago Bricks + webhook + NF-e automática**: comprovado ponta a ponta nesta sessão (ver seção acima).
- **Estoque artificial**: 261/262 variantes com `inventory_level` (qty=100) em `sloc_01KWTPBXT8RPRZ4PDJWG4Q041G`. Só `variant_01KX7DC99WFYB7B4G0EE9NCRT6` ("Brinco Africano, redondo") ficou sem — zero `inventory_item`, anomalia não investigada.

**Recipe útil pra debug/teste real**: `ssh -i ~/.ssh/oci_vms ubuntu@168.138.148.67`, credenciais reais em `~/marketplace/infra/.env` (local é só template em branco). Deploy: `git pull`, depois `cd infra && nohup docker compose -f docker-compose.prod.yml build medusa storefront > /tmp/build.log 2>&1 & disown` (precisa `nohup`+`disown` ou o build morre com a sessão SSH), esperar, depois `docker compose -f docker-compose.prod.yml up -d --force-recreate medusa storefront`. Health check leva ~15-18s (502 passageiro é normal).

**claude-in-chrome**: dirige o Chrome real do usuário numa máquina separada, não um sandbox — `localhost` é inalcançável por ele, só domínios públicos (ex: `teste.mercadopreto.com.br`). Campos de cartão em iframe (Bricks) precisam de `wait` de ~1s entre `left_click` e `type` ou o valor não entra.

**claude-mem cloud sync**: `configured: false`, não regularizado nesta sessão (tangente não seguida adiante).

**Karpathy coding guidelines**: ainda pendente de confirmação final do usuário (main vs. branch/PR).
