# Upload de Foto do Produto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A vendedora envia a foto principal do produto pelo painel, sem precisar hospedar a imagem em outro lugar.

**Architecture:** Uma rota autenticada `POST /seller/uploads` recebe um arquivo por `multer` (em memória), confere o tipo pela assinatura dos bytes e grava pelo `uploadFilesWorkflow` do Medusa no provider local que já serve `/static`. Na vitrine, um componente `ProductImageField` usa `uploadSellerImage` e substitui o campo de URL nas páginas de criação e edição.

**Tech Stack:** Medusa v2 (Jest, express, multer 2.1.1), Next.js (Vitest + Testing Library).

**Spec:** `docs/superpowers/specs/2026-10-17-upload-foto-produto-design.md`

## Global Constraints

- Tipos aceitos: JPEG, PNG e WebP, detectados pela assinatura dos bytes. Limite de 5 MB (`5 * 1024 * 1024`). Um arquivo, campo `file`.
- Nome salvo: `produto-<sellerId>-<uuid>.<ext>`, com `ext` em `jpg`, `png` ou `webp`. Nunca usar `originalname`.
- Mensagens, exatamente:
  - 400 `Escolha uma foto para enviar.`
  - 413 `A foto passa de 5 MB. Escolha uma foto menor.`
  - 415 `Envie uma foto em JPG, PNG ou WebP.`
  - 500 `Não foi possível enviar a foto. Tente novamente.`
  - 429 `Muitos envios em pouco tempo. Aguarde alguns minutos.`
- Limite de frequência: 30 envios por vendedor a cada 10 minutos, chave `sellerId`.
- `multer` entra como dependência direta do backend em `2.1.1` (`npm install multer@2.1.1` em `packages/medusa-backend/apps/backend`, conferindo que o `package-lock.json` de `packages/medusa-backend` muda).
- Backend: `npm run test:unit -- <path>` e `npx tsc --noEmit -p .` antes de cada commit. Vitrine: `pnpm vitest run <path>` e `pnpm tsc --noEmit`.
- Código e comentários em inglês; textos para a vendedora em pt-BR. Commits em Conventional Commits, em pt-BR, com o trailer da sessão.

## Review Focus

- **Arquivo `.jpg` com conteúdo de texto ou HTML**: recusado com 415. O tipo vem dos bytes, não do nome (Task 1).
- **Requisição sem cookie de vendedor**: 401 antes de o `multer` ler o corpo. A ordem dos middlewares importa (Task 2).
- **Dois arquivos ou um campo com nome diferente de `file`**: 400, e não um 500 do `multer` (Task 2).
- **Salvar o produto enquanto a foto ainda está sendo enviada**: o botão de salvar fica desabilitado (Task 4).
- **Erro no upload na edição**: a foto atual do produto continua lá (Task 3).

---

### Task 1: Detectar o tipo da imagem pelos bytes

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/utils/image-type.ts`
- Test: `packages/medusa-backend/apps/backend/src/utils/__tests__/image-type.unit.spec.ts`

**Interfaces:**
- Produces: `detectImageType(buffer: Buffer): { mimeType: "image/jpeg" | "image/png" | "image/webp"; extension: "jpg" | "png" | "webp" } | null`

- [ ] **Step 1: Testes que falham**, com buffers montados no teste:
  - JPEG `FF D8 FF E0 …` → `{ mimeType: "image/jpeg", extension: "jpg" }`;
  - PNG `89 50 4E 47 0D 0A 1A 0A …` → png;
  - WebP `RIFF????WEBP…` → webp;
  - `null` para: GIF (`GIF89a`), SVG (`<svg …`), PDF (`%PDF-`), texto `"hello"`, buffer vazio, um `RIFF` que não é `WEBP` (WAV) e um JPEG truncado com só 2 bytes.
- [ ] **Step 2:** Rodar `npm run test:unit -- src/utils/__tests__/image-type.unit.spec.ts`. Esperado: FAIL (módulo inexistente).
- [ ] **Step 3: Implementar** comparando as assinaturas e conferindo o tamanho mínimo do buffer.
- [ ] **Step 4:** Rodar de novo. Esperado: PASS.
- [ ] **Step 5: Commit** `feat(painel): detectar o tipo da imagem enviada pelos bytes`

### Task 2: Rota `POST /seller/uploads`

**Files:**
- Create: `packages/medusa-backend/apps/backend/src/api/seller/uploads/route.ts`
- Create: `packages/medusa-backend/apps/backend/src/api/seller/uploads/middlewares.ts`
- Modify: `packages/medusa-backend/apps/backend/src/api/middlewares.ts` (rota nova no `defineMiddlewares`)
- Modify: `packages/medusa-backend/apps/backend/package.json` e `packages/medusa-backend/package-lock.json` (`multer@2.1.1`)
- Test: `packages/medusa-backend/apps/backend/src/api/seller/uploads/__tests__/route.unit.spec.ts`
- Test: `packages/medusa-backend/apps/backend/src/api/seller/uploads/__tests__/middlewares.unit.spec.ts`

**Interfaces:**
- Consumes: `detectImageType` (Task 1); `uploadFilesWorkflow` de `@medusajs/medusa/core-flows`.
- Produces:
  - `POST /seller/uploads` → `201 { url: string }`;
  - `sellerImageUpload(req, res, next)`: roda `multer({ storage: memoryStorage(), limits: { fileSize: 5 MB, files: 1 } }).single("file")` e converte os erros do multer: `LIMIT_FILE_SIZE` → 413; `LIMIT_FILE_COUNT` e `LIMIT_UNEXPECTED_FILE` → 400 `Escolha uma foto para enviar.`;
  - `sellerUploadRateLimit`: `rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, keyGenerator: (req) => req.sellerId ?? rateLimitKeyGenerator(req) })` com a mensagem 429.

- [ ] **Step 1: Testes que falham, na rota** (mesmo estilo de `seller/products/__tests__/route.unit.spec.ts`: `jest.mock("@medusajs/medusa/core-flows")`, `makeRes`, `req.scope` com `logger`):
  - `rejects a request without a file`: `req.file` ausente → 400 com a mensagem;
  - `rejects a file whose bytes are not an image`: `req.file = { buffer: Buffer.from("<html>"), originalname: "foto.jpg", mimetype: "image/jpeg" }` → 415, e o workflow não roda;
  - `stores a JPEG under a server-generated name`: buffer JPEG, `originalname: "../../etc/passwd.jpg"` → 201 `{ url }` com a url devolvida pelo workflow; o input do workflow tem um arquivo com `filename` casando `/^produto-seller_1-[0-9a-f-]{36}\.jpg$/`, `mimeType: "image/jpeg"`, `access: "public"` e `content` igual ao buffer em base64;
  - `answers 500 without the raw error when the workflow fails`: `run` rejeita com `Error("disk full")` → 500 `{ error: "Não foi possível enviar a foto. Tente novamente." }` (`toEqual`), e `logger.error` recebe uma string com `disk full` e no máximo 2 argumentos.
- [ ] **Step 2: Testes que falham, no middleware**, com um app `express` real ouvindo em porta 0 e `fetch` + `FormData` + `Blob` do Node, sem mocks do `multer`:
  - um arquivo de 5 MB + 1 byte → 413 com a mensagem;
  - dois arquivos no campo `file` → 400;
  - um arquivo no campo `foto` → 400;
  - um arquivo válido de 10 bytes no campo `file` → o handler seguinte recebe `req.file.buffer` com 10 bytes.
- [ ] **Step 3: Teste que falha, no registro dos middlewares** (em `api/__tests__` se existir, senão no mesmo arquivo do Step 2): a entrada com `matcher: "/seller/uploads"` e `method: ["POST"]` tem `[sellerUploadRateLimit, sellerImageUpload]`, e vem **depois** da entrada `matcher: "/seller"` que tem `sellerAuth`.
- [ ] **Step 4:** Rodar `npm run test:unit -- src/api/seller/uploads`. Esperado: FAIL.
- [ ] **Step 5: Implementar.** `npm install multer@2.1.1` (e `@types/multer` só se o tsc pedir). A rota lê `req.file`, chama `detectImageType`, gera o nome com `crypto.randomUUID()` e roda o workflow com `content: buffer.toString("base64")`. O registro em `middlewares.ts` fica depois da entrada `/seller`.
- [ ] **Step 6:** Rodar o comando do Step 4, depois `npm run test:unit` inteiro e `npx tsc --noEmit -p .`. Esperado: tudo verde e 0 erros.
- [ ] **Step 7: Commit** `feat(painel): adicionar rota de upload de foto para o vendedor`

### Task 3: `uploadSellerImage` e `ProductImageField` na vitrine

**Files:**
- Modify: `apps/storefront/src/lib/seller-api.ts`
- Create: `apps/storefront/src/components/seller/ProductImageField.tsx`
- Test: `apps/storefront/src/lib/__tests__/seller-api-upload.test.ts`
- Test: `apps/storefront/src/components/seller/__tests__/ProductImageField.test.tsx`

**Interfaces:**
- Consumes: `POST /seller/uploads` (Task 2).
- Produces:
  - `uploadSellerImage(file: File): Promise<string>`: `POST` para `${medusaBaseUrl()}/seller/uploads` com `credentials: 'include'` e um `FormData` com `file`. Sem `Content-Type` manual. Devolve `url`; em erro, lança `Error(body.error ?? 'Não foi possível enviar a foto. Tente novamente.')`;
  - `ProductImageField({ value, onChange, onUploadingChange }: { value: string; onChange: (url: string) => void; onUploadingChange?: (uploading: boolean) => void })`.

- [ ] **Step 1: Testes que falham, em `uploadSellerImage`** (`fetch` com `vi.stubGlobal`): envia para uma URL que termina em `/seller/uploads`, com `credentials: 'include'`, um `FormData` cujo `file` é o arquivo, e sem header `Content-Type`; devolve a `url`; com 415 `{ error: 'Envie uma foto em JPG, PNG ou WebP.' }`, lança essa mensagem.
- [ ] **Step 2: Testes que falham, em `ProductImageField`** (jsdom, `userEvent.upload`, `uploadSellerImage` mockado com `vi.mock('@/lib/seller-api')`):
  - foto PNG de 1 KB → aparece `Enviando foto...`, depois `onChange` recebe a URL, `onUploadingChange` recebe `true` e depois `false`, e a prévia (`img` com `alt="Foto principal do produto"`) usa a URL nova;
  - arquivo de 6 MB → mensagem `A foto passa de 5 MB. Escolha uma foto menor.`, sem chamar `uploadSellerImage`;
  - arquivo `image/gif` → `Envie uma foto em JPG, PNG ou WebP.`, sem chamar `uploadSellerImage` (usar `userEvent.upload` com `applyAccept: false`);
  - com `value` preenchido, uma falha do upload mostra a mensagem do erro, não chama `onChange` e a prévia continua com o `value` antigo;
  - clicar em `ou cole o endereço de uma imagem` mostra o campo de URL, e digitar nele chama `onChange`.
- [ ] **Step 3:** Rodar `pnpm vitest run src/lib/__tests__/seller-api-upload.test.ts src/components/seller/__tests__/ProductImageField.test.tsx`. Esperado: FAIL.
- [ ] **Step 4: Implementar.** O `input type="file"` fica escondido atrás do botão `Escolher foto`, com `accept="image/jpeg,image/png,image/webp"`. A prévia usa `<img>` simples (não `next/image`), porque a URL pode vir de qualquer host colado. A checagem local repete o limite e os tipos da Global Constraints.
- [ ] **Step 5:** Rodar o comando do Step 3, depois `pnpm vitest run` e `pnpm tsc --noEmit`. Esperado: tudo verde.
- [ ] **Step 6: Commit** `feat(painel): adicionar campo de foto com upload no painel`

### Task 4: Usar o campo nas páginas de criação e edição

**Files:**
- Modify: `apps/storefront/src/app/painel/produtos/novo/page.tsx` (o `Field` "URL da imagem principal", por volta das linhas 129-138, e o botão de salvar)
- Modify: `apps/storefront/src/app/painel/produtos/[id]/page.tsx` (o mesmo campo, por volta da linha 169, e o botão de salvar)
- Test: `apps/storefront/src/app/painel/produtos/[id]/__tests__/page.test.tsx`
- Test: `apps/storefront/src/app/painel/produtos/novo/__tests__/page.test.tsx` (criar, no estilo do teste de edição)

**Interfaces:**
- Consumes: `ProductImageField` (Task 3).

- [ ] **Step 1: Testes que falham:**
  - edição: com `uploadSellerImage` mockado devolvendo `https://teste.mercadopreto.com.br/static/produto-x.jpg`, enviar uma foto e salvar → a chamada de atualização recebe esse `thumbnail`;
  - criação: o mesmo para a criação;
  - criação: enquanto o upload está pendente (promise não resolvida), o botão de salvar fica desabilitado.
- [ ] **Step 2:** Rodar os dois arquivos de teste. Esperado: FAIL.
- [ ] **Step 3: Implementar.** Trocar o `Field` de URL por `ProductImageField` com `value={form.thumbnail}` e `onChange={(url) => set('thumbnail', url)}`. Guardar `uploading` em estado e usar em `disabled` no botão de salvar.
- [ ] **Step 4:** Rodar `pnpm vitest run` e `pnpm tsc --noEmit`. Esperado: tudo verde.
- [ ] **Step 5: Commit** `feat(painel): enviar a foto do produto direto do formulário`
