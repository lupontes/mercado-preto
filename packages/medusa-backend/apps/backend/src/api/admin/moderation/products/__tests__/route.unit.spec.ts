import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { GET } from "../route"

function makeReq(pages: any[][], q: Record<string, string> = {}) {
  const graph = jest.fn()
  pages.forEach((p) => graph.mockResolvedValueOnce({ data: p }))
  graph.mockResolvedValue({ data: [] })
  const req = { scope: { resolve: (k: string) => (k === ContainerRegistrationKeys.QUERY ? { graph } : undefined) }, query: q } as any
  return { req, graph }
}

function makeRes() {
  const res = { _status: 200, _body: undefined as any } as any
  res.status = (c: number) => { res._status = c; return res }
  res.json = (b: unknown) => { res._body = b; return res }
  return res
}

const base = { thumbnail: null, seller: { name: "Loja" }, metadata: null }

describe("GET /admin/moderation/products", () => {
  it("lists proposed and pending-change products, oldest first, ignoring the rest", async () => {
    const { req } = makeReq([[
      { ...base, id: "p_new_late", title: "A", status: "proposed", created_at: "2026-10-03T00:00:00Z", metadata: { submitted_at: "2026-10-05T00:00:00Z" } },
      { ...base, id: "p_change", title: "B", status: "published", created_at: "2026-01-01T00:00:00Z", metadata: { pending_changes: { title: "B2", submittedAt: "2026-10-04T00:00:00Z" } } },
      { ...base, id: "p_new_early", title: "C", status: "proposed", created_at: "2026-10-01T00:00:00Z" },
      { ...base, id: "p_plain", title: "D", status: "published", created_at: "2026-01-01T00:00:00Z" },
      { ...base, id: "p_draft_change", title: "E", status: "draft", thumbnail: "t.png", created_at: "2026-01-01T00:00:00Z", metadata: { pending_changes: { submittedAt: "2026-10-02T00:00:00Z" } } },
    ]])
    const res = makeRes()
    await GET(req, res)

    expect(res._body.items.map((i: any) => [i.id, i.kind, i.submittedAt])).toEqual([
      ["p_new_early", "new", "2026-10-01T00:00:00Z"],
      ["p_draft_change", "change", "2026-10-02T00:00:00Z"],
      ["p_change", "change", "2026-10-04T00:00:00Z"],
      ["p_new_late", "new", "2026-10-05T00:00:00Z"],
    ])
    expect(res._body.items[1]).toEqual({ id: "p_draft_change", title: "E", thumbnail: "t.png", sellerName: "Loja", kind: "change", submittedAt: "2026-10-02T00:00:00Z" })
  })

  it("pages through the whole catalog before filtering", async () => {
    const full = Array.from({ length: 200 }, (_, i) => ({ ...base, id: `p${i}`, title: "x", status: "published", created_at: "2026-01-01T00:00:00Z" }))
    const { req, graph } = makeReq([full, [{ ...base, id: "late", title: "y", status: "proposed", created_at: "2026-10-01T00:00:00Z" }]])
    const res = makeRes()
    await GET(req, res)

    expect(graph).toHaveBeenCalledTimes(2)
    expect(res._body.items.map((i: any) => i.id)).toEqual(["late"])
  })
})
