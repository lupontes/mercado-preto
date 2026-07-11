import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { FISCAL_MODULE } from "../../../../../modules/fiscal"
import FiscalModuleService from "../../../../../modules/fiscal/service"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const fiscalService: FiscalModuleService = req.scope.resolve(FISCAL_MODULE)
  const orderService = req.scope.resolve(Modules.ORDER)
  const { id } = req.params

  try {
    const [doc] = await fiscalService.listNfDocuments({ id } as any)
    if (!doc) return res.status(404).json({ error: "Documento não encontrado" })

    const order = await orderService.retrieveOrder((doc as any).orderId, {
      relations: ["items", "shipping_address"],
    })

    const address = (order as any).shipping_address

    const input = {
      orderId: (doc as any).orderId,
      sellerId: (doc as any).sellerId,
      amountCents: (doc as any).amountCents,
      buyerName: address?.first_name
        ? `${address.first_name} ${address.last_name || ""}`.trim()
        : "Consumidor Final",
      buyerDocument: (order.metadata as any)?.buyer_document || "",
      buyerEmail: (order as any).email || "",
      buyerAddress: {
        street: address?.address_1 || "Não informado",
        number: address?.address_2 || "S/N",
        district: (address?.metadata as any)?.district || "Centro",
        city: address?.city || "Cachoeira",
        state: address?.province || "BA",
        zipCode: address?.postal_code || "44300000",
      },
      items: ((order as any).items ?? []).map((item: any) => ({
        description: item.title,
        quantity: item.quantity,
        unitPrice: Number(item.unit_price ?? 0),
      })),
    }

    const updatedDoc = await fiscalService.retryNfe(id, input)
    res.json({ document: updatedDoc })
  } catch (err: any) {
    res.status(400).json({ error: err?.message })
  }
}
