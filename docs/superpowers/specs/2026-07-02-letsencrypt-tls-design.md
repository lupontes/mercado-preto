# Design: TLS via Let's Encrypt para Produção

**Data**: 2026-07-02
**Status**: Aprovado
**Item relacionado**: Fase 6 do roadmap (`docs/RELATORIO_STACK_E_PROGRESSO.md`) — "HTTPS/TLS em produção"

## Contexto

`infra/nginx/nginx.conf` já tem um bloco `server { listen 443 ssl http2; ... }` configurado para os domínios `mercadopreto.com.br` e `www.mercadopreto.com.br`, apontando para `ssl_certificate /etc/nginx/ssl/cert.pem` e `ssl_certificate_key /etc/nginx/ssl/key.pem`. Nada no projeto gera esses arquivos — é um gap conhecido, documentado no roadmap como pendente.

O DNS de `mercadopreto.com.br` (e `www`) já aponta (registro A) para o IP público do servidor de produção, então o desafio HTTP-01 do Let's Encrypt é viável sem depender de DNS-01 ou de um provedor terceiro.

## Decisão

Usar **Certbot containerizado** dentro do próprio `docker-compose.prod.yml`, com um script de bootstrap para resolver o problema de "ovo e galinha" (nginx não sobe sem certificado; certbot não emite certificado sem nginx servindo HTTP). Esse é o padrão consagrado conhecido como "nginx-certbot cookbook".

### Alternativas consideradas e descartadas

| Alternativa | Por que não |
|---|---|
| Cloudflare + Origin Certificate | Introduz dependência externa nova e muda como o tráfego chega ao servidor — mudança de arquitetura maior do que o necessário para só "adicionar TLS". |
| Trocar nginx por Caddy | Resolve o problema de forma mais simples a longo prazo, mas exige reescrever `nginx.conf` como `Caddyfile` e trocar a imagem base — blast radius desnecessário para esta mudança pontual. |

## Componentes

### 1. `infra/nginx/nginx.conf`

- Bloco `:80` ganha `location /.well-known/acme-challenge/ { root /var/www/certbot; }`, servido **antes** do redirect para HTTPS (para não quebrar o desafio ACME).
- Bloco `:443` passa a apontar para a estrutura padrão do certbot:
  - `ssl_certificate /etc/nginx/ssl/live/mercadopreto.com.br/fullchain.pem`
  - `ssl_certificate_key /etc/nginx/ssl/live/mercadopreto.com.br/privkey.pem`

### 2. `infra/docker-compose.prod.yml`

- Novo serviço `certbot` (imagem oficial `certbot/certbot`):
  - Monta `./nginx/certbot/conf:/etc/letsencrypt` (mesmo volume que o nginx lê em `/etc/nginx/ssl`)
  - Monta `./nginx/certbot/www:/var/www/certbot` (mesmo webroot que o nginx serve em `/.well-known/acme-challenge/`)
  - Entrypoint em loop: `certbot renew --webroot -w /var/www/certbot`, repetindo a cada 12h.
- Serviço `nginx` ganha:
  - Volume adicional `./nginx/certbot/www:/var/www/certbot:ro`
  - `command` customizado que recarrega a configuração periodicamente (a cada 6h, via `nginx -s reload`) para pegar certificados renovados sem downtime.

### 3. `infra/nginx/init-letsencrypt.sh` (novo)

Script de bootstrap, executado **manualmente uma única vez**, antes do primeiro `docker compose -f docker-compose.prod.yml up -d` em produção:

1. Gera um certificado dummy self-signed em `./nginx/certbot/conf/live/mercadopreto.com.br/` (para o nginx conseguir subir com o bloco 443 configurado).
2. Sobe o stack (`docker compose up -d nginx`).
3. Remove o certificado dummy.
4. Roda `certbot certonly --webroot` para emitir o certificado real (com flag `--staging` disponível para teste sem consumir rate limit de produção).
5. Recarrega o nginx (`docker compose exec nginx nginx -s reload`).

### 4. `infra/.env.template`

Nova variável:
```
LETSENCRYPT_EMAIL=admin@mercadopreto.com.br
```

### 5. `docs/DEPLOY_OCI.md`

Nova seção documentando o passo de bootstrap: quando rodar `init-letsencrypt.sh`, o que esperar, e como testar em modo staging antes de emitir o certificado real.

## Erros e edge cases

- **Certbot falha ao emitir/renovar** (rate limit do Let's Encrypt, DNS não propagado, porta 80 bloqueada): nginx continua servindo com o certificado dummy ou o certificado anterior ainda válido — o stack não cai.
- **Renovação falha silenciosamente**: certbot loga no stdout do container, visível via `docker logs mercado-preto-certbot`. Não há alerta automático nesta primeira versão — fora de escopo.
- **Primeira execução sem `init-letsencrypt.sh`**: nginx falha ao subir (arquivo de certificado inexistente). Documentado explicitamente no `DEPLOY_OCI.md` como pré-requisito.

## Teste

Validar o fluxo completo em modo `--staging` do Let's Encrypt antes de emitir o certificado de produção, para evitar consumir o rate limit real (5 certificados/domínio/semana).

## Fora de escopo

- Alertas automáticos de falha de renovação (e-mail/Slack).
- Suporte a múltiplos domínios além de `mercadopreto.com.br` / `www.mercadopreto.com.br`.
- Wildcard certificates (exigiriam DNS-01).
