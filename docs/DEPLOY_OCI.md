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

| Porta | Protocolo | Serviço | Descrição | Restrição |
|-------|-----------|---------|-----------|-----------|
| `22` | TCP | SSH | Acesso remoto | Chave pública |
| `9000` | TCP | Medusa backend | API + Admin | Acesso externo |
| `3000` | TCP | Next.js storefront | Vitrine pública | Acesso externo |
| `8080` | TCP | Evolution API | WhatsApp (Baileys) | Acesso externo |
| `7700` | TCP | Meilisearch | Dashboard de busca | Pode ser restrito ao IP da equipe |
| `19999` | TCP | Netdata | Monitoramento | Dashboard de métricas |

### Configuração de Firewall (UFW + iptables)

```bash
# UFW
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 3000/tcp
sudo ufw allow 9000/tcp
sudo ufw allow 8080/tcp
sudo ufw allow 7700/tcp
sudo ufw allow 19999/tcp
sudo ufw --force enable

# iptables (backup para persistência)
for port in 22 3000 9000 8080 7700 19999; do
  sudo iptables -I INPUT -p tcp --dport $port -j ACCEPT
done
sudo netfilter-persistent save
```

---

## Arquitetura no servidor

```
Internet
  │
  ├── :9000 → Medusa backend (container)
  ├── :3000 → Next.js storefront (processo Node.js)
  ├── :8080 → Evolution API (container)
  ├── :7700 → Meilisearch (container)
  └── :19999 → Netdata (monitoramento)

Interno (sem porta externa):
  PostgreSQL, Redis
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
MELHOR_ENVIO_TOKEN=
MELHOR_ENVIO_ORIGIN_CEP=44300000

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

STORE_CORS=http://168.138.148.67:3000
ADMIN_CORS=http://168.138.148.67:9000
AUTH_CORS=http://168.138.148.67:3000,http://168.138.148.67:9000

MERCADOPAGO_ACCESS_TOKEN=TEST-...
MERCADOPAGO_WEBHOOK_SECRET=
BACKEND_URL=http://168.138.148.67:9000

MEILISEARCH_HOST=http://localhost:7700
MEILISEARCH_API_KEY=<mesmo MEILI_MASTER_KEY>

EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=<mesmo EVOLUTION_API_KEY>
EVOLUTION_API_INSTANCE=mercadopreto
EVOLUTION_WEBHOOK_SECRET=

MELHOR_ENVIO_TOKEN=
MELHOR_ENVIO_ORIGIN_CEP=44300000

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
NODE_ENV=development
```

### 5.3 Storefront Next.js

```bash
nano apps/storefront/.env.local
```

```env
NEXT_PUBLIC_MEDUSA_URL=http://168.138.148.67:9000
NEXT_PUBLIC_PUBLISHABLE_KEY=pk_...       # obtido após seeds (ver Passo 7)
NEXT_PUBLIC_REGION_ID=reg_...            # obtido após seeds (ver Passo 7)
NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY=TEST-...
NEXT_PUBLIC_CHATWOOT_URL=
NEXT_PUBLIC_CHATWOOT_TOKEN=
```

> `NEXT_PUBLIC_PUBLISHABLE_KEY` e `NEXT_PUBLIC_REGION_ID` são obtidos após o Passo 7 (seeds). Preencha-os antes de rodar o build do storefront.

---

## Passo 6 — Subir infraestrutura e backend

```bash
cd ~/marketplace

# Subir toda a infraestrutura + Medusa backend
docker compose -f infra/docker-compose.oci.yml --env-file infra/.env.oci up -d --build

# Aguardar o Medusa inicializar (migrations automáticas no CMD do container)
docker compose -f infra/docker-compose.oci.yml logs -f medusa
# Aguardar: "Listening on http://0.0.0.0:9000"
```

---

## Passo 7 — Seeds e configuração inicial do Medusa

```bash
# Verificar que o backend está respondendo
curl -s http://168.138.148.67:9000/health

# Criar usuário admin
docker exec mercado-preto-api node_modules/.bin/medusa user -e admin@mercadopreto.com.br -p <senha>

# Acessar o painel admin e configurar:
# http://168.138.148.67:9000/app
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

# Rodar em produção (porta 3000)
pnpm start &
```

Para manter o processo rodando após desconectar o SSH, use PM2:

```bash
npm install -g pm2
pm2 start "pnpm start" --name storefront --cwd ~/marketplace/apps/storefront
pm2 save
pm2 startup   # gerar comando de auto-start e executá-lo
```

---

## Passo 9 — Conectar Evolution API ao WhatsApp

> **Importante:** O WhatsApp bloqueia conexões de IPs de datacenter (Oracle Cloud). Use **pairing code** em vez de QR code — funciona melhor com IPs de cloud.

```bash
# 1. Criar instância
curl -X POST http://168.138.148.67:8080/instance/create \
  -H "apikey: <EVOLUTION_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"instanceName":"mercadopreto","integration":"WHATSAPP-BAILEYS"}'

# 2. Conectar via pairing code (substitua <NUMERO> pelo seu WhatsApp com DDD)
curl "http://168.138.148.67:8080/instance/connect/mercadopreto?number=<NUMERO>" \
  -H "apikey: <EVOLUTION_API_KEY>"

# Exemplo: number=5511999999999 (formato: 55 + DDD + número)

# 3. O WhatsApp exibirá um código de 8 dígitos
#    No WhatsApp: Dispositivos vinculados → Vincular dispositivo → Digitar código

# 4. Confirmar conexão
curl http://168.138.148.67:8080/instance/fetchInstances \
  -H "apikey: <EVOLUTION_API_KEY>"
```

### Troubleshooting: "não foi possível conectar o dispositivo"

Se o pairing code não funcionar, verificar:

1. **Número correto:** Formato `55` + DDD + número (ex: `5511999999999`)
2. **WhatsApp atualizado:** Versão mais recente do WhatsApp no celular
3. **Reiniciar instância:** `curl -X DELETE http://168.138.148.67:8080/instance/delete/mercadopreto -H "apikey: <EVOLUTION_API_KEY>"` e refazer o processo
4. **Alternativa:** Usar VPS residencial (IP não-datacenter) ou API oficial WhatsApp Business

---

## Validação final

```bash
# Medusa API
curl -s http://168.138.148.67:9000/health

# Admin panel
# http://168.138.148.67:9000/app

# Storefront
curl -s -o /dev/null -w "%{http_code}" http://168.138.148.67:3000

# Meilisearch dashboard
# http://168.138.148.67:7700

# Evolution API manager
# http://168.138.148.67:8080/manager
```

### URLs de acesso

| Serviço | URL |
|---------|-----|
| Medusa API | http://168.138.148.67:9000 |
| Medusa Admin | http://168.138.148.67:9000/app |
| Storefront | http://168.138.148.67:3000 |
| Evolution API | http://168.138.148.67:8080 |
| Meilisearch | http://168.138.148.67:7700 |
| Netdata | http://168.138.148.67:19999 |

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
cd ~/marketplace/apps/storefront
pnpm build && pm2 restart storefront
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
docker compose -f infra/docker-compose.oci.yml up -d medusa

# Rebuild storefront
cd apps/storefront
pnpm build && pm2 restart storefront
```

---

## Observações

- **Meilisearch**: no ambiente local (docker-compose.yml) a porta do host é `7701`. No servidor OCI usa-se `7700:7700` para bater com a porta aberta no NSG.
- **BACKEND_URL**: em testes aponta para o IP público sem HTTPS. O MercadoPago exige HTTPS em produção — nesse caso o `auto_return` fica desabilitado automaticamente pelo backend.
- **Evolution API volumes**: o diretório `evolution_data` contém as chaves de sessão do WhatsApp. Faça backup antes de destruir os volumes.
- **PM2**: mantém o storefront rodando como daemon no servidor. Use `pm2 logs storefront` para acompanhar erros em tempo real.
