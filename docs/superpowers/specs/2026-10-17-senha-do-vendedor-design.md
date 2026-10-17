# Senha do Vendedor (Configurar e Redefinir) — Design

**Status**: Aprovado (17/10/2026). O usuário pediu para
decidir pelas melhores práticas; as decisões abaixo são de quem escreveu o spec.

Branch: `fix/senha-vendedor` (a partir de `develop`).

## Contexto e motivo

Achado ao preparar o item 8 (cobertura de testes):

1. **Nenhuma vendedora aprovada consegue definir a senha pelo site.**
   - O e-mail de aprovação (`subscribers/seller-approved-email.ts`) aponta para
     `/vendedor/configurar-senha?email=...`, sem token.
   - A página envia `{ email, password }`.
   - Sem `token`, `POST /store/sellers/set-password` trata o pedido como
     "pedir redefinição": gera um token, só registra no log (nenhum e-mail
     sai) e responde 200.
   - A página mostra "Senha configurada!", mas nada é gravado.
   - Os tokens ficam num `Map` em memória e se perdem a cada reinício.
   - No servidor de teste, só 2 vendedoras têm senha, definidas por outro
     caminho.
2. **As rotas do admin devolvem o `passwordHash`.**
   - Afetadas: `GET`/`POST /admin/sellers`, `GET`/`POST /admin/sellers/:id`,
     e `approve`, `reject`, `activate` e `suspend`.
   - As rotas `/seller/me` e as da loja já removem o campo.

## Objetivo

- A vendedora aprovada recebe um link que funciona e define a senha.
- Quem esqueceu a senha pede um link por e-mail e redefine.
- Nenhuma resposta de API devolve o hash da senha.

## Decisões

### Token de senha

- Modelo novo no módulo `seller`: `seller_password_token` com estes campos:
  - `id`;
  - `sellerId`;
  - `tokenHash` (único);
  - `expiresAt`;
  - `usedAt` (pode ser nulo).

  A migration vem junto.
- O token é gerado com 32 bytes aleatórios e enviado em hex. **Só o SHA-256
  do token é guardado.** Quem ler o banco não consegue usar o link.
- Validade:
  - **7 dias** para o link da aprovação, porque a vendedora pode demorar a
    abrir o e-mail;
  - **1 hora** para "esqueci minha senha".
- Emitir um token novo invalida os anteriores ainda não usados da mesma
  vendedora: marca `usedAt`.
- O consumo é **atômico e de uso único**: um `UPDATE … SET usedAt = now()
  WHERE tokenHash = $1 AND usedAt IS NULL AND expiresAt > now() RETURNING
  sellerId`, no mesmo padrão do `checkout_snapshot`. Dois envios do mesmo
  link não gravam duas senhas.
- Métodos do serviço:
  - `issuePasswordToken(sellerId, ttlMs): Promise<string>`, que devolve o
    token cru;
  - `consumePasswordToken(rawToken): Promise<string | null>`, que devolve o
    `sellerId`.

### `POST /store/sellers/set-password`

A rota fica no mesmo caminho, que já tem o limite de tentativas do login, e
continua com dois modos:

- **`{ email }`, pedir link:**
  - responde sempre 200 com a mensagem genérica de hoje, para não revelar
    quais e-mails existem;
  - se a vendedora existe e está `approved` ou `active`, emite um token de 1
    hora e envia o e-mail "Redefinir sua senha" pelo Brevo, com o link
    `/vendedor/configurar-senha?token=<token>`;
  - o token nunca vai para o log.
- **`{ token, password }`, definir a senha:**
  - a senha precisa ter no mínimo 8 caracteres (400 com a mensagem de hoje);
  - consome o token: se for inválido, expirado ou já usado, responde 400
    "Link inválido ou expirado. Peça um novo.";
  - se a vendedora não está `approved` nem `active`, responde 403 com a
    mensagem de hoje;
  - se estiver, grava o hash, passa o status para `active` e responde 200;
  - **o e-mail deixa de ser pedido:** o token já identifica a vendedora.

### E-mail de aprovação

O subscriber emite um token de 7 dias e manda o link
`/vendedor/configurar-senha?token=<token>`. O resto do texto continua igual.

### Página `/vendedor/configurar-senha`

- **Com `?token=`:** mostra o formulário de senha e confirmação, como hoje, e
  envia `{ token, password }`.
  - No sucesso, mostra a tela de hoje.
  - No erro, mostra a mensagem do backend e um link "Pedir um novo link".
- **Sem token:** mostra o formulário "Esqueceu a senha?", com o campo
  e-mail. Ao enviar, aparece "Se o e-mail estiver cadastrado, você
  receberá um link para redefinir a senha.".
- A página de login do painel ganha o link "Esqueci minha senha", que leva
  para essa página.

### Admin sem `passwordHash`

Uma função única, `toAdminSeller(seller)`, remove o `passwordHash`. Todas as
rotas `/admin/sellers*` respondem com ela.

## Não objetivos

- Trocar a senha estando logada, no perfil.
- Expirar as sessões abertas depois de uma redefinição.
- Mudar o cadastro, a aprovação ou o login.

## Testes

- **Serviço**, contra o banco de teste do projeto se já houver padrão de
  teste de módulo; senão, testes da SQL pelo `manager` mockado, como nos
  testes do `checkout`:
  - o token emitido funciona uma vez;
  - um token expirado ou já usado devolve `null`;
  - emitir um token novo invalida o anterior;
  - o banco guarda o hash, não o token cru.
- **Rota `set-password`:**
  - `{ email }` de quem não existe ou está `pending` responde 200 genérico,
    sem e-mail;
  - `{ email }` de vendedora aprovada emite o token de 1 hora e manda o
    e-mail com o link, e o token não aparece no log;
  - `{ token, password }` válido grava o hash e ativa a vendedora;
  - token inválido responde 400;
  - senha curta responde 400;
  - vendedora suspensa responde 403.
- **Subscriber:** emite o token de 7 dias, e o link do e-mail tem `?token=`
  e não tem o e-mail.
- **Admin:** cada rota de `/admin/sellers*` responde sem `passwordHash`.
- **Página:**
  - com token, envia `{ token, password }` e mostra o sucesso;
  - um erro mostra a mensagem e o link para pedir outro;
  - sem token, o formulário de e-mail chama o pedido de link;
  - a página de login tem "Esqueci minha senha".
- **Ponta a ponta no ambiente local:**
  - sem `BREVO_API_KEY`, nenhum e-mail sai, e o token nunca é registrado no
    log;
  - por isso o teste emite um token com `npx medusa exec` chamando
    `issuePasswordToken`;
  - depois abre o link, define a senha e entra no painel;
  - confere também que o mesmo link não funciona uma segunda vez.
- **No servidor de teste**, o modo sandbox manda os e-mails para
  `TEST_EMAIL_RECIPIENT`. O usuário pode conferir o e-mail real da
  aprovação.
