export const PRODUCTS_INDEX = "products"
export const SELLERS_INDEX = "sellers"

async function getClient() {
  const host = process.env.MEILISEARCH_HOST
  const apiKey = process.env.MEILISEARCH_API_KEY
  if (!host) return null

  const MeiliSearchModule = await import("meilisearch")
  // meilisearch >= 0.38 exporta a classe como `Meilisearch`; versões antigas
  // usavam `MeiliSearch`. Aceitar ambas evita "not a constructor" em upgrade.
  const MeiliSearch =
    (MeiliSearchModule as any).Meilisearch ??
    (MeiliSearchModule as any).MeiliSearch ??
    (MeiliSearchModule as any).default
  return new MeiliSearch({ host, apiKey })
}

export function getMeiliClient() {
  return getClient()
}

export async function ensureIndexes(): Promise<void> {
  const meili = await getClient()
  if (!meili) return

  await meili.createIndex(PRODUCTS_INDEX, { primaryKey: "id" }).catch(() => {})
  await meili.createIndex(SELLERS_INDEX, { primaryKey: "id" }).catch(() => {})

  await meili.index(PRODUCTS_INDEX).updateSettings({
    searchableAttributes: ["title", "description", "handle", "sellerName", "category"],
    filterableAttributes: ["status", "sellerId", "category", "sellerLocation"],
    sortableAttributes: ["created_at", "title"],
  }).catch(() => {})

  await meili.index(SELLERS_INDEX).updateSettings({
    searchableAttributes: ["name", "bio", "category", "location"],
    filterableAttributes: ["status", "category", "location"],
    sortableAttributes: ["created_at", "name"],
  }).catch(() => {})
}

export async function indexProduct(product: Record<string, any>): Promise<void> {
  const meili = await getClient()
  if (!meili) return
  await meili.index(PRODUCTS_INDEX).addDocuments([product]).catch(() => {})
}

export async function removeProduct(id: string): Promise<void> {
  const meili = await getClient()
  if (!meili) return
  await meili.index(PRODUCTS_INDEX).deleteDocument(id).catch(() => {})
}

export async function indexSeller(seller: Record<string, any>): Promise<void> {
  const meili = await getClient()
  if (!meili) return
  await meili.index(SELLERS_INDEX).addDocuments([seller]).catch(() => {})
}

export async function removeSeller(id: string): Promise<void> {
  const meili = await getClient()
  if (!meili) return
  await meili.index(SELLERS_INDEX).deleteDocument(id).catch(() => {})
}
