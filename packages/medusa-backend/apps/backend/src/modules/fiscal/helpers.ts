export interface EmitNfeInput {
  orderId: string
  sellerId: string
  amountCents: number
  buyerName: string
  buyerDocument: string
  buyerEmail: string
  buyerAddress: {
    street: string
    number: string
    district: string
    city: string
    state: string
    zipCode: string
  }
  items: Array<{
    description: string
    quantity: number
    unitPrice: number
    ncm?: string
  }>
}

export interface EmitterConfig {
  cnpj: string
  name: string
  ie: string
  street: string
  number: string
  district: string
  city: string
  state: string
  zip: string
}

export function getEmitterConfig(): EmitterConfig {
  return {
    cnpj: process.env.FOCUS_NFE_CNPJ || "",
    name: process.env.FOCUS_NFE_COMPANY_NAME || "Mercado Preto — Mulheres de Axé do Brasil",
    ie: process.env.FOCUS_NFE_IE || "",
    street: process.env.FOCUS_NFE_ADDRESS_STREET || "",
    number: process.env.FOCUS_NFE_ADDRESS_NUMBER || "S/N",
    district: process.env.FOCUS_NFE_ADDRESS_DISTRICT || "",
    city: process.env.FOCUS_NFE_ADDRESS_CITY || "Cachoeira",
    state: process.env.FOCUS_NFE_ADDRESS_STATE || "BA",
    zip: process.env.FOCUS_NFE_ADDRESS_ZIP || "",
  }
}

/**
 * Returns { cpf } for 11-digit docs, { cnpj } for 14-digit docs,
 * {} for empty/all-zeros (Consumidor Final without document).
 * Throws for any other length.
 */
export function validateBuyerDocument(doc: string): { cpf?: string; cnpj?: string } {
  const digits = doc.replace(/\D/g, "")
  if (digits.length === 0 || /^0+$/.test(digits)) return {}
  if (digits.length === 11) return { cpf: digits }
  if (digits.length === 14) return { cnpj: digits }
  throw new Error(
    `Documento do comprador inválido: esperado CPF (11 dígitos) ou CNPJ (14 dígitos), recebido ${digits.length} dígito(s)`
  )
}

/** Strips non-digits and validates exactly 8 digits. Returns the clean 8-digit string. */
export function validateCep(cep: string): string {
  const digits = cep.replace(/\D/g, "")
  if (digits.length !== 8) {
    throw new Error(`CEP inválido: esperado 8 dígitos, recebido "${cep}"`)
  }
  return digits
}

/** Builds the Focus NFe request payload from order input and emitter config. */
export function buildNfePayload(
  ref: string,
  input: EmitNfeInput,
  emitter: EmitterConfig
): Record<string, unknown> {
  const buyerDoc = validateBuyerDocument(input.buyerDocument)
  const cep = validateCep(input.buyerAddress.zipCode)

  return {
    natureza_operacao: "Venda de mercadoria",
    data_emissao: new Date().toISOString(),
    tipo_documento: 1,
    local_destino: 1,
    consumidor_final: 1,
    presenca_comprador: 2,
    emitente: {
      cnpj: emitter.cnpj,
      nome: emitter.name,
      ie: emitter.ie,
      endereco: {
        logradouro: emitter.street,
        numero: emitter.number,
        bairro: emitter.district,
        municipio: emitter.city,
        uf: emitter.state,
        cep: emitter.zip.replace(/\D/g, ""),
      },
    },
    destinatario: {
      nome: input.buyerName,
      email: input.buyerEmail,
      ...(buyerDoc.cpf ? { cpf: buyerDoc.cpf } : {}),
      ...(buyerDoc.cnpj ? { cnpj: buyerDoc.cnpj } : {}),
      endereco: {
        logradouro: input.buyerAddress.street,
        numero: input.buyerAddress.number,
        bairro: input.buyerAddress.district,
        municipio: input.buyerAddress.city,
        uf: input.buyerAddress.state,
        cep,
      },
    },
    items: input.items.map((item, idx) => ({
      numero_item: idx + 1,
      codigo_produto: `PROD-${idx + 1}`,
      descricao: item.description,
      quantidade: item.quantity,
      unidade: "UN",
      valor_unitario: item.unitPrice / 100,
      valor_total: (item.unitPrice * item.quantity) / 100,
      ncm: item.ncm || "44190000",
      cfop: "6102",
      origem: 0,
      icms_situacao_tributaria: "102",
      pis_situacao_tributaria: "07",
      cofins_situacao_tributaria: "07",
    })),
  }
}
