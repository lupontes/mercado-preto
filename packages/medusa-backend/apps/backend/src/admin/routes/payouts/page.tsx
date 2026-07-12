import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowUpDown } from "@medusajs/icons"
import { Button, Container, Heading, Select, StatusBadge, Table, Text } from "@medusajs/ui"
import { useAdminPayouts, type Payout } from "../../hooks/payouts"
import { useAdminSellers } from "../../hooks/sellers"
import { CreatePayoutModal } from "./create-payout-modal"

const PAGE_SIZE = 20
const ALL_SELLERS = "all"
const ALL_STATUSES = "all"

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

function formatBRL(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function formatDate(isoDate: string) {
  return new Date(isoDate).toLocaleDateString("pt-BR")
}

function TotalCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 rounded-lg border border-ui-border-base p-4">
      <Text size="small" className="text-ui-fg-subtle">
        {label}
      </Text>
      <Text size="xlarge" weight="plus">
        {value}
      </Text>
    </div>
  )
}

function PayoutsPage() {
  const [sellerId, setSellerId] = useState(ALL_SELLERS)
  const [status, setStatus] = useState("pending")
  const [pageIndex, setPageIndex] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const navigate = useNavigate()

  const { data: sellersData } = useAdminSellers({})
  const sellers = sellersData?.sellers ?? []

  const filters: { seller_id?: string; status?: string; limit: number; offset: number } = {
    limit: PAGE_SIZE,
    offset: pageIndex * PAGE_SIZE,
  }
  if (sellerId !== ALL_SELLERS) filters.seller_id = sellerId
  if (status !== ALL_STATUSES) filters.status = status

  const { data, isLoading, isError } = useAdminPayouts(filters)
  const payouts = data?.payouts ?? []
  const total = data?.total ?? 0
  const count = data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Repasses</Heading>
        <div className="flex gap-2">
          <Select
            value={sellerId}
            onValueChange={(value) => {
              setSellerId(value)
              setPageIndex(0)
            }}
          >
            <Select.Trigger className="w-56">
              <Select.Value placeholder="Todos os vendedores" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value={ALL_SELLERS}>Todos os vendedores</Select.Item>
              {sellers.map((seller) => (
                <Select.Item key={seller.id} value={seller.id}>
                  {seller.name}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value)
              setPageIndex(0)
            }}
          >
            <Select.Trigger className="w-44">
              <Select.Value placeholder="Status" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value={ALL_STATUSES}>Todos</Select.Item>
              <Select.Item value="pending">Pendente</Select.Item>
              <Select.Item value="completed">Pago</Select.Item>
              <Select.Item value="cancelled">Cancelado</Select.Item>
            </Select.Content>
          </Select>
          <Button size="small" onClick={() => setCreateOpen(true)}>
            + Novo repasse
          </Button>
        </div>
      </div>

      <div className="flex gap-4 px-6 pb-4">
        <TotalCard label="Valor total (filtro atual)" value={formatBRL(total)} />
        <TotalCard label="Quantidade de repasses" value={String(count)} />
      </div>

      {isError && (
        <div className="px-6 py-8 text-center">
          <Text>Não foi possível carregar os repasses. Tente novamente.</Text>
        </div>
      )}

      {!isError && !isLoading && payouts.length === 0 && (
        <div className="px-6 py-8 text-center">
          <Text>Nenhum repasse encontrado.</Text>
        </div>
      )}

      {payouts.length > 0 && (
        <>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Vendedor</Table.HeaderCell>
                <Table.HeaderCell>Valor</Table.HeaderCell>
                <Table.HeaderCell>Período</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {payouts.map((payout) => (
                <Table.Row
                  key={payout.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/payouts/${payout.id}`)}
                >
                  <Table.Cell>{payout.sellerName}</Table.Cell>
                  <Table.Cell>{formatBRL(payout.amount)}</Table.Cell>
                  <Table.Cell>
                    {formatDate(payout.periodStart)} – {formatDate(payout.periodEnd)}
                  </Table.Cell>
                  <Table.Cell>
                    <StatusBadge color={STATUS_COLORS[payout.status]}>
                      {STATUS_LABELS[payout.status]}
                    </StatusBadge>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
          <Table.Pagination
            count={count}
            pageSize={PAGE_SIZE}
            pageIndex={pageIndex}
            pageCount={pageCount}
            canPreviousPage={pageIndex > 0}
            canNextPage={pageIndex < pageCount - 1}
            previousPage={() => setPageIndex((p) => Math.max(0, p - 1))}
            nextPage={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))}
          />
        </>
      )}

      <CreatePayoutModal open={createOpen} onOpenChange={setCreateOpen} />
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Repasses",
  icon: ArrowUpDown,
})

export default PayoutsPage
