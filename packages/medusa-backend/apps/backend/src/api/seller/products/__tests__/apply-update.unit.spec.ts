jest.mock("@medusajs/medusa/core-flows", () => ({
  updateProductsWorkflow: jest.fn(),
}))

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import { mergeMetadata } from "@medusajs/framework/utils"
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
  it("merges extraMetadata into current metadata and marks keys set to null for removal", async () => {
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
    expect(input).toEqual({
      id: "prod_1",
      title: "X",
      metadata: { package_size: "small", approved_at: "t", pending_changes: "" },
    })
  })

  // Medusa's repository merges the update over the stored metadata; this runs that real
  // merge to prove the key actually disappears from the saved product.
  it("removes the key after Medusa's own metadata merge", async () => {
    const run = jest.fn().mockResolvedValue({ result: [{ id: "prod_1" }] })
    ;(updateProductsWorkflow as unknown as jest.Mock).mockReturnValue({ run })
    const stored = { package_size: "small", pending_changes: { title: "Y", submittedAt: "s" } }
    const graph = jest.fn().mockResolvedValue({ data: [{ id: "prod_1", metadata: stored }] })
    const scope = makeScope({ [ContainerRegistrationKeys.QUERY]: { graph }, [Modules.PRODUCT]: {} })

    await applySellerProductUpdate(scope, "prod_1", {}, { pending_changes: null })

    const saved = mergeMetadata(stored, run.mock.calls[0][0].input.products[0].metadata)
    expect(saved).toEqual({ package_size: "small" })
    expect(saved).not.toHaveProperty("pending_changes")
  })

  // Medusa replaces the whole variants collection on update, so a partial list
  // would delete every variant left out of it.
  it("keeps the variants missing from a partial list by listing them with only their id", async () => {
    const run = jest.fn().mockResolvedValue({ result: [{ id: "prod_1" }] })
    ;(updateProductsWorkflow as unknown as jest.Mock).mockReturnValue({ run })
    const graph = jest.fn().mockResolvedValue({ data: [{ id: "prod_1", variants: [{ id: "v1" }, { id: "v2" }] }] })
    const scope = makeScope({ [ContainerRegistrationKeys.QUERY]: { graph }, [Modules.PRODUCT]: {} })
    const prices = [{ amount: 10, currency_code: "brl" }]

    await applySellerProductUpdate(scope, "prod_1", { variants: [{ id: "v1", prices }] })

    expect(graph).toHaveBeenCalledWith(expect.objectContaining({ entity: "product", filters: { id: "prod_1" } }))
    expect(run.mock.calls[0][0].input.products[0].variants).toEqual([{ id: "v1", prices }, { id: "v2" }])
  })

  it("does not read or send variants when the edit has none", async () => {
    const run = jest.fn().mockResolvedValue({ result: [{ id: "prod_1" }] })
    ;(updateProductsWorkflow as unknown as jest.Mock).mockReturnValue({ run })
    const graph = jest.fn()
    const scope = makeScope({ [ContainerRegistrationKeys.QUERY]: { graph }, [Modules.PRODUCT]: {} })

    await applySellerProductUpdate(scope, "prod_1", { title: "X" })

    expect(graph).not.toHaveBeenCalled()
    expect(run.mock.calls[0][0].input.products[0]).not.toHaveProperty("variants")
  })
})
