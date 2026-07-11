import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  uploadFilesWorkflow,
} from "@medusajs/medusa/core-flows"
import fs from "fs"
import path from "path"
import { SELLER_MODULE } from "../modules/seller"
import SellerModuleService from "../modules/seller/service"
import { buildCollisionRetryInput, detectDuplicateCollision } from "./nuvemshop-import/collision"

type ExportedCategory = {
  external_id: string
  name: string
  parent_external_id: string | null
}

type ExportedVariant = {
  title: string
  sku?: string
  weight?: number
  width?: number
  height?: number
  length?: number
  manage_inventory: boolean
  options: Record<string, string>
  prices: { amount: number; currency_code: string }[]
}

type ExportedProduct = {
  title: string
  handle: string
  description: string | null
  status: string
  thumbnail: string | null
  external_id: string
  images: string[]
  category_external_ids: string[]
  options: { title: string; values: string[] }[]
  variants: ExportedVariant[]
}

type ExportedCatalog = {
  seller: {
    email: string
    name: string
    ownerName: string | null
    bio: string | null
    location: string | null
    category: string | null
    status: string
  }
  categories: ExportedCategory[]
  products: ExportedProduct[]
}

function sortCategoriesByDepth(categories: ExportedCategory[]): ExportedCategory[] {
  const byExternalId = new Map(categories.map((c) => [c.external_id, c]))

  const depthOf = (category: ExportedCategory, seen: Set<string>): number => {
    if (!category.parent_external_id || seen.has(category.parent_external_id)) return 0
    const parent = byExternalId.get(category.parent_external_id)
    if (!parent) return 0
    return 1 + depthOf(parent, new Set(seen).add(category.parent_external_id))
  }

  return [...categories].sort((a, b) => depthOf(a, new Set()) - depthOf(b, new Set()))
}

export default async function importMabCatalog({
  container,
}: {
  container: MedusaContainer
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
  const sellerService: SellerModuleService = container.resolve(SELLER_MODULE)

  const jsonPath = process.env.MAB_CATALOG_JSON || path.join(process.cwd(), "mab-catalog-export.json")
  const catalog: ExportedCatalog = JSON.parse(fs.readFileSync(jsonPath, "utf-8"))

  const { data: salesChannels } = await query.graph({
    entity: "sales_channel",
    fields: ["id"],
  })
  const salesChannel = salesChannels[0]
  if (!salesChannel) {
    throw new Error(
      "No sales channel found. Run `npx medusa exec ./src/migration-scripts/initial-data-seed.ts` before this script."
    )
  }

  let seller = (await sellerService.listSellers({ email: catalog.seller.email }))[0]
  if (!seller) {
    seller = await sellerService.createSellers({
      name: catalog.seller.name,
      ownerName: catalog.seller.ownerName || catalog.seller.name,
      email: catalog.seller.email,
      phone: "",
      cpfCnpj: "",
      location: catalog.seller.location,
      category: catalog.seller.category,
      status: catalog.seller.status as any,
    })
    logger.info(`Seller created: ${seller.id}`)
  } else {
    logger.info(`Seller already existed: ${seller.id}`)
  }

  const orderedCategories = sortCategoriesByDepth(catalog.categories)
  const categoryIdMap = new Map<string, string>()
  let categoriesFailed = 0
  for (const category of orderedCategories) {
    try {
      const { data: existing } = await query.graph({
        entity: "product_category",
        fields: ["id"],
        filters: { external_id: category.external_id } as any,
      })

      if (existing[0]) {
        categoryIdMap.set(category.external_id, existing[0].id)
        continue
      }

      let parentId: string | undefined
      if (category.parent_external_id) {
        parentId = categoryIdMap.get(category.parent_external_id)
        if (!parentId) {
          logger.warn(
            `Category "${category.name}" references parent "${category.parent_external_id}", which was not found — creating it as a root category instead.`
          )
        }
      }

      const {
        result: [created],
      } = await createProductCategoriesWorkflow(container).run({
        input: {
          product_categories: [
            {
              name: category.name,
              external_id: category.external_id,
              is_active: true,
              ...(parentId ? { parent_category_id: parentId } : {}),
            },
          ],
        },
      })
      categoryIdMap.set(category.external_id, created.id)
    } catch (err: any) {
      categoriesFailed++
      logger.error(`Failed to create category "${category.name}": ${err?.message}`)
    }
  }
  logger.info(`${categoryIdMap.size} categories synced, ${categoriesFailed} failed.`)

  let imported = 0
  let skipped = 0
  let failed = 0
  let orphaned = 0

  for (const product of catalog.products) {
    const { data: existingProducts } = await query.graph({
      entity: "product",
      fields: ["id"],
      filters: { external_id: product.external_id },
    })
    if (existingProducts.length > 0) {
      skipped++
      continue
    }

    try {
      const imageUrls: string[] = []
      for (const imageUrl of product.images) {
        const response = await fetch(imageUrl)
        if (!response.ok) {
          throw new Error(`Failed to download image ${imageUrl}: HTTP ${response.status}`)
        }
        const buffer = Buffer.from(await response.arrayBuffer())
        const filename = imageUrl.split("/").pop() || `${product.external_id}.jpg`
        const mimeType = response.headers.get("content-type") || "image/webp"
        const {
          result: [uploaded],
        } = await uploadFilesWorkflow(container).run({
          input: {
            files: [
              {
                filename,
                mimeType,
                content: buffer.toString("base64"),
                access: "public",
              },
            ],
          },
        })
        imageUrls.push(uploaded.url)
      }

      const categoryIds = product.category_external_ids
        .map((extId) => categoryIdMap.get(extId))
        .filter((id): id is string => !!id)

      const workflowInput = {
        title: product.title,
        handle: product.handle,
        description: product.description ?? undefined,
        status: product.status as any,
        thumbnail: imageUrls[0],
        images: imageUrls.map((url) => ({ url })),
        external_id: product.external_id,
        category_ids: categoryIds,
        options: product.options,
        variants: product.variants.map((v) => ({
          title: v.title,
          sku: v.sku,
          weight: v.weight,
          width: v.width,
          height: v.height,
          length: v.length,
          manage_inventory: v.manage_inventory,
          options: v.options,
          prices: v.prices,
        })),
        sales_channels: [{ id: salesChannel.id }],
      }

      const runCreateProduct = async (input: typeof workflowInput) => {
        const {
          result: [created],
        } = await createProductsWorkflow(container).run({
          input: { products: [input as any] },
        })
        return created
      }

      let createdProduct: Awaited<ReturnType<typeof runCreateProduct>>
      try {
        createdProduct = await runCreateProduct(workflowInput)
      } catch (createErr: any) {
        const collision = detectDuplicateCollision(createErr?.message)
        if (!collision) {
          throw createErr
        }
        const suffixedInput = buildCollisionRetryInput(workflowInput as any, collision, product.external_id)
        createdProduct = await runCreateProduct(suffixedInput as any)
        logger.warn(
          collision === "handle"
            ? `Product ${product.external_id} imported with handle adjusted (final handle: ${(suffixedInput as any).handle})`
            : `Product ${product.external_id} imported with variant SKUs adjusted`
        )
      }

      imported++
      logger.info(`Product imported (${imported}/${catalog.products.length}): ${createdProduct.title}`)

      try {
        await remoteLink.create([
          {
            [SELLER_MODULE]: { seller_id: seller.id },
            [Modules.PRODUCT]: { product_id: createdProduct.id },
          },
        ])
      } catch (linkErr: any) {
        orphaned++
        logger.error(
          `PRODUCT CREATED WITHOUT SELLER LINK — requires manual fix. product_id=${createdProduct.id} external_id=${product.external_id}: ${linkErr?.message}`
        )
      }
    } catch (err: any) {
      failed++
      logger.error(`Failed to import product ${product.external_id}: ${err?.message}`)
    }
  }

  logger.info(
    `Import complete. Imported: ${imported}, already existing (skipped): ${skipped}, failed: ${failed}, orphaned without seller (requires manual fix): ${orphaned}`
  )
}
