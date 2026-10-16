import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Button, Container, Heading, StatusBadge, Text, toast } from "@medusajs/ui"
import type { AdminProduct, DetailWidgetProps } from "@medusajs/framework/types"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../lib/sdk"
import { PACKAGE_SIZE_LABELS, type PackageSize } from "../../utils/package-size"

const ProductPackageReviewWidget = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const queryClient = useQueryClient()
  const approve = useMutation({
    mutationFn: () =>
      sdk.client.fetch(`/admin/products/${data.id}/package-review`, { method: "POST", body: { status: "approved" } }),
    onSuccess: () => {
      toast.success("Medidas conferidas")
      queryClient.invalidateQueries()
    },
  })

  const size = data.metadata?.package_size as PackageSize | undefined
  const review = data.metadata?.package_review as string | undefined
  // Imported products carry real measures and a review flag but no size
  // choice; the team still has to see and approve them.
  if (!size && !review) return null
  const v = (data.variants ?? [])[0] as any

  return (
    <Container className="flex flex-col gap-3 px-6 py-4">
      <div className="flex items-center justify-between">
        <Heading level="h2">Embalagem</Heading>
        {review === "pending" ? (
          <StatusBadge color="orange">Medidas a conferir</StatusBadge>
        ) : review === "approved" ? (
          <StatusBadge color="green">Conferidas</StatusBadge>
        ) : null}
      </div>
      <Text>{size ? PACKAGE_SIZE_LABELS[size] ?? size : "Medidas importadas"}</Text>
      {v?.length ? (
        <Text size="small" className="text-ui-fg-subtle">{`${v.length} × ${v.width} × ${v.height} cm · ${v.weight} kg`}</Text>
      ) : null}
      {review === "pending" && (
        <Button size="small" variant="secondary" isLoading={approve.isPending} onClick={() => approve.mutate()}>
          Medidas conferidas
        </Button>
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({ zone: "product.details.side.before" })

export default ProductPackageReviewWidget
