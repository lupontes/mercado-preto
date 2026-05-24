import { MedusaService } from "@medusajs/framework/utils"
import NfDocument from "./models/nf-document"
import { buildNfePayload, getEmitterConfig } from "./helpers"

export type { EmitNfeInput } from "./helpers"

const FOCUS_NFE_BASE = "https://api.focusnfe.com.br/v2"

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

  /**
   * Calls the Focus NFe API and updates the document record with the result.
   * Shared by emitNfe (new document) and retryNfe (existing document).
   */
  private async sendToFocus(
    docId: string,
    ref: string,
    input: import("./helpers").EmitNfeInput
  ): Promise<InstanceType<typeof NfDocument>> {
    if (!process.env.FOCUS_NFE_TOKEN) {
      return await this.updateNfDocuments({
        id: docId,
        status: "error",
        errorMessage: "FOCUS_NFE_TOKEN não configurado",
      } as any) as any
    }

    let payload: Record<string, unknown>
    try {
      payload = buildNfePayload(ref, input, getEmitterConfig())
    } catch (err: any) {
      return await this.updateNfDocuments({
        id: docId,
        status: "error",
        errorMessage: err?.message,
      } as any) as any
    }

    try {
      const response = await fetch(`${this.baseUrl()}/nfe?ref=${ref}`, {
        method: "POST",
        headers: {
          Authorization: this.getAuth(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })

      const rawText = await response.text()
      let data: any
      try {
        data = JSON.parse(rawText)
      } catch {
        data = { raw: rawText }
      }

      if (response.status === 201 || response.status === 200) {
        return await this.updateNfDocuments({
          id: docId,
          status: "issued",
          focusNfeId: data.id || data.ref,
          xmlUrl: data.caminho_xml_nota_fiscal,
          pdfUrl: data.caminho_danfe,
          series: data.serie,
          number: data.numero,
          issuedAt: new Date(),
          errorMessage: null,
        } as any) as any
      }

      return await this.updateNfDocuments({
        id: docId,
        status: "error",
        errorMessage: JSON.stringify(data),
      } as any) as any
    } catch (err: any) {
      return await this.updateNfDocuments({
        id: docId,
        status: "error",
        errorMessage: err?.message,
      } as any) as any
    }
  }

  async emitNfe(
    input: import("./helpers").EmitNfeInput
  ): Promise<InstanceType<typeof NfDocument>> {
    if (input.amountCents <= 0) {
      throw new Error("Valor do pedido deve ser maior que zero")
    }

    const ref = `order-${input.orderId}`

    const doc = await this.createNfDocuments({
      orderId: input.orderId,
      sellerId: input.sellerId,
      type: "nfe",
      status: "processing",
      focusNfeRef: ref,
      amountCents: input.amountCents,
    } as any) as any

    return this.sendToFocus(doc.id, ref, input)
  }

  async retryNfe(
    id: string,
    input: import("./helpers").EmitNfeInput
  ): Promise<InstanceType<typeof NfDocument>> {
    if (input.amountCents <= 0) {
      throw new Error("Valor do pedido deve ser maior que zero")
    }

    const [doc] = await this.listNfDocuments({ id } as any)
    if (!doc) throw new Error("Documento não encontrado")
    if (doc.status !== "error") {
      throw new Error("Apenas documentos com erro podem ser reprocessados")
    }

    await this.updateNfDocuments({
      id,
      status: "processing",
      errorMessage: null,
    } as any)

    const ref = (doc as any).focusNfeRef || `order-${input.orderId}`
    return this.sendToFocus(id, ref, input)
  }
}

export default FiscalModuleService
