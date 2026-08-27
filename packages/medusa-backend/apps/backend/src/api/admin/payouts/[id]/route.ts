import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PAYOUT_MODULE } from "../../../../modules/payout"
import { SELLER_MODULE } from "../../../../modules/seller"
import { COMMISSION_MODULE } from "../../../../modules/commission"
import PayoutModuleService from "../../../../modules/payout/service"
import SellerModuleService from "../../../../modules/seller/service"
import CommissionModuleService from "../../../../modules/commission/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const payoutService: PayoutModuleService = req.scope.resolve(PAYOUT_MODULE)
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)
  const commissionService: CommissionModuleService = req.scope.resolve(COMMISSION_MODULE)
  const { id } = req.params

  const [payout] = await payoutService.listPayouts({ id })
  if (!payout) return res.status(404).json({ error: "Repasse não encontrado" })

  const [seller] = await sellerService.listSellers({ id: (payout as any).sellerId })
  const commissions = await commissionService.listCommissions({ payoutId: id })

  res.json({
    payout: { ...payout, sellerName: seller?.name ?? "Vendedor removido" },
    seller: seller
      ? {
          id: seller.id,
          name: seller.name,
          bankName: seller.bankName,
          bankAgency: seller.bankAgency,
          bankAccount: seller.bankAccount,
          bankAccountType: seller.bankAccountType,
          pixKey: seller.pixKey,
          pixKeyType: seller.pixKeyType,
        }
      : null,
    commissions,
  })
}
