import { NuvemshopClient } from "../client"

function mockFetchSequence(responses: Array<{ ok: boolean; status?: number; json: any }>) {
  const fetchMock = jest.fn()
  responses.forEach((r) => {
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({
        ok: r.ok,
        status: r.status ?? 200,
        json: () => Promise.resolve(r.json),
      })
    )
  })
  global.fetch = fetchMock as any
  return fetchMock
}

describe("NuvemshopClient", () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it("getStore() calls /store with auth headers and returns parsed JSON", async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: { email: "contato@mercadopreto.com.br" } },
    ])
    const client = new NuvemshopClient({ storeId: "3779773", accessToken: "tok_123" })

    const store = await client.getStore()

    expect(store.email).toBe("contato@mercadopreto.com.br")
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.tiendanube.com/v1/3779773/store")
    expect(options.headers.Authentication).toBe("bearer tok_123")
    expect(options.headers["User-Agent"]).toContain("Mercado Preto Migration")
  })

  it("listCategories() paginates until a page returns fewer than 30 items", async () => {
    const fullPage = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      parent: 0,
      name: { pt: `Categoria ${i + 1}` },
    }))
    const lastPage = [{ id: 999, parent: 0, name: { pt: "Última" } }]
    mockFetchSequence([{ ok: true, json: fullPage }, { ok: true, json: lastPage }])

    const client = new NuvemshopClient({ storeId: "3779773", accessToken: "tok_123" })
    const categories = await client.listCategories()

    expect(categories).toHaveLength(31)
  })

  it("iterateProducts() yields each page and stops on an empty page", async () => {
    const page1 = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      name: { pt: `Produto ${i + 1}` },
      description: {},
      attributes: [],
      images: [],
      variants: [],
      categories: [],
    }))
    const fetchMock = mockFetchSequence([{ ok: true, json: page1 }, { ok: true, json: [] }])

    const client = new NuvemshopClient({ storeId: "3779773", accessToken: "tok_123" })
    const pages = []
    for await (const page of client.iterateProducts()) {
      pages.push(page)
    }

    expect(pages).toHaveLength(1)
    expect(pages[0]).toEqual(page1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("throws when the API responds with a non-2xx status", async () => {
    mockFetchSequence([{ ok: false, status: 401, json: {} }])
    const client = new NuvemshopClient({ storeId: "3779773", accessToken: "bad" })

    await expect(client.getStore()).rejects.toThrow("Nuvemshop API respondeu 401")
  })
})
