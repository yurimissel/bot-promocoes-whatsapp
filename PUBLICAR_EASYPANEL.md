# PB Promoções v2.1 — atualizar no EasyPanel

Esta versão adiciona login e criação de conta com Supabase e corrige o envio
dos lotes pelo WhatsApp. Produtos, sessão do WhatsApp e histórico continuam no
volume persistente `/app/data`.

## 1. Criar o projeto no Supabase

1. Crie um projeto em <https://supabase.com/dashboard>.
2. Abra **Project Settings → API**.
3. Copie a **Project URL**.
4. Copie a **Publishable key**. Em projetos antigos, a chave `anon` também é
   aceita. Nunca use a chave `service_role` neste aplicativo.
5. Em **Authentication → URL Configuration**, coloque o domínio HTTPS do
   aplicativo no campo **Site URL** e também em **Redirect URLs**.

Não é preciso criar tabelas nem executar SQL. As contas ficam no Supabase Auth.

## 2. Variáveis do EasyPanel

Na aba **Environment**, substitua a autenticação antiga pelas variáveis abaixo:

```text
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_PUBLISHABLE_KEY=SUA_CHAVE_PUBLICA
APP_URL=https://SEU-DOMINIO-DO-EASYPANEL
ALLOW_SIGNUPS=true
SIGNUP_ACCESS_CODE=CRIE_UM_CODIGO_PRIVADO_COM_8_OU_MAIS_CARACTERES
COOKIE_SECURE=true

PORT=3000
DATA_DIR=/app/data
WWEBJS_AUTH_PATH=/app/data/.wwebjs_auth
WHATSAPP_START_DELAY_MS=35000
LOG_LEVEL=INFO
```

Remova `ADMIN_PASSWORD`: a proteção agora é feita pelo Supabase.

O `SIGNUP_ACCESS_CODE` impede que qualquer visitante crie uma conta e use o
WhatsApp conectado. Compartilhe esse código apenas com pessoas autorizadas.
Depois de criar as contas necessárias, você pode definir `ALLOW_SIGNUPS=false`.

## 3. Atualizar o código

1. Substitua no repositório todos os arquivos antigos pelos arquivos desta
   versão.
2. Não remova o volume `bot-data` montado em `/app/data`.
3. Faça o commit no GitHub.
4. No EasyPanel, clique em **Implantar**.
5. Aguarde o aplicativo ficar **Healthy** e mais 35 a 60 segundos para a sessão
   do Chromium ser carregada.

O WhatsApp já conectado será reaproveitado pelo volume. Não é necessário
escanear outro QR, salvo se a sessão tiver sido desconectada no celular.

## 4. Primeiro acesso

1. Abra o domínio do painel.
2. Clique em **Criar conta**.
3. Informe nome, e-mail, senha e o `SIGNUP_ACCESS_CODE`.
4. Se a confirmação de e-mail estiver habilitada no Supabase, confirme o link
   recebido e depois entre.
5. Abra **WhatsApp e grupos** e confirme que o status está `CONECTADO`.

## 5. Envio de teste

1. Cole um link `meli.la` que já seja seu link afiliado.
2. Selecione o produto e somente um grupo em que você possa enviar mensagens.
3. Clique em **Enviar ofertas**.
4. O painel mostrará `NA FILA`, `ENVIANDO` e somente depois `CONCLUÍDO`.
5. Se o WhatsApp recusar, o lote mostrará `FALHOU` e o motivo completo.

O envio tenta publicar foto e legenda. Se apenas a foto falhar, o texto com seu
link é enviado automaticamente para não perder a oferta.
O intervalo configurado é respeitado entre cada mensagem enviada aos grupos.

## Segurança e funcionamento

- Todos os endpoints de produtos, grupos, WhatsApp e envios exigem uma sessão
  válida do Supabase.
- Os tokens ficam em cookies HttpOnly; não são expostos ao JavaScript da página.
- As contas autorizadas compartilham o mesmo WhatsApp e o mesmo painel desta
  instalação.
- Use apenas grupos nos quais você tem autorização para divulgar ofertas.
- Esta versão não inicia a automação antiga do repositório original e não lê
  mensagens de grupos. Somente links cadastrados no painel são enviados.
- A imagem remove o pacote `extract-zip` depois da instalação. Ele pertence ao
  downloader do Puppeteer, não é necessário porque o Chromium é instalado pelo
  Debian, e atualmente não possui uma versão corrigida publicada.
