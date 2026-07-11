# Estratégia de Inteligência Artificial — Mercado Preto

> Última atualização: 2026-05-24
> Documento vivo — deve ser revisado a cada ciclo de planejamento trimestral.

---

## Sumário Executivo

O Mercado Preto é um marketplace voltado a artesãos e pequenos lojistas, com operação inicial abaixo de 100 vendedores. Essa escala não exige infraestrutura de IA massiva — exige IA bem posicionada nas dores reais do negócio: vendedores sem familiaridade com e-commerce, atendimento ao cliente sem equipe dedicada, e operação enxuta sem DevOps em tempo integral.

Este documento mapeia todas as oportunidades de IA, analisa criticamente as escolhas tecnológicas atuais em comparação com alternativas de mercado, e apresenta uma pesquisa de hospedagem focada em custo-benefício para o estágio atual do projeto.

---

## Parte 1 — Oportunidades de IA por Área do Negócio

### 1.1 DevOps & CI/CD

**Estado atual:** GitHub Actions com build, typecheck e testes. Sem observabilidade além dos logs de container.

| Ferramenta | Tipo | Função | Complexidade | Custo |
|-----------|------|---------|--------------|-------|
| **Grafana + Prometheus + Loki** | Open-source | Métricas, dashboards, alertas de anomalia via Grafana ML (SARIMA) | Média | Gratuito (self-hosted) |
| **Netdata** | Open-source | Anomaly Advisor com isolation forest — ativa por padrão, zero config | Baixa | Gratuito (self-hosted) |
| **CodeRabbit** | SaaS freemium | Revisão de PR com IA, comentários inline no GitHub | Baixa | Gratuito (1 repo) / $19/mês |
| **SonarQube Community** | Open-source | Análise estática, detecção de bugs por padrão | Baixa | Gratuito (self-hosted Docker) |

**Recomendação imediata:** Instalar o **CodeRabbit** leva 10 minutos — zero infraestrutura, valor imediato na revisão de código. O **Netdata** entra no `docker-compose.yml` em meia hora e monitora a saúde de todos os containers sem configuração de scrapers Prometheus.

**Valor:** Alertas proativos de esgotamento de memória Redis, conexões PostgreSQL, lag de indexação Meilisearch e falhas no checkout protegem a confiança dos vendedores antes que o problema escale.

---

### 1.2 Busca e Descoberta de Produtos

**Estado atual:** Meilisearch v1.13 com busca por palavra-chave. Filtros por `status`, `sellerId`, `categoria`, `sellerLocation`. Sem vetores, sem semântica, sem personalização.

#### A — Busca Híbrida com Meilisearch (recomendado AGORA)

O Meilisearch v1.13 já suporta busca vetorial (habilitada em v1.10). O caminho de integração usa o **Ollama** rodando o modelo `nomic-embed-text` (274 MB, rápido, determinístico):

```
Seller cria produto
  → indexProduct() gera embedding via Ollama
  → armazena _vectors.ollama no documento Meilisearch
  → query GET /store/search passa hybrid: { semanticRatio: 0.5 }
  → resultado combina relevância por palavra E por semântica
```

Impacto real para artesãos: buscas como "presente para mãe" encontrarão "colar de búzios artesanal" mesmo sem match exato de termos. Esse ganho é enorme para produtos com nomes regionais ou incomuns.

#### B — pgvector para "Produtos Semelhantes"

Adicionar a extensão `pgvector` ao PostgreSQL existente (`CREATE EXTENSION vector`) permite consultas de similaridade:

```sql
SELECT id, title FROM product ORDER BY embedding <=> $1 LIMIT 5
```

Ideal para o widget "Veja também" na página de produto. Não substitui o Meilisearch — é complementar.

**Prioridade:** Meilisearch híbrida primeiro (maior impacto no funil de busca). pgvector como segundo passo quando o catálogo crescer.

---

### 1.3 Atendimento ao Cliente

**Estado atual:** `/store/webhooks/typebot/route.ts` — chatbot por dicionário de palavras-chave (~9 entradas). Chatwoot está no roadmap. Evolution API está funcionando.

#### Upgrade do Bot WhatsApp para LLM

O endpoint de webhook já existe e está conectado à Evolution API. A mudança é cirúrgica: substituir a função `buildFaqResponse()` por uma chamada ao Ollama.

```
Mensagem WhatsApp (Evolution API)
  → POST /store/webhooks/typebot
  → buildFaqResponse() [ATUAL: dicionário]
  → [NOVO] Ollama llama3.2:3b com system prompt + FAQ
  → resposta em português natural
```

**Modelo recomendado para o bot:** `llama3.2:3b` (2 GB RAM) para FAQ simples. Se precisar de qualidade superior em português: `mistral:7b-instruct-q4_K_M` (4.1 GB RAM) ou API OpenAI gpt-4o-mini ($0,60/1M tokens de saída — menos de R$1/dia nessa escala).

#### Flowise — Bot Sem Código

O **Flowise** (Apache 2.0, Docker) permite construir o fluxo do chatbot visualmente — sem código. Tem nó nativo para Evolution API/WhatsApp. O time pode atualizar respostas do FAQ sem fazer deploy. Indicado se houver pessoas não-técnicas mantendo o bot.

#### Chatwoot (Roadmap) + Overflow do Bot

Quando o bot não sabe responder, escala para um atendente humano no Chatwoot. A integração Evolution API → Chatwoot é documentada e amplamente usada no mercado brasileiro.

**Esforço estimado:** 4 horas para substituir o dicionário por Ollama. 1 dia para Flowise + Evolution API configurados visualmente.

---

### 1.4 Ferramentas para Vendedores

**Estado atual:** Formulário de criação de produto em `/painel/produtos/novo`. Sem assistência de IA.

**Este é o item de maior ROI de todo o documento.**

Os vendedores-alvo são artesãos sem familiaridade com e-commerce. A principal barreira de adoção é a dificuldade de criar um bom anúncio. IA resolve isso diretamente.

#### Pipeline: Foto → Anúncio Completo

```
Vendedor tira foto do produto (celular)
  → upload no formulário
  → POST /seller/products/suggest { image: base64 }
  → backend envia imagem para llava:7b (Ollama) ou GPT-4o-mini
  → JSON de retorno: { title, description, suggestedPrice, suggestedCategory, tags }
  → formulário pré-preenchido aguarda confirmação do vendedor
```

O `llava:7b` requer 8 GB de RAM para rodar confortavelmente — nesse caso, usar a API OpenAI `gpt-4o-mini` é mais prático: custa ~$0,02 por imagem e a qualidade é superior.

#### Expansão de Texto

Vendedor digita "colar de búzios feito à mão" → LLM expande para uma descrição de 150 palavras otimizada para SEO em português. Funciona com qualquer modelo, sem necessidade de visão computacional.

#### Sugestão de Preço

Consulta produtos similares no Meilisearch, calcula média e percentil de preço na categoria. Nenhum LLM necessário — lógica SQL pura com UI bem desenhada.

**Esforço estimado:** 1 dia (backend `POST /seller/products/suggest`) + 0,5 dia (frontend no formulário).

---

### 1.5 Marketing e Anúncios

#### Descrições SEO Automáticas

Trigger via subscriber Medusa quando `product.created` tem descrição curta (< 50 caracteres):

```
product.created → subscriber → verifica descrição → chama LLM → PATCH /seller/products/:id
```

O ponto de integração já existe em `/src/subscribers/product-search-index.ts`.

#### Meta Tags OpenGraph com IA

Next.js 15 suporta `generateMetadata()` — possível gerar meta descriptions únicas por produto chamando um LLM leve na ISR. Custo praticamente zero na escala atual.

#### Copy para Redes Sociais (n8n)

Fluxo n8n: `product.created` webhook → gerar 3 variações de copy para Instagram → armazenar em metadata do produto → admin revisa antes de publicar.

---

### 1.6 Detecção de Fraude

**Estado atual:** Rota `POST /admin/webhooks/clearsale` existe mas ClearSale não está configurado.

**Avaliação honesta:** Com menos de 100 vendedores e tráfego inicial baixo, ML de fraude próprio não é viável — não há volume de dados para treinar modelos. O ClearSale tem base de dados pré-treinada do mercado brasileiro (R$0,10/transação).

**Alternativa open-source antes do ClearSale:** Regras simples via n8n no evento `order.placed`:
- Mais de 3 pedidos do mesmo IP em 1h → bloquear e notificar admin
- Pedido de alto valor com CEP de cobrança ≠ CEP de entrega → sinalizar para revisão
- Primeiro pedido de e-mail com descartável → sinalizar

Cobre 80% dos casos de fraude sem custo. Ativar ClearSale quando o volume de pedidos justificar o contrato.

---

### 1.7 Finanças e Operações

O módulo de `commission` já calcula automaticamente. O módulo de `payout` rastreia desembolsos. A rota `GET /admin/reports` retorna resumos financeiros.

**Split de Pagamento Automático com Pix:** O MercadoPago Marketplace suporta divisão automática de recebíveis via OAuth de sub-contas de vendedores. Isso é engenharia financeira, não IA — mas desbloqueia a automação de repasses sem intervenção manual.

**Consulta em Linguagem Natural (futuro):** Ferramenta **Vanna.ai** (MIT) ou **LlamaIndex.ts SQL Query Engine** permitem que o operador do marketplace faça perguntas como "quais vendedores tiveram comissão acima de 15% em maio?" ao banco de dados, sem SQL. Viável quando o modelo de dados estiver estável.

---

### 1.8 Analytics e BI

**Estado atual:** Plausible planejado, rota `/store/analytics` existe como proxy.

| Ferramenta | Função | Complexidade | Custo |
|-----------|---------|--------------|-------|
| **Plausible** (self-hosted) | Analytics LGPD-compliant, sem cookies | Baixa | Gratuito |
| **Metabase** (self-hosted) | Dashboards SQL + pergunta em linguagem natural (v0.49+) | Baixa | Gratuito (Community) |
| **Evidence.dev** | Dashboards para vendedores a partir de templates SQL | Baixa | Gratuito |

**Recomendação:** Metabase em um container Docker apontando para o PostgreSQL existente. O operador ganha dashboards visuais sem ETL. A feature de IA ("Ask Metabase") requer plano Pro ($500/ano) — use a Community primeiro.

---

## Parte 2 — Análise Crítica: Medusa.js vs Alternativas

### 2.1 Matriz de Comparação

| Critério | **Medusa.js v2** | Vendure | Saleor | Bagisto | WooCommerce | Shopify |
|----------|:---:|:---:|:---:|:---:|:---:|:---:|
| Open-source | ✅ MIT | ✅ MIT | ✅ BSD-3 | ✅ OSL-3 | ✅ GPL | ❌ SaaS |
| TypeScript nativo | ✅ | ✅ | ❌ Python | ❌ PHP | ❌ PHP | ❌ Liquid |
| Sistema de eventos para IA | ✅ Subscribers + Workflows | ✅ EventBus | ✅ Apps + Webhooks | ⚠️ Laravel Events | ⚠️ WP Hooks (sync) | ✅ Flow + Webhooks |
| Extensibilidade do admin | ✅ React SDK | ✅ Angular plugins | ✅ React plugins | ⚠️ Vue limitado | ✅ WP plugins | ✅ Gerenciado |
| Ecossistema de plugins de IA | ❌ Mínimo | ❌ Mínimo | ⚠️ Pequeno | ❌ Mínimo | ✅ Grande | ✅ Melhor do mercado |
| API para consumo por IA | ✅ REST custom | ✅ GraphQL | ✅ GraphQL | ⚠️ REST | ⚠️ REST + GraphQL | ✅ GraphQL (forte) |
| Mercado brasileiro nativo | ✅ Implementado | ❌ | ❌ | ❌ | ⚠️ Plugins | ⚠️ MercadoPago somente |
| IA nativa | ❌ | ❌ | ❌ | ❌ | ⚠️ Beta (OpenAI) | ✅ Shopify Magic |
| GPU-friendly ecosystem | ⚠️ Node.js | ⚠️ Node.js | ✅ Python | ❌ | ❌ | N/A |

### 2.2 Análise Individual

#### Medusa.js v2 (escolha atual)

**Pontos fortes para IA:**
- O sistema de **subscribers** (`src/subscribers/`) é o mecanismo nativo de trigger para IA. Todo evento `product.created`, `order.payment_captured`, `order.placed` já é um hook funcionando nesta codebase.
- O sistema de **módulos customizados** (`src/modules/`) permite adicionar um módulo `ai-suggestions` que qualquer rota ou subscriber resolve via `req.scope.resolve(AI_MODULE)` — integração limpa e tipada.
- O **Admin SDK** (React + Vite) permite injetar widgets de IA (botão de geração de descrição, painel de sugestão de preço) sem tocar no core do Medusa.
- Node.js 22 significa que toda biblioteca de IA do ecossistema Node funciona sem shims.

**Pontos fracos para IA:**
- Zero suporte nativo a busca vetorial, pipelines de embeddings ou gerenciamento de modelos.
- Ecossistema de plugins para IA praticamente inexistente — você não vai encontrar um módulo "plug-and-play" de descrição por IA para Medusa no npm.
- O sistema de workflows (`@medusajs/framework`) não tem retry/backoff nativo para chamadas LLM lentas (2–10s). Exige tratamento manual ou Temporal.

#### Vendure

GraphQL é excelente para consumo por IA, mas suporte ao mercado brasileiro é **zero**. PIX, boleto, NF-e e frete por CEP exigem o mesmo trabalho customizado já realizado para o Medusa. Migrar agora representa 3–6 meses de retrabalho sem ganho de IA no curto prazo.

#### Saleor (Python)

A vantagem de IA real do Saleor é o **ecossistema Python**: PyTorch, scikit-learn, Transformers, sentence-transformers e Hugging Face acessíveis no mesmo processo sem fronteira HTTP. Se o projeto tivesse um roadmap ML-pesado desde o início, Saleor seria argumento sério. No estágio atual, o custo de migração (mudança de stack, rewrites dos módulos brasileiros) é inviável.

#### WooCommerce

O maior ecossistema de plugins de IA do open-source (várias integrações GPT, geração de descrição, etc.). Porém, o sistema de hooks do WordPress é **síncrono e bloqueante** — péssimo para chamadas LLM que levam 2–10 segundos. A arquitetura vai lutar contra qualquer pipeline de IA assíncrona. Não recomendado para desenvolvimento novo.

#### Shopify

**Shopify Magic** (descrições de produto, alt text de imagem, campanhas de e-mail, copy de anúncios) e **Sidekick** (assistente para lojistas) são genuinamente superiores a qualquer coisa construída com open-source no curto prazo. Qualidade de português brasileiro no Shopify Magic é excelente.

**O problema fundamental:** A taxa de plataforma de 0,5–2% sobre receita mais o custo de assinatura inviabiliza a missão social do projeto. Para um marketplace onde o operador já cobra comissão dos artesãos, adicionar a margem Shopify altera as unit economics de forma incompatível com o modelo de negócio.

### 2.3 Veredicto

**Manter Medusa.js v2.** O custo de migração para qualquer plataforma alternativa é de 3–6 meses de retrabalho — todo o trabalho de MercadoPago, Focus NFe, Evolution API e módulos de seller/commission/payout seria refeito do zero. A lacuna de IA em relação ao Shopify é real mas fechável com as integrações descritas na Parte 1, a um custo de semanas, não meses.

O padrão de subscribers + módulos customizados + Admin SDK React é suficientemente expressivo para todas as integrações de IA priorizadas neste documento.

---

## Parte 3 — Ecossistema de Ferramentas de IA

### 3.1 Inferência LLM

#### Ollama (self-hosted — recomendado)

Container Docker `ollama/ollama:latest`. Adicionar ao `docker-compose.yml` existente.

| Modelo | RAM necessária | Uso no projeto |
|--------|---------------|----------------|
| `nomic-embed-text` | ~500 MB | Embeddings para Meilisearch e pgvector |
| `llama3.2:3b` | ~2 GB | Chatbot FAQ WhatsApp |
| `mistral:7b-instruct-q4_K_M` | ~4.1 GB | Descrições de produto, copy de marketing |
| `llava:7b` | ~4.5 GB | Foto → descrição de produto (visão) |

**Limitação honesta:** Modelos 3B–7B em português produzem texto aceitável para textos curtos (títulos, descrições de 150 palavras). Para copy de marketing com publicação sem revisão humana, use OpenAI API.

#### OpenAI API (SaaS — uso pontual)

`gpt-4o-mini`: $0,15/1M tokens de entrada, $0,60/1M de saída. Para 100 descrições de produto com 300 tokens cada: menos de R$0,10/dia. Praticamente gratuito nessa escala.

**Estratégia híbrida recomendada:** Ollama para uso interno/admin onde qualidade menor é aceitável. OpenAI API para texto visível ao comprador (descrições publicadas, respostas do bot WhatsApp).

#### Groq (SaaS — inferência rápida)

Modelos Llama 3 e Mixtral com latência de ~100ms (10× mais rápido que OpenAI). $0,05–0,27/1M tokens. Excelente para o chatbot WhatsApp onde latência de resposta importa para a experiência do usuário.

### 3.2 Embeddings e Busca Vetorial

| Ferramenta | Quando usar | Como adicionar |
|-----------|------------|----------------|
| **pgvector** | Similaridade de produtos, busca semântica com filtros SQL | `CREATE EXTENSION vector` no PostgreSQL existente |
| **Meilisearch hybrid** | Busca principal do usuário (melhor UX) | Habilitar `vectorStore` + configurar embedder Ollama |
| **Qdrant Cloud** | Quando catálogo > 500k produtos ou latência < 10ms for crítica | Serviço externo — prematuro agora |

### 3.3 Orquestração e Automação

| Ferramenta | Tipo | Melhor uso | Adicionar como |
|-----------|------|-----------|----------------|
| **n8n** | Open-source (fair-code) | Automações de negócio com IA: relatório semanal, notificação de pedido, geração de descrição sem código | `n8nio/n8n:latest` no docker-compose |
| **Flowise** | Open-source (Apache 2.0) | Chatbot visual sem código, integração Evolution API nativa | `flowiseai/flowise:latest` no docker-compose |
| **LangChain.js** | Open-source | Bot WhatsApp que consulta APIs Medusa como "ferramentas" (order status, product lookup) | `npm install langchain` |
| **LlamaIndex.ts** | Open-source | RAG sobre catálogo de produtos, text-to-SQL para admin | `npm install llamaindex` |

**n8n vs Flowise:** Use n8n para automações de processo (relatórios, notificações, sincronizações). Use Flowise para fluxos conversacionais (chatbot).

### 3.4 Analytics e BI

| Ferramenta | Função | Custo |
|-----------|---------|-------|
| **Metabase Community** | Dashboards SQL, pergunta em linguagem natural (Pro) | Gratuito |
| **Plausible** (self-hosted) | Analytics LGPD-compliant, sem cookies | Gratuito |
| **Grafana + Prometheus** | Métricas de infraestrutura + anomaly detection | Gratuito |
| **Netdata** | Monitoramento de containers com IA built-in | Gratuito |

---

## Parte 4 — Roteiro de Implementação

### Prioridade 1 — Esta Sprint (1–2 semanas)

| Item | Esforço | Infra adicional | Valor |
|------|---------|-----------------|-------|
| Ollama + `nomic-embed-text` no docker-compose | 2h | +1 container (Ollama, ~500 MB) | Habilita todos os itens abaixo |
| Busca híbrida Meilisearch (semântica + keyword) | 1 dia | Usa Ollama acima | Alto — melhor descoberta de produtos artesanais com nomes incomuns |
| Sugestão de descrição de produto para vendedor | 1,5 dias | Usa Ollama acima | Muito alto — remove maior barreira de adoção dos artesãos |
| Upgrade do chatbot WhatsApp (dicionário → LLM) | 4 horas | Usa Ollama acima | Médio |
| CodeRabbit no GitHub | 10 minutos | Nenhuma | Médio — revisão de PR com IA |

### Prioridade 2 — Próximas 4–8 Semanas

| Item | Esforço | Infra adicional |
|------|---------|-----------------|
| n8n para automações de negócio | 2 dias setup | +1 container (n8n) |
| pgvector + widget "Veja também" | 2 dias | Extensão no PostgreSQL existente |
| Grafana + Prometheus + node-exporter | 1 dia | +3 containers |
| Netdata (alternativa mais simples ao Grafana) | 30 min | +1 container |
| Metabase para analytics do admin | 30 min | +1 container |
| Flowise para chatbot evoluído sem código | 1 dia | +1 container |

### Prioridade 3 — 3–6 Meses Pós-Lançamento (com dados de vendas)

| Item | Pré-requisito |
|------|--------------|
| ClearSale para fraud scoring | Volume de pedidos > 200/mês |
| MercadoPago Marketplace split automático | Configuração de sub-contas OAuth dos vendedores |
| Chatwoot + overflow do bot | Bot funcionando (Prioridade 1) |
| Forecasting de demanda por categoria | 3+ meses de histórico de vendas por vendedor |
| Vanna.ai / text-to-SQL para admin | Modelo de dados estabilizado |
| Personalização de resultados de busca | Histórico de sessão suficiente |

### Alerta de Recursos

Adicionar Ollama com `llava:7b` + n8n + Grafana + todos os serviços existentes em um servidor de 4 GB **vai causar OOM**. Planejar upgrade para 8 GB antes de ativar os itens de Prioridade 1. Ver recomendações de hospedagem na Parte 5.

---

## Parte 5 — Pesquisa de Hospedagem

### 5.1 Requisitos da Stack

Estimativa de RAM ociosa dos serviços atuais:

| Serviço | RAM ociosa |
|---------|-----------|
| Medusa backend | ~500 MB |
| Medusa worker | ~350 MB |
| Next.js storefront | ~350 MB |
| PostgreSQL | ~300 MB |
| Redis | ~75 MB |
| Meilisearch | ~200 MB |
| Evolution API | ~200 MB |
| Nginx | ~30 MB |
| **Total atual** | **~2,0–2,5 GB** |
| + Ollama (nomic-embed-text) | ~500 MB |
| + Coolify (se usar) | ~1,0 GB |
| **Total com IA + PaaS** | **~4,0–5,0 GB** |

**Configuração mínima recomendada:** 4 vCPU / 8 GB RAM / 80 GB SSD.

### 5.2 Comparativo de Provedores VPS

| Provedor | Plano (4 vCPU / 8 GB) | Preço/mês | DC no Brasil | Banda incluída | Nota |
|---------|----------------------|-----------|:---:|----------------|------|
| **Hetzner CX32** | 4 vCPU / 8 GB / 80 GB | **~$7,40** | ❌ Alemanha | 20 TB | Mais barato do mercado |
| **Contabo VPS M** | 6 vCPU / 12 GB / 200 GB | **~$12** | ❌ EUA/EU | Ilimitada | I/O compartilhado, suporte lento |
| **OVHcloud VPS Essential** | 4 vCPU / 8 GB / 160 GB | ~$17 | ❌ Mais próximo: Miami | Ilimitada | Aumentos de preço previstos 2026–28 |
| **Vultr Regular SP** | 4 vCPU / 8 GB / 160 GB | **$40** | ✅ São Paulo | 4 TB | Boa relação custo/BR |
| **DigitalOcean Basic SP** | 4 vCPU / 8 GB / 160 GB | $48 | ✅ São Paulo | 5 TB | Preços altos desde 2022 |
| **Oracle Cloud A1.Flex** | 4 OCPU / 24 GB / 200 GB | **Gratuito*** | ✅ São Paulo | 10 TB | *Provisionamento instável em SP |
| **AWS t3.large SP** | 2 vCPU / 8 GB | ~$110 | ✅ São Paulo | Paga por GB ($0,25/GB) | Caro demais para esse estágio |
| **GCP e2-standard-4 SP** | 4 vCPU / 16 GB | ~$165 | ✅ São Paulo | Paga por GB | +60% premium vs EUA |
| **Azure B4ms SP** | 4 vCPU / 16 GB | ~$150 | ✅ SP + Rio | 5 GB gratuito | CPU burstable pode throttle |

*Oracle Always Free: o pool ARM A1.Flex (4 OCPU / 24 GB) é gratuito mas **o provisionamento em São Paulo falha consistentemente** — não é confiável como garantia de produção. Excelente como ambiente de staging adicional.

### 5.3 PaaS Gerenciados

| Plataforma | DC Brasil | Docker Compose | PostgreSQL | Custo estimado (stack completa) | Overhead DevOps |
|-----------|:---------:|:--------------:|:----------:|--------------------------------|-----------------|
| **Railway** | ❌ Oregon | ✅ | Gerenciado | $40–60/mês | Baixo |
| **Render** | ❌ Oregon/Frankfurt | ✅ | Gerenciado | $100–130/mês | Baixo |
| **Fly.io** | ❌ (SP no roadmap) | ✅ | $75+/cluster | $120–160/mês | Médio |
| **Coolify** (self-hosted) | Depende do VPS | ✅ Nativo completo | Self-managed | Apenas custo do VPS | Médio |
| **CapRover** (self-hosted) | Depende do VPS | ⚠️ Limitado | Self-managed | Apenas custo do VPS | Médio |
| **Dokku** (self-hosted) | Depende do VPS | ⚠️ Plugin comunitário | Plugin | Apenas custo do VPS | Médio-Alto |

### 5.4 Coolify — Análise Aprofundada

O **Coolify** (open-source, gratuito) é o Heroku/Netlify self-hosted. Instalado em qualquer VPS Linux, oferece:

- **CI/CD visual:** deploy automático no push para branch, via webhook GitHub/GitLab
- **SSL automático:** Let's Encrypt gerenciado pelo Traefik integrado — zero configuração de certificados
- **Docker Compose nativo:** deploy de toda a stack `docker-compose.yml` como uma aplicação única — **compatível diretamente com este projeto**
- **280+ serviços one-click:** PostgreSQL, Redis, Meilisearch, n8n, Plausible, Metabase, Ollama, Open WebUI, Grafana
- **Backup automático:** para qualquer storage S3-compatible (Cloudflare R2 tem 10 GB gratuito)
- **Gestão de secrets:** variáveis de ambiente via UI (substituindo os arquivos `.env`)
- **Monitoramento:** CPU, RAM, disk por container

**Overhead do Coolify no servidor:** ~1 GB de RAM (Coolify app + PostgreSQL interno + Traefik). Em um servidor de 8 GB, isso é confortável.

**Substituição do Nginx:** O Coolify usa Traefik como proxy. A configuração Nginx existente em `/infra/nginx/` seria substituída por labels Traefik no docker-compose — processo simples, resultado mais manutenível.

**Custo vs alternativas:**

| Solução | Software | VPS | Total/mês |
|---------|----------|-----|-----------|
| Coolify + Hetzner CX32 | Gratuito | $7,40 | **~$10** |
| Coolify + Vultr São Paulo | Gratuito | $40 | **~$45** |
| Railway Pro | $20 + uso | — | $40–60 |
| Render | Por serviço | — | $100–130 |

### 5.5 Recomendações por Cenário

#### Opção A — Menor custo absoluto (latência aceitável)
**Hetzner CX32 (~$7,40/mês) + Coolify + Cloudflare CDN (gratuito)**

O Cloudflare tem PoP em São Paulo — para assets estáticos e páginas em cache, a latência brasileira é < 50ms mesmo com o servidor na Alemanha. Chamadas de API dinâmicas terão 180–250ms de RTT — aceitável para um marketplace inicial.

Custo total infraestrutura: **~R$50–60/mês.**

#### Opção B — Produção com presença brasileira (recomendado)
**Vultr São Paulo 4 vCPU / 8 GB ($40/mês) + Coolify**

RTT de 5–20ms para usuários brasileiros. Headroom confortável para toda a stack + Ollama + Coolify. Escala para 8 vCPU / 16 GB (~$80/mês) quando o marketplace crescer para 500+ vendedores.

Custo total infraestrutura: **~R$230/mês.**

#### Opção C — Híbrida (melhor custo-benefício técnico)
**Hetzner CX32 para workload principal + Vultr SP 1 vCPU / 2 GB ($12) para Evolution API**

A maioria do tráfego (busca, checkout, admin) é servida pelo Hetzner + Cloudflare CDN. O Evolution API — onde latência para o WhatsApp realmente importa — fica em São Paulo. Custo total: **~$22–25/mês (~R$120–135).**

#### Evitar neste estágio
- **AWS / GCP / Azure São Paulo:** 5–15× mais caro, billing complexo, feito para times com engenheiro cloud dedicado.
- **Render / Fly.io:** corretos para apps Node simples, mas esta stack multi-serviço custaria $100–160/mês vs $10–45 num VPS.
- **Oracle Always Free como produção:** instável demais para depender como único servidor.

### 5.6 Projeção de Custo

| Fase | Configuração | Custo/mês |
|------|-------------|-----------|
| **Lançamento** (< 100 vendedores) | Hetzner CX32 + Coolify + CF CDN | **~$10** |
| **Lançamento** (< 100 vendedores, Brasil DC) | Vultr SP 8 GB + Coolify | **~$45** |
| **Crescimento** (100–500 vendedores) | Vultr SP 16 GB + VPS Evolution $20 | **~$100** |
| **Escala** (500+ vendedores) | Vultr SP 32 GB + Evolution SP + Managed PG | **~$200–250** |

---

## Parte 6 — Considerações LGPD

A LGPD não exige que dados de brasileiros fiquem em servidores no Brasil — exige controles, contratos e responsabilização. Para este projeto:

- **Dados financeiros (Pix, cartão):** Processados pelo MercadoPago, que é responsável pelo PCI-DSS. Seus servidores nunca armazenam dados brutos de cartão.
- **Dados pessoais (nome, endereço, CPF):** Armazenados no PostgreSQL. Se em servidor fora do Brasil, exige DPA (Data Processing Agreement) com o provedor — Hetzner, Vultr e DigitalOcean fornecem isso.
- **Modelos de IA:** Ao usar OpenAI API, dados de produtos e descrições passam pelos servidores da OpenAI. Para marketplace de artesanato, isso é baixo risco. Para dados mais sensíveis (endereços, comportamento de compra), use Ollama self-hosted.
- **Analytics:** Plausible self-hosted resolve completamente a questão de analytics LGPD — sem cookies, dados sob seu controle.

---

## Resumo Executivo de Prioridades

### O que fazer AGORA (esta semana)

1. Instalar **Ollama** no docker-compose — habilita busca semântica, chatbot e geração de anúncios
2. Adicionar **CodeRabbit** no GitHub — 10 minutos, zero infra, revisão de PR com IA
3. Planejar upgrade do servidor para **8 GB RAM** antes de ativar Ollama em produção

### O que construir ESTE MÊS

4. **Busca híbrida** no Meilisearch (semântica + keyword via Ollama)
5. **Assistente de anúncio** para vendedores no formulário de produto
6. **Upgrade do bot WhatsApp** (dicionário → LLM)
7. **Netdata** para monitoramento com anomaly detection

### O que planejar para o PRÓXIMO TRIMESTRE

8. **n8n** para automações de processo
9. **pgvector** para "Produtos Semelhantes"
10. **Metabase** para analytics do admin
11. **Flowise** para evolução do chatbot sem código

### Plataforma

**Manter Medusa.js v2.** O sistema de subscribers, módulos customizados e Admin SDK React são suficientes para todas as integrações de IA priorizadas. A lacuna em relação ao Shopify em IA nativa é real, mas a proibição de taxas de plataforma e o suporte completo ao mercado brasileiro (já implementado) tornam a migração inviável e desnecessária.

### Hospedagem

**Recomendação:** Vultr São Paulo 4 vCPU / 8 GB ($40/mês) + Coolify (gratuito). Presença brasileira real, stack Docker Compose nativa, CI/CD visual, SSL automático. Escala previsível e custo controlado sem complexidade de hyperscaler.

---

*Para atualizar este documento: editar `docs/stack/AI_STRATEGY.md` e ajustar os status das tabelas de prioridade conforme cada item for implementado.*
