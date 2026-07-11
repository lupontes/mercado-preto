# Let's Encrypt TLS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `infra/docker-compose.prod.yml` serve real Let's Encrypt TLS certificates for `mercadopreto.com.br` / `www.mercadopreto.com.br`, with automatic renewal, closing the "HTTPS/TLS em produção" gap from the Fase 6 roadmap.

**Architecture:** A containerized `certbot` service issues and renews certificates via the HTTP-01 webroot challenge, sharing bind-mounted volumes with the `nginx` service. A one-time bootstrap script (`infra/nginx/init-letsencrypt.sh`) breaks the chicken-and-egg problem (nginx won't start without certs; certbot needs nginx serving HTTP to complete the challenge) by generating a throwaway self-signed cert first.

**Tech Stack:** nginx:alpine, certbot/certbot (official Docker image), bash, Docker Compose.

## Global Constraints

- Domains: `mercadopreto.com.br` and `www.mercadopreto.com.br` (from the approved spec, `docs/superpowers/specs/2026-07-02-letsencrypt-tls-design.md`).
- DNS for both domains already points at the production server (confirmed by user) — HTTP-01 challenge is viable, no DNS-01/Cloudflare needed.
- Certificates live under `infra/nginx/certbot/conf` (bind mount), matching certbot's standard `/etc/letsencrypt` layout (`live/<domain>/fullchain.pem`, `privkey.pem`).
- Default Let's Encrypt registration email: `admin@mercadopreto.com.br`, overridable via `LETSENCRYPT_EMAIL` env var.
- No automated failure alerting (email/Slack) — out of scope per spec.
- No wildcard certs, no multi-domain beyond the two listed — out of scope per spec.
- **Deviation from spec:** the spec said to document the bootstrap step in `docs/DEPLOY_OCI.md`. Investigation during planning found that doc is exclusively about the OCI *test* environment (`docker-compose.oci.yml`, no nginx, IP-based access — see `docs/DEPLOY_OCI.md` and memory observation 395). It has no relation to `docker-compose.prod.yml`. Task 5 instead creates a new `docs/DEPLOY_PROD.md`, scoped to the production stack this feature actually touches. Flag this to the user after the plan is delivered.

---

### Task 1: Update `infra/nginx/nginx.conf` for ACME challenge + certbot cert paths

**Files:**
- Modify: `infra/nginx/nginx.conf`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nginx now expects certs at `/etc/nginx/ssl/live/mercadopreto.com.br/fullchain.pem` and `/etc/nginx/ssl/live/mercadopreto.com.br/privkey.pem` (consumed by Task 2's volume mount) and serves ACME challenges from `/var/www/certbot` (consumed by Task 2's volume mount and Task 3's certbot invocation).

- [ ] **Step 1: Edit the `:80` server block to add the ACME challenge location**

Replace:
```nginx
    server {
        listen 80;
        server_name _;
        return 301 https://$host$request_uri;
    }
```
with:
```nginx
    server {
        listen 80;
        server_name _;

        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }

        location / {
            return 301 https://$host$request_uri;
        }
    }
```

- [ ] **Step 2: Update the `:443` server block's certificate paths**

Replace:
```nginx
        ssl_certificate /etc/nginx/ssl/cert.pem;
        ssl_certificate_key /etc/nginx/ssl/key.pem;
```
with:
```nginx
        ssl_certificate /etc/nginx/ssl/live/mercadopreto.com.br/fullchain.pem;
        ssl_certificate_key /etc/nginx/ssl/live/mercadopreto.com.br/privkey.pem;
```

- [ ] **Step 3: Validate nginx config syntax**

Run:
```bash
docker run --rm \
  -v "$(pwd)/infra/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" \
  nginx:alpine nginx -t
```
Expected: `nginx: [emerg] cannot load certificate "/etc/nginx/ssl/live/mercadopreto.com.br/fullchain.pem"` — this is EXPECTED at this stage (no certs exist yet, and we're not mounting `/etc/nginx/ssl`). It confirms the config *parses* correctly and nginx got as far as trying to load the cert path we just wrote. If instead you see a syntax error (unexpected `{`, `}`, or directive), the edit is wrong — fix it.

- [ ] **Step 4: Commit**

```bash
git add infra/nginx/nginx.conf
git commit -m "feat(infra): add ACME challenge location and certbot cert paths to nginx"
```

---

### Task 2: Add `certbot` service and update `nginx` service in `infra/docker-compose.prod.yml`

**Files:**
- Modify: `infra/docker-compose.prod.yml`

**Interfaces:**
- Consumes: nginx cert paths and challenge path from Task 1 (`/etc/nginx/ssl/live/...`, `/var/www/certbot`).
- Produces: bind-mount directories `infra/nginx/certbot/conf` and `infra/nginx/certbot/www` on the host, and a `certbot` service name (consumed by Task 3's `docker compose run --rm ... certbot` and `docker compose exec nginx` calls).

- [ ] **Step 1: Replace the `nginx` service definition**

Replace:
```yaml
  nginx:
    image: nginx:alpine
    container_name: mercado-preto-nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
    depends_on:
      - medusa
    restart: unless-stopped
```
with:
```yaml
  nginx:
    image: nginx:alpine
    container_name: mercado-preto-nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/certbot/conf:/etc/nginx/ssl:ro
      - ./nginx/certbot/www:/var/www/certbot:ro
    depends_on:
      - medusa
    restart: unless-stopped
    command: sh -c 'while :; do sleep 6h; nginx -s reload; done & nginx -g "daemon off;"'
```

- [ ] **Step 2: Add the `certbot` service, right after `nginx`**

```yaml

  certbot:
    image: certbot/certbot:latest
    container_name: mercado-preto-certbot
    volumes:
      - ./nginx/certbot/conf:/etc/letsencrypt
      - ./nginx/certbot/www:/var/www/certbot
    entrypoint: sh -c 'trap exit TERM; while :; do sleep 12h; certbot renew --webroot -w /var/www/certbot --quiet; done'
```

- [ ] **Step 3: Validate compose file syntax**

Run:
```bash
cd infra && docker compose -f docker-compose.prod.yml config --quiet
```
Expected: no output, exit code 0 (warnings about unset variables like `${DB_PASSWORD}` are fine — no `.env` is loaded in this check; a syntax or structural error would print `yaml:` or `service ... ` errors and exit non-zero).

- [ ] **Step 4: Commit**

```bash
git add infra/docker-compose.prod.yml
git commit -m "feat(infra): add certbot service and periodic nginx reload for TLS renewal"
```

---

### Task 3: Add `infra/nginx/init-letsencrypt.sh` bootstrap script and `LETSENCRYPT_EMAIL` env var

**Files:**
- Create: `infra/nginx/init-letsencrypt.sh`
- Modify: `infra/.env.template`

**Interfaces:**
- Consumes: the `certbot` service name and `nginx` service name from Task 2; the cert path layout (`live/<domain>/fullchain.pem`, `privkey.pem`) from Task 1.
- Produces: `infra/nginx/certbot/conf/live/mercadopreto.com.br/{fullchain,privkey}.pem` on disk after a real run (not producible in this sandbox — no public DNS/port 80 reachable here, verified via syntax check only, see Step 3).

- [ ] **Step 1: Create the bootstrap script**

Create `infra/nginx/init-letsencrypt.sh`:
```bash
#!/usr/bin/env bash
# Emissão inicial dos certificados Let's Encrypt para o stack de produção.
# Rode UMA ÚNICA VEZ, a partir do diretório infra/, ANTES do primeiro
# `docker compose -f docker-compose.prod.yml up -d`.
#
# Uso:
#   ./nginx/init-letsencrypt.sh           # emite certificado de produção
#   STAGING=1 ./nginx/init-letsencrypt.sh # emite certificado de teste (não conta no rate limit)

set -euo pipefail

DOMAINS=(mercadopreto.com.br www.mercadopreto.com.br)
RSA_KEY_SIZE=4096
DATA_PATH="./nginx/certbot"
EMAIL="${LETSENCRYPT_EMAIL:-admin@mercadopreto.com.br}"
STAGING="${STAGING:-0}"
COMPOSE="docker compose -f docker-compose.prod.yml"
PRIMARY_DOMAIN="${DOMAINS[0]}"

if [ -d "$DATA_PATH/conf/live/$PRIMARY_DOMAIN" ]; then
  echo "Certificado já existe para $PRIMARY_DOMAIN. Abortando para não sobrescrever."
  echo "Para forçar reemissão, remova $DATA_PATH/conf/live/$PRIMARY_DOMAIN antes de rodar de novo."
  exit 1
fi

echo "### Criando certificado dummy para o nginx conseguir subir..."
mkdir -p "$DATA_PATH/conf/live/$PRIMARY_DOMAIN"
$COMPOSE run --rm --entrypoint "\
  openssl req -x509 -nodes -newkey rsa:$RSA_KEY_SIZE -days 1 \
    -keyout '/etc/letsencrypt/live/$PRIMARY_DOMAIN/privkey.pem' \
    -out '/etc/letsencrypt/live/$PRIMARY_DOMAIN/fullchain.pem' \
    -subj '/CN=localhost'" certbot

echo "### Subindo o nginx..."
$COMPOSE up -d nginx

echo "### Removendo certificado dummy..."
$COMPOSE run --rm --entrypoint "\
  rm -rf /etc/letsencrypt/live/$PRIMARY_DOMAIN \
         /etc/letsencrypt/archive/$PRIMARY_DOMAIN \
         /etc/letsencrypt/renewal/$PRIMARY_DOMAIN.conf" certbot

DOMAIN_ARGS=""
for domain in "${DOMAINS[@]}"; do
  DOMAIN_ARGS="$DOMAIN_ARGS -d $domain"
done

STAGING_ARG=""
if [ "$STAGING" != "0" ]; then
  STAGING_ARG="--staging"
fi

echo "### Emitindo o certificado real via Let's Encrypt..."
$COMPOSE run --rm --entrypoint "\
  certbot certonly --webroot -w /var/www/certbot \
    $STAGING_ARG \
    $DOMAIN_ARGS \
    --email $EMAIL \
    --rsa-key-size $RSA_KEY_SIZE \
    --agree-tos \
    --non-interactive" certbot

echo "### Recarregando o nginx com o certificado real..."
$COMPOSE exec nginx nginx -s reload

echo "### Concluído. Certificado emitido para: ${DOMAINS[*]}"
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x infra/nginx/init-letsencrypt.sh
```

- [ ] **Step 3: Validate script syntax**

Run:
```bash
bash -n infra/nginx/init-letsencrypt.sh
```
Expected: no output, exit code 0. (This only checks shell syntax — it cannot verify the certbot/DNS flow itself, since that requires a real public server with DNS already resolving and port 80 reachable, which this sandbox doesn't have. Full end-to-end verification happens during the actual production deploy, using `STAGING=1` first as documented in Task 5.)

- [ ] **Step 4: Add `LETSENCRYPT_EMAIL` to `infra/.env.template`**

In `infra/.env.template`, after the CORS section (after line 41, before the MercadoPago section), insert:
```
# -----------------------------------------------------------------------------
# Let's Encrypt — TLS [OBRIGATÓRIO em produção]
# E-mail de registro, usado apenas para avisos de expiração de certificado.
# -----------------------------------------------------------------------------
LETSENCRYPT_EMAIL=admin@mercadopreto.com.br
```

- [ ] **Step 5: Commit**

```bash
git add infra/nginx/init-letsencrypt.sh infra/.env.template
git commit -m "feat(infra): add Let's Encrypt bootstrap script and LETSENCRYPT_EMAIL var"
```

---

### Task 4: Ignore certbot's runtime state directories in git

**Files:**
- Modify: `.gitignore` (repo root) — or create `infra/nginx/certbot/.gitignore` if a root `.gitignore` doesn't exist or a more scoped ignore is preferred.

**Interfaces:**
- Consumes: the `infra/nginx/certbot/conf` and `infra/nginx/certbot/www` paths introduced in Task 2.
- Produces: nothing consumed by later tasks — this is a leaf task preventing secrets/generated files (private keys) from being committed.

- [ ] **Step 1: Check whether a root `.gitignore` exists**

```bash
test -f .gitignore && echo "exists" || echo "missing"
```

- [ ] **Step 2: Append the ignore rule**

Append to `.gitignore` (create it with just this line if Step 1 printed "missing"):
```
infra/nginx/certbot/
```

- [ ] **Step 3: Verify it's picked up**

```bash
mkdir -p infra/nginx/certbot/conf
touch infra/nginx/certbot/conf/test.txt
git status --porcelain infra/nginx/certbot/
```
Expected: no output (the untracked file doesn't show up because it's ignored). Then clean up:
```bash
rm -rf infra/nginx/certbot/conf/test.txt
rmdir infra/nginx/certbot/conf infra/nginx/certbot 2>/dev/null || true
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore(infra): ignore certbot runtime state (private keys, account data)"
```

---

### Task 5: Create `docs/DEPLOY_PROD.md` documenting the TLS bootstrap procedure

**Files:**
- Create: `docs/DEPLOY_PROD.md`

**Interfaces:**
- Consumes: the `init-letsencrypt.sh` script and `STAGING` env var from Task 3; the `certbot` service and periodic nginx reload from Task 2.
- Produces: nothing consumed by later tasks (final task).

- [ ] **Step 1: Create the doc**

Create `docs/DEPLOY_PROD.md`:
```markdown
# Deploy — Produção (TLS com Let's Encrypt)

Este guia documenta o passo de emissão do certificado TLS antes de subir o
stack de produção (`infra/docker-compose.prod.yml`).

## Pré-requisitos

- DNS de `mercadopreto.com.br` e `www.mercadopreto.com.br` já apontando
  (registro A) para o IP público do servidor.
- `infra/.env` criado a partir de `infra/.env.template`, com todas as
  variáveis obrigatórias preenchidas — incluindo `LETSENCRYPT_EMAIL`.
- Portas 80 e 443 liberadas no firewall/NSG do servidor.

## Emissão inicial do certificado (rodar uma única vez)

```bash
cd infra
./nginx/init-letsencrypt.sh
```

O script:
1. Gera um certificado dummy para o nginx conseguir subir.
2. Sobe o serviço `nginx`.
3. Remove o certificado dummy.
4. Emite o certificado real via Let's Encrypt (desafio HTTP-01 / webroot).
5. Recarrega o nginx com o certificado real.

### Testar sem consumir o rate limit de produção

O Let's Encrypt limita a 5 certificados por domínio por semana. Para
validar o fluxo sem gastar esse limite, rode primeiro em modo staging:

```bash
STAGING=1 ./nginx/init-letsencrypt.sh
```

Certificados de staging não são confiáveis pelo navegador (emissor de
teste). Depois de validar, remova o certificado de staging e rode de novo
sem `STAGING=1`:

```bash
rm -rf nginx/certbot/conf/live/mercadopreto.com.br \
       nginx/certbot/conf/archive/mercadopreto.com.br \
       nginx/certbot/conf/renewal/mercadopreto.com.br.conf
./nginx/init-letsencrypt.sh
```

## Subir o restante do stack

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

## Renovação

O serviço `certbot` renova automaticamente a cada 12h
(`certbot renew --webroot`), e o `nginx` recarrega a configuração a cada 6h
para pegar o certificado renovado. Não é necessário nenhum passo manual
depois da emissão inicial.

Para checar o status da renovação:

```bash
docker compose -f docker-compose.prod.yml logs certbot
```
```

- [ ] **Step 2: Commit**

```bash
git add docs/DEPLOY_PROD.md
git commit -m "docs(infra): document production TLS bootstrap procedure"
```
