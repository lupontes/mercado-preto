// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import type { ReactNode } from "react"
import { sdk } from "../../lib/sdk"
import { useAdminSellers, useApproveSeller, useRejectSeller } from "../sellers"

vi.mock("../../lib/sdk", () => ({
  sdk: { client: { fetch: vi.fn() } },
}))

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe("useAdminSellers", () => {
  beforeEach(() => {
    vi.mocked(sdk.client.fetch).mockReset()
  })

  it("fetches /admin/sellers with the status filter", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({ sellers: [], count: 0 })

    const { result } = renderHook(() => useAdminSellers({ status: "pending" }), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/sellers", {
      query: { status: "pending" },
    })
  })
})

describe("useApproveSeller", () => {
  beforeEach(() => {
    vi.mocked(sdk.client.fetch).mockReset()
  })

  it("POSTs to /admin/sellers/:id/approve", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({ seller: { id: "seller_1", status: "approved" } })

    const { result } = renderHook(() => useApproveSeller(), { wrapper })
    result.current.mutate("seller_1")

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/sellers/seller_1/approve", {
      method: "POST",
    })
  })
})

describe("useRejectSeller", () => {
  beforeEach(() => {
    vi.mocked(sdk.client.fetch).mockReset()
  })

  it("POSTs to /admin/sellers/:id/reject with the reason", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({ seller: { id: "seller_1", status: "pending" } })

    const { result } = renderHook(() => useRejectSeller(), { wrapper })
    result.current.mutate({ id: "seller_1", reason: "CNPJ inválido" })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/sellers/seller_1/reject", {
      method: "POST",
      body: { reason: "CNPJ inválido" },
    })
  })
})
