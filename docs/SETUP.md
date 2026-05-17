# Mercado Preto — Installation & Configuration Guide

This document covers the full environment setup for local development. Update it whenever new integrations or configuration steps are added.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | **22.x** | Managed via nvm. Required for storefront (Tailwind v4 native bindings). Backend tolerates Node 18, but use 22 for consistency. |
| pnpm | **11.1.2** | Do **not** use npm in the monorepo root — it breaks pnpm's lockfile and optional native dependencies. |
| Docker | any recent | Runs PostgreSQL, Redis, and Meilisearch |
| ngrok | any | Required to receive MercadoPago webhooks locally |

### Install nvm & Node 22

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.nvm/nvm.sh
nvm install 22
nvm use 22
```

### Install pnpm

```bash
npm install -g pnpm@11.1.2
```

---

## 1. Clone & Install Dependencies

```bash
git clone <repo-url> marketplace
cd marketplace
source ~/.nvm/nvm.sh && nvm use 22
pnpm install
```

> Never run `npm install` inside `apps/storefront` — it will corrupt the pnpm workspace lockfile.

---

## 2. Start Infrastructure (Docker)

```bash
docker compose -f infra/docker-compose.yml up -d
```

This starts:

| Service | Container | Mapped Port |
|---------|-----------|-------------|
| PostgreSQL 16 | `mercado-preto-db` | `5433` |
| Redis 7 | `mercado-preto-redis` | `6380` |
| Meilisearch v1.13 | `mercado-preto-search` | `7701` |

Verify:
```bash
docker compose -f infra/docker-compose.yml ps
```

---

## 3. Backend Environment — `.env`

File location: `packages/medusa-backend/apps/backend/.env`

Copy `.env.example` (if it exists) or create from scratch. All variables marked **[REQUIRED]** will crash the backend on startup if missing.

### Database & Redis [REQUIRED]

```env
DATABASE_URL=postgres://medusa:medusa@localhost:5433/mercado_preto
REDIS_URL=redis://localhost:6380
```

### Security [REQUIRED in production]

Generate with `openssl rand -hex 32`:

```env
JWT_SECRET=<32-byte hex>
COOKIE_SECRET=<32-byte hex>
```

### CORS [REQUIRED]

```env
STORE_CORS=http://localhost:3000,https://mercadopreto.com.br
ADMIN_CORS=http://localhost:9000,https://admin.mercadopreto.com.br
AUTH_CORS=http://localhost:3000,http://localhost:9000,https://mercadopreto.com.br
```

### MercadoPago [REQUIRED for checkout]

```env
MERCADOPAGO_ACCESS_TOKEN=TEST-<token>     # starts with TEST- in sandbox
BACKEND_URL=https://<ngrok-subdomain>.ngrok-free.dev   # public URL for webhooks
MERCADOPAGO_WEBHOOK_SECRET=<hex string from MP dashboard>
```

See [Section 5 — MercadoPago](#5-mercadopago) for how to obtain these values.

### Melhor Envio [OPTIONAL]

Without this token, the shipping endpoint returns fixed illustrative rates (PAC/SEDEX).

```env
MELHOR_ENVIO_TOKEN=<sandbox JWT>
MELHOR_ENVIO_ORIGIN_CEP=44300000         # ZIP code of the dispatch origin
```

See [Section 6 — Melhor Envio](#6-melhor-envio).

### Brevo — Transactional Email [OPTIONAL]

Without this, emails are silently ignored.

```env
BREVO_API_KEY=xkeysib-<key>
EMAIL_FROM=<verified-sender@domain.com>
```

See [Section 7 — Brevo](#7-brevo).

### Meilisearch [OPTIONAL]

Without this, search falls back to a database query.

```env
MEILISEARCH_HOST=http://localhost:7701
MEILISEARCH_API_KEY=mercadopreto_search_key
```

### Focus NFe — Fiscal Invoicing [OPTIONAL]

```env
FOCUS_NFE_TOKEN=
FOCUS_NFE_SANDBOX=true
FOCUS_NFE_CNPJ=
FOCUS_NFE_IE=
FOCUS_NFE_ADDRESS_STREET=
FOCUS_NFE_ADDRESS_NUMBER=
FOCUS_NFE_ADDRESS_DISTRICT=
FOCUS_NFE_ADDRESS_CITY=Cachoeira
FOCUS_NFE_ADDRESS_STATE=BA
FOCUS_NFE_ADDRESS_ZIP=44300000
```

### Evolution API — WhatsApp Notifications [OPTIONAL]

```env
EVOLUTION_API_URL=
EVOLUTION_API_KEY=
EVOLUTION_API_INSTANCE=
EVOLUTION_WEBHOOK_SECRET=
```

### Other Optional Variables

```env
CLEARSALE_WEBHOOK_SECRET=     # Anti-fraud; leave empty to skip signature validation
PLAUSIBLE_URL=                # Analytics proxy
PLAUSIBLE_DOMAIN=mercadopreto.com.br
MARKETPLACE_COMMISSION_RATE=15   # Default commission %; overridable via PATCH /admin/settings
NODE_ENV=development
```

---

## 4. Storefront Environment — `.env.local`

File location: `apps/storefront/.env.local`

```env
NEXT_PUBLIC_MEDUSA_URL=http://localhost:9000
NEXT_PUBLIC_PUBLISHABLE_KEY=pk_<key>    # From Medusa admin → Settings → API Keys
NEXT_PUBLIC_REGION_ID=reg_<id>          # From Medusa admin → Settings → Regions

# Chatwoot widget (optional — leave empty to disable)
NEXT_PUBLIC_CHATWOOT_URL=
NEXT_PUBLIC_CHATWOOT_TOKEN=
```

To find the publishable key and region ID:
- **Publishable key**: Medusa admin → Settings → API Keys
- **Region ID**: Medusa admin → Settings → Regions → click on "Brasil" (or whichever region) → copy the ID from the URL

---

## 5. MercadoPago

### 5.1 Create a Developer Application

1. Go to https://www.mercadopago.com.br/developers/panel
2. Create a new application (e.g., `marketplace_mab`)
3. Navigate to **Credenciais de teste** (Test Credentials)
4. Copy the **Access Token** that starts with `TEST-` — set it as `MERCADOPAGO_ACCESS_TOKEN`

> Use the `TEST-` token (test credentials), **not** the production `APP_USR-` token during development.

### 5.2 Create Test Users

You need two test accounts: one seller and one buyer.

In the MercadoPago developer panel, navigate to **Usuários de teste** and create:
- A **seller** test user (to simulate receiving payments)
- A **buyer** test user (to simulate making payments)

Keep the buyer's password — you'll need it to log in during manual checkout tests.

### 5.3 Configure ngrok for Webhooks

MercadoPago requires an HTTPS URL to send payment notifications. Use ngrok locally:

```bash
ngrok http 9000
```

Get the current public URL:
```bash
curl -s http://localhost:4040/api/tunnels | python3 -m json.tool | grep public_url
```

> The ngrok URL changes every time you restart ngrok (unless you have a paid plan with a reserved domain). After a restart you must update `BACKEND_URL` in `.env` and re-register the webhook in the MP dashboard.

### 5.4 Register the Webhook

1. Go to https://www.mercadopago.com.br/developers/panel → select your app → **Webhooks**
2. Set the URL to: `https://<ngrok-url>/webhooks/mercadopago`
3. Enable the **Pagamentos** event
4. Copy the **Chave secreta** (webhook secret) → set it as `MERCADOPAGO_WEBHOOK_SECRET`

### 5.5 Test Cards (Sandbox)

| Type | Number | Expiry | CVV | Result |
|------|--------|--------|-----|--------|
| Visa approved | 4509 9535 6623 3704 | any future | 123 | Approved |
| Mastercard approved | 5031 7557 3453 0604 | any future | 123 | Approved |
| Any card rejected | use any invalid | — | — | Rejected |

Use the test buyer's CPF when prompted. For PIX, any approved test payment completes instantly in sandbox.

---

## 6. Melhor Envio

### 6.1 Create an Account

Register at https://melhorenvio.com.br. A sandbox environment is available separately.

### 6.2 Generate a Sandbox Token

1. Log in to https://sandbox.melhorenvio.com.br
2. Navigate to **Tokens de Acesso** → **Gerar Token**
3. Select scope: at minimum **Calcular fretes** (`shipping-calculate`)
4. Copy the JWT and set it as `MELHOR_ENVIO_TOKEN`

Set `MELHOR_ENVIO_ORIGIN_CEP` to the ZIP code of the physical origin of your shipments.

The backend automatically uses the sandbox URL (`https://sandbox.melhorenvio.com.br`) when `NODE_ENV !== production`.

---

## 7. Brevo (Transactional Email)

### 7.1 Create an Account

Register at https://www.brevo.com. The free plan allows 300 emails/day and is sufficient for development.

When asked for a website, you can use `mercadopreto.com.br` or any placeholder.

### 7.2 Get the API Key

1. Go to https://app.brevo.com → top-right account menu → **SMTP & API** → **API Keys**
2. Create a new key → copy it → set as `BREVO_API_KEY`

### 7.3 Verify a Sender

`EMAIL_FROM` must be a verified sender in Brevo, otherwise emails will be rejected.

- For development: go to **Senders & IPs** → **Senders** → verify your personal Gmail address
- For production: verify the domain `mercadopreto.com.br` via DNS records (TXT + DKIM)

Set `EMAIL_FROM` to the verified sender address.

---

## 8. Database Initialization

After the first `docker compose up`, run the Medusa migrations:

```bash
cd packages/medusa-backend/apps/backend
npm run db:migrate    # or: npx medusa migrations run
```

Then seed initial data (admin user, region, sales channel):

```bash
npm run db:seed       # if a seed script exists
```

### Required Database Configuration

After seeding, verify via Medusa admin (`http://localhost:9000/app`) that:

1. **Region** — A BRL region exists (e.g., "Brasil"). Note its ID for `NEXT_PUBLIC_REGION_ID`.
2. **Sales Channel** — A "Default Sales Channel" exists and all products are linked to it.
3. **Publishable API Key** — An active key exists under Settings → API Keys.
4. **Product prices** — All product variants must have a **BRL price** set. Variants without a BRL price return `price=0`, which fails checkout validation.

To add a BRL price via SQL (example):

```sql
-- Find the price set for a variant
SELECT pv.id, pv.title, ps.id as price_set_id
FROM product_variant pv
JOIN price_set ps ON ps.id = (
  SELECT price_set_id FROM product_variant_price_set WHERE variant_id = pv.id
);

-- Insert a price (amount in cents)
INSERT INTO price (price_set_id, currency_code, amount, raw_amount, rules_count)
VALUES ('<price_set_id>', 'brl', 7900, '{"value":"7900","precision":20}', 0);
```

---

## 9. Starting Services

### Start order

1. **Docker** (PostgreSQL + Redis + Meilisearch):
   ```bash
   docker compose -f infra/docker-compose.yml up -d
   ```

2. **ngrok** (needed for MercadoPago webhooks):
   ```bash
   ngrok http 9000
   # Then verify URL: curl -s http://localhost:4040/api/tunnels
   # Update BACKEND_URL in .env if URL changed
   ```

3. **Backend** (Medusa):
   ```bash
   cd packages/medusa-backend/apps/backend
   npm run dev
   ```
   Wait for it to be ready before testing endpoints:
   ```bash
   until curl -s http://localhost:9000/health | grep -q 200; do sleep 3; done && echo "Backend ready"
   ```

4. **Storefront** (Next.js):
   ```bash
   source ~/.nvm/nvm.sh && nvm use 22
   cd apps/storefront
   pnpm dev
   ```
   Available at http://localhost:3000

---

## 10. Common Issues & Troubleshooting

### "Nenhum produto encontrado" on the storefront

- Ensure `NEXT_PUBLIC_REGION_ID` is set in `apps/storefront/.env.local`
- Ensure the region has currency `brl`
- Ensure products are linked to the Default Sales Channel
- Ensure all product variants have a BRL price set

### Prices not updating after changes

Next.js caches API responses for 60 seconds (`revalidate: 60`). Medusa also has an internal pricing cache. After changing prices in the database, **restart both the backend and the storefront** to see changes immediately.

### "Nenhuma opção de frete disponível"

- The shipping estimate endpoint requires the `x-publishable-api-key` header
- Verify `MELHOR_ENVIO_TOKEN` is set and the sandbox URL is being used in development
- Check that `MELHOR_ENVIO_ORIGIN_CEP` is a valid Brazilian ZIP code

### "Erro ao iniciar o pagamento" (MercadoPago)

- Verify `MERCADOPAGO_ACCESS_TOKEN` starts with `TEST-` in sandbox
- `auto_return: "approved"` requires an HTTPS `back_url` — the backend conditionally disables it on HTTP, so if you see this error it's likely a different validation issue
- Check backend logs for the Zod validation error detail (logged to stderr)

### Webhook 502 / not received

- Verify ngrok is running and targeting port 9000: `ngrok http 9000`
- Verify `BACKEND_URL` in `.env` matches the current ngrok URL
- Verify the webhook is registered in the MP dashboard with the correct URL
- The ngrok URL changes on every restart — update both `.env` and the MP dashboard

### Brevo emails not delivered

- `EMAIL_FROM` must be a verified sender in Brevo
- Free plan: 300 emails/day limit
- In development, use a personal Gmail address as sender (verified in Brevo sender list)

### pnpm install fails with native module errors

- Ensure you are using Node 22: `source ~/.nvm/nvm.sh && nvm use 22`
- Never run `npm install` inside `apps/storefront` in the pnpm monorepo
- If the lockfile is corrupted, run `pnpm install` from the monorepo root

---

## 11. Production Checklist

- [ ] Replace all `TEST-` MercadoPago credentials with production credentials
- [ ] Set `NODE_ENV=production`
- [ ] Set `BACKEND_URL` to the real production backend domain
- [ ] Replace ngrok URL with the real backend domain in the MP webhook configuration
- [ ] Verify domain `mercadopreto.com.br` in Brevo (DNS records: SPF, DKIM)
- [ ] Update `EMAIL_FROM` to `noreply@mercadopreto.com.br` or similar
- [ ] Configure real Melhor Envio token (production, not sandbox)
- [ ] Generate new `JWT_SECRET` and `COOKIE_SECRET` (do not reuse development secrets)
- [ ] Configure HTTPS with valid SSL certificate (required for `auto_return` in MercadoPago)
- [ ] Set `STORE_CORS` and `ADMIN_CORS` to production domain only
- [ ] Configure `FOCUS_NFE_TOKEN` and `FOCUS_NFE_SANDBOX=false` for fiscal invoicing
