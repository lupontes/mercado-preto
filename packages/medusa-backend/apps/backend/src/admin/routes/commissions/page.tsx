import { useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { CurrencyDollar } from "@medusajs/icons"
import { Container, Heading, Select, StatusBadge, Table, Text } from "@medusajs/ui"
import { useAdminCommissions } from "../../hooks/commissions"
import { useAdminSellers } from "../../hooks/sellers"

const PAGE_SIZE = 20
const ALL_SELLERS = "all"
const ALL_STATUSES = "all"

const STATUS_LABELS: Record<"pending" | "paid", string> = {
  pending: "Pendente",
  paid: "Pago",
}

const STATUS_COLORS: Record<"pending" | "paid", "orange" | "green"> = {
  pending: "orange",
  paid: "green",
}

function formatBRL(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function TotalCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1 rounded-lg border border-ui-border-base p-4">
      <Text size="small" className="text-ui-fg-subtle">
        {label}
      </Text>
      <Text size="xlarge" weight="plus">
        {formatBRL(value)}
      </Text>
    </div>
  )
}

function CommissionsPage() {
  const [sellerId, setSellerId] = useState(ALL_SELLERS)
  const [status, setStatus] = useState(ALL_STATUSES)
  const [pageIndex, setPageIndex] = useState(0)

  const { data: sellersData } = useAdminSellers({})
  const sellers = sellersData?.sellers ?? []

  const filters: { seller_id?: string; status?: string; limit: number; offset: number } = {
    limit: PAGE_SIZE,
    offset: pageIndex * PAGE_SIZE,
  }
  if (sellerId !== ALL_SELLERS) filters.seller_id = sellerId
  if (status !== ALL_STATUSES) filters.status = status

  const { data, isLoading, isError } = useAdminCommissions(filters)
  const commissions = data?.commissions ?? []
  const totals = data?.totals ?? { grossAmount: 0, commissionAmount: 0, sellerPayout: 0 }
  const count = data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Comissões</Heading>
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
            <Select.Trigger className="w-40">
              <Select.Value placeholder="Todos" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value={ALL_STATUSES}>Todos</Select.Item>
              <Select.Item value="pending">Pendente</Select.Item>
              <Select.Item value="paid">Pago</Select.Item>
            </Select.Content>
          </Select>
        </div>
      </div>

      <div className="flex gap-4 px-6 pb-4">
        <TotalCard label="GMV bruto" value={totals.grossAmount} />
        <TotalCard label="Comissão retida" value={totals.commissionAmount} />
        <TotalCard label="Repasse aos vendedores" value={totals.sellerPayout} />
      </div>

      {isError && (
        <div className="px-6 py-8 text-center">
          <Text>Não foi possível carregar as comissões. Tente novamente.</Text>
        </div>
      )}

      {!isError && !isLoading && commissions.length === 0 && (
        <div className="px-6 py-8 text-center">
          <Text>Nenhuma comissão encontrada.</Text>
        </div>
      )}

      {commissions.length > 0 && (
        <>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Pedido</Table.HeaderCell>
                <Table.HeaderCell>Vendedor</Table.HeaderCell>
                <Table.HeaderCell>Valor bruto</Table.HeaderCell>
                <Table.HeaderCell>Comissão</Table.HeaderCell>
                <Table.HeaderCell>Repasse</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {commissions.map((commission) => (
                <Table.Row key={commission.id}>
                  <Table.Cell>{commission.orderId}</Table.Cell>
                  <Table.Cell>{commission.sellerName}</Table.Cell>
                  <Table.Cell>{formatBRL(commission.grossAmount)}</Table.Cell>
                  <Table.Cell>{formatBRL(commission.commissionAmount)}</Table.Cell>
                  <Table.Cell>{formatBRL(commission.sellerPayout)}</Table.Cell>
                  <Table.Cell>
                    <StatusBadge color={STATUS_COLORS[commission.status]}>
                      {STATUS_LABELS[commission.status]}
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
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Comissões",
  icon: CurrencyDollar,
})

export default CommissionsPage
