# Verificação manual — Split de pedido por vendedor (Task 5)

> Executado em `teste.mercadopreto.com.br` na branch `fix/multi-seller-cart-order-split` (commit `87f9627`), seguindo o plano `docs/superpowers/plans/2026-08-27-multi-seller-cart-order-split.md`, Task 5.

## Setup do teste

- **Vendedor 1:** LOJA FIX SISTEMAS (`adm@fixsistemas.com`), seller_id `01M0WG0SPGCDNVJ003VXA6N6ZE` — sem produtos cadastrados antes do teste; criado o produto "Produto Teste QA - Split Vendedor" (R$ 10,00) para o teste.
- **Vendedor 2:** Mulheres de Axé do Brasil (`contato@mercadopreto.com.br`), seller_id `01KX7D9SVAQDGBH726MFKQT2K2` — usado produto já existente "Bolsa Africana 2 em 1" (R$ 182,00).
- **Carrinho:** 1 produto de cada vendedor, subtotal R$ 192,00.
- **Frete:** Jadlog — .Package, R$ 29,15. Total cobrado: **R$ 221,15**.
- **Pagamento:** cartão de teste Visa sandbox (`4235 6477 2802 5682`), titular `APRO APRO` (cenário de aprovação), CPF de teste `123.456.789-09`.
- **payment_id (MercadoPago):** `1328003798`
- **external_reference:** `20f79442-8248-4cca-83e4-d9caa7d440b7`

## Resultado — o que funcionou

| Verificação | Resultado |
|---|---|
| Um único pagamento solicitado (não 1 por loja) | ✅ Confirmado — 1 cobrança de R$ 221,15 |
| 2 pedidos distintos criados, 1 por vendedor | ✅ Confirmado no banco: `order_01M17JMSWKEAV4GFXHGD8CGNA6` (display_id 10, seller LOJA FIX SISTEMAS) e `order_01M17JMSWV0HFNKAEA8WJAQARA` (display_id 11, seller Mulheres de Axé do Brasil), ambos com `metadata.mercadopago_external_reference` igual |
| Cada pedido só com o item do vendedor correspondente | ✅ Confirmado: pedido CGNA6 → "Produto Teste QA - Split Vendedor" (qtd 1, R$10,00); pedido QARA → "Bolsa Africana 2 em 1" (qtd 1, R$182,00) |
| `seller_id` correto em cada pedido | ✅ Confirmado (ver tabela acima) |
| Frete rateado proporcionalmente | ✅ Confirmado: R$ 1,51 (pedido de R$10) + R$ 27,64 (pedido de R$182) = R$ 29,15 (bate exato com o frete total) |
| Painel do vendedor mostra só o próprio pedido, sem vazar itens de outro vendedor | ✅ Confirmado: LOJA FIX SISTEMAS via UI mostrou "1 pedido(s) encontrado(s)" com 1 item; isolado pela query `metadata.seller_id` em `seller/orders/route.ts`, e os dados no banco confirmam a separação |
| NF-e sandbox emitida por pedido | ✅ Confirmado: `nf_document` com `status: issued` para os 2 pedidos, sem erro. Valores: R$ 11,51 (item + frete rateado do vendedor 1), R$ 209,64 (item + frete rateado do vendedor 2) |

## Resultado — o que NÃO funcionou (bloqueador)

### ❌ Comissão não é criada para pedidos do split multi-vendedor

**Achado:** a tabela `commission` ficou vazia para os 2 pedidos criados neste teste.

**Causa raiz:** `packages/medusa-backend/apps/backend/src/subscribers/commission-on-payment.ts:66-68` escuta o evento `order.payment_captured`. O webhook do MercadoPago (`packages/medusa-backend/apps/backend/src/api/store/webhooks/mercadopago/route.ts`, Task 4) cria os pedidos via `orderService.createOrders()` e emite apenas `order.placed` e `mercadopago.order_approved` — nunca `order.payment_captured`, porque esse fluxo não passa pelo processo normal de captura de pagamento do módulo de Order/Payment do Medusa (só usado no fluxo antigo de pedido único, onde a captura real do pagamento disparava esse evento nativamente).

**Impacto:** nenhum vendedor recebe registro de comissão/repasse para pedidos originados desse fluxo — a funcionalidade de comissionamento, que é core do marketplace, fica quebrada silenciosamente (sem erro nos logs) para todo pedido criado pelo split multi-vendedor.

**Por que não é um fix trivial:** simplesmente adicionar `order.payment_captured` à lista de eventos emitidos no webhook pode conflitar com o subscriber interno do Medusa para esse mesmo evento (motivo pelo qual a Task 4 já usa `mercadopago.order_approved` como evento customizado para a NF-e, evitando esse conflito — ver comentário em `order-fiscal-emit.ts`). Os pedidos aqui são criados diretamente via `createOrders()`, sem uma captura de pagamento real vinculada (`payment`/`payment_collection`) — emitir o evento nativo sem esse estado subjacente pode quebrar expectativas do subscriber interno do Medusa. Precisa de decisão de design: ou (a) criar um evento customizado próprio pro commission (mesmo padrão do fiscal) e mudar `commission-on-payment.ts` pra escutar os dois eventos, ou (b) garantir que a captura de pagamento real aconteça por pedido antes de emitir `order.payment_captured`.

**Recomendação:** tratar como Task 6 do plano antes de liberar pro teste do Aylton — o fluxo de split não está completo sem geração de comissão.

## Achados secundários (não bloqueadores, não relacionados ao código das Tasks 1-4)

1. **UI: painel `/painel/pedidos` mostra Total "—", Status "—" e Data "Invalid Date" para todos os pedidos.** Rota pré-existente `seller/orders/route.ts` (commit `4e18847`, não tocada pelo plano) não usa `select` explícito no `listOrders()`. Mesmo padrão de bug já documentado nos comentários de `commission-on-payment.ts:26-31` e `order-fiscal-emit.ts:18-23` ("total" nunca é computado sem `select` explícito; `metadata`/`created_at` também saem `undefined` se não listados). A linha do pedido também não tem link pra detalhe.
2. **UX: botão "Sair" (logout) no painel do vendedor nem sempre aparece visível/acessível** na sidebar dependendo da página — apareceu ausente na tela "Meu perfil" mas presente e clicável no Dashboard.
3. **Bug: página pública `/loja/[id]` não lista produto recém-publicado.** Produto "Produto Teste QA - Split Vendedor" ficou "Publicado" no painel mas a página da loja (`/loja/01M0WG0SPGCDNVJ003VXA6N6ZE`) reportou "Esta loja ainda não tem produtos publicados" — o mesmo produto aparece normalmente na busca geral (`/produtos?q=...`). Indica possível problema de cache/index específico da página da loja, não investigado a fundo.

## Conclusão (teste original, 2026-08-27)

O split de pedido em si (criação de N pedidos, itens corretos, frete rateado, NF-e por pedido) **funciona corretamente**. Mas o fluxo está **incompleto para liberar a testadores externos**: comissão não é gerada, o que quebra o modelo de negócio do marketplace pra qualquer pedido multi-vendedor. Recomenda-se resolver esse gap antes de prosseguir para revisão final da branch e liberação ao Aylton.

---

## Reteste — 2026-09-04, código reconciliado (commit `4705b89`)

> Executado em `teste.mercadopreto.com.br` na branch `fix/multi-seller-cart-order-split` (commit `4705b89`, merge `73718a0` com `fix/checkout-metadata-persistence`), depois do fix de comissão (`418338b`) e da reconciliação com a persistência de snapshot do checkout. Migration `checkout_snapshot` rodada no servidor antes do deploy do container novo (ordem obrigatória documentada no plano). Mesmo carrinho do teste original: "Produto Teste QA - Split Vendedor" (LOJA FIX SISTEMAS, R$10,00) + "Bolsa Africana 2 em 1" (Mulheres de Axé do Brasil, R$182,00), frete Correios SEDEX R$15,25, total R$207,25.

**Objetivo específico deste reteste:** confirmar que a comissão agora é criada (bloqueador do teste original) **e** que o webhook recupera os metadados via snapshot local, não mais via busca de preferência no MercadoPago (bug descoberto durante a tentativa de reteste em 29/08, motivo da reconciliação).

- **payment_id:** `1328047876`
- **external_reference:** `b88d4b2b-f516-4382-a17d-07e9a38566a4`

| Verificação | Resultado |
|---|---|
| Um único pagamento solicitado | ✅ 1 cobrança de R$ 207,25 |
| **Metadados recuperados via snapshot local (não fallback legado)** | ✅ Confirmado no log: `"metadados recuperados do snapshot local para ref b88d4b2b-..."` — sem nenhuma linha de `(fallback legado)`. Prova empírica de que a persistência de snapshot funciona ponta a ponta; a busca de preferência no MP (com atraso de indexação de horas) nunca precisou ser chamada. |
| 2 pedidos criados, 1 por vendedor | ✅ `order_01M1MWZBC0AHMQZ9K2M1MQAQ0T` (display_id 13, LOJA FIX SISTEMAS) e `order_01M1MWZBC41WCXYMQD1TMP21GE` (display_id 14, Mulheres de Axé do Brasil) |
| Item correto em cada pedido | ✅ Pedido 13 → "Produto Teste QA - Split Vendedor" (qtd 1, R$10,00); pedido 14 → "Bolsa Africana 2 em 1" (qtd 1, R$182,00) |
| Frete rateado proporcionalmente | ✅ R$ 0,79 (pedido 13) + R$ 14,46 (pedido 14) = R$ 15,25 (bate exato) |
| **Comissão criada para os 2 pedidos** | ✅ **Bloqueador resolvido.** 2 linhas em `commission`: pedido 13 → seller `01M0WG0SPGCDNVJ003VXA6N6ZE`, grossAmount 1079, commissionAmount 151, sellerPayout 857; pedido 14 → seller `01KX7D9SVAQDGBH726MFKQT2K2`, grossAmount 19646, commissionAmount 2853, sellerPayout 16167 |
| NF-e emitida por pedido | ✅ `nf_document.status = 'issued'` para os 2 pedidos |
| Painel do vendedor mostra o pedido e o valor a receber corretos | ✅ Dashboard da LOJA FIX SISTEMAS: "1 Total de pedidos", "R$ 8,57 A receber" — bate com o `sellerPayout` (857 centavos) do pedido 13 |

### Conclusão do reteste

**Os dois bloqueadores anteriores (comissão ausente, perda de metadata) estão resolvidos.** O fluxo completo — split por vendedor, item correto, frete rateado, comissão, NF-e, painel do vendedor — funciona ponta a ponta no ambiente de teste com o código reconciliado. Ambiente liberado para o Aylton testar. Próximo passo: revisão final ampla da branch inteira antes de seguir pro GitFlow (`develop` → `alpha` → `beta` → `release` → `main`).

---

## Reteste 2 — 2026-09-04, fix de comissão/WhatsApp (commit `d2da7d5`)

> A revisão final ampla da branch (rodada logo após o reteste acima) encontrou 2 bugs que só apareciam com split multi-vendedor + comissão juntos: a taxa fixa do MercadoPago (R$0,39) era cobrada uma vez por pedido em vez de uma vez por pagamento, e o comprador recebia uma confirmação de WhatsApp por vendedor (cada uma com total parcial, parecendo cobrança duplicada). O dono do produto também determinou, nessa mesma revisão, que a comissão deve incidir só sobre o valor dos produtos, nunca sobre o frete. Fix implementado via TDD, revisado (veredito "Yes", sem Critical/Important), deployado e retestado com o mesmo carrinho dos retestes anteriores.

- **payment_id:** `1328049096`
- **external_reference:** `54afa9a1-fe4d-4cc2-935e-68c1204c25ca`

| Verificação | Resultado |
|---|---|
| 2 pedidos criados (display_id 15 e 16), 1 por vendedor | ✅ Confirmado |
| **Comissão calculada só sobre o valor dos produtos, sem o frete** | ✅ `grossAmount` = 1000 (pedido 15, produto R$10,00) e 18200 (pedido 16, produto R$182,00) — bate exato com o preço do item, sem o frete rateado (R$0,79/R$14,46) somado |
| **Taxa fixa do MercadoPago (R$0,39) rateada uma vez por pagamento, não por pedido** | ✅ `bankingFees` = 32 (pedido 15: 30 percentual + 2 de taxa fixa rateada) e 581 (pedido 16: 544 percentual + 37 de taxa fixa rateada) — soma da parcela fixa = 2+37 = **39 centavos no total**, não 78 |
| Frete repassado integralmente ao vendedor, fora do cálculo de comissão | ✅ `sellerPayout` = 902 (968 líquido dos produtos − 145 comissão + 79 de frete) e 16422 (17619 − 2643 + 1446) |
| Painel do vendedor reflete o valor correto (acumulado dos 2 testes) | ✅ "2 Total de pedidos", "R$ 17,59 A receber" (R$8,57 do reteste 1 + R$9,02 deste) |
| Consolidação de WhatsApp (1 mensagem por pagamento, não 1 por vendedor) | ⚠️ **Não observável neste ambiente** — `EVOLUTION_API_URL`/`EVOLUTION_API_KEY`/`EVOLUTION_API_INSTANCE` não configurados no servidor de teste, então `sendWhatsApp` retorna silenciosamente antes de qualquer chamada real ou log. Comportamento coberto por 6 testes unitários dedicados (`order-placed-whatsapp.unit.spec.ts`), incluindo o cenário exato deste carrinho (2 pedidos, mensagem única, total consolidado R$207,25) — não confirmado empiricamente em produção/staging real por falta de credenciais no ambiente. |

### Conclusão do reteste 2

Os dois bugs encontrados na revisão final ampla estão corrigidos e confirmados no banco com os valores exatos esperados. A regra de negócio "comissão só sobre produtos" está em vigor. A consolidação do WhatsApp fica pendente de confirmação empírica quando houver um ambiente com credenciais reais da Evolution API configuradas — a cobertura de testes unitários é forte, mas não substitui a observação real do comportamento de envio.
