import { Modules } from "@medusajs/framework/utils"
import { createOrdersFromCheckout, type CheckoutMeta } from "../create-orders-from-checkout"

function makeContainer(existingBySeller: Record<string, boolean> = {}) {
  const orderService = {
    listOrders: jest.fn(async (filter: any) =>
      existingBySeller[filter.metadata.seller_id] ? [{ id: "existing" }] : []
    ),
    createOrders: jest.fn(async (input: any[]) => input.map((_, i) => ({ id: `order-${i + 1}` }))),
  }
  return {
    resolve: (key: string) => {
      if (key === Modules.ORDER) return orderService
      throw new Error(`Unexpected resolve: ${key}`)
    },
    _orderService: orderService,
  }
}

const address = {
  first_name: "João",
  last_name: "Silva",
  email: "joao@email.com",
  phone: "71999990000",
  address_1: "Rua das Flores",
  address_2: "100",
  city: "Cachoeira",
  state: "BA",
  postal_code: "44300000",
}

const twoSellerMeta: CheckoutMeta = {
  address,
  buyer_document: "11144477735",
  shipping: { id: "pac", name: "PAC", price: 2500 },
  seller_groups: [
    { sellerId: "seller-a", subtotal: 7900, shippingShare: 1500, items: [{ variant_id: "var-1", title: "Camiseta", quantity: 1, price: 7900 }] },
    { sellerId: "seller-b", subtotal: 5000, shippingShare: 1000, items: [{ variant_id: "var-2", title: "Boné", quantity: 1, price: 5000 }] },
  ],
}

describe("createOrdersFromCheckout", () => {
  it("creates one order per seller group with its own shipping share", async () => {
    const container = makeContainer()

    const created = await createOrdersFromCheckout({ container, externalReference: "ref-1", meta: twoSellerMeta })

    expect(created).toEqual([{ id: "order-1" }, { id: "order-2" }])
    const input = container._orderService.createOrders.mock.calls[0][0]
    expect(input).toHaveLength(2)
    expect(input[0].shipping_methods).toEqual([{ name: "PAC", amount: 1500 }])
    expect(input[1].shipping_methods).toEqual([{ name: "PAC", amount: 1000 }])
    expect(input[0].items).toEqual([{ title: "Camiseta", quantity: 1, unit_price: 7900, variant_id: "var-1" }])
    expect(input[0].email).toBe("joao@email.com")
    expect(input[0].shipping_address).toEqual(
      expect.objectContaining({ first_name: "João", postal_code: "44300000", province: "BA", country_code: "br" })
    )
  })

  it("stores the checkout reference, seller and buyer document in metadata, merged with extraMetadata", async () => {
    const container = makeContainer()

    await createOrdersFromCheckout({
      container,
      externalReference: "ref-1",
      meta: twoSellerMeta,
      extraMetadata: { payment_method: "test_cash" },
    })

    const input = container._orderService.createOrders.mock.calls[0][0]
    expect(input[0].metadata).toEqual({
      mercadopago_external_reference: "ref-1",
      seller_id: "seller-a",
      buyer_document: "11144477735",
      payment_method: "test_cash",
    })
  })

  it("only creates orders for seller groups that do not exist yet (idempotency)", async () => {
    const container = makeContainer({ "seller-a": true })

    const created = await createOrdersFromCheckout({ container, externalReference: "ref-1", meta: twoSellerMeta })

    expect(created).toHaveLength(1)
    const input = container._orderService.createOrders.mock.calls[0][0]
    expect(input.map((o: any) => o.metadata.seller_id)).toEqual(["seller-b"])
  })

  it("returns [] without calling createOrders when every group already exists", async () => {
    const container = makeContainer({ "seller-a": true, "seller-b": true })

    const created = await createOrdersFromCheckout({ container, externalReference: "ref-1", meta: twoSellerMeta })

    expect(created).toEqual([])
    expect(container._orderService.createOrders).not.toHaveBeenCalled()
  })

  it("falls back to a single group from seller_id/items/shipping when seller_groups is absent", async () => {
    const container = makeContainer()

    await createOrdersFromCheckout({
      container,
      externalReference: "ref-1",
      meta: {
        address,
        seller_id: "seller-legacy",
        items: [{ variant_id: "var-1", title: "Camiseta", quantity: 1, price: 7900 }],
        shipping: { name: "PAC", price: 1500 },
      },
    })

    const input = container._orderService.createOrders.mock.calls[0][0]
    expect(input).toHaveLength(1)
    expect(input[0].metadata.seller_id).toBe("seller-legacy")
    expect(input[0].shipping_methods).toEqual([{ name: "PAC", amount: 1500 }])
  })

  it("uses fallbackPayer fields when the snapshot address is missing", async () => {
    const container = makeContainer()

    await createOrdersFromCheckout({
      container,
      externalReference: "ref-1",
      meta: { seller_id: "s", items: [{ title: "X", quantity: 1, price: 100 }] },
      fallbackPayer: { email: "payer@mp.com", name: "Ana", surname: "Souza", phone: { number: "7188" }, address: { street_name: "Rua MP", zip_code: "40000000" } },
    })

    const input = container._orderService.createOrders.mock.calls[0][0]
    expect(input[0].email).toBe("payer@mp.com")
    expect(input[0].shipping_address).toEqual(
      expect.objectContaining({ first_name: "Ana", last_name: "Souza", phone: "7188", address_1: "Rua MP", postal_code: "40000000" })
    )
  })
})
