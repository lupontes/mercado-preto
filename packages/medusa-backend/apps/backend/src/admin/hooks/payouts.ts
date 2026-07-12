import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../lib/sdk"

export type Payout = {
  id: string
  sellerId: string
  sellerName: string
  amount: number
  periodStart: string
  periodEnd: string
  status: "pending" | "processing" | "completed" | "failed" | "cancelled"
  processedAt: string | null
  notes: string | null
  created_at: string
}

export type PayoutPreview = {
  periodStart: string
  periodEnd: string
  amount: number
  commissionCount: number
}

export type PayoutCommission = {
  id: string
  orderId: string
  grossAmount: number
  commissionAmount: number
  sellerPayout: number
  status: "pending" | "paid"
  created_at: string
}

export type PayoutSeller = {
  id: string
  name: string
  bankName: string | null
  bankAgency: string | null
  bankAccount: string | null
  bankAccountType: "checking" | "savings" | null
  pixKey: string | null
  pixKeyType: "cpf" | "cnpj" | "email" | "phone" | "random" | null
}

type PayoutsResponse = {
  payouts: Payout[]
  total: number
  count: number
  limit: number
  offset: number
}

type PayoutDetailResponse = {
  payout: Payout
  seller: PayoutSeller | null
  commissions: PayoutCommission[]
}

export function useAdminPayouts(
  filters: { seller_id?: string; status?: string; limit?: number; offset?: number } = {}
) {
  return useQuery({
    queryKey: ["admin-payouts", filters],
    queryFn: () => sdk.client.fetch<PayoutsResponse>("/admin/payouts", { query: filters }),
  })
}

export function useAdminPayout(id: string) {
  return useQuery({
    queryKey: ["admin-payout", id],
    queryFn: () => sdk.client.fetch<PayoutDetailResponse>(`/admin/payouts/${id}`),
    enabled: !!id,
  })
}

export function useAdminPayoutPreview(
  sellerId: string,
  periodStart?: string,
  periodEnd?: string
) {
  const query: Record<string, string> = { seller_id: sellerId }
  if (periodStart) query.period_start = periodStart
  if (periodEnd) query.period_end = periodEnd

  return useQuery({
    queryKey: ["admin-payout-preview", sellerId, periodStart, periodEnd],
    queryFn: () => sdk.client.fetch<PayoutPreview>("/admin/payouts/preview", { query }),
    enabled: !!sellerId,
  })
}

export function useCreatePayout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { sellerId: string; periodStart: string; periodEnd: string; notes?: string }) =>
      sdk.client.fetch("/admin/payouts", { method: "POST", body: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-payouts"] })
    },
  })
}

export function useProcessPayout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => sdk.client.fetch(`/admin/payouts/${id}/process`, { method: "POST" }),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["admin-payouts"] })
      queryClient.invalidateQueries({ queryKey: ["admin-payout", id] })
    },
  })
}

export function useCancelPayout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => sdk.client.fetch(`/admin/payouts/${id}/cancel`, { method: "POST" }),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["admin-payouts"] })
      queryClient.invalidateQueries({ queryKey: ["admin-payout", id] })
    },
  })
}
