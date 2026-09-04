import { MARKETPLACE_CHANNEL_MODULE } from "../../../../../modules/marketplace-channel"
import { DELETE } from "../route"

function makeReq() {
  const channelService = { deleteCredential: jest.fn().mockResolvedValue(undefined) }
  return {
    scope: {
      resolve: (key: string) => {
        if (key === MARKETPLACE_CHANNEL_MODULE) return channelService
        return {}
      },
    },
    _channelService: channelService,
  } as any
}

function makeRes() {
  const res = { _body: undefined as unknown } as any
  res.json = (body: unknown) => { res._body = body; return res }
  return res
}

describe("DELETE /admin/marketplace-channel/disconnect", () => {
  it("deletes the stored Mercado Livre credential and confirms it", async () => {
    const req = makeReq()
    const res = makeRes()

    await DELETE(req, res)

    expect(req._channelService.deleteCredential).toHaveBeenCalledWith("mercado_livre")
    expect(res._body).toEqual({ disconnected: true, channel: "mercado_livre" })
  })
})
