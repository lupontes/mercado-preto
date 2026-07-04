// Mirrors the real shape of meilisearch@0.58: the class is exported as
// `Meilisearch` (lowercase s), with no `MeiliSearch` or default — exactly
// what broke /store/search with "MeiliSearch is not a constructor".
jest.mock("meilisearch", () => ({
  Meilisearch: class {
    constructor(public config: { host: string; apiKey?: string }) {}
    index() {}
    createIndex() {}
  },
}))

import { getMeiliClient } from "../meilisearch"

describe("getMeiliClient", () => {
  const originalHost = process.env.MEILISEARCH_HOST
  const originalKey = process.env.MEILISEARCH_API_KEY

  afterEach(() => {
    process.env.MEILISEARCH_HOST = originalHost
    process.env.MEILISEARCH_API_KEY = originalKey
  })

  it("returns null when MEILISEARCH_HOST is not configured", async () => {
    delete process.env.MEILISEARCH_HOST
    await expect(getMeiliClient()).resolves.toBeNull()
  })

  // Guards against the export-name drift that broke /store/search in prod:
  // meilisearch >= 0.38 exports the class as `Meilisearch`, older versions
  // as `MeiliSearch` — resolving to undefined throws "not a constructor".
  it("instantiates a client when MEILISEARCH_HOST is set", async () => {
    process.env.MEILISEARCH_HOST = "http://localhost:7700"
    process.env.MEILISEARCH_API_KEY = "test-key"
    const client = await getMeiliClient()
    expect(client).not.toBeNull()
    expect(typeof client!.index).toBe("function")
    expect(typeof client!.createIndex).toBe("function")
  })
})
