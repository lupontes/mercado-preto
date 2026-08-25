# Design: Classificação de NCM por Categoria de Produto

**Data:** 2026-08-25
**Autor:** Luciano Pontes (via Claude Code)
**Status:** Aprovado, aguardando plano de implementação

## Contexto

A emissão de NF-e via Focus NFe (PR #34, mergeada em `develop`) funciona de ponta a ponta em homologação, mas usa um NCM (Nomenclatura Comum do Mercosul — código fiscal de 8 dígitos que classifica o tipo de produto) fixo e genérico (`44199000`, "outros artigos de madeira para mesa ou cozinha") pra **todo** item de **todo** pedido. Nenhum produto do catálogo carrega um NCM real em lugar nenhum do código — confirmado via grep.

Isso é fiscalmente incorreto pra praticamente todo o catálogo real (bolsas, bijuterias, têxteis não são "artigos de madeira"), mas funcional o suficiente pra passar na validação de schema da SEFAZ em homologação.

### Restrição central que define o design

O sistema é operado por donas/donos de loja de baixa escolaridade e nenhum conhecimento fiscal — não é razoável pedir que eles escolham ou digitem um código NCM de 8 dígitos ao cadastrar um produto. Essa decisão precisa ficar invisível pra eles.

### Levantamento do catálogo real

O catálogo tem ~22 categorias de produto já cadastradas nativamente via `product_category` do Medusa (não uma tabela nova):

| Categoria | Produtos |
|---|---|
| BOLSAS | 50 |
| DECORAÇÃO | 48 |
| COLARES | 41 |
| BRINCOS | 32 |
| KITS PARA COZINHA | 28 |
| Produtos MAB | 16 |
| MODA AFRICANA | 16 |
| Roupas Afro | 15 |
| SACOLÕES | 12 |
| KITS PARA BANHEIROS | 8 |
| LUMINÁRIAS | 5 |
| CANECAS, COPOS E GARRAFAS | 5 |
| BRINCO AFRICANO | 4 |
| PINGENTE | 4 |
| PULSEIRAS | 3 |
| KIT LUMINÁRIA | 3 |
| PETISQUEIRAS | 3 |
| CHAPÉUS | 2 |
| Roupas Tradicionais | 1 |

Mais `Shirts`/`Sweatshirts`/`Pants`/`Merch` (1 produto cada) — dados de demonstração residuais do Medusa (produtos não publicados, já identificados em sessões anteriores), não catálogo real da MAB. Não entram na classificação.

Um produto pode estar em mais de uma categoria — ex: um produto em "BOLSAS" também aparece em "Produtos MAB" (um bucket genérico, não um tipo de produto).

`product_category` já tem um campo `metadata` (jsonb) nativo do Medusa, sem necessidade de migração nova.

## Decisões

1. **NCM mora em `product_category.metadata.ncm`, não por produto.** Só ~22 valores pra manter, em vez de 242. Nenhuma migração de banco nova — reaproveita um campo que o Medusa já expõe pra toda categoria.

2. **Vendedores nunca veem ou preenchem NCM.** Continuam escolhendo categoria do jeito que já fazem hoje ao cadastrar produto. Quem preenche `metadata.ncm` das categorias é o administrador da plataforma (ou um contador consultado por ele) — tarefa única de configuração, não fluxo recorrente de vendedor.

3. **Resolução acontece na emissão da nota, não no checkout.** `order-fiscal-emit.ts` (ou uma função nova no módulo fiscal chamada por ele) resolve o NCM a partir do `variant_id` já presente no item do pedido, via `query.graph` (mecanismo nativo do Medusa pra atravessar módulos — mesmo padrão já usado em `reindex-search.ts`): `variant → product → categories[].metadata.ncm`. O checkout continua intocado.

4. **Categoria mais específica vence.** Uma lista curta de nomes de categoria tratados como "genéricos" (hoje: `["Produtos MAB"]`) é ignorada na escolha, mesmo que tenha `metadata.ncm` preenchido — só entra em jogo se for a única categoria do produto. Entre categorias específicas, usa a primeira que tiver NCM configurado, **ordenadas por nome (ordem alfabética) antes de escolher** — `query.graph` não garante nenhuma ordem específica de retorno, então "primeira" precisa de um critério determinístico explícito pra não depender de acaso.

5. **Fallback nunca bloqueia a venda.** Se nenhuma categoria do produto tiver NCM (categoria nova, ou uma das que ficaram sem mapear), usa o placeholder genérico atual (`44199000`) e marca o documento fiscal com aviso — não impede a emissão.

6. **Aviso de fallback fica no `nf_document`, reaproveitando o painel admin que já existe.** Novo campo `ncmFallbackUsed` (boolean, migração no módulo fiscal, mesmo padrão das migrações já existentes ali). Visível/filtrável via `GET /admin/fiscal` (endpoint já existente) — sem novo canal de notificação (e-mail/WhatsApp) pra isso: é um problema de qualidade de dado pra revisão periódica, não uma emergência que trava operação.

7. **Sem tela de admin nova pra editar NCM de categoria.** Os ~22 valores iniciais (tabela abaixo) são aplicados via script único. Ajustes futuros: direto no `metadata` da categoria (editável no admin padrão do Medusa, se expuser metadata — a confirmar durante implementação) ou via script pontual. Construir uma UI dedicada fica pra depois, se a frequência de ajuste justificar.

## Validação de formato

Se `metadata.ncm` de uma categoria existir mas não tiver exatamente 8 dígitos, o código trata como ausente (cai no fallback) em vez de mandar um valor claramente inválido pra SEFAZ — mesma postura defensiva já usada em `validateBuyerDocument`/`validateCep`.

## Proposta inicial de NCM por categoria

**Importante: isto não é aconselhamento fiscal definitivo.** São códigos levantados via pesquisa pública (Cosmos, QualNCM, Systax, Receita Federal), pensados pra destravar o cadastro inicial — não substituem uma revisão de contador antes de qualquer emissão em produção real. Confiança marcada por linha.

| Categoria | NCM proposto | Confiança | Observação |
|---|---|---|---|
| BOLSAS | `4202.92.00` | Alta | Bolsas/mochilas ficam no capítulo 42 independente do material (Nota 1, Seção XI) |
| SACOLÕES | `4202.92.00` | Alta | Mesma lógica de BOLSAS |
| COLARES | `7117.90.00` | Alta | Bijuteria (sem pedra preciosa/metal precioso) |
| BRINCOS | `7117.90.00` | Alta | Idem |
| BRINCO AFRICANO | `7117.90.00` | Alta | Idem |
| PULSEIRAS | `7117.90.00` | Alta | Idem |
| PINGENTE | `7117.90.00` | Alta | Idem |
| CANECAS, COPOS E GARRAFAS | `6912.00.00` | Média | Assume cerâmica (mais comum); se for vidro, seria `7013` — depende do produto real |
| CHAPÉUS | `6504.00.00` | Média | Assume construção entrançada/tiras (comum em artesanato); tecido em peça seria `6505` |
| LUMINÁRIAS | `9405.50.00` | Média | Aparelhos de iluminação não-elétricos |
| KIT LUMINÁRIA | `9405.50.00` | Média | Mesma lógica de LUMINÁRIAS |
| KITS PARA COZINHA | `6912.00.00` | **Baixa** | Categoria heterogênea (pode ser cerâmica, madeira, têxtil) — revisar |
| PETISQUEIRAS | `6912.00.00` | **Baixa** | Idem |
| KITS PARA BANHEIROS | — | **Sem proposta** | Confirmado nos produtos reais: ~metade é cestaria de cipó (capítulo 46) e a outra metade é jogo de crochê tipo tapete de banheiro (capítulo 57) — dois tipos de mercadoria diferentes numa categoria só, não dá pra ter um NCM correto por categoria aqui |
| DECORAÇÃO | — | **Sem proposta** | A mais heterogênea (48 produtos): maior cluster é cestaria/palha/cipó (~15 produtos), segundo maior é escultura de cerâmica de orixás (7 produtos: Exú, Iemanjá, Oxum, Oxóssi, Xangô), resto é mistura de quadros, madeira, crochê — sem um tipo dominante o suficiente pra justificar um código único |
| MODA AFRICANA | — | **Sem proposta** | Confirmado nos produtos reais (16 itens): mistura tipo de peça (10 vestidos, 2 saias, 3 conjuntos, 1 calça) — cada tipo tem NCM próprio independente do tecido. E mesmo só entre os 10 vestidos, metade é malha e metade é tecido plano estampado. Não é problema de falta de informação de composição — é que a categoria mistura tipos de mercadoria que a Receita trata como diferentes, então um NCM por categoria não serve aqui |
| Roupas Afro | — | **Sem proposta** | Mesmos produtos de MODA AFRICANA (categorias sobrepostas), mesmo problema |
| Roupas Tradicionais | — | **Sem proposta** | Idem (1 produto só — "Calça Saruel" — baixo impacto, fica no fallback por ora) |
| Produtos MAB | *(não classificar)* | — | Categoria genérica, sempre ignorada na resolução |

### Sobre composição de tecido (contexto pra uma futura reorganização)

O usuário forneceu esse contexto de mercado sobre "tecido africano" — útil se um dia as categorias de vestuário forem divididas por tipo de peça (o que resolveria o problema acima):

> Capulanas e Wax Print (Ankara): 100% algodão de alta densidade, resinado com cera. Kente/Samakaka (impressos modernos): algodão puro ou mistura com poliéster. Imitações de baixo custo: 100% poliéster ou microfibra.

Ou seja, mesmo sabendo isso, ainda seria preciso saber qual desses três tiers cada produto específico usa — não dá pra assumir um só pra toda a categoria. Se MAB algum dia dividir "MODA AFRICANA" em subcategorias por tipo de peça (Vestidos, Saias, Conjuntos, Calças), o próximo passo seria descobrir a composição real de cada uma junto aos fornecedores/costureiras, não estimar.

Categorias sem proposta ficam no fallback genérico (com aviso) até alguém definir o valor real — o sistema já trata esse caso sem quebrar.

## Testes

- Resolução: categoria específica vence a genérica (`Produtos MAB` ignorada); produto em 2+ categorias específicas usa a primeira com NCM; nenhuma categoria com NCM → retorna indefinido (aciona fallback); NCM mal formatado (≠ 8 dígitos) → tratado como ausente.
- `order-fiscal-emit.ts`: NCM resolvido é passado por item pro payload do Focus NFe (não mais fixo).
- `nf_document.ncmFallbackUsed` gravado corretamente nos dois casos (com e sem NCM resolvido).
- Confirmação final: mesmo tipo de teste de pedido real (via `medusa exec`, script descartável) feito na sessão anterior, antes de considerar pronto — não só testes unitários.

## Fora de escopo (explicitamente adiado)

- Construir uma tela de admin pra editar NCM por categoria.
- Resolver o gap de CPF do comprador no checkout (bloqueador separado, já documentado no HANDOFF).
- Classificar as categorias marcadas "sem proposta" acima — ficam no fallback até definição humana.
