import { ProductStatus } from "@medusajs/framework/utils"
import { CreateProductWorkflowInputDTO } from "@medusajs/framework/types"
import { sanitizeDescription } from "./sanitize"
import { NuvemshopCategory, NuvemshopProduct } from "./client"

export function buildProductExternalId(nuvemshopProductId: number): string {
  return `nuvemshop:product:${nuvemshopProductId}`
}

export function buildCategoryExternalId(nuvemshopCategoryId: number): string {
  return `nuvemshop:category:${nuvemshopCategoryId}`
}

export function sortCategoriesByDepth(
  categories: NuvemshopCategory[]
): NuvemshopCategory[] {
  const byId = new Map(categories.map((c) => [c.id, c]))

  const depthOf = (category: NuvemshopCategory, seen: Set<number>): number => {
    const parentId = category.parent && category.parent !== 0 ? category.parent : null
    if (!parentId || seen.has(parentId)) return 0
    const parent = byId.get(parentId)
    if (!parent) return 0
    return 1 + depthOf(parent, new Set(seen).add(parentId))
  }

  return [...categories].sort((a, b) => depthOf(a, new Set()) - depthOf(b, new Set()))
}

export interface MapProductOptions {
  categoryIds: string[]
  imageUrls: string[]
  salesChannelId: string
}

export function mapProductToWorkflowInput(
  product: NuvemshopProduct,
  opts: MapProductOptions
): CreateProductWorkflowInputDTO {
  const hasOptions = product.attributes.length > 0

  const options = hasOptions
    ? product.attributes.map((attr, idx) => ({
        title: attr.pt || `Opção ${idx + 1}`,
        values: [
          ...new Set(
            product.variants
              .map((v) => v.values[idx]?.pt)
              .filter((v): v is string => !!v)
          ),
        ],
      }))
    : [{ title: "Padrão", values: ["Padrão"] }]

  const variantTitle = (variant: NuvemshopProduct["variants"][number]) => {
    if (!hasOptions) return "Padrão"
    const parts = product.attributes
      .map((_, idx) => variant.values[idx]?.pt)
      .filter((v): v is string => !!v)
    return parts.length > 0 ? parts.join(" / ") : "Padrão"
  }

  const variants = product.variants.map((variant) => ({
    title: variantTitle(variant),
    sku: variant.sku || undefined,
    manage_inventory: !!variant.stock_management,
    weight: variant.weight ? parseFloat(variant.weight) : undefined,
    width: variant.width ? parseFloat(variant.width) : undefined,
    height: variant.height ? parseFloat(variant.height) : undefined,
    length: variant.depth ? parseFloat(variant.depth) : undefined,
    options: hasOptions
      ? Object.fromEntries(
          product.attributes.map((attr, idx) => [
            attr.pt || `Opção ${idx + 1}`,
            variant.values[idx]?.pt || "N/A",
          ])
        )
      : { Padrão: "Padrão" },
    prices: [
      {
        amount: parseFloat(variant.price || "0"),
        currency_code: "brl",
      },
    ],
  }))

  return {
    title: product.name.pt || `Produto ${product.id}`,
    ...(product.handle?.pt ? { handle: product.handle.pt } : {}),
    description: sanitizeDescription(product.description?.pt),
    status: ProductStatus.PUBLISHED,
    external_id: buildProductExternalId(product.id),
    category_ids: opts.categoryIds,
    images: opts.imageUrls.map((url) => ({ url })),
    thumbnail: opts.imageUrls[0],
    options,
    variants,
    sales_channels: [{ id: opts.salesChannelId }],
  }
}
