import { sendWhatsApp } from "../whatsapp"
import { sendBrevoEmail } from "../email"
import {
  adminProductLink,
  notifySellerProductApproved,
  notifyTeamProductSubmitted,
  storeProductLink,
} from "../product-moderation-notify"

jest.mock("../whatsapp", () => ({ sendWhatsApp: jest.fn().mockResolvedValue(undefined) }))
jest.mock("../email", () => ({ sendBrevoEmail: jest.fn().mockResolvedValue(undefined) }))

const whatsapp = sendWhatsApp as jest.Mock
const email = sendBrevoEmail as jest.Mock

const product = { id: "prod_1", title: "Colar", handle: "colar" }
const seller = { name: "Axé", phone: "11999990000", email: "loja@example.com" }

describe("product-moderation-notify", () => {
  const original = { ...process.env }
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.BACKEND_URL = "https://teste.mercadopreto.com.br/api"
    process.env.ADMIN_ALERT_EMAIL = "gestao@example.com"
    process.env.MODERATION_ALERT_WHATSAPP = "11988887777"
  })
  afterAll(() => {
    process.env = original
  })

  describe("links", () => {
    it("builds admin and storefront links from the BACKEND_URL origin", () => {
      expect(adminProductLink("prod_1")).toBe("https://teste.mercadopreto.com.br/app/products/prod_1")
      expect(storeProductLink("colar")).toBe("https://teste.mercadopreto.com.br/produto/colar")
    })

    it("returns null when BACKEND_URL is invalid", () => {
      process.env.BACKEND_URL = ""
      expect(adminProductLink("prod_1")).toBeNull()
      expect(storeProductLink("colar")).toBeNull()
    })
  })

  describe("notifyTeamProductSubmitted", () => {
    it("e-mails the managers for a new product with the admin link", async () => {
      await notifyTeamProductSubmitted(product, "Axé", "new")
      expect(email).toHaveBeenCalledTimes(1)
      const [to, subject, html] = email.mock.calls[0]
      expect(to).toBe("gestao@example.com")
      expect(subject).toBe("Produto para analisar — Colar")
      expect(html).toContain("Novo produto da loja Axé")
      expect(html).toContain("https://teste.mercadopreto.com.br/app/products/prod_1")
    })

    it("uses the change wording for kind change", async () => {
      await notifyTeamProductSubmitted(product, "Axé", "change")
      expect(email.mock.calls[0][2]).toContain("Alteração de produto da loja Axé")
    })

    it("sends WhatsApp only when MODERATION_ALERT_WHATSAPP is set", async () => {
      await notifyTeamProductSubmitted(product, "Axé", "new")
      expect(whatsapp).toHaveBeenCalledTimes(1)
      expect(whatsapp.mock.calls[0][0]).toBe("11988887777")
      expect(whatsapp.mock.calls[0][1]).toContain("Novo produto da loja Axé aguardando análise: Colar")

      whatsapp.mockClear()
      delete process.env.MODERATION_ALERT_WHATSAPP
      await notifyTeamProductSubmitted(product, "Axé", "new")
      expect(whatsapp).not.toHaveBeenCalled()
    })

    it("only logs when ADMIN_ALERT_EMAIL is missing", async () => {
      delete process.env.ADMIN_ALERT_EMAIL
      const spy = jest.spyOn(console, "error").mockImplementation(() => {})
      await notifyTeamProductSubmitted(product, "Axé", "new")
      expect(email).not.toHaveBeenCalled()
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })

    it("escapes the title in the HTML", async () => {
      await notifyTeamProductSubmitted({ ...product, title: "<b>X</b>" }, "Axé", "new")
      const html = email.mock.calls[0][2]
      expect(html).toContain("&lt;b&gt;X&lt;/b&gt;")
      expect(html).not.toContain("<b>X</b>")
    })
  })

  describe("notifySellerProductApproved", () => {
    it("sends WhatsApp and e-mail for a new product", async () => {
      await notifySellerProductApproved(seller, product, "new")
      const [phone, text] = whatsapp.mock.calls[0]
      expect(phone).toBe("11999990000")
      expect(text).toBe(
        "✅ Seu produto *Colar* foi aprovado e já está à venda no Mercado Preto:\nhttps://teste.mercadopreto.com.br/produto/colar\n\n_Mercado Preto_"
      )
      const [to, subject, html] = email.mock.calls[0]
      expect(to).toBe("loja@example.com")
      expect(subject).toBe("Produto aprovado no Mercado Preto — Colar")
      expect(html).toContain("foi aprovado e já está à venda")
    })

    it("uses the change wording for kind change", async () => {
      await notifySellerProductApproved(seller, product, "change")
      expect(whatsapp.mock.calls[0][1]).toContain(
        "✅ A alteração do produto *Colar* foi aprovada e já está na vitrine do Mercado Preto:"
      )
    })

    it("escapes the title in the e-mail HTML", async () => {
      await notifySellerProductApproved(seller, { ...product, title: "<b>X</b>" }, "new")
      const html = email.mock.calls[0][2]
      expect(html).toContain("&lt;b&gt;X&lt;/b&gt;")
      expect(html).not.toContain("<b>X</b>")
    })
  })
})
