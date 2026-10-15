# Frete por Loja (Ciclo 2 da Logística) — Design

**Status**: Aprovado pelo usuário (spec escrito revisado em 15/10/2026), pronto para plano de implementação.

Substitui o levantamento `2026-08-27-frete-segmentado-por-loja-scope.md`.

## Contexto

A logística do marketplace foi dividida em três ciclos:

1. **Status "Aguardando envio"**: entregue no PR #51.
2. **Frete por loja**: este documento.
3. **Etiquetas por loja**: compra da etiqueta no Melhor Envio, PDF para o lojista via WhatsApp/painel, status automático por rastreio, repasse sem frete.

Premissas de produto vindas das conversas de 15/10/2026:

- A maioria dos lojistas tem pouca familiaridade com vendas online, e para muitos esta é a primeira experiência.
  - A plataforma gerencia a logística.
  - O lojista não escolhe transportadora nem paga etiqueta.
  - Deve-se partir do princípio de que todo lojista tem impressora.
- Uma única conta Melhor Envio da plataforma compra todas as etiquetas.
  - Validado no sandbox em 15/10: uma compra com 3 remetentes diferentes (Cachoeira/BA, Salvador/BA, Recife/PE) gerou 3 etiquetas com DC-e emitida automaticamente.
  - Em produção, a plataforma deve ser cadastrada como **aplicativo** no Melhor Envio. O token pessoal é aceito só no ambiente de teste.
- Toda loja tem um endereço próprio de **base operacional**, inclusive a loja oficial do Mercado Preto.
  - A loja oficial hoje fica em Cachoeira, mas pode mudar.
  - O endereço institucional do marketplace (sede da MAB) é outro dado e **não** entra no frete.

## Estado atual (lido do código, 15/10/2026)

- **Cotação:** `api/store/shipping/estimate/route.ts` faz uma única cotação Melhor Envio por carrinho.
  - Origem fixa: `MELHOR_ENVIO_ORIGIN_CEP`.
  - Pacote fixo: 1 kg, 15×10×20.
  - Sem token, devolve tarifas falsas.
  - Só o checkout usa essa rota (`apps/storefront/src/app/checkout/shipping-rates.ts`).
- **Divisão por loja:** `utils/seller-order-groups.ts` rateia o frete entre lojas pelo subtotal de produtos.
- **Seller:** `modules/seller/models/seller.ts` não tem endereço estruturado, apenas `location` (texto livre).
- **Peso e medidas:** 242 das 245 variantes do ambiente de teste têm `weight` (kg) e `length/height/width` (cm), vindos da importação Nuvemshop. Alguns valores estão zerados.
  - 9 variantes passam de 100 cm em algum lado.
  - 47 têm peso cúbico (C×L×A/6000) maior que o real e acima de 5 kg: palha, cipó, crochê.
  - O painel do lojista não tem campos de peso ou medidas.
- **Confiança no navegador:** `checkoutRequestSchema` (`utils/checkout-payload.ts`) aceita `shipping.price` e `items[].price` vindos do navegador sem recalcular.
  - Este design fecha a parte do frete.
  - O preço dos itens fica para uma correção separada e prioritária antes da produção.
- **Repasse:** `modules/commission/service.ts:43` calcula `sellerPayout = netAmount − commissionAmount + shippingAmount`, ou seja, o frete vai para o lojista.
  - **Fora deste ciclo**: muda no ciclo 3 (ver "Decisões adiadas").

## Decisões

| Tema | Decisão |
|---|---|
| Opções para o comprador | Duas: **Econômico** e **Rápido**. |
| Transportadoras | Só Correios: **PAC** = Econômico, **SEDEX** = Rápido. |
| Origem do frete | Endereço da base operacional de cada loja. |
| Loja sem endereço completo | Seus produtos ficam sem frete. O checkout bloqueia o pagamento com mensagem. O endereço é obrigatório no cadastro de loja nova e para aprovar loja no admin. A equipe pode preencher pelo admin. |
| Peso e medidas | Tamanhos **Pequeno / Médio / Grande / Volumoso**. Volumoso exige medidas. Sugestão por categoria. Revisão da equipe. Bloqueio acima dos limites dos Correios. |
| Arquitetura | Serviço de cotação próprio no backend (`utils/shipping-quote.ts`), reutilizado na criação do pagamento. O provedor de fulfillment nativo do Medusa foi descartado: exigiria migrar o checkout para o carrinho nativo. |
| Ambiente de teste | Usa o token do **sandbox** do Melhor Envio. |

## Design

### 1. Dados

#### 1.1 Endereço da loja (`seller`)

- **Campos novos**, todos `nullable` no banco para não quebrar lojas existentes. Migration no módulo `seller`:
  - `addressPostalCode` (8 dígitos)
  - `addressStreet`, `addressNumber`, `addressComplement`, `addressDistrict`
  - `addressCity`, `addressState` (UF)
- `location` continua como texto exibido na vitrine e não entra no frete.
- **`hasShippingOrigin(seller)`** (`utils/seller-address.ts`): retorna verdadeiro só com CEP, rua, número, bairro, cidade e UF preenchidos.
- **Validação no servidor** (zod, compartilhada):
  - CEP com 8 dígitos (aceita máscara e normaliza);
  - UF entre as 27 válidas;
  - rua, número, bairro e cidade não vazios.
  - O backend não consulta o ViaCEP ao salvar.
- **Onde se edita:**
  - **Painel do lojista** (`painel/perfil` + `PUT /seller/me`): seção "Endereço de envio".
    - O CEP preenche rua, bairro, cidade e UF via ViaCEP, no navegador.
    - Enquanto o endereço estiver incompleto, um aviso no layout do painel diz: "Complete seu endereço de envio para que seus produtos possam ser vendidos".
  - **Admin**, página `sellers/[id]`: a mesma seção, editável pela equipe, via rota admin de atualização do seller.
  - **Cadastro de loja nova** (`POST /store/sellers/register` e `POST /admin/sellers`): endereço obrigatório.
  - **Aprovação no admin:** bloqueada sem `hasShippingOrigin`, com 400 "Preencha o endereço de envio antes de aprovar".

#### 1.2 Tamanho da embalagem (produto)

- **Tabela de tamanhos** em `utils/package-size.ts`, um único arquivo e ajustável:

  | Tamanho | Peso | C×L×A |
  |---|---|---|
  | `small` (Pequeno) | 0,3 kg | 16×11×6 cm |
  | `medium` (Médio) | 1 kg | 25×20×10 cm |
  | `large` (Grande) | 3 kg | 40×30×20 cm |
  | `bulky` (Volumoso) | informado | informado |

- **Sugestão por categoria:** mapa categoria → tamanho no mesmo arquivo.
  - Brincos, colares, pulseiras e pingentes → `small`.
  - Bolsas, canecas, chapéus e roupas → `medium`.
  - Cestos, kits de banheiro, luminárias, decoração e sacolões → `bulky`.
  - Categoria sem mapeamento → `medium`.
- **Painel do lojista** (`painel/produtos/novo` e `painel/produtos/[id]`): campo "Tamanho da embalagem".
  - Vem pré-selecionado pela categoria.
  - Em `bulky`, abre campos de comprimento, largura, altura (cm) e peso (kg), com uma ilustração de como medir.
- **Ao salvar** (`POST/PUT /seller/products`):
  - grava `weight/length/width/height` em todas as variantes do produto (campos nativos do Medusa);
  - grava `metadata.package_size` no produto.
- **Revisão:** produto `bulky`, ou cujas medidas foram informadas pelo lojista, recebe `metadata.package_review = "pending"`.
  - Um widget no detalhe do produto no admin mostra as medidas e o botão "Medidas conferidas", que muda para `"approved"`.
  - O produto continua à venda durante a revisão.
- **Limites dos Correios:** a validação do painel recusa lado acima de 100 cm, soma acima de 200 cm ou peso acima de 30 kg.
- **Produtos importados:** mantêm os valores reais. Não recebem `package_size`.

### 2. Cotação: `POST /store/shipping/quote`

- **Entrada:** `{ postalCode, items: [{ variantId, quantity }] }`. Preço, peso, medidas e loja vêm do banco via `query.graph` (variant → product → seller).
- **Núcleo** (`utils/shipping-quote.ts`, função `quoteShipping`), usado pela rota e pela criação do pagamento:
  1. Agrupa os itens por loja.
  2. Classifica as lojas indisponíveis:
     - `missing_address`: loja sem `hasShippingOrigin`;
     - `oversized`: algum item acima dos limites dos Correios.
  3. Para as demais lojas, chama em paralelo `POST /api/v2/me/shipment/calculate` com:
     - `from` = CEP da loja; `to` = CEP do comprador;
     - `products` = itens com peso, medidas, quantidade e `insurance_value` igual ao preço unitário;
     - `services` = PAC e SEDEX (ids do Melhor Envio: 1 e 2, a confirmar na implementação via `/shipment/services`).
     - Variante sem peso ou medidas, ou com valor zerado, usa `medium`.
     - Tempo limite de 8 s por loja.
  4. Por loja, extrai PAC e SEDEX (preço em centavos e prazo em dias). Se nenhum dos dois vier válido, a loja vira `quote_failed`.
  5. Monta as opções:
     - **Econômico** = soma dos PAC; **Rápido** = soma dos SEDEX.
     - Prazo = maior prazo entre as lojas + `SHIPPING_HANDLING_DAYS` (padrão 2 dias úteis).
     - Se o serviço faltar para alguma loja, aquela opção inteira é omitida.
- **Resposta:**
  ```json
  {
    "options": [
      { "tier": "economico", "label": "Econômico", "total": 7410, "deliveryDays": 14,
        "sellers": [{ "sellerId": "...", "sellerName": "...", "service": "PAC",
                      "serviceId": 1, "price": 3679, "deliveryDays": 12 }] },
      { "tier": "rapido", "label": "Rápido", "...": "..." }
    ],
    "unavailableSellers": [{ "sellerId": "...", "sellerName": "...", "reason": "missing_address" }]
  }
  ```
- **Cache** em memória de 10 minutos por loja, chaveado por (CEP de origem, CEP de destino, itens normalizados). Faz o pagamento achar o mesmo valor que o comprador viu.
- **Token e ambiente:**
  - Usa `MELHOR_ENVIO_TOKEN`; a URL base sai de `isSandboxMode()`, como hoje.
  - No servidor de teste: token do sandbox.
  - A cotação falsa só existe com `NODE_ENV=development` e sem token, ou seja, em desenvolvimento local. Em qualquer outro ambiente sem token, as lojas ficam `quote_failed` e o servidor registra no log.
- **Remoções:** `GET /store/shipping/estimate` e `MELHOR_ENVIO_ORIGIN_CEP`.

### 3. Checkout (storefront)

- **Etapa de entrega:** depois do CEP, chama `/store/shipping/quote` e mostra até duas opções (rótulo, valor e "chega em até N dias úteis").
  - Econômico vem pré-selecionado.
  - Carrinho com mais de uma loja mostra: "Seu pedido sai de N lojas e chega em N pacotes separados", com "ver detalhes" listando o frete por loja.
  - Se houver `unavailableSellers`, aparece "Não foi possível calcular o frete para os produtos da loja X. Remova-os do carrinho para continuar." (o texto varia pelo motivo) e o botão de pagar fica desabilitado.
  - `quote_failed` mostra o botão "Tentar novamente".
  - Mudança no carrinho ou no CEP descarta a seleção e cota de novo.
- **`cart-store.ts`:** `selectedShipping` passa a ser `ShippingOption`, com `tier`, `label`, `total`, `deliveryDays` e `sellers`.
  - `total()` continua sendo subtotal + `selectedShipping.total`.
  - Estado persistido no formato antigo (sem `tier`) é descartado ao reidratar.
- **Resumo e sucesso:** mostram "Frete (Econômico)" ou "Frete (Rápido)" com o valor único.

### 4. Pagamento e pedidos

- **`checkoutRequestSchema`:** `shipping` passa a ser `{ tier: "economico" | "rapido", expectedTotal: number }`.
  - O navegador não envia mais o preço por serviço.
  - O schema é compartilhado pelo `/store/checkout/preference` e pelo `sandbox-cash`.
- **No servidor:** `quoteShipping` roda de novo com os itens e o CEP do endereço.
  - Opção indisponível ou loja indisponível → **422**, com `unavailableSellers` e a mesma mensagem do checkout.
  - Total da opção diferente de `expectedTotal` → **409** `{ error: "O valor do frete foi atualizado", quote }`. O checkout mostra o novo valor e pede nova confirmação.
  - Caso contrário, a preferência do Mercado Pago recebe o item "Frete — Econômico" (ou "— Rápido") com o total calculado pelo servidor.
- **Snapshot e grupos:** `groupItemsBySeller` passa a receber o frete por loja em vez de ratear. Cada `SellerGroup` ganha:
  - `shippingShare` = preço real da loja;
  - `shipping: { tier, service, serviceId, price, deliveryDays }`.
  - O rateio proporcional antigo continua como caminho legado, para snapshots criados antes da mudança.
- **Pedidos** (`createOrdersFromCheckout`):
  - `shipping_methods: [{ name: "Correios PAC", amount: price }]`, com nome e valor reais da loja;
  - metadados `shipping_tier` e `shipping_service_id`, que o ciclo 3 usa para comprar a etiqueta exata.
- **Comissão:** sem mudança. Ela já incide só sobre produtos (`subscribers/commission-on-payment.ts`).

### 5. Erros

| Situação | Comportamento |
|---|---|
| Melhor Envio fora do ar ou acima de 8 s | Loja `quote_failed`. O checkout mostra "Não foi possível calcular o frete agora" e "Tentar novamente". Nunca inventa preço. |
| CEP do comprador inválido ou sem atendimento | 400 com mensagem na etapa de entrega. |
| Token inválido ou expirado | Log de erro no servidor e `quote_failed` para o comprador. |
| Frete mudou entre a cotação e o pagamento | 409 com a nova cotação. |
| Loja sem endereço ou produto fora dos limites | Bloqueio no checkout (quote) e 422 no pagamento. |

## Decisões adiadas (ciclo 3)

- **Repasse sem frete:** pedidos com `shipping_service_id` (etiqueta comprada pela plataforma) deixam de somar `shippingAmount` em `sellerPayout`, e o frete fica com a plataforma para pagar a etiqueta. Pedidos antigos não mudam. Entra junto com a compra de etiquetas.
- Compra e geração da etiqueta, envio do PDF por WhatsApp, webhooks de rastreio (`order.posted`/`order.delivered` → `shipped`/`delivered`), prazo de postagem e lembretes.
- Cadastro da plataforma como aplicativo Melhor Envio (OAuth) para produção.
- Saldo de reserva na carteira Melhor Envio. Regra para diferença de preço entre a cotação e a compra da etiqueta.

## Fora de escopo

- Recalcular no servidor o **preço dos itens** (correção de segurança separada e prioritária antes da produção).
- Outras transportadoras além dos Correios.
- Frete grátis, cupons de frete.
- Correção do executor `pnpm test:admin` (vitest 4 × vite 5), em chore separado. Até lá, os testes do admin rodam com o vitest da storefront.

**Próximos passos logo após este ciclo**, por decisão do usuário: os dois primeiros itens acima, cada um no seu próprio ciclo curto.

## Dados a preparar antes de publicar (servidor de teste)

O usuário autorizou dados **temporários**, por se tratar de ambiente de teste:

- Endereço da loja oficial: endereço provisório em Cachoeira/BA, a partir do texto atual de `location` ("Rua Sete de Setembro, Centro Histórico, CEP 44300-000"). O endereço definitivo será informado antes da produção.
- As 9 variantes acima de 100 cm recebem medidas provisórias dentro dos limites dos Correios, com `package_review = "pending"` para revisão futura.
- `MELHOR_ENVIO_TOKEN` do sandbox em `infra/.env.oci`.

## Testes

Escritos antes do código (TDD).

- **Backend (jest unit):**
  - `quoteShipping`:
    - agrupamento e montagem de Econômico e Rápido;
    - soma, prazo máximo + manuseio, opção omitida;
    - `missing_address`, `oversized` e `quote_failed`, incluindo o tempo limite;
    - fallback `medium` e cache.
  - Rota `/store/shipping/quote`: validação de entrada e resposta.
  - Preferência e `sandbox-cash`: recálculo, 409, 422, novo `shippingShare` e `shipping` no grupo, metadados do pedido e caminho legado do snapshot antigo.
  - Seller:
    - validação de endereço e `hasShippingOrigin`;
    - registro exige endereço;
    - aprovação bloqueada sem endereço;
    - `PUT /seller/me` com endereço.
  - Produto: gravação do tamanho nas variantes, sugestão por categoria, `package_review` e limites dos Correios.
- **Storefront (vitest):**
  - etapa de entrega: opções, nota de vários pacotes, bloqueio e nova cotação;
  - descarte do estado antigo do carrinho;
  - preenchimento por CEP no perfil;
  - aviso de endereço incompleto.
- **Admin (vitest):** seção de endereço do seller e widget de revisão de medidas.
- **Servidor de teste**, feito pelo assistente com o sandbox real do Melhor Envio:
  - cotação com carrinho de 2 lojas;
  - compra aprovada no sandbox do Mercado Pago, com os pedidos tendo o frete real de cada loja e `shipping_service_id` gravado;
  - bloqueio da loja sem endereço.
