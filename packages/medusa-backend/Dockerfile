# =============================================================================
# Mercado Preto — Backend (Medusa.js v2)
# Build: docker build -t mercado-preto-api packages/medusa-backend
# Run via: infra/docker-compose.prod.yml
# =============================================================================

FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache python3 make g++ curl

# ---- deps ----
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/
# Install only production-needed packages to keep image lean
RUN npm ci --workspace=apps/backend --include-workspace-root

# ---- builder ----
FROM deps AS builder
COPY apps/backend ./apps/backend
WORKDIR /app/apps/backend
# medusa build compiles TS and bundles admin dashboard
RUN npx medusa build

# ---- runner ----
FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache curl

# Copy built artefact from builder
COPY --from=builder /app/apps/backend/.medusa/server ./
COPY --from=builder /app/apps/backend/package.json ./package.json
# Copy production node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 9000

ENV NODE_ENV=production

# Run migrations then start the server
CMD ["sh", "-c", "node_modules/.bin/medusa db:migrate && node_modules/.bin/medusa start"]
