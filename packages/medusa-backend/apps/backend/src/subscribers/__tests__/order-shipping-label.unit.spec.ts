import { Modules } from "@medusajs/framework/utils"
import orderShippingLabel from "../order-shipping-label"
import { labelsEnabled, purchaseShippingLabel } from "../../utils/shipping-label"
import { getLabelClient } from "../../utils/melhor-envio-labels"
import { getShippingCalculator } from "../../utils/melhor-envio"
import { alertTeamLabelFailed, notifySellerLabelReady } from "../../utils/shipping-label-notify"

jest.mock("../../utils/shipping-label")
jest.mock("../../utils/melhor-envio-labels")
jest.mock("../../utils/melhor-envio")
jest.mock("../../utils/shipping-label-notify")

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
const seller = { name: "Loja", phone: "71999990000", email: "loja@test.com" }
const order = {
  id: "order_1",
  display_id: 12,
  metadata: { platform_label: true, shipping_service_id: 1, seller_id: "seller_1" } as Record<string, unknown>,
}

function setup(orderOverride: Record<string, unknown> = {}) {
  const orderService = { retrieveOrder: jest.fn().mockResolvedValue({ ...order, ...orderOverride }) }
  const sellerService = { retrieveSeller: jest.fn().mockResolvedValue(seller) }
  const query = { graph: jest.fn() }
  const services: Record<string, unknown> = {
    [Modules.ORDER]: orderService,
    seller: sellerService,
    query,
    logger,
  }
  const container = {
    resolve: (key: string) => {
      if (key in services) return services[key]
      throw new Error(`Unexpected resolve: ${key}`)
    },
  }
  return { orderService, sellerService, container }
}

const run = (container: unknown) =>
  orderShippingLabel({ event: { data: { id: "order_1" } }, container } as any)

describe("orderShippingLabel", () => {
  beforeEach(() => {
    jest.resetAllMocks()
    ;(labelsEnabled as jest.Mock).mockReturnValue(true)
    ;(getLabelClient as jest.Mock).mockReturnValue({ id: "labels" })
    ;(getShippingCalculator as jest.Mock).mockReturnValue({ id: "calc" })
  })

  it("buys the label and notifies the seller when generated", async () => {
    const { container } = setup()
    const state = { status: "generated" }
    ;(purchaseShippingLabel as jest.Mock).mockResolvedValue(state)

    await run(container)

    expect(purchaseShippingLabel).toHaveBeenCalledWith(
      expect.objectContaining({ labels: { id: "labels" }, calculator: { id: "calc" } }),
      "order_1"
    )
    expect(notifySellerLabelReady).toHaveBeenCalledWith(seller, { id: "order_1", displayId: 12 }, state)
    expect(alertTeamLabelFailed).not.toHaveBeenCalled()
  })

  it("alerts the team when the purchase failed", async () => {
    const { container } = setup()
    const state = { status: "failed" }
    ;(purchaseShippingLabel as jest.Mock).mockResolvedValue(state)

    await run(container)

    expect(alertTeamLabelFailed).toHaveBeenCalledWith({ id: "order_1", displayId: 12 }, state)
    expect(notifySellerLabelReady).not.toHaveBeenCalled()
  })

  it("notifies nobody while another call is still pending", async () => {
    const { container } = setup()
    ;(purchaseShippingLabel as jest.Mock).mockResolvedValue({ status: "pending" })

    await run(container)

    expect(notifySellerLabelReady).not.toHaveBeenCalled()
    expect(alertTeamLabelFailed).not.toHaveBeenCalled()
  })

  it("skips purchase and notifications when the label was already generated", async () => {
    const { container } = setup({ metadata: { ...order.metadata, shipping_label: { status: "generated" } } })

    await run(container)

    expect(purchaseShippingLabel).not.toHaveBeenCalled()
    expect(notifySellerLabelReady).not.toHaveBeenCalled()
  })

  it("does nothing when the flag is off", async () => {
    ;(labelsEnabled as jest.Mock).mockReturnValue(false)
    const { container, orderService } = setup()

    await run(container)

    expect(orderService.retrieveOrder).not.toHaveBeenCalled()
    expect(purchaseShippingLabel).not.toHaveBeenCalled()
  })

  it("does nothing without the platform_label mark", async () => {
    const { container } = setup({ metadata: { shipping_service_id: 1 } })
    await run(container)
    expect(purchaseShippingLabel).not.toHaveBeenCalled()
  })

  it("does nothing without a shipping service id", async () => {
    const { container } = setup({ metadata: { platform_label: true } })
    await run(container)
    expect(purchaseShippingLabel).not.toHaveBeenCalled()
  })

  it("warns and returns when there is no label client", async () => {
    ;(getLabelClient as jest.Mock).mockReturnValue(null)
    const { container } = setup()

    await run(container)

    expect(logger.warn).toHaveBeenCalled()
    expect(purchaseShippingLabel).not.toHaveBeenCalled()
  })

  it("logs instead of throwing when something blows up", async () => {
    const { container } = setup()
    ;(purchaseShippingLabel as jest.Mock).mockRejectedValue(new Error("db down"))

    await expect(run(container)).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalled()
  })
})
