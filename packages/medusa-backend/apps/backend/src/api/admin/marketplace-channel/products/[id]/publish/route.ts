import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "zod"
import { MARKETPLACE_CHANNEL_MODULE } from "../../../../../../modules/marketplace-channel"
import type MarketplaceChannelModuleService from "../../../../../../modules/marketplace-channel/service"
import { getListingFee, createItem, setItemDescription } from "../../../../../../utils/mercadolivre-client"

const schema = z.object({
  categoryId: z.string(),
  attributes: z.array(z.object({ id: z.string(), valueName: z.string() })),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id: productId } = req.params

  const channelService: MarketplaceChannelModuleService = req.scope.resolve(MARKETPLACE_CHANNEL_MODULE)
  const credential = await channelService.getCredential("mercado_livre")
  if (!credential) {
    return res.status(503).json({ error: "Conta do Mercado Livre não conectada." })
  }

  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos.", details: parsed.error.flatten() })
  }
  const { categoryId, attributes } = parsed.data

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "description", "thumbnail", "seller.id", "variants.prices.amount"],
    filters: { id: productId },
  })
  const product = (products as any[])[0]
  if (!product) {
    return res.status(404).json({ error: "Produto não encontrado." })
  }
  const sellerId = product.seller?.id
  if (!sellerId) {
    return res.status(400).json({ error: "Produto sem vendedor associado." })
  }
  const priceInCentavos = product.variants?.[0]?.prices?.[0]?.amount
  if (!priceInCentavos) {
    return res.status(400).json({ error: "Produto sem preço cadastrado." })
  }
  const priceInReais = priceInCentavos / 100

  try {
    const fee = await getListingFee(credential.accessToken, priceInReais, categoryId)
    const { id: externalItemId } = await createItem(credential.accessToken, {
      title: product.title,
      categoryId,
      price: priceInReais,
      availableQuantity: 1,
      pictures: product.thumbnail ? [{ source: product.thumbnail }] : [],
      attributes: attributes.map((a) => ({ id: a.id, value_name: a.valueName })),
    })

    if (product.description) {
      await setItemDescription(credential.accessToken, externalItemId, product.description)
    }

    await channelService.recordListing({
      productId,
      sellerId,
      channel: "mercado_livre",
      externalItemId,
      externalCategoryId: categoryId,
      saleFeePercent: fee.percentageFee,
      saleFeeFixed: Math.round(fee.fixedFee * 100),
    })

    res.json({ externalItemId, saleFeePercent: fee.percentageFee, saleFeeFixed: fee.fixedFee })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    await channelService.recordListingError(productId, sellerId, "mercado_livre", msg)
    res.status(502).json({ error: "Erro ao publicar no Mercado Livre.", detail: msg })
  }
}
