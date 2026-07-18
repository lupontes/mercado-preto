import { isSandboxMode } from "../sandbox"

describe("isSandboxMode", () => {
  const original = process.env.MARKETPLACE_SANDBOX

  afterEach(() => {
    if (original === undefined) delete process.env.MARKETPLACE_SANDBOX
    else process.env.MARKETPLACE_SANDBOX = original
  })

  it("returns true when MARKETPLACE_SANDBOX is unset (fail-safe default)", () => {
    delete process.env.MARKETPLACE_SANDBOX
    expect(isSandboxMode()).toBe(true)
  })

  it("returns true when MARKETPLACE_SANDBOX=true", () => {
    process.env.MARKETPLACE_SANDBOX = "true"
    expect(isSandboxMode()).toBe(true)
  })

  it("returns false when MARKETPLACE_SANDBOX=false", () => {
    process.env.MARKETPLACE_SANDBOX = "false"
    expect(isSandboxMode()).toBe(false)
  })

  it("returns true (fail-safe) for an unexpected value", () => {
    process.env.MARKETPLACE_SANDBOX = "nope"
    expect(isSandboxMode()).toBe(true)
  })
})
