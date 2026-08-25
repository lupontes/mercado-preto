import { describe, expect, it } from "vitest"
import { maskDocument, validateDocument } from "../document"

describe("validateDocument", () => {
  it("accepts a valid CPF with formatting", () => {
    expect(validateDocument("111.444.777-35")).toEqual({ valid: true, type: "cpf", digits: "11144477735" })
  })

  it("accepts a valid CNPJ with formatting", () => {
    expect(validateDocument("11.222.333/0001-81")).toEqual({ valid: true, type: "cnpj", digits: "11222333000181" })
  })

  it("rejects a CPF with an invalid check digit", () => {
    expect(validateDocument("111.444.777-36")).toEqual({ valid: false, type: null, digits: null })
  })

  it("rejects a CPF made of a single repeated digit", () => {
    expect(validateDocument("111.111.111-11")).toEqual({ valid: false, type: null, digits: null })
  })

  it("rejects an empty string", () => {
    expect(validateDocument("")).toEqual({ valid: false, type: null, digits: null })
  })
})

describe("maskDocument", () => {
  it("masks digits as a CPF while 11 or fewer digits are typed", () => {
    expect(maskDocument("111444777")).toBe("111.444.777")
    expect(maskDocument("11144477735")).toBe("111.444.777-35")
  })

  it("switches to CNPJ masking past 11 digits", () => {
    expect(maskDocument("112223330001")).toBe("11.222.333/0001")
    expect(maskDocument("11222333000181")).toBe("11.222.333/0001-81")
  })

  it("strips non-digit characters before masking", () => {
    expect(maskDocument("111.444.777-35")).toBe("111.444.777-35")
  })

  it("truncates input beyond 14 digits", () => {
    expect(maskDocument("112223330001819999")).toBe("11.222.333/0001-81")
  })
})
