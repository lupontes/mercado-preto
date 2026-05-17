---
name: feedback-medusa-patterns
description: "Medusa v2: padrões e armadilhas descobertas no projeto Mercado Preto"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 30f361fc-4aab-44fb-a211-ae7efe12e3cd
---

Padrões e pegadinhas do Medusa v2 descobertos na prática. Ver também [[feedback-medusa-remotelink]].

**How to apply:** Checar esta lista antes de escrever qualquer código Medusa v2.

---

## MikroORM — ordenação usa snake_case

```ts
// ❌ ERRADO — MikroORM usa nome da coluna, não da propriedade TS
order: { createdAt: "DESC" }

// ✅ CORRETO
order: { created_at: "DESC" }
```

## middlewares.ts deve estar em `src/api/`, não em `src/`

O `ApiLoader` do Medusa v2 escaneia `sourceDir = src/api/` para middlewares. Um arquivo em `src/middlewares.ts` é silenciosamente ignorado.

Arquivo correto: `src/api/middlewares.ts`

## Matcher de middleware é prefix, não glob

```ts
// ❌ Express 4 não suporta ** em app.use()
matcher: "/seller/**"

// ✅ app.use() já faz prefix matching
matcher: "/seller"
```

## dynamicImport não resolve imports relativos .ts em middlewares

Middlewares são carregados com `dynamicImport` em modo ESM — imports de arquivos `.ts` relativos falham. Solução: inline o código no próprio middleware (sem importar utilitários externos).

## Pacotes ESM puro (ex: meilisearch) precisam de dynamic import

```ts
// ❌ Import estático falha com ts-node (CJS)
import { MeiliSearch } from "meilisearch"

// ✅ Dynamic import funciona em qualquer contexto
const { MeiliSearch } = await import("meilisearch")
```

## createProducts / updateProducts — assinatura correta

```ts
// createProducts aceita array
const [product] = await productService.createProducts([{ title, ... }])

// updateProducts NÃO aceita array de objetos com id
// ❌ ERRADO
const [p] = await productService.updateProducts([{ id, ...data }])

// ✅ CORRETO — id como primeiro argumento
const product = await productService.updateProducts(id, data)
```

## createSellers retorna objeto único, não array

```ts
// ❌ ERRADO — MedusaService gera createSellers que retorna objeto
const [seller] = await sellerService.createSellers(data)

// ✅ CORRETO
const seller = await sellerService.createSellers(data)
```

## src/links/ é carregado automaticamente

O `LinkLoader` escaneia `src/links/` do projeto. Não é necessário registrar links no `medusa-config.ts`. O `defineLink` chama `global.MedusaModule.setCustomLink()` como side-effect do import.

## Middlewares não têm acesso a imports relativos de utilitários

JWT verification e qualquer lógica de middleware deve ser inline no arquivo `src/api/middlewares.ts`. Não importar de `../utils/seller-jwt` — o dynamicImport do middleware não resolve esses caminhos.
