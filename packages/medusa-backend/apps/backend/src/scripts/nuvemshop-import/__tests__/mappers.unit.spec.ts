import {
  buildCategoryExternalId,
  buildProductExternalId,
  mapProductToWorkflowInput,
  sortCategoriesByDepth,
} from "../mappers"
import { NuvemshopCategory, NuvemshopProduct } from "../client"

describe("buildProductExternalId / buildCategoryExternalId", () => {
  it("namespaces ids so they cannot collide with other external systems", () => {
    expect(buildProductExternalId(201563123)).toBe("nuvemshop:product:201563123")
    expect(buildCategoryExternalId(24200349)).toBe("nuvemshop:category:24200349")
  })
})

describe("sortCategoriesByDepth", () => {
  it("orders root categories before their children", () => {
    const categories: NuvemshopCategory[] = [
      { id: 25084598, parent: 24724499, name: { pt: "Colares longos" } },
      { id: 26641225, parent: 0, name: { pt: "MODA AFRICANA" } },
      { id: 24724499, parent: 0, name: { pt: "COLARES" } },
    ]

    const sorted = sortCategoriesByDepth(categories)
    const indexOf = (id: number) => sorted.findIndex((c) => c.id === id)

    expect(indexOf(24724499)).toBeLessThan(indexOf(25084598))
  })

  it("treats parent: 0 as a root category, matching the real Nuvemshop API shape", () => {
    const categories: NuvemshopCategory[] = [
      { id: 1, parent: 0, name: { pt: "Root" } },
    ]
    expect(sortCategoriesByDepth(categories)).toEqual(categories)
  })
})

describe("mapProductToWorkflowInput", () => {
  // Real sample captured from GET /products for the MAB store: a product with
  // no variant attributes (single default variant).
  const singleVariantProduct: NuvemshopProduct = {
    id: 201563123,
    name: { pt: "Bolsa Africana 2 em 1" },
    handle: { pt: "bolsa-africana-2-em-1" },
    description: { pt: '<p>Cartonagem com tecido africano</p><script>alert(1)</script>' },
    attributes: [],
    images: [
      { id: 1, src: "https://cdn.example.com/a.jpg", position: 1 },
    ],
    variants: [
      {
        id: 838092190,
        price: "182.00",
        sku: "8730",
        stock_management: true,
        weight: "0.500",
        width: "26.00",
        height: "10.00",
        depth: "20.00",
        values: [],
      },
    ],
    categories: [{ id: 24200349 }],
  }

  it("maps a single-variant product (no attributes) to a 'Padrão' option/variant", () => {
    const result = mapProductToWorkflowInput(singleVariantProduct, {
      categoryIds: ["pcat_01"],
      imageUrls: ["https://api.mercadopreto.com.br/static/a.jpg"],
      salesChannelId: "sc_01",
    })

    expect(result.title).toBe("Bolsa Africana 2 em 1")
    expect(result.handle).toBe("bolsa-africana-2-em-1")
    expect(result.external_id).toBe("nuvemshop:product:201563123")
    expect(result.category_ids).toEqual(["pcat_01"])
    expect(result.options).toEqual([{ title: "Padrão", values: ["Padrão"] }])
    expect(result.variants).toHaveLength(1)
    expect(result.variants![0]).toMatchObject({
      title: "Padrão",
      sku: "8730",
      manage_inventory: true,
      weight: 0.5,
      width: 26,
      height: 10,
      length: 20,
      options: { Padrão: "Padrão" },
      prices: [{ amount: 182, currency_code: "brl" }],
    })
    expect(result.thumbnail).toBe("https://api.mercadopreto.com.br/static/a.jpg")
    expect(result.sales_channels).toEqual([{ id: "sc_01" }])
  })

  it("sanitizes the HTML description", () => {
    const result = mapProductToWorkflowInput(singleVariantProduct, {
      categoryIds: [],
      imageUrls: [],
      salesChannelId: "sc_01",
    })
    expect(result.description).not.toContain("<script")
    expect(result.description).toContain("Cartonagem com tecido africano")
  })

  it("maps a multi-variant product with attributes to matching options", () => {
    const multiVariantProduct: NuvemshopProduct = {
      id: 555,
      name: { pt: "Camisa Estampada" },
      handle: { pt: "camisa-estampada" },
      description: { pt: "<p>Camisa</p>" },
      attributes: [{ pt: "Tamanho" }, { pt: "Cor" }],
      images: [],
      variants: [
        {
          id: 1,
          price: "50.00",
          sku: "CAM-P-AZ",
          stock_management: false,
          weight: null,
          width: null,
          height: null,
          depth: null,
          values: [{ pt: "P" }, { pt: "Azul" }],
        },
        {
          id: 2,
          price: "50.00",
          sku: "CAM-M-AZ",
          stock_management: false,
          weight: null,
          width: null,
          height: null,
          depth: null,
          values: [{ pt: "M" }, { pt: "Azul" }],
        },
      ],
      categories: [],
    }

    const result = mapProductToWorkflowInput(multiVariantProduct, {
      categoryIds: [],
      imageUrls: [],
      salesChannelId: "sc_01",
    })

    expect(result.handle).toBe("camisa-estampada")
    expect(result.options).toEqual([
      { title: "Tamanho", values: ["P", "M"] },
      { title: "Cor", values: ["Azul"] },
    ])
    expect(result.variants![0]).toMatchObject({
      title: "P / Azul",
      options: { Tamanho: "P", Cor: "Azul" },
    })
    expect(result.variants![1]).toMatchObject({
      title: "M / Azul",
      options: { Tamanho: "M", Cor: "Azul" },
    })
  })

  it("omits the handle key entirely when Nuvemshop provides no handle, so Medusa's own slugify fallback applies", () => {
    const productWithoutHandle: NuvemshopProduct = {
      ...singleVariantProduct,
      handle: {},
    }

    const result = mapProductToWorkflowInput(productWithoutHandle, {
      categoryIds: [],
      imageUrls: [],
      salesChannelId: "sc_01",
    })

    expect(result).not.toHaveProperty("handle")
  })
})
