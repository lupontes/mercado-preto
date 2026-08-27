import { useEffect, useState } from "react"
import { Button, FocusModal, Input, Label, Select, Text, toast } from "@medusajs/ui"
import { useAdminSellers } from "../../hooks/sellers"
import { useAdminPayoutPreview, useCreatePayout } from "../../hooks/payouts"

function toDateInputValue(iso: string) {
  return iso.slice(0, 10)
}

function toStartOfDayIso(dateInputValue: string) {
  return new Date(`${dateInputValue}T00:00:00.000Z`).toISOString()
}

export function CreatePayoutModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [sellerId, setSellerId] = useState("")
  const [periodStart, setPeriodStart] = useState("")
  const [periodEnd, setPeriodEnd] = useState("")

  const { data: sellersData } = useAdminSellers({})
  const sellers = sellersData?.sellers ?? []

  const previewPeriodStart = periodStart ? toStartOfDayIso(periodStart) : undefined
  const previewPeriodEnd = periodEnd ? toStartOfDayIso(periodEnd) : undefined
  const { data: preview } = useAdminPayoutPreview(sellerId, previewPeriodStart, previewPeriodEnd)
  const createPayout = useCreatePayout()

  useEffect(() => {
    if (preview && !periodStart && !periodEnd) {
      setPeriodStart(toDateInputValue(preview.periodStart))
      setPeriodEnd(toDateInputValue(preview.periodEnd))
    }
  }, [preview, periodStart, periodEnd])

  const handleSellerChange = (value: string) => {
    setSellerId(value)
    setPeriodStart("")
    setPeriodEnd("")
  }

  const handleClose = () => {
    onOpenChange(false)
    setSellerId("")
    setPeriodStart("")
    setPeriodEnd("")
  }

  const handleConfirm = () => {
    createPayout.mutate(
      {
        sellerId,
        periodStart: toStartOfDayIso(periodStart),
        periodEnd: toStartOfDayIso(periodEnd),
      },
      {
        onSuccess: () => {
          toast.success("Repasse criado")
          handleClose()
        },
        onError: () => toast.error("Não foi possível criar o repasse"),
      }
    )
  }

  const amount = preview?.amount ?? 0
  const canSubmit = !!sellerId && !!periodStart && !!periodEnd && amount > 0

  return (
    <FocusModal open={open} onOpenChange={onOpenChange}>
      <FocusModal.Content>
        <FocusModal.Header>
          <Button size="small" disabled={!canSubmit} onClick={handleConfirm}>
            Criar repasse
          </Button>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col gap-4 p-6">
          <div>
            <Select value={sellerId} onValueChange={handleSellerChange}>
              <Select.Trigger>
                <Select.Value placeholder="Selecione o vendedor" />
              </Select.Trigger>
              <Select.Content>
                {sellers.map((seller) => (
                  <Select.Item key={seller.id} value={seller.id}>
                    {seller.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
          <div className="flex gap-4">
            <div>
              <Label htmlFor="payout-period-start">Início do período</Label>
              <Input
                id="payout-period-start"
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="payout-period-end">Fim do período</Label>
              <Input
                id="payout-period-end"
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
              />
            </div>
          </div>
          {sellerId && periodStart && periodEnd && (
            <Text>
              Valor calculado: {(amount / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              {amount <= 0 && " — nenhuma comissão pendente neste período."}
            </Text>
          )}
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}
