import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { GET } from "../route"

const commission = (status: string, payout: number) => ({ status, sellerPayout: payout })

function makeReq(graphData: unknown[]) {
  const listCommissions = jest.fn(async (filters: any) =>
    filters.status === "pending"
      ? [commission("pending", 300)]
      : [commission("paid", 900), commission("pending", 300)]
  )
  const graph = jest.fn().mockResolvedValue({ data: graphData })
  const services: Record<string, unknown> = { commission: { listCommissions }, [ContainerRegistrationKeys.QUERY]: { graph } }
  return { req: { sellerId: "seller_1", scope: { resolve: (k: string) => services[k] } } as any, listCommissions, graph }
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("GET /seller/dashboard", () => {
  it("sums the session seller's numbers", async () => {
    const { req, listCommissions, graph } = makeReq([{ products: [{ id: "p1" }, { id: "p2" }] }])
    const res = makeRes()
    await GET(req, res)

    expect(listCommissions).toHaveBeenCalledWith({ sellerId: "seller_1" })
    expect(listCommissions).toHaveBeenCalledWith({ sellerId: "seller_1", status: "pending" })
    expect(graph.mock.calls[0][0].filters).toEqual({ id: "seller_1" })
    expect((res._body as any).stats).toEqual({ totalOrders: 2, pendingOrders: 1, productCount: 2, totalRevenue: 1200, pendingPayout: 300 })
  })

  it("counts zero products when the seller has none", async () => {
    const { req } = makeReq([])
    const res = makeRes()
    await GET(req, res)
    expect((res._body as any).stats.productCount).toBe(0)
  })
})
