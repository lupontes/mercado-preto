# Design: Guard-Rail de Modo Sandbox para Integrações SaaS

**Data:** 2026-07-18
**Autor:** Luciano Pontes (via Claude Code)
**Status:** Aprovado, aguardando plano de implementação

## Contexto

O servidor OCI de testes (`teste.mercadopreto.com.br`) é um ambiente onde nenhuma transação deve ter efeito prático no mundo real: nenhuma cobrança real, nenhuma nota fiscal com validade jurídica, nenhum e-mail ou WhatsApp real enviado a um cliente/vendedor de verdade. Hoje isso depende inteiramente de alguém preencher o `infra/.env` do servidor com as credenciais certas — não há nenhuma verificação de código.

### Descobertas durante o brainstorm

Levantamento de como cada integração SaaS do backend (`packages/medusa-backend/apps/backend`) determina hoje se está em modo sandbox/produção:

- **MercadoPago** (`src/modules/mercadopago/provider.ts`, rotas de checkout): nenhuma detecção de sandbox. O token é usado como veio do `.env`, sem checar prefixo (`TEST-` vs `APP_USR-`).
- **Focus NFe** (`src/modules/fiscal/service.ts:15-23`): já tem um flag dedicado, `FOCUS_NFE_SANDBOX`, que troca a base URL entre homologação e produção. É o único exemplo pré-existente desse padrão no repo.
- **Melhor Envio** (`src/api/store/shipping/estimate/route.ts:25-27`): deriva sandbox de `NODE_ENV === 'production'`. Problema: o servidor OCI de teste roda `docker-compose.prod.yml` com `NODE_ENV=production` (infra), então hoje ele bate na API de **produção** real da Melhor Envio, mesmo sendo um ambiente de teste.
- **Brevo** (`src/subscribers/seller-approved-email.ts`) e **Evolution/WhatsApp** (`src/utils/whatsapp.ts`, duplicado em `src/api/store/webhooks/typebot/route.ts`): nenhum conceito de sandbox. Se a API key estiver configurada, o envio é sempre real, para o destinatário real.
- **ClearSale** (`src/api/admin/webhooks/clearsale/route.ts:5-11`): achado incidental, não relacionado a sandbox — se `CLEARSALE_WEBHOOK_SECRET` não estiver configurado, o webhook aceita qualquer requisição sem autenticação nenhuma. E quando está configurado, a comparação é `!==` (não é constant-time).
- O único padrão de "falha rápida" já existente no repo é em `medusa-config.ts:5-10`: um loop que faz `throw` se `JWT_SECRET`/`COOKIE_SECRET`/`DATABASE_URL` estiverem ausentes, antes mesmo do `defineConfig`. Esse é o padrão a estender.
- Não existe hoje nenhuma variável central tipo `APP_ENV`/`IS_SANDBOX` — cada integração lê seu próprio `process.env.X` isoladamente, sem uma fonte única de verdade.

## Decisões

1. **Nova flag dedicada `MARKETPLACE_SANDBOX` (`"true"`/`"false"`), independente do `NODE_ENV`.** `NODE_ENV` continua controlando só comportamento de infra (build, carregamento de `.env`); `MARKETPLACE_SANDBOX` controla exclusivamente comportamento de negócio das integrações SaaS. Evita misturar as duas responsabilidades — o servidor OCI pode (e deve) continuar com `NODE_ENV=production` mesmo sendo um ambiente de teste de negócio.

2. **Default fail-safe: variável ausente ⇒ tratado como `true` (sandbox).** É preciso setar explicitamente `MARKETPLACE_SANDBOX=false` para liberar o comportamento real de produção. Esquecer a variável nunca causa efeito real — o risco de um ambiente "esquecido" sem a flag é sempre o lado seguro.

3. **Utilitário compartilhado `isSandboxMode()`** (novo arquivo `src/utils/sandbox.ts`) como única fonte de verdade, consultado por todo o resto do código em vez de cada arquivo ler `process.env.MARKETPLACE_SANDBOX` diretamente.

4. **Validação de startup fail-fast**, estendendo o bloco `requiredEnvVars` existente em `medusa-config.ts`:
   - `MERCADOPAGO_ACCESS_TOKEN`: sandbox=true exige prefixo `TEST-`; sandbox=false exige que **não** comece com `TEST-`. Mismatch em qualquer direção → `throw` (processo não sobe).
   - `FOCUS_NFE_SANDBOX`: sandbox=true exige `"true"`; sandbox=false exige `"false"`. Mismatch → `throw`.
   - `CLEARSALE_WEBHOOK_SECRET`: passa a ser obrigatória sempre (independente de sandbox) → `throw` se ausente. Correção de segurança independente do escopo de sandbox, mas feita junto por ser um achado direto deste levantamento.

5. **Melhor Envio para de depender de `NODE_ENV`.** A seleção de base URL passa a usar `isSandboxMode()`: sandbox=true sempre usa `sandbox.melhorenvio.com.br`, sandbox=false sempre usa a URL de produção — elimina o comportamento atual onde o ambiente de teste acidentalmente batia na API real.

6. **Brevo (e-mail) e Evolution (WhatsApp): redirecionamento para destinatário de teste fixo, não supressão total.** O envio continua acontecendo de verdade (para provar que a integração funciona), mas em modo sandbox o destinatário é substituído por `TEST_EMAIL_RECIPIENT` / `TEST_WHATSAPP_RECIPIENT` (novas env vars), nunca o e-mail/telefone real do cliente ou vendedor. Se sandbox=true, a API key da integração está configurada, mas o destinatário de teste correspondente não está — o envio é abortado com log de erro (não vaza para o destinatário real por omissão).

7. **Lógica de WhatsApp consolidada em `src/utils/whatsapp.ts`.** Hoje `src/api/store/webhooks/typebot/route.ts` duplica a leitura das mesmas três env vars (`EVOLUTION_API_URL/KEY/INSTANCE`) em vez de usar o util existente — como esse call site também precisa do redirecionamento de sandbox, ele passa a chamar o util compartilhado em vez de duplicar a lógica.

8. **ClearSale: comparação constant-time.** Troca `!==` por `crypto.timingSafeEqual` na verificação de `x-clearsale-secret`, seguindo o mesmo padrão já usado na verificação HMAC do webhook do MercadoPago.

## Arquitetura

### `src/utils/sandbox.ts` (novo)

```ts
export function isSandboxMode(): boolean {
  return process.env.MARKETPLACE_SANDBOX !== "false"
}
```

Único ponto de leitura de `MARKETPLACE_SANDBOX`. Todo o resto do código chama esta função.

### `medusa-config.ts`

Estende o loop de `requiredEnvVars` existente com uma segunda etapa de validação, executada logo em seguida, também antes de `defineConfig`:

- Recalcula `isSandboxMode()`.
- Verifica prefixo de `MERCADOPAGO_ACCESS_TOKEN` contra o modo.
- Verifica `FOCUS_NFE_SANDBOX` contra o modo.
- Verifica presença de `CLEARSALE_WEBHOOK_SECRET` (sempre obrigatória).
- Mensagens de erro citam a variável, o valor esperado dado o modo atual, e como corrigir — mesmo estilo da mensagem já usada para `JWT_SECRET`.

### `src/api/store/shipping/estimate/route.ts` (Melhor Envio)

Troca a condição `process.env.NODE_ENV === "production" ? PROD_URL : SANDBOX_URL` por `isSandboxMode() ? SANDBOX_URL : PROD_URL`. Resto da rota (fallback para tarifas mock quando o token está ausente ou a chamada falha) não muda.

### `src/subscribers/seller-approved-email.ts` (Brevo)

Antes de montar a chamada à API do Brevo: se `isSandboxMode()`, substitui o destinatário pelo valor de `TEST_EMAIL_RECIPIENT`. Se `TEST_EMAIL_RECIPIENT` não estiver setado, loga erro e não envia (mesmo padrão já existente de "faltou config → não envia", só que agora com log explícito em vez de silêncio).

### `src/utils/whatsapp.ts` (Evolution/WhatsApp)

Mesma lógica de redirecionamento, usando `TEST_WHATSAPP_RECIPIENT`. `src/api/store/webhooks/typebot/route.ts` passa a importar e usar esta função em vez de duplicar a leitura de env vars e a chamada HTTP.

### `src/api/admin/webhooks/clearsale/route.ts`

Remove o `if (secret)` condicional (a validação de startup já garante que `CLEARSALE_WEBHOOK_SECRET` sempre existe em runtime). Troca a comparação de string por `crypto.timingSafeEqual` sobre buffers de tamanho igual (com checagem de tamanho antes, para não vazar timing por length).

### Novas variáveis de ambiente

Adicionadas a `infra/.env.template` (com comentário explicando o propósito) e a `CREDENTIALS.md` (local, gitignored):

| Variável | Exemplo | Obrigatória quando |
|---|---|---|
| `MARKETPLACE_SANDBOX` | `true` | Sempre recomendada; ausente = `true` |
| `TEST_EMAIL_RECIPIENT` | `lupontes@gmail.com` | sandbox=true e `BREVO_API_KEY` configurada |
| `TEST_WHATSAPP_RECIPIENT` | número de teste no formato aceito pela Evolution API | sandbox=true e `EVOLUTION_API_KEY` configurada |

`FOCUS_NFE_SANDBOX` no `.env.template` atual está com default `false` — corrigido para `true`, já que o template é a base para um ambiente novo/de teste.

## Fora de escopo

- Rotação/verificação de que a `MELHOR_ENVIO_TOKEN`, `BREVO_API_KEY` e `EVOLUTION_API_KEY` configuradas são de fato de teste — essas integrações não têm um formato de token que permita distinguir sandbox de produção por inspeção (diferente do MercadoPago e Focus NFe), então a validação de startup não cobre esses três. A mitigação é o redirecionamento de destinatário (decisão 6), que funciona independente de qual credencial está configurada.
- Alterar o `infra/.env` real do servidor OCI — passo manual, feito depois do código pronto (ver "Rollout" abaixo). Não posso preencher credenciais reais.
- Atualizar `docs/qa/2026-07-12-admin-payouts-manual-test.md` agora — ver "Rollout".

## Rollout (fora do plano de implementação de código, mas parte da entrega)

1. Código implementado e mesclado.
2. `infra/.env` do servidor OCI atualizado manualmente: `MARKETPLACE_SANDBOX=true`, `MERCADOPAGO_ACCESS_TOKEN` trocado para o token `TEST-...` (já documentado em `CREDENTIALS.md`), `FOCUS_NFE_SANDBOX=true`, `TEST_EMAIL_RECIPIENT`/`TEST_WHATSAPP_RECIPIENT` preenchidos.
3. Backend reiniciado no servidor; validação de startup confirma que subiu sem erro (prova que a configuração bate com o modo sandbox).
4. `docs/qa/2026-07-12-admin-payouts-manual-test.md` atualizado: Teste 5 deixa de ser "falha esperada" (pagamento funciona de verdade em sandbox), Parte 4 é desbloqueada (comissões reais passam a existir), e uma nota é adicionada no topo do documento deixando explícito que ele deve ser mantido em sincronia com mudanças de ambiente.

## Testes

- `isSandboxMode()`: ausente → `true`; `"true"` → `true`; `"false"` → `false`; qualquer outro valor → `true` (fail-safe).
- Validação de startup: casos de match e mismatch para MercadoPago e Focus NFe em ambas as direções (sandbox↔produção); ausência de `CLEARSALE_WEBHOOK_SECRET`.
- Melhor Envio: seleção de URL correta em sandbox e produção, independente de `NODE_ENV`.
- Brevo/WhatsApp: redirecionamento do destinatário em sandbox; abort com log quando o destinatário de teste não está configurado.
- ClearSale: `timingSafeEqual` aceita o segredo correto e rejeita incorreto/tamanho diferente.
