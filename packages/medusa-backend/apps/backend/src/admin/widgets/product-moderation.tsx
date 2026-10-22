import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Button, Container, Heading, StatusBadge, Text, toast } from "@medusajs/ui"
import type { AdminProduct, DetailWidgetProps } from "@medusajs/framework/types"
import { useApproveProductModeration, useProductModeration, type PendingChanges } from "../hooks/moderation"
import { PACKAGE_SIZE_LABELS, type PackageSize } from "../../utils/package-size"

const formatPrice = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

const packageLabel = (size?: string | null) =>
  size ? (PACKAGE_SIZE_LABELS[size as PackageSize] ?? size) : "—"

// The seller registers a BR number in any format; wa.me needs digits with the country code.
function whatsappUrl(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  const hasCountryCode = digits.startsWith("55") && (digits.length === 12 || digits.length === 13)
  return `https://wa.me/${hasCountryCode ? digits : `55${digits}`}`
}

type DiffRow = { key: string; label: string; before: string; after: string; image?: boolean }

function buildDiff(product: AdminProduct, changes: PendingChanges): DiffRow[] {
  const rows: DiffRow[] = []
  if (changes.title !== undefined) {
    rows.push({ key: "title", label: "Título", before: product.title ?? "—", after: changes.title })
  }
  if (changes.description !== undefined) {
    rows.push({ key: "description", label: "Descrição", before: product.description || "—", after: changes.description || "—" })
  }
  const newPrice = changes.variants?.[0]?.prices?.find((p) => p.currency_code === "brl")
  if (newPrice) {
    const oldPrice = product.variants?.[0]?.prices?.find((p) => p.currency_code === "brl")
    rows.push({
      key: "price",
      label: "Preço em R$",
      before: oldPrice ? formatPrice(oldPrice.amount) : "—",
      after: formatPrice(newPrice.amount),
    })
  }
  if (changes.thumbnail !== undefined) {
    rows.push({ key: "thumbnail", label: "Foto", before: product.thumbnail ?? "", after: changes.thumbnail, image: true })
  }
  if (changes.category_id !== undefined) {
    // Names are not loaded here; the id is enough for the team to recognise the category.
    rows.push({
      key: "category",
      label: "Categoria",
      before: product.categories?.[0]?.id ?? "—",
      after: changes.category_id ?? "—",
    })
  }
  if (changes.packageSize !== undefined) {
    rows.push({
      key: "package",
      label: "Embalagem",
      before: packageLabel(product.metadata?.package_size as string | undefined),
      after: packageLabel(changes.packageSize),
    })
  }
  return rows
}

function Thumb({ src }: { src: string }) {
  return src ? <img src={src} alt="" className="h-10 w-10 rounded object-cover" /> : <span>—</span>
}

const ProductModerationWidget = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const { data: moderation } = useProductModeration(data.id)
  const approve = useApproveProductModeration(data.id)

  if (!moderation?.kind) return null

  const isChange = moderation.kind === "change"
  const rows = isChange && moderation.pendingChanges ? buildDiff(data, moderation.pendingChanges) : []
  const phone = moderation.seller.phone

  const onApprove = () =>
    approve.mutate(undefined, {
      onSuccess: () => toast.success("Produto aprovado"),
      onError: (err) => toast.error((err as Error)?.message ?? "Não foi possível aprovar o produto"),
    })

  return (
    <Container className="flex flex-col gap-3 px-6 py-4">
      <div className="flex items-center justify-between">
        <Heading level="h2">Análise</Heading>
        <StatusBadge color="orange">{isChange ? "Alteração em análise" : "Em análise"}</StatusBadge>
      </div>

      {rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-col gap-1">
              <Text size="small" weight="plus">{row.label}</Text>
              {row.image ? (
                <div className="flex items-center gap-2">
                  <Thumb src={row.before} />
                  <span>→</span>
                  <Thumb src={row.after} />
                </div>
              ) : (
                <Text size="small">{`${row.before} → ${row.after}`}</Text>
              )}
            </li>
          ))}
        </ul>
      )}

      <Button size="small" isLoading={approve.isPending} onClick={onApprove}>
        {isChange ? "Aprovar alteração" : "Aprovar e publicar"}
      </Button>

      {phone && (
        <a href={whatsappUrl(phone)} target="_blank" rel="noreferrer" className="text-ui-fg-interactive text-sm">
          Falar com a vendedora no WhatsApp
        </a>
      )}

      <Text size="small" className="text-ui-fg-subtle">
        Para trocar a foto, use Mídia e marque a nova como miniatura.
      </Text>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.side.before",
})

export default ProductModerationWidget
