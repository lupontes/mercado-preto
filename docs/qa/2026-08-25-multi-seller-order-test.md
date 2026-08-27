# Teste — Pedido com produtos de várias lojas no mesmo carrinho

> Solicitado pelo testador (Ailton Fiz, WhatsApp 22/08/2026): criar uma loja de teste em nome dele e testar como a plataforma se comporta ao fazer um pedido com produtos de lojas diferentes no mesmo carrinho.

## Credenciais criadas para o teste

**Portal do vendedor** (onde o Ailton gerencia a loja de teste):
- **Endereço:** https://teste.mercadopreto.com.br/painel/login
- **Loja:** LOJA FIX SISTEMAS
- **Usuário (e-mail):** `adm@fixsistemas.com`
- **Senha:** `FixSistemas@2026`
- **CPF cadastrado:** 992.486.703-34 (informado pelo próprio testador)
- **Status:** `active` (já aprovada, pronta pra cadastrar produtos e usar o portal)
- **ID interno:** `01M0WG0SPGCDNVJ003VXA6N6ZE`

> A senha foi definida diretamente no banco de teste (ambiente de homologação), sem passar pelo fluxo normal de e-mail de redefinição — **isso só é aceitável em ambiente de teste**, nunca em produção.

Pra referência, as credenciais já existentes continuam valendo:
- **Loja "Mulheres de Axé do Brasil":** `contato@mercadopreto.com.br` / `teste1234`
- **Admin da plataforma:** https://teste.mercadopreto.com.br/app — `admin@mercadopreto.com.br` / `teste1234`

## O que testar

1. Login em https://teste.mercadopreto.com.br/painel/login com as credenciais da LOJA FIX SISTEMAS.
2. Cadastrar ao menos 1 produto de teste nessa loja (Painel → Produtos → Novo).
3. Na loja pública (https://teste.mercadopreto.com.br/), montar um carrinho com **produtos de lojas diferentes** — por exemplo, um produto da LOJA FIX SISTEMAS + um produto da "Mulheres de Axé do Brasil".
4. Seguir o checkout até o fim e observar o resultado.

## Ponto de atenção — leia antes de testar

Antes de rodar o teste, olhei o código do checkout e encontrei um sinal forte de que **isso pode não funcionar como esperado**:

- O carrinho da loja pública (`cart-store.ts`, `AddToCartButton.tsx`) **não tem nenhuma noção de "vendedor"** — ele deixa adicionar produtos de qualquer loja livremente, sem aviso.
- Mas o endpoint que cria a cobrança no MercadoPago (`POST /store/checkout/preference`) recebe **um único `sellerId` pro pedido inteiro**, não um vendedor por item.
- A emissão de nota fiscal (`order-fiscal-emit.ts`) também lê **um único** `seller_id` do pedido inteiro.

Ou seja: o sistema hoje parece ter sido desenhado assumindo **um vendedor por pedido**. Um carrinho com produtos de lojas diferentes provavelmente vai:
- Atribuir o pedido inteiro a um só vendedor (possivelmente o errado, dependendo de qual item "vence"), e/ou
- Gerar comissão/repasse incorreto pro vendedor que não teve o pedido creditado, e/ou
- Emitir a nota fiscal em nome do vendedor errado.

**Isso é exatamente o tipo de problema que esse teste deve revelar** — não é preciso "consertar" nada antes de testar, só documentar com precisão o que acontece de fato (qual vendedor fica com o pedido, se a comissão bate, se a nota fiscal sai certa) pra virar um bug report específico depois.

## Registro de resultado

_(preencher depois de rodar o teste)_

- O que aconteceu ao finalizar o pedido:
- Qual vendedor recebeu o pedido no painel dele:
- A comissão apareceu corretamente para os dois vendedores?
- Alguma mensagem de erro?
