# Manual de Teste — Tela de Repasses (Admin)

**Feature:** Admin Payouts Management (branch `feature/admin-payouts-management`)
**Referência:** `docs/superpowers/plans/2026-07-11-admin-payouts-management.md`, Task 12 - Step 5

## Objetivo

Validar manualmente, num navegador, o fluxo completo de criação, processamento, cancelamento e vínculo automático de repasses (payouts) a vendedores, complementando os testes automatizados (Jest 234/234, Vitest 38/38 — já verificados).

## Pré-requisitos

1. Serviços locais no ar: Postgres, Redis, Meilisearch.
2. A partir de `packages/medusa-backend/apps/backend`:
   ```bash
   npx medusa start
   ```
3. Um usuário admin já existente para login em `/app`.
4. Pelo menos um vendedor com comissões (`commission`) pendentes reais no banco — se não houver, gere via um pedido de teste com pagamento capturado, ou insira registros de teste diretamente no banco.

## Passo a passo

### 1. Acesso básico
- Faça login em `/app` como admin.
- Confirme que **"Repasses"** aparece na sidebar, logo abaixo de "Comissões".
- Abra a tela de Repasses — confirme que carrega com o filtro **"Pendente"** pré-selecionado.

### 2. Criação de um repasse válido
- Clique em **"+ Novo repasse"**.
- Selecione um vendedor que tenha comissões pendentes reais.
- Confirme que o período (`periodStart`/`periodEnd`) é sugerido automaticamente e que o **valor calculado** aparece na prévia antes de confirmar.

### 3. Bloqueio da janela de maturação (5 dias)
- Tente escolher um período cujo fim (`periodEnd`) seja mais recente que **5 dias atrás**.
- Confirme que a criação é bloqueada com mensagem clara na UI.
- Confirme também via `curl` direto (deve retornar `400`):
  ```bash
  curl -i -X POST https://<host>/admin/payouts \
    -H "Authorization: Bearer <TOKEN_ADMIN>" \
    -H "Content-Type: application/json" \
    -d '{"sellerId": "<SELLER_ID>", "periodStart": "<DATA_INICIO>", "periodEnd": "<HOJE_MENOS_1_DIA>"}'
  ```

### 4. Criação efetiva
- Crie um repasse válido (período maturado, vendedor com comissões pendentes).
- Confirme que ele aparece na lista com status **"Pendente"**.
- Na tela de Comissões, confirme que as comissões correspondentes agora têm `payoutId` setado (via query direta no banco, se necessário), mas continuam com status **"Pendente"** (só viram "Pago" quando o repasse for processado).

### 5. Detalhe do repasse
- Abra o detalhe do repasse recém-criado.
- Confirme que os **dados bancários/PIX** do vendedor aparecem corretamente.
- Confirme que a lista de comissões vinculadas está correta.

### 6. Processamento
- Clique em **"Processar"**, confirme no dialog.
- Confirme que o status muda para **"Pago"**.
- Na tela de Comissões, confirme que as comissões vinculadas a esse repasse agora aparecem como **"Pago"**.

### 7. Cancelamento
- Crie um **segundo repasse** para outro vendedor.
- Cancele-o pelo botão **"Cancelar"**.
- Confirme que o status vira **"Cancelado"**.
- Confirme que as comissões que estavam vinculadas a ele voltam a aparecer como **"Pendente"**, sem `payoutId`, na tela de Comissões.

### 8. Vínculo bidirecional (ponta a ponta) — o caso mais importante para validar manualmente
Este é o cenário que simula um pagamento confirmado com atraso, depois que o repasse do período já foi criado:

1. Crie um repasse **pendente** para um vendedor (sem processá-lo ainda).
2. Insira diretamente no banco uma nova `Commission` com status `pending`, para o **mesmo vendedor**, com `created_at` dentro do período (`periodStart`/`periodEnd`) desse repasse pendente.
3. Dispare o subscriber `commission-on-payment` manualmente, ou aguarde o próximo evento real de `order.payment_captured`.
4. Confirme via query no banco que:
   - a nova comissão aparece automaticamente com `payoutId` setado (vinculada ao repasse pendente);
   - o campo `amount` do repasse foi **incrementado** no valor dessa comissão.
5. Processe o repasse e confirme que essa comissão tardia também vira **"Pago"**.

## Critério de sucesso

Todos os passos acima funcionam sem erros no console do navegador, e o comportamento observado é consistente com o que já foi verificado nos testes automatizados (backend: `src/subscribers/__tests__/commission-on-payment.unit.spec.ts`; ver ledger de execução em `.superpowers/sdd/progress.md` para o detalhamento task a task).

## Se algo falhar

Reporte: passo exato onde falhou, mensagem de erro (console do navegador + rede, se houver), e o estado do banco no momento (query relevante). Não é necessário abrir uma issue formal — encaminhar essas informações para quem escreveu a feature já é suficiente para reproduzir e corrigir.
