import { sanitizeDescription } from "../sanitize"

describe("sanitizeDescription", () => {
  it("strips script tags from Nuvemshop HTML descriptions", () => {
    const dirty = '<p>Bolsa artesanal</p><script>alert("xss")</script>'
    const clean = sanitizeDescription(dirty)
    expect(clean).not.toContain("<script")
    expect(clean).not.toContain("alert")
    expect(clean).toContain("Bolsa artesanal")
  })

  it("keeps common formatting tags", () => {
    const dirty = "<p>Linha 1</p><p><strong>Linha 2</strong></p>"
    const clean = sanitizeDescription(dirty)
    expect(clean).toContain("<p>")
    expect(clean).toContain("<strong>")
  })

  it("strips inline event handler attributes", () => {
    const dirty = '<p onclick="alert(1)">Clique</p>'
    const clean = sanitizeDescription(dirty)
    expect(clean).not.toContain("onclick")
  })

  it("returns an empty string for undefined input", () => {
    expect(sanitizeDescription(undefined)).toBe("")
  })
})
