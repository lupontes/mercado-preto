import { useState } from "react"
import { useParams } from "react-router-dom"
import {
  Button,
  Container,
  Heading,
  Label,
  Prompt,
  StatusBadge,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import {
  useAdminSeller,
  useApproveSeller,
  useRejectSeller,
  useSuspendSeller,
  useActivateSeller,
  type Seller,
} from "../../../hooks/sellers"

const STATUS_LABELS: Record<Seller["status"], string> = {
  pending: "Pendente",
  approved: "Aprovado",
  active: "Ativo",
  suspended: "Suspenso",
}

const STATUS_COLORS: Record<Seller["status"], "orange" | "blue" | "green" | "red"> = {
  pending: "orange",
  approved: "blue",
  active: "green",
  suspended: "red",
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

function RejectDialog({ sellerId }: { sellerId: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const rejectSeller = useRejectSeller()

  const handleConfirm = () => {
    rejectSeller.mutate(
      { id: sellerId, reason },
      {
        onSuccess: () => {
          toast.success("Vendedor rejeitado")
          setOpen(false)
          setReason("")
        },
        onError: () => toast.error("Não foi possível rejeitar o vendedor"),
      }
    )
  }

  return (
    <Prompt open={open} onOpenChange={setOpen}>
      <Prompt.Trigger asChild>
        <Button variant="danger" size="small">
          Rejeitar
        </Button>
      </Prompt.Trigger>
      <Prompt.Content>
        <Prompt.Header>
          <Prompt.Title>Rejeitar cadastro</Prompt.Title>
          <Prompt.Description>
            O vendedor volta para a fila de pendentes com o motivo abaixo.
          </Prompt.Description>
        </Prompt.Header>
        <div className="px-6 pb-4">
          <Label htmlFor="reject-reason">Motivo</Label>
          <Textarea
            id="reject-reason"
            aria-label="Motivo"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <Prompt.Footer>
          <Prompt.Cancel>Cancelar</Prompt.Cancel>
          <Button
            variant="danger"
            disabled={reason.trim().length === 0}
            onClick={handleConfirm}
          >
            Confirmar rejeição
          </Button>
        </Prompt.Footer>
      </Prompt.Content>
    </Prompt>
  )
}

function SuspendDialog({ sellerId }: { sellerId: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const suspendSeller = useSuspendSeller()

  const handleConfirm = () => {
    suspendSeller.mutate(
      { id: sellerId, reason: reason.trim() || undefined },
      {
        onSuccess: () => {
          toast.success("Vendedor suspenso")
          setOpen(false)
          setReason("")
        },
        onError: () => toast.error("Não foi possível suspender o vendedor"),
      }
    )
  }

  return (
    <Prompt open={open} onOpenChange={setOpen}>
      <Prompt.Trigger asChild>
        <Button variant="danger" size="small">
          Suspender
        </Button>
      </Prompt.Trigger>
      <Prompt.Content>
        <Prompt.Header>
          <Prompt.Title>Suspender vendedor</Prompt.Title>
          <Prompt.Description>
            A loja deixa de aparecer para os clientes até ser reativada.
          </Prompt.Description>
        </Prompt.Header>
        <div className="px-6 pb-4">
          <Label htmlFor="suspend-reason">Motivo (opcional)</Label>
          <Textarea
            id="suspend-reason"
            aria-label="Motivo (opcional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <Prompt.Footer>
          <Prompt.Cancel>Cancelar</Prompt.Cancel>
          <Button variant="danger" onClick={handleConfirm}>
            Confirmar suspensão
          </Button>
        </Prompt.Footer>
      </Prompt.Content>
    </Prompt>
  )
}

function SellerDetailPage() {
  const { id } = useParams()
  const { data } = useAdminSeller(id ?? "")
  const approveSeller = useApproveSeller()
  const activateSeller = useActivateSeller()

  const seller = data?.seller

  if (!seller) {
    return null
  }

  const handleApprove = () => {
    approveSeller.mutate(seller.id, {
      onSuccess: () => toast.success("Vendedor aprovado"),
      onError: () => toast.error("Não foi possível aprovar o vendedor"),
    })
  }

  const handleActivate = () => {
    activateSeller.mutate(seller.id, {
      onSuccess: () => toast.success("Vendedor reativado"),
      onError: () => toast.error("Não foi possível reativar o vendedor"),
    })
  }

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">{seller.name}</Heading>
          <StatusBadge color={STATUS_COLORS[seller.status]}>
            {STATUS_LABELS[seller.status]}
          </StatusBadge>
        </div>
        <div className="flex gap-2">
          {seller.status === "pending" && (
            <>
              <Button size="small" onClick={handleApprove}>
                Aprovar
              </Button>
              <RejectDialog sellerId={seller.id} />
            </>
          )}
          {seller.status === "approved" && <SuspendDialog sellerId={seller.id} />}
          {seller.status === "active" && <SuspendDialog sellerId={seller.id} />}
          {seller.status === "suspended" && (
            <Button size="small" onClick={handleActivate}>
              Reativar
            </Button>
          )}
        </div>
      </div>

      {seller.status === "approved" && (
        <div className="px-6 pb-4">
          <Text className="text-ui-fg-subtle">Aguardando o vendedor definir senha.</Text>
        </div>
      )}

      {seller.rejectionReason && (
        <div className="px-6 pb-4">
          <ProfileField
            label={seller.status === "suspended" ? "Motivo da suspensão" : "Motivo da rejeição"}
            value={seller.rejectionReason}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 px-6 pb-6">
        <ProfileField label="Nome do responsável" value={seller.ownerName} />
        <ProfileField label="E-mail" value={seller.email} />
        <ProfileField label="Telefone" value={seller.phone} />
        <ProfileField label="CPF/CNPJ" value={seller.cpfCnpj} />
        <ProfileField label="Categoria" value={seller.category} />
        <ProfileField label="Localização" value={seller.location} />
        <ProfileField label="Bio" value={seller.bio} />
      </div>
    </Container>
  )
}

export default SellerDetailPage
