import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../lib/sdk"

export type Seller = {
  id: string
  name: string
  ownerName: string
  email: string
  phone: string
  cpfCnpj: string
  bio: string | null
  location: string | null
  category: string | null
  status: "pending" | "approved" | "active" | "suspended"
  rejectionReason: string | null
  addressPostalCode: string | null
  addressStreet: string | null
  addressNumber: string | null
  addressComplement: string | null
  addressDistrict: string | null
  addressCity: string | null
  addressState: string | null
}

export type SellerAddressInput = {
  addressPostalCode: string
  addressStreet: string
  addressNumber: string
  addressComplement?: string
  addressDistrict: string
  addressCity: string
  addressState: string
}

type SellersResponse = { sellers: Seller[]; count: number }
type SellerResponse = { seller: Seller }

export function useAdminSellers(filters: { status?: string } = {}) {
  return useQuery({
    queryKey: ["admin-sellers", filters],
    queryFn: () =>
      sdk.client.fetch<SellersResponse>("/admin/sellers", {
        query: filters,
      }),
  })
}

export function useAdminSeller(id: string) {
  return useQuery({
    queryKey: ["admin-seller", id],
    queryFn: () => sdk.client.fetch<SellerResponse>(`/admin/sellers/${id}`),
    enabled: !!id,
  })
}

export function useApproveSeller() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      sdk.client.fetch<SellerResponse>(`/admin/sellers/${id}/approve`, {
        method: "POST",
      }),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["admin-sellers"] })
      queryClient.invalidateQueries({ queryKey: ["admin-seller", id] })
    },
  })
}

export function useRejectSeller() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      sdk.client.fetch<SellerResponse>(`/admin/sellers/${id}/reject`, {
        method: "POST",
        body: { reason },
      }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["admin-sellers"] })
      queryClient.invalidateQueries({ queryKey: ["admin-seller", id] })
    },
  })
}

export function useSuspendSeller() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      sdk.client.fetch<SellerResponse>(`/admin/sellers/${id}/suspend`, {
        method: "POST",
        body: { reason },
      }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["admin-sellers"] })
      queryClient.invalidateQueries({ queryKey: ["admin-seller", id] })
    },
  })
}

export function useActivateSeller() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      sdk.client.fetch<SellerResponse>(`/admin/sellers/${id}/activate`, {
        method: "POST",
      }),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["admin-sellers"] })
      queryClient.invalidateQueries({ queryKey: ["admin-seller", id] })
    },
  })
}

export function useUpdateSeller() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<SellerAddressInput> }) =>
      sdk.client.fetch<SellerResponse>(`/admin/sellers/${id}`, { method: "PUT", body: data }),
    onSuccess: (_d, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["admin-sellers"] })
      queryClient.invalidateQueries({ queryKey: ["admin-seller", id] })
    },
  })
}
