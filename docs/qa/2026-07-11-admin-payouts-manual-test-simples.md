# Guia de Testes — Tela de Repasses (para quem vai testar)

Este documento explica, em linguagem simples, o que precisa ser testado na nova tela de "Repasses" do painel administrativo. Não é preciso saber programação para seguir os passos — só navegar no sistema e observar se o que está descrito realmente acontece.

## O que é essa funcionalidade?

A tela de Repasses é onde o administrador do marketplace paga os vendedores. Ela mostra quanto cada vendedor tem a receber, permite criar um "repasse" (o pagamento), marcar esse repasse como pago, ou cancelá-lo se algo estiver errado.

---

## Teste 1 — A tela abre corretamente

**O que fazer:**
1. Entre no painel administrativo com seu usuário de administrador.
2. Procure na barra lateral esquerda pelo item **"Repasses"** (deve aparecer logo abaixo de "Comissões").
3. Clique nele.

**O que deve acontecer:**
- A tela abre normalmente, sem erro.
- Ela já aparece filtrada mostrando só os repasses com status **"Pendente"**.

---

## Teste 2 — Criar um repasse novo

**O que fazer:**
1. Clique no botão **"+ Novo repasse"**.
2. Escolha um vendedor que você sabe que tem vendas recentes (comissões pendentes).
3. Observe a tela antes de confirmar.

**O que deve acontecer:**
- O sistema sugere automaticamente um período de datas.
- O sistema mostra, antes mesmo de você confirmar, **qual valor será pago** a esse vendedor.

---

## Teste 3 — O sistema não deixa pagar "vendas muito recentes"

Existe uma regra de segurança: vendas dos últimos 5 dias não podem entrar num repasse ainda (para dar tempo de cancelamentos/estornos acontecerem antes do pagamento).

**O que fazer:**
1. Na criação de um repasse, tente escolher um período que termine em uma data de até 5 dias atrás (por exemplo, ontem ou hoje).

**O que deve acontecer:**
- O sistema **não permite** — deve aparecer uma mensagem clara explicando que o período ainda não pode ser fechado.

---

## Teste 4 — Criar um repasse válido e conferir na lista

**O que fazer:**
1. Crie um repasse com um período mais antigo que 5 dias, para um vendedor com comissões pendentes.
2. Volte para a lista de repasses.

**O que deve acontecer:**
- O novo repasse aparece na lista, com status **"Pendente"**.
- (Se possível, peça para alguém técnico confirmar no banco de dados que as comissões desse vendedor, dentro daquele período, ficaram associadas a esse repasse — mas continuam marcadas como "Pendente", não "Pago".)

---

## Teste 5 — Ver o detalhe do repasse

**O que fazer:**
1. Clique no repasse que você acabou de criar para abrir os detalhes.

**O que deve acontecer:**
- Aparecem os dados bancários e/ou a chave PIX do vendedor.
- Aparece a lista das vendas (comissões) que compõem esse repasse.

---

## Teste 6 — Marcar o repasse como pago

**O que fazer:**
1. Ainda na tela de detalhe, clique em **"Processar"**.
2. Confirme na janela que aparece.

**O que deve acontecer:**
- O status do repasse muda para **"Pago"**.
- Na tela de Comissões, as vendas que faziam parte desse repasse também aparecem agora como **"Pago"**.

---

## Teste 7 — Cancelar um repasse

**O que fazer:**
1. Crie um segundo repasse, para outro vendedor.
2. Em vez de processar, clique em **"Cancelar"**.

**O que deve acontecer:**
- O status do repasse muda para **"Cancelado"**.
- As vendas que estavam naquele repasse voltam a aparecer como **"Pendente"** na tela de Comissões — como se nunca tivessem sido colocadas em um repasse.

---

## Teste 8 — Venda que "chega atrasada" (caso mais raro, mas importante)

Esse teste cobre uma situação específica: uma venda cujo pagamento só é confirmado dias depois de um repasse daquele período já ter sido criado.

**Esse teste é mais difícil de reproduzir sozinho** — normalmente precisa de ajuda de alguém técnico para simular a confirmação atrasada de um pagamento. Se não for possível reproduzir, não é um problema: registre que esse teste específico não foi feito e por quê.

**O que deve acontecer, se for possível testar:**
- A venda atrasada é automaticamente associada ao repasse pendente do período correspondente.
- O valor do repasse aumenta para incluir essa venda.
- Quando o repasse for processado, essa venda atrasada também vira "Pago".

---

## O que anotar se algo der errado

Para cada teste que falhar, anote:
- Qual número de teste falhou.
- O que você esperava ver, e o que apareceu na tela em vez disso.
- Um print da tela, se possível.

Essas informações são suficientes para quem desenvolveu a funcionalidade entender e corrigir o problema — não precisa investigar a causa, só descrever o que foi visto.
