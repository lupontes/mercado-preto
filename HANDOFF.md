# Handoff: Mercado Preto — etiquetas por loja no servidor de teste

**Gerado**: 2026-10-20 ~19:45 BRT · **Branch**: `docs/handoff-2026-10-18` (PR #82) · **Status**: etiquetas no ar no servidor de teste, ponta a ponta ok

**Fluxo de branches:** `develop → release → main` (sem alpha/beta). Merge de PR é do usuário.

## Goal

Etiquetas por loja (PR #85) ligadas e testadas no servidor de teste. Spec `docs/superpowers/specs/2026-10-20-etiquetas-por-loja-design.md`; plano `docs/superpowers/plans/2026-10-20-etiquetas-por-loja.md`.

## Completed (20/10)

- [x] Pontos ponta a ponta (compras `1353943231`/`1353946303`), #83 e #84 no servidor.
- [x] E-mail (Brevo: chave restrita, IP autorizado, domínio `mercadopreto.com.br` autenticado; DNS na Locaweb é do Ailton) e WhatsApp (Evolution 2.4 com licença, instância `mercadopreto`, número de teste do usuário). NSG da OCI limpo.
- [x] Ailton avisado das novidades de 20/10 (e-mail + complemento sobre etiquetas).
- [x] PR #85 no servidor (`ad05ae1`, backend + vitrine), com `MELHOR_ENVIO_LABELS_ENABLED=true` e `ADMIN_ALERT_EMAIL=lupontes@gmail.com`. Backup: `~/db-backup-20261020193654.sql.gz` e imagem `mercado-preto-api:oci-bak-20261020193654`. CPF da loja Axé gravado (pedido do usuário).
- [x] **Ponta a ponta das etiquetas** (pagamento `1328493702`): pedidos #46 (Axé, etiqueta R$ 69,81) e #47 (FIX, R$ 32,85) com `generated`; link público com 302 + `no-store` para a impressão do Melhor Envio, sem login; repasse sem frete; e-mails "Nova venda" entregues ao Ailton (Brevo).

## Not Yet Done

- [ ] **Avisar o Ailton** com o roteiro de teste das etiquetas: compra com duas lojas; o link de impressão; o portal (Pedidos → "Imprimir etiqueta"); o painel master (widget "Etiqueta" no pedido). Antes, confirmar com o usuário.
- [ ] **Rastreio real não testado:** o job `shipping-label-tracking` só muda o status quando o Melhor Envio informa a postagem. No sandbox não há postagem real. Acompanhar os pedidos #46/#47 ou simular pelo painel sandbox do Melhor Envio, se houver.

- [ ] Usuário: merge do PR #82 (handoff); apagar o admin `admin2@mercadopreto.com.br` e a chave Brevo `marketplace-dev`.
- [ ] Produção: app OAuth do Melhor Envio (webhooks), número de WhatsApp da loja, `docker-compose.prod.yml`, validação jurídica do Mercado Livre.

## Failed Approaches (Don't Repeat)

- Chave Brevo do tipo **MCP** não funciona no header `api-key` (401). Use a chave padrão restrita. Detalhes no claude-mem.
- Abrir o Brevo ou outro site na mesma aba do checkout perde o estado do checkout. Use outra aba.
- `!` do Claude Code não tem TTY e o servidor não tem `nano`. Para segredos, use `ssh -t … 'read -rsp …; sed -i …'` no terminal do usuário.
- `printUrl` com `mode: "private"`: o link exige login no Melhor Envio. Corrigido para `public`.
- Merge de PR pelo agente é bloqueado pelo classificador ("Merge Without Review").

## Key Decisions

| Decisão | Motivo |
|---|---|
| A plataforma absorve a diferença entre o frete cotado e a etiqueta | O comprador já pagou |
| Rastreio por job a cada 2 h; webhook pronto, sem segredo (responde 503) | Token pessoal não recebe webhook; isso muda no ciclo do app OAuth |
| O frete sai do repasse só com `platform_label` **e** `shipping_service_id` | Pedidos sem etiqueta continuam pagando o frete à loja |
| Uma compra com falha é retomada (`paid`/`meOrderIds`); um `pending` com mais de 15 min é retomado pelo admin, sob a mesma trava | Nunca pagar a etiqueta duas vezes |

## Warnings

- O servidor de teste está em **sandbox**: todo e-mail vai para `adm@fixsistemas.com` e todo WhatsApp para `5598984156828` (Ailton). As mensagens saem do WhatsApp de teste do usuário.
- O `db:migrate` roda sempre o script do Medusa `create-super-admin-role`. Até agora isso não causou problema.
- Backlog das etiquetas: o "Para depois" do PR #85; o próximo ciclo é o app OAuth do Melhor Envio para produção.
- Pendências antigas, ainda abertas: `docker-compose.prod.yml` fora do modelo OCI (a produção vai para outro provedor) e a validação jurídica que pausa o Mercado Livre.
