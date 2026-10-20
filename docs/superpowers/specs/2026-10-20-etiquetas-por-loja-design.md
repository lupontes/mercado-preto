# Etiquetas por Loja (Ciclo 3 da Logística) — Design

**Status**: Rascunho para revisão do usuário. O usuário pediu (20/10/2026) para
pular as perguntas e partir da spec de 15/10. As decisões marcadas
**[decisão do assistente]** não foram discutidas e devem ser conferidas na
revisão.

Continua `2026-10-15-frete-por-loja-design.md` (ciclos 1 e 2, entregues).

## Intenção

Hoje um carrinho com produtos de duas lojas já vira um pedido por loja, cada
um com o frete real cotado no Melhor Envio (PAC ou SEDEX). Depois do
pagamento, porém, a lojista ainda precisa se virar para despachar.

A premissa de produto de 15/10 continua valendo: a maioria das lojistas tem
pouca experiência com vendas online. A plataforma cuida da logística, a
lojista não escolhe transportadora nem paga etiqueta, e toda lojista tem
impressora.

Este ciclo fecha o caminho do pagamento até a entrega:

1. o pagamento é aprovado e os pedidos por loja são criados;
2. a plataforma compra uma etiqueta por pedido, na conta Melhor Envio dela;
3. cada lojista recebe a sua etiqueta, imprime, cola na caixa e posta nos
   Correios;
4. o status do pedido muda sozinho para "Enviado" e depois "Entregue", e o
   comprador é avisado.

**Sucesso:** o Ailton (teste) compra com duas lojas no carrinho, cada lojista
recebe no WhatsApp e no portal a etiqueta da sua parte, e ninguém precisa
abrir o Melhor Envio.

## Objetivos

- Comprar automaticamente, depois do pagamento aprovado, a etiqueta de cada
  pedido de loja, com o serviço que o comprador escolheu.
- Entregar a etiqueta à lojista pelo WhatsApp e pelo portal do vendedor.
- Atualizar `shipping_status` sozinho a partir do rastreio.
- Tirar o frete do repasse quando a plataforma paga a etiqueta.
- Dar à equipe, no painel master, visão e ação sobre etiquetas com problema.

## Não-objetivos

- Outras transportadoras além dos Correios.
- Coleta em domicílio, reversa ou troca.
- Envios comerciais com nota fiscal (NF-e). Os envios saem com Declaração de
  Conteúdo (DC-e), como validado no sandbox em 15/10.
- O cadastro da plataforma como **aplicativo OAuth** no Melhor Envio para
  produção. Fica para um ciclo curto logo depois deste (ver "Próximos ciclos").

## Anti-objetivos

- A lojista nunca deve precisar entrar no Melhor Envio, escolher serviço ou
  pagar algo.
- Uma falha na compra da etiqueta nunca pode desfazer o pedido nem o pagamento
  do comprador. O pedido continua válido e a equipe resolve a etiqueta.
- Nenhum segredo (token, link privado) vai para log, WhatsApp ou URL pública
  sem assinatura e validade.

## Restrições (do Melhor Envio, conferidas em 20/10/2026)

- Fluxo da API: inserir no carrinho (`POST /api/v2/me/cart`) → comprar com o
  saldo da carteira (`/me/shipment/checkout`) → gerar (`/me/shipment/generate`)
  → imprimir (`/me/shipment/print`). O id devolvido pelo carrinho identifica a
  etiqueta em todas as etapas.
- Desde 06/04/2026, `products` é **obrigatório** no carrinho, por causa da
  DC-e na SEFAZ. Também são obrigatórios os documentos do remetente e do
  destinatário.
- A etiqueta vale **20 dias** depois de gerada.
- O link de impressão é privado por padrão. `mode: "public"` gera um link
  público.
- **Webhooks só valem para etiquetas criadas pelo mesmo aplicativo OAuth.** O
  servidor de teste usa token pessoal do sandbox, então **não recebe
  webhook**. O rastreio precisa funcionar por consulta periódica.
- Os caminhos exatos e os campos de cada rota devem ser conferidos na
  referência oficial (`docs.melhorenvio.com.br/reference`) e no sandbox
  durante a implementação.

## Estado atual (lido do código, 20/10/2026)

- `utils/create-orders-from-checkout.ts` cria um pedido por loja com
  `metadata.shipping_status = "awaiting_shipment"`, `shipping_tier` e
  `shipping_service_id`, que existem justamente para este ciclo.
- `utils/shipping-status.ts`: `awaiting_shipment | shipped | delivered`. Hoje
  nada muda o status depois da criação. O widget do admin só exibe.
- `subscribers/order-shipped-whatsapp.ts` avisa o comprador no evento
  `order.shipment_created`, com código de rastreio opcional. Hoje nada emite
  esse evento.
- `modules/commission/service.ts`:
  `sellerPayout = netAmount − commissionAmount + shippingAmount`.
- `seller` tem `phone`, `email`, `cpfCnpj` e o endereço estruturado completo.
- **O checkout não coleta número nem bairro do comprador.** `address1` é um
  campo livre (ex.: "Avenida Paulista, 1000"). A etiqueta dos Correios precisa
  dos dois separados.
- `utils/melhor-envio.ts` só tem a cotação (`/me/shipment/calculate`).

## Design

### 1. Endereço do comprador

- O checkout ganha os campos obrigatórios **Número** e **Bairro**, ao lado de
  Endereço (rua). O ViaCEP já preenche rua, cidade e UF, e passa a preencher o
  bairro. **[decisão do assistente]**
- `checkoutRequestSchema.address` ganha `number` e `district` obrigatórios.
  O pedido grava `shipping_address.address_1` = rua, mais `metadata.address_number` e
  `metadata.address_district` (o `shipping_address` do Medusa não tem esses
  campos). O builder pode escolher outro lugar, desde que a etiqueta leia de
  um só ponto.
- Pedidos antigos sem número e bairro não recebem etiqueta automática (ver
  item 5, "falha").

### 2. Compra da etiqueta

- **Gatilho:** um subscriber em `mercadopago.order_approved`, o mesmo evento
  em que a comissão é calculada, para cada pedido de loja com
  `shipping_service_id` e `platform_label`. Pedidos do Mercado Livre
  (`marketplace.order_placed`) não têm `shipping_service_id` e ficam de fora.
  Pedidos do "Dinheiro (teste)" também ficam de fora. **[decisão do
  assistente]**
- **Liga/desliga por ambiente:** `MELHOR_ENVIO_LABELS_ENABLED=true`. Desligado,
  nada muda em relação a hoje. **[decisão do assistente]**
- **Carrinho:** `from` = endereço e documento da loja; `to` = endereço,
  telefone, e-mail e CPF/CNPJ do comprador (`metadata.buyer_document`);
  `service` = `shipping_service_id`; `products` = itens do pedido (nome,
  quantidade e valor unitário); `volumes` = medidas do pacote;
  `options.insurance_value` = soma dos itens; `options.non_commercial = true`;
  `options.tags` com o `display_id` do pedido.
  - **Volumes:** a cotação do Melhor Envio devolve como os itens são
    empacotados. O builder deve reproduzir a mesma montagem na compra (de
    preferência cotando de novo com os mesmos produtos e usando o pacote
    devolvido), para não comprar etiqueta de caixa diferente da cotada. Se
    vier mais de um pacote, são várias etiquetas no mesmo pedido.
- **Compra, geração e link:** checkout, generate e print em seguida, guardando
  o resultado em `order.metadata.shipping_label`:
  `{ status, me_order_ids, price, tracking_code?, generated_at, error? }`.
  `status`: `pending | purchased | generated | failed | canceled`.
- **Idempotência:** se o pedido já tem `shipping_label` com status diferente
  de `failed`, o subscriber não compra de novo. Eventos repetidos não podem
  gerar duas etiquetas pagas.
- **Diferença de preço:** se a etiqueta custar diferente do frete que o
  comprador pagou, **a plataforma absorve a diferença** e o valor real fica
  em `shipping_label.price`, para relatório. O comprador já pagou e não é
  cobrado de novo. **[decisão do assistente]**
- **Saldo da carteira:** a compra usa o saldo da conta Melhor Envio da
  plataforma. Sem saldo, a etiqueta vai para `failed` com o motivo, e a equipe
  é avisada (item 5).

### 3. Entrega da etiqueta à lojista

- **Link próprio e assinado:** `GET /labels/:token`. O token é assinado
  (JWT com o segredo do backend) e leva o id do pedido, com validade de 20
  dias, igual à da etiqueta. A rota pede ao Melhor Envio um link de impressão
  novo e redireciona para ele. Assim, o link do WhatsApp funciona sem login e
  sem expor o link do Melhor Envio. **[decisão do assistente]**
- **WhatsApp para a lojista** (`seller.phone`), quando a etiqueta é gerada:
  "Nova venda no Mercado Preto! Pedido #N. Imprima a etiqueta, cole na caixa
  e poste nos Correios até DD/MM: <link>". Em sandbox vai para
  `TEST_WHATSAPP_RECIPIENT`, como hoje.
- **E-mail para a lojista** (`seller.email`), com o mesmo conteúdo, via
  Brevo. **[decisão do assistente]**
- **Portal do vendedor, Pedidos:** cada pedido mostra o status da etiqueta e o
  botão **"Imprimir etiqueta"** (rota autenticada pela sessão da vendedora que
  devolve o mesmo redirecionamento), o código de rastreio e o prazo de
  postagem.

### 4. Rastreio e status

- **Consulta periódica:** um job do Medusa a cada 2 horas consulta o rastreio
  (`/me/shipment/tracking`) dos pedidos com etiqueta gerada e ainda não
  entregues. **[decisão do assistente]**
  - Postado → `shipping_status = "shipped"`, grava `tracking_code` e emite
    `order.shipment_created` com o código. O subscriber existente avisa o
    comprador pelo WhatsApp.
  - Entregue → `shipping_status = "delivered"`.
- **Webhooks** ficam prontos para o ciclo do aplicativo OAuth: a rota
  `POST /webhooks/melhor-envio`, validando `X-ME-Signature` (HMAC-SHA256 do
  corpo com o secret do aplicativo), aplica as mesmas transições. Com
  webhook, o job vira só uma rede de segurança.
- As transições só andam para frente (`awaiting_shipment → shipped →
  delivered`) e nunca reabrem pedido cancelado.

### 5. Prazo, lembretes e falhas

- **Prazo de postagem:** `SHIPPING_HANDLING_DAYS` dias úteis depois da
  geração (hoje 2, o mesmo valor que entra no prazo mostrado ao comprador).
  **[decisão do assistente]**
- **Lembrete:** o mesmo job manda à lojista, uma vez, um WhatsApp no último
  dia do prazo se o pedido ainda não foi postado.
- **Atraso:** passado o prazo sem postagem, o pedido aparece como atrasado no
  painel master. Ninguém cancela nada automaticamente.
- **Falha na compra** (sem saldo, endereço incompleto, erro da API):
  `shipping_label.status = "failed"` com o motivo. O pedido continua
  "Aguardando envio". A equipe recebe um e-mail de alerta
  (`ADMIN_ALERT_EMAIL`, novo) e vê o pedido no painel master.
- **Painel master, detalhe do pedido:** o widget de status de envio passa a
  mostrar a etiqueta (status, preço, rastreio, link) e o botão
  **"Comprar etiqueta de novo"** para `failed`. Esse botão chama a mesma
  rotina idempotente do subscriber.

### 6. Repasse sem frete

- Pedidos criados com etiquetas ligadas recebem `metadata.platform_label =
  true` na criação. **[decisão do assistente]**
- O cálculo da comissão desses pedidos não soma `shippingAmount` em
  `sellerPayout`: o frete fica com a plataforma para pagar a etiqueta.
- Pedidos sem a marca, incluindo os criados entre o ciclo 2 e este, não
  mudam. O critério é a marca, e não `shipping_service_id`, porque a comissão
  é calculada na aprovação do pagamento, antes da compra da etiqueta, e
  pedidos do ciclo 2 já têm `shipping_service_id` sem que a plataforma tenha
  comprado a etiqueta deles.

### 7. Cancelamento

- Hoje não existe rota de cancelamento de pedido no backend (conferido em
  20/10). Por isso o cancelamento da etiqueta é uma **ação manual** no painel
  master: o botão "Cancelar etiqueta", no widget do pedido, para etiqueta
  comprada e ainda não postada. Ele cancela no Melhor Envio (o valor volta
  para a carteira) e grava `shipping_label.status = "canceled"`.
  **[decisão do assistente]**

## Ambiente de teste

- Servidor de teste com o token **sandbox** do Melhor Envio que já está no
  `.env.oci`, a carteira sandbox com saldo fictício e
  `MELHOR_ENVIO_LABELS_ENABLED=true`.
- As mensagens para lojistas vão para o Ailton (sandbox), como as demais.
- Teste de ponta a ponta feito pelo assistente: compra com duas lojas,
  sandbox do Mercado Pago, uma etiqueta por loja, links de impressão, WhatsApp
  e e-mail das lojistas, avanço manual do rastreio no sandbox (se o sandbox
  permitir simular a postagem) e repasse sem frete conferido no banco.

## Testes (escritos antes do código)

- **Backend (jest unit):** montagem do payload do carrinho a partir do pedido
  e da loja (incluindo documentos, `products` e volumes); idempotência;
  `failed` com motivo; token do link (validade e assinatura); transições do
  rastreio; lembrete único; comissão com e sem `platform_label`; validação do
  `X-ME-Signature`.
- **Cliente Melhor Envio:** os testes usam um servidor HTTP falso local, sem
  mock do `fetch`, quando der.
- **Storefront (vitest):** campos Número e Bairro no checkout (obrigatórios,
  bairro preenchido pelo ViaCEP); botão "Imprimir etiqueta" e status no portal.
- **Admin (vitest):** widget com a etiqueta e o botão de nova compra.

## O que fica com o builder

- Os caminhos exatos e campos da API, conferidos na referência e no sandbox.
- Onde guardar número e bairro do comprador (item 1), desde que haja um ponto
  único de leitura.
- Como reproduzir o empacotamento da cotação na compra (item 2).
- O texto final das mensagens.

## Próximos ciclos

1. **Aplicativo OAuth do Melhor Envio para produção:** cadastro do app,
   troca e renovação de token, webhooks ligados. Bloqueia a ida das etiquetas
   para produção.
2. **Relatório de frete:** frete cobrado × etiqueta paga, por período, no
   painel master.
