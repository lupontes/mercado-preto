import type { EmitNfeInput } from "../helpers"

// ---------------------------------------------------------------------------
// Mock @medusajs/framework/utils BEFORE importing the service.
// Spread the real module so that `model`, `Module`, etc. remain intact —
// only MedusaService is replaced to avoid database initialization.
// ---------------------------------------------------------------------------
jest.mock("@medusajs/framework/utils", () => {
  const actual = jest.requireActual("@medusajs/framework/utils")
  return {
    ...actual,
    MedusaService: () =>
      class {
        createNfDocuments = jest.fn()
        updateNfDocuments = jest.fn()
        listNfDocuments = jest.fn()
      },
  }
})

import FiscalModuleService from "../service"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeService() {
  const svc = new FiscalModuleService() as any

  svc.createNfDocuments = jest.fn().mockResolvedValue({
    id: "doc-1",
    status: "processing",
    focusNfeRef: "order-order-1",
    orderId: "order-1",
    amountCents: 5000,
  })

  svc.updateNfDocuments = jest.fn().mockImplementation(async (data: any) => ({
    id: "doc-1",
    ...data,
  }))

  svc.listNfDocuments = jest.fn().mockResolvedValue([
    { id: "doc-1", status: "error", focusNfeRef: "order-order-1", orderId: "order-1", amountCents: 5000 },
  ])

  return svc as FiscalModuleService & {
    createNfDocuments: jest.Mock
    updateNfDocuments: jest.Mock
    listNfDocuments: jest.Mock
  }
}

const baseInput: EmitNfeInput = {
  orderId: "order-1",
  sellerId: "seller-1",
  amountCents: 5000,
  buyerName: "João Silva",
  buyerDocument: "123.456.789-09",
  buyerEmail: "joao@test.com",
  buyerAddress: {
    street: "Av. Brasil",
    number: "42",
    district: "Centro",
    city: "São Paulo",
    state: "SP",
    zipCode: "01310100",
  },
  items: [{ description: "Produto", quantity: 1, unitPrice: 5000 }],
}

// ---------------------------------------------------------------------------
// emitNfe
// ---------------------------------------------------------------------------

describe("FiscalModuleService.emitNfe", () => {
  beforeEach(() => {
    jest.resetModules()
    delete process.env.FOCUS_NFE_TOKEN
    delete process.env.FOCUS_NFE_SANDBOX
    global.fetch = jest.fn()
  })

  it("throws without creating a document when amountCents is zero", async () => {
    const svc = makeService()
    await expect(svc.emitNfe({ ...baseInput, amountCents: 0 })).rejects.toThrow(
      "Valor do pedido deve ser maior que zero"
    )
    expect(svc.createNfDocuments).not.toHaveBeenCalled()
  })

  it("throws without creating a document when amountCents is negative", async () => {
    const svc = makeService()
    await expect(svc.emitNfe({ ...baseInput, amountCents: -100 })).rejects.toThrow(
      "Valor do pedido deve ser maior que zero"
    )
    expect(svc.createNfDocuments).not.toHaveBeenCalled()
  })

  it("creates document then sets error when FOCUS_NFE_TOKEN is not configured", async () => {
    const svc = makeService()
    await svc.emitNfe(baseInput)

    expect(svc.createNfDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "order-1", status: "processing" })
    )
    expect(svc.updateNfDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ id: "doc-1", status: "error", errorMessage: "FOCUS_NFE_TOKEN não configurado" })
    )
  })

  it("sets status to issued when Focus NFe returns 201", async () => {
    process.env.FOCUS_NFE_TOKEN = "token-test"
    process.env.FOCUS_NFE_CNPJ = "12345678000195"
    process.env.FOCUS_NFE_ADDRESS_ZIP = "44300000"

    const focusResponse = {
      id: "focus-id-1",
      ref: "order-order-1",
      caminho_xml_nota_fiscal: "https://focus.com/xml/1.xml",
      caminho_danfe: "https://focus.com/danfe/1.pdf",
      serie: "1",
      numero: "42",
    }

    ;(global.fetch as jest.Mock).mockResolvedValue({
      status: 201,
      text: jest.fn().mockResolvedValue(JSON.stringify(focusResponse)),
    })

    const svc = makeService()
    await svc.emitNfe(baseInput)

    expect(svc.updateNfDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "doc-1",
        status: "issued",
        focusNfeId: "focus-id-1",
        xmlUrl: "https://focus.com/xml/1.xml",
        pdfUrl: "https://focus.com/danfe/1.pdf",
        series: "1",
        number: "42",
      })
    )
  })

  it("sets status to error when Focus NFe returns 422", async () => {
    process.env.FOCUS_NFE_TOKEN = "token-test"
    process.env.FOCUS_NFE_CNPJ = "12345678000195"
    process.env.FOCUS_NFE_ADDRESS_ZIP = "44300000"

    ;(global.fetch as jest.Mock).mockResolvedValue({
      status: 422,
      text: jest.fn().mockResolvedValue(JSON.stringify({ mensagem: "CNPJ inválido" })),
    })

    const svc = makeService()
    await svc.emitNfe(baseInput)

    expect(svc.updateNfDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ id: "doc-1", status: "error" })
    )
  })

  it("sets status to error on network failure", async () => {
    process.env.FOCUS_NFE_TOKEN = "token-test"
    process.env.FOCUS_NFE_CNPJ = "12345678000195"
    process.env.FOCUS_NFE_ADDRESS_ZIP = "44300000"

    ;(global.fetch as jest.Mock).mockRejectedValue(new Error("ECONNREFUSED"))

    const svc = makeService()
    await svc.emitNfe(baseInput)

    expect(svc.updateNfDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ id: "doc-1", status: "error", errorMessage: "ECONNREFUSED" })
    )
  })

  it("sets status to error when buyer document has invalid length", async () => {
    process.env.FOCUS_NFE_TOKEN = "token-test"
    process.env.FOCUS_NFE_CNPJ = "12345678000195"
    process.env.FOCUS_NFE_ADDRESS_ZIP = "44300000"

    const svc = makeService()
    await svc.emitNfe({ ...baseInput, buyerDocument: "1234567890" })

    expect(svc.updateNfDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ id: "doc-1", status: "error" })
    )
    expect((global.fetch as jest.Mock)).not.toHaveBeenCalled()
  })

  it("uses sandbox URL when FOCUS_NFE_SANDBOX is not 'false'", async () => {
    process.env.FOCUS_NFE_TOKEN = "token-test"
    process.env.FOCUS_NFE_CNPJ = "12345678000195"
    process.env.FOCUS_NFE_ADDRESS_ZIP = "44300000"
    process.env.FOCUS_NFE_SANDBOX = "true"

    ;(global.fetch as jest.Mock).mockResolvedValue({
      status: 201,
      text: jest.fn().mockResolvedValue("{}"),
    })

    const svc = makeService()
    await svc.emitNfe(baseInput)

    const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string
    expect(calledUrl).toContain("homologacao.focusnfe.com.br")
  })

  it("uses production URL when FOCUS_NFE_SANDBOX is 'false'", async () => {
    process.env.FOCUS_NFE_TOKEN = "token-test"
    process.env.FOCUS_NFE_CNPJ = "12345678000195"
    process.env.FOCUS_NFE_ADDRESS_ZIP = "44300000"
    process.env.FOCUS_NFE_SANDBOX = "false"

    ;(global.fetch as jest.Mock).mockResolvedValue({
      status: 201,
      text: jest.fn().mockResolvedValue("{}"),
    })

    const svc = makeService()
    await svc.emitNfe(baseInput)

    const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string
    expect(calledUrl).toContain("api.focusnfe.com.br")
  })
})

// ---------------------------------------------------------------------------
// retryNfe
// ---------------------------------------------------------------------------

describe("FiscalModuleService.retryNfe", () => {
  beforeEach(() => {
    delete process.env.FOCUS_NFE_TOKEN
    delete process.env.FOCUS_NFE_SANDBOX
    global.fetch = jest.fn()
  })

  it("throws when document is not found", async () => {
    const svc = makeService()
    svc.listNfDocuments.mockResolvedValue([])

    await expect(svc.retryNfe("doc-999", baseInput)).rejects.toThrow("Documento não encontrado")
  })

  it("throws when document status is not 'error'", async () => {
    const svc = makeService()
    svc.listNfDocuments.mockResolvedValue([
      { id: "doc-1", status: "issued", focusNfeRef: "order-order-1", orderId: "order-1", amountCents: 5000 },
    ])

    await expect(svc.retryNfe("doc-1", baseInput)).rejects.toThrow(
      "Apenas documentos com erro podem ser reprocessados"
    )
  })

  it("throws without touching the document when amountCents is zero", async () => {
    const svc = makeService()
    await expect(svc.retryNfe("doc-1", { ...baseInput, amountCents: 0 })).rejects.toThrow(
      "Valor do pedido deve ser maior que zero"
    )
    expect(svc.updateNfDocuments).not.toHaveBeenCalled()
  })

  it("resets status to processing before calling Focus NFe", async () => {
    process.env.FOCUS_NFE_TOKEN = "token-test"
    process.env.FOCUS_NFE_CNPJ = "12345678000195"
    process.env.FOCUS_NFE_ADDRESS_ZIP = "44300000"

    ;(global.fetch as jest.Mock).mockResolvedValue({
      status: 201,
      text: jest.fn().mockResolvedValue("{}"),
    })

    const svc = makeService()
    await svc.retryNfe("doc-1", baseInput)

    const firstUpdate = svc.updateNfDocuments.mock.calls[0][0]
    expect(firstUpdate).toMatchObject({ id: "doc-1", status: "processing", errorMessage: null })
  })

  it("sets status to issued when retry succeeds with 200", async () => {
    process.env.FOCUS_NFE_TOKEN = "token-test"
    process.env.FOCUS_NFE_CNPJ = "12345678000195"
    process.env.FOCUS_NFE_ADDRESS_ZIP = "44300000"

    const focusResponse = {
      id: "focus-id-2",
      caminho_xml_nota_fiscal: "https://focus.com/xml/2.xml",
      caminho_danfe: "https://focus.com/danfe/2.pdf",
      serie: "1",
      numero: "43",
    }

    ;(global.fetch as jest.Mock).mockResolvedValue({
      status: 200,
      text: jest.fn().mockResolvedValue(JSON.stringify(focusResponse)),
    })

    const svc = makeService()
    await svc.retryNfe("doc-1", baseInput)

    const lastUpdate = svc.updateNfDocuments.mock.calls.at(-1)[0]
    expect(lastUpdate).toMatchObject({ id: "doc-1", status: "issued", focusNfeId: "focus-id-2" })
  })

  it("sets status back to error when retry fails", async () => {
    process.env.FOCUS_NFE_TOKEN = "token-test"
    process.env.FOCUS_NFE_CNPJ = "12345678000195"
    process.env.FOCUS_NFE_ADDRESS_ZIP = "44300000"

    ;(global.fetch as jest.Mock).mockResolvedValue({
      status: 500,
      text: jest.fn().mockResolvedValue(JSON.stringify({ mensagem: "Erro interno" })),
    })

    const svc = makeService()
    await svc.retryNfe("doc-1", baseInput)

    const lastUpdate = svc.updateNfDocuments.mock.calls.at(-1)[0]
    expect(lastUpdate).toMatchObject({ id: "doc-1", status: "error" })
  })

  it("uses the focusNfeRef stored in the document, not a new ref", async () => {
    process.env.FOCUS_NFE_TOKEN = "token-test"
    process.env.FOCUS_NFE_CNPJ = "12345678000195"
    process.env.FOCUS_NFE_ADDRESS_ZIP = "44300000"

    ;(global.fetch as jest.Mock).mockResolvedValue({
      status: 201,
      text: jest.fn().mockResolvedValue("{}"),
    })

    const svc = makeService()
    svc.listNfDocuments.mockResolvedValue([
      {
        id: "doc-1",
        status: "error",
        focusNfeRef: "order-original-ref",
        orderId: "order-1",
        amountCents: 5000,
      },
    ])

    await svc.retryNfe("doc-1", { ...baseInput, orderId: "order-different" })

    const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string
    expect(calledUrl).toContain("ref=order-original-ref")
  })
})
