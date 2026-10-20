import { buildCartRequest, LabelOrder, LabelSeller } from "../shipping-label-payload"

const volume = { weight: 0.5, length: 20, width: 15, height: 10 }

const makeOrder = (over: Partial<LabelOrder> = {}): LabelOrder => ({
  displayId: 42,
  serviceId: 1,
  email: "buyer@example.com",
  buyerDocument: "123.456.789-09",
  address: {
    firstName: "Ana",
    lastName: "Silva",
    phone: "(11) 91234-5678",
    street: "Rua A",
    number: "10",
    complement: "Apto 2",
    district: "Centro",
    city: "São Paulo",
    state: "SP",
    postalCode: "01001-000",
  },
  items: [
    { title: "Camiseta", quantity: 2, unitPrice: 5990 },
    { title: "Boné", quantity: 1, unitPrice: 2500 },
  ],
  ...over,
})

const makeSeller = (over: Partial<LabelSeller> = {}): LabelSeller => ({
  name: "Loja X",
  phone: "(21) 3333-4444",
  email: "loja@example.com",
  cpfCnpj: "12.345.678/0001-95",
  address: {
    postalCode: "20040-020",
    street: "Av Rio Branco",
    number: "1",
    complement: null,
    district: "Centro",
    city: "Rio de Janeiro",
    state: "RJ",
  },
  ...over,
})

describe("buildCartRequest", () => {
  it("builds the full body", () => {
    const r = buildCartRequest(makeOrder(), makeSeller(), volume)
    expect(r).toEqual({
      ok: true,
      body: {
        service: 1,
        from: {
          name: "Loja X",
          phone: "2133334444",
          email: "loja@example.com",
          document: "12345678000195",
          address: "Av Rio Branco",
          complement: "",
          number: "1",
          district: "Centro",
          city: "Rio de Janeiro",
          state_abbr: "RJ",
          country_id: "BR",
          postal_code: "20040020",
        },
        to: {
          name: "Ana Silva",
          phone: "11912345678",
          email: "buyer@example.com",
          document: "12345678909",
          address: "Rua A",
          complement: "Apto 2",
          number: "10",
          district: "Centro",
          city: "São Paulo",
          state_abbr: "SP",
          country_id: "BR",
          postal_code: "01001000",
        },
        products: [
          { name: "Camiseta", quantity: 2, unitary_value: 59.9 },
          { name: "Boné", quantity: 1, unitary_value: 25 },
        ],
        volumes: [volume],
        options: {
          insurance_value: 144.8,
          receipt: false,
          own_hand: false,
          reverse: false,
          non_commercial: true,
          tags: [{ tag: "Pedido #42" }],
        },
      },
    })
  })

  it("accepts a CNPJ as buyer document", () => {
    const r = buildCartRequest(makeOrder({ buyerDocument: "12.345.678/0001-95" }), makeSeller(), volume)
    expect(r.ok && (r.body.to as any).document).toBe("12345678000195")
  })

  it("rejects a missing buyer document", () => {
    expect(buildCartRequest(makeOrder({ buyerDocument: null }), makeSeller(), volume)).toEqual({
      ok: false,
      reason: "CPF/CNPJ do comprador ausente",
    })
  })

  it("rejects a missing number or district", () => {
    const base = makeOrder().address
    const reason = "Número ou bairro do comprador ausente"
    expect(buildCartRequest(makeOrder({ address: { ...base, number: null } }), makeSeller(), volume)).toEqual({ ok: false, reason })
    expect(buildCartRequest(makeOrder({ address: { ...base, district: " " } }), makeSeller(), volume)).toEqual({ ok: false, reason })
  })

  it("rejects an incomplete seller address first", () => {
    const seller = makeSeller({ address: { ...makeSeller().address, street: null } })
    expect(buildCartRequest(makeOrder({ buyerDocument: null }), seller, volume)).toEqual({
      ok: false,
      reason: "Endereço de envio da loja incompleto",
    })
  })
})
