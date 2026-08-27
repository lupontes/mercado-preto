import { useQuery } from "@tanstack/react-query"
import { sdk } from "../lib/sdk"

export type Commission = {
  id: string
  orderId: string
  sellerId: string
  sellerName: string
  grossAmount: number
  bankingFees: number
  netAmount: number
  commissionRate: number
  commissionAmount: number
  sellerPayout: number
  status: "pending" | "paid"
  paidAt: string | null
  created_at: string
}

type CommissionsResponse = {
  commissions: Commission[]
  totals: { grossAmount: number; commissionAmount: number; sellerPayout: number }
  count: number
  limit: number
  offset: number
}

export function useAdminCommissions(
  filters: { seller_id?: string; status?: string; limit?: number; offset?: number } = {}
) {
  return useQuery({
    queryKey: ["admin-commissions", filters],
    queryFn: () =>
      sdk.client.fetch<CommissionsResponse>("/admin/commissions", {
        query: filters,
      }),
  })
}
