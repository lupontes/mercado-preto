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
      "NUVEMSHOP_ACCESS_TOKEN e NUVEMSHOP_STORE_ID precisam estar definidos no .env do backend."
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
      "Nenhum sales channel encontrado. Rode `npx medusa exec ./src/migration-scripts/initial-data-seed.ts` antes deste script."
    )
  }

  logger.info("Buscando dados da loja na Nuvemshop...")
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
      status: "active",
    })
    logger.info(`Seller criado: ${seller.id}`)
  } else {
    logger.info(`Seller já existia: ${seller.id}`)
  }

  logger.info("Buscando categorias na Nuvemshop...")
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

      const parentId =
        category.parent && category.parent !== 0
          ? categoryIdMap.get(category.parent)
          : undefined

      const {
        result: [created],
      } = await createProductCategoriesWorkflow(container).run({
        input: {
          product_categories: [
            {
              name: category.name.pt || `Categoria ${category.id}`,
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
      logger.error(`Falha ao importar categoria Nuvemshop #${category.id}: ${err?.message}`)
    }
  }
  logger.info(`${categoryIdMap.size} categorias sincronizadas, ${categoriesFailed} falharam.`)

  logger.info("Importando produtos...")
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
            throw new Error(`Falha ao baixar imagem ${image.src}: HTTP ${response.status}`)
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
              ? `Produto Nuvemshop #${product.id} importado com handle ajustado por colisão de handle duplicado na loja de origem (handle final: ${suffixedInput.handle})`
              : `Produto Nuvemshop #${product.id} importado com SKUs de variante ajustados por colisão de SKU duplicado na loja de origem`
          )
        }

        imported++
        logger.info(`Produto importado: ${createdProduct.title}`)

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
            `PRODUTO CRIADO SEM VÍNCULO DE VENDEDOR — requer correção manual. product_id=${createdProduct.id} nuvemshop_id=${product.id}: ${linkErr?.message}`
          )
        }
      } catch (err: any) {
        failed++
        logger.error(`Falha ao importar produto Nuvemshop #${product.id}: ${err?.message}`)
      }
    }
  }

  logger.info(
    `Importação concluída. Importados: ${imported}, já existentes (skip): ${skipped}, falhas: ${failed}, órfãos sem vendedor (correção manual necessária): ${orphaned}`
  )
}
