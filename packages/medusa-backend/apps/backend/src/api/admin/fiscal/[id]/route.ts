import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FISCAL_MODULE } from "../../../../modules/fiscal"
import FiscalModuleService from "../../../../modules/fiscal/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const fiscalService: FiscalModuleService = req.scope.resolve(FISCAL_MODULE)
  const { id } = req.params

  const [doc] = await fiscalService.listNfDocuments({ id })
  if (!doc) return res.status(404).json({ error: "Documento não encontrado" })

  res.json({ document: doc })
}
