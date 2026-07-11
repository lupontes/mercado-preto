# Deploy — Produção (TLS com Let's Encrypt)

Este guia documenta o passo de emissão do certificado TLS antes de subir o
stack de produção (`infra/docker-compose.prod.yml`).

## Pré-requisitos

- DNS de `teste.mercadopreto.com.br` já apontando (registro A) para o IP
  público do servidor. O domínio raiz (`mercadopreto.com.br` / `www`)
  continua apontando pra loja atual — não é tocado por este deploy.
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
rm -rf nginx/certbot/conf/live/teste.mercadopreto.com.br \
       nginx/certbot/conf/archive/teste.mercadopreto.com.br \
       nginx/certbot/conf/renewal/teste.mercadopreto.com.br.conf
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

## Painel administrativo (Medusa Admin)

O painel fica em **`https://<domínio>/app`** (não `/api/app`). O admin SPA
é construído com base path fixo `/app/` e faz suas próprias chamadas de API
(`/auth/*`, `/admin/*`) sem prefixo — por isso `nginx.conf` precisa de
`location /app/`, `location /auth/` e `location /admin/` dedicados, além do
`location /api/` usado pelo storefront. Sem essas três rotas, o painel abre
em branco ou o login não faz nada (a requisição de login cai no catch-all
do storefront e retorna 404 silenciosamente).

Criar o usuário admin (uma vez, depois do stack subir):

```bash
docker compose -f docker-compose.prod.yml exec medusa npx medusa user -e <email> -p <senha>
```

## Aplicando mudanças no `nginx.conf` depois do deploy inicial

`nginx.conf` é montado como *bind mount de arquivo único*
(`./nginx/nginx.conf:/etc/nginx/nginx.conf:ro`). Um `git pull` no servidor
substitui o arquivo via rename, não edição in-place — o container mantém o
mount preso ao inode antigo, e `nginx -s reload` **não** resolve isso (o
teste de sintaxe passa, mas o processo continua servindo a config velha).

```bash
# Depois de git pull trazer um nginx.conf novo:
docker compose -f docker-compose.prod.yml exec nginx nginx -t   # valida sintaxe
docker compose -f docker-compose.prod.yml up -d --force-recreate nginx   # recria o container, não só recarrega
```

Confirmar que pegou a config nova:

```bash
docker exec mercado-preto-nginx cat /etc/nginx/nginx.conf | grep "location /app"
```
