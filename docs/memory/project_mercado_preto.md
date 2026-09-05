---
name: project-mercado-preto
description: "Marketplace Mercado Preto (MAB) — stack, estado atual, o que foi construído e o que falta"
metadata: 
  node_type: memory
  type: project
  originSessionId: 30f361fc-4aab-44fb-a211-ae7efe12e3cd
---

## Mercado Preto — Marketplace da Mulheres de Axé do Brasil (MAB)

Diretório local: `/home/lupontes/repos/marketplace`
Backend: `/home/lupontes/repos/marketplace/packages/medusa-backend/apps/backend`

**Why:** Financiado pela Fundação Banco do Brasil (edital Empoderamento Mulheres Negras). Viabiliza acesso digital de afroemprendedores (artesanato/serviços) sem familiaridade com e-commerce.

**How to apply:** Ao retomar, ler este arquivo antes de qualquer alteração para entender contexto e estado atual.

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Backend | Medusa.js v2 (Node.js 22 + TypeScript) |
| Frontend | Next.js 15 (App Router, Tailwind CSS) — **ainda não criado** |
| Banco | PostgreSQL 16 |
| Cache | Redis 7 |
| Busca | Meilisearch |
| Monorepo | Turborepo + npm |

---

## Credenciais de Desenvolvimento

- **Admin:** `admin@mercadopreto.com.br` / `Admin@123`
- **Seller teste:** `joao@teste.com` / `Senha@123` (seller_id: `01KRT0D8EAB0FVWW8JME9NZP14`)
- **Publishable API Key:** `pk_ae89eadaf95e57f1c0a078d29f3b405e28134dd6cd25fd779befb9bf74c919be`

## Portas Docker (desenvolvimento)

| Serviço | Porta host |
|---------|-----------|
| PostgreSQL | **5433** |
| Redis | **6380** |
| Meilisearch | **7701** |
| Medusa API | **9000** |
| Storefront | **3000** (não criado) |

---

## Como subir o ambiente

```bash
cd /home/lupontes/repos/marketplace/infra && docker compose up -d
cd /home/lupontes/repos/marketplace/packages/medusa-backend/apps/backend
npx medusa develop --port 9000
```

---

## Estado atual do backend (o que está pronto)

### Módulos customizados (`src/modules/`)
- **seller** — cadastro, aprovação, auth JWT, passwordHash, status (pending/approved/active/suspended)
- **commission** — cálculo de comissão (taxa padrão 15%), MarketplaceConfig para persistir taxa no banco
- **payout** — repasses financeiros (pending/processing/completed/failed)
- **fiscal** — NF-e/NFS-e via Focus NFe API com ciclo de vida completo

### Links
- `src/links/seller-product.ts` — defineLink entre seller e product (join table `seller_seller_product_product`)

### Rotas API (`src/api/`)

**Admin (`/admin/...`):**
- `GET/POST /admin/sellers` — listar e criar sellers
- `POST /admin/sellers/:id/approve` — aprovar seller (dispara evento + e-mail Brevo)
- `GET/POST /admin/sellers/:id/products` — produtos de um seller
- `GET/POST /admin/commissions` — comissões
- `GET/POST /admin/payouts` — repasses
- `POST /admin/payouts/:id/process` — marcar repasse como processado
- `GET /admin/fiscal` — documentos fiscais
- `GET /admin/fiscal/:id`
- `POST /admin/fiscal/:id/retry`
- `GET /admin/reports` — relatório financeiro com filtro de período e breakdown por seller
- `GET/PATCH /admin/settings` — taxa de comissão
- `POST /webhooks/clearsale` — webhook antifraude
- `POST /admin/search/reindex` — reindexar tudo no Meilisearch

**Store (`/store/...`):**
- `POST /store/sellers/register` — cadastro público de seller
- `POST /store/sellers/login` — auth JWT do seller
- `POST /store/sellers/set-password` — definir senha (sellers aprovados/ativos)
- `GET /store/sellers` — listagem pública (só ativos)
- `GET /store/sellers/:id` — perfil público do seller
- `GET /store/sellers/:id/products` — produtos do seller
- `GET /store/search` — busca (Meilisearch se configurado, fallback DB)
- `GET /store/sitemap` — sitemap XML dinâmico
- `POST /store/analytics` — proxy Plausible (LGPD)
- `POST /store/webhooks/typebot` — chatbot WhatsApp com FAQ

**Seller portal (`/seller/...`)** (exige JWT Bearer):
- `GET/PATCH /seller/me` — perfil do seller logado
- `GET/POST /seller/products` — listar e criar produtos
- `GET/PATCH/DELETE /seller/products/:id`
- `GET /seller/orders`
- `GET /seller/commissions`
- `GET /seller/dashboard`

### Subscribers (`src/subscribers/`)
- `seller-approved-email` — e-mail Brevo na aprovação
- `order-fiscal-emit` — emite NF-e no `order.payment_captured`
- `order-placed-whatsapp` — WhatsApp na criação do pedido
- `order-shipped-whatsapp` — WhatsApp no envio
- `order-completed-whatsapp` — WhatsApp na entrega
- `product-search-index` — indexa no Meilisearch em `product.created`
- `product-updated-search-index` — reindexo em `product.updated`
- `seller-search-index` — indexa seller em `seller.approved`

### Commits no main
```
ad80588 chore(deps): add package-lock.json
acadaa6 feat(backend): Phase 4 — search, sitemap, chatbot, analytics
63710b8 feat(backend): Phase 3 — fiscal, WhatsApp, reports, antifraude
4e18847 feat(backend): Phase 2 — seller portal, product links, payouts
3bcd33f feat(backend): seller, commission, mercadopago modules
bcfcaf0 fix(infra): remap docker ports
```

---

## O que FALTA (por prioridade)

1. **Subscriber de comissão** — `order.payment_captured` deve chamar `commissionService.recordAndCreate()`. Sem isso, nenhuma comissão é registrada. Bug silencioso crítico.
2. **Storefront Next.js** — vitrine pública (home, catálogo, produto, seller, carrinho, checkout). Bloqueador principal.
3. **Portal do vendedor (frontend)** — UI para as artesãs gerenciarem produtos e pedidos.
4. **Melhor Envio** — cálculo de frete e etiqueta no checkout.
5. **Checkout split MercadoPago** — fluxo real de pagamento com repasse automático.
6. **Testes** — nenhum teste escrito ainda.
7. **CI/CD** — GitHub Actions pipeline.
8. **Chatwoot** — só Docker Compose, sem código.

---

## Variáveis de ambiente (`.env`)

```bash
# Obrigatórias
DATABASE_URL=postgresql://...
JWT_SECRET=...
COOKIE_SECRET=...
STORE_CORS=http://localhost:3000
ADMIN_CORS=http://localhost:9000

# Pagamentos
MERCADOPAGO_ACCESS_TOKEN=...

# Fiscal
FOCUS_NFE_TOKEN=...
FOCUS_NFE_SANDBOX=true   # false em produção
FOCUS_NFE_CNPJ=...
FOCUS_NFE_IE=...
FOCUS_NFE_ADDRESS_STREET/NUMBER/DISTRICT/CITY/STATE/ZIP=...

# E-mail
BREVO_API_KEY=...
EMAIL_FROM=noreply@mercadopreto.com.br

# WhatsApp
EVOLUTION_API_URL=...
EVOLUTION_API_KEY=...
EVOLUTION_API_INSTANCE=...
EVOLUTION_WEBHOOK_SECRET=...   # opcional

# Busca
MEILISEARCH_HOST=http://localhost:7701
MEILISEARCH_API_KEY=...

# Antifraude
CLEARSALE_WEBHOOK_SECRET=...   # opcional

# Analytics
PLAUSIBLE_URL=...
PLAUSIBLE_DOMAIN=mercadopreto.com.br

# Comissão
MARKETPLACE_COMMISSION_RATE=15  # fallback, banco tem precedência
```
