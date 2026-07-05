#!/usr/bin/env bash
# Emissão inicial dos certificados Let's Encrypt para o stack de produção.
# Rode UMA ÚNICA VEZ, a partir do diretório infra/, ANTES do primeiro
# `docker compose -f docker-compose.prod.yml up -d`.
#
# Uso:
#   ./nginx/init-letsencrypt.sh           # emite certificado de produção
#   STAGING=1 ./nginx/init-letsencrypt.sh # emite certificado de teste (não conta no rate limit)

set -euo pipefail

if [ -f ./.env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

DOMAINS=(teste.mercadopreto.com.br)
RSA_KEY_SIZE=4096
DATA_PATH="./nginx/certbot"
EMAIL="${LETSENCRYPT_EMAIL:-admin@mercadopreto.com.br}"
STAGING="${STAGING:-0}"
COMPOSE="docker compose -f docker-compose.prod.yml"
PRIMARY_DOMAIN="${DOMAINS[0]}"

if [ -f "$DATA_PATH/conf/live/$PRIMARY_DOMAIN/fullchain.pem" ]; then
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
