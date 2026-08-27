# Guia de Testes — Mercado Preto (ponta a ponta)

> Este documento substitui os dois guias anteriores de repasses (`2026-07-11-admin-payouts-manual-test.md` e `2026-07-11-admin-payouts-manual-test-simples.md`), que ficaram desatualizados. O escopo também cresceu: agora cobre as três pontas do sistema — a loja pública (quem compra), o portal do vendedor (quem vende) e o painel administrativo (quem toca a plataforma). Não é preciso saber programação pra seguir este guia — só navegar pelo sistema e observar se o que está descrito realmente acontece.

## Antes de começar: como acessar

O sistema tem três "portas de entrada" diferentes. Cada uma é testada numa parte separada deste guia.

**1. Loja pública (quem compra)** — não precisa de login
- **Endereço:** https://teste.mercadopreto.com.br/

**2. Portal do vendedor (loja "Mulheres de Axé do Brasil")**
- **Endereço:** https://teste.mercadopreto.com.br/painel/login
- **Usuário:** `contato@mercadopreto.com.br`
- **Senha:** `teste1234`

**3. Painel administrativo (admin da plataforma)**
- **Endereço:** https://teste.mercadopreto.com.br/app
- **Usuário:** `admin@mercadopreto.com.br`
- **Senha:** `teste1234`

As duas senhas são simples de propósito — é um ambiente de teste, então não faz sentido complicar. **Isso não pode se repetir em produção.** Quando o sistema for pro ar de verdade, alguém precisa criar credenciais novas e fortes pra essas duas contas (e pra qualquer outra criada nesse meio tempo), e essas senhas de teste precisam deixar de existir. Deixando isso registrado aqui pra não ser esquecido na hora do deploy real.

## Como o sistema funciona, por dentro

Vale entender o fluxo geral antes de sair clicando, porque os três painéis são etapas de uma mesma história:

1. Um **consumidor** navega pela loja pública, coloca produtos no carrinho e compra.
2. Cada produto vendido pertence a um **vendedor** (uma loja parceira dentro do marketplace — hoje só existe uma: "Mulheres de Axé do Brasil"). O vendedor cuida do próprio catálogo pelo **portal do vendedor**.
3. Quando a venda é paga, o sistema calcula quanto é comissão da plataforma e quanto sobra pro vendedor — esse registro é a **comissão**. Isso não é a taxa em si, é o "recibo" de quanto aquela venda específica gerou de valor a receber pro vendedor.
4. O vendedor não recebe esse dinheiro na hora. Os valores das comissões acumulam até alguém do **administrador da plataforma** decidir fechar um período e efetivamente pagar aquele vendedor — isso é um **repasse** (em inglês, *payout*). Um repasse junta várias comissões pendentes de um vendedor, num período de datas, e vira um pagamento único.

Ou seja: **Parte 1** deste guia testa o passo 1, **Parte 2** testa o passo 2, e **Parte 3 + Parte 4** testam os passos 3 e 4.

### Por que o repasse tem tantas regras de segurança

Repasse envolve dinheiro de verdade saindo da conta da plataforma, então essa tela foi desenhada com travas propositais. Vale entender cada uma, porque são justamente os pontos que mais importa testar:

- **O valor nunca é digitado por ninguém — o sistema calcula sozinho.** Não existe campo pra digitar "quanto vou pagar". O sistema soma as comissões pendentes daquele vendedor no período escolhido e calcula o valor automaticamente. Isso existe pra ninguém — nem por engano, nem por má-fé — conseguir mandar pagar um valor diferente do que realmente é devido.

- **Janela de maturação de 5 dias.** O sistema não deixa fechar um repasse cujo período termine há menos de 5 dias. A ideia é dar tempo pra um cancelamento de compra ou estorno acontecer antes de mandar o dinheiro pro vendedor — senão a plataforma paga por uma venda que depois é desfeita.

- **Cancelamento é reversível, processamento não.** Um repasse "Pendente" pode ser cancelado a qualquer momento — as comissões que estavam presas nele voltam a ficar soltas, prontas pra entrar num repasse novo depois. Já um repasse "Pago" (processado) não pode mais ser cancelado — o dinheiro já saiu.

- **Vínculo automático de vendas atrasadas.** Às vezes uma venda é confirmada depois que o repasse do período já foi criado, mas ainda não foi pago. O sistema grudou essa comissão atrasada automaticamente no repasse pendente certo, e soma o valor dela — sem ninguém precisar fazer isso na mão. Só funciona pra repasses ainda "Pendentes"; um repasse já "Pago" nunca é alterado depois.

## O que dá pra testar agora, e o que ainda não dá

Fui conferir o ambiente de teste antes de escrever este guia. Hoje ele está com pouco movimento: zero pedidos, zero comissões, e um único vendedor cadastrado. Isso não é bug, é só porque o ambiente é novo. Além disso, duas integrações externas ainda não têm credencial configurada nesse servidor: o **MercadoPago** (processa o pagamento) e o **Melhor Envio** (calcula frete real — mas esse tem um valor de reserva/fallback, então não trava o fluxo).

| Bloco de teste | Situação | Motivo |
|---|---|---|
| Parte 1 — Loja pública: navegar, buscar, carrinho | ✅ Pode testar agora | Não depende de pagamento |
| Parte 1 — Checkout até a etapa de pagamento | ✅ Pode testar agora | Endereço, frete (com valor de fallback) e revisão do pedido funcionam normalmente |
| Parte 1 — Finalizar o pagamento de verdade | 🚫 Bloqueado | Token do MercadoPago não está configurado neste servidor — o sistema deve mostrar um erro claro nessa etapa, não travar sem explicação |
| Parte 2 — Portal do vendedor / cadastro de produtos | ✅ Pode testar agora | A loja já existe e tem senha configurada; não depende de venda nenhuma |
| Parte 2 — Ver pedidos e comissões do vendedor | ✅ Pode testar agora (listas vazias) | Não existe venda ainda, então o esperado é aparecer lista vazia — isso também é um teste válido |
| Parte 3 — Navegação e telas do admin | ✅ Pode testar agora | Não depende de dados de venda |
| Parte 4 — Criar, processar e cancelar um repasse | 🚫 Bloqueado | Não existe nenhuma comissão pendente no ambiente ainda (depende do bloqueio do pagamento acima) |
| Parte 4 — Vínculo automático (venda atrasada) | 🚫 Bloqueado | Depende de comissão e repasse existirem primeiro |
| — Cadastro de uma **loja nova** (diferente de cadastro de produto) | 🚫 Bloqueado | O backend já aceita esse cadastro, mas não existe nenhuma tela no site pra fazer isso sozinho — só via chamada técnica direta de API |

Assim que o pagamento for configurado (ou dados de teste forem inseridos direto no banco por alguém técnico), aviso e atualizo este documento — a Parte 4 já está escrita e pronta, só esperando.

---

## Parte 1 — Loja pública (experiência do consumidor)

### Teste 1 — Navegar pela loja

**O que fazer:**
1. Acesse https://teste.mercadopreto.com.br/
2. Clique em **"Categorias"** e depois em **"Produtos"**.

**O que deve acontecer:**
- A página inicial carrega com produtos reais em destaque.
- A lista de categorias e a lista de produtos carregam sem erro.

### Teste 2 — Ver a página de uma loja parceira

**O que fazer:**
1. Acesse **"Lojas"** no menu.
2. Clique na loja **"Mulheres de Axé do Brasil"**.

**O que deve acontecer:**
- Aparece uma página com informações da loja e os produtos que ela vende.

### Teste 3 — Ver o detalhe de um produto e adicionar ao carrinho

**O que fazer:**
1. Clique em qualquer produto da lista.
2. Na página do produto, clique em **"Adicionar ao carrinho"**.
3. Abra o carrinho.

**O que deve acontecer:**
- A página do produto mostra fotos, descrição e preço.
- O produto aparece no carrinho, com a quantidade e o valor certos.

### Teste 4 — Preencher o checkout até a etapa de pagamento

**O que fazer:**
1. No carrinho, clique em **"Finalizar compra"** (ou equivalente).
2. Preencha nome, e-mail, telefone e endereço (pode usar dados fictícios, mas o **CEP precisa ser um CEP real** pra o cálculo de frete funcionar).
3. Escolha uma opção de frete.
4. Avance até a tela de pagamento, mas **não finalize ainda**.

**O que deve acontecer:**
- Cada etapa avança sem travar.
- Pelo menos uma opção de frete aparece com um valor (mesmo que seja um valor de referência, já que o Melhor Envio não está com token configurado nesse servidor).
- O resumo do pedido mostra os itens, frete e total corretos antes do pagamento.

### Teste 5 — Tentar finalizar o pagamento (erro esperado)

**O que fazer:**
1. Ainda na tela de pagamento, tente concluir a compra.

**O que deve acontecer:**
- **Isso vai falhar — e é esperado.** O MercadoPago não está configurado neste servidor de teste. O importante aqui é *como* ele falha: deve aparecer uma mensagem de erro compreensível pro usuário (algo indicando que o pagamento não pôde ser processado), e não uma tela em branco, um travamento, ou um erro técnico cru na tela.
- Se a mensagem for confusa, ou a tela travar sem feedback nenhum, isso **é** um problema a reportar — mesmo sabendo que o pagamento em si não vai completar.

---

## Parte 2 — Portal do vendedor (experiência do lojista)

### Teste 6 — Login no portal do vendedor

**O que fazer:**
1. Acesse https://teste.mercadopreto.com.br/painel/login e entre com as credenciais da loja (topo deste guia).

**O que deve acontecer:**
- O login funciona sem erro e leva ao painel/dashboard da loja.
- O dashboard mostra um resumo (mesmo que com números zerados, já que não há vendas ainda).

### Teste 7 — Ver os produtos já cadastrados

**O que fazer:**
1. No menu do portal, acesse **"Produtos"**.

**O que deve acontecer:**
- Aparece a lista de produtos da loja (o catálogo real já importado — deve ter bastante produto listado).

### Teste 8 — Cadastrar um produto novo

**O que fazer:**
1. Clique em **"Novo produto"**.
2. Preencha pelo menos os campos obrigatórios: título e preço.
3. Opcionalmente, preencha descrição, SKU, categoria e imagem.
4. Escolha a visibilidade (publicado ou rascunho) e clique em **"Criar produto"**.

**O que deve acontecer:**
- O produto é criado sem erro e passa a aparecer na lista de produtos da loja.
- Se ele foi criado como "publicado", ele também deve aparecer na loja pública (Parte 1) depois de atualizar a página.

### Teste 9 — Editar e excluir um produto

**O que fazer:**
1. Na lista de produtos, clique em **"Editar"** no produto que você acabou de criar.
2. Altere o preço ou o título e salve.
3. Depois, clique em **"Excluir"** nesse mesmo produto.

**O que deve acontecer:**
- A edição salva corretamente e reflete na lista.
- A exclusão remove o produto da lista (pode pedir uma confirmação antes — nesse caso, confirme).

### Teste 10 — Pedidos e comissões da loja (listas vazias — e tudo bem)

**O que fazer:**
1. Acesse **"Pedidos"** no portal do vendedor.
2. Acesse **"Comissões"** no portal do vendedor.

**O que deve acontecer:**
- As duas telas carregam sem erro.
- Como ainda não existe nenhuma venda paga no ambiente, ambas devem mostrar uma lista vazia com uma mensagem clara (não um erro, não uma tela em branco). Esse é o comportamento correto pra esse estado.

### Teste 11 — Editar o perfil da loja

**O que fazer:**
1. Acesse **"Perfil"** no portal do vendedor.
2. Altere alguma informação (por exemplo, a descrição da loja) e salve.

**O que deve acontecer:**
- A alteração salva sem erro e permanece depois de recarregar a página.

---

## Parte 3 — Painel administrativo (experiência do administrador)

### Teste 12 — Login e navegação básica

**O que fazer:**
1. Acesse https://teste.mercadopreto.com.br/app e entre com as credenciais do topo deste guia.
2. Olhe a barra lateral esquerda.

**O que deve acontecer:**
- O login funciona sem erro.
- Aparecem os itens **"Vendedores"**, **"Comissões"** e **"Repasses"** na barra lateral (Repasses logo abaixo de Comissões).

### Teste 13 — Tela de Vendedores

**O que fazer:**
1. Clique em **"Vendedores"**.
2. Você deve ver pelo menos um vendedor na lista: **"Mulheres de Axé do Brasil"**.
3. Clique nele pra abrir o detalhe.

**O que deve acontecer:**
- A lista carrega sem erro.
- O detalhe do vendedor mostra os dados cadastrais, incluindo informações bancárias e/ou chave PIX (esses são os mesmos dados que depois aparecem na tela de repasse — vale se familiarizar com onde eles ficam agora).

*Nota: hoje não existe uma tela pública onde uma loja nova se cadastra sozinha (esse cadastro é diferente do cadastro de produto, que já foi testado na Parte 2) — isso ainda depende de alguém técnico criar o registro pela API. Então por enquanto dá pra **ver** o cadastro existente, mas não **criar** uma loja nova pela interface.*

### Teste 14 — Tela de Comissões (vazia, e tudo bem)

**O que fazer:**
1. Clique em **"Comissões"**.

**O que deve acontecer:**
- A tela carrega sem erro.
- Como não existe nenhuma venda paga ainda, deve aparecer uma mensagem de lista vazia (algo como "Nenhuma comissão encontrada") — isso é o comportamento correto pra esse estado, não é falha.

### Teste 15 — Tela de Repasses (vazia) e o filtro padrão

**O que fazer:**
1. Clique em **"Repasses"**.

**O que deve acontecer:**
- A tela carrega já com o filtro **"Pendente"** pré-selecionado.
- Como não existe nenhum repasse ainda, aparece o estado vazio correspondente.

### Teste 16 — Abrir o formulário de novo repasse

**O que fazer:**
1. Clique em **"+ Novo repasse"**.
2. Selecione o único vendedor disponível ("Mulheres de Axé do Brasil").

**O que deve acontecer:**
- O formulário abre normalmente.
- Um período de datas é sugerido automaticamente.
- Como esse vendedor não tem nenhuma comissão pendente, o valor calculado na prévia deve aparecer como **R$ 0,00**.
- O botão de confirmar criação deve estar desabilitado (não faz sentido criar um repasse de valor zero) — essa trava é uma das regras de segurança explicadas lá em cima.

### Teste 17 — A trava dos 5 dias (janela de maturação)

Esse teste não depende de existir comissão nenhuma, então dá pra fazer agora.

**O que fazer:**
1. Ainda no formulário de novo repasse, tente escolher manualmente um período cujo fim seja de até 5 dias atrás (por exemplo, ontem ou hoje).

**O que deve acontecer:**
- O sistema não permite — deve aparecer uma mensagem clara explicando que o período ainda não "maturou" (não passou tempo suficiente desde o fim do período escolhido).

---

## Parte 4 — Fluxo completo de um repasse (aguardando dados de teste)

Estes testes já estão prontos pra rodar assim que existir pelo menos uma comissão pendente real no ambiente — seja porque o pagamento foi configurado e uma compra real de teste foi feita (Parte 1, Teste 5), seja porque alguém técnico inseriu dados direto no banco. Vou avisar quando isso acontecer.

### Teste 18 — Criar um repasse válido

**O que fazer:**
1. Com um vendedor que tenha comissões pendentes reais, crie um repasse com um período já maturado (mais de 5 dias).

**O que deve acontecer:**
- O repasse aparece na lista com status **"Pendente"**.
- Na tela de Comissões, as vendas daquele período aparecem agora vinculadas ao repasse, mas continuam com status **"Pendente"** (só viram "Pago" quando o repasse for processado — o vínculo e o pagamento são coisas diferentes).

### Teste 19 — Ver o detalhe do repasse

**O que fazer:**
1. Clique no repasse recém-criado.

**O que deve acontecer:**
- Aparecem os dados bancários e/ou chave PIX do vendedor.
- Aparece a lista das comissões (vendas) que compõem esse repasse.

### Teste 20 — Processar (pagar) o repasse

**O que fazer:**
1. Clique em **"Processar"** e confirme na janela que aparece.

**O que deve acontecer:**
- O status muda para **"Pago"**.
- As comissões vinculadas a esse repasse também aparecem como **"Pago"** na tela de Comissões.
- Lembrando: depois de processado, o repasse não pode mais ser cancelado (é a regra de segurança "processamento não é reversível").

### Teste 21 — Cancelar um repasse

**O que fazer:**
1. Crie um segundo repasse (pode ser pro mesmo vendedor, num período diferente, ou outro vendedor se houver).
2. Em vez de processar, clique em **"Cancelar"**.

**O que deve acontecer:**
- O status muda para **"Cancelado"**.
- As comissões que estavam presas nesse repasse voltam a aparecer como **"Pendente"**, sem vínculo — como se nunca tivessem entrado num repasse.

### Teste 22 — Venda que "chega atrasada" (o caso mais importante de validar)

Esse é o teste que cobre o vínculo automático explicado lá em cima. É mais difícil de fazer sozinho — normalmente precisa de ajuda de alguém técnico pra simular uma confirmação de pagamento atrasada. Se não for possível reproduzir, não tem problema: registre que esse teste específico não foi feito, e por quê.

**O que fazer (com apoio técnico):**
1. Crie um repasse **pendente** pra um vendedor (sem processar ainda).
2. Simule a chegada de uma nova venda confirmada, do mesmo vendedor, com data dentro do período desse repasse pendente.

**O que deve acontecer:**
- Essa venda nova aparece automaticamente vinculada ao repasse pendente.
- O valor total do repasse aumenta, incluindo essa venda.
- Quando o repasse for processado depois, essa venda atrasada também vira "Pago" junto com as outras.

---

## O que anotar se algo der errado

Pra cada teste que falhar, anote:
- Qual número de teste falhou.
- O que você esperava ver, e o que apareceu na tela em vez disso.
- Um print da tela, se possível.

Isso já é suficiente pra quem desenvolveu a funcionalidade entender e corrigir — não precisa investigar a causa, só descrever o que foi visto.
