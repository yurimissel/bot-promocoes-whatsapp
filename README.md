# PB Promoções v2.3

Painel web para cadastrar links `meli.la` já afiliados, selecionar grupos do
WhatsApp e enviar ofertas com foto e mensagem personalizada.

## Recursos

- Login e cadastro público com confirmação de e-mail e reenvio da confirmação.
- Conta proprietária definida por variável privada do servidor.
- Contas novas sem acesso até o proprietário liberar cada permissão.
- Administração individual de Visão geral, Produtos, Grupos, Envios, Modelo e WhatsApp.
- Verificação das permissões no servidor em todas as rotas protegidas.
- Cadastro de links afiliados sem alterar a URL informada.
- Lista real dos grupos da conta conectada por QR Code.
- Fila sequencial, histórico, confirmação do envio e erro detalhado.
- Foto com fallback automático para texto.
- Correção automática para a mudança de IDs do WhatsApp Web 2.3000.x (`r: r`).
- Envio sem a opção instável que causava falso sucesso ou falso erro.
- Sessão do WhatsApp e dados operacionais persistidos em `/app/data`.

## Publicação

Use o `Dockerfile`, exponha a porta `3000` e mantenha um volume em `/app/data`.
As instruções completas estão em [PUBLICAR_EASYPANEL.md](PUBLICAR_EASYPANEL.md).

Variáveis obrigatórias:

```text
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
OWNER_EMAIL=
PUBLIC_APP_URL=
COOKIE_SECURE=true
PORT=3000
DATA_DIR=/app/data
WWEBJS_AUTH_PATH=/app/data/.wwebjs_auth
```

A chave secreta é usada somente pelo servidor para listar contas e salvar
permissões em `app_metadata`. Nunca coloque essa chave no JavaScript público ou
no repositório.

## Desenvolvimento local

```bash
npm ci
node scripts/patch-whatsapp-web.js
npm test
npm run web
```

Para validar a interface sem iniciar o Chromium:

```bash
DISABLE_WHATSAPP=true node web-setup.js
```

## Observações

- O painel envia exatamente o link afiliado cadastrado; ele não gera nem troca
  links automaticamente.
- O painel não lê mensagens recebidas nem copia links de outros grupos.
- Somente o proprietário ou um usuário com a permissão `WhatsApp` pode ver o QR
  Code e administrar a sessão.
- `whatsapp-web.js` usa automação não oficial do WhatsApp Web. O funcionamento
  pode ser afetado por mudanças do WhatsApp e deve respeitar as regras da
  plataforma e dos grupos.
