import { MessageCircle } from 'lucide-react'
import { buildWhatsAppLink } from '@/lib/whatsapp'

type Props = {
  sellerName?: string
  sellerPhone?: string
  productTitle: string
  productUrl: string
}

export function WhatsAppSellerButton({ sellerName, sellerPhone, productTitle, productUrl }: Props) {
  if (!sellerName) return null

  const message = `Olá! Vi o produto "${productTitle}" no Mercado Preto (${productUrl}) e tenho uma dúvida.`
  const link = buildWhatsAppLink(sellerPhone, message)

  if (!link) return null

  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-center gap-3 rounded-xl border-2 border-forest px-8 py-4 font-display font-bold text-lg text-forest transition-colors hover:bg-forest/10 w-full mt-4"
    >
      <MessageCircle className="h-5 w-5" />
      Falar com o vendedor
    </a>
  )
}
