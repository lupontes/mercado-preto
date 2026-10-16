# Endurecimento da borda do ambiente OCI: nginx no compose e portas fechadas

**Data:** 2026-10-15
**Escopo:** servidor de teste OCI (`168.138.148.67`, `teste.mercadopreto.com.br`).
O `docker-compose.prod.yml` fica fora do escopo.

## Objetivo

Todo o tráfego externo passa pelo `https://teste.mercadopreto.com.br` e só as
portas 22, 80 e 443 ficam acessíveis pela internet. Pagamento (webhooks do
Mercado Pago), imagens, painel do vendedor e painel admin continuam
funcionando. O nginx passa a ser gerenciado pelo `docker-compose.oci.yml`,
sem IP fixo.

**Critérios de sucesso:**

- de fora do servidor, 3000, 5433, 6380, 7700, 8080 e 9000 recusam conexão;
- home, `/api/health`, `/api/static/*` e `/_next/image` respondem 200 pelo
  domínio; a porta 80 redireciona para 443;
- recriar o container `medusa` não derruba a API atrás do nginx;
- login do vendedor, painel admin (`/app`) e um checkout no sandbox do
  Mercado Pago, com o webhook chegando, funcionam ponta a ponta.

## Situação atual (levantada em 2026-10-15)

- O container `mercado-preto-nginx` foi criado pelo `docker-compose.prod.yml`.
  Os dois composes ficam em `infra/`, então compartilham o nome de projeto
  Docker `infra`, e um `up --remove-orphans` do compose OCI apagaria o nginx.
- O `upstream storefront` aponta para `172.18.0.1:3000`, o gateway da rede
  bridge. Se a rede for recriada com outra faixa, o storefront fica
  inalcançável.
- O nginx resolve `medusa` só na subida. Se o `medusa` for recriado com outro
  IP, a API cai em 502 até o nginx reiniciar.
- O `nginx.conf` é montado como arquivo único. Um `git checkout` gera um inode
  novo e o mount continua no antigo, então o `reload` não vê a mudança.
- Abertas para a internet: 3000 (storefront HTTP, fora do nginx), 7700
  (Meilisearch com `MEILI_ENV: development`) e 9000 (backend). A 8080, a 5433
  e a 6380 são publicadas pelo Docker, mas estão bloqueadas na NSG.
- `BACKEND_URL=http://${SERVER_IP}:9000`. Ele é a base da `notification_url`
  do Mercado Pago, do callback OAuth do Mercado Livre e da URL dos uploads.
  CORS também usam o IP.
- O SSR do storefront usa `NEXT_PUBLIC_MEDUSA_URL=http://168.138.148.67:9000`.

Já corrigido antes deste spec: o volume de uploads no compose OCI (#57) e o
host do site no `remotePatterns` do `next/image`, junto com o
`NEXT_PUBLIC_SITE_URL` no servidor (#58).

## Decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| Portas no escopo | 9000, 3000, 7700 (e 5433/6380/8080 em `127.0.0.1`) | O trabalho e o teste ponta a ponta são os mesmos; a 7700 é a de maior risco |
| Storefront | Continua no PM2 no host | Mantém o fluxo de deploy recém-corrigido (#52); containerizar é outro sub-projeto |
| Camada de bloqueio | Na origem (bind em `127.0.0.1`, iptables), com a NSG como segunda camada | Portas publicadas pelo Docker não passam pela chain `INPUT`; depender só da NSG deixa a proteção fora do repo |

## Desenho

### Topologia final

```
Internet ──► :80/:443 ──► nginx (container, compose OCI)
                              ├─ /api/ /app/ /auth/ /admin/ /store/ /seller/ ──► medusa:9000 (rede Docker)
                              └─ /  ──► host.docker.internal:3000 (host-gateway) ──► PM2 storefront (host)

PM2 storefront (SSR) ──► http://localhost:9000 ──► medusa (publicado só em 127.0.0.1)
medusa ──► postgres / redis / meilisearch / evolution (rede Docker)
```

### Compose OCI (`infra/docker-compose.oci.yml`)

- `name: infra` explícito no topo, com comentário: mudar esse nome faz o
  Docker criar volumes novos e vazios (`<projeto>_postgres_data` etc.).
- Portas:
  - `medusa`: `127.0.0.1:9000:9000`;
  - `meilisearch`: sem `ports` (o backend usa `meilisearch:7700`);
  - `postgres`: `127.0.0.1:5433:5432`; `redis`: `127.0.0.1:6380:6379`;
    `evolution-api`: `127.0.0.1:8080:8080`.
- Serviço novo `nginx`:
  - `image: nginx:alpine` e `container_name: mercado-preto-nginx`. É o mesmo
    nome do container atual, que o compose assume e recria;
  - `ports: 80:80, 443:443`;
  - `extra_hosts: ["host.docker.internal:host-gateway"]`;
  - mount do **diretório** `./nginx/oci:/etc/nginx/oci:ro` no lugar do
    arquivo único, com `nginx -c /etc/nginx/oci/nginx.conf` no `command`, mais
    `certbot/conf → /etc/nginx/ssl` e `certbot/www → /var/www/certbot`, todos `:ro`;
  - `depends_on: medusa`;
  - o mesmo laço do `command` do prod (`nginx -s reload` a cada 6h, para pegar
    os certificados renovados), apontando para o config via `-c`.
- Comentários de cabeçalho atualizados: as portas da NSG passam a ser só 80 e
  443, e o comentário do certbot que diz "nginx não gerenciado por este
  compose" é corrigido.

### nginx (`infra/nginx/`)

- `resolver 127.0.0.11 valid=10s ipv6=off;` (o DNS interno do Docker).
- Os `proxy_pass` para o backend usam variável (`set $medusa_upstream
  http://medusa:9000;`), para o nome ser resolvido a cada requisição. Os
  prefixos que já existem continuam iguais: `/api/` remove o prefixo e
  `/app/`, `/auth/`, `/admin/`, `/store/` e `/seller/` passam o caminho. Com
  variável no `proxy_pass`, o nginx não substitui a URI sozinho, então `/api/`
  usa `rewrite ^/api/(.*)$ /$1 break;` seguido de `proxy_pass $medusa_upstream;`.
  Os outros prefixos usam `proxy_pass $medusa_upstream;`, que repassa a URI
  original.
- O storefront passa a usar `host.docker.internal:3000`, também por variável.
- O config do OCI vai para um arquivo novo, `infra/nginx/oci/nginx.conf`. O
  `infra/nginx/nginx.conf` atual continua montado pelo compose prod e não é
  alterado, para não acoplar a mudança ao prod (fora do escopo).

### Envs

Variável nova em `infra/.env.oci`: `PUBLIC_URL=https://teste.mercadopreto.com.br`
(e a entrada correspondente no template de env, se houver).

| Env (`medusa`) | Depois |
|---|---|
| `BACKEND_URL` | `${PUBLIC_URL}/api` |
| `STORE_CORS` | `${PUBLIC_URL}` |
| `ADMIN_CORS` | `${PUBLIC_URL}` |
| `AUTH_CORS` | `${PUBLIC_URL}` |

Efeitos:

- `notification_url` do Mercado Pago passa a ser `${PUBLIC_URL}/api/webhooks/mercadopago`.
  A assinatura `x-signature` não depende do caminho da URL;
- os uploads novos usam `${PUBLIC_URL}/api/static`, igual aos que já existem;
- o callback do Mercado Livre passa a ser `${PUBLIC_URL}/api/admin/marketplace-channel/callback`.
  Como a integração ainda não foi ativada, só o runbook muda.

Storefront (`apps/storefront/.env.local` no servidor, não versionado):
`NEXT_PUBLIC_MEDUSA_URL=http://localhost:9000`. O `docs/DEPLOY_OCI.md` é
atualizado para refletir isso.

### Firewall do host

- A regra `-A INPUT -p tcp --dport 3000 -j ACCEPT` passa a ser
  `-A INPUT -s 172.16.0.0/12 -p tcp --dport 3000 -j ACCEPT`, aceitando só as
  redes Docker. O `REJECT` final já existente bloqueia o resto.
- As regras `ACCEPT` de 7700, 8080 e 9000 na chain `INPUT` são removidas.
  Para portas publicadas pelo Docker elas não tinham efeito, e deixá-las
  confunde.
- A regra `ACCEPT 19999` não é tocada. Nada escuta nessa porta hoje, e ela
  fica registrada como achado a ser limpo à parte.
- A mudança é persistida com `sudo netfilter-persistent save`. O
  `iptables-persistent` já está instalado e as regras ficam em
  `/etc/iptables/rules.v4`.
- A NSG da OCI fica como segunda camada: o usuário remove 3000, 7700, 8080 e
  9000 pelo console.

## Ordem de deploy

1. #57 e #58 mergeados; o servidor em `develop`.
2. Rodar o smoke **antes**: as checagens de porta precisam falhar (teste vermelho).
3. Storefront: `NEXT_PUBLIC_MEDUSA_URL=http://localhost:9000` (com backup do
   `.env.local`), `pnpm build && pm2 restart storefront`.
4. `git pull` da branch da implementação; `nginx -t` no novo config com um
   container descartável; `docker compose -f docker-compose.oci.yml --env-file .env.oci up -d`.
5. iptables: `iptables-save` de backup, aplicar as regras e persistir.
6. Rodar o smoke **depois**: tudo verde.
7. Teste do `resolver`: `up -d --force-recreate medusa` e `/api/health`
   continuando 200 sem mexer no nginx.
8. Ponta a ponta manual: login do vendedor, `/app`, checkout no sandbox do
   Mercado Pago com o webhook visível nos logs do `medusa`.
9. Usuário: remover as regras na NSG; atualizar a URL do webhook no painel da
   ClearSale, se apontar para `:9000`.

## Rollback

- Código e compose: `git checkout <commit anterior>` no servidor, depois
  `docker compose ... up -d`.
- Firewall: `iptables-restore < backup`, mais a persistência.
- Storefront: restaurar o backup do `.env.local`, depois build e restart.
- Nenhum passo altera volumes ou dados.

## Testes

- `infra/scripts/smoke-oci.sh <domínio> <ip>`, versionado e rodado de fora do
  servidor:
  - home, `/api/health`, uma URL `/api/static/*` e um `/_next/image` com 200;
  - porta 80 com 301 para https;
  - 3000, 5433, 6380, 7700, 8080 e 9000 recusando conexão TCP;
  - código de saída diferente de zero em qualquer falha, com uma linha por
    checagem.
- `nginx -t` antes de aplicar.
- Teste do `resolver` (passo 7) e ponta a ponta manual (passo 8).

## Fora do escopo (registrar no handoff)

- O container da Evolution API não está rodando, então as notificações por
  WhatsApp estão paradas.
- Regra `ACCEPT 19999` no iptables sem nada escutando, a remover.
- Alinhar o `docker-compose.prod.yml` ao mesmo modelo.

## Efeitos de transição aceitos

- Preferências do Mercado Pago criadas antes do deploy mantêm a
  `notification_url` antiga (`:9000`) e não vão receber o webhook. É aceitável
  em ambiente de teste.
