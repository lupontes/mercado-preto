# Moderação de produtos — design

**Data:** 2026-10-22 · **Origem:** feedback do Ailton (gerente do marketplace) em 21/10,
depois dos testes de 20/10.

## Por quê

O sucesso do Mercado Preto depende da vitrine ter boa aparência sem dar trabalho às
vendedoras. O Ailton e os gestores do marketplace querem revisar à mão cada produto
antes de ele ser vendido, e falar com a vendedora pelo WhatsApp quando algo estiver
errado. O problema mais comum esperado é **foto ruim**.

Hoje a vendedora escolhe "Publicado" no portal e o produto vai direto para a vitrine.
Edições também entram na hora.

## Objetivos

1. Produto novo só aparece na vitrine depois que um gestor aprova.
2. Edição de produto já publicado também passa por aprovação, **sem tirar o produto
   da vitrine**: a versão antiga continua à venda até a nova ser aprovada.
3. O gestor vê numa lista o que espera análise, aprova com um clique e pode trocar a
   foto ele mesmo.
4. Ao aprovar, a vendedora é avisada de que o produto (ou a alteração) está à venda.
5. Sai a conferência de medidas ("Medidas a conferir"), que o Ailton achou
   desnecessária.

## Não-objetivos

- Recusa formal com motivo, estados "Rejeitado" ou fluxo de correção dentro da
  plataforma. As correções são combinadas pelo WhatsApp; o produto fica parado
  "Em análise" até ser aprovado.
- Mensagens de WhatsApp enviadas pela plataforma com as instruções do gestor. A
  conversa é do gestor, no WhatsApp dele.
- Revisar os produtos que já estão publicados hoje.
- Mudar o importador da Nuvemshop (é executado pela equipe e publica direto).

## Anti-objetivos (falha mesmo funcionando)

- Um produto publicado sumir da vitrine porque a vendedora editou o preço ou a foto.
- Uma edição pendente aparecer na vitrine antes da aprovação.
- A vendedora não entender em que situação o produto está.
- Dar mais passos à vendedora do que hoje.

## Decisões do usuário (22/10)

| Decisão | Detalhe |
|---|---|
| Quem aprova | Gestores do marketplace: qualquer admin do painel master. O Ailton é o gerente. |
| Problema encontrado | O gestor avisa a vendedora pelo WhatsApp e a aprovação fica parada. |
| Foto | O gestor pode trocar a foto ele mesmo. |
| Edição de produto publicado | Volta para aprovação; a versão antiga fica à venda até a nova ser aprovada. |
| Aviso | Na aprovação, a vendedora recebe a comunicação de que o produto está à venda. |
| Produtos já publicados | Continuam publicados, sem análise. |
| Produto aprovado tirado da vitrine | Volta sem nova análise. |
| Aviso aos gestores | Sim, quando chega produto ou alteração para analisar. |

## Como funciona

### Situações do produto (visão da vendedora)

| Situação no portal | Status Medusa | Na vitrine? |
|---|---|---|
| Rascunho | `draft` | Não |
| Em análise | `proposed` | Não |
| Publicado | `published` | Sim |
| Publicado · alteração em análise | `published` + `metadata.pending_changes` | Sim, versão aprovada |
| Rascunho (já aprovado), com ou sem alteração em análise | `draft` + `metadata.approved_at` | Não |

O status `proposed` já existe no Medusa e a vitrine, a busca, o sitemap e a rota de
produtos por loja já filtram `published`. **[decisão do assistente]**

### Portal da vendedora

- **Cadastro:** o seletor "Visibilidade" (Rascunho / Publicado) passa a ser
  Rascunho / **Enviar para análise**. A API da vendedora não aceita mais
  `published`; "Enviar para análise" grava `proposed`.
- **Edição de produto nunca aprovado** (rascunho ou em análise): grava direto no
  produto, como hoje. Um produto em análise continua em análise.
- **Edição de produto já aprovado:** a API **não** altera o produto. Grava os campos
  alterados em `metadata.pending_changes` (com `submittedAt`), e o portal mostra
  "Alteração em análise". Nova edição antes da aprovação substitui a pendente
  (a vendedora vê e edita sempre a versão mais recente: a pendente, se houver).
  **[decisão do assistente]**
- **Tirar da vitrine** (publicado → rascunho) continua imediato, sem aprovação.
  **[decisão do assistente]**
- **Produto já aprovado volta sem nova análise** (decisão do usuário). O produto
  guarda a marca `metadata.approved_at` na primeira aprovação. Os produtos já
  publicados hoje e os importados da Nuvemshop contam como aprovados (migração que
  grava `approved_at` nos `published`, e o importador grava a marca).
  - Rascunho com `approved_at`: o seletor oferece Rascunho / **Publicar**, e
    "Publicar" volta para `published` na hora.
  - Rascunho sem `approved_at`: o seletor oferece Rascunho / **Enviar para análise**.
  - **Edição de produto já aprovado vai sempre para `pending_changes`**, esteja ele
    publicado ou em rascunho. Assim, esconder, editar e publicar de novo não pula a
    análise: volta à vitrine a versão aprovada, com a alteração em análise.
    **[decisão do assistente]**
- A lista de produtos mostra a situação com os rótulos da tabela acima.

Campos que vão para aprovação: todos os que a vendedora edita hoje (título,
descrição, preço, foto, categoria, tamanho e medidas da embalagem).
**[decisão do assistente]**

### Painel master

- **Página "Produtos em análise"** (rota de admin nova): lista os produtos
  `proposed` e os publicados com `pending_changes`, do mais antigo para o mais novo,
  com foto, título, loja, tipo (novo / alteração) e data de envio.
- **Quadro no produto** (widget, onde hoje fica "Medidas a conferir"):
  - produto novo: botão **Aprovar e publicar**;
  - alteração pendente: mostra antes → depois de cada campo alterado e o botão
    **Aprovar alteração**, que aplica os campos no produto e limpa
    `pending_changes`;
  - link **Falar com a vendedora no WhatsApp** (`wa.me` com o telefone da loja),
    para o gestor mandar as instruções. **[decisão do assistente]**
- **Trocar a foto:** em produto novo, pelo editor de mídia nativo do Medusa Admin
  (já liberado). Em alteração pendente, o gestor aprova e depois troca a foto no
  editor nativo; o painel não edita a versão pendente. **[decisão do assistente]**
  A vitrine mostra só o `thumbnail`: o quadro orienta o gestor a marcar a foto nova
  como miniatura.

### Aviso à vendedora

Na aprovação (produto novo ou alteração), WhatsApp + e-mail, seguindo o padrão de
`utils/shipping-label-notify.ts`: "Seu produto *X* foi aprovado e já está à venda no
Mercado Preto", com o link do produto na vitrine. No servidor de teste, as mensagens
vão para o Ailton, como as demais.

O aviso de produto novo sai de um subscriber de `product.updated` que detecta a
passagem `proposed → published`. Assim, aprovar pelo seletor de status nativo do
Medusa Admin também avisa a vendedora. O aviso de alteração aprovada sai da rota de
aprovação, único caminho que aplica `pending_changes`. **[decisão do assistente]**

### Aviso aos gestores

Os gestores são avisados a cada envio (decisão do usuário): quando um produto vai
para "Em análise" e quando uma alteração entra em `pending_changes` (inclusive ao
substituir uma pendente). E-mail para `ADMIN_ALERT_EMAIL`, no padrão de
`alertTeamLabelFailed`, e WhatsApp para um número de gestor configurado em variável
de ambiente nova (opcional; sem ela, só e-mail). A mensagem traz loja, produto,
tipo (novo / alteração) e o link para o produto no painel master.
**[decisão do assistente: canais e frequência por envio]**

### O que sai

- Rota `api/admin/products/[id]/package-review`, widget
  `admin/widgets/product-package-review.tsx`, a gravação de
  `metadata.package_review` em `api/seller/products/package.ts` e os testes
  correspondentes. `package_size` e as medidas continuam (são usadas no frete).
- A chave `package_review` que já existe no banco pode ficar; deixa de ser lida.

## Restrições

- Medusa v2; metadata é substituída inteira nas atualizações (mesclar antes de
  gravar).
- A busca (Meilisearch) e a vitrine já filtram `published`; nada de versão pendente
  pode ser indexado ou exposto pela chave publicável. Hoje `fields=+metadata` na
  API da loja devolveria `pending_changes`: estender o `store-fields-guard` para
  bloquear `metadata` de produto (a vitrine não lê esse campo).
- Testes obrigatórios: unitários das rotas da vendedora e de admin, do widget e da
  regra de aplicação de `pending_changes`.

## Fica para o construtor

- Formato exato de `pending_changes` e como guardar a foto pendente (URL de upload).
- Visual da página "Produtos em análise" e do quadro (seguir o padrão da página de
  aprovação de lojas em `admin/routes/sellers`).
- Texto exato das mensagens, seguindo o tom das já existentes.
