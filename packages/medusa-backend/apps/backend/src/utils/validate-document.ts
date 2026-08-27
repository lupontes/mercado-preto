export interface DocumentValidationResult {
  valid: boolean
  type: "cpf" | "cnpj" | null
  digits: string | null
}

function isAllSameDigit(digits: string): boolean {
  return /^(\d)\1*$/.test(digits)
}

function computeCheckDigit(digits: string, weights: number[]): number {
  const sum = digits
    .split("")
    .reduce((acc, digit, i) => acc + Number(digit) * weights[i], 0)
  const rest = sum % 11
  return rest < 2 ? 0 : 11 - rest
}

function isValidCpf(digits: string): boolean {
  if (digits.length !== 11 || isAllSameDigit(digits)) return false

  const firstCheck = computeCheckDigit(digits.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2])
  const secondCheck = computeCheckDigit(digits.slice(0, 9) + firstCheck, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2])

  return digits === digits.slice(0, 9) + String(firstCheck) + String(secondCheck)
}

function isValidCnpj(digits: string): boolean {
  if (digits.length !== 14 || isAllSameDigit(digits)) return false

  const firstCheck = computeCheckDigit(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const secondCheck = computeCheckDigit(digits.slice(0, 12) + firstCheck, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])

  return digits === digits.slice(0, 12) + String(firstCheck) + String(secondCheck)
}

/** Strips formatting and validates a CPF (11 digits) or CNPJ (14 digits) by check digit. */
export function validateDocument(raw: string): DocumentValidationResult {
  const digits = raw.replace(/\D/g, "")

  if (digits.length === 11 && isValidCpf(digits)) {
    return { valid: true, type: "cpf", digits }
  }

  if (digits.length === 14 && isValidCnpj(digits)) {
    return { valid: true, type: "cnpj", digits }
  }

  return { valid: false, type: null, digits: null }
}
