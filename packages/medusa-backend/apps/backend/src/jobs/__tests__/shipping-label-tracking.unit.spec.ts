jest.mock("../../utils/melhor-envio-labels", () => ({ getLabelClient: jest.fn() }))
jest.mock("../../utils/shipping-label", () => ({ labelsEnabled: jest.fn() }))
jest.mock("../../utils/shipping-label-notify", () => ({ notifySellerPostingReminder: jest.fn() }))

import { Modules } from "@medusajs/framework/utils"
import { getLabelClient } from "../../utils/melhor-envio-labels"
import { labelsEnabled } from "../../utils/shipping-label"
import { notifySellerPostingReminder } from "../../utils/shipping-label-notify"
import shippingLabelTracking, { config } from "../shipping-label-tracking"

const label = (over: Record<string, unknown> = {}) => ({
  status: "generated", meOrderIds: ["me-1"], trackingCode: null,
  postBy: "2026-10-23T15:00:00.000Z", reminderSentAt: null, ...over,
})

const order = (id: string, over: Record<string, any> = {}) => ({
  id, status: "pending", display_id: 7,
  metadata: { seller_id: "sel_1", other: "keep", shipping_status: "awaiting_shipment", shipping_label: label(), ...over },
})

function setup(orders: any[], tracking = jest.fn().mockResolvedValue({})) {
  const orderService = {
    listOrders: jest.fn().mockImplementation(async (_f: any, opts: any) => orders.slice(opts.skip, opts.skip + opts.take)),
    updateOrders: jest.fn().mockResolvedValue({}),
  }
  const sellerService = { retrieveSeller: jest.fn().mockResolvedValue({ name: "Loja", phone: "5511" }) }
  const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
  const logger = { info: jest.fn(), error: jest.fn() }
  const container = {
    resolve: (key: string) => {
      if (key === Modules.ORDER) return orderService
      if (key === "seller") return sellerService
      if (key === Modules.EVENT_BUS) return eventBus
      if (key === "logger") return logger
      throw new Error(`Unexpected resolve: ${key}`)
    },
  }
  ;(getLabelClient as jest.Mock).mockReturnValue({ tracking })
  return { container: container as any, orderService, sellerService, eventBus, logger, tracking }
}

// 2026-10-23 12:00 in Sao Paulo (UTC-3)
const DEADLINE_DAY = () => Date.parse("2026-10-23T15:00:00.000Z")

describe("shippingLabelTracking", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(labelsEnabled as jest.Mock).mockReturnValue(true)
  })

  it("exports the schedule config", () => {
    expect(config).toEqual({ name: "shipping-label-tracking", schedule: "0 */2 * * *" })
  })

  it("does nothing when the flag is off", async () => {
    ;(labelsEnabled as jest.Mock).mockReturnValue(false)
    const { container, orderService } = setup([order("o1")])
    await shippingLabelTracking(container)
    expect(orderService.listOrders).not.toHaveBeenCalled()
  })

  it("does nothing when there is no client", async () => {
    const { container, orderService } = setup([order("o1")])
    ;(getLabelClient as jest.Mock).mockReturnValue(null)
    await shippingLabelTracking(container)
    expect(orderService.listOrders).not.toHaveBeenCalled()
  })

  it("persists shipped with the full metadata and emits the event once", async () => {
    const tracking = jest.fn().mockResolvedValue({ "me-1": { status: "posted", trackingCode: "BR123", postedAt: null, deliveredAt: null } })
    const { container, orderService, eventBus } = setup([order("o1")], tracking)

    await shippingLabelTracking(container, () => Date.parse("2026-10-21T15:00:00Z"))

    expect(orderService.updateOrders).toHaveBeenCalledTimes(1)
    const [id, data] = orderService.updateOrders.mock.calls[0]
    expect(id).toBe("o1")
    expect(data.metadata.other).toBe("keep")
    expect(data.metadata.seller_id).toBe("sel_1")
    expect(data.metadata.shipping_status).toBe("shipped")
    expect(data.metadata.shipping_label.trackingCode).toBe("BR123")
    expect(eventBus.emit).toHaveBeenCalledTimes(1)
    expect(eventBus.emit).toHaveBeenCalledWith({ name: "order.shipment_created", data: { id: "o1", tracking_number: "BR123" } })
  })

  it("skips non-generated, delivered and canceled orders", async () => {
    const orders = [
      order("pending", { shipping_label: label({ status: "pending" }) }),
      order("delivered", { shipping_status: "delivered" }),
      { ...order("canceled"), status: "canceled" },
      { id: "nolabel", status: "pending", display_id: 1, metadata: {} },
    ]
    const { container, tracking } = setup(orders)
    await shippingLabelTracking(container, () => 0)
    expect(tracking).not.toHaveBeenCalled()
  })

  it("keeps going with the next chunk when one tracking call fails", async () => {
    const orders = Array.from({ length: 60 }, (_, i) =>
      order(`o${i}`, { shipping_label: label({ meOrderIds: [`me-${i}`] }) }))
    const tracking = jest.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockImplementationOnce(async (ids: string[]) =>
        Object.fromEntries(ids.map((id) => [id, { status: "posted", trackingCode: "T", postedAt: null, deliveredAt: null }])))
    const { container, logger, orderService } = setup(orders, tracking)

    await shippingLabelTracking(container, () => 0)

    expect(tracking).toHaveBeenCalledTimes(2)
    expect(tracking.mock.calls[0][0]).toHaveLength(50)
    expect(tracking.mock.calls[1][0]).toHaveLength(10)
    expect(logger.error).toHaveBeenCalled()
    expect(orderService.updateOrders).toHaveBeenCalledTimes(10)
  })

  it("paginates listOrders", async () => {
    const orders = Array.from({ length: 250 }, (_, i) => order(`o${i}`))
    const { container, orderService } = setup(orders)
    await shippingLabelTracking(container, () => 0)
    expect(orderService.listOrders).toHaveBeenCalledTimes(2)
  })

  it("sends the reminder once on the deadline day and persists reminderSentAt", async () => {
    const { container, orderService } = setup([order("o1")])

    await shippingLabelTracking(container, DEADLINE_DAY)

    expect(notifySellerPostingReminder).toHaveBeenCalledTimes(1)
    expect(notifySellerPostingReminder).toHaveBeenCalledWith(
      { name: "Loja", phone: "5511" }, { id: "o1", displayId: 7 }, expect.objectContaining({ postBy: "2026-10-23T15:00:00.000Z" }))
    const [, data] = orderService.updateOrders.mock.calls[0]
    expect(data.metadata.shipping_label.reminderSentAt).toBe(new Date(DEADLINE_DAY()).toISOString())
    expect(data.metadata.other).toBe("keep")
  })

  it("never sends the reminder the day before the deadline", async () => {
    const { container } = setup([order("o1")])
    await shippingLabelTracking(container, () => DEADLINE_DAY() - 24 * 3600 * 1000)
    expect(notifySellerPostingReminder).not.toHaveBeenCalled()
  })

  it("does not resend when reminderSentAt is already set", async () => {
    const { container, orderService } = setup([order("o1", { shipping_label: label({ reminderSentAt: "2026-10-23T10:00:00.000Z" }) })])
    await shippingLabelTracking(container, DEADLINE_DAY)
    expect(notifySellerPostingReminder).not.toHaveBeenCalled()
    expect(orderService.updateOrders).not.toHaveBeenCalled()
  })

  it("compares calendar days in Sao Paulo, not UTC", async () => {
    // 23:30 BRT on the 23rd is already the 24th in UTC; still the deadline day locally.
    const { container } = setup([order("o1")])
    await shippingLabelTracking(container, () => Date.parse("2026-10-24T02:30:00Z"))
    expect(notifySellerPostingReminder).toHaveBeenCalledTimes(1)
  })

  it("does not remind an order that has just been posted", async () => {
    const tracking = jest.fn().mockResolvedValue({ "me-1": { status: "posted", trackingCode: "BR1", postedAt: null, deliveredAt: null } })
    const { container } = setup([order("o1")], tracking)
    await shippingLabelTracking(container, DEADLINE_DAY)
    expect(notifySellerPostingReminder).not.toHaveBeenCalled()
  })

  it("still sends reminders when every tracking chunk fails", async () => {
    const { container } = setup([order("o1")], jest.fn().mockRejectedValue(new Error("down")))
    await shippingLabelTracking(container, DEADLINE_DAY)
    expect(notifySellerPostingReminder).toHaveBeenCalledTimes(1)
  })
})
