// UI mirror of the backend table (packages/medusa-backend/.../utils/package-size.ts),
// which validates and is the source of truth. Keep both in sync.
export type PackageSize = 'small' | 'medium' | 'large' | 'bulky'
export type PackageDimensions = { weight: number; length: number; width: number; height: number }

export const PACKAGE_SIZE_OPTIONS: Array<{ value: PackageSize; label: string; hint: string }> = [
  { value: 'small', label: 'Pequeno', hint: 'Até 0,3 kg, cabe numa caixa de sapato pequena — brincos, colares, pulseiras' },
  { value: 'medium', label: 'Médio', hint: 'Até 1 kg — bolsas, canecas, chapéus, roupas' },
  { value: 'large', label: 'Grande', hint: 'Até 3 kg — luminárias pequenas, kits' },
  { value: 'bulky', label: 'Volumoso', hint: 'Leve mas grande (palha, cipó, crochê) ou pesado: informe as medidas da caixa' },
]

const CATEGORY_SIZE: Record<string, PackageSize> = {
  BRINCOS: 'small', 'BRINCO AFRICANO': 'small', COLARES: 'small', PULSEIRAS: 'small', PINGENTE: 'small',
  BOLSAS: 'medium', 'CANECAS, COPOS E GARRAFAS': 'medium', CHAPEUS: 'medium', 'MODA AFRICANA': 'medium',
  'ROUPAS AFRO': 'medium', 'ROUPAS TRADICIONAIS': 'medium', PETISQUEIRAS: 'medium',
  'KITS PARA COZINHA': 'bulky', 'KITS PARA BANHEIROS': 'bulky', DECORACAO: 'bulky', LUMINARIAS: 'bulky',
  'KIT LUMINARIA': 'bulky', SACOLOES: 'bulky',
}

export function suggestPackageSize(categoryName?: string | null): PackageSize {
  if (!categoryName) return 'medium'
  const key = categoryName.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase()
  return CATEGORY_SIZE[key] ?? 'medium'
}

export function exceedsCorreiosLimits(d: PackageDimensions): boolean {
  const sides = [d.length, d.width, d.height]
  return Math.max(...sides) > 100 || sides.reduce((s, x) => s + x, 0) > 200 || d.weight > 30
}
