# Mensagens de Erro do Checkout — Design

**Status**: Aprovado (17/10/2026).

Branch: `fix/checkout-mensagens-erro` (a partir de `develop`).

## Contexto e motivo

Item 6 da fila do HANDOFF. No teste de 17/10, foram encontrados três problemas:

1. **Cartão recusado esvazia o carrinho.** `POST /store/checkout/payment` responde 200
   com `status: "rejected"` quando o Mercado Pago recusa o cartão. A vitrine
   (`MercadoPagoBrick.tsx`, `submitPayment`) só olha `res.ok`, chama `onSuccess`, e a
   página (`page.tsx`, `handlePaymentSuccess`) esvazia o carrinho e vai para
   `/checkout/sucesso`, que mostra "falhou". O comprador perde o carrinho.
2. **Erro genérico.** Quando a API do Mercado Pago lança erro (por exemplo, o código
   2034 "Invalid users involved"), a rota responde 500 com
   `"Erro ao processar pagamento."` e com o **erro bruto** no campo `detail`. A vitrine
   mostra só o texto genérico, e o erro bruto vaza para o navegador.
3. **Frete 422 limpa a seleção.** Quando o frete escolhido deixa de existir, a página
   limpa a seleção e mostra "Opção de frete indisponível", mesmo quando sobrou uma
   única opção válida.

## Decisões do usuário

1. **Cartão recusado:** o comprador fica na etapa de pagamento, o carrinho é mantido e
   o motivo aparece em português. Ele tenta de novo no mesmo pedido.
2. **Pix pendente:** continua como hoje. O carrinho é esvaziado e o comprador vai para
   a página de confirmação.
3. **Erros do Mercado Pago:** o navegador recebe só a mensagem amigável. O backend
   traduz os casos comuns, registra o erro bruto no log e deixa de devolver `detail`.
4. **Frete 422:** se sobrou exatamente uma opção e nenhuma loja ficou indisponível,
   ela já vem selecionada, com a mensagem "As opções de frete mudaram. Confira e
   continue.".

## Comportamento

### Backend: `api/store/checkout/payment/route.ts`

- **Recusa (`status: "rejected"`):** continua 200, com `payment_id`, `status` e
  `status_detail`, e ganha um campo `message` com o texto em português, traduzido de
  `status_detail`. O snapshot continua `pending`, como hoje, e por isso a nova
  tentativa é aceita.
- **Exceção da API do Mercado Pago:** `logger.error` com o erro bruto, e a resposta
  passa a ser **502** `{ error: <mensagem amigável> }`, sem `detail`. Se o erro tiver
  um código conhecido em `cause[].code`, a mensagem é a traduzida; senão, é
  `"Não foi possível processar o pagamento. Tente novamente em instantes."`.
  *(Decisão de quem escreveu o spec: 502 descreve uma falha do serviço externo
  melhor que 500. Custo se errado: só o código HTTP; a vitrine não depende dele.)*
- Ficam como estão o 404 do pedido inexistente, o 409 do pedido já pago e o
  comportamento de `approved`, `pending` e `in_process`.
- A tradução fica num módulo próprio, `utils/mercadopago-messages.ts`. Ele tem uma
  tabela de `status_detail` para texto e outra de códigos de erro para texto, cada
  uma com uma mensagem padrão.

**`status_detail` cobertos** (os de cartão mais comuns na documentação do Mercado
Pago):

| `status_detail` | Mensagem |
|---|---|
| `cc_rejected_insufficient_amount` | Saldo ou limite insuficiente. Tente outro cartão ou pague com Pix. |
| `cc_rejected_bad_filled_card_number` | Confira o número do cartão. |
| `cc_rejected_bad_filled_date` | Confira a data de validade do cartão. |
| `cc_rejected_bad_filled_security_code` | Confira o código de segurança do cartão. |
| `cc_rejected_bad_filled_other` | Confira os dados do cartão. |
| `cc_rejected_call_for_authorize` | O banco pediu autorização para este pagamento. Ligue para o banco e tente de novo. |
| `cc_rejected_card_disabled` | Este cartão está desativado. Ative-o com o banco ou use outro cartão. |
| `cc_rejected_duplicated_payment` | Já existe um pagamento igual a este. Confira seu extrato antes de tentar de novo. |
| `cc_rejected_high_risk` / `cc_rejected_blacklist` | O pagamento não foi aprovado. Tente outro cartão ou pague com Pix. |
| `cc_rejected_max_attempts` | Você atingiu o limite de tentativas com este cartão. Use outro cartão ou pague com Pix. |
| qualquer outro | O pagamento não foi aprovado. Tente outro cartão ou pague com Pix. |

**Códigos de erro cobertos:** `2034` → "Não foi possível usar este e-mail no
pagamento. Confira o e-mail ou use outro." Os demais caem na mensagem padrão.

### Vitrine: `MercadoPagoBrick.tsx` e `page.tsx`

- `submitPayment` trata `status === "rejected"` como erro: lança
  `Error(data.message)`. Assim o `catch` do `handleSubmit` chama `onError(message)` e
  o Brick volta ao estado de erro, o que permite tentar de novo.
- Uma resposta não-OK continua lançando `data.error`, que agora já é a mensagem
  amigável.
- `handlePaymentSuccess` só é chamado em `approved`, `pending` e `in_process`, e só
  nesses casos o carrinho é esvaziado.
- **Frete 422:** quando `result.quote.options.length === 1` e
  `result.quote.unavailableSellers.length === 0`, a página chama
  `setShipping(options[0])` e mostra "As opções de frete mudaram. Confira e
  continue.". Nos outros casos, o 422 continua como hoje.

## Não objetivos

- QR Code do Pix na página de confirmação.
- Mudar `/checkout/erro` e `/checkout/pendente`, que são os retornos do Checkout Pro.
- Traduzir todos os códigos do Mercado Pago; só os listados acima.
- Retentativa automática.

## Testes

- `utils/__tests__/mercadopago-messages.unit.spec.ts`: cada `status_detail` da tabela,
  o padrão, o código 2034 e o código desconhecido.
- `api/store/checkout/payment/__tests__/route.unit.spec.ts`:
  - recusa → 200 com `message` traduzida e sem transição do snapshot;
  - exceção com `cause[0].code = 2034` → 502 com a mensagem traduzida, sem `detail`,
    e `logger.error` com o erro bruto;
  - exceção sem código → 502 com a mensagem padrão.
- Vitrine:
  - `submitPayment` com `status: "rejected"` lança a `message`;
  - na página, um pagamento recusado não esvazia o carrinho, mostra a mensagem e
    mantém a etapa de pagamento;
  - 422 com uma única opção e sem lojas indisponíveis pré-seleciona a opção e mostra a
    mensagem nova; com duas opções, continua como hoje.
- Ponta a ponta no servidor de teste:
  - um cartão de teste com titular `FUND` (recusa por saldo insuficiente) mostra a
    mensagem e mantém o carrinho;
  - um pagador com e-mail `@testuser.com` mostra a mensagem do código 2034.
