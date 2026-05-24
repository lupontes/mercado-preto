import {
  buildNfePayload,
  validateBuyerDocument,
  validateCep,
  type EmitNfeInput,
  type EmitterConfig,
} from "../helpers"

const baseEmitter: EmitterConfig = {
  cnpj: "12345678000195",
  name: "Empresa Teste",
  ie: "123456789",
  street: "Rua das Flores",
  number: "100",
  district: "Centro",
  city: "Cachoeira",
  state: "BA",
  zip: "44300000",
}

const baseInput: EmitNfeInput = {
  orderId: "order-abc",
  sellerId: "seller-1",
  amountCents: 5000,
  buyerName: "João Silva",
  buyerDocument: "123.456.789-09",
  buyerEmail: "joao@test.com",
  buyerAddress: {
    street: "Av. Brasil",
    number: "42",
    district: "Jardins",
    city: "São Paulo",
    state: "SP",
    zipCode: "01310-100",
  },
  items: [
    { description: "Colar artesanal", quantity: 2, unitPrice: 2500 },
  ],
}

// ---------------------------------------------------------------------------
// validateBuyerDocument
// ---------------------------------------------------------------------------

describe("validateBuyerDocument", () => {
  it("returns { cpf } for an 11-digit CPF with formatting", () => {
    expect(validateBuyerDocument("123.456.789-09")).toEqual({ cpf: "12345678909" })
  })

  it("returns { cpf } for a bare 11-digit string", () => {
    expect(validateBuyerDocument("12345678909")).toEqual({ cpf: "12345678909" })
  })

  it("returns { cnpj } for a 14-digit CNPJ with formatting", () => {
    expect(validateBuyerDocument("12.345.678/0001-95")).toEqual({ cnpj: "12345678000195" })
  })

  it("returns { cnpj } for a bare 14-digit string", () => {
    expect(validateBuyerDocument("12345678000195")).toEqual({ cnpj: "12345678000195" })
  })

  it("returns {} for empty string", () => {
    expect(validateBuyerDocument("")).toEqual({})
  })

  it("returns {} for all-zero CPF placeholder (000.000.000-00)", () => {
    expect(validateBuyerDocument("000.000.000-00")).toEqual({})
  })

  it("returns {} for all-zero string", () => {
    expect(validateBuyerDocument("00000000000")).toEqual({})
  })

  it("throws for a 10-digit document", () => {
    expect(() => validateBuyerDocument("1234567890")).toThrow("10 dígito(s)")
  })

  it("throws for a 13-digit document", () => {
    expect(() => validateBuyerDocument("1234567890123")).toThrow("13 dígito(s)")
  })
})

// ---------------------------------------------------------------------------
// validateCep
// ---------------------------------------------------------------------------

describe("validateCep", () => {
  it("strips formatting and returns 8 digits", () => {
    expect(validateCep("01310-100")).toBe("01310100")
  })

  it("accepts a raw 8-digit CEP", () => {
    expect(validateCep("44300000")).toBe("44300000")
  })

  it("throws for a 7-digit CEP", () => {
    expect(() => validateCep("4430000")).toThrow("CEP inválido")
  })

  it("throws for a 9-digit CEP", () => {
    expect(() => validateCep("443000001")).toThrow("CEP inválido")
  })

  it("throws for letters that result in wrong length", () => {
    expect(() => validateCep("ABCDE")).toThrow("CEP inválido")
  })
})

// ---------------------------------------------------------------------------
// buildNfePayload
// ---------------------------------------------------------------------------

describe("buildNfePayload", () => {
  it("sets CPF on destinatario for 11-digit document", () => {
    const payload = buildNfePayload("ref-1", baseInput, baseEmitter) as any
    expect(payload.destinatario.cpf).toBe("12345678909")
    expect(payload.destinatario.cnpj).toBeUndefined()
  })

  it("sets CNPJ on destinatario for 14-digit document", () => {
    const input = { ...baseInput, buyerDocument: "12.345.678/0001-95" }
    const payload = buildNfePayload("ref-1", input, baseEmitter) as any
    expect(payload.destinatario.cnpj).toBe("12345678000195")
    expect(payload.destinatario.cpf).toBeUndefined()
  })

  it("omits CPF and CNPJ for empty document (Consumidor Final)", () => {
    const input = { ...baseInput, buyerDocument: "" }
    const payload = buildNfePayload("ref-1", input, baseEmitter) as any
    expect(payload.destinatario.cpf).toBeUndefined()
    expect(payload.destinatario.cnpj).toBeUndefined()
  })

  it("normalizes CEP in destinatario address", () => {
    const payload = buildNfePayload("ref-1", baseInput, baseEmitter) as any
    expect(payload.destinatario.endereco.cep).toBe("01310100")
  })

  it("normalizes CEP in emitter address", () => {
    const emitter = { ...baseEmitter, zip: "44300-000" }
    const payload = buildNfePayload("ref-1", baseInput, emitter) as any
    expect(payload.emitente.endereco.cep).toBe("44300000")
  })

  it("converts unit price from cents to reais", () => {
    const payload = buildNfePayload("ref-1", baseInput, baseEmitter) as any
    expect(payload.items[0].valor_unitario).toBe(25)
  })

  it("calculates valor_total as quantity × unit price in reais", () => {
    const payload = buildNfePayload("ref-1", baseInput, baseEmitter) as any
    expect(payload.items[0].valor_total).toBe(50)
  })

  it("uses NCM from item when provided", () => {
    const input = { ...baseInput, items: [{ description: "Produto", quantity: 1, unitPrice: 1000, ncm: "61091000" }] }
    const payload = buildNfePayload("ref-1", input, baseEmitter) as any
    expect(payload.items[0].ncm).toBe("61091000")
  })

  it("defaults NCM to 44190000 when not provided", () => {
    const payload = buildNfePayload("ref-1", baseInput, baseEmitter) as any
    expect(payload.items[0].ncm).toBe("44190000")
  })

  it("numbers items starting at 1", () => {
    const input = {
      ...baseInput,
      items: [
        { description: "A", quantity: 1, unitPrice: 100 },
        { description: "B", quantity: 1, unitPrice: 200 },
      ],
    }
    const payload = buildNfePayload("ref-1", input, baseEmitter) as any
    expect(payload.items[0].numero_item).toBe(1)
    expect(payload.items[1].numero_item).toBe(2)
  })

  it("sets correct tax codes on items", () => {
    const payload = buildNfePayload("ref-1", baseInput, baseEmitter) as any
    expect(payload.items[0].icms_situacao_tributaria).toBe("102")
    expect(payload.items[0].pis_situacao_tributaria).toBe("07")
    expect(payload.items[0].cofins_situacao_tributaria).toBe("07")
  })

  it("uses emitter config for emitente block", () => {
    const payload = buildNfePayload("ref-1", baseInput, baseEmitter) as any
    expect(payload.emitente.cnpj).toBe("12345678000195")
    expect(payload.emitente.nome).toBe("Empresa Teste")
    expect(payload.emitente.ie).toBe("123456789")
  })

  it("throws for invalid buyer document length inside buildNfePayload", () => {
    const input = { ...baseInput, buyerDocument: "1234567890" }
    expect(() => buildNfePayload("ref-1", input, baseEmitter)).toThrow("Documento do comprador inválido")
  })

  it("throws for invalid CEP inside buildNfePayload", () => {
    const input = { ...baseInput, buyerAddress: { ...baseInput.buyerAddress, zipCode: "123" } }
    expect(() => buildNfePayload("ref-1", input, baseEmitter)).toThrow("CEP inválido")
  })
})
