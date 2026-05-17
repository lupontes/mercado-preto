import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FISCAL_MODULE } from "../../../../../modules/fiscal"
import FiscalModuleService from "../../../../../modules/fiscal/service"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const fiscalService: FiscalModuleService = req.scope.resolve(FISCAL_MODULE)
  const { id } = req.params

  try {
    const doc = await fiscalService.retryNfe(id)
    res.json({ document: doc })
  } catch (err: any) {
    res.status(400).json({ error: err?.message })
  }
}
