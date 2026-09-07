# Sistema de Avaliação de Produtos — Design

**Status**: Aprovado pelo usuário, pronto para plano de implementação.

## Problem

O Mercado Preto não tem nenhum jeito de um comprador avaliar um produto hoje. Isso já é uma lacuna sentida na prática: `subscribers/order-completed-whatsapp.ts:24` **já manda uma mensagem de WhatsApp convidando o comprador a "Avalie sua experiência no nosso site"** — mas não existe nenhuma tela, link ou módulo por trás dessa frase. É uma promessa vazia no fluxo atual.

## Current State (lido do código, 2026-09-07)

- **Não existe conta de comprador no storefront.** `apps/storefront/src/app/` não tem nenhuma rota de login/conta pra quem compra — só `painel/*` (login de vendedor). Checkout é 100% convidado: `email`/CPF são coletados na hora da compra, sem criar usuário.
- **`order.completed` já dispara um subscriber de WhatsApp** (`order-completed-whatsapp.ts`) — mesmo evento é o gancho natural pro convite de avaliação por e-mail.
- **Pedido já vem separado por vendedor.** Desde o design de `2026-08-27-multi-seller-cart-order-split-design.md`, cada pedido tem exatamente um vendedor em `order.metadata.seller_id` — uma avaliação por pedido/produto já resolve o vendedor sem lookup extra.
- **Padrão de retrieve de pedido com itens** (`order-fiscal-emit.ts:14-22`): `orderService.retrieveOrder(orderId, { relations: ["items", "shipping_address"], select: ["total", "metadata", "email"] })` — o `select` é uma whitelist explícita (quirk do Medusa: campo não listado some mesmo existindo na coluna). `order.email` e `order.items` (com `title`, `variant_id`, `unit_price`, `quantity` em cada item) vêm exatamente assim.
- **`order.items` não tem `product_id` direto e confiável.** `modules/fiscal/ncm-resolver.ts:30-39` (`resolveNcmForVariant`) já resolve produto a partir de `item.variant_id`, via `query.graph({ entity: "product_variant", fields: [...], filters: { id: variantId } })` — não de um campo `product_id` no item. Este design segue o mesmo caminho pra obter `product.id`/`product.title`/`product.thumbnail` de cada item avaliável.
- **Padrão de e-mail transacional já existe**: `subscribers/seller-approved-email.ts` tem uma função `sendBrevoEmail(to, subject, htmlContent)` usando `BREVO_API_KEY`, com guarda de sandbox (`TEST_EMAIL_RECIPIENT`) — mesmo padrão de `utils/whatsapp.ts` (`TEST_WHATSAPP_RECIPIENT`). Não existe um `utils/email.ts` compartilhado ainda — a função está inline no subscriber; extraí-la pra `utils/` faz parte deste plano, já que o subscriber novo também precisa dela.
- **Padrão de token assinado já existe**: `utils/seller-jwt.ts` (`createSellerToken`/`verifySellerToken`) — HMAC-SHA256 caseiro, payload com campo `type` discriminador, `exp` em segundos Unix. Este design cria um par equivalente (`utils/review-jwt.ts`) em vez de generalizar o de vendedor — são domínios diferentes (comprador convidado vs. vendedor autenticado), e mexer no `seller-jwt.ts` existente e testado está fora de escopo.
- **Link Medusa `seller-product` já existe** (`links/seller-product.ts`) — não precisa de link novo, já que a avaliação referencia o produto e o vendedor vem do próprio `order.metadata.seller_id`.
- **Painel do vendedor** (`apps/storefront/src/app/painel/`) tem 5 abas hoje (Dashboard, Meus produtos, Pedidos, Comissões, Meu perfil), cada uma com página própria + entrada em `painel/layout.tsx:19-25` (`navItems`). Segue o padrão de `seller-api.ts` (`getSellerCommissions`, sem token, sessão via cookie) pras chamadas — ver o fix de sessão via cookie já completo (`docs/superpowers/plans/2026-08-25-seller-session-cookie.md`).

## Goal

Comprador recebe um e-mail depois que o pedido é concluído, com um link único que leva a uma tela de avaliação (nota 1-5 + comentário opcional) de cada produto daquele pedido — sem precisar criar conta. A avaliação fica pendente até o vendedor aprovar no painel dele; só então aparece na página pública do produto.

## Non-Goals

- **Não avalia o vendedor/loja como um todo** — só o produto. Uma avaliação de loja (atendimento, prazo, embalagem) fica pra um design futuro, se for pedida.
- **Não introduz conta de comprador** — o link assinado por e-mail é a única forma de autenticação pra essa ação, de propósito.
- **Não implementa denúncia/moderação central da plataforma** — a aprovação é sempre do vendedor dono do produto, não de um moderador do Mercado Preto.
- **Não envia lembrete se o comprador não avaliar** — um único e-mail no `order.completed`, sem reenvio automático.
- **Não migra a mensagem de WhatsApp existente** — `order-completed-whatsapp.ts` continua como está; o link real de avaliação vai só por e-mail (um subscriber novo e separado, mesmo padrão de "um subscriber por canal" já usado no repo).

## Design

### Módulo `review`

Novo módulo Medusa (`src/modules/review/`), seguindo a forma de `seller`/`commission`: `index.ts` (`Module()`), `models/review.ts`, `service.ts` (`MedusaService({ Review })`), migração raw-SQL.

```ts
// models/review.ts
const Review = model.define("review", {
  id: model.id().primaryKey(),
  orderId: model.text(),
  productId: model.text(),
  sellerId: model.text(),
  rating: model.number(), // 1-5, validado na rota, não no model
  comment: model.text().nullable(),
  reviewerName: model.text(),
  status: model.enum(["pending", "published", "rejected"]).default("pending"),
})
```

Restrição de unicidade em `(order_id, product_id)` — via índice único na migração, não no `model.define` (Medusa v2 não expõe unique composto na API de model; índice é criado na migração raw-SQL, mesmo padrão dos módulos existentes). Isso é o que impede reavaliar o mesmo item duas vezes, sem precisar rastrear se um convite já foi "usado".

### `utils/review-jwt.ts` — token do link de avaliação

Mesma forma de `seller-jwt.ts`, payload mínimo:

```ts
export type ReviewTokenPayload = {
  orderId: string
  type: "review"
  iat: number
  exp: number
}
```

Validade: 30 dias (`exp: now + 60 * 60 * 24 * 30`) — tempo o bastante pra usar o produto antes de avaliar, sem ficar aberto indefinidamente.

### `utils/email.ts` — extraído de `seller-approved-email.ts`

`sendBrevoEmail(to, subject, htmlContent)` (hoje inline no subscriber) vira uma função compartilhada aqui, com o mesmo guard de sandbox. `seller-approved-email.ts` passa a importar dali em vez de definir a própria cópia — único ponto de mudança nesse subscriber existente, sem alterar comportamento.

### `subscribers/order-review-invite-email.ts` — novo, evento `order.completed`

Busca o pedido (`relations: ["items"]`, `select: ["email", "metadata"]`), gera o token via `createReviewToken(order.id)`, monta o link usando o mesmo padrão já usado em `seller-approved-email.ts:39` (`process.env.STORE_CORS?.split(",")[0] || "http://localhost:3000"` + `/avaliar/{token}`) e envia via `sendBrevoEmail`. Se `order.email` não vier (pedido sem e-mail — não deveria acontecer, mas por segurança), não envia nada, sem erro.

### Rotas backend

- `GET /store/reviews/invite/{token}` — decodifica o token, busca o pedido e seus itens (`relations: ["items"]`), resolve `product.id`/`product.title`/`product.thumbnail` de cada item via `query.graph` a partir do `variant_id` (mesmo padrão de `resolveNcmForVariant`), retorna a lista de produtos avaliáveis daquele pedido e quais já foram avaliados (pra desabilitar na tela, não esconder — feedback claro de "você já avaliou este"). Token inválido/expirado → `400` com mensagem clara.
- `POST /store/reviews` — corpo `{ token, productId, rating, comment? }`. Revalida o token, busca o pedido pra confirmar que `productId` pertence a ele **e pra ler `order.metadata.seller_id` server-side** — `sellerId` nunca vem do corpo da requisição, pelo mesmo motivo de segurança já registrado no design do split de pedido (comprador não pode escolher/adulterar de qual vendedor é a avaliação). Cria o `Review` com `status: "pending"`. Viola a unicidade `(order_id, product_id)` → `409` com mensagem amigável ("Você já avaliou este produto").
- `GET /store/products/{id}/reviews` — lista avaliações `status: "published"` de um produto (paginada), mais a nota média (calculada na consulta, sem campo agregado redundante no model).
- `GET /seller/reviews` — protegida por `sellerAuth` (cookie de sessão, mesmo padrão de `getSellerCommissions`), lista avaliações do vendedor logado por status (default `pending`).
- `PATCH /seller/reviews/{id}` — corpo `{ status: "published" | "rejected" }`, protegida por `sellerAuth`, confere que a avaliação pertence ao vendedor logado antes de atualizar.

### Frontend — tela de avaliação (`/avaliar/[token]`)

Página nova, sem guarda de autenticação (o token na URL é a prova). Busca `GET /store/reviews/invite/{token}` ao montar; renderiza um formulário por produto do pedido (seletor de 1-5 estrelas + textarea opcional); ao enviar cada um, `POST /store/reviews`; produto já avaliado aparece desabilitado com "Avaliado ✓" em vez de sumir da lista.

### Frontend — exibição na página do produto

`apps/storefront/src/app/produto/[handle]/page.tsx` passa a buscar `GET /store/products/{id}/reviews` (chamada separada, não expandida via `fields` em `getProduct` — evita acoplar a listagem de reviews, potencialmente grande, à resposta principal do produto) e renderiza nota média + lista de avaliações publicadas abaixo dos detalhes do produto, com nome mostrado como primeiro nome + inicial do sobrenome (ex: "Maria S.") — derivado de `reviewerName` no momento da exibição, não armazenado truncado.

### Frontend — painel do vendedor, aba "Avaliações"

Nova entrada em `painel/layout.tsx` `navItems` e página `painel/avaliacoes/page.tsx`, seguindo exatamente o padrão de `painel/comissoes/page.tsx` (sem token manual, sessão via cookie — ver Task 7 do fix de sessão já completo). Lista avaliações pendentes com nota, comentário, produto, botões aprovar/rejeitar (`PATCH /seller/reviews/{id}`).

### Testes

- Unitário do `review` module (service, migração).
- `review-jwt.ts` (create/verify, expiração, tipo errado — mesmo roteiro de `seller-jwt.unit.spec.ts`).
- `order-review-invite-email.ts` (dispara e-mail certo; não dispara sem `order.email`; não dispara sem `BREVO_API_KEY`).
- Rotas: submissão feliz, token inválido/expirado, violação de unicidade, aprovação/rejeição só pelo vendedor dono.
- Componente de exibição de avaliações na página do produto (nota média, lista vazia, nome truncado).
- Componente/página `/avaliar/[token]` (lista produtos, marca já avaliado, envia).
