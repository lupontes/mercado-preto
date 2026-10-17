# Preço do Checkout no Servidor — Design

**Status**: Aprovado pelo usuário (17/10/2026), pronto para plano de implementação.

Branch: `fix/checkout-server-side-pricing` (a partir de `develop`, depois do #63).

## Contexto e motivo

O backend confia em valores enviados pelo navegador em três pontos do checkout. Qualquer
pessoa com o DevTools aberto consegue pagar R$ 0,01 por um produto e receber pedidos
"aprovados". Isso bloqueia a ida para produção.

O frete já é recalculado no servidor desde o #63 (`utils/checkout-shipping.ts`), com 409
quando o valor mudou. Este ciclo aplica a mesma regra ao preço dos produtos e fecha as
duas pontas do pagamento (Brick e webhook).

## Estado atual (lido do código, 17/10/2026)

Caminho base: `packages/medusa-backend/apps/backend/src`.

- **Preço e título dos itens.** `checkoutRequestSchema` (`utils/checkout-payload.ts`)
  recebe `items[].price` e `items[].title` do cliente. `buildCheckoutSnapshot` copia
  esses valores para `items`, `seller_groups` e `total` do snapshot.
  `utils/create-orders-from-checkout.ts` grava `unit_price: i.price` nos pedidos.
  - `api/store/checkout/preference/route.ts` monta os `items` da preferência do Mercado
    Pago com `item.price` e `item.title` do cliente.
  - `api/store/checkout/sandbox-cash/route.ts` usa o mesmo snapshot e cria pedidos na hora.
- **Brick.** `api/store/checkout/payment/route.ts` cobra o `transaction_amount` enviado
  pelo cliente. Não confere com o snapshot do `external_reference`, nem se ele existe. A
  vitrine manda `amountCents / 100` (`apps/storefront/src/components/payment/MercadoPagoBrick.tsx`).
- **Webhook.** `api/webhooks/mercadopago/route.ts` cria os pedidos para qualquer
  pagamento `approved` cujo snapshot é encontrado, sem comparar `transaction_amount` com
  o total esperado. A duplicação de pedidos já é evitada por `createOrdersFromCheckout`,
  mas um segundo pagamento aprovado do mesmo `external_reference` passa em silêncio.
- **Origem do preço na vitrine.** `variant.prices[]` com `currency_code === "brl"`
  (`ProductDetails.tsx`, `ProductCard.tsx`), em centavos. Não há price lists nem
  promoções no projeto.
- **Snapshot.** `modules/checkout/models/checkout-snapshot.ts`: `externalReference`
  (único), `payload` (json), `preferenceId`. Sem status.
- **409 do frete na vitrine.** `apps/storefront/src/app/checkout/page.tsx` trata
  `409 + quote` mostrando o novo valor e pedindo que o comprador continue.

## Objetivos

1. Nenhum valor cobrado ou gravado nos pedidos vem do navegador: o preço e o título de
   cada item saem do banco, o frete da recotação (já existe) e o total do snapshot.
2. Se o preço mudou entre o carrinho e o checkout, o comprador vê o preço novo e confirma
   de novo (decisão do usuário).
3. O Brick cobra o total do snapshot, nunca o que o cliente manda (decisão do usuário).
4. O webhook só cria pedidos quando o valor aprovado bate com o total do snapshot. Se não
   bater, não cria, registra erro e deixa o caso para revisão manual (decisão do usuário).
5. Um `external_reference` já pago não aceita outra cobrança pelo Brick (recomendação
   aceita pelo usuário).

## Não objetivos

- **Estoque** (conferência, reserva, baixa). Fica para um ciclo próprio: conferir sem
  reservar não impede venda dupla em compras simultâneas.
- **Estorno automático** de pagamentos divergentes. O usuário escolheu revisão manual.
- **Canal de alerta** (WhatsApp ou e-mail para o admin). A Evolution API está parada;
  o alerta deste ciclo é o log de erro e a marcação no snapshot.
- **Tela no admin** para listar divergências.
- **Página de sucesso** (`checkout/confirm`) e o frete que ela não mostra.

## Antiobjetivos

- O comprador pagar um valor diferente do que viu na tela sem ter confirmado.
- Pedido criado com preço do cliente, mesmo em `sandbox-cash`.
- Pagamento legítimo aprovado que deixa de virar pedido por uma comparação mal feita
  (por exemplo, arredondamento de float ou juros de parcelamento).

## Design

### 1. Preço e título dos itens vindos do banco

Um único ponto resolve os itens no servidor, usado por `preference` e `sandbox-cash`
(sugestão: dentro de `buildCheckoutSnapshot` ou numa função irmã em `utils/`, chamada
antes da recotação do frete).

- Busca as variantes pedidas com `prices` e o título do produto (e da variante, se for
  usado no título exibido).
- **Preço vigente:** o `amount` em `brl` da variante, a mesma regra da vitrine.
- **Título:** sempre do banco. O título do cliente é ignorado.
- **Variante inexistente ou sem preço em `brl`:** 400 com `CART_ITEM_UNAVAILABLE_MESSAGE`
  (`utils/shipping-quote.ts`), o mesmo erro de carrinho desatualizado do frete, sem ids
  internos. A vitrine já mostra essa mensagem. *(Decisão de quem escreveu o spec.)*
- **Preço diferente do enviado:** 409. A resposta lista, por variante, o preço atual
  (e o título), para a vitrine atualizar o carrinho. O pedido não segue.
- A ordem é: preço dos itens primeiro e, depois, a recotação do frete. Assim um 409 de
  preço não gasta chamada ao Melhor Envio.
- O snapshot (`items`, `seller_groups`, `total`) e os `items` da preferência do Mercado
  Pago usam só os valores resolvidos no servidor.
- `items[].price` continua no schema da requisição, mas passa a significar "o preço que
  o comprador viu", da mesma forma que `shipping.expectedTotal`.

### 2. Vitrine: 409 de preço

- `readCheckoutResponse` passa a carregar também a lista de preços atualizados do 409.
- Na página do checkout, um 409 de preço atualiza preço e título dos itens no
  `cart-store`, mostra uma mensagem como "O preço de alguns produtos foi atualizado.
  Confira e continue." e mantém o comprador na mesma etapa.
- A cotação de frete continua valendo, já que depende das variantes, não do preço.
  Se o próximo envio der 409 de frete, o fluxo atual cuida disso.

### 3. Brick (`/store/checkout/payment`)

- `transaction_amount` sai do schema da requisição (ou é ignorado, se for mais simples
  manter compatibilidade com a vitrine durante o deploy).
- A rota busca o snapshot pelo `external_reference`:
  - não existe: 404 (ou 400) com mensagem genérica;
  - já marcado como pago: 409 "Este pedido já foi pago.";
  - caso contrário: cobra `payload.total / 100`.
- A chave de idempotência continua aleatória por tentativa, porque um cartão recusado
  precisa poder tentar de novo com outro cartão.
- **Resposta `approved` na hora:** a rota já faz a transição condicional `pending` →
  `paid` com o `payment.id` (decisão do usuário). Isso fecha a janela até o webhook
  chegar: um segundo envio recebe 409. A rota **não** cria pedidos; isso continua com o
  webhook.
- **`pending`, `in_process` ou recusa:** o snapshot fica `pending`, para o comprador poder
  desistir do Pix e pagar com cartão (decisão do usuário). Se ele acabar pagando os dois,
  o segundo aprovado cai em "pagamento extra" no webhook.
- A vitrine deixa de mandar `transaction_amount`. O valor exibido pelo Brick continua
  vindo de `amountCents`, que agora deve ser o total devolvido pela `preference` (ver
  item 5).

### 4. Webhook

Depois de recuperar o snapshot e antes de `createOrdersFromCheckout`:

- **Comparação:** `Math.round(payment.transaction_amount * 100) === payload.total`.
  Usar `transaction_amount`, não `total_paid_amount`, porque os juros do parcelamento
  ficam fora do valor da venda.
- **Divergência:** não cria pedidos, faz `logger.error` com ref, payment id, valor pago e
  valor esperado, marca o snapshot como divergente e responde 200 (o Mercado Pago não
  deve reenviar).
- **Valor certo:** faz a transição condicional para `paid` com o `payment.id` e, se
  vencer, cria os pedidos (ver item 5).
- **Snapshot que já saiu de `pending`:** segue as regras do item 5 (reentrega
  idempotente ou pagamento extra com `logger.error`).
- **Sem snapshot local** (fallback legado pela busca de preferência): a comparação usa o
  `total` do metadata da preferência, que também foi escrito pelo servidor. Se o
  metadata não tiver `total`, não cria pedidos e faz `logger.error`.

### 5. Estado do snapshot

Novos campos em `checkout_snapshot`, com migration que aceita vazio:

- `status`: `pending` (padrão; vazio em snapshots antigos conta como `pending`), `paid`
  ou `amount_mismatch`;
- `paymentId`: texto, nulo até o pagamento. É o pagamento que definiu o status;
- `ordersCreatedAt`: data, nula até os pedidos serem criados.

**Regra geral:** um snapshot vira pedido por no máximo um pagamento. Qualquer coisa fora
do caminho feliz fica parada para revisão manual. *(Decisão de quem escreveu o spec:
prioriza a segurança. Uma divergência só acontece com adulteração ou bug, então bloquear
não atrapalha comprador legítimo.)*

- **Transição atômica:** sair de `pending` é uma atualização condicional
  (`WHERE status = 'pending'`, ou equivalente com trava), feita **antes** de criar os
  pedidos. Só quem vence a transição cria pedidos. Isso cobre `payment.created` e
  `payment.updated` chegando quase juntos.
- **Mesmo `payment.id` já em `paid`** (marcado pelo Brick ou por uma entrega anterior
  do webhook): segue para a criação de pedidos, sem log de erro.
- **Criação de pedidos com trava própria:** como `paid` pode vir do Brick, o direito de
  criar pedidos é um segundo campo, `ordersCreatedAt` (nulo → agora, também condicional).
  Só quem vence essa trava chama `createOrdersFromCheckout`. Se a criação falhar, a trava
  volta para nulo e há `logger.error`, para uma nova entrega do webhook tentar de novo.
  *(Decisão de quem escreveu o spec.)*
- **`amount_mismatch` é terminal:** um pagamento certo que chega depois não cria
  pedidos; registra `logger.error` para revisão. O Brick também recusa cobrança nesse
  estado (409).
- **Pagamento extra** (status já `paid` ou `amount_mismatch` com outro `payment.id`,
  com qualquer valor): status e `paymentId` não mudam, e um `logger.error` com os dois
  ids e os dois valores identifica o pagamento a estornar.

Métodos novos em `CheckoutModuleService`: transição condicional e leitura do status.

`sandbox-cash` grava o snapshot já como `paid`, com `ordersCreatedAt` preenchido,
porque cria os pedidos na hora.

A `preference` passa a devolver `total` (centavos) junto com `preference_id` e
`external_reference`, e a vitrine usa esse valor no Brick em vez de recalcular.

## Testes

Seguir os testes de rota e de `utils/` que já existem (`*.unit.spec.ts`), em TDD.

- **Resolução de itens:** preço do banco, título do banco, 409 com a lista de preços,
  422 para variante sem preço `brl` ou inexistente.
- **`preference` e `sandbox-cash`:** preferência e snapshot com o preço do servidor,
  mesmo quando o cliente manda outro preço ou título; 409 de preço antes de chamar a
  cotação do frete.
- **`payment`:** cobra `payload.total / 100` e ignora o valor do cliente; 404 sem
  snapshot; 409 com snapshot `paid` ou `amount_mismatch`; `approved` marca `paid`;
  `pending` e recusa não marcam.
- **Webhook:** valor certo cria e marca pago; valor diferente não cria e marca
  divergente; arredondamento de float (por exemplo, `10.1 * 100`) não gera falso
  divergente; snapshot já marcado pelo Brick com o mesmo `payment.id` cria os pedidos;
  duas entregas simultâneas criam os pedidos uma vez só; pagamento extra gera log e
  nenhum pedido; falha na criação libera a trava.
- **Transições no serviço:** teste de integração com banco real (seguindo os testes de
  integração do projeto, se houver) para provar que a atualização condicional só deixa
  um vencedor.
- **Vitrine:** `readCheckoutResponse` com 409 de preço; atualização do carrinho.
- **Ponta a ponta no servidor de teste:** checkout no sandbox com o preço adulterado no
  DevTools, que deve receber 409, e um checkout normal aprovado pelo webhook.

## Deploy

- Rodar a migration do módulo `checkout` antes de subir o container novo, como no #63.
- A vitrine e o backend saem juntos: a vitrine antiga manda `transaction_amount`, e a
  rota nova precisa aceitar ou ignorar esse campo sem quebrar.

## O que fica com quem implementar

- Onde fica exatamente a resolução de itens (função nova ou dentro de
  `buildCheckoutSnapshot`).
- O formato exato do corpo do 409 de preço, desde que traga preço e título por variante.
- O texto das mensagens ao comprador, seguindo o tom das mensagens de frete.
