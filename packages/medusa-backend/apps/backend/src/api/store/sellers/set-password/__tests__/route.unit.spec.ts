jest.mock("../../../../../utils/email", () => ({ sendBrevoEmail: jest.fn() }))

import { POST } from "../route"
import { sendBrevoEmail } from "../../../../../utils/email"
import SellerModuleService, { RESET_TOKEN_TTL_MS } from "../../../../../modules/seller/service"

const GENERIC = "Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha."
const BAD_LINK = "Link inválido ou expirado. Peça um novo."

let sellerService: {
  listSellers: jest.Mock
  issuePasswordToken: jest.Mock
  consumePasswordToken: jest.Mock
  updateSellers: jest.Mock
}
let logger: { info: jest.Mock; warn: jest.Mock; error: jest.Mock }

const seller = (status: string) => ({ id: "seller_1", email: "loja@example.com", ownerName: "Fulana", status })

function makeReq(body: unknown) {
  const services: Record<string, unknown> = { seller: sellerService, logger }
  return { body, scope: { resolve: (key: string) => services[key] } } as any
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("POST /store/sellers/set-password", () => {
  const originalCors = process.env.STORE_CORS

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.STORE_CORS = "https://teste.mercadopreto.com.br,http://localhost:3000"
    sellerService = {
      listSellers: jest.fn().mockResolvedValue([]),
      issuePasswordToken: jest.fn().mockResolvedValue("tok123"),
      consumePasswordToken: jest.fn().mockResolvedValue(null),
      updateSellers: jest.fn().mockResolvedValue([]),
    }
    logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  })

  afterAll(() => {
    process.env.STORE_CORS = originalCors
  })

  describe("asking for a link", () => {
    it("answers the generic message and sends nothing for an unknown e-mail", async () => {
      const res = makeRes()
      await POST(makeReq({ email: "ninguem@example.com" }), res)

      expect(res._status).toBe(200)
      expect(res._body).toEqual({ message: GENERIC })
      expect(sellerService.issuePasswordToken).not.toHaveBeenCalled()
      expect(sendBrevoEmail).not.toHaveBeenCalled()
    })

    it.each(["pending", "suspended"])("answers the same way for a %s seller", async (status) => {
      sellerService.listSellers.mockResolvedValue([seller(status)])
      const res = makeRes()
      await POST(makeReq({ email: "loja@example.com" }), res)

      expect(res._body).toEqual({ message: GENERIC })
      expect(sellerService.issuePasswordToken).not.toHaveBeenCalled()
      expect(sendBrevoEmail).not.toHaveBeenCalled()
    })

    it("issues a one-hour token and e-mails the link to an approved seller", async () => {
      sellerService.listSellers.mockResolvedValue([seller("approved")])
      const res = makeRes()
      await POST(makeReq({ email: "loja@example.com" }), res)

      expect(res._body).toEqual({ message: GENERIC })
      expect(sellerService.issuePasswordToken).toHaveBeenCalledWith("seller_1", RESET_TOKEN_TTL_MS)
      const [to, , html] = (sendBrevoEmail as jest.Mock).mock.calls[0]
      expect(to).toBe("loja@example.com")
      expect(html).toContain("https://teste.mercadopreto.com.br/vendedor/configurar-senha?token=tok123")
      expect(JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls])).not.toContain("tok123")
    })
  })

  describe("response timing", () => {
    it("answers without waiting for the e-mail provider", async () => {
      sellerService.listSellers.mockResolvedValue([seller("approved")])
      ;(sendBrevoEmail as jest.Mock).mockReturnValue(new Promise(() => {}))
      const res = makeRes()

      await POST(makeReq({ email: "loja@example.com" }), res)

      expect(res._body).toEqual({ message: GENERIC })
    })

    it("logs a failed e-mail instead of failing the request", async () => {
      sellerService.listSellers.mockResolvedValue([seller("approved")])
      ;(sendBrevoEmail as jest.Mock).mockImplementation(async () => { throw new Error("brevo down") })
      const res = makeRes()

      await POST(makeReq({ email: "loja@example.com" }), res)
      await new Promise((r) => setImmediate(r))

      expect(res._body).toEqual({ message: GENERIC })
      expect(logger.error.mock.calls[0][0]).toContain("brevo down")
      expect(logger.error.mock.calls[0][0]).not.toContain("tok123")
    })
  })

  describe("setting the password", () => {
    it("sets the password and activates the seller with a valid token", async () => {
      sellerService.consumePasswordToken.mockResolvedValue("seller_1")
      sellerService.listSellers.mockResolvedValue([seller("approved")])
      const res = makeRes()
      await POST(makeReq({ token: "tok123", password: "senhaNova1" }), res)

      expect(res._status).toBe(200)
      expect(res._body).toEqual({ message: "Senha configurada com sucesso. Agora você pode acessar o portal do vendedor." })
      expect(sellerService.consumePasswordToken).toHaveBeenCalledWith("tok123")
      const { selector, data } = sellerService.updateSellers.mock.calls[0][0]
      expect(selector).toEqual({ id: "seller_1" })
      expect(data.status).toBe("active")
      expect(SellerModuleService.verifyPassword("senhaNova1", data.passwordHash)).toBe(true)
    })

    it("rejects an invalid or used token", async () => {
      const res = makeRes()
      await POST(makeReq({ token: "velho", password: "senhaNova1" }), res)

      expect(res._status).toBe(400)
      expect(res._body).toEqual({ error: BAD_LINK })
      expect(sellerService.updateSellers).not.toHaveBeenCalled()
    })

    it("rejects a short password before touching the token", async () => {
      const res = makeRes()
      await POST(makeReq({ token: "tok123", password: "curta" }), res)

      expect(res._status).toBe(400)
      expect((res._body as any).error).toBe("A senha deve ter pelo menos 8 caracteres")
      expect(sellerService.consumePasswordToken).not.toHaveBeenCalled()
    })

    it("refuses a suspended seller even with a valid token", async () => {
      sellerService.consumePasswordToken.mockResolvedValue("seller_1")
      sellerService.listSellers.mockResolvedValue([seller("suspended")])
      const res = makeRes()
      await POST(makeReq({ token: "tok123", password: "senhaNova1" }), res)

      expect(res._status).toBe(403)
      expect(res._body).toEqual({ error: "Conta ainda não aprovada. Aguarde a análise da equipe." })
      expect(sellerService.updateSellers).not.toHaveBeenCalled()
    })
  })
})
