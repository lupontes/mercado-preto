import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../lib/sdk"

export type ModerationKind = "new" | "change"

export type ModerationQueueItem = {
  id: string
  title: string
  thumbnail: string | null
  sellerName: string | null
  kind: ModerationKind
  submittedAt: string
}

export type PendingChanges = {
  title?: string
  description?: string
  thumbnail?: string
  category_id?: string | null
  variants?: { id: string; prices: { amount: number; currency_code: string }[] }[]
  packageSize?: string
  packageDimensions?: { weight: number; length: number; width: number; height: number }
  submittedAt?: string
}

export type ProductModeration = {
  kind: ModerationKind | null
  pendingChanges: PendingChanges | null
  seller: { name: string | null; phone: string | null }
}

export function useModerationQueue() {
  return useQuery({
    queryKey: ["admin-moderation-products"],
    queryFn: () => sdk.client.fetch<{ items: ModerationQueueItem[] }>("/admin/moderation/products"),
  })
}

export function useProductModeration(productId: string) {
  return useQuery({
    queryKey: ["admin-product-moderation", productId],
    queryFn: () => sdk.client.fetch<ProductModeration>(`/admin/products/${productId}/moderation`),
    enabled: !!productId,
  })
}

export function useApproveProductModeration(productId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<{ ok: true }>(`/admin/products/${productId}/moderation`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-moderation-products"] })
      queryClient.invalidateQueries({ queryKey: ["admin-product-moderation", productId] })
      // The product itself (status, fields) changed too.
      queryClient.invalidateQueries({ queryKey: ["products"] })
    },
  })
}
