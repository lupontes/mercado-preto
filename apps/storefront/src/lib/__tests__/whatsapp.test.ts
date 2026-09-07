import { describe, expect, it } from "vitest"
import { buildWhatsAppLink } from "../whatsapp"

describe("buildWhatsAppLink", () => {
  it("builds a wa.me link with the DDI 55 prefix and the URL-encoded message", () => {
    const link = buildWhatsAppLink("(71) 99999-8888", "Olá! Dúvida sobre o produto.")

    expect(link).toBe("https://wa.me/5571999998888?text=Ol%C3%A1!%20D%C3%BAvida%20sobre%20o%20produto.")
  })

  it("does not duplicate the DDI 55 when the phone already has it", () => {
    const link = buildWhatsAppLink("55 71 99999-8888", "Oi")

    expect(link).toBe("https://wa.me/5571999998888?text=Oi")
  })

  it("returns null when the phone has too few digits after normalizing", () => {
    const link = buildWhatsAppLink("123", "Oi")

    expect(link).toBeNull()
  })

  it("returns null when the phone is empty or missing", () => {
    expect(buildWhatsAppLink("", "Oi")).toBeNull()
    expect(buildWhatsAppLink(undefined, "Oi")).toBeNull()
  })
})
