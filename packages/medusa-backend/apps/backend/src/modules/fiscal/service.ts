import { MedusaService } from "@medusajs/framework/utils"
import NfDocument from "./models/nf-document"

const FOCUS_NFE_BASE = "https://api.focusnfe.com.br/v2"

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

class FiscalModuleService extends MedusaService({ NfDocument }) {
  private getAuth(): string {
    const token = process.env.FOCUS_NFE_TOKEN || ""
    return `Basic ${Buffer.from(`${token}:`).toString("base64")}`
  }

  private isSandbox(): boolean {
    return process.env.FOCUS_NFE_SANDBOX !== "false"
  }

  private baseUrl(): string {
    return this.isSandbox()
      ? "https://homologacao.focusnfe.com.br/v2"
      : FOCUS_NFE_BASE
  }

  async emitNfe(input: EmitNfeInput): Promise<InstanceType<typeof NfDocument>> {
    const ref = `order-${input.orderId}`

    const [doc] = await this.createNfDocuments({
      orderId: input.orderId,
      sellerId: input.sellerId,
      type: "nfe",
      status: "processing",
      focusNfeRef: ref,
      amountCents: input.amountCents,
    } as any)

    if (!process.env.FOCUS_NFE_TOKEN) {
      const [updated] = await this.updateNfDocuments({
        selector: { id: doc.id },
        data: { status: "error", errorMessage: "FOCUS_NFE_TOKEN não configurado" } as any,
      })
      return updated as any
    }

    const payload = {
      natureza_operacao: "Venda de mercadoria",
      data_emissao: new Date().toISOString(),
      tipo_documento: 1,
      local_destino: 1,
      consumidor_final: 1,
      presenca_comprador: 2,
      emitente: {
        cnpj: process.env.FOCUS_NFE_CNPJ || "",
        nome: "Mercado Preto — Mulheres de Axé do Brasil",
        ie: process.env.FOCUS_NFE_IE || "",
        endereco: {
          logradouro: process.env.FOCUS_NFE_ADDRESS_STREET || "",
          numero: process.env.FOCUS_NFE_ADDRESS_NUMBER || "S/N",
          bairro: process.env.FOCUS_NFE_ADDRESS_DISTRICT || "",
          municipio: process.env.FOCUS_NFE_ADDRESS_CITY || "Cachoeira",
          uf: process.env.FOCUS_NFE_ADDRESS_STATE || "BA",
          cep: process.env.FOCUS_NFE_ADDRESS_ZIP || "",
        },
      },
      destinatario: {
        nome: input.buyerName,
        email: input.buyerEmail,
        cpf: input.buyerDocument.replace(/\D/g, "").length === 11
          ? input.buyerDocument.replace(/\D/g, "")
          : undefined,
        cnpj: input.buyerDocument.replace(/\D/g, "").length === 14
          ? input.buyerDocument.replace(/\D/g, "")
          : undefined,
        endereco: {
          logradouro: input.buyerAddress.street,
          numero: input.buyerAddress.number,
          bairro: input.buyerAddress.district,
          municipio: input.buyerAddress.city,
          uf: input.buyerAddress.state,
          cep: input.buyerAddress.zipCode.replace(/\D/g, ""),
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

    try {
      const response = await fetch(
        `${this.baseUrl()}/nfe?ref=${ref}`,
        {
          method: "POST",
          headers: {
            Authorization: this.getAuth(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      )

      const data = await response.json() as any

      if (response.status === 201 || response.status === 200) {
        const [updated] = await this.updateNfDocuments({
          selector: { id: doc.id },
          data: {
            status: "issued",
            focusNfeId: data.id || data.ref,
            xmlUrl: data.caminho_xml_nota_fiscal,
            pdfUrl: data.caminho_danfe,
            series: data.serie,
            number: data.numero,
            issuedAt: new Date(),
          } as any,
        })
        return updated as any
      }

      const [updated] = await this.updateNfDocuments({
        selector: { id: doc.id },
        data: {
          status: "error",
          errorMessage: JSON.stringify(data).slice(0, 500),
        } as any,
      })
      return updated as any
    } catch (err: any) {
      const [updated] = await this.updateNfDocuments({
        selector: { id: doc.id },
        data: { status: "error", errorMessage: err?.message } as any,
      })
      return updated as any
    }
  }

  async retryNfe(id: string): Promise<InstanceType<typeof NfDocument>> {
    const [doc] = await this.listNfDocuments({ id })
    if (!doc) throw new Error("Documento não encontrado")
    if (doc.status !== "error") throw new Error("Apenas documentos com erro podem ser reprocessados")

    const [reset] = await this.updateNfDocuments({
      selector: { id },
      data: { status: "processing", errorMessage: null } as any,
    })
    return reset as any
  }
}

export default FiscalModuleService
