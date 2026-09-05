# Runbook — Ativação da integração com o Mercado Livre

Guia operacional para colocar a integração com o Mercado Livre (módulo
`marketplace-channel`) no ar. Cobre só a ativação/operação — não repete o
desenho técnico, que está em
`docs/superpowers/specs/2026-09-04-mercado-livre-channel-integration-design.md`.

## 0. Pré-requisito não-técnico

Antes de qualquer publicação real de produto ou processamento de pedido
real: validação jurídica/contábil do modelo de conta única (o Mercado Preto
vende como intermediário sob uma única conta ML, não uma conta por
vendedor — ver a seção "Pesquisa de mercado" da spec linkada acima). Isso
não é uma tarefa técnica e não é feito por este runbook.

## 1. Cadastrar a aplicação no Mercado Livre

Em https://developers.mercadolivre.com.br, crie uma aplicação (ou use uma
já existente) e anote:

- **App ID** → vai em `MERCADOLIVRE_CLIENT_ID`
- **Secret Key** → vai em `MERCADOLIVRE_CLIENT_SECRET`

**Ponto crítico:** no cadastro da aplicação, o campo **"Redirect URI"**
precisa ser configurado como **exatamente**:

```
${BACKEND_URL}/admin/marketplace-channel/callback
```

(mesma variável `BACKEND_URL` já usada pelo webhook do MercadoPago). A
Mercado Livre rejeita a troca do código de autorização se essa URL não
bater byte a byte com o que foi cadastrado — inclusive protocolo (`https://`)
e ausência/presença de barra final.

## 2. Configurar as variáveis de ambiente

As três variáveis já estão documentadas em `.env.example` e `.env.template`
do backend (`packages/medusa-backend/apps/backend/`):

- `MERCADOLIVRE_CLIENT_ID`
- `MERCADOLIVRE_CLIENT_SECRET`
- `MERCADOLIVRE_WEBHOOK_SECRET` (ver passo 3)

Sem elas, a integração fica desativada silenciosamente (não quebra o
resto do sistema).

## 3. Configurar o webhook de notificações

No painel de notificações da aplicação (Mercado Livre → Suas integrações →
a aplicação → Notificações), configure a URL de callback para:

```
${BACKEND_URL}/webhooks/mercadolivre
```

e gere a chave secreta de verificação — ela vai em
`MERCADOLIVRE_WEBHOOK_SECRET`.

**Atenção:** o esquema de verificação de assinatura implementado
(`verifyWebhookSignature` em `src/utils/mercadolivre-client.ts`) foi
construído por analogia ao esquema já usado pelo webhook do MercadoPago
(header `x-signature: ts=...,v1=...`, HMAC-SHA256), já que os dois produtos
são da mesma empresa — **mas isso nunca foi confirmado contra o painel real
de uma aplicação Mercado Livre**. Antes de considerar o webhook
verdadeiramente seguro em produção, confirme no painel de notificações da
aplicação que o formato do manifest assinado é idêntico ao documentado no
código (comentário em `mercadolivre-client.ts`, próximo a
`verifyWebhookSignature`). Sem `MERCADOLIVRE_WEBHOOK_SECRET` configurado,
o webhook rejeita toda notificação com HTTP 500 (falha fechada, não aberta).

## 4. Obter a primeira credencial (autorização OAuth)

Não existe UI para isso — é um fluxo de navegador direto:

1. Faça login no painel admin do Medusa normalmente.
2. Na mesma aba/sessão do navegador, acesse:
   ```
   ${BACKEND_URL}/admin/marketplace-channel/authorize
   ```
3. Você será redirecionado para a tela de autorização do Mercado Livre.
   Aprove o acesso com a conta ML que vai ser a conta central do Mercado
   Preto.
4. Ao voltar, uma resposta JSON `{"connected": true, "channel":
   "mercado_livre"}` confirma que a credencial foi salva.

Se a resposta for um erro 400 ("Autorização inválida ou expirada"), o
`state`/cookie da tentativa expirou (validade de 5 minutos) — repita o
passo 2. Se for 502, a troca do código falhou do lado do Mercado Livre —
confira `MERCADOLIVRE_CLIENT_ID`/`MERCADOLIVRE_CLIENT_SECRET` e o Redirect
URI cadastrado (passo 1).

## 5. Verificar o job de renovação de token

O token de acesso do Mercado Livre expira em ~6 horas. Um job agendado
nativo do Medusa (`src/jobs/mercadolivre-token-refresh.ts`, cron
`0 */2 * * *` — a cada 2 horas) renova automaticamente quando faltam menos
de 30 minutos para expirar. Não requer nenhum cron externo — é o mecanismo
de scheduled jobs do próprio Medusa.

Para confirmar que está rodando, procure nos logs do backend por:

```
[mercadolivre-token-refresh] token ainda válido, nada a fazer
[mercadolivre-token-refresh] token renovado com sucesso
```

Um destes deve aparecer a cada ~2 horas depois que a primeira credencial
for obtida (passo 4). Se nunca aparecer nenhuma linha com esse prefixo, o
scheduler de jobs do Medusa não está rodando nesse ambiente — verifique a
configuração de deploy do backend (esse job faz parte do processo normal
do Medusa, não de um processo separado).

## 6. Publicar um produto no Mercado Livre

Também sem UI — chamada de API autenticada como admin:

```
POST ${BACKEND_URL}/admin/marketplace-channel/products/{PRODUCT_ID}/publish
Content-Type: application/json

{
  "categoryId": "MLB1000",
  "attributes": [
    { "id": "BRAND", "valueName": "Genérica" }
  ]
}
```

`categoryId` e `attributes` são escolhidos manualmente pelo admin — não há
mapeamento automático (decisão de escopo do MVP). A categoria e os
atributos obrigatórios de cada categoria são consultados na própria API do
Mercado Livre (`GET /categories`, `GET /categories/{id}/attributes`), fora
do escopo desta integração por enquanto.

A resposta de sucesso traz `externalItemId` (o ID do anúncio no ML) e a
taxa de venda resolvida (`saleFeePercent`, `saleFeeFixed`) — essa taxa é
sempre buscada da API do Mercado Livre no momento da publicação, nunca um
valor fixo no código.

## 7. Desconectar / reconectar a conta

Para trocar a conta ML conectada (ou revogar o acesso):

```
DELETE ${BACKEND_URL}/admin/marketplace-channel/disconnect
```

Depois, repita o passo 4 para conectar uma conta nova.

## 8. Limitações conhecidas antes de ir para produção

- **Endereço da NF-e é melhor-esforço.** O webhook de pedidos busca o
  endereço real do comprador na API do Mercado Livre (`GET
  /shipments/:id`) na hora da criação do pedido. Se essa busca falhar, o
  pedido ainda é criado, mas a NF-e cai no endereço padrão da própria
  plataforma (Cachoeira/BA) como rede de segurança — não é o comportamento
  normal esperado, mas pode acontecer.
- Só produtos de variante única.
- Frete só via Mercado Envios (não há suporte a frete próprio pra pedidos
  vindos do ML).
- Sem sincronização automática de preço ou estoque — mudou o preço no
  Mercado Preto, é preciso republicar manualmente no ML.
- Pedidos do Mercado Livre nunca disparam a notificação de WhatsApp do
  Mercado Preto (o próprio Mercado Livre já notifica o comprador).

## 9. Onde olhar quando algo dá errado

Prefixos de log usados por toda a integração (grep nos logs do backend):

| Prefixo | Onde |
|---|---|
| `[mercadolivre/webhook]` | Recebimento de pedidos (`src/api/webhooks/mercadolivre/route.ts`) |
| `[mercadolivre/oauth]` | Autorização/callback OAuth (`src/api/admin/marketplace-channel/callback/route.ts`) |
| `[mercadolivre-token-refresh]` | Job de renovação de token (`src/jobs/mercadolivre-token-refresh.ts`) |
