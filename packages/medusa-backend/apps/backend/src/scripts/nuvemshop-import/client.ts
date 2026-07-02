const API_BASE = "https://api.tiendanube.com/v1"
const USER_AGENT = "Mercado Preto Migration (lupontes@gmail.com)"
const PER_PAGE = 30

export interface NuvemshopStore {
  email: string
  phone: string | null
  business_id: string | null
  business_name: string | null
  address: string | null
}

export interface NuvemshopCategory {
  id: number
  parent: number | null
  name: { pt?: string }
}

export interface NuvemshopImage {
  id: number
  src: string
  position: number
}

export interface NuvemshopVariant {
  id: number
  price: string
  sku: string | null
  stock_management: boolean
  weight: string | null
  width: string | null
  height: string | null
  depth: string | null
  values: { pt?: string }[]
}

export interface NuvemshopProduct {
  id: number
  name: { pt?: string }
  description: { pt?: string }
  attributes: { pt?: string }[]
  images: NuvemshopImage[]
  variants: NuvemshopVariant[]
  categories: { id: number }[]
}

export interface NuvemshopClientConfig {
  storeId: string
  accessToken: string
}

export class NuvemshopClient {
  private readonly storeId: string
  private readonly accessToken: string

  constructor(config: NuvemshopClientConfig) {
    this.storeId = config.storeId
    this.accessToken = config.accessToken
  }

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(`${API_BASE}/${this.storeId}${path}`, {
      headers: {
        Authentication: `bearer ${this.accessToken}`,
        "User-Agent": USER_AGENT,
      },
    })
    if (!response.ok) {
      throw new Error(`Nuvemshop API respondeu ${response.status} para ${path}`)
    }
    return response.json() as Promise<T>
  }

  async getStore(): Promise<NuvemshopStore> {
    return this.request<NuvemshopStore>("/store")
  }

  async listCategories(): Promise<NuvemshopCategory[]> {
    const categories: NuvemshopCategory[] = []
    for (let page = 1; ; page++) {
      const pageResult = await this.request<NuvemshopCategory[]>(
        `/categories?page=${page}&per_page=${PER_PAGE}`
      )
      categories.push(...pageResult)
      if (pageResult.length < PER_PAGE) break
    }
    return categories
  }

  async *iterateProducts(): AsyncGenerator<NuvemshopProduct[]> {
    for (let page = 1; ; page++) {
      const pageResult = await this.request<NuvemshopProduct[]>(
        `/products?page=${page}&per_page=${PER_PAGE}`
      )
      if (pageResult.length === 0) break
      yield pageResult
      if (pageResult.length < PER_PAGE) break
    }
  }
}
