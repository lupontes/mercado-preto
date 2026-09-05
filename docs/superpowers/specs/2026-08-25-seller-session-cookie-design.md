# Seller Session via HttpOnly Cookie — Design

**Status**: Approved by user, ready for implementation plan.

## Problem

Pentest de 29/jul (`docs/qa/2026-07-29-pentest-seguranca.md`, branch `docs/pentest-seguranca-2026-07-29`, nunca mergeada) confirmou tecnicamente: o token de sessão do vendedor trafega via header `Authorization: Bearer <token>`, montado no client a partir do token salvo em `localStorage`. Qualquer XSS na origem do storefront rouba o token = takeover completo da conta do vendedor (produtos, pedidos, dados bancários/PIX).

Recomendação do pentest: mover para cookie `HttpOnly` + `SameSite=Strict`.

## Current State (read from code, 2026-08-25)

- `POST /store/sellers/login` (`packages/medusa-backend/apps/backend/src/api/store/sellers/login/route.ts`) gera um JWT HMAC caseiro via `createSellerToken` (`src/utils/seller-jwt.ts`, HS256 manual com `crypto`, expira em 7 dias) e devolve `{ token, seller }` no corpo.
- `sellerAuth` (`src/api/middlewares.ts`) lê `Authorization: Bearer`, verifica com uma cópia duplicada da lógica de `verifySellerToken`, popula `req.sellerId`/`req.sellerEmail`. Aplicado ao matcher `/seller`.
- `sellerCors` (mesmo arquivo, mesmo matcher) já seta `Access-Control-Allow-Credentials: true` e ecoa `Origin` da lista `STORE_CORS` — infraestrutura de cookies cross-origin já está pronta, mesmo não sendo usada hoje.
- Storefront: `useSellerStore` (Zustand + `persist`, `src/lib/seller-store.ts`) guarda `token` e `seller` em `localStorage`. `seller-api.ts` recebe `token` como parâmetro em toda função e monta `Authorization: Bearer ${token}` manualmente. `painel/layout.tsx` guarda rotas checando `isAuthenticated()` (= `!!token`) de forma síncrona, client-side.
- Produção: storefront e backend estão na **mesma origem** (`teste.mercadopreto.com.br`; nginx faz proxy de `/api` para o Medusa) — `NEXT_PUBLIC_MEDUSA_URL=BACKEND_URL=https://teste.mercadopreto.com.br/api`. Não há subdomínios diferentes a coordenar.
- `cookie-parser` resolve como dependência transitiva já presente (`require.resolve('cookie-parser')` funciona), mas não há evidência de que esteja montado no pipeline das rotas custom `/seller/*` — o design não depende disso.

## Goal

Vendedor autentica via cookie `HttpOnly`, inacessível a JavaScript (logo, inacessível a um XSS), sem quebrar nenhum fluxo existente (login, guard de rota, chamadas autenticadas, logout).

## Non-Goals

- Não implementa refresh token / rotação de sessão — mantém a mesma janela de expiração de 7 dias que já existe hoje.
- Não implementa esquema de CSRF token — `SameSite=Strict` é suficiente dado que o portal do vendedor não tem pontos de entrada via link/form de terceiros (usuário sempre navega direto pro `/painel/login`).
- Não migra sessões antigas — estamos em fase de teste, aceitável forçar novo login pra todo vendedor no deploy.
- Não deduplica a lógica de verificação de JWT hoje espalhada entre `utils/seller-jwt.ts` e `api/middlewares.ts` — pré-existente, fora do escopo deste fix.
- Não adiciona `cookie-parser` como dependência — parsing manual do header `Cookie`, no mesmo estilo hand-rolled já usado para o JWT neste arquivo.

## Design

### Cookie

Nome: `seller_session`. Valor: o mesmo JWT que `createSellerToken` já produz — só muda o transporte, não o conteúdo/assinatura/expiração.

Atributos: `HttpOnly`; `Secure` condicional a `process.env.NODE_ENV === "production"` (evita travar dev local em HTTP, já que `Secure` sobre `localhost` tem suporte inconsistente entre browsers); `SameSite=Strict`; `Path=/api`; `Max-Age=604800` (7 dias, igual ao `exp` do JWT).

`Path=/api` restringe o cookie às chamadas de API — nunca é enviado nas requisições de página do Next.js, reduzindo a superfície de exposição.

### Backend

**`src/utils/cookies.ts`** (novo arquivo, helpers puros sem I/O):
- `parseCookie(cookieHeader: string | undefined, name: string): string | null` — parse manual do header `Cookie` (split por `;`, trim, split por primeiro `=`).
- `buildSetCookie(name: string, value: string, maxAgeSeconds: number): string` — monta a string do header `Set-Cookie` com os atributos acima.
- `buildClearCookie(name: string): string` — monta `Set-Cookie` com `Max-Age=0` para logout.

**`POST /store/sellers/login`** (`route.ts`): em vez de `res.json({ token, seller })`, faz `res.setHeader("Set-Cookie", buildSetCookie("seller_session", token, 604800))` e `res.json({ seller })`. Token nunca mais aparece no corpo da resposta.

**`POST /store/sellers/logout`** (novo arquivo `src/api/store/sellers/logout/route.ts`): `res.setHeader("Set-Cookie", buildClearCookie("seller_session"))`, `res.json({ message: "Logout realizado" })`. Sem necessidade de auth prévia (limpar um cookie que já não existe é inofensivo).

**`sellerAuth`** (`api/middlewares.ts`): troca `req.headers.authorization` por `parseCookie(req.headers.cookie, "seller_session")`. Se ausente ou inválido, mesmo comportamento 401 de hoje. `verifySellerToken` local do arquivo não muda (só a origem do valor de `token`).

**`sellerCors`**: sem mudança — já seta `Access-Control-Allow-Credentials: true`. Adicionar o mesmo middleware ao matcher `/store/sellers/logout` (hoje só `/seller` tem `sellerCors`; login/set-password confiam no CORS global do Medusa via `STORE_CORS`, que já suporta credentials porque o core usa `cookieSecret`).

### Frontend

**`src/lib/seller-api.ts`**: toda função perde o parâmetro `token`; `sellerFetch` passa a incluir `credentials: 'include'` no `fetch` em vez do header `Authorization`. `sellerLogin` retorna só `{ seller }`. Nova função `sellerLogout()` chama `POST /store/sellers/logout` com `credentials: 'include'`.

**`src/lib/seller-store.ts`**: remove o campo `token` do estado e do `partialize` — nunca mais persistido em `localStorage`. `isAuthenticated` deixa de existir como derivação síncrona de um token local; a store passa a expor só `seller: SellerProfile | null`, `setSeller`, `clearSeller`.

**`src/app/painel/layout.tsx`**: no `useEffect` de hidratação, em vez de `useSellerStore.persist.rehydrate()` + checar `isAuthenticated()`, chama `getMe()` (com `credentials: 'include'`) uma vez ao montar. 200 → popula `seller` na store, libera o conteúdo. 401/erro → `clearSeller()` + redireciona pro `/painel/login`. Estado de loading enquanto a checagem está em voo (equivalente ao atual `!hydrated`).

**`src/app/painel/login/page.tsx`**: `handleSubmit` chama `sellerLogin(email, password)`, recebe só `{ seller }`, chama `setSeller(seller)` (sem token) e navega. Remove o guard de "já autenticado, redireciona pro dashboard" que hoje roda no mount desta página — decisão deliberada, não fica ambíguo: sem token síncrono no client não há como checar isso sem uma chamada de rede extra a cada visita à tela de login, e o pior caso de não ter o guard é um vendedor já logado ver o formulário de login e precisar navegar manualmente pro dashboard — não é regressão de segurança, só uma pequena perda de conveniência.
**`src/app/painel/perfil/page.tsx`, `produtos/page.tsx`, `produtos/novo/page.tsx`, `produtos/[id]/page.tsx`, `comissoes/page.tsx`, `pedidos/page.tsx`, `dashboard/page.tsx`**: removem `token` de toda chamada a `seller-api.ts` (mecânico — cada `getX(token, ...)` vira `getX(...)`).

**Logout** (usado em `painel/layout.tsx`, `handleLogout`): passa a chamar `sellerLogout()` (await) antes de `clearSeller()` + redirect, para o servidor efetivamente limpar o cookie.

### Error Handling

- Cookie ausente/inválido/expirado no `sellerAuth` → 401 `{ error: "Token inválido ou expirado" }` (comportamento idêntico ao atual, só muda a fonte do valor).
- `getMe()` retornando 401 no layout → tratado como "não autenticado", nunca lançado como exceção não capturada — o layout já tem esse fluxo de redirect, só troca o gatilho.
- `sellerLogout()` falhando (rede) → best-effort; o client limpa o estado local (`clearSeller()`) e redireciona de qualquer forma, já que o pior caso é o cookie expirar sozinho em 7 dias.

### Testing

Backend (`*.unit.spec.ts`, TDD):
- `utils/cookies.ts`: `parseCookie` (cookie presente/ausente/entre outros cookies), `buildSetCookie`/`buildClearCookie` (atributos corretos, `Secure` condicional a `NODE_ENV`).
- Login route: resposta não contém mais `token` no corpo; header `Set-Cookie` presente com os atributos esperados.
- Logout route: header `Set-Cookie` limpa o cookie (`Max-Age=0`).
- `sellerAuth`: não há harness de teste de middleware isolado neste repo hoje — cobrir via teste de integração da rota `GET /seller/me` simulando `req.headers.cookie` (mesmo padrão dos testes de rota já existentes no projeto): aceita cookie válido, rejeita cookie ausente/malformado/expirado, mesma cobertura que já existe pra header hoje.

Frontend (`*.test.ts`/`*.test.tsx`, Vitest):
- `seller-api.ts`: cada função chama `fetch` com `credentials: 'include'`, sem `Authorization` header, sem parâmetro `token`.
- `seller-store.ts`: `token` não existe mais no estado nem é persistido.
- `painel/layout.tsx`: chama `getMe()` ao montar; 200 renderiza filhos; 401 redireciona pro login.
- Ajustar os testes existentes que hoje mockam/passam `token` (`seller-api.test.ts`, `produtos/novo/__tests__/page.test.tsx`, `produtos/[id]/__tests__/page.test.tsx`) para o novo contrato.

Verificação manual em `teste.mercadopreto.com.br` pós-deploy: login seta cookie visível no DevTools com `HttpOnly` marcado (não lido por `document.cookie` no console); refresh mantém sessão; logout limpa o cookie; acesso a `/painel/dashboard` sem sessão redireciona pro login.
