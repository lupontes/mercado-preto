# Programa de Pontos — Design

**Status**: Aprovado (18/10/2026). Substitui
`2026-09-07-loyalty-points-design.md`, que foi aprovado antes do checkout
atual e tinha falhas de segurança (ver "Por que um spec novo").

Branch: `feature/programa-de-pontos` (a partir de `develop`).

## Decisões do usuário (17/10)

- **O desconto é pago pela plataforma.** Sai da comissão do Mercado Preto; o
  repasse da loja não muda.
- **Regra:** 1 ponto por R$ 1,00 em produtos (o frete não conta). Cada ponto
  vale R$ 0,01 no resgate, ou seja, 1% de volta.
- **Resgate com confirmação:** o usuário não escolheu o canal, então vale o
  recomendado, um código de 6 dígitos por e-mail.

## Por que um spec novo

O spec de 07/09 tinha estes problemas:

- **Resgate e consulta só pelo CPF, sem confirmação.** Quem soubesse o CPF de
  alguém gastaria os pontos dessa pessoa ou veria o histórico de compras dela,
  o que também é um problema de LGPD.
- **Pontos descontados ao criar o pagamento.** Um Pix abandonado faria os
  pontos sumirem.
- **Crédito no evento `order.completed`,** que quase nunca acontece no fluxo
  atual.
- **Não considerava o split em um pedido por loja,** nem o efeito do desconto
  na comissão e no repasse.

## Objetivo

O comprador, identificado pelo CPF/CNPJ que o checkout já pede, sem criar
conta:

- acumula pontos a cada compra paga;
- numa compra seguinte, confirma por um código enviado ao e-mail das compras
  anteriores, vê o saldo e usa os pontos como desconto antes de pagar.

## Decisões de design (de quem escreveu o spec)

### Módulo `loyalty`

O saldo nunca fica guardado: é sempre calculado a partir de lançamentos.

- **`loyalty_entry`:** `id`, `buyerDocument` (só dígitos, com índice),
  `type` e `points` (inteiro com sinal). `type` é:
  - `earn`, para pontos ganhos;
  - `reserve`, para pontos negativos reservados num checkout;
  - `redeem`, quando a reserva é confirmada pelo pagamento.

  Também tem `externalReference`, que é a referência do checkout.
  - **Índice único** em (`type`, `externalReference`), para que o webhook não
    credite nem confirme duas vezes.
- **Saldo disponível:** soma de `earn` mais `redeem`, mais as `reserve` ainda
  vivas. Uma `reserve` está viva se tem menos de **2 horas** e o checkout dela
  não foi pago.
  - Uma reserva vencida volta a ser saldo sozinha, sem job.
  - Quando o pagamento é aprovado, a `reserve` vira `redeem`, com uma
    transição atômica por `UPDATE … RETURNING`, no padrão do
    `checkout_snapshot`.
- **Constantes ajustáveis num arquivo só:**
  - `POINTS_PER_REAL = 1`;
  - `CENTS_PER_POINT = 1`;
  - `RESERVATION_TTL_MINUTES = 120`.

### Ganho: no pagamento aprovado

- No webhook do Mercado Pago, depois de criar os pedidos (o mesmo ponto em
  que a comissão é disparada):
  - credita `floor(itensSemFrete / 100)` pontos ao `buyer_document` do
    snapshot, com `type: earn` e `externalReference` do checkout;
  - os itens são contados **depois** do desconto de pontos, ou seja, sobre o
    que foi pago em produtos.
- É idempotente pelo índice único.
- Se o crédito falhar:
  - o webhook registra o erro e segue;
  - o pedido já foi criado;
  - o crédito pode ser refeito por um script de reconciliação, que fica para
    depois.

### Confirmação por código

- **`POST /store/loyalty/code` `{ document }`:**
  - procura o e-mail do **primeiro** snapshot pago com aquele documento (decisão do usuário em 18/10: um intruso que pague uma compra com o CPF de outra pessoa e o próprio e-mail não consegue desviar os códigos; troca de e-mail fica com o suporte);
  - se existe, gera um código de 6 dígitos, guarda só o hash, válido por
    10 minutos, e manda pelo Brevo;
  - **responde sempre 200** com a mesma mensagem, para não revelar se o CPF
    já comprou;
  - limite de tentativas por IP, como no login.
- **`POST /store/loyalty/verify` `{ document, code }`:**
  - código válido → 200 com `{ token, balance }`. O `token` é um JWT de 30
    minutos com o documento, assinado com o `JWT_SECRET` atual e escopo
    `loyalty`;
  - até 5 tentativas por código; depois, o código é invalidado;
  - errado ou expirado → 400 "Código inválido ou expirado.".
- **Não existe rota pública de saldo por CPF.**

### Resgate no checkout (`POST /store/checkout/preference`)

- **Campos novos opcionais:** `redeemPoints` (inteiro > 0) e `loyaltyToken`.
- **Validação:**
  - o token tem que ser válido, de escopo `loyalty`, e ter o mesmo documento
    do checkout. Senão: 401 "Confirme seus pontos novamente.";
  - `redeemPoints` não pode passar do saldo disponível. Senão: 400 "Saldo de
    pontos insuficiente.".
- **Teto:** o desconto não passa da comissão que a plataforma receberia
  nesta compra, ou seja, `itens × taxa de comissão atual`. Assim a plataforma
  nunca paga para vender.
  - Se o pedido passar do teto, a rota usa o máximo permitido e devolve
    `pointsApplied` na resposta. A vitrine mostra o valor usado.
- **Desconto:** `pontos × CENTS_PER_POINT`, subtraído do total do snapshot.
  - O Mercado Pago cobra o total já descontado.
  - O webhook já compara com `payload.total`.
- **Repartição entre as lojas:** o desconto é dividido entre os
  `seller_groups` na proporção dos itens. Os centavos que sobram ficam com o
  primeiro grupo. A parte de cada loja vai para o snapshot (`loyalty_discount`
  por grupo) e para o `metadata` do pedido.
- **Reserva:** antes de criar a preferência, grava um `reserve` negativo
  ligado à `external_reference`. Se a criação da preferência falhar, a
  reserva é apagada.

### Comissão e repasse

- **A comissão ganha o campo `loyaltyDiscount`**, em centavos, com migration
  no módulo `commission`. O subscriber de comissão lê o desconto da loja no
  `metadata` do pedido.
- `sellerPayout` é calculado **como se não houvesse desconto**, sobre o valor
  bruto dos itens. O repasse da loja não muda.
- A receita da plataforma, `commissionAmount − loyaltyDiscount`, aparece no
  relatório do admin numa coluna nova, "Desconto em pontos". O total líquido
  da plataforma também desconta esse valor.

### Vitrine

- **Etapa de pagamento do checkout:** ganha o bloco "Usar meus pontos", com
  três passos:
  1. "Enviar código para o e-mail das compras anteriores";
  2. campo do código;
  3. o saldo em reais, com a opção "Usar R$ X,XX". O valor já respeita o
     teto.
- O token fica **só em memória** na página, nunca em `localStorage`.
- **Página de confirmação:** mostra "Você ganhou N pontos" quando o
  pagamento é aprovado.

## Não objetivos

- Estornar pontos em cancelamento ou reembolso. Fica para depois; o pedido
  pago é tratado como definitivo, como no spec antigo.
- Expirar pontos.
- Conta de comprador ou página "meus pontos" fora do checkout.
- Confirmação por WhatsApp. A Evolution API está parada (item 4).

## Riscos

- **E-mail do snapshot:** só existe a partir da primeira compra paga. Quem
  nunca comprou não tem pontos, então não há perda.
- **E-mail digitado errado na compra anterior:** o comprador não recebe o
  código. Aceito na v1.
- **Concorrência:** dois checkouts ao mesmo tempo com o mesmo token. O saldo
  é conferido e a reserva gravada numa transação com
  `SELECT … FOR UPDATE`, ou com um advisory lock pelo documento. A forma
  fica para o plano, mas o teste de concorrência é obrigatório.

## Testes

- **Módulo:**
  - o saldo soma `earn`, `redeem` e só as `reserve` vivas;
  - uma reserva vencida volta para o saldo;
  - `reserve` vira `redeem` uma única vez, em concorrência;
  - o crédito é idempotente;
  - duas reservas simultâneas não passam do saldo. Este teste roda em
    Postgres real.
- **Código:**
  - a resposta é a mesma para CPF com e sem compras;
  - o e-mail só sai para quem tem compra paga;
  - o código é guardado com hash, expira em 10 minutos e aceita no máximo 5
    tentativas;
  - o token vem com o documento certo.
- **Checkout:**
  - sem token, ou com o token de outro documento → 401;
  - saldo insuficiente → 400;
  - o teto é aplicado e devolvido em `pointsApplied`;
  - o desconto é repartido por loja, e as partes somam o total;
  - o Mercado Pago cobra o total com desconto;
  - a reserva é criada, e apagada quando a preferência falha.
- **Webhook:**
  - credita sobre os itens descontados e confirma o resgate;
  - não credita nem confirma duas vezes.
- **Comissão:**
  - `loyaltyDiscount` é gravado e o `sellerPayout` não muda;
  - o relatório mostra o desconto.
- **Vitrine:**
  - o fluxo de código, verificação e uso;
  - o valor aplicado no resumo;
  - o token não vai para o `localStorage`.
- **Ponta a ponta no ambiente local e depois no servidor de teste:**
  1. compra A paga, com pontos creditados;
  2. compra B: pedir o código e verificar;
  3. usar os pontos, com o Mercado Pago cobrando o total descontado;
  4. o resgate confirmado, com o repasse da loja intacto;
  5. um Pix abandonado devolve os pontos depois de 2 horas.
