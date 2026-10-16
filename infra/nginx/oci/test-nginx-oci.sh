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

# whoami reserves /health (empty 200), so the probe uses /ping.
check api-strip        "GET /ping HTTP"                           "$(get /api/ping)"
check api-target       "Name: medusa"                             "$(get /api/ping)"
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
check resolver         "Name: medusa"                             "$(get /api/ping)"

exit "$FAILED"
