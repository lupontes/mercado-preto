# Integração com Mercado Livre (conta única, vendedor de registro) — Design

**Status**: Aprovado pelo usuário, pronto para plano de implementação. **Pré-requisito não-técnico: validação jurídica/contábil do modelo antes de qualquer publicação real de produto ou processamento de pagamento real.**

## Problem

O Mercado Preto quer alcançar mais compradores vendendo os produtos dos seus artesãos também em marketplaces maiores (Mercado Livre, e futuramente outros). A missão da plataforma é atender lojistas artesãos e trabalhadores do campo que, em grande parte, **trabalham na informalidade e não têm CNPJ** — isso restringe fortemente as opções de integração, porque a maioria dos padrões de mercado (hubs como Anymarket, Bling, Olist) e as próprias políticas do Mercado Livre pressupõem que cada vendedor tenha sua própria conta, vinculada ao próprio CPF/CNPJ.

## Pesquisa de mercado (2026-09-04)

- **Mercado Livre proíbe uma pessoa/empresa manter mais de um cadastro**, e uma conta compartilhada entre CNPJs diferentes é motivo de suspensão — cada venda emite NF-e no CNPJ real do titular da conta. Isso descarta o modelo "cada vendedor com conta própria" pra essa base de vendedores (informal, sem CNPJ, sem capacidade de manter uma conta ML sozinho).
- **Revenda de produtos de terceiros é um modelo de negócio explicitamente reconhecido e permitido pelo Mercado Livre** — "vender produtos de terceiros... você vende produtos de outras pessoas ou empresas" é descrito como uso legítimo, sem exigir que o vendedor seja o fabricante. Artesanato é uma categoria explicitamente permitida e em crescimento na plataforma. Não foi encontrada nenhuma restrição contra uma empresa única revender produtos curados de vários produtores sob a própria conta.
- Ferramentas de mercado (Anymarket, Bling, LojaHub, PluggTo) confirmam o padrão do setor: conexão OAuth por conta/canal, com uma camada central de gestão — nunca uma conta de marketplace compartilhada entre CNPJs de terceiros não relacionados. O modelo aqui proposto (uma empresa, um CNPJ, revendendo produtos de uma rede de fornecedores) é diferente disso e está dentro do uso legítimo descrito pelo próprio ML.

## Precedente já existente no código (achado 2026-09-04)

O Mercado Preto **já resolve exatamente esse problema hoje**, na própria loja: toda nota fiscal emitida pela plataforma (`packages/medusa-backend/apps/backend/src/modules/fiscal/`) sai sob **um único CNPJ** (`FOCUS_NFE_CNPJ`, cadastrado como "Mercado Preto — Mulheres de Axé do Brasil"), não importa qual vendedor fez a venda. O campo `cpfCnpj` do vendedor (`modules/seller/models/seller.ts`) aceita CPF (mínimo 11 dígitos, CNPJ nunca é exigido) e **não é usado em nenhum lugar da nota fiscal** — serve só de registro interno (`nf_document.sellerId`).

Ou seja: o modelo "CNPJ único intermediando tudo" já está em produção, só nunca foi documentado ou validado juridicamente como decisão deliberada — é um fato emergente do código, construído sem uma spec ou registro do racional legal (comissão mercantil? consignação? intermediação de marketplace?). **Este design estende o mesmo modelo pro Mercado Livre — não introduz um risco novo, mas aposta mais volume de negócio numa estrutura que nunca foi confirmada com contador/advogado.**

## Goal

Produtos aprovados e curados dos vendedores do Mercado Preto passam a ser vendidos também no Mercado Livre, através de **uma única conta ML de propriedade do Mercado Preto** (vendedor de registro), com os pedidos entrando no mesmo pipeline de comissão/repasse/NF-e que já existe hoje pro checkout próprio.

## Non-Goals (nesta primeira versão)

- **Mapeamento automático de categoria/atributo do ML** — é manual, feito uma vez por produto por um admin, na hora de aprovar a publicação. O ML exige atributos obrigatórios rígidos e variáveis por categoria; automatizar isso pra produtos artesanais heterogêneos é complexidade prematura.
- **Produtos com variantes complexas** (cor/tamanho/etc.) — só produtos de variante única no início.
- **Sincronização automática de preço pós-publicação** — se o preço mudar no Mercado Preto, precisa republicar manualmente no ML (v1).
- **Outros canais** (Amazon, Shopee, TikTok Shop) — só Mercado Livre nesta fase. A arquitetura (módulo `marketplace-channel`, evento `marketplace.order_placed` com `channel` no metadata) deixa espaço pra outros canais depois, mas não constrói uma abstração multi-canal genérica agora (YAGNI) — isso só se justifica quando um segundo canal for real.
- **Devolução/reembolso automatizado via ML** — tratado manualmente pelo admin.
- **Frete próprio** (Melhor Envio) pra pedidos vindos do ML — só Mercado Envios nesta fase.
- **Sincronização de estoque em tempo real** — o primeiro corte aceita risco de overselling ocasional (raro, dado o volume inicial esperado); reconciliação manual ou por job periódico simples, não push instantâneo bidirecional.

### Pendências de adaptação registradas para fases futuras

| Item | Por que ficou de fora agora | Quando revisitar |
|---|---|---|
| Mapeamento automático de categoria/atributo | ML exige atributos obrigatórios por categoria, difíceis de generalizar pra artesanato heterogêneo | Depois que houver volume suficiente de produtos publicados pra justificar um motor de regras |
| Suporte a variantes (cor/tamanho) | Aumenta a superfície de atributos obrigatórios do ML por anúncio | Quando o catálogo de produtos com variantes for relevante o suficiente |
| Sincronização de preço em tempo real | Exige um listener de mudança de preço + rate limit da API do ML | Quando o volume de produtos publicados tornar a republicação manual inviável |
| Outros canais (Amazon, Shopee, TikTok Shop) | Cada canal tem sua própria política de conta/CNPJ e API — precisa da mesma validação jurídica feita aqui, uma por vez | Depois que o Mercado Livre estiver estável em produção |
| Sincronização de estoque em tempo real | Complexidade de webhook bidirecional + rate limit, não crítica no volume inicial | Se overselling via ML começar a acontecer na prática |
| Reembolso/devolução automatizado | Fluxo de exceção, menor volume, tratável manualmente no início | Quando o volume de devoluções via ML justificar automação |

## Design

### Precedente e reuso: por que isso é uma extensão, não um subsistema paralelo

A decisão mais importante deste design é **não duplicar** a lógica de pedido/comissão/NF-e/notificação já construída pro split multi-vendedor (`webhooks/mercadopago/route.ts`, `commission-on-payment.ts`, `order-fiscal-emit.ts`, `order-placed-whatsapp.ts`). Um pedido vindo do Mercado Livre é, pro resto do sistema, **um pedido igual a qualquer outro** — a única coisa que muda é de onde ele nasce.

### Novo módulo `marketplace-channel`

Segue o padrão já estabelecido pelos módulos `commission`, `fiscal`, `payout`, `checkout` (cada um com `index.ts`, `models/`, `service.ts`, `migrations/`).

**Model `channel-listing`** (um registro por produto publicado num canal):

| Campo | Tipo | Observação |
|---|---|---|
| `id` | string (PK) | |
| `productId` | string | Produto do Mercado Preto |
| `sellerId` | string | Vendedor real (dono do produto) |
| `channel` | enum (`mercado_livre`) | Preparado pra outros valores no futuro, sem generalizar a lógica agora |
| `externalItemId` | string, nullable | `ml_item_id` — ID do anúncio no ML, preenchido após publicação |
| `externalCategoryId` | string, nullable | Categoria ML escolhida pelo admin |
| `status` | enum (`draft`, `published`, `paused`, `error`) | |
| `lastError` | text, nullable | Mensagem de erro da última tentativa de publicação, se houver |

**Model `channel-credential`** (um registro por conexão de canal — só 1 linha pro Mercado Livre nesta fase, mas já modelado como coleção pra não precisar migrar quando um segundo canal existir):

| Campo | Tipo | Observação |
|---|---|---|
| `channel` | enum (`mercado_livre`) | |
| `accessToken` | text | Criptografado em repouso (mesma prática já usada pra outros segredos do projeto) |
| `refreshToken` | text | |
| `expiresAt` | timestamp | Usado por um job de renovação automática (API do ML usa OAuth2, token de acesso expira em poucas horas) |

### Fluxo de publicação (`POST /admin/marketplace-channel/products/:id/publish`)

1. Admin escolhe a categoria ML pro produto (busca via `GET /categories` da API do ML) e preenche os atributos obrigatórios daquela categoria (formulário dinâmico a partir de `GET /categories/:id/attributes`).
2. Sistema chama `POST /items` da API do ML com os dados do produto (título, descrição, preço, fotos, atributos, `shipping.mode: "me2"` pra usar Mercado Envios).
3. Grava `externalItemId` e `status: "published"` em `channel-listing`; em caso de erro da API do ML, grava `status: "error"` e `lastError`, sem derrubar a requisição do admin (resposta 200 com o erro no corpo, seguindo o padrão já usado em `preference/route.ts` pra erros de terceiro).

### Fluxo de pedido (`webhooks/mercadolivre/route.ts`)

O ML notifica por **topics** (formato diferente do MercadoPago: o webhook manda só um aviso de que um recurso mudou, não o payload completo — é preciso buscar o recurso de volta na API).

1. Recebe a notificação, valida a assinatura conforme a documentação de webhooks do ML (mecanismo próprio, não reaproveita a verificação HMAC do MercadoPago).
2. Busca o pedido completo via `GET /orders/:id`.
3. Pra cada item do pedido, resolve o `channel-listing` correspondente pelo `externalItemId` → obtém `productId` e `sellerId` reais.
4. Cria o pedido via `orderService.createOrders()` (mesmo utilitário já usado no webhook do MercadoPago), com `metadata: { channel: "mercado_livre", seller_id, mercadolivre_order_id, buyer_document }`.
5. Emite `marketplace.order_placed` (evento novo, genérico por canal) em vez de `mercadopago.order_approved`.

### Subscribers existentes passam a escutar dois eventos

`commission-on-payment.ts`, `order-fiscal-emit.ts` e `order-placed-whatsapp.ts` passam a ter `config.event: ["mercadopago.order_approved", "marketplace.order_placed"]` (Medusa aceita array de eventos por subscriber) — a lógica interna de cada um não muda, porque já opera inteiramente a partir de `order.metadata` e dos itens/frete carregados via `relations`, sem nenhuma suposição sobre a origem do pedido.

**Única adaptação real:** `commission-on-payment.ts` precisa somar a **taxa de venda do próprio Mercado Livre** (percentual + valor fixo, variável por categoria) ao cálculo de `bankingFees` — mesmo padrão já usado pra taxa do MercadoPago (`BANKING_FEE_PERCENT`/`BANKING_FEE_FIXED`), só que com uma tabela de taxas por categoria do ML em vez de uma constante única, já que o ML cobra percentuais diferentes por categoria de produto.

### Frete

O anúncio nasce configurado com `shipping.mode: "me2"` (Mercado Envios) — o ML controla a logística. O vendedor real vê o pedido no próprio painel (`/painel/pedidos`) como qualquer outro pedido pendente, com um link pra baixar a etiqueta de postagem gerada pelo ML (`GET /shipments/:id/labels`) — ele não precisa acessar a conta ML do Mercado Preto em nenhum momento, só levar o pacote etiquetado até o ponto de postagem.

### Renovação de token

Job periódico (mesmo padrão de scripts já usado no projeto, `src/scripts/`) roda a cada poucas horas, verifica `expiresAt` de `channel-credential` e renova via `POST /oauth/token` com `grant_type: refresh_token` antes de expirar — nenhuma parte do fluxo de publicação/pedido depende de renovação just-in-time, pra não falhar publicações por token expirado no meio de uma operação.

## Testing

Mesmo padrão de TDD já usado no projeto: cliente HTTP do ML isolado num arquivo próprio (`ml-client.ts`, testável com mocks, mesmo padrão do SDK do MercadoPago), lógica de resolução de `channel-listing` → pedido testada sem dependência de rede, e os subscribers existentes ganham novos casos de teste confirmando que reagem a `marketplace.order_placed` da mesma forma que já reagem a `mercadopago.order_approved` (grossAmount, taxa por categoria, NF-e, WhatsApp).
