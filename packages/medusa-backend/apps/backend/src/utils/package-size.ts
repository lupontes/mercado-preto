// Kept free of framework imports: the admin bundle imports this file too.

export type PackageSize = "small" | "medium" | "large" | "bulky"

/** Weight in kg, measures in cm — the units Melhor Envio and Medusa variants use. */
export type PackageDimensions = { weight: number; length: number; width: number; height: number }

export const PACKAGE_SIZES: Record<Exclude<PackageSize, "bulky">, PackageDimensions> = {
  small: { weight: 0.3, length: 16, width: 11, height: 6 },
  medium: { weight: 1, length: 25, width: 20, height: 10 },
  large: { weight: 3, length: 40, width: 30, height: 20 },
}

export const PACKAGE_SIZE_LABELS: Record<PackageSize, string> = {
  small: "Pequeno",
  medium: "Médio",
  large: "Grande",
  bulky: "Volumoso",
}

// Keys are normalized category names (no accents, upper case). Light but
// bulky handicrafts (straw, vine, crochet) are priced by box volume, so they
// start as "bulky" and ask for real measures.
const CATEGORY_SIZE: Record<string, PackageSize> = {
  BRINCOS: "small",
  "BRINCO AFRICANO": "small",
  COLARES: "small",
  PULSEIRAS: "small",
  PINGENTE: "small",
  BOLSAS: "medium",
  "CANECAS, COPOS E GARRAFAS": "medium",
  CHAPEUS: "medium",
  "MODA AFRICANA": "medium",
  "ROUPAS AFRO": "medium",
  "ROUPAS TRADICIONAIS": "medium",
  PETISQUEIRAS: "medium",
  "KITS PARA COZINHA": "bulky",
  "KITS PARA BANHEIROS": "bulky",
  DECORACAO: "bulky",
  LUMINARIAS: "bulky",
  "KIT LUMINARIA": "bulky",
  SACOLOES: "bulky",
}

function normalize(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase()
}

export function suggestPackageSize(categoryName?: string | null): PackageSize {
  if (!categoryName) return "medium"
  return CATEGORY_SIZE[normalize(categoryName)] ?? "medium"
}

export const CORREIOS_LIMITS = { maxSide: 100, maxSum: 200, maxWeight: 30 }

export function exceedsCorreiosLimits(d: PackageDimensions): boolean {
  const sides = [d.length, d.width, d.height]
  return (
    Math.max(...sides) > CORREIOS_LIMITS.maxSide ||
    sides.reduce((s, x) => s + x, 0) > CORREIOS_LIMITS.maxSum ||
    d.weight > CORREIOS_LIMITS.maxWeight
  )
}

function isComplete(d: Partial<PackageDimensions> | undefined): d is PackageDimensions {
  return !!d && [d.weight, d.length, d.width, d.height].every((x) => typeof x === "number" && x > 0)
}

export function resolvePackageDimensions(size: PackageSize, custom?: PackageDimensions): PackageDimensions {
  if (size !== "bulky") return PACKAGE_SIZES[size]
  if (!isComplete(custom)) throw new Error("Volumoso exige peso e medidas maiores que zero")
  return custom
}

export function variantDimensionsOrDefault(v: {
  weight?: number | null
  length?: number | null
  width?: number | null
  height?: number | null
}): PackageDimensions {
  const d = { weight: Number(v.weight), length: Number(v.length), width: Number(v.width), height: Number(v.height) }
  return isComplete(d) ? d : PACKAGE_SIZES.medium
}
