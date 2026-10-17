# Upload de Foto do Produto no Painel do Vendedor — Design

**Status**: Aprovado (17/10/2026). O usuário pediu para
seguir as melhores práticas sem rodada de perguntas; todas as decisões abaixo
são de quem escreveu o spec.

Branch: `feature/upload-foto-produto` (a partir de `develop`).

## Contexto e motivo

Item 7 da fila do HANDOFF. Hoje o painel do vendedor (`/painel/produtos/novo`
e `/painel/produtos/[id]`) só aceita a **URL** de uma imagem já hospedada
("Cole a URL de uma imagem hospedada (ex: Google Drive, Imgur)"). Para quem
vende pelo celular isso é uma barreira:
- links do Google Drive não são imagens diretas, e a foto quebra;
- imagens de terceiros podem sumir;
- o `next/image` só aceita hosts configurados.

O backend já tem o file module do Medusa com o provider local
(`@medusajs/file-local`), servindo `/static` a partir do volume de uploads
(#57). O nginx do OCI já repassa `/static` e aceita corpos de até 20 MB.

## Objetivo

A vendedora escolhe uma foto do celular ou do computador no formulário do
produto. A foto é enviada, aparece em prévia e vira a imagem principal do
produto. A URL colada continua funcionando como alternativa.

## Decisões

### Backend: `POST /seller/uploads`

- Protegido pelo `sellerAuth` que já cobre `/seller` (cookie de sessão).
- `multipart/form-data` com **um** arquivo no campo `file`, lido em memória
  com `multer` (`memoryStorage`, limite de 5 MB, 1 arquivo). O `multer` 2.1.1
  já vem como dependência transitiva do Medusa; vira dependência direta do
  backend, na mesma versão.
- **Tipos aceitos: JPEG, PNG e WebP.** O tipo é conferido pelos bytes iniciais
  do arquivo (assinatura), não pelo `Content-Type` nem pela extensão enviados
  pelo navegador. SVG fica de fora (pode carregar script), e GIF também (não é
  foto de produto).
- O nome salvo é gerado no servidor: `produto-<sellerId>-<uuid>.<ext>`, com a
  extensão do tipo detectado. O nome original do arquivo nunca é usado.
- Gravação pelo `uploadFilesWorkflow` do Medusa, com `access: "public"`.
  Resposta `201 { url }`.
- Erros, com mensagem para a vendedora em pt-BR:
  - sem arquivo → 400 "Escolha uma foto para enviar.";
  - acima de 5 MB → 413 "A foto passa de 5 MB. Escolha uma foto menor.";
  - tipo não aceito → 415 "Envie uma foto em JPG, PNG ou WebP.";
  - falha ao gravar → 500 "Não foi possível enviar a foto. Tente novamente.",
    com o erro bruto só no log.
- **Limite de frequência:** 30 envios por vendedor a cada 10 minutos (chave
  = `sellerId`), com 429 "Muitos envios em pouco tempo. Aguarde alguns
  minutos.". Evita encher o disco por abuso de uma conta.

### Vitrine: formulários de produto do painel

- O campo "URL da imagem principal" vira **"Foto principal"**, com:
  - botão "Escolher foto" (`<input type="file" accept="image/jpeg,image/png,image/webp">`).
    No iPhone, o `accept` sem HEIC faz o próprio Safari converter a foto para
    JPEG;
  - prévia da foto atual (enviada ou colada);
  - um link "ou cole o endereço de uma imagem" que mostra o campo de URL de
    hoje.
- Antes de enviar, a vitrine confere tipo e tamanho, para dar retorno
  imediato com as mesmas mensagens do backend. O backend continua sendo a
  validação que vale.
- Durante o envio, o botão mostra "Enviando foto..." e o botão de salvar o
  produto fica desabilitado, para não salvar sem a imagem.
- Em caso de erro, a mensagem aparece junto do campo e a foto anterior fica.
- A função nova `uploadSellerImage(file: File): Promise<string>` fica em
  `lib/seller-api.ts`, ao lado das outras chamadas do painel, e usa
  `credentials: 'include'` como elas.
- O mesmo componente (`ProductImageField`) atende a página de criação e a de
  edição.

## Não objetivos

- Galeria com várias fotos por produto (hoje só existe `thumbnail`).
- Redimensionar, comprimir ou recortar a imagem no servidor.
- Apagar do disco as fotos enviadas e não usadas (órfãs).
- Mover os arquivos para um storage externo (S3/Spaces). Fica para a ida a
  produção, quando o provedor for escolhido.
- Foto de perfil ou logo da loja.

## Riscos

- **Disco do servidor:** sem limpeza de órfãs, o volume cresce. Com 5 MB por
  foto e o limite de frequência, o crescimento por abuso fica contido. A
  limpeza fica registrada como pendência.
- **`BACKEND_URL`:** a URL devolvida usa `BACKEND_URL/static`. No servidor de
  teste ela aponta para o site público, cujo host o `next/image` já aceita
  (#58). Isso precisa ser conferido no teste ponta a ponta.

## Testes

- Backend, unitários:
  - detecção de tipo pela assinatura: JPEG, PNG e WebP aceitos; GIF, SVG,
    PDF e um arquivo com extensão `.jpg` mas conteúdo de texto recusados;
  - rota: sem arquivo → 400; tipo recusado → 415; sucesso → 201 com `url`,
    com o nome gerado no servidor (sem o nome original) e `access: "public"`;
    falha do workflow → 500 sem o erro bruto na resposta;
  - limite de 5 MB → 413.
- Vitrine:
  - `uploadSellerImage` envia `FormData` com o campo `file` e devolve a `url`,
    e lança a mensagem do backend em erro;
  - `ProductImageField`: escolher uma foto válida mostra "Enviando foto..." e
    depois a prévia, e preenche a URL; um arquivo grande ou de tipo errado
    mostra a mensagem sem chamar o backend; um erro do backend mantém a foto
    anterior;
  - as páginas de criação e edição enviam o `thumbnail` vindo do upload.
- Ponta a ponta no servidor de teste: entrar como vendedora de teste, criar
  um produto com foto enviada, ver a foto na página pública do produto e
  conferir o arquivo em `/static`.
