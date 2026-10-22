jest.mock("@medusajs/medusa/core-flows", () => ({
  updateProductsWorkflow: jest.fn(),
}))

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import { applySellerProductUpdate } from "../apply-update"

function makeScope(overrides: Record<string, unknown>) {
  return {
    resolve: (key: string) => {
      if (key in overrides) return overrides[key]
      throw new Error(`Unexpected resolve: ${String(key)}`)
    },
  } as any
}

describe("applySellerProductUpdate", () => {
  it("merges extraMetadata into current metadata and drops keys set to null", async () => {
    const run = jest.fn().mockResolvedValue({ result: [{ id: "prod_1" }] })
    ;(updateProductsWorkflow as unknown as jest.Mock).mockReturnValue({ run })
    const graph = jest.fn().mockResolvedValue({
      data: [{ id: "prod_1", metadata: { package_size: "small", pending_changes: { title: "Y" } } }],
    })
    const scope = makeScope({
      [ContainerRegistrationKeys.QUERY]: { graph },
      [Modules.PRODUCT]: {},
    })

    const result = await applySellerProductUpdate(
      scope, "prod_1", { title: "X" }, { pending_changes: null, approved_at: "t" },
    )

    expect(result.ok).toBe(true)
    const input = run.mock.calls[0][0].input.products[0]
    expect(input).toEqual({ id: "prod_1", title: "X", metadata: { package_size: "small", approved_at: "t" } })
    expect(input.metadata).not.toHaveProperty("pending_changes")
  })
})
