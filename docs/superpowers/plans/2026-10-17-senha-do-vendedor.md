# Senha do Vendedor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A vendedora aprovada define a senha por um link que funciona, quem esqueceu redefine por e-mail, e nenhuma rota devolve `passwordHash`.

**Architecture:** O módulo `seller` ganha o modelo `seller_password_token`, que guarda só o SHA-256 do token. O consumo do token é feito por um único `UPDATE … RETURNING`, o que o torna atômico. A rota `set-password` e o subscriber de aprovação passam a usar esse modelo. Uma função `toAdminSeller` limpa as respostas do admin. A página `configurar-senha` ganha os dois modos.

**Tech Stack:** Medusa v2 (Jest; `moduleIntegrationTestRunner` com Postgres real), Next.js (Vitest).

**Spec:** `docs/superpowers/specs/2026-10-17-senha-do-vendedor-design.md`

## Global Constraints

- O token tem 32 bytes aleatórios e é enviado em hex. No banco fica `sha256(token)` em hex. O token cru nunca vai para o banco nem para o log.
- Validades:
  - `SETUP_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000` (link da aprovação);
  - `RESET_TOKEN_TTL_MS = 60 * 60 * 1000` (esqueci minha senha).
- O link das duas origens é `<storefront>/vendedor/configurar-senha?token=<token>`. `<storefront>` é o primeiro item de `STORE_CORS`, como no subscriber de hoje, com fallback `http://localhost:3000`.
- Mensagens, exatamente:
  - pedido de link (sempre 200): `Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.`
  - token inválido, expirado ou já usado (400): `Link inválido ou expirado. Peça um novo.`
  - senha curta (400): `A senha deve ter pelo menos 8 caracteres`
  - vendedora sem aprovação (403): `Conta ainda não aprovada. Aguarde a análise da equipe.`
  - sucesso (200): `Senha configurada com sucesso. Agora você pode acessar o portal do vendedor.`
- Backend:
  - `npm run test:unit -- <path>`;
  - testes de módulo com `npm run test:integration:modules -- <path>`, contra o Postgres local do `infra/docker-compose.yml`;
  - `npx tsc --noEmit -p .` antes de cada commit;
  - **nunca rodar `pnpm install` na raiz.**
- Vitrine: `pnpm vitest run <path>` e `pnpm tsc --noEmit`.
- Código e comentários em inglês; textos em pt-BR. Commits em Conventional Commits, em pt-BR, com o trailer da sessão.

## Review Focus

- **Dois envios simultâneos do mesmo link:** só um grava a senha (Task 1, teste concorrente).
- **Link de aprovação antigo depois de um "esqueci minha senha":** deixa de funcionar (Task 1).
- **Pedido de link para um e-mail inexistente, `pending` ou `suspended`:** mesma resposta, sem e-mail e sem token (Task 2).
- **Token cru no log ou no banco:** não pode aparecer (Tasks 1 e 2).
- **Vendedora suspensa com um link ainda válido:** 403, e a senha não muda (Task 2).

---

### Task 1: Modelo, migration e métodos do token

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/modules/seller/models/seller-password-token.ts`
- Modify: `packages/medusa-backend/apps/backend/src/modules/seller/service.ts`
- Create: migration em `packages/medusa-backend/apps/backend/src/modules/seller/migrations/`, gerada com `npx medusa db:generate seller` e conferida à mão
- Test: `packages/medusa-backend/apps/backend/src/modules/seller/__tests__/password-token.integration.spec.ts`

**Interfaces:**
- Produces:
  - `SETUP_TOKEN_TTL_MS` e `RESET_TOKEN_TTL_MS`, exportadas do `service.ts`;
  - `issuePasswordToken(sellerId: string, ttlMs: number): Promise<string>`: invalida os tokens não usados da vendedora, grava o novo e devolve o token cru;
  - `consumePasswordToken(rawToken: string): Promise<string | null>`: devolve o `sellerId` ou `null`;
  - `SellerModuleService.hashToken(raw: string): string`, estático, com o sha256 em hex.

- [ ] **Step 1: Testes que falham** (`moduleIntegrationTestRunner`, como em `modules/checkout/__tests__/service.integration.spec.ts`):
  - `consumes a fresh token exactly once`: emitir e consumir dá o `sellerId`; consumir de novo dá `null`;
  - `lets exactly one of several concurrent consumptions win`: 5 consumos em `Promise.all` têm 1 resultado não nulo;
  - `rejects an expired token`: emitir com `ttlMs = -1000` e consumir dá `null`;
  - `invalidates older unused tokens when a new one is issued`: emitir A, emitir B; consumir A dá `null` e consumir B dá o `sellerId`;
  - `stores only the token hash`: `listSellerPasswordTokens()` tem `tokenHash === SellerModuleService.hashToken(raw)` e nenhum campo igual ao token cru;
  - `returns null for an unknown token`.
- [ ] **Step 2:** Subir o Postgres local (`docker compose -f infra/docker-compose.yml up -d postgres`) e rodar `npm run test:integration:modules -- src/modules/seller/__tests__/password-token.integration.spec.ts`. Esperado: FAIL.
- [ ] **Step 3: Implementar.**
  - O modelo tem `id`, `sellerId` (texto), `tokenHash` (texto único), `expiresAt` (dateTime) e `usedAt` (dateTime, pode ser nulo).
  - O serviço passa a ser `MedusaService({ Seller, SellerPasswordToken })`.
  - A invalidação e o consumo usam `@InjectManager()` e `manager.execute`, no padrão do `checkout`:
    - invalidar: `update "seller_password_token" set "usedAt" = now() where "sellerId" = ? and "usedAt" is null`;
    - consumir: `update … set "usedAt" = now() where "tokenHash" = ? and "usedAt" is null and "expiresAt" > now() and deleted_at is null returning "sellerId"`.
- [ ] **Step 4:** Rodar o comando do Step 2, `npm run test:unit` e `npx tsc --noEmit -p .`. Esperado: tudo verde.
- [ ] **Step 5: Commit** `feat(vendedor): guardar tokens de senha de uso único no banco`

### Task 2: `POST /store/sellers/set-password` com token do banco e e-mail

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/api/store/sellers/set-password/route.ts`
- Create: `packages/medusa-backend/apps/backend/src/utils/seller-password-link.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/store/sellers/set-password/__tests__/route.unit.spec.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `sellerPasswordLink(rawToken: string, env = process.env): string`;
  - `sendSellerPasswordResetEmail(seller: { email: string; ownerName: string }, link: string): Promise<void>`, no mesmo arquivo, usando `sendBrevoEmail`.

- [ ] **Step 1: Testes que falham** (serviço `seller` mockado com `listSellers`, `issuePasswordToken`, `consumePasswordToken` e `updateSellers`; `sendBrevoEmail` mockado com `jest.mock("../../../../../utils/email")`; logger com `info` e `warn`):
  - `answers the generic message and sends nothing for an unknown e-mail`: 200 com a mensagem genérica; `issuePasswordToken` e `sendBrevoEmail` não são chamados;
  - `it.each(["pending", "suspended"])` com o mesmo resultado;
  - `issues a one-hour token and e-mails the link to an approved seller`:
    - `issuePasswordToken` é chamado com `("seller_1", RESET_TOKEN_TTL_MS)`;
    - `sendBrevoEmail` recebe o e-mail da vendedora e um HTML contendo `/vendedor/configurar-senha?token=tok123`;
    - nenhuma chamada do logger contém `tok123`;
  - `sets the password and activates the seller with a valid token`: `consumePasswordToken("tok123")` devolve `"seller_1"`; `updateSellers` recebe `passwordHash` que passa em `SellerModuleService.verifyPassword("senhaNova1", hash)` e `status: "active"`; responde 200 com a mensagem de sucesso;
  - `rejects an invalid or used token`: o consumo devolve `null`, a resposta é 400 com a mensagem do link, e `updateSellers` não é chamado;
  - `rejects a short password before touching the token`: 400, e `consumePasswordToken` não é chamado;
  - `refuses a suspended seller even with a valid token`: 403, e `updateSellers` não é chamado;
  - `does not need the e-mail to set the password`: o body `{ token, password }` sem `email` funciona.
- [ ] **Step 2:** Rodar `npm run test:unit -- src/api/store/sellers/set-password`. Esperado: FAIL.
- [ ] **Step 3: Implementar.**
  - Remover o `Map` em memória.
  - `SetPasswordSchema` passa a ser `{ token: string.min(1), password: string.min(8, …) }`.
  - Validar a senha **antes** de consumir o token, para que um erro de digitação não queime o link.
  - O e-mail de redefinição tem o assunto `Redefinir sua senha no Mercado Preto`, um botão com o link e o aviso de que o link vale por 1 hora.
- [ ] **Step 4:** Rodar o arquivo, `npm run test:unit` e `npx tsc --noEmit -p .`. Esperado: tudo verde.
- [ ] **Step 5: Commit** `fix(vendedor): definir e redefinir a senha por link com token`

### Task 3: E-mail de aprovação com link de token

**Files:**
- Modify: `packages/medusa-backend/apps/backend/src/subscribers/seller-approved-email.ts`
- Test: `packages/medusa-backend/apps/backend/src/subscribers/__tests__/seller-approved-email.unit.spec.ts`

**Interfaces:**
- Consumes: `issuePasswordToken` e `SETUP_TOKEN_TTL_MS` (Task 1); `sellerPasswordLink` (Task 2).

- [ ] **Step 1: Testes que falham:** o serviço mockado ganha `issuePasswordToken`, que resolve para `"tok-setup"`. Ele deve ser chamado com `("seller_1", SETUP_TOKEN_TTL_MS)`. O HTML enviado contém `/vendedor/configurar-senha?token=tok-setup` e **não** contém `email=`. Os testes existentes do arquivo continuam verdes.
- [ ] **Step 2:** Rodar `npm run test:unit -- src/subscribers/__tests__/seller-approved-email.unit.spec.ts`. Esperado: FAIL.
- [ ] **Step 3: Implementar** com `sellerPasswordLink`.
- [ ] **Step 4:** Rodar, `npm run test:unit` e o tsc. Esperado: verde.
- [ ] **Step 5: Commit** `fix(vendedor): enviar link com token no e-mail de aprovação`

### Task 4: Admin sem `passwordHash`

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/utils/admin-seller.ts`
- Modify: em `packages/medusa-backend/apps/backend/src/api/admin/sellers/`:
  - `route.ts`;
  - `[id]/route.ts`;
  - `[id]/approve/route.ts`;
  - `[id]/reject/route.ts`;
  - `[id]/activate/route.ts`;
  - `[id]/suspend/route.ts`.
- Test: `packages/medusa-backend/apps/backend/src/utils/__tests__/admin-seller.unit.spec.ts` e `packages/medusa-backend/apps/backend/src/api/admin/sellers/__tests__/no-password-hash.unit.spec.ts`

**Interfaces:**
- Produces: `toAdminSeller<T extends Record<string, unknown>>(seller: T): Omit<T, "passwordHash">`.

- [ ] **Step 1: Testes que falham:**
  - `toAdminSeller` remove `passwordHash` e mantém os outros campos;
  - **um teste por rota**, com o serviço mockado devolvendo um vendedor com `passwordHash: "salt:hash"`: o JSON de cada rota não contém `passwordHash`. São elas:
    - `GET /admin/sellers` (`sellers[0]`);
    - `POST /admin/sellers`;
    - `GET /admin/sellers/:id`;
    - `POST /admin/sellers/:id`;
    - `approve`, `reject`, `activate` e `suspend`.
  - Para cada rota, reaproveitar os mocks já usados nos testes existentes dela.
- [ ] **Step 2:** Rodar `npm run test:unit -- src/api/admin/sellers src/utils/__tests__/admin-seller.unit.spec.ts`. Esperado: FAIL.
- [ ] **Step 3: Implementar** `toAdminSeller` e aplicar em cada `res.json`.
- [ ] **Step 4:** Rodar, `npm run test:unit` e o tsc. Esperado: verde.
- [ ] **Step 5: Commit** `fix(admin): não devolver o hash da senha nas rotas de vendedores`

### Task 5: Página de configurar senha e "Esqueci minha senha"

**Files:**
- Modify: `apps/storefront/src/lib/seller-api.ts`, onde `setSellerPassword` muda e entra `requestSellerPasswordLink`
- Modify: `apps/storefront/src/lib/__tests__/seller-api.test.ts`
- Modify: `apps/storefront/src/app/vendedor/configurar-senha/page.tsx`
- Modify: `apps/storefront/src/app/painel/login/page.tsx`
- Test: `apps/storefront/src/app/vendedor/configurar-senha/__tests__/page.test.tsx` e `apps/storefront/src/app/painel/login/__tests__/` (o arquivo existente)

**Interfaces:**
- Consumes: o contrato da Task 2.
- Produces:
  - `setSellerPassword(token: string, password: string): Promise<{ message: string }>`;
  - `requestSellerPasswordLink(email: string): Promise<{ message: string }>`.
  - Os dois fazem `POST /store/sellers/set-password` com o header `x-publishable-api-key` e lançam `body.error` em erro.

- [ ] **Step 1: Testes que falham:**
  - `seller-api`: `setSellerPassword("tok", "senhaNova1")` envia o body `{ token: "tok", password: "senhaNova1" }`, sem `email`; `requestSellerPasswordLink("a@b.com")` envia `{ email: "a@b.com" }`;
  - página com `?token=tok`:
    - envia o token e a senha e mostra `Senha configurada!`;
    - com o erro `Link inválido ou expirado. Peça um novo.`, mostra a mensagem e o link `Pedir um novo link`, para `/vendedor/configurar-senha`;
    - senhas diferentes mostram `As senhas não coincidem.` sem chamar a API;
  - página sem token: mostra o campo `E-mail`; enviar chama `requestSellerPasswordLink` e mostra `Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.`; não redireciona mais para o login;
  - login: tem o link `Esqueci minha senha` para `/vendedor/configurar-senha`.
- [ ] **Step 2:** Rodar `pnpm vitest run src/lib/__tests__/seller-api.test.ts src/app/vendedor src/app/painel/login`. Esperado: FAIL.
- [ ] **Step 3: Implementar.** `useSearchParams` lê `token`, e o `Suspense` existente continua.
- [ ] **Step 4:** Rodar `pnpm vitest run` e `pnpm tsc --noEmit`. Esperado: verde.
- [ ] **Step 5: Commit** `fix(vendedor): configurar senha pelo link e pedir novo link na página`
