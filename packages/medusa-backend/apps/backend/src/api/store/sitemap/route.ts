import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "../../../modules/seller"
import SellerModuleService from "../../../modules/seller/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const storeUrl = (process.env.STORE_CORS || "http://localhost:3000").split(",")[0].trim()

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const sellerService: SellerModuleService = req.scope.resolve(SELLER_MODULE)

  const [{ data: products }, sellers] = await Promise.all([
    query.graph({
      entity: "product",
      fields: ["id", "handle", "updated_at"],
      filters: { status: "published" },
    }),
    sellerService.listSellers({ status: "active" }),
  ])

  const staticRoutes = [
    { url: storeUrl, priority: "1.0", changefreq: "daily" },
    { url: `${storeUrl}/lojas`, priority: "0.9", changefreq: "daily" },
    { url: `${storeUrl}/produtos`, priority: "0.9", changefreq: "daily" },
    { url: `${storeUrl}/sobre`, priority: "0.5", changefreq: "monthly" },
    { url: `${storeUrl}/contato`, priority: "0.5", changefreq: "monthly" },
  ]

  const productRoutes = products.map((p: any) => ({
    url: `${storeUrl}/produtos/${p.handle}`,
    lastmod: p.updated_at ? new Date(p.updated_at).toISOString().split("T")[0] : undefined,
    priority: "0.8",
    changefreq: "weekly",
  }))

  const sellerRoutes = sellers.map((s: any) => ({
    url: `${storeUrl}/lojas/${s.id}`,
    lastmod: s.updated_at ? new Date(s.updated_at).toISOString().split("T")[0] : undefined,
    priority: "0.7",
    changefreq: "weekly",
  }))

  const allRoutes = [...staticRoutes, ...productRoutes, ...sellerRoutes]

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allRoutes
  .map(
    (r: any) => `  <url>
    <loc>${r.url}</loc>
    ${r.lastmod ? `<lastmod>${r.lastmod}</lastmod>` : ""}
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>`

  res.setHeader("Content-Type", "application/xml; charset=utf-8")
  res.setHeader("Cache-Control", "public, max-age=3600")
  res.send(xml)
}
