import {
  exceedsCorreiosLimits,
  resolvePackageDimensions,
  type PackageDimensions,
  type PackageSize,
} from "../../../utils/package-size"

export const LIMIT_ERROR = "Medidas acima do limite dos Correios (máx. 100 cm por lado, 200 cm somando os lados, 30 kg)"

/** Resolves the dimensions for a size, or returns the 400 message to show. */
export function resolveSellerPackage(
  size: PackageSize,
  custom?: PackageDimensions
): { ok: true; dims: PackageDimensions; metadata: Record<string, string> } | { ok: false; error: string } {
  let dims: PackageDimensions
  try {
    dims = resolvePackageDimensions(size, custom)
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
  if (exceedsCorreiosLimits(dims)) return { ok: false, error: LIMIT_ERROR }
  return { ok: true, dims, metadata: { package_size: size } }
}
