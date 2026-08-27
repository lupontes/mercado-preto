import { POST } from "../route"

function makeReq(body: any) {
  return {
    headers: {},
    body,
    scope: { resolve: () => ({ listSellers: jest.fn().mockResolvedValue([]) }) },
  } as any
}

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as any
  res.status = (code: number) => { res._status = code; return res }
  res.json = (body: unknown) => { res._body = body; return res }
  res.sendStatus = (code: number) => { res._status = code; return res }
  return res
}

describe("POST /store/webhooks/typebot", () => {
  const original = { ...process.env }

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true })
    process.env.EVOLUTION_API_URL = "https://evolution.example.com"
    process.env.EVOLUTION_API_KEY = "evo-key"
    process.env.EVOLUTION_API_INSTANCE = "mercadopreto"
    process.env.MARKETPLACE_SANDBOX = "true"
    process.env.TEST_WHATSAPP_RECIPIENT = "5511999999999"
    delete process.env.EVOLUTION_WEBHOOK_SECRET
  })

  afterEach(() => {
    process.env = { ...original }
  })

  it("redirects the FAQ reply to TEST_WHATSAPP_RECIPIENT in sandbox mode instead of the real sender", async () => {
    const body = {
      event: "messages.upsert",
      data: {
        key: { remoteJid: "557199990000", fromMe: false },
        message: { conversation: "qual o horario de atendimento?" },
      },
    }

    await POST(makeReq(body), makeRes())

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const sentBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(sentBody.number).toBe("5511999999999")
    expect(sentBody.number).not.toBe("557199990000")
  })
})
