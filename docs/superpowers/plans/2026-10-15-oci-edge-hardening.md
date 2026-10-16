# Endurecimento da borda do ambiente OCI: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** colocar o nginx sob o `docker-compose.oci.yml` sem IP fixo e deixar
só as portas 22, 80 e 443 acessíveis pela internet no servidor de teste, sem
quebrar pagamento, imagens nem os painéis.

**Architecture:** um `nginx.conf` próprio do OCI (`infra/nginx/oci/`), montado
como diretório. O `medusa` é resolvido a cada requisição pelo DNS do Docker; o
storefront (PM2 no host) é alcançado por `host.docker.internal` via
`host-gateway`. O compose publica as portas internas só em `127.0.0.1`, as
URLs públicas derivam de `PUBLIC_URL`, e a porta 3000 do host fica restrita às
redes Docker no iptables.

**Tech Stack:** Docker Compose v2 (projeto `infra`), nginx:alpine, iptables +
netfilter-persistent, bash e Python 3 stdlib para os testes.

**Spec:** `docs/superpowers/specs/2026-10-15-oci-edge-hardening-design.md`

## Global Constraints

- O nome do projeto do compose OCI é `infra`, fixado com `name: infra`. Nunca muda.
- Portas públicas finais: só 22, 80 e 443.
- `container_name` do nginx: `mercado-preto-nginx`.
- `PUBLIC_URL=https://teste.mercadopreto.com.br`; `BACKEND_URL=${PUBLIC_URL}/api`; `STORE_CORS`, `ADMIN_CORS` e `AUTH_CORS` iguais a `${PUBLIC_URL}`.
- O storefront do servidor usa `NEXT_PUBLIC_MEDUSA_URL=http://localhost:9000`.
- O `infra/nginx/nginx.conf` e o `infra/docker-compose.prod.yml` **não são alterados**.
- Não usar `--remove-orphans`. Não subir o serviço `evolution-api`, que hoje está parado e fica fora do escopo.
- Pré-requisito do deploy: #57 e #58 mergeados em `develop`.

## Review Focus

1. Webhook do Mercado Pago com query string (`/api/webhooks/mercadopago?data.id=123&type=payment`): a query precisa chegar intacta ao backend depois do `rewrite` do `/api/`. Coberto na Task 1 (checagem `api-query`).
2. `medusa` recriado com outro IP: a API continua respondendo sem reiniciar o nginx. Coberto na Task 1 (checagem `resolver`) e na Task 4 (passo 8).
3. Renovação do certificado: `/.well-known/acme-challenge/*` na porta 80 continua servido do webroot, sem redirecionar. Coberto na Task 1 (checagem `acme`).
4. Cookies `Secure` do vendedor e do admin dependem de `X-Forwarded-Proto: https` em `/seller/`, `/auth/` e `/admin/`. Coberto na Task 1 (checagem `forwarded-proto`).
5. Foto de produto de celular, com 2 a 5 MB, enviada pelo painel via `/admin/uploads`: o nginx não pode responder 413. O padrão do nginx é 1 MB; o config passa a ter `client_max_body_size 20m`. Coberto na Task 1 (checagem `upload-size`).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `infra/nginx/oci/nginx.conf` (novo) | Roteamento da borda no OCI |
| `infra/nginx/oci/test-nginx-oci.sh` (novo) | Teste do config num nginx real contra upstreams falsos (whoami) |
| `infra/docker-compose.oci.yml` | `name`, portas, serviço `nginx`, envs com `PUBLIC_URL` |
| `infra/scripts/test_compose_oci.py` (novo) | Teste do compose renderizado (`docker compose config`) |
| `infra/.env.template` | Entrada `PUBLIC_URL` |
| `infra/scripts/smoke-oci.sh` (novo) | Smoke de fora do servidor: URLs 200 e portas fechadas |
| `docs/DEPLOY_OCI.md` | Portas, firewall, arquitetura e envs atualizados |

---

### Task 1: config do nginx do OCI, com teste

**Files:**
- Create: `infra/nginx/oci/nginx.conf`
- Create: `infra/nginx/oci/test-nginx-oci.sh`

**Interfaces:**
- Produces: arquivo `infra/nginx/oci/nginx.conf`, carregado com `nginx -c /etc/nginx/oci/nginx.conf`. Espera:
  - `/etc/nginx/ssl/live/teste.mercadopreto.com.br/{fullchain,privkey}.pem`;
  - webroot do ACME em `/var/www/certbot`;
  - o host `medusa:9000` na rede Docker;
  - `host.docker.internal` resolvível via `/etc/hosts`.

- [ ] **Step 1: Escrever o teste**

Crie `infra/nginx/oci/test-nginx-oci.sh` e rode `chmod +x` nele:

```bash
#!/usr/bin/env bash
# Runs infra/nginx/oci/nginx.conf in a real nginx against fake upstreams
# (traefik/whoami echoes the request it received), so routing, prefix
# stripping, forwarded headers and DNS re-resolution are checked without the
# real backend. Requires Docker and a free host port 3000.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DOMAIN="teste.mercadopreto.com.br"
NET="nginx-oci-test-$$"
TMP="$(mktemp -d)"
FAILED=0

cleanup() {
  docker rm -f "medusa-$NET" "filler-$NET" "storefront-$NET" "nginx-$NET" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

check() { # name, expected substring, actual
  if grep -qF -- "$2" <<<"$3"; then echo "ok   $1"; else echo "FAIL $1: expected '$2'"; echo "$3" | head -5; FAILED=1; fi
}

mkdir -p "$TMP/ssl/live/$DOMAIN" "$TMP/www/.well-known/acme-challenge"
openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj "/CN=$DOMAIN" \
  -keyout "$TMP/ssl/live/$DOMAIN/privkey.pem" -out "$TMP/ssl/live/$DOMAIN/fullchain.pem" 2>/dev/null
echo "acme-token" > "$TMP/www/.well-known/acme-challenge/probe"

docker network create "$NET" >/dev/null
start_medusa() {
  docker run -d --name "medusa-$NET" --network "$NET" --network-alias medusa \
    traefik/whoami:v1.10.3 --port 9000 --name medusa >/dev/null
}
start_medusa
# Storefront runs on the host (PM2) in the real deploy, so the fake one listens
# on the host network and is reached through host-gateway, like production.
docker run -d --name "storefront-$NET" --network host \
  traefik/whoami:v1.10.3 --port 3000 --name storefront >/dev/null

docker run -d --name "nginx-$NET" --network "$NET" \
  --add-host host.docker.internal:host-gateway \
  -v "$HERE:/etc/nginx/oci:ro" -v "$TMP/ssl:/etc/nginx/ssl:ro" -v "$TMP/www:/var/www/certbot:ro" \
  -p 127.0.0.1:18080:80 -p 127.0.0.1:18443:443 \
  nginx:alpine nginx -c /etc/nginx/oci/nginx.conf -g 'daemon off;' >/dev/null

docker exec "nginx-$NET" nginx -t -c /etc/nginx/oci/nginx.conf
sleep 1

H=(-sk --resolve "$DOMAIN:18443:127.0.0.1")
get() { curl "${H[@]}" "https://$DOMAIN:18443$1"; }

check api-strip        "GET /health HTTP"                         "$(get /api/health)"
check api-target       "Name: medusa"                             "$(get /api/health)"
check api-query        "GET /webhooks/mercadopago?data.id=123&type=payment HTTP" "$(get '/api/webhooks/mercadopago?data.id=123&type=payment')"
for p in /app/x /auth/x /admin/x /store/x /seller/x; do
  check "prefix$p"     "GET $p HTTP"                              "$(get "$p")"
done
check forwarded-proto  "X-Forwarded-Proto: https"                 "$(get /seller/me)"
check forwarded-for    "X-Forwarded-For: "                        "$(get /auth/x)"
check storefront       "Name: storefront"                         "$(get /)"
check http-redirect    "301"                                      "$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $DOMAIN" http://127.0.0.1:18080/)"
check acme             "acme-token"                               "$(curl -s -H "Host: $DOMAIN" http://127.0.0.1:18080/.well-known/acme-challenge/probe)"
head -c 3000000 /dev/zero > "$TMP/upload.bin"
check upload-size      "200"                                      "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -F "files=@$TMP/upload.bin" "https://$DOMAIN:18443/admin/uploads")"

# Recreate medusa on a different IP: the filler takes the old address first.
docker rm -f "medusa-$NET" >/dev/null
docker run -d --name "filler-$NET" --network "$NET" traefik/whoami:v1.10.3 >/dev/null
start_medusa
sleep 11 # resolver valid=10s
check resolver         "Name: medusa"                             "$(get /api/health)"

exit "$FAILED"
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `infra/nginx/oci/test-nginx-oci.sh`
Expected: falha com erro do `docker run` ou do `nginx -t`, porque `/etc/nginx/oci/nginx.conf` ainda não existe.

- [ ] **Step 3: Escrever o config**

Crie `infra/nginx/oci/nginx.conf`:

```nginx
# nginx do ambiente de testes OCI (gerenciado por infra/docker-compose.oci.yml).
# Não confundir com infra/nginx/nginx.conf, usado pelo docker-compose.prod.yml.
worker_processes auto;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    gzip on;
    gzip_types text/plain application/json application/javascript text/css;

    # Fotos de produto tiradas no celular passam de 1 MB (padrão do nginx).
    client_max_body_size 20m;

    # DNS interno do Docker. Com variável no proxy_pass, `medusa` é resolvido
    # a cada requisição (cache de 10s), então recriar o container do backend
    # com outro IP não derruba a API até o nginx reiniciar.
    resolver 127.0.0.11 valid=10s ipv6=off;

    # O storefront roda no host (PM2). `host.docker.internal` vem do
    # extra_hosts (host-gateway), que só existe no /etc/hosts do container: o
    # DNS do Docker não resolve esse nome, por isso este upstream é estático
    # (resolvido na subida) e não usa variável como o medusa.
    upstream storefront {
        server host.docker.internal:3000;
    }

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

    server {
        listen 443 ssl http2;
        server_name teste.mercadopreto.com.br;

        ssl_certificate /etc/nginx/ssl/live/teste.mercadopreto.com.br/fullchain.pem;
        ssl_certificate_key /etc/nginx/ssl/live/teste.mercadopreto.com.br/privkey.pem;

        set $medusa_upstream http://medusa:9000;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # /api/ remove o prefixo. É a base do BACKEND_URL: webhooks do
        # Mercado Pago, /static dos uploads e callback do Mercado Livre.
        # Com variável no proxy_pass o nginx não troca a URI sozinho, daí o
        # rewrite (a query string é preservada).
        location /api/ {
            rewrite ^/api/(.*)$ /$1 break;
            proxy_pass $medusa_upstream;
        }

        location /app/    { proxy_pass $medusa_upstream; }
        location /auth/   { proxy_pass $medusa_upstream; }
        location /admin/  { proxy_pass $medusa_upstream; }
        location /store/  { proxy_pass $medusa_upstream; }
        location /seller/ { proxy_pass $medusa_upstream; }

        location / {
            proxy_pass http://storefront;
        }
    }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `infra/nginx/oci/test-nginx-oci.sh`
Expected: todas as linhas `ok`, exit 0. Se `storefront` falhar com a porta 3000 ocupada localmente, pare o processo que a ocupa e rode de novo; não mude a porta no config.

- [ ] **Step 5: Commit**

```bash
git add infra/nginx/oci/
git commit -m "feat(infra): adicionar config do nginx do ambiente oci com teste"
```

---

### Task 2: compose OCI (portas, nginx, `PUBLIC_URL`), com teste

**Files:**
- Modify: `infra/docker-compose.oci.yml`
- Modify: `infra/.env.template`
- Create: `infra/scripts/test_compose_oci.py`

**Interfaces:**
- Consumes: `infra/nginx/oci/nginx.conf` (Task 1), montado como diretório em `/etc/nginx/oci`.
- Produces: serviço `nginx` no projeto `infra`; variável `PUBLIC_URL` lida do `--env-file`.

- [ ] **Step 1: Escrever o teste**

Crie `infra/scripts/test_compose_oci.py`:

```python
"""Checks the rendered docker-compose.oci.yml against the edge-hardening spec.

Run: python3 -I infra/scripts/test_compose_oci.py
Uses `docker compose config` so it tests what Compose will actually apply,
not the raw YAML.
"""
import json
import pathlib
import subprocess
import unittest

INFRA = pathlib.Path(__file__).resolve().parent.parent
PUBLIC_URL = "https://teste.mercadopreto.com.br"


def render():
    out = subprocess.run(
        ["docker", "compose", "-f", str(INFRA / "docker-compose.oci.yml"),
         "--env-file", str(INFRA / ".env.template"), "config", "--format", "json"],
        check=True, capture_output=True, text=True,
    ).stdout
    return json.loads(out)


class ComposeOciTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = render()
        cls.services = cls.config["services"]

    def test_project_name_is_pinned_so_volumes_keep_their_names(self):
        self.assertEqual(self.config["name"], "infra")

    def test_only_nginx_publishes_ports_publicly(self):
        for name, service in self.services.items():
            for port in service.get("ports", []):
                if name == "nginx":
                    self.assertIn(str(port["published"]), {"80", "443"})
                else:
                    self.assertEqual(port.get("host_ip"), "127.0.0.1", f"{name} publishes {port}")

    def test_meilisearch_is_not_published(self):
        self.assertEqual(self.services["meilisearch"].get("ports", []), [])

    def test_nginx_reaches_host_storefront_via_host_gateway(self):
        extra = self.services["nginx"].get("extra_hosts", [])
        # Compose renders extra_hosts as a list ("name=ip") or a map
        # ({"name": ["ip"]}) depending on the version.
        if isinstance(extra, dict):
            hosts = [f"{k}:{v}" for k, vals in extra.items() for v in (vals if isinstance(vals, list) else [vals])]
        else:
            hosts = [h.replace("=", ":") for h in extra]
        self.assertIn("host.docker.internal:host-gateway", hosts)

    def test_nginx_mounts_config_directory_not_single_file(self):
        mounts = {v["target"]: v for v in self.services["nginx"]["volumes"]}
        self.assertTrue(mounts["/etc/nginx/oci"]["source"].endswith("infra/nginx/oci"))
        self.assertIn("/etc/nginx/oci/nginx.conf", " ".join(self.services["nginx"]["command"]))

    def test_nginx_keeps_container_name_so_existing_container_is_adopted(self):
        self.assertEqual(self.services["nginx"]["container_name"], "mercado-preto-nginx")

    def test_backend_public_urls_derive_from_public_url(self):
        env = self.services["medusa"]["environment"]
        self.assertEqual(env["BACKEND_URL"], f"{PUBLIC_URL}/api")
        for key in ("STORE_CORS", "ADMIN_CORS", "AUTH_CORS"):
            self.assertEqual(env[key], PUBLIC_URL, key)

    def test_backend_keeps_uploads_volume(self):
        mounts = {v["target"]: v["source"] for v in self.services["medusa"]["volumes"]}
        self.assertEqual(mounts["/app/static"], "backend_uploads")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `python3 -I infra/scripts/test_compose_oci.py`
Expected: falham `test_project_name...`, `test_only_nginx...`, `test_meilisearch...`, `test_nginx_*` (KeyError `nginx`) e `test_backend_public_urls...`.

- [ ] **Step 3: Adicionar `PUBLIC_URL` ao template**

Em `infra/.env.template`, logo antes do bloco `# CORS — domínios do frontend [OBRIGATÓRIO]`, adicione:

```bash
# URL pública do ambiente (usada pelo docker-compose.oci.yml para derivar
# BACKEND_URL e os CORS do backend) [OBRIGATÓRIO no OCI]
PUBLIC_URL=https://teste.mercadopreto.com.br

```

- [ ] **Step 4: Alterar o compose**

Em `infra/docker-compose.oci.yml`:

1. Substitua o cabeçalho (linhas 1-10) por:

```yaml
# =============================================================================
# Mercado Preto — Ambiente de Testes Oracle Cloud (Ambiente B)
# Servidor: 168.138.148.67 | Portas públicas: 80, 443 (e 22 para SSH)
#
# Uso:
#   Subir:    docker compose -f docker-compose.oci.yml --env-file .env.oci up -d
#   Logs:     docker compose -f docker-compose.oci.yml logs -f
#   Parar:    docker compose -f docker-compose.oci.yml down
#   Rebuild:  docker compose -f docker-compose.oci.yml build --no-cache medusa
#
# Portas internas são publicadas só em 127.0.0.1 (acesso por túnel SSH).
# =============================================================================

# Fixado de propósito: o nome do projeto prefixa os volumes (infra_postgres_data
# etc.). Mudá-lo faz o Docker criar volumes novos e vazios. Também é o projeto
# do docker-compose.prod.yml, que fica na mesma pasta.
name: infra
```

2. Ajuste os `ports`:
   - `postgres`: `- "127.0.0.1:5433:5432"`;
   - `redis`: `- "127.0.0.1:6380:6379"`;
   - `evolution-api`: `- "127.0.0.1:8080:8080"`;
   - `medusa`: `- "127.0.0.1:9000:9000"`;
   - `meilisearch`: remova o bloco `ports` inteiro e troque o comentário do serviço por `# Meilisearch — busca full-text (interno; dashboard via túnel SSH na 7700 do container)`.

3. Atualize o comentário do `medusa` para `# Medusa backend — motor do marketplace (público só via nginx em /api, /app, /auth, /admin, /store, /seller)`.

4. No `environment` do `medusa`, troque o bloco de CORS e o `BACKEND_URL`:

```yaml
      # CORS — o navegador só fala com o domínio público (nginx na frente)
      STORE_CORS: ${PUBLIC_URL}
      ADMIN_CORS: ${PUBLIC_URL}
      AUTH_CORS: ${PUBLIC_URL}
```

```yaml
      # URL pública do backend: base da notification_url do Mercado Pago, do
      # /static dos uploads e do callback do Mercado Livre. O prefixo /api é
      # removido pelo nginx antes de chegar ao medusa.
      BACKEND_URL: ${PUBLIC_URL}/api
```

5. Troque o comentário do `certbot` (o bloco que diz "O nginx (mercado-preto-nginx) não é gerenciado por este compose…") por:

```yaml
  # Certbot — renovação automática do certificado Let's Encrypt
  # Grava em ./nginx/certbot, que o serviço nginx abaixo lê e recarrega a cada
  # 6h; sem este serviço o certificado expira em 90 dias sem nenhum aviso
  # (ocorreu em 2026-10-05). Emissão inicial: infra/nginx/init-letsencrypt.sh
```

6. Depois do serviço `certbot`, adicione:

```yaml
  # ---------------------------------------------------------------------------
  # nginx — única porta de entrada pública (80/443)
  # Config próprio do OCI em ./nginx/oci (montado como diretório: um arquivo
  # único montado sozinho não vê as mudanças de um git pull, porque o checkout
  # cria um inode novo). O storefront roda no host (PM2) e é alcançado por
  # host.docker.internal.
  # ---------------------------------------------------------------------------
  nginx:
    image: nginx:alpine
    container_name: mercado-preto-nginx
    ports:
      - "80:80"
      - "443:443"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - ./nginx/oci:/etc/nginx/oci:ro
      - ./nginx/certbot/conf:/etc/nginx/ssl:ro
      - ./nginx/certbot/www:/var/www/certbot:ro
    depends_on:
      - medusa
    restart: unless-stopped
    command: sh -c 'while :; do sleep 6h; nginx -c /etc/nginx/oci/nginx.conf -s reload; done & exec nginx -c /etc/nginx/oci/nginx.conf -g "daemon off;"'
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `python3 -I infra/scripts/test_compose_oci.py`
Expected: `OK` (8 testes).

- [ ] **Step 6: Commit**

```bash
git add infra/docker-compose.oci.yml infra/.env.template infra/scripts/test_compose_oci.py
git commit -m "feat(infra): gerenciar nginx no compose oci e publicar portas internas só em localhost"
```

---

### Task 3: smoke de fora do servidor e documentação

**Files:**
- Create: `infra/scripts/smoke-oci.sh`
- Modify: `docs/DEPLOY_OCI.md`

**Interfaces:**
- Produces: `infra/scripts/smoke-oci.sh <domain> <server-ip>`. Imprime uma linha `ok`/`FAIL` por checagem e termina com exit 0 só se tudo passar. Usado na Task 4.

- [ ] **Step 1: Escrever o smoke**

Crie `infra/scripts/smoke-oci.sh` e rode `chmod +x` nele:

```bash
#!/usr/bin/env bash
# Smoke test of the OCI test environment, run from OUTSIDE the server.
# Usage: infra/scripts/smoke-oci.sh teste.mercadopreto.com.br 168.138.148.67
set -uo pipefail

DOMAIN="${1:?domain}"
IP="${2:?server ip}"
BASE="https://$DOMAIN"
FAILED=0

ok()   { echo "ok   $1"; }
fail() { echo "FAIL $1"; FAILED=1; }
expect_status() { # name, expected code, url
  local code; code="$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$3")"
  [[ "$code" == "$2" ]] && ok "$1 ($code)" || fail "$1: expected $2, got $code"
}

expect_status home "200" "$BASE/"
expect_status api-health "200" "$BASE/api/health"
expect_status http-redirect "301" "http://$DOMAIN/"

# An image the storefront actually renders: both the optimized and the raw URL.
NEXT_IMG="$(curl -s -m 15 "$BASE/" | grep -oE '/_next/image\?url=[^"]+' | head -1 | sed 's/&amp;/\&/g')"
if [[ -z "$NEXT_IMG" ]]; then
  fail "image: no /_next/image found on home"
else
  expect_status next-image "200" "$BASE$NEXT_IMG"
  RAW="$(python3 -I -c 'import sys,urllib.parse as u; print(u.parse_qs(u.urlsplit(sys.argv[1]).query)["url"][0])' "$NEXT_IMG")"
  expect_status raw-image "200" "$RAW"
fi

for port in 3000 5433 6380 7700 8080 9000; do
  if timeout 5 bash -c "</dev/tcp/$IP/$port" 2>/dev/null; then
    fail "port $port is reachable from the internet"
  else
    ok "port $port closed"
  fi
done

exit "$FAILED"
```

- [ ] **Step 2: Rodar contra o servidor atual e confirmar que falha (teste vermelho)**

Run: `infra/scripts/smoke-oci.sh teste.mercadopreto.com.br 168.138.148.67`
Expected: `ok` em home, api-health, http-redirect, next-image e raw-image (desde que #57 e #58 estejam no servidor). `FAIL` em `port 3000`, `port 7700` e `port 9000`. Exit 1.

- [ ] **Step 3: Atualizar `docs/DEPLOY_OCI.md`**

1. Substitua a tabela "Portas abertas (NSG Oracle Cloud + iptables)" por:

```markdown
| Porta | Protocolo | Serviço | Descrição |
|-------|-----------|---------|-----------|
| `22` | TCP | SSH | Acesso remoto (chave pública) |
| `80` | TCP | nginx | Redireciona para 443; desafio ACME do certbot |
| `443` | TCP | nginx | Única entrada pública: vitrine, `/api`, `/app`, `/store`, `/seller`... |

Todo o resto fica interno. Postgres (5433), Redis (6380), Evolution (8080) e
Medusa (9000) são publicados só em `127.0.0.1`. O Meilisearch não é
publicado. O storefront (3000, PM2 no host) só aceita conexões das redes
Docker. Para acessar um serviço interno, use túnel SSH, por exemplo
`ssh -i ~/.ssh/oci_vms -L 9000:127.0.0.1:9000 ubuntu@168.138.148.67`.
```

2. Substitua o bloco "Configuração de Firewall (UFW + iptables)" por:

````markdown
### Firewall do host (iptables + netfilter-persistent)

O servidor não usa UFW. Regras relevantes na chain `INPUT`, antes do `REJECT` final:

```bash
sudo iptables -I INPUT -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
# Storefront (PM2): só o nginx, que chega pelas redes Docker
sudo iptables -I INPUT -s 172.16.0.0/12 -p tcp --dport 3000 -j ACCEPT
sudo netfilter-persistent save
```

Portas publicadas pelo Docker não passam pela chain `INPUT`. Por isso elas são
fechadas no `docker-compose.oci.yml` (bind em `127.0.0.1`), e não no iptables.
A NSG da OCI libera só 22, 80 e 443, como segunda camada.
````

3. Substitua o diagrama "Arquitetura no servidor" por:

```
Internet
  │
  ├── :80/:443 → nginx (container, compose OCI)
  │                ├── /api /app /auth /admin /store /seller → medusa:9000
  │                └── /  → host.docker.internal:3000 → storefront (PM2 no host)
  └── :22 → SSH

Interno (127.0.0.1 ou rede Docker):
  Medusa 9000, PostgreSQL 5433, Redis 6380, Evolution 8080, Meilisearch 7700
```

4. No exemplo de env do backend, troque `STORE_CORS`, `ADMIN_CORS`, `AUTH_CORS` e `BACKEND_URL` (linhas ~184-190) por:

```bash
# No OCI, estes valores vêm do compose a partir de PUBLIC_URL (.env.oci)
PUBLIC_URL=https://teste.mercadopreto.com.br
# STORE_CORS / ADMIN_CORS / AUTH_CORS = ${PUBLIC_URL}
# BACKEND_URL = ${PUBLIC_URL}/api
```

5. No exemplo do `.env.local` do storefront (linha ~228), troque por:

```bash
# Só o SSR usa esta URL; o navegador chama caminhos relativos via nginx.
NEXT_PUBLIC_MEDUSA_URL=http://localhost:9000
NEXT_PUBLIC_SITE_URL=https://teste.mercadopreto.com.br
```

6. Troque cada `curl -s http://168.138.148.67:9000/health` por `curl -s https://teste.mercadopreto.com.br/api/health`, e `http://168.138.148.67:9000/app` por `https://teste.mercadopreto.com.br/app`.

7. Troque o comentário sobre `HOSTNAME=0.0.0.0` que cita `172.18.0.1:3000` por `# ... o nginx (no Docker, via host.docker.internal:3000) deixa de alcançar o storefront.`

8. Depois de cada `pnpm build && pm2 restart storefront` e de cada `docker compose ... up -d`, adicione:

```bash
# Conferir de fora do servidor:
infra/scripts/smoke-oci.sh teste.mercadopreto.com.br 168.138.148.67
```

- [ ] **Step 4: Conferir se sobrou referência antiga**

Run: `grep -nE "168\.138\.148\.67:(3000|9000|7700)|172\.18\.0\.1|ufw" docs/DEPLOY_OCI.md`
Expected: nenhuma linha, ou só linhas que descrevem o histórico explicitamente.

- [ ] **Step 5: Commit**

```bash
git add infra/scripts/smoke-oci.sh docs/DEPLOY_OCI.md
git commit -m "docs(deploy): documentar borda do oci e adicionar smoke externo"
```

---

### Task 4: deploy no servidor de teste

Executado pela sessão principal, com **checkpoint com o usuário antes dos passos 5, 6 e 7** (mexem em tráfego e firewall). Não usar subagente.

**Files:** nenhum no repo. Mexe no servidor: `~/marketplace/apps/storefront/.env.local`, `~/marketplace/infra/.env.oci` e o iptables.

**Interfaces:**
- Consumes: `infra/scripts/smoke-oci.sh` (Task 3) e a branch com as Tasks 1-3 publicada no GitHub.

Atalho usado nos comandos: `S='ssh -i ~/.ssh/oci_vms ubuntu@168.138.148.67'`.

- [ ] **Step 1: Pré-requisitos**

Confirmar #57 e #58 mergeados: `gh pr view 57 --json state -q .state` e `gh pr view 58 --json state -q .state` → `MERGED`. Se não estiverem, parar e avisar o usuário.

- [ ] **Step 2: Smoke vermelho**

Run: `infra/scripts/smoke-oci.sh teste.mercadopreto.com.br 168.138.148.67`
Expected: só as portas 3000, 7700 e 9000 com `FAIL`.

- [ ] **Step 3: Servidor na branch da implementação, com backups**

```bash
$S 'cd ~/marketplace && git status --short | grep -v "^??"'   # precisa estar vazio; se não, parar e avisar
$S 'cd ~/marketplace && git fetch -q origin && git checkout -q <branch-da-implementação> && git log --oneline -1'
$S 'cd ~/marketplace && T=$(date +%Y%m%d%H%M%S) && cp infra/.env.oci infra/.env.oci.bak.$T && cp apps/storefront/.env.local apps/storefront/.env.local.bak.$T && sudo iptables-save > ~/iptables.bak.$T && echo $T'
```

Anote o timestamp `T` para o rollback.

- [ ] **Step 4: Storefront com o backend em localhost**

```bash
$S 'cd ~/marketplace/apps/storefront && sed -i "s#^NEXT_PUBLIC_MEDUSA_URL=.*#NEXT_PUBLIC_MEDUSA_URL=http://localhost:9000#" .env.local && grep ^NEXT_PUBLIC_ .env.local | cut -d= -f1,2 | grep -E "MEDUSA_URL|SITE_URL"'
$S 'source ~/.nvm/nvm.sh >/dev/null; cd ~/marketplace/apps/storefront && pnpm build 2>&1 | grep -E "Compiled|Failed" && pm2 restart storefront'
```

Run: `infra/scripts/smoke-oci.sh teste.mercadopreto.com.br 168.138.148.67`
Expected: o mesmo resultado do Step 2. A vitrine continua 200.

- [ ] **Step 5: (checkpoint) compose e nginx**

```bash
$S 'cd ~/marketplace/infra && grep -q "^PUBLIC_URL=" .env.oci || echo "PUBLIC_URL=https://teste.mercadopreto.com.br" >> .env.oci; grep ^PUBLIC_URL .env.oci'
$S 'cd ~/marketplace/infra && docker run --rm --add-host host.docker.internal:host-gateway --add-host medusa:127.0.0.1 -v $PWD/nginx/oci:/etc/nginx/oci:ro -v $PWD/nginx/certbot/conf:/etc/nginx/ssl:ro nginx:alpine nginx -t -c /etc/nginx/oci/nginx.conf'
$S 'cd ~/marketplace/infra && docker compose -f docker-compose.oci.yml --env-file .env.oci up -d postgres redis meilisearch medusa certbot nginx'
$S 'docker ps --format "{{.Names}} {{.Status}} {{.Ports}}"'
```

Expected: `nginx -t` com `syntax is ok` e `test is successful`. Nenhuma porta `0.0.0.0` além de 80 e 443 no `docker ps`. `mercado-preto-evolution` **não** aparece.

Run: `infra/scripts/smoke-oci.sh teste.mercadopreto.com.br 168.138.148.67`
Expected: `port 7700` e `port 9000` passam a `ok`. Só `port 3000` continua `FAIL`.

- [ ] **Step 6: (checkpoint) iptables**

Adicionar a regra nova **antes** de remover a antiga, para o nginx não perder o storefront:

```bash
$S 'sudo iptables -I INPUT -s 172.16.0.0/12 -p tcp -m tcp --dport 3000 -j ACCEPT && for p in 3000 9000 8080 7700; do sudo iptables -D INPUT -p tcp -m tcp --dport $p -j ACCEPT; done && sudo iptables -L INPUT -n --line-numbers'
$S 'curl -s -o /dev/null -w "nginx->storefront: %{http_code}\n" -k --resolve teste.mercadopreto.com.br:443:127.0.0.1 https://teste.mercadopreto.com.br/'
$S 'sudo netfilter-persistent save'
```

Expected: o `INPUT` tem `ACCEPT tcp 172.16.0.0/12 dpt:3000` e não tem mais 3000, 7700, 8080 e 9000 abertas para `0.0.0.0/0`. O teste interno responde 200.

- [ ] **Step 7: (checkpoint) smoke verde e teste do resolver**

Run: `infra/scripts/smoke-oci.sh teste.mercadopreto.com.br 168.138.148.67`
Expected: tudo `ok`, exit 0.

```bash
$S 'cd ~/marketplace/infra && docker compose -f docker-compose.oci.yml --env-file .env.oci up -d --force-recreate medusa && for i in $(seq 1 40); do curl -sf -o /dev/null localhost:9000/health && break; sleep 3; done'
sleep 12; curl -s -o /dev/null -w "api via nginx após recriar medusa: %{http_code}\n" https://teste.mercadopreto.com.br/api/health
```

Expected: `200`, sem reiniciar o nginx.

- [ ] **Step 8: Ponta a ponta manual (com o usuário)**

- login do vendedor e aba "Avaliações" no painel;
- painel admin em `https://teste.mercadopreto.com.br/app` (login);
- upload de uma foto de produto com mais de 1 MB pelo painel;
- um checkout no sandbox do Mercado Pago. Conferir nos logs que o webhook chegou:
  `$S 'docker logs mercado-preto-api --since 15m 2>&1 | grep "/webhooks/mercadopago"'` → linha com `status":200`.

- [ ] **Step 9: Entregar ao usuário as ações externas**

- NSG da OCI: remover as regras de entrada de 3000, 7700, 8080 e 9000 (manter 22, 80 e 443);
- painel da ClearSale: se a URL do webhook apontar para `:9000`, trocar por `https://teste.mercadopreto.com.br/api/webhooks/clearsale`;
- depois do merge, voltar o servidor para `develop` (`git checkout develop && git pull --ff-only`). Sem rebuild: o conteúdo é o mesmo.

**Rollback (qualquer passo):**

```bash
$S 'cd ~/marketplace && git checkout -q develop && cp infra/.env.oci.bak.$T infra/.env.oci && cp apps/storefront/.env.local.bak.$T apps/storefront/.env.local'
$S 'sudo iptables-restore < ~/iptables.bak.$T && sudo netfilter-persistent save'
$S 'cd ~/marketplace/infra && docker compose -f docker-compose.oci.yml --env-file .env.oci up -d postgres redis meilisearch medusa certbot'
# nginx antigo (config de develop):
$S 'docker rm -f mercado-preto-nginx; cd ~/marketplace/infra && docker compose -f docker-compose.prod.yml up -d --no-deps nginx'
$S 'source ~/.nvm/nvm.sh >/dev/null; cd ~/marketplace/apps/storefront && pnpm build && pm2 restart storefront'
```
