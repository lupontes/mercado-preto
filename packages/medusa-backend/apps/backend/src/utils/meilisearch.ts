export const PRODUCTS_INDEX = "products"
export const SELLERS_INDEX = "sellers"
const MEILI_TIMEOUT_MS = 3000

async function getClient() {
  const host = process.env.MEILISEARCH_HOST
  const apiKey = process.env.MEILISEARCH_API_KEY
  if (!host) return null

  const MeiliSearchModule = await import("meilisearch")
  // meilisearch >= 0.38 exports the class as `Meilisearch`; older versions
  // used `MeiliSearch`. Accepting both avoids "not a constructor" on upgrade.
  const MeiliSearch =
    (MeiliSearchModule as any).Meilisearch ??
    (MeiliSearchModule as any).MeiliSearch ??
    (MeiliSearchModule as any).default
  // Without a timeout a hung server would hold requests far past the point
  // where falling back to the database is still useful.
  return new MeiliSearch({ host, apiKey, timeout: MEILI_TIMEOUT_MS })
}

// Filters and sorting only work once the index settings exist. Applying them
// on first use means a fresh environment works without a manual reindex.
let setup: Promise<void> | null = null

export async function getMeiliClient() {
  const client = await getClient()
  if (client) {
    setup ??= ensureIndexes()
    await setup
  }
  return client
}

export function resetMeiliSetupForTests(): void {
  setup = null
}

/** Quotes a value for a Meilisearch filter so it cannot alter the expression. */
export function meiliFilterValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
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
