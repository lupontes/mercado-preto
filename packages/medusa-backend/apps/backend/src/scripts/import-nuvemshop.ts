import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  uploadFilesWorkflow,
} from "@medusajs/medusa/core-flows"
import { SELLER_MODULE } from "../modules/seller"
import SellerModuleService from "../modules/seller/service"
import { NuvemshopClient } from "./nuvemshop-import/client"
import { buildCollisionRetryInput, detectDuplicateCollision } from "./nuvemshop-import/collision"
import {
  buildCategoryExternalId,
  buildProductExternalId,
  mapProductToWorkflowInput,
  sortCategoriesByDepth,
} from "./nuvemshop-import/mappers"

const SELLER_NAME = "Mulheres de Axé do Brasil"
const SELLER_CATEGORY = "Produtos Afro"

export default async function importNuvemshop({
  container,
}: {
  container: MedusaContainer
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
  const sellerService: SellerModuleService = container.resolve(SELLER_MODULE)

  const accessToken = process.env.NUVEMSHOP_ACCESS_TOKEN
  const storeId = process.env.NUVEMSHOP_STORE_ID
  if (!accessToken || !storeId) {
    throw new Error(
      "NUVEMSHOP_ACCESS_TOKEN and NUVEMSHOP_STORE_ID must be set in the backend .env file."
    )
  }
  const client = new NuvemshopClient({ accessToken, storeId })

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

  logger.info("Fetching store data from Nuvemshop...")
  const store = await client.getStore()

  let seller = (await sellerService.listSellers({ email: store.email }))[0]
  if (!seller) {
    seller = await sellerService.createSellers({
      name: SELLER_NAME,
      ownerName: store.business_name || SELLER_NAME,
      email: store.email,
      phone: store.phone ?? "",
      cpfCnpj: store.business_id ?? "",
      location: store.address ?? null,
      category: SELLER_CATEGORY,
      status: "active",
    })
    logger.info(`Seller created: ${seller.id}`)
  } else {
    logger.info(`Seller already existed: ${seller.id}`)
  }

  logger.info("Fetching categories from Nuvemshop...")
  const nuvemshopCategories = await client.listCategories()
  const orderedCategories = sortCategoriesByDepth(nuvemshopCategories)

  const categoryIdMap = new Map<number, string>()
  let categoriesFailed = 0
  for (const category of orderedCategories) {
    const externalId = buildCategoryExternalId(category.id)
    try {
      const { data: existing } = await query.graph({
        entity: "product_category",
        fields: ["id"],
        filters: { external_id: externalId },
      })

      if (existing[0]) {
        categoryIdMap.set(category.id, existing[0].id)
        continue
      }

      let parentId: string | undefined
      if (category.parent && category.parent !== 0) {
        parentId = categoryIdMap.get(category.parent)
        if (!parentId) {
          logger.warn(
            `Category #${category.id} references parent #${category.parent}, which was not found (missing or cyclic) — creating it as a root category instead.`
          )
        }
      }

      const {
        result: [created],
      } = await createProductCategoriesWorkflow(container).run({
        input: {
          product_categories: [
            {
              name: category.name.pt || `Category ${category.id}`,
              external_id: externalId,
              is_active: true,
              ...(parentId ? { parent_category_id: parentId } : {}),
            },
          ],
        },
      })
      categoryIdMap.set(category.id, created.id)
    } catch (err: any) {
      categoriesFailed++
      logger.error(`Failed to import Nuvemshop category #${category.id}: ${err?.message}`)
    }
  }
  logger.info(`${categoryIdMap.size} categories synced, ${categoriesFailed} failed.`)

  logger.info("Importing products...")
  let imported = 0
  let skipped = 0
  let failed = 0
  let orphaned = 0

  for await (const page of client.iterateProducts()) {
    for (const product of page) {
      const externalId = buildProductExternalId(product.id)
      const { data: existingProducts } = await query.graph({
        entity: "product",
        fields: ["id"],
        filters: { external_id: externalId },
      })
      if (existingProducts.length > 0) {
        skipped++
        continue
      }

      try {
        const sortedImages = [...product.images].sort((a, b) => a.position - b.position)
        const imageUrls: string[] = []
        for (const image of sortedImages) {
          const response = await fetch(image.src)
          if (!response.ok) {
            throw new Error(`Failed to download image ${image.src}: HTTP ${response.status}`)
          }
          const buffer = Buffer.from(await response.arrayBuffer())
          const filename = image.src.split("/").pop() || `${image.id}.jpg`
          const mimeType = response.headers.get("content-type") || "image/jpeg"
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

        const categoryIds = product.categories
          .map((c) => categoryIdMap.get(c.id))
          .filter((id): id is string => !!id)

        const workflowInput = mapProductToWorkflowInput(product, {
          categoryIds,
          imageUrls,
          salesChannelId: salesChannel.id,
        })

        const runCreateProduct = async (input: typeof workflowInput) => {
          const {
            result: [created],
          } = await createProductsWorkflow(container).run({
            input: { products: [input] },
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

          const suffixedInput = buildCollisionRetryInput(workflowInput, collision, product.id)
          createdProduct = await runCreateProduct(suffixedInput)
          logger.warn(
            collision === "handle"
              ? `Nuvemshop product #${product.id} imported with handle adjusted due to a duplicate handle in the source store (final handle: ${suffixedInput.handle})`
              : `Nuvemshop product #${product.id} imported with variant SKUs adjusted due to a duplicate SKU in the source store`
          )
        }

        imported++
        logger.info(`Product imported: ${createdProduct.title}`)

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
            `PRODUCT CREATED WITHOUT SELLER LINK — requires manual fix. product_id=${createdProduct.id} nuvemshop_id=${product.id}: ${linkErr?.message}`
          )
        }
      } catch (err: any) {
        failed++
        logger.error(`Failed to import Nuvemshop product #${product.id}: ${err?.message}`)
      }
    }
  }

  logger.info(
    `Import complete. Imported: ${imported}, already existing (skipped): ${skipped}, failed: ${failed}, orphaned without seller (requires manual fix): ${orphaned}`
  )
}
