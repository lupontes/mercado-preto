# Checklist — Melhor Envio em produção

**Data:** 2026-10-22 · **Estado atual:** servidor de teste no sandbox, etiquetas e
rastreio validados ponta a ponta (pedidos #46 e #47, `delivered` em 21/10).

## Decisões

| Decisão | Motivo |
|---|---|
| Uma conta única do Mercado Preto, com o CNPJ da plataforma, paga todas as etiquetas | A lojista não escolhe transportadora nem paga etiqueta |
| O comprador paga o frete cotado no checkout; a plataforma absorve a diferença para o preço da etiqueta | O comprador já pagou e não é cobrado de novo (decisão do usuário, 22/10) |
| Produção começa com token pessoal + rastreio por consulta a cada 2 h | Funciona sem OAuth; o OAuth só traz o webhook (status na hora). Sem data de produção, fica para um ciclo próprio |

## Atenção: a virada é geral

O Melhor Envio não tem chave própria de sandbox. `MARKETPLACE_SANDBOX=false` vira
**tudo junto**:

- Melhor Envio passa a usar `melhorenvio.com.br` (cotação e etiquetas). O token
  do sandbox deixa de funcionar ali.
- Mercado Pago real: o backend não sobe com token `TEST-` em produção.
- Focus NFe: `FOCUS_NFE_SANDBOX` precisa ir para `false` junto, ou o backend não
  sobe.
- E-mails e WhatsApp vão para os destinatários reais, e não mais para o Ailton.
- O pagamento "Dinheiro (teste)" é bloqueado (`TEST_CASH_PAYMENT_ENABLED` derruba
  o boot).

Por isso, a conta real do Melhor Envio só entra no dia da virada de produção.

## 1. Conta

- [ ] Criar a conta no Melhor Envio com o CNPJ do Mercado Preto.
- [ ] Definir quem recarrega o saldo da carteira e qual saldo mínimo manter.
      Sem saldo, a compra da etiqueta vai para `failed` e chega um alerta em
      `ADMIN_ALERT_EMAIL`. O botão "Comprar etiqueta de novo" do painel master
      retoma a compra.
- [ ] Recarregar o saldo inicial.

## 2. Token

- [ ] Gerar o token pessoal na conta de produção, com acesso a:
      cotação (`/api/v2/me/shipment/calculate`), carrinho (`/me/cart`),
      checkout, geração, impressão, rastreio e cancelamento
      (`/me/shipment/*`).
- [ ] Anotar no painel a data em que o token vence e marcar a renovação na
      agenda. Token vencido derruba a cotação no checkout e a compra das etiquetas.

## 3. Lojas

- [ ] Cada loja com endereço de envio completo no painel master. O frete é
      cotado a partir dele.
- [ ] Cada loja com CPF ou CNPJ cadastrado (`cpfCnpj`). Vai como remetente na
      etiqueta; sem ele, a etiqueta falha com "CPF/CNPJ da loja ausente".
- [ ] Produtos com o tamanho da embalagem preenchido.

## 4. Variáveis do servidor de produção

- [ ] `MELHOR_ENVIO_TOKEN` = token da conta de produção. Gravar sem eco no
      terminal (`read -rsp`), como os outros segredos.
- [ ] `MELHOR_ENVIO_LABELS_ENABLED=true`
- [ ] `ADMIN_ALERT_EMAIL` = e-mail da equipe que acompanha falhas de etiqueta.
- [ ] `MARKETPLACE_SANDBOX=false`, junto com as demais credenciais reais
      (ver "Atenção: a virada é geral").
- [ ] `MELHOR_ENVIO_WEBHOOK_SECRET` fica **vazio**: o webhook responde 503 até o
      ciclo do OAuth. Isso é esperado.

## 5. Primeira etiqueta real

- [ ] Uma compra de valor baixo, de uma loja de confiança.
- [ ] Conferir: a etiqueta foi gerada, o link imprime, o valor foi debitado da
      carteira e o repasse ficou sem o frete.
- [ ] Postar nos Correios e conferir que, em até 2 h depois de cada evento, o
      pedido vai para "Enviado" com o código de rastreio e depois para "Entregue".
- [ ] Comparar o frete pago pelo comprador com o `shipping_label.price` dos
      primeiros pedidos, para ver o tamanho real da diferença absorvida.

## Fica para depois: app OAuth e webhook

Quando a conta de produção existir e a espera de até 2 h incomodar:

- criar o app OAuth na conta do Mercado Preto e trocar o token pessoal pelo
  fluxo OAuth, com renovação automática;
- cadastrar o webhook e preencher `MELHOR_ENVIO_WEBHOOK_SECRET`. A rota
  `api/webhooks/melhor-envio` já valida a assinatura e aplica `order.posted`,
  `order.delivered` e `order.cancelled`;
- manter o job de 2 h como reserva para eventos perdidos.

Esse ciclo segue o fluxo completo: brainstorming, spec, plano e execução.
