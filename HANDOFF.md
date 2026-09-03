# Handoff: Split de pedido por vendedor (multi-seller cart) — bloqueador de comissão corrigido, falta reteste manual

**Generated**: 2026-08-29 20:10 GMT-3 (atualizado — fix de comissão commitado, cherry-picked e deployado; reteste manual fica pra próxima sessão)
**Branch**: `fix/multi-seller-cart-order-split` (pushed to `origin`, commit `418338b`, up to date — no local uncommitted code changes)
**Status**: Quase pronto — bloqueador de comissão da Task 5 já corrigido e deployado no servidor de teste. **Falta só reproduzir o teste manual (novo pedido multi-vendedor) pra confirmar que a comissão agora é criada**, antes de seguir pra revisão final da branch.

## O que aconteceu nesta sessão (2026-08-29, depois do handoff anterior)

1. Task 5 (verificação manual) executada via browser: split de pedido, item, frete rateado e NF-e sandbox **funcionam corretamente** — mas comissão não era criada. Resultado completo em `docs/qa/2026-08-27-multi-seller-order-split-verification.md`.
2. Causa raiz isolada: `commission-on-payment.ts` escutava `order.payment_captured`, que **não é um evento real do Medusa v2** (nunca emitido em lugar nenhum do código) — bug pré-existente, não introduzido por esta branch, afetando **todos** os pedidos desde sempre, não só o split.
3. Brainstorming (path bounded) → fix de 1 linha: trocar o evento pra `mercadopago.order_approved` (mesmo evento que `order-fiscal-emit.ts` já usa com sucesso).
4. Fix implementado via TDD numa branch separada a partir de `develop` (`fix/commission-mercadopago-order-approved-event`, worktree em `.worktrees/`, commit `d83654b`) — correto por ser bug mais amplo, não exclusivo do split.
5. Mesmo commit cherry-picked pra `fix/multi-seller-cart-order-split` (commit `418338b`) pra desbloquear a Task 5 sem esperar o merge de `develop`. Testes: 42 suítes / 336 testes passando nesta branch.
6. Push + redeploy no servidor de teste. **Incidente no meio do caminho**: o agente `netdata` no servidor estava consumindo 7.2GB de RAM (memory leak, rodando há 1 semana), o que travou o primeiro build do Docker por quase 2h sem erro nem output. Resolvido reiniciando o `netdata` (`sudo systemctl restart netdata`) — memória caiu de 9.2Gi pra 2.2Gi usados. Segundo build (com timeout duro de 900s) completou em poucos minutos. Confirmado por inspeção direta do binário compilado dentro da imagem (`docker run --rm --entrypoint cat infra-medusa:latest /app/src/subscribers/commission-on-payment.js`) que a correção está presente.
7. Container `mercado-preto-api` recriado e no ar: health check 200, site 200.
8. **Combinado com o usuário: NÃO refazer o teste manual completo agora — fica pra próxima sessão.**

## Goal

Implementar o split de um único pagamento (carrinho com produtos de vários vendedores) em N pedidos, um por vendedor, no marketplace Mercado Preto. Plano: `docs/superpowers/plans/2026-08-27-multi-seller-cart-order-split.md`. Spec: `docs/superpowers/specs/2026-08-27-multi-seller-cart-order-split-design.md`.

## Completed

- [x] Tasks 1-4 do plano (utilitário de agrupamento, resolução de vendedor na rota de preferência, `productId` no payload do storefront, webhook cria N pedidos) — todas implementadas, testadas e revisadas via Subagent-Driven Development (spec ✅, quality Approved, 0 Critical/Important em todas).
- [x] Bug de deploy encontrado e corrigido: `createPreference` estava `export`ado de `checkout/page.tsx`, o que o Next.js proíbe em arquivos de página (só aceita `default`, `metadata`, etc.) — quebrava `next build` em produção mas passava nos testes unitários (vitest não roda o build do Next). Extraído para `apps/storefront/src/app/checkout/create-preference.ts`. Commit `87f9627`.
- [x] Deploy da branch completa (Tasks 1-4 + fix) no servidor de teste `teste.mercadopreto.com.br` (OCI, IP `168.138.148.67`). Containers `medusa` e `storefront` rebuildados e reiniciados. Confirmado: `https://teste.mercadopreto.com.br/` e `/checkout` respondem HTTP 200.
- [x] Ledger completo em `.superpowers/sdd/2026-08-27-multi-seller-cart-order-split/progress.md` — fonte da verdade de tudo que foi feito, decidido e revisado.

## Not Yet Done

- [x] **Task 5 — verificação manual ponta a ponta via browser.** Executada em 2026-08-29. Resultado completo em `docs/qa/2026-08-27-multi-seller-order-split-verification.md`.
- [x] **Corrigir geração de comissão.** Fix commitado (`d83654b` na branch `fix/commission-mercadopago-order-approved-event`, a partir de `develop`) e cherry-picked pra esta branch (`418338b`). Deployado no servidor de teste e confirmado presente no binário da imagem. Ver detalhes na seção "O que aconteceu nesta sessão" acima.
- [x] **Reconciliar `fix/multi-seller-cart-order-split` com `fix/checkout-metadata-persistence`.** Durante a Task 5 original, ficou claro que faltava persistência local do snapshot do checkout (bug separado, descoberto e corrigido numa branch irmã, `fix/checkout-metadata-persistence`, a partir do mesmo commit-base). As duas branches divergiam nos mesmos dois arquivos (`preference/route.ts`, `webhooks/mercadopago/route.ts`) de forma ortogonal — uma decidia o quê vai no metadata (`seller_groups`), a outra decidia como esse metadata é lido/escrito (snapshot local antes de depender da API do MP). Reconciliadas via `git merge --no-ff` nesta branch, executado via `superpowers:subagent-driven-development` a partir do plano `docs/superpowers/plans/2026-09-03-checkout-metadata-seller-groups-reconciliation.md` (spec: `docs/superpowers/specs/2026-09-03-checkout-metadata-seller-groups-reconciliation-design.md`). Merge commit `73718a0` (pais `ea0afa2` + `061681a`). Testes pós-merge: backend 43/43 suítes, 349/349 testes; storefront 9/9 arquivos, 40/40 testes — tudo verde. `checkoutSnapshotPayload` agora carrega `seller_groups` (não mais `seller_id` solto); webhook lê o snapshot local primeiro, com fallback pra busca legada de preferência no MP. Branch `fix/checkout-metadata-persistence` já apagada (local e worktree) — totalmente contida no merge, verificado via `git merge-base --is-ancestor`.
- [ ] **PRÓXIMO PASSO: deployar o código combinado no servidor de teste e reproduzir o teste manual multi-vendedor de novo** (mesmo roteiro da Task 5 — carrinho com produtos de 2 vendedores, 1 pagamento sandbox). O servidor de teste ainda está rodando o código pré-reconciliação (commit `87f9627`, sem o módulo `checkout` novo) — precisa rebuild + rodar a migration nova (`checkout_snapshot`) **antes** do container novo começar a servir tráfego (ver nota de ordem de deploy em `docs/superpowers/plans/2026-08-29-checkout-metadata-persistence.md`, seção final). Depois do deploy, confirmar via banco (`select * from commission where "orderId" in (...)`) que as 2 linhas de comissão são criadas. Atualizar `docs/qa/2026-08-27-multi-seller-order-split-verification.md` removendo o bloqueador se confirmado.
- [ ] Depois disso: revisão final ampla do diff da branch inteira (`superpowers:requesting-code-review`, modelo mais capaz disponível), disparada a partir de `.superpowers/sdd/2026-08-27-multi-seller-cart-order-split/progress.md`.
- [ ] A branch `fix/commission-mercadopago-order-approved-event` (worktree em `.worktrees/fix-commission-mercadopago-order-approved-event/`, ainda não pushed pro origin) também precisa seguir seu próprio ciclo: revisão + PR → `develop` (independente desta branch, já que é bug pré-existente mais amplo).
- [ ] Depois da revisão final limpa: `superpowers:finishing-a-development-branch` — decidir integração (PR `fix/...` → `develop` → `alpha` → `beta` → `release` → `main`, GitFlow padrão do usuário).
- [ ] Achados secundários não bloqueadores registrados no doc de QA (não relacionados ao código das Tasks 1-4, podem virar issues separadas): bug de exibição em `/painel/pedidos` (Total/Status/Data em branco, rota pré-existente `seller/orders/route.ts`), botão "Sair" inconsistente na sidebar do painel, página `/loja/[id]` não lista produto recém-publicado.

## Failed Approaches (Don't Repeat These)

- Primeira tentativa de rebuild do storefront no servidor (antes do fix) falhou com `next build`: `Type error: Page "src/app/checkout/page.tsx" does not match the required types of a Next.js Page. "createPreference" is not a valid Page export field.` Containers antigos continuaram rodando (build falhou antes do `up -d`, produção não foi afetada). Corrigido extraindo a função pra `create-preference.ts` — não tentar reexportar de dentro de `page.tsx` de novo.
- `docs/DEPLOY_OCI.md` está desatualizado em dois pontos: (1) a stack real roda via `infra/docker-compose.prod.yml` + `infra/.env`, não `docker-compose.oci.yml` + `.env.oci` como o doc descreve; (2) o storefront roda containerizado (`mercado-preto-storefront`, serviço `storefront` no compose), não via PM2 como processo Node direto. Não seguir o doc literalmente — usar os comandos abaixo.

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Deploy da branch `fix/multi-seller-cart-order-split` direto no servidor de teste, sem merge prévio em `develop` | Task 5 existe justamente pra validar esta branch antes do merge; servidor compartilhado mas isolado (Ambiente B, não produção) |
| Re-dispatch do reviewer da Task 4 (não do implementer) após falha por rate limit | Trabalho do implementer já estava commitado e correto; só a revisão falhou por HTTP 429 da sessão, não por problema de código |

## Current State

**Working**: Localmente, branch em `73718a0` (merge de reconciliação, ver acima) — backend 43/43 suítes/349 testes, storefront 9/9 arquivos/40 testes, tudo verde. O servidor de teste (`teste.mercadopreto.com.br`) **ainda não recebeu esse merge** — continua rodando o commit `87f9627` (pré-persistência-de-snapshot). Health check do servidor OK (`curl http://localhost:9000/health` → `OK [200]`), `/` e `/checkout` respondem 200, mas isso reflete o código antigo, não o combinado.

**Broken**: Nada conhecido no código local. A verificação manual (Task 5) rodou uma vez contra o código pré-reconciliação e encontrou o bug de perda de metadata (motivo da reconciliação) — ainda não foi refeita contra o código combinado, então não há confirmação empírica de que split + persistência de snapshot funcionam juntos no ambiente real (só testes unitários/integração local, que passam).

**Uncommitted Changes**: Nenhuma no código do repo (`git status` limpo pra arquivos versionados). Não-versionados esperados: `.claude/settings.local.json`, `graphify-out/` (locais/gerados, sem ação necessária), este `HANDOFF.md`.

## Files to Know

| File | Why It Matters |
|------|----------------|
| `packages/medusa-backend/apps/backend/src/utils/seller-order-groups.ts` | Utilitário puro: agrupa itens do carrinho por vendedor + rateia frete proporcionalmente (Task 1) |
| `packages/medusa-backend/apps/backend/src/api/store/checkout/preference/route.ts` | Resolve vendedor por `productId` via `query.graph`, grava `metadata.seller_groups` na preferência MP (Task 2) |
| `apps/storefront/src/app/checkout/create-preference.ts` | Função `createPreference` extraída de `page.tsx` (fix pós-deploy); envia `productId` por item (Task 3) |
| `packages/medusa-backend/apps/backend/src/api/store/webhooks/mercadopago/route.ts` | Webhook: cria N pedidos (um por grupo de vendedor), idempotência por `(mercadopago_external_reference, seller_id)`, fallback pra 1 grupo se `seller_groups` ausente (Task 4) |
| `.superpowers/sdd/2026-08-27-multi-seller-cart-order-split/progress.md` | Ledger completo — histórico de decisões, revisões, achados minor parked. Ler antes de continuar. |
| `docs/qa/2026-08-25-multi-seller-order-test.md` | Credenciais de teste dos 2 vendedores + descrição do bug original que motivou a feature |
| `docs/DEPLOY_OCI.md` | Guia de deploy — **desatualizado**, ver "Failed Approaches" acima antes de seguir |

## Code Context

**Fluxo de idempotência do webhook** (`webhooks/mercadopago/route.ts`, essência):
```ts
// meta.seller_groups: SellerGroup[] (gravado na Task 2) ou fallback de 1 grupo (compat)
for (const group of groups) {
  const existing = await orderService.listOrders(
    { metadata: { mercadopago_external_reference: payment.external_reference, seller_id: group.sellerId } },
    { take: 1 }
  )
  if (existing.length === 0) pendingGroups.push(group)
}
if (pendingGroups.length === 0) return res.sendStatus(200) // já processado, idempotente
const createdOrders = await orderService.createOrders(pendingGroups.map(...))
eventBusService.emit(createdOrders.flatMap(o => [order.placed, mercadopago.order_approved])) // só p/ criados agora
```

## Resume Instructions

1. **Retomar a verificação manual via browser** (era o próximo passo quando a sessão parou):
   - Ler `docs/qa/2026-08-25-multi-seller-order-test.md` pra credenciais dos 2 vendedores de teste:
     - LOJA FIX SISTEMAS: `adm@fixsistemas.com` / `FixSistemas@2026`
     - Mulheres de Axé do Brasil: `contato@mercadopreto.com.br` / `teste1234`
     - Admin: `admin@mercadopreto.com.br` / `teste1234` (em `https://teste.mercadopreto.com.br/app`)
   - As tools de browser (`mcp__claude-in-chrome__*`) já estavam carregadas via `ToolSearch` na sessão anterior — recarregar se necessário: `ToolSearch("select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__tabs_close_mcp,mcp__claude-in-chrome__form_input,mcp__claude-in-chrome__find,mcp__claude-in-chrome__get_page_text")`
   - Navegar pra `https://teste.mercadopreto.com.br/`, montar carrinho com 1 produto de cada vendedor (cadastrar produto novo se a LOJA FIX SISTEMAS ainda não tiver nenhum — painel → Produtos → Novo)
   - Completar checkout até o Brick de pagamento, pagar com cartão sandbox `TEST-` (prefixo já confirmado no ambiente)
   - **Expected**: só 1 cobrança solicitada (não 1 por loja)
2. **Verificar os 2 pedidos**: login em `/painel/login` com cada vendedor, checar `/painel/pedidos`
   - Expected: cada vendedor vê só o pedido com os próprios itens, `seller_id` correto
   - Se falhar: checar logs do backend via SSH (`ssh -i ~/.ssh/oci_vms ubuntu@168.138.148.67 "docker logs mercado-preto-api --tail 100"`)
3. **Verificar comissão e NF-e**: painel admin (`/app` → Comissões) — 2 comissões separadas; log do backend ou painel fiscal confirma emissão de NF-e sandbox por pedido, sem erro
4. **Registrar resultado** em `docs/qa/2026-08-27-multi-seller-order-split-verification.md`, liberar ambiente pro Aylton testar
5. Depois disso: revisão final ampla + `superpowers:finishing-a-development-branch` (ver "Not Yet Done")

## Setup Required

- Acesso SSH ao servidor de teste: `ssh -i ~/.ssh/oci_vms ubuntu@168.138.148.67` (chave já presente localmente, confirmado nesta sessão)
- Chrome MCP browser tools conectado (usado pra navegação manual do teste)
- Nenhuma variável de ambiente local necessária — todo o trabalho de deploy já foi feito, resta só interagir com o site já no ar

## Warnings

- **Não fazer merge da branch em `develop` ainda** — GitFlow do usuário exige revisão final da branch inteira antes disso (ver "Not Yet Done").
- **Servidor de teste está no branch `fix/multi-seller-cart-order-split`, não em `develop`** — isso é intencional pra QA (ver Key Decisions), mas se alguém for deployar outra coisa nesse servidor antes do merge, vai pegar código não mergeado. Avisar antes.
- Rebuild no servidor OCI (ARM, 2 OCPU) é lento: build do storefront+medusa levou ~3min na segunda tentativa (primeira tentativa deu timeout de 280s só pela lentidão do build, não por erro — usar timeout de pelo menos 580s em builds futuros).
- `docs/DEPLOY_OCI.md` tem informações desatualizadas (compose file errado, PM2 que não existe mais) — não seguir literalmente, ver "Failed Approaches".
