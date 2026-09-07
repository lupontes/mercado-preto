const MIN_DIGITS = 10

export function buildWhatsAppLink(phone: string | undefined, message: string): string | null {
  if (!phone) return null

  const digits = phone.replace(/\D/g, "")
  if (digits.length < MIN_DIGITS) return null

  const normalized = digits.startsWith("55") ? digits : `55${digits}`

  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`
}
