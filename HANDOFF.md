# Handoff: Mercado Preto — etiquetas validadas, produção do Melhor Envio planejada

**Gerado**: 2026-10-22 · **Branch**: `docs/checklist-producao-melhor-envio` · **Status**: etiquetas e rastreio validados no sandbox; produção depende de conta com CNPJ

**Fluxo de branches:** `develop → release → main` (sem alpha/beta). Merge de PR é do usuário.

## Goal

Deixar as etiquetas por loja prontas para produção. Checklist: `docs/deploy/2026-10-22-melhor-envio-producao-checklist.md`.

## Completed

- [x] Etiquetas por loja (PR #85) no servidor de teste, ponta a ponta (pedidos #46/#47).
- [x] Roteiro de teste das etiquetas enviado ao Ailton (20/10, 20:02).
- [x] **Rastreio validado no sandbox:** #46 e #47 em `delivered` com código de rastreio (job das 00:00 UTC de 21/10). O sandbox avança o status sozinho a cada 15 min.
- [x] Rascunho no Gmail corrigindo para o Ailton ("Enviado/Entregue" dá para testar). **Usuário revisa e envia.**
- [x] Decisão: conta única do Mercado Preto; comprador paga o frete cotado e a plataforma absorve a diferença; OAuth fica para depois (sem data de produção).

## Not Yet Done

- [ ] Usuário: enviar o rascunho ao Ailton; merge do PR do checklist; apagar o admin `admin2@mercadopreto.com.br` e a chave Brevo `marketplace-dev`.
- [ ] **Feedback do Ailton (21/10):** remover a conferência de medidas no painel master e criar moderação manual de produto novo ("Em análise" → "Publicado", correções pelo WhatsApp da vendedora, aviso ao publicar). Funcionalidade nova: ciclo brainstorming → spec → plano. Responder o Ailton depois de decidir.
- [ ] Produção: conta Melhor Envio com CNPJ (checklist), número de WhatsApp da loja, `docker-compose.prod.yml`, validação jurídica do Mercado Livre.
- [ ] Depois: app OAuth do Melhor Envio + webhook (quando a conta existir e a espera de 2 h incomodar).

## Failed Approaches (Don't Repeat)

- Chave Brevo do tipo **MCP** não funciona no header `api-key` (401). Use a chave padrão restrita.
- Abrir outro site na mesma aba do checkout perde o estado do checkout. Use outra aba.
- `!` do Claude Code não tem TTY e o servidor não tem `nano`. Para segredos, use `ssh -t … 'read -rsp …; sed -i …'`.
- SSH de leitura no servidor pelo agente é bloqueado pelo classificador. Escreva um script no scratchpad e peça ao usuário `! bash <script>` (comandos inline com `>`/`&` chegam escapados como `&gt;`).
- Merge de PR pelo agente é bloqueado pelo classificador ("Merge Without Review").

## Warnings

- O servidor de teste está em **sandbox**: e-mails vão para `adm@fixsistemas.com` e WhatsApp para `5598984156828` (Ailton).
- `MARKETPLACE_SANDBOX=false` vira tudo junto (Melhor Envio, Mercado Pago, Focus NFe, e-mail, WhatsApp). Ver o checklist.
- O job de rastreio só escreve no log quando há erro ou quando as etiquetas estão desligadas: log vazio é normal.
