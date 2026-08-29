# PB Promoções v2.1

Painel web para cadastrar links `meli.la` já afiliados, carregar os grupos do
WhatsApp conectado e enviar ofertas com foto e texto personalizado.

## Recursos

- Login e criação de conta pelo Supabase Auth.
- Cadastro de links afiliados sem alterar a URL informada.
- Leitura de título, preço e foto do Mercado Livre.
- Lista real dos grupos da conta conectada por QR Code.
- Seleção de produtos e grupos.
- Fila sequencial com histórico e motivo de falha visível.
- Confirmação do retorno de `sendMessage` antes de marcar como enviado.
- Fallback automático para texto se o envio da foto falhar.
- Volume persistente para sessão do WhatsApp e dados do painel.

## Publicação

Use o `Dockerfile` no EasyPanel, porta `3000` e um volume em `/app/data`.
As instruções completas estão em [PUBLICAR_EASYPANEL.md](PUBLICAR_EASYPANEL.md).

Variáveis obrigatórias:

```text
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
APP_URL=
SIGNUP_ACCESS_CODE=
ALLOW_SIGNUPS=true
COOKIE_SECURE=true
PORT=3000
DATA_DIR=/app/data
WWEBJS_AUTH_PATH=/app/data/.wwebjs_auth
```

Não use uma chave `service_role` do Supabase. A chave pública/publishable é a
correta para este aplicativo.

## Desenvolvimento local

```bash
npm ci
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
- As contas criadas com o código de acesso compartilham a mesma operação desta
  instalação (WhatsApp, produtos, grupos e histórico).
- O painel não lê mensagens recebidas nem copia links de outros grupos. Ele
  envia somente os produtos cadastrados e selecionados por um usuário logado.
- `whatsapp-web.js` usa automação não oficial do WhatsApp Web. O funcionamento
  pode ser afetado por mudanças do WhatsApp e deve ser usado respeitando as
  regras da plataforma e dos grupos.
