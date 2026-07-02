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
