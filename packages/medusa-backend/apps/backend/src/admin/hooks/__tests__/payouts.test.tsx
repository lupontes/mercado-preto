// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import type { ReactNode } from "react"
import { sdk } from "../../lib/sdk"
import { useAdminPayouts, useAdminPayoutPreview, useCreatePayout } from "../payouts"

vi.mock("../../lib/sdk", () => ({
  sdk: { client: { fetch: vi.fn() } },
}))

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe("useAdminPayouts", () => {
  beforeEach(() => {
    vi.mocked(sdk.client.fetch).mockReset()
  })

  it("fetches /admin/payouts with the given filters", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({
      payouts: [], total: 0, count: 0, limit: 20, offset: 0,
    })

    const { result } = renderHook(
      () => useAdminPayouts({ status: "pending", limit: 20, offset: 0 }),
      { wrapper }
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/payouts", {
      query: { status: "pending", limit: 20, offset: 0 },
    })
  })
})

describe("useAdminPayoutPreview", () => {
  beforeEach(() => {
    vi.mocked(sdk.client.fetch).mockReset()
  })

  it("fetches with only seller_id when no period is given", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({
      periodStart: "2026-07-01T00:00:00.000Z",
      periodEnd: "2026-07-06T00:00:00.000Z",
      amount: 0,
      commissionCount: 0,
    })

    const { result } = renderHook(() => useAdminPayoutPreview("seller_1"), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/payouts/preview", {
      query: { seller_id: "seller_1" },
    })
  })

  it("includes the explicit period in the query when given", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({
      periodStart: "2026-07-01T00:00:00.000Z",
      periodEnd: "2026-07-06T00:00:00.000Z",
      amount: 500,
      commissionCount: 1,
    })

    const { result } = renderHook(
      () => useAdminPayoutPreview("seller_1", "2026-07-01T00:00:00.000Z", "2026-07-06T00:00:00.000Z"),
      { wrapper }
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/payouts/preview", {
      query: {
        seller_id: "seller_1",
        period_start: "2026-07-01T00:00:00.000Z",
        period_end: "2026-07-06T00:00:00.000Z",
      },
    })
  })

  it("does not fetch when sellerId is empty", () => {
    const { result } = renderHook(() => useAdminPayoutPreview(""), { wrapper })

    expect(result.current.fetchStatus).toBe("idle")
    expect(sdk.client.fetch).not.toHaveBeenCalled()
  })
})

describe("useCreatePayout", () => {
  beforeEach(() => {
    vi.mocked(sdk.client.fetch).mockReset()
  })

  it("calls POST /admin/payouts with the given data", async () => {
    vi.mocked(sdk.client.fetch).mockResolvedValue({ payout: { id: "payout_1" } })

    const { result } = renderHook(() => useCreatePayout(), { wrapper })
    result.current.mutate({
      sellerId: "seller_1",
      periodStart: "2026-07-01T00:00:00.000Z",
      periodEnd: "2026-07-06T00:00:00.000Z",
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(sdk.client.fetch).toHaveBeenCalledWith("/admin/payouts", {
      method: "POST",
      body: {
        sellerId: "seller_1",
        periodStart: "2026-07-01T00:00:00.000Z",
        periodEnd: "2026-07-06T00:00:00.000Z",
      },
    })
  })
})
