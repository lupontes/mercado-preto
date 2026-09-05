import { parseCookie, buildSetCookie, buildClearCookie } from "../cookies"

describe("parseCookie", () => {
  it("extracts the named cookie's value", () => {
    expect(parseCookie("seller_session=abc.def.ghi", "seller_session")).toBe("abc.def.ghi")
  })

  it("finds the named cookie among several", () => {
    expect(parseCookie("other=1; seller_session=abc; another=2", "seller_session")).toBe("abc")
  })

  it("returns null when the cookie is absent", () => {
    expect(parseCookie("other=1", "seller_session")).toBeNull()
  })

  it("returns null when the header is undefined", () => {
    expect(parseCookie(undefined, "seller_session")).toBeNull()
  })

  it("decodes a URI-encoded value", () => {
    expect(parseCookie("seller_session=a%3Bb", "seller_session")).toBe("a;b")
  })
})

describe("buildSetCookie", () => {
  it("includes HttpOnly, SameSite=Strict, Path=/ and Max-Age", () => {
    const header = buildSetCookie("seller_session", "abc.def.ghi", 604800)
    expect(header).toBe("seller_session=abc.def.ghi; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800")
  })

  it("appends Secure when options.secure is true", () => {
    const header = buildSetCookie("seller_session", "abc", 604800, { secure: true })
    expect(header).toContain("; Secure")
  })

  it("omits Secure when options.secure is false or absent", () => {
    const header = buildSetCookie("seller_session", "abc", 604800)
    expect(header).not.toContain("Secure")
  })

  it("URI-encodes the value", () => {
    const header = buildSetCookie("seller_session", "a;b", 604800)
    expect(header).toContain("seller_session=a%3Bb")
  })
})

describe("buildClearCookie", () => {
  it("sets Max-Age=0 to expire the cookie immediately", () => {
    expect(buildClearCookie("seller_session")).toContain("Max-Age=0")
  })

  it("carries the secure option through", () => {
    expect(buildClearCookie("seller_session", { secure: true })).toContain("Secure")
  })
})
