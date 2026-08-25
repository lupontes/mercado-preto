import { validateDocument } from "../validate-document"

describe("validateDocument", () => {
  describe("CPF", () => {
    it("accepts a valid CPF with formatting", () => {
      expect(validateDocument("111.444.777-35")).toEqual({ valid: true, type: "cpf", digits: "11144477735" })
    })

    it("accepts a valid CPF without formatting", () => {
      expect(validateDocument("11144477735")).toEqual({ valid: true, type: "cpf", digits: "11144477735" })
    })

    it("rejects a CPF with an invalid check digit", () => {
      expect(validateDocument("11144477736")).toEqual({ valid: false, type: null, digits: null })
    })

    it("rejects a CPF made of a single repeated digit", () => {
      expect(validateDocument("111.111.111-11")).toEqual({ valid: false, type: null, digits: null })
    })
  })

  describe("CNPJ", () => {
    it("accepts a valid CNPJ with formatting", () => {
      expect(validateDocument("11.222.333/0001-81")).toEqual({ valid: true, type: "cnpj", digits: "11222333000181" })
    })

    it("accepts a valid CNPJ without formatting", () => {
      expect(validateDocument("11222333000181")).toEqual({ valid: true, type: "cnpj", digits: "11222333000181" })
    })

    it("rejects a CNPJ with an invalid check digit", () => {
      expect(validateDocument("11222333000182")).toEqual({ valid: false, type: null, digits: null })
    })

    it("rejects a CNPJ made of a single repeated digit", () => {
      expect(validateDocument("11.111.111/1111-11")).toEqual({ valid: false, type: null, digits: null })
    })
  })

  describe("invalid input", () => {
    it("rejects an empty string", () => {
      expect(validateDocument("")).toEqual({ valid: false, type: null, digits: null })
    })

    it("rejects a length that's neither CPF nor CNPJ", () => {
      expect(validateDocument("123456")).toEqual({ valid: false, type: null, digits: null })
    })
  })
})
