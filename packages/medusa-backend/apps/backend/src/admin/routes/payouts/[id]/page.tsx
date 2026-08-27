import { useState } from "react"
import { useParams } from "react-router-dom"
import {
  Button,
  Container,
  Heading,
  Prompt,
  StatusBadge,
  Table,
  Text,
  toast,
} from "@medusajs/ui"
import {
  useAdminPayout,
  useProcessPayout,
  useCancelPayout,
  type Payout,
} from "../../../hooks/payouts"

const STATUS_LABELS: Record<Payout["status"], string> = {
  pending: "Pendente",
  processing: "Processando",
  completed: "Pago",
  failed: "Falhou",
  cancelled: "Cancelado",
}

const STATUS_COLORS: Record<Payout["status"], "orange" | "blue" | "green" | "red" | "grey"> = {
  pending: "orange",
  processing: "blue",
  completed: "green",
  failed: "red",
  cancelled: "grey",
}

const PIX_KEY_TYPE_LABELS: Record<string, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  phone: "Telefone",
  random: "Aleatória",
}

const BANK_ACCOUNT_TYPE_LABELS: Record<string, string> = {
  checking: "Conta corrente",
  savings: "Poupança",
}

function formatBRL(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function formatDate(isoDate: string) {
  return new Date(isoDate).toLocaleDateString("pt-BR")
}

function ProfileField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <Text size="small" className="text-ui-fg-subtle">
        {label}
      </Text>
      <Text>{value || "—"}</Text>
    </div>
  )
}

function ProcessDialog({ payoutId }: { payoutId: string }) {
  const [open, setOpen] = useState(false)
  const processPayout = useProcessPayout()

  const handleConfirm = () => {
    processPayout.mutate(payoutId, {
      onSuccess: () => {
        toast.success("Repasse processado")
        setOpen(false)
      },
      onError: () => toast.error("Não foi possível processar o repasse"),
    })
  }

  return (
    <Prompt open={open} onOpenChange={setOpen}>
      <Prompt.Trigger asChild>
        <Button size="small">Processar</Button>
      </Prompt.Trigger>
      <Prompt.Content>
        <Prompt.Header>
          <Prompt.Title>Processar repasse</Prompt.Title>
          <Prompt.Description>
            Confirme que a transferência bancária/PIX já foi feita para o vendedor antes de continuar.
          </Prompt.Description>
        </Prompt.Header>
        <Prompt.Footer>
          <Prompt.Cancel>Cancelar</Prompt.Cancel>
          <Button onClick={handleConfirm}>Já fiz a transferência</Button>
        </Prompt.Footer>
      </Prompt.Content>
    </Prompt>
  )
}

function CancelDialog({ payoutId }: { payoutId: string }) {
  const [open, setOpen] = useState(false)
  const cancelPayout = useCancelPayout()

  const handleConfirm = () => {
    cancelPayout.mutate(payoutId, {
      onSuccess: () => {
        toast.success("Repasse cancelado")
        setOpen(false)
      },
      onError: () => toast.error("Não foi possível cancelar o repasse"),
    })
  }

  return (
    <Prompt open={open} onOpenChange={setOpen}>
      <Prompt.Trigger asChild>
        <Button variant="danger" size="small">
          Cancelar
        </Button>
      </Prompt.Trigger>
      <Prompt.Content>
        <Prompt.Header>
          <Prompt.Title>Cancelar repasse</Prompt.Title>
          <Prompt.Description>
            As comissões vinculadas voltam a ficar pendentes, livres para um repasse futuro.
          </Prompt.Description>
        </Prompt.Header>
        <Prompt.Footer>
          <Prompt.Cancel>Voltar</Prompt.Cancel>
          <Button variant="danger" onClick={handleConfirm}>
            Confirmar cancelamento
          </Button>
        </Prompt.Footer>
      </Prompt.Content>
    </Prompt>
  )
}

function PayoutDetailPage() {
  const { id } = useParams()
  const { data } = useAdminPayout(id ?? "")

  const payout = data?.payout
  const seller = data?.seller
  const commissions = data?.commissions ?? []

  if (!payout) {
    return null
  }

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">{payout.sellerName}</Heading>
          <StatusBadge color={STATUS_COLORS[payout.status]}>
            {STATUS_LABELS[payout.status]}
          </StatusBadge>
        </div>
        {payout.status === "pending" && (
          <div className="flex gap-2">
            <ProcessDialog payoutId={payout.id} />
            <CancelDialog payoutId={payout.id} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 px-6 pb-6">
        <ProfileField label="Valor" value={formatBRL(payout.amount)} />
        <ProfileField
          label="Período"
          value={`${formatDate(payout.periodStart)} – ${formatDate(payout.periodEnd)}`}
        />
        <ProfileField label="Notas" value={payout.notes} />
        <ProfileField
          label="Processado em"
          value={payout.processedAt ? formatDate(payout.processedAt) : null}
        />
      </div>

      {seller && (
        <div className="border-t border-ui-border-base px-6 py-6">
          <Text weight="plus" className="mb-4">
            Dados bancários / PIX
          </Text>
          <div className="grid grid-cols-2 gap-4">
            <ProfileField label="Banco" value={seller.bankName} />
            <ProfileField label="Agência" value={seller.bankAgency} />
            <ProfileField label="Conta" value={seller.bankAccount} />
            <ProfileField
              label="Tipo de conta"
              value={seller.bankAccountType ? BANK_ACCOUNT_TYPE_LABELS[seller.bankAccountType] : null}
            />
            <ProfileField label="Chave PIX" value={seller.pixKey} />
            <ProfileField
              label="Tipo de chave PIX"
              value={seller.pixKeyType ? PIX_KEY_TYPE_LABELS[seller.pixKeyType] : null}
            />
          </div>
        </div>
      )}

      <div className="border-t border-ui-border-base px-6 py-6">
        <Text weight="plus" className="mb-4">
          Comissões vinculadas
        </Text>
        {commissions.length === 0 ? (
          <Text className="text-ui-fg-subtle">Nenhuma comissão vinculada.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Pedido</Table.HeaderCell>
                <Table.HeaderCell>Valor bruto</Table.HeaderCell>
                <Table.HeaderCell>Repasse</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {commissions.map((commission) => (
                <Table.Row key={commission.id}>
                  <Table.Cell>{commission.orderId}</Table.Cell>
                  <Table.Cell>{formatBRL(commission.grossAmount)}</Table.Cell>
                  <Table.Cell>{formatBRL(commission.sellerPayout)}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </div>
    </Container>
  )
}

export default PayoutDetailPage
