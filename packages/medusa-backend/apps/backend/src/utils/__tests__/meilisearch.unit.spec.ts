// Mirrors the real shape of meilisearch@0.58: the class is exported as
// `Meilisearch` (lowercase s), with no `MeiliSearch` or default — exactly
// what broke /store/search with "MeiliSearch is not a constructor".
const updateSettings = jest.fn().mockResolvedValue({})
jest.mock("meilisearch", () => ({
  Meilisearch: class {
    constructor(public config: { host: string; apiKey?: string }) {}
    index() {
      return { updateSettings }
    }
    createIndex() {
      return Promise.resolve({})
    }
  },
}))

import { getMeiliClient, meiliFilterValue, resetMeiliSetupForTests } from "../meilisearch"

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

describe("index settings", () => {
  const originalHost = process.env.MEILISEARCH_HOST

  afterEach(() => {
    process.env.MEILISEARCH_HOST = originalHost
  })

  it("applies the index settings once per process, on first use", async () => {
    process.env.MEILISEARCH_HOST = "http://localhost:7700"
    resetMeiliSetupForTests()
    updateSettings.mockClear()

    await getMeiliClient()
    await getMeiliClient()

    // One call per index (products and sellers), and only once.
    expect(updateSettings).toHaveBeenCalledTimes(2)
  })
})

describe("meiliFilterValue", () => {
  it("quotes a plain value", () => {
    expect(meiliFilterValue("a")).toBe('"a"')
  })

  it("escapes quotes so a value cannot change the filter", () => {
    expect(meiliFilterValue('x" OR status = "draft')).toBe('"x\\" OR status = \\"draft"')
  })

  it("escapes backslashes", () => {
    expect(meiliFilterValue("a\\b")).toBe('"a\\\\b"')
  })
})

describe("client timeout", () => {
  it("bounds every request, so a hung server cannot stall the search fallback", async () => {
    process.env.MEILISEARCH_HOST = "http://localhost:7700"
    const client: any = await getMeiliClient()
    expect(client.config.timeout).toBeGreaterThan(0)
    expect(client.config.timeout).toBeLessThanOrEqual(5000)
  })
})
