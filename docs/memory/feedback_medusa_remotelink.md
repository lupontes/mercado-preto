---
name: feedback-medusa-remotelink
description: "Medusa v2: remoteLink.create usa foreign keys (seller_id/product_id), não nomes de entidade (seller/product)"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 30f361fc-4aab-44fb-a211-ae7efe12e3cd
---

Ao chamar `remoteLink.create()` no Medusa v2, as chaves do objeto devem ser os **foreign keys** gerados pelo DML, não os nomes da entidade.

**Why:** O `defineLink` gera um joiner config com `foreignKey = "<entity_snake_case>_<primaryKey>"`. A busca no `relationsPairs` usa essas chaves. Passar o nome da entidade (ex: `seller`, `product`) não encontra o registro e lança "Module to type X and Y was not found".

**How to apply:** Sempre que criar um link entre dois módulos no Medusa v2:

```ts
// ❌ ERRADO — usa nome da entidade
await remoteLink.create([{
  [SELLER_MODULE]: { seller: sellerId },
  [Modules.PRODUCT]: { product: productId },
}])

// ✅ CORRETO — usa o foreign key gerado pelo DML
await remoteLink.create([{
  [SELLER_MODULE]: { seller_id: sellerId },
  [Modules.PRODUCT]: { product_id: productId },
}])
```

O foreign key segue o padrão: `camelToSnakeCase(EntityName)_primaryKeyField`. Para `Seller` com id `id` → `seller_id`. Para `Product` com id `id` → `product_id`.

Isso se aplica também a `remoteLink.dismiss()`.
