import { stripPendingChanges } from "../strip-pending-changes"

describe("stripPendingChanges", () => {
  it("removes pending_changes from a product nested in an order", () => {
    const order = {
      id: "order_1",
      items: [
        {
          id: "item_1",
          variant: {
            id: "variant_1",
            product: {
              id: "prod_1",
              metadata: { pending_changes: { title: "Draft" }, origin: "seller" },
            },
          },
        },
      ],
    }

    const result = stripPendingChanges({ order })

    expect(result.order.items[0].variant.product.metadata).toEqual({ origin: "seller" })
  })

  it("strips every element of top-level and nested arrays", () => {
    const products = [
      { id: "p1", metadata: { pending_changes: { a: 1 } } },
      { id: "p2", metadata: { pending_changes: { b: 2 }, keep: true } },
      [{ id: "p3", metadata: { pending_changes: {} } }],
    ]

    const result = stripPendingChanges(products) as any[]

    expect(result[0].metadata).toEqual({})
    expect(result[1].metadata).toEqual({ keep: true })
    expect(result[2][0].metadata).toEqual({})
  })

  it("does not mutate the input, which may be shared with a cache", () => {
    const product = { id: "p1", metadata: { pending_changes: { a: 1 }, keep: 1 } }
    const input = { product }

    const result = stripPendingChanges(input)

    expect(product.metadata).toEqual({ pending_changes: { a: 1 }, keep: 1 })
    expect(result).not.toBe(input)
    expect(result.product.metadata).toEqual({ keep: 1 })
  })

  it("returns the same references when there is nothing to strip", () => {
    const input = { order: { id: "o1", metadata: { note: "x" }, items: [{ id: "i1" }] } }

    const result = stripPendingChanges(input)

    expect(result).toBe(input)
    expect(result.order.metadata).toEqual({ note: "x" })
  })

  it("leaves objects without metadata and a pending_changes outside metadata untouched", () => {
    const input = { pending_changes: "not metadata", nested: { pending_changes: 1 } }

    expect(stripPendingChanges(input)).toEqual({ pending_changes: "not metadata", nested: { pending_changes: 1 } })
  })

  it("terminates on cyclic payloads", () => {
    const product: any = { id: "p1", metadata: { pending_changes: { a: 1 } } }
    product.self = product
    const order: any = { items: [{ product }] }
    order.items[0].order = order

    const result = stripPendingChanges(order)

    expect(result.items[0].product.metadata).toEqual({})
  })

  it("passes primitives, null and metadata null through", () => {
    expect(stripPendingChanges(null)).toBeNull()
    expect(stripPendingChanges("x")).toBe("x")
    expect(stripPendingChanges(3)).toBe(3)
    expect(stripPendingChanges({ metadata: null })).toEqual({ metadata: null })
  })

  it("keeps the prototype of copied objects so toJSON still works", () => {
    class Wrapper {
      constructor(public metadata: Record<string, unknown>) {}
      toJSON() {
        return { wrapped: this.metadata }
      }
    }
    const result = stripPendingChanges({ w: new Wrapper({ pending_changes: 1, k: 2 }) })

    expect(JSON.parse(JSON.stringify(result))).toEqual({ w: { wrapped: { k: 2 } } })
  })
})
