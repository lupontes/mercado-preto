# Frete Econômico com Loja Local — Design

**Status**: Aprovado pelo usuário (17/10/2026), pronto para plano de implementação.

Branch: `fix/economico-frete-local` (a partir de `develop`, depois do #66).

## Contexto e motivo

No teste de 17/10, o comprador só via a opção de frete por SEDEX. A causa: os Correios,
via Melhor Envio, não atendem PAC quando a loja e o comprador estão na mesma cidade. A
API responde PAC com `"Transportadora não atende este trecho."` e SEDEX normalmente.
Isso foi confirmado no sandbox com as lojas de Salvador e de Cachoeira.

A regra atual (`quoteShipping` em `utils/shipping-quote.ts`) monta o **Econômico**
somando o PAC de **todas** as lojas e o **Rápido** somando o SEDEX de todas. Se uma
loja não tem PAC, o Econômico desaparece do carrinho inteiro, mesmo que as outras
lojas tenham PAC.

## Decisões do usuário

1. **Econômico** = o serviço **mais barato** disponível em cada loja. **Rápido** = o
   serviço **mais rápido** disponível em cada loja. Uma loja local, que só tem SEDEX,
   entra com SEDEX nas duas opções; as outras lojas continuam com PAC no Econômico.
2. Se as duas opções ficarem **idênticas** (os mesmos serviços em todas as lojas), a
   vitrine mostra **uma opção só**.
3. O "ver detalhes" do frete mostra o **serviço de cada loja** (PAC ou SEDEX), além do
   nome da loja e do preço.

## Comportamento

- Para cada loja cotada (`quotedSellers`):
  - **Econômico:** o serviço de menor `price`. Em caso de empate, vale o de menor
    `deliveryDays`.
  - **Rápido:** o serviço de menor `deliveryDays`. Em caso de empate, vale o de menor
    `price`.
- A loja que não tem nenhum serviço continua indo para `unavailableSellers` com
  `quote_failed`, como hoje.
- **Opções idênticas:** quando cada loja tem o mesmo `service` nas duas opções, só o
  **Rápido** é devolvido. *(Decisão de quem escreveu o spec: preserva o comportamento
  atual do carrinho de uma loja local, que hoje já mostra só "Rápido". Se estiver
  errado, o custo é só o rótulo.)*
- O total e o prazo de cada opção continuam calculados como hoje: a soma dos preços e o
  maior prazo entre as lojas mais `handlingDays`.
- O checkout (`resolveCheckoutShipping`) não muda: ele recota e procura a opção pelo
  `tier`, e a nova regra é aplicada do mesmo jeito.
- Os pedidos já gravam o serviço por loja (`Correios PAC`/`Correios SEDEX`,
  `shipping_service_id`), então misturar serviços dentro de uma opção não exige
  mudança na criação de pedidos.

## Vitrine

- Em `apps/storefront/src/app/checkout/ShippingOptions.tsx`, cada linha de "ver
  detalhes" passa a mostrar `loja — serviço — preço`, por exemplo
  `LOJA FIX SISTEMAS — SEDEX — R$ 12,97`.
- O "ver detalhes" continua aparecendo só quando há mais de uma loja, como hoje.
- Não há outra mudança na vitrine: ela já lida com uma ou duas opções.

## Não objetivos

- Outras transportadoras (Jadlog, Loggi) ou entrega local própria.
- Mudar o texto ou o rótulo das opções.
- Mostrar o serviço quando o carrinho tem uma loja só.

## Testes

- `utils/__tests__/shipping-quote.unit.spec.ts`:
  - Uma loja sem PAC e outra com PAC: o Econômico tem SEDEX na primeira e PAC na
    segunda, e o Rápido tem SEDEX nas duas.
  - Uma loja local sozinha (só SEDEX): devolve só a opção `rapido`.
  - PAC mais caro que SEDEX numa loja: o Econômico usa SEDEX nessa loja.
  - Empates nos dois critérios.
  - O teste atual `omits a tier when any seller lacks that service` é substituído
    pelos casos acima.
- `apps/storefront/.../shipping-options.test.tsx`: o "ver detalhes" mostra o serviço.
- Ponta a ponta no servidor de teste: carrinho com LOJA FIX e Mulheres de Axé,
  entrega em Salvador. O resultado esperado é Econômico (LOJA FIX com SEDEX e Mulheres
  de Axé com PAC) e Rápido (SEDEX nas duas).
