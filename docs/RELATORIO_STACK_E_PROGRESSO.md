# Relatório — Stack Tecnológica e Progressão do Projeto

> Gerado em: 2026-06-29
> Projeto: Mercado Preto Marketplace

---

## Stack Tecnológica

### Motor do Marketplace (Backend)

| Tecnologia | Versão | Função |
|-----------|--------|--------|
| **Medusa.js v2** | 2.15.2 | Engine headless de e-commerce — pedidos, produtos, variantes, carrinho, auth |
| **Node.js** | ≥22 | Runtime de execução |
| **TypeScript** | ^5.8 | Tipagem estática |
| **Zod** | 4.2 | Validação de schemas (input sanitization) |

**Módulos customizados do marketplace:**
- `seller` — cadastro, aprovação, suspensão de lojistas
- `commission` — cálculo automático de repasse (default 15%)
- `payout` — rastreamento de desembolsos a vendedores
- `fiscal` — emissão NF-e via Focus NFe
- `mercadopago` — provider de pagamento customizado

### Vitrine Digital (Frontend)

| Tecnologia | Versão | Função |
|-----------|--------|--------|
| **Next.js** | 15.3.2 | Framework React (SSR/SSG) |
| **React** | 19 | UI library |
| **Tailwind CSS** | 4.1 | Estilização utility-first |
| **Zustand** | 5.0 | State management (carrinho) |
| **Lucide React** | 0.511 | Ícones |
| **MercadoPago SDK React** | 1.0.7 | Checkout Bricks (tokenização de cartão) |

### Banco de Dados e Cache

| Serviço | Versão | Função |
|---------|--------|--------|
| **PostgreSQL** | 16 | Banco principal (produtos, pedidos, vendedores, comissões) |
| **Redis** | 7 | Cache, filas de eventos (Medusa), sessões (Evolution API) |
| **Meilisearch** | 1.13 | Busca full-text de produtos |

### Infraestrutura e DevOps

| Ferramenta | Função |
|-----------|--------|
| **Docker / Docker Compose** | Containerização de todos os serviços |
| **Nginx** | Reverse proxy, TLS termination, distribuição de tráfego (produção) |
| **pnpm** | 11.1.2 — gerenciador de pacotes do monorepo |
| **Turborepo** | ^2.5.4 — orquestrador de build/cache entre packages |
| **GitHub Actions** | CI: build, typecheck, unit tests (storefront + backend) |
| **PM2** | Process manager para storefront em produção |

### Serviços SaaS / Integrações Externas

| Serviço | Status | Função |
|---------|--------|--------|
| **MercadoPago** | ✅ Ativo | Pagamentos (cartão, PIX, boleto) — sandbox + produção |
| **Evolution API** | ✅ Self-hosted | Gateway WhatsApp — notificações de pedido, chatbot |
| **Melhor Envio** | 🔧 Configurado | Cálculo de frete em tempo real (PAC, SEDEX, Jadlog) |
| **Focus NFe** | 🔧 Sandbox | Emissão automática de NF-e/NFS-e |
| **Brevo** | 🔧 Configurado | E-mail transacional (confirmação, aprovação) |
| **Chatwoot** | 📋 Planejado | Widget de chat de suporte ao cliente |
| **ClearSale** | 📋 Planejado | Antifraude (webhook endpoint pronto) |
| **Plausible Analytics** | 📋 Planejado | Analytics LGPD-compliant (proxy backend pronto) |
| **Typebot** | 🔧 Parcial | Chatbot WhatsApp por webhook (FAQ por dicionário) |
| **Google Analytics** | 📋 Registrado (2026-07-04) | Analytics de tráfego/conversão da vitrine (GA4) |
| **Google Shopping (Merchant Center)** | 📋 Registrado (2026-07-04) | Feed de produtos para anúncios/listagem gratuita no Google |
| **Instagram Shopping** | 📋 Registrado (2026-07-04) | Catálogo de produtos integrado ao Instagram/Meta Commerce |
| **TikTok Shopping** | 📋 Registrado (2026-07-04) | Catálogo de produtos integrado ao TikTok Shop |

### Testes

- **10 arquivos de testes unitários** no backend (Jest + SWC)
- Cobertura: provider MercadoPago, rotas checkout/shipping, módulos fiscal/commission/seller

---

## Progressão do Avanço dos Trabalhos

### ✅ Fase 1 — Concluída (Scaffold)
- Monorepo pnpm + Turborepo configurado
- Medusa v2 scaffold com módulos base (seller, commission, payout)
- Next.js storefront scaffold com rotas e layout

### ✅ Fase 2 — Concluída (Core do Marketplace)
- Módulos customizados: seller, commission, payout (models + service + migrations)
- Rotas API seller: registro, login, set-password, dashboard, produtos
- Rotas admin: sellers (CRUD, approve, suspend), payouts, commissions, settings, reports
- Link seller-product e rotas store/sellers

### ✅ Fase 3 — Concluída (Integrações Brasileiras)
- **MercadoPago**: Checkout Bricks no frontend + webhook no backend (pagamento aprovado)
- **Melhor Envio**: Cálculo de frete por CEP com fallback ilustrativo
- **Focus NFe**: Emissão NF-e automática no evento de pagamento aprovado
- **WhatsApp**: Notificações order.placed / order.completed / order.shipment_created via Evolution API
- **ClearSale**: Endpoint webhook pronto (sem ativação)
- **Comissão**: Subscriber commission-on-payment (cálculo automático)
- Módulo fiscal completo com retry e validações

### ✅ Fase 4 — Concluída (Storefront Completo)
- Páginas: home, produtos, lojas, loja individual, produto, sobre
- Checkout: carrinho → pagamento (Bricks) → sucesso/pendente/erro
- Painel do vendedor: login, dashboard, produtos (CRUD), pedidos, comissões, perfil
- Busca integrada ao Meilisearch
- Sitemap XML dinâmico
- Chatbot webhook (Typebot/FAQ)
- Analytics proxy endpoint
- Chatwoot widget configurado

### ✅ Fase 5 — Concluída (Infra e CI/CD)
- docker-compose.yml (dev local) com todos os serviços
- docker-compose.oci.yml (ambiente de testes Oracle Cloud — IP 168.138.148.67)
- docker-compose.prod.yml (produção com Nginx + SSL)
- GitHub Actions CI (build, typecheck, unit tests)
- Guia de deploy completo (DEPLOY_OCI.md)
- Credenciais documentadas (CREDENTIALS.md)

### 🔧 Fase 6 — Em Andamento / Pendente

| Item | Status | Próximo passo |
|------|--------|---------------|
| Melhor Envio — testes de integração | 🔧 | Validar cálculo de frete com token real |
| Focus NFe — ativação em produção | 🔧 | Inserir CNPJ emitente + IE e desabilitar sandbox |
| Brevo — verificação de domínio | 🔧 | Configurar SPF/DKIM/DMARC para mercadopreto.com.br |
| Storefront — testes unitários | ✅ | CategorySelect e formulários de produto do lojista cobertos (RTL + jsdom) |
| Typebot → LLM upgrade | 📋 | Substituir dicionário por Ollama/OpenAI |
| Chatwoot — ativação | 📋 | Configurar inbox + variáveis de ambiente |
| ClearSale — ativação | 📋 | Ativar quando volume de pedidos justificar |
| Plausible — deploy | 📋 | Adicionar container + configurar domínio |
| HTTPS/TLS em produção | 📋 | Configurar certificados Let's Encrypt via Nginx |
| Split de pagamento MP | 📋 | Configurar sub-contas OAuth de vendedores |

### 📋 Fase 7 — Futura (Pós-Lançamento)

| Item | Pré-requisito |
|------|--------------|
| Busca híbrida Meilisearch + Ollama (semântica) | Upgrade RAM para 8 GB |
| Assistente de anúncio (foto → descrição) | Ollama + llava:7b ou API OpenAI |
| pgvector — "Produtos Semelhantes" | Catálogo > 100 produtos |
| n8n — automações de negócio | Container n8n |
| Grafana/Netdata — monitoramento | Containers extras |
| Metabase — analytics admin | Container Metabase |
| MercadoPago Marketplace split | Vendedores aprovados + sub-contas |
| **Google Analytics (GA4)** | Tag `gtag`/GA4 no storefront + banner de consentimento LGPD (site em produção com domínio próprio) |
| **Google Shopping (Merchant Center)** | Conta Merchant Center verificada + gerar feed de produtos (XML/RSS ou API Content) a partir do catálogo Medusa; site em produção com TLS |
| **Instagram Shopping** | Conta Meta Business verificada + catálogo Meta Commerce (feed de produtos) + loja aprovada pela Meta |
| **TikTok Shopping** | Conta TikTok Shop/Business verificada + feed de catálogo compatível + elegibilidade regional (BR) |
| **Sistema de avaliação e comentários** | Nenhum módulo hoje — precisa de modelo de review vinculado a `order`/`product` + moderação de conteúdo |
| **Centro de mensagens (chat comprador↔vendedor)** | Nenhum módulo hoje — precisa de decidir infra (polling/WebSocket próprio vs. reaproveitar Evolution API/Chatwoot) + UI no painel do lojista e na conta do comprador |
| **Programa de fidelidade (pontos de recompensa)** | Nenhum módulo hoje — precisa de decisão de negócio-chave: programa único da plataforma ou por lojista (mais complexo); técnica: módulo `loyalty` (ledger de pontos, ganha em `order.completed`) + módulo Promotions do Medusa para resgate no checkout |

> Registrado em 2026-07-04 a pedido do usuário — nenhuma integração/feature iniciada ainda; todas dependem de feed de catálogo de produtos e, em geral, do site já estar em produção com domínio/TLS (Fase 1 da migração Nuvemshop), exceto avaliação, mensagens e fidelidade, que são features internas sem essa dependência. Design de cada uma fica para quando a fase for priorizada.

### Resumo Visual

```
████████████████████████████████████░░░░░░  ~80% concluído

✅ Core do marketplace     100%
✅ Integrações brasileiras  90%  (faltam testes end-to-end)
✅ Storefront completo      100%
✅ Infra e CI/CD            100%
🔧 Validação/Ativação SaaS  40%  (Melhor Envio, Focus NFe, Brevo)
📋 IA e Analytics            0%  (roadmap definido)
📋 Produção com TLS          0%  (deploy guide pronto)
```
