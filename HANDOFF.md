# Handoff: Mercado Preto — etiquetas por loja no servidor de teste

**Gerado**: 2026-10-20 ~19:45 BRT · **Branch**: `docs/handoff-2026-10-18` (PR #82) · **Status**: deploy pela metade (backend ok, vitrine não)

**Fluxo de branches:** `develop → release → main` (sem alpha/beta). Merge de PR é do usuário.

## Goal

Ligar no servidor de teste as etiquetas por loja (PR #85, já em `develop`) e rodar o ponta a ponta no sandbox. Spec `docs/superpowers/specs/2026-10-20-etiquetas-por-loja-design.md`; plano `docs/superpowers/plans/2026-10-20-etiquetas-por-loja.md`.

## Completed (20/10)

- [x] Pontos ponta a ponta (compras `1353943231`/`1353946303`), #83 e #84 no servidor.
- [x] E-mail (Brevo: chave restrita, IP autorizado, domínio `mercadopreto.com.br` autenticado; DNS na Locaweb é do Ailton) e WhatsApp (Evolution 2.4 com licença, instância `mercadopreto`, número de teste do usuário). NSG da OCI limpo.
- [x] Ailton avisado das novidades de 20/10 (e-mail + complemento sobre etiquetas).
- [x] PR #85 mesclado. Backend no servidor em `ad05ae1`, com `MELHOR_ENVIO_LABELS_ENABLED=false`. Backup: `~/db-backup-20261020193654.sql.gz` e imagem `mercado-preto-api:oci-bak-20261020193654`.

## Not Yet Done (nesta ordem)

- [ ] **Build da vitrine** no servidor. O usuário interrompeu esse comando. Pergunte antes de rodar: `cd ~/marketplace && source ~/.nvm/nvm.sh && nvm use 22 && pnpm install --frozen-lockfile && cd apps/storefront && pnpm build && pm2 restart storefront`, depois `infra/scripts/smoke-oci.sh teste.mercadopreto.com.br 168.138.148.67` (local). **Até lá o checkout está quebrado:** o backend exige `number`/`district` e a vitrine antiga não envia → 400.
- [ ] **Pedir ao usuário:** o valor de `ADMIN_ALERT_EMAIL` e o CPF/CNPJ da loja "Mulheres de Axé do Brasil" (vazio no banco; sem ele a etiqueta falha com "CPF/CNPJ da loja ausente"). Ou a autorização para usar um CNPJ de teste.
- [ ] Ligar no `.env.oci`: `MELHOR_ENVIO_LABELS_ENABLED=true` e `ADMIN_ALERT_EMAIL=…`; recriar o `medusa`.
- [ ] Ponta a ponta (plano, Task 13 Step 3): compra com LOJA FIX + Axé no sandbox do MP; duas etiquetas geradas; o link abre o PDF **numa aba anônima**; WhatsApp e e-mail chegam ao Ailton; `sellerPayout` sem frete no banco. A compra, a geração, a impressão e o rastreio do Melhor Envio **ainda não foram exercitados**.
- [ ] Atualizar este HANDOFF, avisar o Ailton com o roteiro e apagar `.superpowers/sdd/2026-10-20-etiquetas-por-loja/` (é o ledger da execução; leia as linhas `Ruling:` antes).
- [ ] Usuário: apagar o admin `admin2@mercadopreto.com.br` e a chave Brevo `marketplace-dev`.

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
