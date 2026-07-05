import { categoryExists } from "../category-validation"

describe("categoryExists", () => {
  it("returns true when the category is found", async () => {
    const productService = {
      listProductCategories: jest.fn().mockResolvedValue([{ id: "pcat_1" }]),
    }

    const result = await categoryExists(productService, "pcat_1")

    expect(result).toBe(true)
    expect(productService.listProductCategories).toHaveBeenCalledWith({ id: ["pcat_1"] })
  })

  it("returns false when the category is not found", async () => {
    const productService = {
      listProductCategories: jest.fn().mockResolvedValue([]),
    }

    const result = await categoryExists(productService, "pcat_missing")

    expect(result).toBe(false)
  })
})
