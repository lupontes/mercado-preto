// Mirrors hasShippingOrigin in the backend (utils/seller-address.ts), which is the authority.
export type SellerAddressFields = {
  addressPostalCode?: string | null
  addressStreet?: string | null
  addressNumber?: string | null
  addressComplement?: string | null
  addressDistrict?: string | null
  addressCity?: string | null
  addressState?: string | null
}

export function hasShippingOrigin(s: SellerAddressFields | null | undefined): boolean {
  if (!s) return false
  const filled = (v?: string | null) => !!v && v.trim().length > 0
  return (
    (s.addressPostalCode ?? '').replace(/\D/g, '').length === 8 &&
    filled(s.addressStreet) && filled(s.addressNumber) && filled(s.addressDistrict) &&
    filled(s.addressCity) && filled(s.addressState)
  )
}

export async function fetchAddressByCep(cep: string): Promise<{ street: string; district: string; city: string; state: string } | null> {
  const digits = cep.replace(/\D/g, '')
  if (digits.length !== 8) return null
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
    if (!res.ok) return null
    const data = await res.json()
    if (data.erro) return null
    return { street: data.logradouro ?? '', district: data.bairro ?? '', city: data.localidade ?? '', state: data.uf ?? '' }
  } catch {
    return null
  }
}
