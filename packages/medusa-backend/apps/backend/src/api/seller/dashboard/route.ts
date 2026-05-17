import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { COMMISSION_MODULE } from "../../../modules/commission"
import CommissionModuleService from "../../../modules/commission/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as any).sellerId

  const commissionService: CommissionModuleService = req.scope.resolve(COMMISSION_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const [allCommissions, pendingCommissions, { data: sellers }] = await Promise.all([
    commissionService.listCommissions({ sellerId }),
    commissionService.listCommissions({ sellerId, status: "pending" }),
    query.graph({
      entity: "seller",
      fields: ["products.id"],
      filters: { id: sellerId },
    }),
  ])

  const totalRevenue = allCommissions.reduce((acc, c) => acc + Number(c.sellerPayout), 0)
  const pendingPayout = pendingCommissions.reduce((acc, c) => acc + Number(c.sellerPayout), 0)
  const productCount = sellers?.[0]?.products?.length ?? 0

  res.json({
    stats: {
      totalOrders: allCommissions.length,
      pendingOrders: pendingCommissions.length,
      productCount,
      totalRevenue,
      pendingPayout,
    },
  })
}
