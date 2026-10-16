import {
  PACKAGE_SIZES,
  exceedsCorreiosLimits,
  resolvePackageDimensions,
  suggestPackageSize,
  variantDimensionsOrDefault,
} from "../package-size"

describe("package size", () => {
  it("uses the approved default dimensions per size", () => {
    expect(PACKAGE_SIZES.small).toEqual({ weight: 0.3, length: 16, width: 11, height: 6 })
    expect(PACKAGE_SIZES.medium).toEqual({ weight: 1, length: 25, width: 20, height: 10 })
    expect(PACKAGE_SIZES.large).toEqual({ weight: 3, length: 40, width: 30, height: 20 })
  })

  it("suggests a size from the category name, case and accent insensitive, defaulting to medium", () => {
    expect(suggestPackageSize("BRINCOS")).toBe("small")
    expect(suggestPackageSize("Colares")).toBe("small")
    expect(suggestPackageSize("BOLSAS")).toBe("medium")
    expect(suggestPackageSize("KITS PARA BANHEIROS")).toBe("bulky")
    expect(suggestPackageSize("Decoração")).toBe("bulky")
    expect(suggestPackageSize("LUMINÁRIAS")).toBe("bulky")
    expect(suggestPackageSize("SACOLÕES")).toBe("bulky")
    expect(suggestPackageSize("Categoria nova")).toBe("medium")
    expect(suggestPackageSize(undefined)).toBe("medium")
  })

  it("flags dimensions above the Correios limits", () => {
    expect(exceedsCorreiosLimits({ weight: 1, length: 100, width: 50, height: 50 })).toBe(false)
    expect(exceedsCorreiosLimits({ weight: 1, length: 101, width: 10, height: 10 })).toBe(true)
    expect(exceedsCorreiosLimits({ weight: 1, length: 90, width: 60, height: 51 })).toBe(true) // sum 201
    expect(exceedsCorreiosLimits({ weight: 30.1, length: 10, width: 10, height: 10 })).toBe(true)
  })

  it("resolves preset sizes and requires positive custom dimensions for bulky", () => {
    expect(resolvePackageDimensions("small")).toEqual(PACKAGE_SIZES.small)
    const custom = { weight: 1.2, length: 65, width: 40, height: 50 }
    expect(resolvePackageDimensions("bulky", custom)).toEqual(custom)
    expect(() => resolvePackageDimensions("bulky")).toThrow()
    expect(() => resolvePackageDimensions("bulky", { ...custom, height: 0 })).toThrow()
  })

  it("falls back to medium when a variant has missing or zero dimensions", () => {
    expect(variantDimensionsOrDefault({ weight: 0.2, length: 15, width: 15, height: 15 })).toEqual({
      weight: 0.2, length: 15, width: 15, height: 15,
    })
    expect(variantDimensionsOrDefault({ weight: 0, length: 15, width: 15, height: 15 })).toEqual(PACKAGE_SIZES.medium)
    expect(variantDimensionsOrDefault({ weight: 0.2, length: null, width: 15, height: 15 })).toEqual(PACKAGE_SIZES.medium)
  })
})
