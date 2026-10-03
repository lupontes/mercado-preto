import { afterEach, describe, expect, it, vi } from "vitest"
import { medusaBaseUrl } from "../medusa-url"

describe("medusaBaseUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("uses the direct backend URL on the server (SSR has no mixed-content restriction)", () => {
    vi.stubEnv("NEXT_PUBLIC_MEDUSA_URL", "http://10.0.0.1:9000")

    expect(medusaBaseUrl()).toBe("http://10.0.0.1:9000")
  })

  it("falls back to localhost on the server when the env var is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_MEDUSA_URL", undefined as unknown as string)

    expect(medusaBaseUrl()).toBe("http://localhost:9000")
  })

  it("returns an empty base in the browser so requests stay on the page's https origin", () => {
    vi.stubEnv("NEXT_PUBLIC_MEDUSA_URL", "http://10.0.0.1:9000")
    vi.stubGlobal("window", {})

    expect(medusaBaseUrl()).toBe("")
  })
})
