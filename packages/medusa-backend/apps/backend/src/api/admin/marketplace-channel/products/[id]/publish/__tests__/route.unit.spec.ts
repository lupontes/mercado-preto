jest.mock("../../../../../../../utils/mercadolivre-client", () => ({
  getListingFee: jest.fn(),
  createItem: jest.fn(),
}))

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MARKETPLACE_CHANNEL_MODULE } from "../../../../../../../modules/marketplace-channel"
import { getListingFee, createItem } from "../../../../../../../utils/mercadolivre-client"
import { POST } from "../route"

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: "prod_1",
    title: "Bolsa Africana 2 em 1",
    thumbnail: "https://example.com/foto.jpg",
    seller: { id: "seller_1" },
    variants: [{ prices: [{ amount: 18200 }] }],
    ...overrides,
  }
}

function makeScope(overrides: Record<string, unknown>) {
  return {
    resolve: (key: string) => {
      if (key in overrides) return overrides[key]
      throw new Error(`Unexpected resolve: ${String(key)}`)
    },
  }
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

const validBody = { categoryId: "MLB1000", attributes: [{ id: "BRAND", valueName: "Genérica" }] }

describe("POST /admin/marketplace-channel/products/:id/publish", () => {
  beforeEach(() => jest.clearAllMocks())

  it("returns 503 when there's no Mercado Livre credential configured", async () => {
    const channelService = { getCredential: jest.fn().mockResolvedValue(null) }
    const req = {
      params: { id: "prod_1" },
      body: validBody,
      scope: makeScope({ [MARKETPLACE_CHANNEL_MODULE]: channelService }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(503)
  })

  it("returns 400 when the body fails validation", async () => {
    const channelService = { getCredential: jest.fn().mockResolvedValue({ accessToken: "token-abc" }) }
    const req = {
      params: { id: "prod_1" },
      body: {},
      scope: makeScope({ [MARKETPLACE_CHANNEL_MODULE]: channelService }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(400)
  })

  it("publishes the item, records the listing with the resolved sale fee, and returns it", async () => {
    const channelService = {
      getCredential: jest.fn().mockResolvedValue({ accessToken: "token-abc" }),
      recordListing: jest.fn().mockResolvedValue(undefined),
    }
    const graph = jest.fn().mockResolvedValue({ data: [makeProduct()] })
    ;(getListingFee as jest.Mock).mockResolvedValue({ percentageFee: 12.5, fixedFee: 5 })
    ;(createItem as jest.Mock).mockResolvedValue({ id: "MLB999888777" })
    const req = {
      params: { id: "prod_1" },
      body: validBody,
      scope: makeScope({
        [MARKETPLACE_CHANNEL_MODULE]: channelService,
        [ContainerRegistrationKeys.QUERY]: { graph },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(getListingFee).toHaveBeenCalledWith("token-abc", 18200, "MLB1000")
    expect(createItem).toHaveBeenCalledWith("token-abc", expect.objectContaining({ categoryId: "MLB1000", price: 18200 }))
    expect(channelService.recordListing).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: "prod_1",
        sellerId: "seller_1",
        externalItemId: "MLB999888777",
        saleFeePercent: 12.5,
        saleFeeFixed: 5,
      })
    )
    expect(res._status).toBe(200)
    expect((res._body as any).externalItemId).toBe("MLB999888777")
  })

  it("returns 400 when the product has no seller associated", async () => {
    const channelService = { getCredential: jest.fn().mockResolvedValue({ accessToken: "token-abc" }) }
    const graph = jest.fn().mockResolvedValue({ data: [makeProduct({ seller: null })] })
    const req = {
      params: { id: "prod_1" },
      body: validBody,
      scope: makeScope({
        [MARKETPLACE_CHANNEL_MODULE]: channelService,
        [ContainerRegistrationKeys.QUERY]: { graph },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res._status).toBe(400)
  })

  it("records the listing error and returns 502 when the Mercado Livre API call fails", async () => {
    const channelService = {
      getCredential: jest.fn().mockResolvedValue({ accessToken: "token-abc" }),
      recordListingError: jest.fn().mockResolvedValue(undefined),
    }
    const graph = jest.fn().mockResolvedValue({ data: [makeProduct()] })
    ;(getListingFee as jest.Mock).mockRejectedValue(new Error("Mercado Livre listing_prices falhou: 400"))
    const req = {
      params: { id: "prod_1" },
      body: validBody,
      scope: makeScope({
        [MARKETPLACE_CHANNEL_MODULE]: channelService,
        [ContainerRegistrationKeys.QUERY]: { graph },
      }),
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(channelService.recordListingError).toHaveBeenCalledWith("prod_1", "seller_1", "mercado_livre", expect.any(String))
    expect(res._status).toBe(502)
  })
})
