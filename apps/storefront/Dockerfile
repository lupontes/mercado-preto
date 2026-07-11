# =============================================================================
# Mercado Preto — Storefront (Next.js)
# Build: docker build -f apps/storefront/Dockerfile -t mercado-preto-storefront .
# (context must be the monorepo root — pnpm workspace resolution needs the
# root pnpm-lock.yaml and pnpm-workspace.yaml)
# Run via: infra/docker-compose.prod.yml
# =============================================================================

FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

# ---- deps ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/storefront/package.json ./apps/storefront/
RUN pnpm install --frozen-lockfile --filter @mercado-preto/storefront...

# ---- builder ----
FROM deps AS builder
COPY apps/storefront ./apps/storefront
WORKDIR /app/apps/storefront

# Public env vars are baked into the client bundle at build time.
ARG NEXT_PUBLIC_MEDUSA_URL
ARG NEXT_PUBLIC_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_REGION_ID
ARG NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY
ENV NEXT_PUBLIC_MEDUSA_URL=$NEXT_PUBLIC_MEDUSA_URL
ENV NEXT_PUBLIC_PUBLISHABLE_KEY=$NEXT_PUBLIC_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_REGION_ID=$NEXT_PUBLIC_REGION_ID
ENV NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY=$NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY

RUN pnpm build

# ---- runner ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/apps/storefront/public ./public
COPY --from=builder /app/apps/storefront/.next/standalone ./
COPY --from=builder /app/apps/storefront/.next/static ./apps/storefront/.next/static

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "apps/storefront/server.js"]
