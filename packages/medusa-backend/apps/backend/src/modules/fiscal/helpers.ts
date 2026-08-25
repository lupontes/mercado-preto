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
  ncmFallbackUsed?: boolean
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

  // idDest/CFOP must agree: same state = operação interna (1/5102),
  // different state = operação interestadual (2/6102). SEFAZ rejects any
  // other combination (rejection 732).
  const isSameState = emitter.state === input.buyerAddress.state
  const localDestino = isSameState ? 1 : 2
  const cfop = isSameState ? "5102" : "6102"

  // Build flattened address objects for emitente and destinatario
  const emitenteAddress = {
    logradouro_emitente: emitter.street,
    numero_emitente: emitter.number,
    bairro_emitente: emitter.district,
    municipio_emitente: emitter.city,
    uf_emitente: emitter.state,
    cep_emitente: emitter.zip.replace(/\D/g, ""),
  }

  const destinatarioAddress = {
    logradouro_destinatario: input.buyerAddress.street,
    numero_destinatario: input.buyerAddress.number,
    bairro_destinatario: input.buyerAddress.district,
    municipio_destinatario: input.buyerAddress.city,
    uf_destinatario: input.buyerAddress.state,
    cep_destinatario: cep,
  }

  // Build buyer document fields - cpf or cnpj at root level
  const buyerDocFields: Record<string, string> = {}
  if (buyerDoc.cpf) {
    buyerDocFields.cpf_destinatario = buyerDoc.cpf
  } else if (buyerDoc.cnpj) {
    buyerDocFields.cnpj_destinatario = buyerDoc.cnpj
  }

  // SEFAZ-BA rejects (487) emitters without a registered accounting office
  // unless the XML-access authorization list names SEFAZ-BA's own CNPJ.
  // We have no accounting office on file, so we use SEFAZ-BA's CNPJ as
  // instructed by the rejection message itself.
  const SEFAZ_BA_CNPJ = "13937073000156"
  const autorizacaoFields =
    emitter.state === "BA" ? { pessoas_autorizadas: [{ cnpj: SEFAZ_BA_CNPJ }] } : {}

  return {
    natureza_operacao: "Venda de mercadoria",
    data_emissao: new Date().toISOString(),
    tipo_documento: 1,
    finalidade_emissao: 1,
    local_destino: localDestino,
    consumidor_final: 1,
    presenca_comprador: 2,
    // 0 = CIF: emitente contrata o frete e repassa o custo na mesma cobrança do pedido
    modalidade_frete: 0,
    ...autorizacaoFields,

    // Emitente fields at root level
    cnpj_emitente: emitter.cnpj,
    nome_emitente: emitter.name,
    inscricao_estadual_emitente: emitter.ie,
    ...emitenteAddress,

    // Destinatario fields at root level
    nome_destinatario: input.buyerName,
    email_destinatario: input.buyerEmail,
    ...buyerDocFields,
    ...destinatarioAddress,

    items: input.items.map((item, idx) => ({
      numero_item: idx + 1,
      codigo_produto: `PROD-${idx + 1}`,
      descricao: item.description,
      quantidade_comercial: item.quantity,
      quantidade_tributavel: item.quantity,
      unidade_comercial: "UN",
      unidade_tributavel: "UN",
      valor_unitario_comercial: item.unitPrice / 100,
      valor_unitario_tributavel: item.unitPrice / 100,
      valor_bruto: (item.unitPrice * item.quantity) / 100,
      // TODO: placeholder NCM only — products don't carry a real NCM yet.
      // Must be replaced with per-category classification before real
      // (non-homologação) emissions; SEFAZ rejects codes not in its table
      // (e.g. the old "44190000" default doesn't exist, only "44199000" does).
      codigo_ncm: item.ncm || "44199000",
      cfop,
      origem: 0,
      icms_situacao_tributaria: "102",
      pis_situacao_tributaria: "07",
      cofins_situacao_tributaria: "07",
    })),
  }
}
