# Natureza fiscal da relação entre Mercado Preto e seus vendedores

> Memorando técnico — para análise contábil/jurídica. Resumo objetivo de como a
> operação funciona hoje no sistema, preparado para orientar a análise de um
> contador ou advogado — **não é um parecer jurídico nem uma conclusão
> definitiva**.
>
> Versão completa e formatada: [Artifact "Memo de Consignação"](https://claude.ai/code/artifact/7f66f62e-bd41-41bd-b097-d95294aeb142)

**Preparado em**: 5 de setembro de 2026 · atualizado em 6 de setembro de 2026
**Escopo**: loja própria, Mercado Livre e (em desenho) TikTok Shop
**Hipótese de trabalho**: compra e revenda formal — revisada, ver §7

## 1. Por que este memorando existe

O Mercado Preto vende produtos de uma rede de artesãos e trabalhadores rurais
que, em grande parte, trabalham na informalidade e não têm CNPJ. Essa
restrição molda toda a operação: hoje, toda nota fiscal emitida pela
plataforma sai sob um único CNPJ — o do próprio Mercado Preto — não importa
qual vendedor originou a venda.

Essa prática já existe em produção e nunca foi formalmente avaliada por um
contador ou advogado como uma decisão jurídica deliberada — ela surgiu do
próprio funcionamento do sistema. Com a integração com o Mercado Livre (e,
em desenho, o TikTok Shop), o mesmo modelo passa a valer também para vendas
feitas nesses canais, aumentando o volume e a exposição dessa estrutura.
Este documento descreve os fatos técnicos da operação, para que a análise
formal possa ser feita com base neles.

## 2. Como o dinheiro flui hoje

*(✓ verificado no código)*

Para cada venda, o sistema aplica esta fórmula (módulo de comissão, taxa
padrão de 15%, configurável):

```
valor da venda − taxas de pagamento (MercadoPago/ML) = valor líquido
valor líquido × 15% (comissão)                       = comissão do Mercado Preto
valor líquido − comissão                             = repasse ao vendedor
```

Ou seja: o vendedor recebe o valor da venda menos as taxas de pagamento e
menos uma comissão percentual — nunca um preço de compra fixo combinado
antecipadamente. O Mercado Preto nunca registra uma "compra" da mercadoria
do artesão antes de vendê-la; o dinheiro só se move depois que o comprador
final paga.

## 3. Como a nota fiscal é emitida hoje

*(✓ verificado no código)*

- Toda NF-e sai com o CNPJ definido em uma única variável de configuração da
  plataforma — o mesmo CNPJ para qualquer vendedor.
- O cadastro de cada vendedor tem um campo de CPF/CNPJ próprio, mas esse
  campo é só um registro interno: **ele nunca é usado no documento fiscal**.
  A validação nem exige formato de CNPJ — aceita CPF.
- O identificador do vendedor fica gravado como referência interna junto ao
  registro da nota, mas não aparece no documento fiscal em si.

## 4. Hipótese de trabalho original: consignação mercantil

> **Avaliação preliminar (não é conclusão profissional).** A leitura de quem
> opera o negócio era que isso se aproxima de uma consignação mercantil: o
> artesão consigna a mercadoria ao Mercado Preto, que a vende em nome
> próprio (daí emitir a nota fiscal sob seu CNPJ) e repassa ao consignante o
> valor da venda menos uma comissão de intermediação — exatamente o padrão
> de remuneração líquida de comissão que uma consignação clássica prevê.

Comparando com as outras estruturas possíveis, para contextualizar por que
essa parecia a mais aderente:

| Estrutura | Quem seria o vendedor "de direito" | Compatível com nota única sob um CNPJ? |
|---|---|---|
| **Consignação** (hipótese original) | O consignatário (Mercado Preto) vende em nome próprio | Sim — é o padrão esperado |
| Comissão mercantil (agenciamento) | O artesão, com o Mercado Preto como corretor | Não — o vendedor de fato precisaria emitir, mas não tem CNPJ |
| Compra e revenda | O Mercado Preto, após comprar do artesão | Sim, mas exigiria registro formal de compra — inexistente à época |
| Marketplace comum (cada um com CNPJ) | Cada vendedor individualmente | Não — pressuposto (CNPJ próprio) não existe nesta base de vendedores |

## 5. Onde a integração com o Mercado Livre entra

**O que muda**: a mesma estrutura (uma conta, um CNPJ, um repasse líquido de
comissão) passa a valer também para vendas feitas dentro do Mercado Livre,
através de uma única conta ML de propriedade do Mercado Preto — nenhum
vendedor tem conta própria na plataforma externa.

**O que não muda**: a fórmula de repasse é a mesma descrita na seção 2, só
trocando a taxa de pagamento (a do Mercado Livre em vez da do MercadoPago) —
a natureza da relação com o vendedor não é diferente por causa do canal de
venda.

## 6. Perguntas originais para confirmar com o contador/advogado

- A hipótese de consignação mercantil se sustenta legalmente dado como o
  dinheiro de fato flui (repasse líquido de comissão, sem compra
  antecipada)?
- Emitir a nota fiscal integralmente sob o CNPJ do Mercado Preto, para
  mercadoria de terceiros sem CNPJ próprio, é compatível com a legislação
  tributária nesse regime?
- É necessário um contrato formal de consignação por escrito com cada
  vendedor? Existe hoje algum termo de adesão que já cubra isso?
- Há alguma diferença de tratamento fiscal exigida entre as vendas feitas na
  loja própria e as feitas via Mercado Livre?
- Seria recomendável orientar os artesãos a se formalizarem como MEI, mesmo
  dentro do modelo de consignação?

## 7. Atualização (6/9/2026) — exigência de titularidade nos canais externos

*(avaliação do operador do negócio, não verificado em código)*

Tanto o Mercado Livre quanto o TikTok Shop (nos Termos do Vendedor, seção
sobre usos aceitáveis) exigem que quem anuncia detenha **"titularidade e o
direito de vender"** os produtos listados, e o TikTok Shop proíbe
explicitamente dropshipping. Isso levanta uma pergunta que a hipótese de
consignação do §4 não respondia: consignação confere, no sentido exigido
por esses termos, titularidade formal ao consignatário antes da venda ao
consumidor final — ou a mercadoria continua sendo do consignante até esse
momento?

### O trade-off entre consignação e compra e revenda

Consignação protege o vendedor (artesão) caso o Mercado Preto tenha um
problema financeiro — a mercadoria consignada não integra a massa de bens
do consignatário, e pode ser retomada. Compra e revenda formal dá
titularidade inequívoca ao Mercado Preto antes de revender, mas
historicamente expõe o vendedor ao risco de o comprador não pagar caso o
repasse dependa da revenda ter sido bem-sucedida — foi essa ressalva que
motivou a preferência original pela hipótese de consignação em §4.

> **Reavaliação em 6/9/2026.** Segundo avaliação do operador do negócio, o
> perfil financeiro do Mercado Preto não é suscetível a falência — logo, o
> risco de o vendedor perder a mercadoria consignada na massa de bens de um
> Mercado Preto insolvente é considerado não aplicável aqui. Com essa
> ressalva removida, **compra e revenda formal passa a ser a estrutura
> recomendada** em vez de consignação: ela satisfaz sem ambiguidade a
> exigência de titularidade dos canais externos, sem o principal
> contraponto que motivava evitá-la.

### O obstáculo que compra e revenda formal precisa resolver

Uma compra formal pressupõe, em geral, que o vendedor emita nota fiscal — o
que o artesão informal sem CNPJ não pode fazer. O mecanismo do direito
comercial brasileiro pensado exatamente para esse cenário é a **nota fiscal
de entrada** (já usada para aquisição de produtor rural, catador ou artesão
pessoa física sem inscrição): o próprio comprador — aqui, o Mercado Preto —
emite a nota em nome do vendedor sem CNPJ, formalizando a aquisição e a
titularidade antes da revenda.

### Novas perguntas para o contador/advogado

- A nota fiscal de entrada é o instrumento correto para formalizar a compra
  de mercadoria de pessoa física sem CNPJ, neste contexto?
- Que tratamento de ICMS/tributação se aplica na revenda sob compra e
  revenda formal, comparado ao regime de comissão sobre consignação hoje
  praticado?
- A emissão da nota de entrada deve ser simultânea à venda ao cliente final
  (repasse instantâneo, sem o Mercado Preto manter estoque próprio), ou
  pode anteceder a venda?
- Essa mudança de estrutura exige um novo contrato/termo de adesão com os
  vendedores, substituindo o de consignação (se existir)?
- Os dois modelos podem coexistir — consignação para a loja própria, compra
  e revenda formal só para os canais externos que exigem titularidade
  (Mercado Livre, TikTok Shop) — ou a estrutura deveria ser única para toda
  a operação?

---

Documento técnico gerado a partir da leitura direta do código em produção
do Mercado Preto (módulos de comissão, fiscal e cadastro de vendedores),
complementado em 6/9/2026 com avaliação do operador do negócio sobre a
exigência de titularidade dos canais externos (§7). Não substitui análise
contábil ou jurídica formal.
