import { addBusinessDays, labelsEnabled, purchaseShippingLabel, ShippingLabelState } from "../shipping-label"
import { MelhorEnvioError } from "../melhor-envio-labels"
import { PACKAGE_SIZES } from "../package-size"

const NOW = new Date("2026-10-20T12:00:00Z")

function makeOrder(label?: Partial<ShippingLabelState>, overrides: Record<string, unknown> = {}) {
  return {
    id: "order_1",
    display_id: 42,
    email: "buyer@example.com",
    metadata: {
      seller_id: "sel_1",
      shipping_service_id: 1,
      buyer_document: "123.456.789-09",
      address_number: "10",
      address_district: "Centro",
      other: "keep",
      ...(label ? { shipping_label: label } : {}),
    },
    shipping_address: {
      first_name: "Ana", last_name: "Silva", phone: "11999999999", address_1: "Rua A",
      address_2: "", city: "São Paulo", province: "SP", postal_code: "01001-000",
    },
    items: [{ title: "Brinco", quantity: 2, unit_price: 5000, variant_id: "var_1" }],
    ...overrides,
  }
}

const seller = {
  name: "Loja", phone: "11888888888", email: "loja@example.com", cpfCnpj: "12345678909",
  addressPostalCode: "20000-000", addressStreet: "Rua B", addressNumber: "5", addressComplement: "",
  addressDistrict: "Bairro", addressCity: "Rio", addressState: "RJ",
}

function setup(opts: { order?: any; seller?: any; packages?: any; labels?: any; quotes?: any } = {}) {
  const order = opts.order ?? makeOrder()
  const calls: string[] = []
  const updates: any[] = []
  const retrieveOrder = jest.fn(async () => ({ ...order, metadata: { ...order.metadata } }))
  const updateOrders = jest.fn(async (_id: string, data: any) => {
    updates.push(data)
    order.metadata = data.metadata
  })
  const labels = opts.labels ?? {
    addToCart: jest.fn(async () => { calls.push("addToCart"); await Promise.resolve(); return { id: `me_${calls.length}`, price: 1500 } }),
    checkout: jest.fn(async () => { calls.push("checkout") }),
    generate: jest.fn(async () => { calls.push("generate") }),
  }
  const calculator = jest.fn(async () =>
    opts.quotes ?? [{ service: "PAC", serviceId: 1, price: 10, deliveryDays: 5, ...(opts.packages ? { packages: opts.packages } : {}) }],
  )
  const deps: any = {
    orderService: { retrieveOrder, updateOrders },
    sellerService: { retrieveSeller: jest.fn(async () => opts.seller ?? seller) },
    labels, calculator, now: () => NOW, handlingDays: 2,
  }
  return { deps, calls, updates, labels, calculator, retrieveOrder, order }
}

describe("addBusinessDays", () => {
  it("skips the weekend", () => {
    expect(addBusinessDays(new Date("2026-10-23T12:00:00Z"), 2).toISOString().slice(0, 10)).toBe("2026-10-27")
  })
  it("returns the same day for zero", () => {
    expect(addBusinessDays(NOW, 0).toISOString()).toBe(NOW.toISOString())
  })
})

describe("labelsEnabled", () => {
  it("is true only for the literal string true", () => {
    expect(labelsEnabled({ MELHOR_ENVIO_LABELS_ENABLED: "true" } as any)).toBe(true)
    expect(labelsEnabled({ MELHOR_ENVIO_LABELS_ENABLED: "1" } as any)).toBe(false)
    expect(labelsEnabled({} as any)).toBe(false)
  })
})

describe("purchaseShippingLabel", () => {
  it("buys the label, persisting pending first and then generated", async () => {
    const t = setup()
    const state = await purchaseShippingLabel(t.deps, "order_1")
    expect(t.calls).toEqual(["addToCart", "checkout", "generate"])
    expect(t.retrieveOrder).toHaveBeenCalledWith("order_1", {
      relations: ["items", "shipping_address"], select: ["metadata", "display_id", "email"],
    })
    expect(t.updates[0].metadata.shipping_label.status).toBe("pending")
    expect(t.updates[0].metadata.other).toBe("keep")
    expect(state).toMatchObject({
      status: "generated", meOrderIds: ["me_1"], price: 1500, error: null,
      generatedAt: NOW.toISOString(), postBy: addBusinessDays(NOW, 2).toISOString(),
      trackingCode: null, reminderSentAt: null,
    })
    expect(t.order.metadata.shipping_label).toEqual(state)
    expect(t.order.metadata.other).toBe("keep")
  })

  it("sums prices and adds one cart entry per package", async () => {
    const t = setup({ packages: [PACKAGE_SIZES.small, PACKAGE_SIZES.large] })
    const state = await purchaseShippingLabel(t.deps, "order_1")
    expect(t.labels.addToCart).toHaveBeenCalledTimes(2)
    expect(state.price).toBe(3000)
    expect(state.meOrderIds).toHaveLength(2)
    expect(t.labels.checkout).toHaveBeenCalledTimes(1)
  })

  it("uses the medium volume when the quote has no packages", async () => {
    const t = setup()
    await purchaseShippingLabel(t.deps, "order_1")
    const body: any = (t.labels.addToCart.mock.calls as any)[0][0]
    expect(body.volumes).toEqual([PACKAGE_SIZES.medium])
  })

  it("re-quotes from seller to buyer postal code with the order items", async () => {
    const t = setup()
    await purchaseShippingLabel(t.deps, "order_1")
    expect(t.calculator).toHaveBeenCalledWith({
      fromPostalCode: "20000000", toPostalCode: "01001000",
      products: [expect.objectContaining({ id: "var_1", quantity: 2, insuranceValue: 5000 })],
    })
  })

  it("uses variant dimensions when a query dependency is given", async () => {
    const t = setup()
    t.deps.query = { graph: jest.fn(async () => ({ data: [{ id: "var_1", weight: 2, length: 30, width: 20, height: 10 }] })) }
    await purchaseShippingLabel(t.deps, "order_1")
    expect((t.calculator.mock.calls as any)[0][0].products[0]).toMatchObject({ weight: 2, length: 30 })
  })

  it.each(["pending", "generated"] as const)("does not buy again when the state is %s", async (status) => {
    const existing = { status, meOrderIds: ["x"], price: 1, trackingCode: null, generatedAt: null, postBy: null, reminderSentAt: null, error: null }
    const t = setup({ order: makeOrder(existing) })
    const state = await purchaseShippingLabel(t.deps, "order_1")
    expect(t.labels.addToCart).not.toHaveBeenCalled()
    expect(t.updates).toHaveLength(0)
    expect(state).toEqual(existing)
  })

  it("buys once for two concurrent calls", async () => {
    const t = setup()
    const [a, b] = await Promise.all([purchaseShippingLabel(t.deps, "order_1"), purchaseShippingLabel(t.deps, "order_1")])
    expect(t.labels.addToCart).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)
    // Map entry is released: a later call sees the persisted generated state.
    await purchaseShippingLabel(t.deps, "order_1")
    expect(t.labels.addToCart).toHaveBeenCalledTimes(1)
  })

  it("buys again from a failed state", async () => {
    const failed = { status: "failed" as const, meOrderIds: [], price: null, trackingCode: null, generatedAt: null, postBy: null, reminderSentAt: null, error: "x" }
    const t = setup({ order: makeOrder(failed) })
    const state = await purchaseShippingLabel(t.deps, "order_1")
    expect(state.status).toBe("generated")
  })

  it("fails without calling Melhor Envio when the cart request is invalid", async () => {
    const t = setup({ order: makeOrder(undefined, { metadata: { shipping_service_id: 1, address_number: "1", address_district: "x" } }) })
    const state = await purchaseShippingLabel(t.deps, "order_1")
    expect(state.status).toBe("failed")
    expect(state.error).toBe("CPF/CNPJ do comprador ausente")
    expect(t.labels.addToCart).not.toHaveBeenCalled()
  })

  it("fails when the seller address is incomplete", async () => {
    const t = setup({ seller: { ...seller, addressStreet: null } })
    const state = await purchaseShippingLabel(t.deps, "order_1")
    expect(state.error).toBe("Endereço de envio da loja incompleto")
    expect(t.labels.addToCart).not.toHaveBeenCalled()
  })

  it("fails when the quote no longer offers the chosen service", async () => {
    const t = setup({ quotes: [{ service: "SEDEX", serviceId: 2, price: 1, deliveryDays: 1 }] })
    const state = await purchaseShippingLabel(t.deps, "order_1")
    expect(state.status).toBe("failed")
    expect(t.labels.addToCart).not.toHaveBeenCalled()
  })

  it("stores a MelhorEnvioError without token and keeps ids already obtained", async () => {
    const calls: string[] = []
    const labels = {
      addToCart: jest.fn(async () => ({ id: "me_1", price: 1000 })),
      checkout: jest.fn(async () => { throw new MelhorEnvioError(422, JSON.stringify({ message: "Saldo insuficiente" })) }),
      generate: jest.fn(async () => { calls.push("generate") }),
    }
    const t = setup({ labels })
    const state = await purchaseShippingLabel(t.deps, "order_1")
    expect(state.status).toBe("failed")
    expect(state.meOrderIds).toEqual(["me_1"])
    expect(state.error).toBe("Melhor Envio: 422 Saldo insuficiente")
    expect(calls).toEqual([])
    expect(t.order.metadata.shipping_label.status).toBe("failed")
  })

  it("stores a generic message for unexpected errors and never throws", async () => {
    const labels = {
      addToCart: jest.fn(async () => { throw new Error("boom Bearer secret") }),
      checkout: jest.fn(), generate: jest.fn(),
    }
    const t = setup({ labels })
    const state = await purchaseShippingLabel(t.deps, "order_1")
    expect(state.status).toBe("failed")
    expect(state.error).toBe("Falha inesperada ao comprar a etiqueta")
  })
})
