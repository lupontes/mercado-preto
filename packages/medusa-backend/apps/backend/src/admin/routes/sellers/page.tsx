import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { BuildingStorefront } from "@medusajs/icons"
import { Container, Heading, Select, StatusBadge, Table, Text } from "@medusajs/ui"
import { useAdminSellers, type Seller } from "../../hooks/sellers"

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

const ALL_STATUSES = "all"

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "pending", label: "Pendentes" },
  { value: "approved", label: "Aprovados" },
  { value: "active", label: "Ativos" },
  { value: "suspended", label: "Suspensos" },
  { value: ALL_STATUSES, label: "Todos" },
]

function SellersPage() {
  const [status, setStatus] = useState("pending")
  const navigate = useNavigate()
  const { data, isLoading, isError } = useAdminSellers(status === ALL_STATUSES ? {} : { status })

  const sellers = data?.sellers ?? []

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Vendedores</Heading>
        <Select value={status} onValueChange={setStatus}>
          <Select.Trigger className="w-48">
            <Select.Value placeholder="Filtrar por status" />
          </Select.Trigger>
          <Select.Content>
            {STATUS_FILTERS.map((filter) => (
              <Select.Item key={filter.value} value={filter.value}>
                {filter.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>

      {isError && (
        <div className="px-6 py-8 text-center">
          <Text>Não foi possível carregar os vendedores. Tente novamente.</Text>
        </div>
      )}

      {!isError && !isLoading && sellers.length === 0 && (
        <div className="px-6 py-8 text-center">
          <Text>
            {status === "pending" ? "Nenhum vendedor pendente 🎉" : "Nenhum vendedor encontrado"}
          </Text>
        </div>
      )}

      {sellers.length > 0 && (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Nome da loja</Table.HeaderCell>
              <Table.HeaderCell>E-mail</Table.HeaderCell>
              <Table.HeaderCell>Categoria</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {sellers.map((seller) => (
              <Table.Row
                key={seller.id}
                className="cursor-pointer"
                onClick={() => navigate(`/sellers/${seller.id}`)}
              >
                <Table.Cell>{seller.name}</Table.Cell>
                <Table.Cell>{seller.email}</Table.Cell>
                <Table.Cell>{seller.category ?? "—"}</Table.Cell>
                <Table.Cell>
                  <StatusBadge color={STATUS_COLORS[seller.status]}>
                    {STATUS_LABELS[seller.status]}
                  </StatusBadge>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Vendedores",
  icon: BuildingStorefront,
})

export default SellersPage
