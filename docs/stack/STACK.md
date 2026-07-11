# Stack Tecnológica — Mercado Preto Marketplace

> Última atualização: 2026-05-24
> Este documento é mantido atualizado à medida que novas integrações são configuradas ou removidas.

---

## Visão Geral

O Mercado Preto é um marketplace multi-vendedor construído sobre o Medusa v2. A arquitetura separa o motor de comércio da vitrine digital, suporta módulos personalizados de marketplace (vendedor, comissão, repasse, fiscal) e integra serviços específicos do mercado brasileiro para pagamentos, logística, documentos fiscais e comunicação.

---

## Como as peças se encaixam

```
┌──────────────────────────────────────────────────────┐
│               Vitrine Digital (Next.js)               │
│         O que o comprador e o vendedor veem           │
└──────────────────┬───────────────────────────────────┘
                   │  comunicação interna
┌──────────────────▼───────────────────────────────────┐
│            Motor do Marketplace (Medusa v2)            │
│   Pedidos · Produtos · Vendedores · Comissões ·       │
│   Pagamentos · Notas Fiscais · Repasses                │
└──────┬────────┬───────────┬──────────────────────────┘
       │        │            │
  Banco de   Memória    Busca de
   Dados     Rápida     Produtos
(PostgreSQL) (Redis)  (Meilisearch)
```

O Nginx fica na frente de tudo em produção, funcionando como porteiro: recebe todas as visitas, distribui para o serviço certo e garante que a conexão seja segura (cadeado HTTPS).

---

## Legenda de Status

| Símbolo | Significado |
|---------|-------------|
| ✅ | Funcionando e em uso |
| 🔧 | Código pronto, aguardando credenciais ou configuração final |
| 📋 | No roteiro, ainda não iniciado |

---

## Parte 1 — Motor do Marketplace

### Medusa.js v2 ✅
> **Versão:** 2.15.2

**Função no negócio:**
O Medusa é o coração do marketplace — é ele quem sabe de tudo. Quando um comprador adiciona um produto ao carrinho, o Medusa registra. Quando o pagamento é aprovado, o Medusa avisa o vendedor, calcula a comissão, aciona a emissão da nota fiscal e dispara a mensagem de WhatsApp. É como um gerente geral invisível que coordena todas as operações: cadastro de produtos, gestão de pedidos, controle de estoque, repasse financeiro para os lojistas e relatórios do negócio.

Escolhemos o Medusa porque ele é gratuito (código aberto), pode ser adaptado para qualquer regra de negócio específica, e já foi preparado para o mercado brasileiro — coisa que a maioria das plataformas internacionais não oferece nativamente.

**Módulos personalizados do nosso marketplace:**

| Módulo | O que faz no negócio |
|--------|---------------------|
| **Vendedor** | Cadastra e gerencia os lojistas: dados da loja, documentos, status de aprovação |
| **Comissão** | Define e calcula automaticamente quanto o marketplace retém de cada venda |
| **Repasse** | Controla quanto cada vendedor tem a receber e registra os pagamentos realizados |
| **Fiscal** | Emite a Nota Fiscal eletrônica (NF-e) automaticamente após cada venda aprovada |
| **MercadoPago** | Processa os pagamentos — cartão, PIX e boleto — e comunica o resultado ao sistema |

---

## Parte 2 — Vitrine Digital

### Next.js ✅
> **Versão:** 15.3.2

**Função no negócio:**
O Next.js é a loja que o cliente vê e usa. É a vitrine digital: a página de produtos, o carrinho de compras, o checkout, o painel do lojista para cadastrar produtos e acompanhar pedidos. Ele foi escolhido porque carrega muito rápido (importante para o Google indexar bem e para clientes com internet mais lenta no celular) e funciona perfeitamente em qualquer dispositivo — celular, tablet ou computador.

**Bibliotecas de apoio da vitrine:**

| Ferramenta | Função no negócio |
|-----------|------------------|
| **Tailwind CSS** | Define toda a aparência visual: cores, tamanhos, espaçamentos — a "roupa" da loja |
| **Lucide React** | Biblioteca de ícones: as setas, estrelas, sacolas e demais símbolos visuais da interface |
| **Zustand** | Mantém informações temporárias enquanto o cliente navega (ex: itens no carrinho antes de finalizar) |
| **MercadoPago SDK** | Exibe o formulário de pagamento seguro na tela de checkout sem redirecionar o cliente para outro site |

---

## Parte 3 — Infraestrutura (os bastidores)

### PostgreSQL ✅
> **Versão:** 16

**Função no negócio:**
É o arquivo geral do negócio — o banco de dados principal. Tudo que precisa ser guardado com segurança fica aqui: cadastro de clientes, produtos, pedidos, histórico de vendas, comissões, repasses. Escolhemos o PostgreSQL porque é robusto, gratuito e é o banco de dados oficialmente suportado pelo Medusa.

---

### Redis ✅
> **Versão:** 7

**Função no negócio:**
É a memória de trabalho rápida do sistema. Enquanto o PostgreSQL é como um arquivo permanente, o Redis é como uma mesa de trabalho — guarda informações que precisam ser acessadas em milissegundos: sessão do usuário logado, fila de tarefas pendentes (ex: "ainda preciso enviar esse WhatsApp"), cache de preços e categorias para não consultar o banco o tempo todo. O resultado prático é uma loja mais rápida e um sistema que não sobrecarrega o banco de dados.

---

### Meilisearch ✅
> **Versão:** 1.13

**Função no negócio:**
É o motor de busca interno da loja. Quando um comprador digita "colar artesanal" na barra de pesquisa, é o Meilisearch quem encontra os produtos relevantes em menos de um décimo de segundo — mesmo com erros de digitação ("colar artizanal" vai funcionar). Diferente do Google, que indexa a internet inteira, este motor de busca é dedicado exclusivamente ao catálogo do Mercado Preto, rodando nos nossos próprios servidores, sem custo por pesquisa e com total privacidade dos dados.

---

### Evolution API ✅
> **Versão:** 2.2.3

**Função no negócio:**
É o serviço responsável por toda a comunicação via WhatsApp. Quando um pedido é feito, quando o pagamento é confirmado, quando o produto é enviado — cada uma dessas etapas pode gerar uma mensagem automática para o comprador e para o vendedor. Também é através do Evolution API que funciona o chatbot de atendimento: clientes que mandam mensagem para o número do marketplace recebem respostas automáticas. Decidimos hospedar esse serviço nos nossos próprios servidores (ao invés de pagar por um serviço externo) para ter controle total e custo previsível.

---

### Nginx ✅

**Função no negócio:**
É o porteiro e distribuidor de tráfego do sistema. Toda visita ao site passa pelo Nginx primeiro: ele garante que a conexão seja segura (cadeado verde no navegador), redireciona automaticamente quem tentar acessar o site sem segurança, e distribui cada requisição para o serviço correto — visitas à loja vão para a vitrine, chamadas da API vão para o motor do marketplace.

---

### Docker ✅

**Função no negócio:**
É a tecnologia que empacota cada serviço do sistema (banco de dados, motor do marketplace, vitrine, busca, WhatsApp) em "caixas" padronizadas e isoladas. O benefício prático: o ambiente de desenvolvimento do programador é idêntico ao servidor de produção, eliminando o clássico problema de "funciona na minha máquina". Também facilita muito a escalabilidade — se a loja crescer e precisar de mais capacidade, basta abrir mais "caixas".

---

### GitHub Actions ✅

**Função no negócio:**
É o sistema de controle de qualidade automático. Toda vez que um programador envia uma alteração de código, o GitHub Actions verifica automaticamente se nada foi quebrado — roda testes, checa erros de programação e valida que a versão nova compila corretamente. É como um revisor automático que trabalha 24h e nunca deixa código com problemas chegar ao ar sem avisar.

---

## Parte 4 — Serviços Externos e Integrações

### Pagamentos

#### MercadoPago ✅

**Função no negócio:**
É a maquininha de cartão digital do marketplace. Processa todos os pagamentos: cartão de crédito (à vista e parcelado), débito, PIX e boleto bancário. Quando o pagamento é aprovado, o MercadoPago avisa o sistema automaticamente, que então libera o pedido, emite a nota fiscal e notifica o vendedor. É o maior processador de pagamentos da América Latina, amplamente reconhecido pelos compradores brasileiros, o que aumenta a confiança na hora de finalizar a compra.

---

### Logística e Envio

#### Melhor Envio 🔧

**Função no negócio:**
É o cotador e gestor de fretes integrado ao marketplace. No momento em que o comprador informa o CEP de entrega, o Melhor Envio consulta automaticamente os preços e prazos de Correios, Jadlog, Total Express e outras transportadoras — sem o vendedor precisar fazer nada. Após a venda, gera a etiqueta de envio diretamente. O objetivo é simplificar ao máximo a vida do pequeno lojista, que não precisa ter contrato com nenhuma transportadora individualmente.

**Situação atual:** Token de acesso emitido e CEP de origem configurado. Aguardando testes de integração completos.

---

### Fiscal

#### Focus NFe 🔧

**Função no negócio:**
É o serviço responsável por emitir a Nota Fiscal eletrônica (NF-e) de forma automática. Sempre que um pagamento é aprovado, o sistema aciona o Focus NFe que se comunica com a Receita Federal, emite a nota e a envia para o e-mail do comprador — tudo sem intervenção manual. Isso elimina uma das tarefas mais trabalhosas e sensíveis da operação de um e-commerce, reduz o risco de erros e mantém o negócio em conformidade fiscal.

**Situação atual:** Código completo. Aguardando CNPJ de produção e Inscrição Estadual do emitente para ativação em ambiente real.

---

### Comunicação e Notificações

#### Evolution API — WhatsApp ✅

*(descrito na seção de infraestrutura acima)*

---

#### Brevo — E-mail Transacional 🔧

**Função no negócio:**
É o serviço de envio de e-mails automáticos. Confirmação de cadastro, recuperação de senha, comprovante de pedido, notificação de envio — todos esses e-mails são enviados pelo Brevo. Diferente de um e-mail comum, ele garante que as mensagens cheguem na caixa de entrada (não no spam) e fornece relatórios de entrega.

**Situação atual:** Chave de API configurada. Aguardando verificação do domínio de envio.

---

#### Chatwoot — Chat de Suporte 📋

**Função no negócio:**
É a central de atendimento ao cliente integrada ao site. Quando um comprador ou vendedor precisa de ajuda além do que o chatbot automático consegue resolver, uma janela de chat aparece no canto da tela e conecta o cliente a um atendente humano. Centraliza o histórico de todas as conversas em um único painel para a equipe de suporte.

---

### Antifraude

#### ClearSale 📋

**Função no negócio:**
É o seguro contra fraudes nas compras. Analisa cada pedido em tempo real usando inteligência artificial e indica se o pagamento tem características suspeitas — protegendo tanto o marketplace quanto os vendedores de estornos e prejuízos. É a maior empresa de antifraude do Brasil, com base de dados específica do comportamento de compra brasileiro.

---

### Análise e Métricas

#### Plausible Analytics 📋

**Função no negócio:**
É a ferramenta de análise de visitas ao site — quantas pessoas acessaram, quais produtos foram mais vistos, de onde vieram os visitantes, qual a taxa de conversão. Diferente do Google Analytics, o Plausible não usa cookies e não coleta dados pessoais, sendo totalmente compatível com a LGPD. Roda nos nossos próprios servidores, então os dados de comportamento dos clientes ficam sob nosso controle.

---

## Parte 5 — Infraestrutura de Desenvolvimento

### Ferramentas do Projeto

| Ferramenta | Versão | Função no negócio |
|-----------|--------|------------------|
| **pnpm** | 11.1.2 | Gerenciador de dependências — controla todas as bibliotecas de terceiros usadas no projeto e garante que todos os desenvolvedores usem as mesmas versões |
| **Turbo** | ^2.5.4 | Orquestrador de build — decide a ordem certa de compilar cada parte do sistema e reutiliza resultados anteriores para acelerar o processo |
| **Node.js** | 22.x | Motor de execução do sistema — o ambiente onde todo o código JavaScript/TypeScript do backend roda |
| **TypeScript** | ^5.x | Linguagem de programação — é o JavaScript com verificação de tipos, que reduz drasticamente erros antes de o código ir ao ar |
| **Prettier** | ^3.5.3 | Formatador de código — garante que todo código escrito por qualquer membro da equipe siga o mesmo padrão visual |

---

## Parte 6 — Variáveis de Configuração

> Esta seção é referência técnica para a equipe de desenvolvimento e operações.

### Backend (`.env`)

| Variável | Status | O que configura |
|----------|--------|----------------|
| `DATABASE_URL` | ✅ | Endereço e senha do banco de dados PostgreSQL |
| `REDIS_URL` | ✅ | Endereço do servidor de memória rápida Redis |
| `JWT_SECRET` | ✅ | Chave secreta para autenticação de usuários |
| `COOKIE_SECRET` | ✅ | Chave secreta para segurança dos cookies de sessão |
| `STORE_CORS` / `ADMIN_CORS` / `AUTH_CORS` | ✅ | Endereços autorizados a se comunicar com o sistema |
| `MERCADOPAGO_ACCESS_TOKEN` | ✅ | Credencial de acesso à conta MercadoPago |
| `MERCADOPAGO_WEBHOOK_SECRET` | ✅ | Chave para validar notificações vindas do MercadoPago |
| `BACKEND_URL` | ✅ | Endereço público do servidor (usado pelo MercadoPago para callbacks) |
| `FOCUS_NFE_TOKEN` | 🔧 | Credencial de acesso ao Focus NFe |
| `FOCUS_NFE_SANDBOX` | 🔧 | Liga/desliga modo de testes da Nota Fiscal |
| `FOCUS_NFE_CNPJ` | 🔧 | CNPJ do emitente das notas fiscais (pendente) |
| `FOCUS_NFE_IE` | 🔧 | Inscrição Estadual do emitente (pendente) |
| `MELHOR_ENVIO_TOKEN` | 🔧 | Credencial de acesso ao Melhor Envio |
| `MELHOR_ENVIO_ORIGIN_CEP` | 🔧 | CEP de origem dos envios |
| `BREVO_API_KEY` | 🔧 | Credencial de acesso ao Brevo para envio de e-mails |
| `EMAIL_FROM` | 🔧 | Endereço de e-mail remetente |
| `EVOLUTION_API_URL` | ✅ | Endereço do servidor WhatsApp (Evolution API) |
| `EVOLUTION_API_KEY` | ✅ | Chave de acesso ao servidor WhatsApp |
| `EVOLUTION_API_INSTANCE` | ✅ | Nome da instância WhatsApp configurada |
| `EVOLUTION_WEBHOOK_SECRET` | ✅ | Chave para validar mensagens vindas do WhatsApp |
| `MEILISEARCH_HOST` | ✅ | Endereço do servidor de busca |
| `MEILISEARCH_API_KEY` | ✅ | Chave mestre do servidor de busca |

### Vitrine (`.env.local`)

| Variável | Status | O que configura |
|----------|--------|----------------|
| `NEXT_PUBLIC_MEDUSA_URL` | ✅ | Endereço do motor do marketplace |
| `NEXT_PUBLIC_PUBLISHABLE_KEY` | ✅ | Chave pública do canal de vendas Medusa |
| `NEXT_PUBLIC_REGION_ID` | ✅ | Região padrão (Real brasileiro / Brasil) |
| `NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY` | ✅ | Chave pública MercadoPago para o formulário de pagamento |
| `NEXT_PUBLIC_CHATWOOT_URL` | 📋 | Endereço do servidor de chat de suporte |
| `NEXT_PUBLIC_CHATWOOT_TOKEN` | 📋 | Chave de acesso ao Chatwoot |

---

## Parte 7 — Por Que Escolhemos Cada Tecnologia

| Escolha | Por que esta e não outra |
|---------|--------------------------|
| **Medusa.js v2** em vez de Shopify | O Shopify cobra taxa sobre cada venda (0,5–2% da receita) além da mensalidade. Para um marketplace de artesanato com margens apertadas, isso inviabiliza o modelo. O Medusa é gratuito e adaptável. |
| **Módulos customizados** em vez de plugins prontos | Comissão por vendedor, repasse financeiro e notas fiscais têm regras específicas do negócio. Plugins genéricos não cobrem essas necessidades; os módulos próprios nos dão controle total. |
| **MercadoPago** em vez de Stripe | O Stripe não processa PIX nem boleto no Brasil. O MercadoPago é o maior processador da América Latina, com suporte nativo a todos os meios de pagamento brasileiros. |
| **Focus NFe** em vez de integração direta com a SEFAZ | Integrar diretamente com a Receita Federal exige meses de homologação e manutenção contínua de certificados. O Focus NFe absorve toda essa complexidade por uma fração do custo. |
| **Evolution API self-hosted** em vez de Twilio/Zenvia | As APIs pagas de WhatsApp cobram por mensagem. Self-hosted não tem custo variável e não depende de aprovação da Meta Business API, que pode demorar semanas. |
| **Meilisearch self-hosted** em vez de Algolia | O Algolia cobra por número de buscas realizadas. Com o Meilisearch hospedado próprio, o custo é fixo (apenas o servidor) e os dados de comportamento de busca dos clientes ficam sob nosso controle (LGPD). |
| **Plausible** em vez de Google Analytics | O Google Analytics coleta dados para fins publicitários do Google. O Plausible é focado em privacidade, não usa cookies e é totalmente compatível com a LGPD — não exige banner de consentimento. |
| **PostgreSQL** como banco principal | É o banco de dados com melhor suporte oficial do Medusa, gratuito, robusto e usado por empresas de qualquer porte no mundo inteiro. |
| **Redis** para cache e filas | Processa operações que precisam de velocidade máxima (sessão de usuário, fila de WhatsApp, cache de preços) sem sobrecarregar o banco de dados principal. |

---

## Documentos Relacionados

- [`AI_STRATEGY.md`](./AI_STRATEGY.md) — Roteiro de Inteligência Artificial, análise comparativa de plataformas e pesquisa de hospedagem

---

*Para atualizar este documento: editar `docs/stack/STACK.md` e ajustar os símbolos de status e tabelas de variáveis conforme cada integração for avançando.*
