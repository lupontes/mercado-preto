import { verifyLabelToken } from "../label-token"
import { sendWhatsApp } from "../whatsapp"
import { sendBrevoEmail } from "../email"
import {
  alertTeamLabelFailed,
  notifySellerLabelReady,
  notifySellerPostingReminder,
} from "../shipping-label-notify"

jest.mock("../whatsapp", () => ({ sendWhatsApp: jest.fn().mockResolvedValue(undefined) }))
jest.mock("../email", () => ({ sendBrevoEmail: jest.fn().mockResolvedValue(undefined) }))

const whatsapp = sendWhatsApp as jest.Mock
const email = sendBrevoEmail as jest.Mock

const order = { id: "order_01ABC", displayId: 42 }
const seller = { name: "Loja <Axé> & Cia", phone: "11999990000", email: "loja@example.com" }
// 02:00 UTC is still the previous day in São Paulo (UTC-3): the date must be 22/10, not 23/10.
const state = (over: Partial<any> = {}) =>
  ({ status: "generated", postBy: "2026-10-23T02:00:00.000Z", error: null, ...over }) as any

describe("shipping-label-notify", () => {
  const original = { ...process.env }
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.BACKEND_URL = "https://teste.mercadopreto.com.br/api"
    process.env.JWT_SECRET = "test-secret"
    delete process.env.ADMIN_ALERT_EMAIL
  })
  afterAll(() => {
    process.env = original
  })

  describe("notifySellerLabelReady", () => {
    it("sends the WhatsApp text with the São Paulo date and a valid label link", async () => {
      await notifySellerLabelReady(seller, order, state())
      expect(whatsapp).toHaveBeenCalledTimes(1)
      const [phone, text] = whatsapp.mock.calls[0]
      expect(phone).toBe("11999990000")
      const match = text.match(
        /^🛍️ Nova venda no Mercado Preto! Pedido #42\.\n\nImprima a etiqueta, cole na caixa e poste nos Correios até 22\/10:\n(\S+)\n\n_Mercado Preto_$/
      )
      expect(match).not.toBeNull()
      const link = match![1]
      expect(link.startsWith("https://teste.mercadopreto.com.br/api/labels/")).toBe(true)
      expect(verifyLabelToken(link.split("/labels/")[1])).toEqual({ orderId: "order_01ABC" })
    })

    it("omits the date clause when postBy is null", async () => {
      await notifySellerLabelReady(seller, order, state({ postBy: null }))
      expect(whatsapp.mock.calls[0][1]).toContain(
        "Imprima a etiqueta, cole na caixa e poste nos Correios:\nhttps://"
      )
      expect(whatsapp.mock.calls[0][1]).not.toContain(" até ")
    })

    it("sends the e-mail with the same content, HTML-escaping the seller name", async () => {
      await notifySellerLabelReady(seller, order, state())
      expect(email).toHaveBeenCalledTimes(1)
      const [to, subject, html] = email.mock.calls[0]
      expect(to).toBe("loja@example.com")
      expect(subject).toBe("Nova venda no Mercado Preto — pedido #42")
      expect(html).toContain("Nova venda no Mercado Preto! Pedido #42.")
      expect(html).toContain("poste nos Correios até 22/10:")
      expect(html).toMatch(/<a href="https:\/\/teste\.mercadopreto\.com\.br\/api\/labels\/[^"]+">/)
      expect(html).toContain("Loja &lt;Axé&gt; &amp; Cia")
      expect(html).not.toContain("<Axé>")
    })
  })

  describe("notifySellerPostingReminder", () => {
    it("sends the reminder with the postBy date and label link", async () => {
      await notifySellerPostingReminder(seller, order, state())
      const [phone, text] = whatsapp.mock.calls[0]
      expect(phone).toBe("11999990000")
      expect(text).toMatch(
        /^⏰ Lembrete: o pedido #42 precisa ser postado nos Correios até hoje \(22\/10\)\. Etiqueta: https:\/\/teste\.mercadopreto\.com\.br\/api\/labels\/\S+$/
      )
      expect(email).not.toHaveBeenCalled()
    })
  })

  describe("alertTeamLabelFailed", () => {
    it("e-mails the team with the reason and the admin order link", async () => {
      process.env.ADMIN_ALERT_EMAIL = "equipe@example.com"
      await alertTeamLabelFailed(order, state({ status: "failed", error: "Saldo insuficiente" }))
      const [to, subject, html] = email.mock.calls[0]
      expect(to).toBe("equipe@example.com")
      expect(subject).toBe("Etiqueta não comprada — pedido #42")
      expect(html).toContain("Saldo insuficiente")
      expect(html).toContain("https://teste.mercadopreto.com.br/app/orders/order_01ABC")
      expect(html).not.toContain("/api/app")
    })

    it.each([[undefined], ["not a url"]])("omits the admin link when BACKEND_URL is %j", async (value) => {
      process.env.ADMIN_ALERT_EMAIL = "equipe@example.com"
      if (value === undefined) delete process.env.BACKEND_URL
      else process.env.BACKEND_URL = value
      await alertTeamLabelFailed(order, state({ status: "failed", error: "Saldo insuficiente" }))
      const html = email.mock.calls[0][2]
      expect(html).toContain("Saldo insuficiente")
      expect(html).not.toContain("href")
      expect(html).not.toContain("undefined")
    })

    it("only logs when ADMIN_ALERT_EMAIL is missing", async () => {
      const spy = jest.spyOn(console, "error").mockImplementation(() => {})
      await alertTeamLabelFailed(order, state({ status: "failed", error: "Saldo insuficiente" }))
      expect(email).not.toHaveBeenCalled()
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("#42"))
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("Saldo insuficiente"))
      spy.mockRestore()
    })
  })
})
