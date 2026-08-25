import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Initial category -> NCM mapping proposed in
 * docs/superpowers/specs/2026-08-25-fiscal-ncm-classification-design.md.
 * Raw 8-digit codes (no dots), matching what buildNfePayload sends to
 * Focus NFe. Categories not listed here are intentionally left unset —
 * see the spec's "sem proposta" rows — and fall back to the generic
 * placeholder with ncmFallbackUsed: true until a human sets a real value.
 *
 * Re-run this script any time the mapping changes:
 *   npx medusa exec ./src/scripts/set-category-ncm.ts
 */
const CATEGORY_NCM: Record<string, string> = {
  "BOLSAS": "42029200",
  "SACOLÕES": "42029200",
  "COLARES": "71179000",
  "BRINCOS": "71179000",
  "BRINCO AFRICANO": "71179000",
  "PULSEIRAS": "71179000",
  "PINGENTE": "71179000",
  "CANECAS, COPOS E GARRAFAS": "69120000",
  "CHAPÉUS": "65040000",
  "LUMINÁRIAS": "94055000",
  "KIT LUMINÁRIA": "94055000",
  "KITS PARA COZINHA": "69120000",
  "PETISQUEIRAS": "69120000",
}

export default async function setCategoryNcm({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const productModuleService = container.resolve(Modules.PRODUCT)

  for (const [name, ncm] of Object.entries(CATEGORY_NCM)) {
    const categories = await productModuleService.listProductCategories({ name })

    if (categories.length === 0) {
      logger.warn(`[set-category-ncm] categoria "${name}" não encontrada — pulando`)
      continue
    }

    for (const category of categories) {
      await productModuleService.updateProductCategories(category.id, {
        metadata: { ...(category.metadata ?? {}), ncm },
      })
      logger.info(`[set-category-ncm] "${name}" (${category.id}) -> NCM ${ncm}`)
    }
  }

  logger.info("[set-category-ncm] concluído")
}
