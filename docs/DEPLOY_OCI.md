# Deploy — Ambiente de Testes Oracle Cloud (Ambiente B)

## Servidor

| Item | Valor |
|------|-------|
| IP | `168.138.148.67` |
| SSH | `ssh -i ~/.ssh/oci_vms ubuntu@168.138.148.67` |
| OS | Ubuntu 24.04 LTS ARM64 (Ampere A1) |
| CPU / RAM | 2 OCPUs / 12 GB |
| Docker | pré-instalado via cloud-init |

### Portas abertas (NSG Oracle Cloud + iptables)

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

---

## Arquitetura no servidor

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

O storefront roda como processo Node.js direto no host (não containerizado), pois é um monorepo pnpm e o build é feito no próprio servidor.

---

## Passo 1 — Acessar o servidor

```bash
ssh -i ~/.ssh/oci_vms ubuntu@168.138.148.67
```

---

## Passo 2 — Instalar Node.js 22 e pnpm

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22
nvm alias default 22
npm install -g pnpm@11.1.2
```

---

## Passo 3 — Clonar o repositório

```bash
git clone <url-do-repositorio> marketplace
cd marketplace
source ~/.bashrc && nvm use 22
pnpm install
```

---

## Passo 4 — Criar o database `evolution` no PostgreSQL

O Evolution API precisa de um banco separado. Ele é criado manualmente antes do primeiro start:

```bash
# Suba apenas o postgres primeiro
docker compose -f infra/docker-compose.oci.yml --env-file infra/.env.oci up -d postgres

# Aguarde o healthcheck ficar healthy, depois crie o banco evolution
sleep 15
docker exec mercado-preto-db psql -U <DB_USER> -c "CREATE DATABASE evolution;"
```

---

## Passo 5 — Configurar variáveis de ambiente

### 5.1 Infra (Docker Compose)

```bash
nano infra/.env.oci
```

```env
# ── Identificação do servidor ──────────────────────────────
SERVER_IP=168.138.148.67

# ── PostgreSQL ─────────────────────────────────────────────
DB_USER=medusa
DB_PASSWORD=<senha_forte>
DB_NAME=mercado_preto

# ── Meilisearch ────────────────────────────────────────────
# Gerar: openssl rand -hex 32
MEILI_MASTER_KEY=<chave_forte>

# ── Evolution API ──────────────────────────────────────────
EVOLUTION_API_KEY=<chave_forte>
EVOLUTION_API_INSTANCE=mercadopreto
EVOLUTION_WEBHOOK_SECRET=

# ── Medusa backend ─────────────────────────────────────────
# Gerar: openssl rand -hex 32
JWT_SECRET=<32-bytes-hex>
COOKIE_SECRET=<32-bytes-hex>

# MercadoPago (sandbox: prefixo TEST-)
MERCADOPAGO_ACCESS_TOKEN=TEST-...
MERCADOPAGO_WEBHOOK_SECRET=

# Melhor Envio (opcional)
# no servidor de teste: token do SANDBOX do Melhor Envio (nunca o de produção)
MELHOR_ENVIO_TOKEN=
SHIPPING_HANDLING_DAYS=2

# Brevo e-mail (opcional)
BREVO_API_KEY=
EMAIL_FROM=noreply@mercadopreto.com.br

# Focus NFe (opcional)
FOCUS_NFE_TOKEN=
FOCUS_NFE_SANDBOX=true
FOCUS_NFE_CNPJ=
FOCUS_NFE_IE=
FOCUS_NFE_ADDRESS_STREET=
FOCUS_NFE_ADDRESS_NUMBER=
FOCUS_NFE_ADDRESS_DISTRICT=
FOCUS_NFE_ADDRESS_CITY=Cachoeira
FOCUS_NFE_ADDRESS_STATE=BA
FOCUS_NFE_ADDRESS_ZIP=44300000

MARKETPLACE_COMMISSION_RATE=15
```

### 5.2 Backend Medusa

```bash
nano packages/medusa-backend/apps/backend/.env
```

```env
DATABASE_URL=postgres://<DB_USER>:<DB_PASSWORD>@localhost:5433/mercado_preto
REDIS_URL=redis://localhost:6380

JWT_SECRET=<mesmo JWT_SECRET do .env.oci>
COOKIE_SECRET=<mesmo COOKIE_SECRET do .env.oci>

# No OCI, estes valores vêm do compose a partir de PUBLIC_URL (.env.oci)
PUBLIC_URL=https://teste.mercadopreto.com.br
# STORE_CORS / ADMIN_CORS / AUTH_CORS = ${PUBLIC_URL}
# BACKEND_URL = ${PUBLIC_URL}/api

MERCADOPAGO_ACCESS_TOKEN=TEST-...
MERCADOPAGO_WEBHOOK_SECRET=

MEILISEARCH_HOST=http://localhost:7700   # dentro do Docker, o compose usa http://meilisearch:7700
MEILISEARCH_API_KEY=<mesmo MEILI_MASTER_KEY>

EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=<mesmo EVOLUTION_API_KEY>
EVOLUTION_API_INSTANCE=mercadopreto
EVOLUTION_WEBHOOK_SECRET=

# no servidor de teste: token do SANDBOX do Melhor Envio (nunca o de produção)
MELHOR_ENVIO_TOKEN=
SHIPPING_HANDLING_DAYS=2

BREVO_API_KEY=
EMAIL_FROM=noreply@mercadopreto.com.br

FOCUS_NFE_TOKEN=
FOCUS_NFE_SANDBOX=true
FOCUS_NFE_CNPJ=
FOCUS_NFE_IE=
FOCUS_NFE_ADDRESS_STREET=
FOCUS_NFE_ADDRESS_NUMBER=
FOCUS_NFE_ADDRESS_DISTRICT=
FOCUS_NFE_ADDRESS_CITY=Cachoeira
FOCUS_NFE_ADDRESS_STATE=BA
FOCUS_NFE_ADDRESS_ZIP=44300000

MARKETPLACE_COMMISSION_RATE=15
NODE_ENV=production
```

### 5.3 Storefront Next.js

```bash
nano apps/storefront/.env.local
```

```env
# Só o SSR usa esta URL; o navegador chama caminhos relativos via nginx.
NEXT_PUBLIC_MEDUSA_URL=http://127.0.0.1:9000
NEXT_PUBLIC_SITE_URL=https://teste.mercadopreto.com.br
NEXT_PUBLIC_PUBLISHABLE_KEY=pk_...       # obtido após seeds (ver Passo 7)
NEXT_PUBLIC_REGION_ID=reg_...            # obtido após seeds (ver Passo 7)
NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY=TEST-...
NEXT_PUBLIC_CHATWOOT_URL=
NEXT_PUBLIC_CHATWOOT_TOKEN=
```

> `NEXT_PUBLIC_PUBLISHABLE_KEY` e `NEXT_PUBLIC_REGION_ID` são obtidos após o Passo 7 (seeds). Preencha-os antes de rodar o build do storefront.

---

## Passo 6 — Subir infraestrutura e backend

**Atenção:** o `CMD` do container do backend é só `medusa start` — ele **não**
roda migrations sozinho. Rode `db:migrate` manualmente contra a imagem nova
antes de subir o serviço (mesmo em instalação nova, e sempre que um módulo
novo com migração própria for adicionado — ex: o módulo `review`).

**Atenção (2026-09-07):** `DATABASE_URL` no `docker-compose.oci.yml`
precisa terminar em `?sslmode=disable`. Sem isso, o driver `pg` trava
indefinidamente (retry silencioso a cada 60s, sem nenhum erro logado)
negociando TLS com um Postgres que não fala SSL — travou `db:migrate` por
horas antes de ser root-caused via bisecção empírica de variáveis de
ambiente. Já corrigido no compose file; só relevante se `DATABASE_URL` for
reconstruído manualmente fora dele.

```bash
cd ~/marketplace

# Subir a infraestrutura (banco, redis etc.) e construir a imagem nova, sem
# subir o serviço medusa ainda
docker compose -f infra/docker-compose.oci.yml --env-file infra/.env.oci up -d --build --no-deps postgres redis
docker compose -f infra/docker-compose.oci.yml --env-file infra/.env.oci build medusa

# Rodar as migrations contra a imagem nova, antes de servir tráfego
docker compose -f infra/docker-compose.oci.yml --env-file infra/.env.oci run --rm medusa npx medusa db:migrate

# Só então subir o backend
docker compose -f infra/docker-compose.oci.yml --env-file infra/.env.oci up -d medusa

# Aguardar o Medusa inicializar
docker compose -f infra/docker-compose.oci.yml logs -f medusa
# Aguardar: "Listening on http://0.0.0.0:9000"
```

Da sua máquina, na raiz do repo (não no servidor):

```bash
infra/scripts/smoke-oci.sh teste.mercadopreto.com.br 168.138.148.67
```

---

## Passo 7 — Seeds e configuração inicial do Medusa

```bash
# Verificar que o backend está respondendo
curl -s https://teste.mercadopreto.com.br/api/health

# Criar usuário admin
docker exec mercado-preto-api node_modules/.bin/medusa user -e admin@mercadopreto.com.br -p <senha>

# Acessar o painel admin e configurar:
# https://teste.mercadopreto.com.br/app
# 1. Settings → Regions → criar região "Brasil" (moeda BRL, país BR)
#    → copiar o ID da URL (reg_xxx) → usar em NEXT_PUBLIC_REGION_ID
# 2. Settings → API Keys → criar Publishable Key
#    → copiar o valor (pk_xxx) → usar em NEXT_PUBLIC_PUBLISHABLE_KEY
# 3. Settings → Sales Channels → confirmar "Default Sales Channel" existe
```

---

## Passo 8 — Build e start do storefront

```bash
source ~/.bashrc && nvm use 22

# Após preencher NEXT_PUBLIC_PUBLISHABLE_KEY e NEXT_PUBLIC_REGION_ID no .env.local:
cd apps/storefront
pnpm build
# `pnpm build` dispara automaticamente o script `postbuild`, que copia
# `public/` e `.next/static/` para dentro de `.next/standalone/` — o
# Next.js não inclui esses diretórios no bundle standalone por padrão.

# Rodar em produção (porta 3000)
# Importante: next.config.ts usa `output: 'standalone'`, então NÃO se pode
# rodar com `next start` (ele loga
# '"next start" does not work with "output: standalone" configuration' e
# não serve o bundle standalone corretamente). O script `start` do
# package.json já chama `node .next/standalone/apps/storefront/server.js`,
# com `HOSTNAME=0.0.0.0` fixo: o server standalone escuta em
# `process.env.HOSTNAME`, e se o PM2 herdar o nome da máquina nessa variável
# ... o nginx (no Docker, via host.docker.internal:3000) deixa de alcançar o storefront.
pnpm start &
```

Para manter o processo rodando após desconectar o SSH, use PM2:

```bash
npm install -g pm2
pm2 start "pnpm start" --name storefront --cwd ~/marketplace/apps/storefront
pm2 save
pm2 startup   # gerar comando de auto-start e executá-lo
```

Da sua máquina, na raiz do repo (não no servidor):

```bash
infra/scripts/smoke-oci.sh teste.mercadopreto.com.br 168.138.148.67
```

---

## Passo 9 — Conectar Evolution API ao WhatsApp

> **Importante:** O WhatsApp bloqueia conexões de IPs de datacenter (Oracle Cloud). Use **pairing code** em vez de QR code — funciona melhor com IPs de cloud.

```bash
# 1. Criar instância
curl -X POST http://127.0.0.1:8080/instance/create \
  -H "apikey: <EVOLUTION_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"instanceName":"mercadopreto","integration":"WHATSAPP-BAILEYS"}'

# 2. Conectar via pairing code (substitua <NUMERO> pelo seu WhatsApp com DDD)
curl "http://127.0.0.1:8080/instance/connect/mercadopreto?number=<NUMERO>" \
  -H "apikey: <EVOLUTION_API_KEY>"

# Exemplo: number=5511999999999 (formato: 55 + DDD + número)

# 3. O WhatsApp exibirá um código de 8 dígitos
#    No WhatsApp: Dispositivos vinculados → Vincular dispositivo → Digitar código

# 4. Confirmar conexão
curl http://127.0.0.1:8080/instance/fetchInstances \
  -H "apikey: <EVOLUTION_API_KEY>"
```

### Troubleshooting: "não foi possível conectar o dispositivo"

Se o pairing code não funcionar, verificar:

1. **Número correto:** Formato `55` + DDD + número (ex: `5511999999999`)
2. **WhatsApp atualizado:** Versão mais recente do WhatsApp no celular
3. **Reiniciar instância:** `curl -X DELETE http://127.0.0.1:8080/instance/delete/mercadopreto -H "apikey: <EVOLUTION_API_KEY>"` e refazer o processo
4. **Alternativa:** Usar VPS residencial (IP não-datacenter) ou API oficial WhatsApp Business

---

## Etiquetas do Melhor Envio

Com a funcionalidade ligada, cada pedido de loja recebe uma etiqueta comprada automaticamente assim que o pagamento no Mercado Pago é aprovado. O seller recebe o link da etiqueta por WhatsApp e e-mail, e também a vê no portal. O job `shipping-label-tracking` atualiza o status do envio a cada 2 h.

**Ativar**: em `infra/.env.oci` defina `MELHOR_ENVIO_LABELS_ENABLED=true` e recrie o backend:

```bash
docker compose -f infra/docker-compose.oci.yml --env-file infra/.env.oci up -d --force-recreate medusa
```

- **Saldo**: a compra debita a carteira do Melhor Envio. No sandbox, adicione saldo fictício no painel do sandbox.
- **Alertas**: defina `ADMIN_ALERT_EMAIL` para receber o aviso de compras que falharam.
- **Falhas**: aparecem na página do pedido no admin, com as ações "Comprar etiqueta de novo" e "Cancelar etiqueta".
- **Checkout**: agora exige Número e Bairro no endereço de entrega.
- **Produção**: exige o aplicativo OAuth do Melhor Envio (próximo ciclo); tokens pessoais só funcionam no sandbox. Por isso `MELHOR_ENVIO_WEBHOOK_SECRET` fica vazio por ora e o status vem só do job.

---

## Validação final

```bash
# Medusa API
curl -s https://teste.mercadopreto.com.br/api/health

# Admin panel
# https://teste.mercadopreto.com.br/app

# Storefront
curl -s -o /dev/null -w "%{http_code}" https://teste.mercadopreto.com.br/

# O Evolution manager não é público: use túnel SSH
# ssh -i ~/.ssh/oci_vms -L 8080:127.0.0.1:8080 ubuntu@168.138.148.67
# e abra http://localhost:8080/manager
```

Da sua máquina, na raiz do repo (não no servidor):

```bash
infra/scripts/smoke-oci.sh teste.mercadopreto.com.br 168.138.148.67
```

### URLs de acesso

| Serviço | URL |
|---------|-----|
| Medusa API | https://teste.mercadopreto.com.br/api |
| Medusa Admin | https://teste.mercadopreto.com.br/app |
| Storefront | https://teste.mercadopreto.com.br |
| Evolution API | interno (túnel SSH para `127.0.0.1:8080`) |
| Meilisearch | interno (rede Docker, porta 7700) |

---

## Operação

```bash
# Logs de todos os containers
docker compose -f infra/docker-compose.oci.yml logs -f

# Logs de um serviço específico
docker compose -f infra/docker-compose.oci.yml logs -f medusa

# Status do storefront
pm2 status

# Logs do storefront
pm2 logs storefront

# Rebuild do Medusa após mudanças no código
docker compose -f infra/docker-compose.oci.yml build medusa
docker compose -f infra/docker-compose.oci.yml up -d medusa

# Rebuild do storefront após mudanças
# (o `postbuild` do package.json já recopia public/ e .next/static/ para
# dentro de .next/standalone/; `pm2 restart` volta a chamar `pnpm start`,
# que executa node .next/standalone/apps/storefront/server.js)
cd ~/marketplace/apps/storefront
pnpm build && pm2 restart storefront
```

Da sua máquina, na raiz do repo (não no servidor):

```bash
infra/scripts/smoke-oci.sh teste.mercadopreto.com.br 168.138.148.67
```

---

## Atualizar após push no repositório

```bash
ssh -i ~/.ssh/oci_vms ubuntu@168.138.148.67
cd marketplace
git pull
source ~/.bashrc && nvm use 22
pnpm install

# Rebuild backend
docker compose -f infra/docker-compose.oci.yml build medusa

# Rodar migrations contra a imagem nova ANTES de subir o serviço — o CMD do
# container é só "medusa start", não migra sozinho. Necessário sempre que um
# módulo novo com migração própria for adicionado (ex: review).
docker compose -f infra/docker-compose.oci.yml run --rm medusa npx medusa db:migrate

docker compose -f infra/docker-compose.oci.yml up -d medusa

# Rebuild storefront
# (mesmo aviso do Passo 8: `pnpm start`/`pm2 restart` precisam continuar
# apontando para o servidor standalone, nunca para `next start`)
cd apps/storefront
pnpm build && pm2 restart storefront
```

Da sua máquina, na raiz do repo (não no servidor):

```bash
infra/scripts/smoke-oci.sh teste.mercadopreto.com.br 168.138.148.67
```

---

## Observações

- **Meilisearch**: no ambiente local (docker-compose.yml) a porta do host é `7701`. No OCI o Meilisearch não é publicado: só os containers da rede Docker o acessam (sem porta publicada, nem em `127.0.0.1`). Para acesso eventual, use `docker exec mercado-preto-search ...` ou um túnel para o IP do container (`docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' mercado-preto-search`).
- **BACKEND_URL**: no OCI é derivado de `PUBLIC_URL` (HTTPS, `${PUBLIC_URL}/api`), então o `auto_return` do MercadoPago funciona.
- **Evolution API volumes**: o diretório `evolution_data` contém as chaves de sessão do WhatsApp. Faça backup antes de destruir os volumes.
- **Certificado HTTPS**: o Let's Encrypt emite certificados de 90 dias. A renovação é feita pelo serviço `certbot` do `docker-compose.oci.yml` (tenta a cada 12h; só renova a menos de 30 dias do vencimento) e o `mercado-preto-nginx` recarrega a cada 6h. Garanta que ele está rodando com `docker ps | grep certbot`; se não estiver: `docker compose -f infra/docker-compose.oci.yml --env-file infra/.env.oci up -d certbot`. Para conferir o vencimento: `echo | openssl s_client -connect teste.mercadopreto.com.br:443 -servername teste.mercadopreto.com.br 2>/dev/null | openssl x509 -noout -enddate`.
- **PM2**: mantém o storefront rodando como daemon no servidor. Use `pm2 logs storefront` para acompanhar erros em tempo real.
- **Pagamento "Dinheiro (teste)"**: para percorrer o checkout sem o Mercado Pago, defina `TEST_CASH_PAYMENT_ENABLED=true` em `infra/.env.oci` (no servidor de testes) e recrie o container `medusa` com `docker compose -f infra/docker-compose.oci.yml --env-file infra/.env.oci up -d medusa`. A opção aparece na etapa de entrega do checkout. Nunca declarar essa variável em `docker-compose.prod.yml` — com `MARKETPLACE_SANDBOX=false` o backend recusa subir.
