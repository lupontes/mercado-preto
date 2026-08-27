// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import type { ReactNode } from "react"
import { sdk } from "../../lib/sdk"
import { useAdminCommissions } from "../commissions"

vi.mock("../../lib/sdk", () => ({
  sdk: { client: { fetch: vi.fn() } },
}))

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe("useAdminCommissions", () => {
  beforeEach(() => {
    vi.mocked(sdk.client.fetch).mockReset()
  })

  it("fetches /admin/commissions with the given filters", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({
      commissions: [],
      totals: { grossAmount: 0, commissionAmount: 0, sellerPayout: 0 },
      count: 0,
      limit: 20,
      offset: 0,
    })

    const { result } = renderHook(
      () => useAdminCommissions({ status: "pending", limit: 20, offset: 0 }),
      { wrapper }
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/commissions", {
      query: { status: "pending", limit: 20, offset: 0 },
    })
  })
})
