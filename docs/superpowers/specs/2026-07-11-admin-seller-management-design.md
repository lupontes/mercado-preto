# Design: Tela de Gestão de Vendedores (Admin)

**Data:** 2026-07-11
**Autor:** Luciano Pontes (via Claude Code)
**Status:** Aprovado, aguardando plano de implementação

## Contexto

O painel administrativo do Medusa (`https://teste.mercadopreto.com.br/app`) usa hoje apenas as telas de fábrica do Medusa (Produtos, Pedidos, Clientes, Promoções, Listas de Preços, Inventário, Configurações). O backend já tem um módulo de vendedor (`seller`) completo, com rotas de API para listar, aprovar e suspender vendedores — mas **não existe nenhuma tela no admin** para essas operações. Hoje, aprovar ou suspender um vendedor só é possível chamando a API diretamente (curl/Postman), o que não é viável para um administrador não-técnico.

Este é o primeiro de quatro subprojetos de UI de admin identificados (vendedores, comissões, payouts, fiscal) — cada um com seu próprio ciclo spec → plano → execução. Este documento cobre **só vendedores**.

### Estado atual do modelo de dados

O enum de status do vendedor é fixo em quatro valores — não existe um status "rejected" separado:

```
model.enum(["pending", "approved", "active", "suspended"]).default("pending")
```

Ciclo de vida real, confirmado no código:
1. Vendedor se cadastra → `pending`
2. Admin aprova (`POST /admin/sellers/:id/approve`, já existe) → `approved`, dispara e-mail via Brevo com link para definir senha
3. Vendedor define senha (`POST /store/sellers/set-password`) → `active` (só então aparece em `/store/sellers`, a listagem pública da loja)
4. Admin pode suspender (`POST /admin/sellers/:id/suspend`, já existe) → `suspended`, com motivo opcional salvo em `rejectionReason`

O service (`SellerModuleService`) já tem os métodos `rejectSeller(id, reason)` (volta para `pending` com motivo) e `activateSeller(id)` (volta para `active`), mas **nenhuma rota de API os expõe hoje** — são código morto até este projeto.

## Decisões

1. **Semântica de "rejeitar":** usa o `rejectSeller()` já existente — volta o vendedor para `pending` com o motivo salvo em `rejectionReason`, permitindo correção e reavaliação. Não introduz um novo valor de enum.
2. **Navegação:** novo item "Vendedores" no menu lateral do admin. A listagem abre **filtrada em "Pendentes" por padrão** (fila de aprovação), com filtro para ver outros status.
3. **Detalhe do vendedor:** só perfil + status + ações. Não inclui lista de produtos do vendedor nesta versão (a rota `/admin/sellers/:id/products` já existe para uma iteração futura).
4. **Notificações:** só a aprovação continua enviando e-mail (comportamento já existente). Rejeição, suspensão e reativação **não** ganham e-mail automático nesta versão — registrado como pendência futura, não esquecido.
5. **Testes:** cobertura tanto de backend quanto de frontend (ver seção Testes).

## Arquitetura

### Backend — duas rotas novas

**`packages/medusa-backend/apps/backend/src/api/admin/sellers/[id]/reject/route.ts`**
```ts
POST /admin/sellers/:id/reject
Body: { reason: string }  // obrigatório, min 1 caractere
```
Segue exatamente o padrão de `suspend/route.ts`: valida com Zod, 404 se o vendedor não existir, chama `sellerService.rejectSeller(id, reason)`, retorna `{ seller }`.

**`packages/medusa-backend/apps/backend/src/api/admin/sellers/[id]/activate/route.ts`**
```ts
POST /admin/sellers/:id/activate
Body: nenhum
```
Segue o padrão de `approve/route.ts`: 404 se não existir, chama `sellerService.activateSeller(id)`, retorna `{ seller }`.

### Frontend — duas rotas novas no admin

**`packages/medusa-backend/apps/backend/src/admin/routes/sellers/page.tsx`** (lista)
- `defineRouteConfig` registra o item "Vendedores" no menu lateral (ícone `BuildingStorefront`, importado de `@medusajs/icons` — confirmado disponível no pacote instalado)
- `DataTable` (`@medusajs/ui`) com colunas: Nome da loja, E-mail, Categoria, Status (badge colorido por status), Data de cadastro
- Filtro de status (select), valor inicial `pending`
- Busca por nome/e-mail
- Clique na linha navega para `/admin/sellers/:id`
- Estado vazio contextual: quando o filtro é `pending` e não há resultados, mensagem "Nenhum vendedor pendente 🎉"; para outros filtros, "Nenhum vendedor encontrado"

**`packages/medusa-backend/apps/backend/src/admin/routes/sellers/[id]/page.tsx`** (detalhe)
- Exibe: nome da loja, nome do responsável, e-mail, telefone, CPF/CNPJ, bio, localização, categoria, badge de status
- Se `rejectionReason` estiver preenchido, exibe o motivo (rotulado conforme o status: "Motivo da rejeição" se `pending`, "Motivo da suspensão" se `suspended`)
- Ações condicionais por status, cada uma via `useMutation` do TanStack Query com `invalidateQueries` no sucesso e toast de resultado:
  - **pending** → botão "Aprovar" (chama approve existente) e botão "Rejeitar" (abre `Prompt` do `@medusajs/ui`, com um `Textarea` dentro de `Prompt.Content` para o motivo, campo obrigatório, chama a rota `reject` nova)
  - **approved** → texto informativo "Aguardando o vendedor definir senha" + botão "Suspender"
  - **active** → botão "Suspender" (`Prompt` com `Textarea` opcional para o motivo, chama `suspend` existente)
  - **suspended** → botão "Reativar" (`Prompt` de confirmação simples, sem campo, chama a rota `activate` nova)

### Dados

Hooks TanStack Query customizados (não existem hooks nativos do Medusa para uma entidade custom como `seller`), usando o `sdk` client do admin para chamar `/admin/sellers*`:
- `useAdminSellers(filters)` — lista
- `useAdminSeller(id)` — detalhe
- `useApproveSeller()`, `useRejectSeller()`, `useSuspendSeller()`, `useActivateSeller()` — mutations

## Testes

**Backend** (Jest, padrão já existente no projeto):
- `src/api/admin/sellers/[id]/reject/__tests__/route.unit.spec.ts` — valida schema (reason obrigatório), 404 quando vendedor não existe, chamada correta ao service, resposta 200 com o seller atualizado
- `src/api/admin/sellers/[id]/activate/__tests__/route.unit.spec.ts` — mesmo padrão, sem validação de body

**Frontend** (infraestrutura nova, não existe hoje para `src/admin/`):
- Adiciona Vitest + `@testing-library/react` + jsdom, escopado a `src/admin/`, com config própria (`src/admin/vitest.config.ts`) separada do Jest do backend
- **Convenção de nome obrigatória: `.test.tsx`, não `.unit.spec.ts`** — o glob do Jest do backend é `**/src/**/__tests__/**/*.unit.spec.[jt]s`, que casaria com arquivos dentro de `src/admin/` se usasse a mesma extensão, rodando o teste de componente React sob o ambiente Node do Jest (sem DOM) e quebrando. Usar `.test.tsx` mantém os dois test runners mutuamente exclusivos por convenção de nome de arquivo.
- `src/admin/routes/sellers/__tests__/page.test.tsx` — lista: filtro inicial é "pending", troca de filtro funciona, estado vazio contextual
- `src/admin/routes/sellers/[id]/__tests__/page.test.tsx` — detalhe: botões corretos aparecem por status, diálogo de rejeição não submete sem motivo, mutations chamam a rota certa (mock do `sdk`)

## Fora de escopo (explícito)

- E-mails automáticos de rejeição/suspensão/reativação (só aprovação envia hoje)
- Lista de produtos do vendedor na tela de detalhe
- Telas de Comissões, Payouts e Fiscal — cada uma é um ciclo spec/plano separado
