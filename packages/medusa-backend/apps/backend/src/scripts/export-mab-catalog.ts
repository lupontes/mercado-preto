import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import fs from "fs"
import path from "path"

const SELLER_NAME = "Mulheres de Axé do Brasil"

export default async function exportMabCatalog({
  container,
}: {
  container: MedusaContainer
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: sellers } = await query.graph({
    entity: "seller",
    fields: [
      "id",
      "email",
      "name",
      "ownerName",
      "bio",
      "location",
      "category",
      "status",
      "products.id",
      "products.title",
      "products.handle",
      "products.description",
      "products.status",
      "products.thumbnail",
      "products.external_id",
      "products.images.url",
      "products.categories.id",
      "products.categories.name",
      "products.categories.external_id",
      "products.categories.parent_category_id",
      "products.options.title",
      "products.options.values.value",
      "products.variants.title",
      "products.variants.sku",
      "products.variants.weight",
      "products.variants.width",
      "products.variants.height",
      "products.variants.length",
      "products.variants.manage_inventory",
      "products.variants.options.value",
      "products.variants.options.option.title",
      "products.variants.prices.amount",
      "products.variants.prices.currency_code",
    ],
    filters: { name: SELLER_NAME },
  })

  const seller = sellers?.[0]
  if (!seller) {
    throw new Error(`Seller "${SELLER_NAME}" not found`)
  }

  const products = (seller.products ?? []).filter((p: any) => !!p.external_id)

  const categoriesById = new Map<string, any>()
  for (const p of products as any[]) {
    for (const c of (p.categories ?? []) as any[]) {
      categoriesById.set(c.id, c)
    }
  }
  const categories = [...categoriesById.values()].map((c: any) => ({
    external_id: c.external_id,
    name: c.name,
    parent_external_id: c.parent_category_id
      ? categoriesById.get(c.parent_category_id)?.external_id ?? null
      : null,
  }))

  const exported = {
    seller: {
      email: seller.email,
      name: seller.name,
      ownerName: seller.ownerName,
      bio: seller.bio,
      location: seller.location,
      category: seller.category,
      status: seller.status,
    },
    categories,
    products: products.map((p: any) => ({
      title: p.title,
      handle: p.handle,
      description: p.description,
      status: p.status,
      thumbnail: p.thumbnail,
      external_id: p.external_id,
      images: (p.images ?? []).map((i: any) => i.url),
      category_external_ids: (p.categories ?? []).map((c: any) => c.external_id),
      options: (p.options ?? []).map((o: any) => ({
        title: o.title,
        values: (o.values ?? []).map((v: any) => v.value),
      })),
      variants: (p.variants ?? []).map((v: any) => ({
        title: v.title,
        sku: v.sku,
        weight: v.weight,
        width: v.width,
        height: v.height,
        length: v.length,
        manage_inventory: v.manage_inventory,
        options: Object.fromEntries(
          (v.options ?? []).map((o: any) => [o.option?.title, o.value])
        ),
        prices: (v.prices ?? []).map((pr: any) => ({
          amount: pr.amount,
          currency_code: pr.currency_code,
        })),
      })),
    })),
  }

  const outPath = path.join(process.cwd(), "mab-catalog-export.json")
  fs.writeFileSync(outPath, JSON.stringify(exported, null, 2), "utf-8")

  logger.info(
    `Exported seller "${seller.name}" with ${categories.length} categories and ${products.length} products to ${outPath}`
  )
}
