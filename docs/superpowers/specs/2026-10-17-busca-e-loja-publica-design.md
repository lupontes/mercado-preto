# Busca e Páginas Públicas da Loja — Design

**Status**: Aprovado (17/10/2026). O usuário pediu para
decidir pelas melhores práticas; as decisões abaixo são de quem escreveu o spec.

Branch: `fix/busca-e-loja-publica` (a partir de `develop`).

## Contexto e motivo

Achados da fase 1 do item 8 (cobertura de testes), conferidos no código e no
servidor de teste em 17/10:

1. **Busca fora do ar.**
   - `/store/search` respondia 500 ("Attribute `status` is not filterable").
   - As configurações dos índices só são aplicadas pelo reindex manual, e
     ninguém o tinha rodado no servidor.
   - Um reindex manual em 17/10 resolveu o servidor de teste, mas qualquer
     ambiente novo volta a quebrar.
   - Quando o Meilisearch falha, a rota responde 500 em vez de cair na busca
     pelo banco.
2. **Índices desatualizados.**
   - `product-search-index.ts` escuta `product.created`, `product.updated` e
     `product.deleted`, mas o Medusa só roda a função exportada como padrão
     (`productCreated`). No `deleted`, ela não acha o produto e não remove
     nada, então o produto apagado continua na busca.
   - `seller-search-index.ts` só escuta `seller.approved`, quando a loja ainda
     está `approved`. A busca filtra `active`. A ativação (definir a senha), a
     suspensão e a reprovação não emitem evento, então a busca de lojas nunca
     mostra ninguém pelo índice.
3. **Injeção no filtro.** `category`, `location` e `seller_id` entram no
   filtro do Meilisearch entre aspas, sem escape. Um valor como
   `x" OR status = "draft` muda o filtro e pode trazer produtos em rascunho.
4. **Páginas públicas da loja.**
   - `GET /store/sellers/:id/products` devolve também os produtos em
     **rascunho**.
   - `GET /store/sellers/:id` devolve lojas `pending` e `approved`. Só a
     suspensa fica de fora, enquanto a listagem pública mostra só as `active`.
5. **Comissões da vendedora.** `GET /seller/commissions` calcula os totais e
   o `count` só sobre a página atual (20 itens). Quem tem mais vendas vê os
   totais errados.
6. **Busca pelo banco (sem Meilisearch).** Ela pagina antes de filtrar pelo
   texto, então só encontra o que está na primeira página. Também ignora os
   filtros `category`, `location` e `seller_id`.

## Decisões

### Busca (`api/store/search/route.ts`)

- Todo valor que entra no filtro passa por `meiliFilterValue(value)`, que
  escapa `\` e `"` e devolve o valor entre aspas.
- Se a busca no Meilisearch lançar erro:
  - o erro vai para o `logger.error`;
  - a rota cai na busca pelo banco, com os mesmos parâmetros.
- **Busca pelo banco:**
  - aplica o texto e os filtros (`seller_id` nos produtos; `category` e
    `location` nas lojas) **antes** de paginar;
  - `total` é o total depois do filtro;
  - em produtos, carrega os publicados com `seller.id`, filtra em memória e
    pagina. O catálogo é pequeno, cerca de 240 produtos. Fica anotado que,
    com milhares de produtos, isso deve ir para o banco.

### Índices

- **Configurações:** `ensureIndexes()` roda uma vez quando o backend sobe,
  por um loader do Medusa ou pelo primeiro uso do cliente. Assim um ambiente
  novo não depende do reindex manual. Fica a critério de quem implementar
  qual dos dois mecanismos, desde que haja teste.
- **Produtos**, um subscriber por arquivo:
  - `product-search-index.ts`: `product.created` e `product.updated` fazem
    upsert do documento;
  - `product-search-remove.ts`: `product.deleted` remove o documento.
- **Lojas:**
  - as mudanças de status passam a emitir `seller.status_changed` com `{ id }`.
    Ele sai de:
    - `activate`, `suspend` e `reject` no admin;
    - `set-password`, quando a vendedora é ativada;
  - `seller-search-index.ts` passa a escutar `seller.approved` e
    `seller.status_changed`:
    - se a loja está `active`, faz upsert;
    - nos outros status, remove o documento.

### Páginas públicas

- `GET /store/sellers/:id` e `GET /store/sellers/:id/products` só respondem
  para lojas `active`. Nos outros casos respondem 404 "Vendedor não
  encontrado", como na suspensa hoje.
- `GET /store/sellers/:id/products` devolve só produtos `published`, e o
  `count` conta só esses.

### Comissões da vendedora

- `GET /seller/commissions` usa `listAndCountCommissions` para a página e o
  `count` total.
- Os `totals` são somados sobre **todas** as comissões que passam no filtro,
  não só a página.

## Não objetivos

- Paginar a busca pelo banco na própria SQL.
- Remover documentos órfãos que já estejam no índice. O reindex manual
  continua disponível para isso.
- Mudar o formato das respostas.

## Testes

- `meiliFilterValue` com aspas, barra invertida e texto comum.
- **Rota de busca:**
  - com um `category` malicioso, o filtro enviado ao Meilisearch tem o valor
    escapado;
  - quando o Meilisearch lança erro, a resposta é 200 vinda do banco, e o
    erro vai para o log;
  - na busca pelo banco, um produto que casa com o texto e está além da
    primeira página é encontrado, e `total` reflete o filtro;
  - `seller_id`, `category` e `location` são aplicados.
- **Subscribers:**
  - `product.deleted` remove o documento;
  - `product.updated` faz upsert;
  - `seller.status_changed` para `active` faz upsert, e para `suspended` ou
    `pending` remove;
  - o config de cada arquivo escuta os eventos certos.
- **Emissão de `seller.status_changed`:** `activate`, `suspend`, `reject` e
  `set-password` emitem o evento.
- **Páginas públicas:**
  - `pending`, `approved` e `suspended` recebem 404;
  - `active` recebe 200;
  - os produtos em rascunho ficam de fora, e o `count` bate.
- **Comissões:** com 25 comissões e `limit=20`, o `count` é 25 e os totais
  somam as 25.
- **Configurações dos índices:** são aplicadas sem o reindex.
- **Ponta a ponta no servidor de teste, depois do deploy:**
  - a busca de lojas acha as 2 lojas ativas sem precisar de reindex;
  - um `category` malicioso não traz rascunhos;
  - as páginas públicas respondem como no spec.
