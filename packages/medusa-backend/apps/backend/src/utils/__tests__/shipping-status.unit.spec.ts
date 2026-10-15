import {
  INITIAL_SHIPPING_STATUS,
  SHIPPING_STATUS_LABELS,
  backfillShippingStatus,
} from "../shipping-status"

function makeOrderService(orders: any[]) {
  return {
    listOrders: jest.fn(async () => orders),
    updateOrders: jest.fn(async (id: string, data: any) => ({ id, ...data })),
  }
}

describe("shipping status", () => {
  it("starts every paid order as awaiting shipment, labelled 'Aguardando envio'", () => {
    expect(INITIAL_SHIPPING_STATUS).toBe("awaiting_shipment")
    expect(SHIPPING_STATUS_LABELS.awaiting_shipment).toBe("Aguardando envio")
    expect(SHIPPING_STATUS_LABELS.shipped).toBe("Enviado")
    expect(SHIPPING_STATUS_LABELS.delivered).toBe("Entregue")
  })
})

describe("backfillShippingStatus", () => {
  it("sets awaiting_shipment on orders without a shipping status, keeping their other metadata", async () => {
    const orderService = makeOrderService([
      { id: "order_1", status: "pending", metadata: { seller_id: "s1", buyer_document: "123" } },
    ])

    const updated = await backfillShippingStatus(orderService)

    expect(updated).toEqual(["order_1"])
    expect(orderService.updateOrders).toHaveBeenCalledWith("order_1", {
      metadata: { seller_id: "s1", buyer_document: "123", shipping_status: "awaiting_shipment" },
    })
  })

  it("skips orders that already have a shipping status and canceled orders", async () => {
    const orderService = makeOrderService([
      { id: "order_shipped", status: "pending", metadata: { shipping_status: "shipped" } },
      { id: "order_canceled", status: "canceled", metadata: { seller_id: "s1" } },
      { id: "order_null_meta", status: "pending", metadata: null },
    ])

    const updated = await backfillShippingStatus(orderService)

    expect(updated).toEqual(["order_null_meta"])
    expect(orderService.updateOrders).toHaveBeenCalledTimes(1)
    expect(orderService.updateOrders).toHaveBeenCalledWith("order_null_meta", {
      metadata: { shipping_status: "awaiting_shipment" },
    })
  })

  it("selects status and metadata explicitly (Medusa's select whitelist returns them undefined otherwise)", async () => {
    const orderService = makeOrderService([])

    await backfillShippingStatus(orderService)

    expect(orderService.listOrders).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ select: expect.arrayContaining(["id", "status", "metadata"]) })
    )
  })

  it("pages through all orders instead of relying on a default page size", async () => {
    const page1 = [
      { id: "o1", status: "pending", metadata: {} },
      { id: "o2", status: "pending", metadata: {} },
    ]
    const page2 = [{ id: "o3", status: "pending", metadata: {} }]
    const orderService = {
      listOrders: jest.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2),
      updateOrders: jest.fn(async () => ({})),
    }

    const updated = await backfillShippingStatus(orderService, 2)

    expect(updated).toEqual(["o1", "o2", "o3"])
    expect(orderService.listOrders).toHaveBeenNthCalledWith(2, {}, expect.objectContaining({ take: 2, skip: 2 }))
  })
})
