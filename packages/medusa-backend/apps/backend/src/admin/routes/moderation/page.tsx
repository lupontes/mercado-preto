import { useNavigate } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ShieldCheck } from "@medusajs/icons"
import { Container, Heading, StatusBadge, Table, Text } from "@medusajs/ui"
import { useModerationQueue } from "../../hooks/moderation"

const KIND_LABELS = { new: "Novo", change: "Alteração" } as const

// Fixed time zone so the date does not shift for admins outside Brazil.
const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })

function ModerationPage() {
  const navigate = useNavigate()
  const { data, isLoading, isError } = useModerationQueue()
  const items = data?.items ?? []

  return (
    <Container className="p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Produtos em análise</Heading>
      </div>

      {isError && (
        <div className="px-6 py-8 text-center">
          <Text>Não foi possível carregar a fila. Tente novamente.</Text>
        </div>
      )}

      {!isError && !isLoading && items.length === 0 && (
        <div className="px-6 py-8 text-center">
          <Text>Nenhum produto aguardando análise.</Text>
        </div>
      )}

      {items.length > 0 && (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Foto</Table.HeaderCell>
              <Table.HeaderCell>Título</Table.HeaderCell>
              <Table.HeaderCell>Loja</Table.HeaderCell>
              <Table.HeaderCell>Tipo</Table.HeaderCell>
              <Table.HeaderCell>Enviado em</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {items.map((item) => (
              <Table.Row
                key={item.id}
                className="cursor-pointer"
                onClick={() => navigate(`/products/${item.id}`)}
              >
                <Table.Cell>
                  {item.thumbnail ? (
                    <img src={item.thumbnail} alt="" className="h-10 w-10 rounded object-cover" />
                  ) : (
                    "—"
                  )}
                </Table.Cell>
                <Table.Cell>{item.title}</Table.Cell>
                <Table.Cell>{item.sellerName ?? "—"}</Table.Cell>
                <Table.Cell>
                  <StatusBadge color={item.kind === "new" ? "blue" : "orange"}>
                    {KIND_LABELS[item.kind]}
                  </StatusBadge>
                </Table.Cell>
                <Table.Cell>{formatDate(item.submittedAt)}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Produtos em análise",
  icon: ShieldCheck,
})

export default ModerationPage
