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
