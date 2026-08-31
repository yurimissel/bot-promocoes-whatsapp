# PB Promoções v2.3 — publicação e acesso

Esta versão mantém a sessão e os dados operacionais no volume `/app/data`,
abre o cadastro ao público e deixa toda conta nova sem permissões. Somente o
e-mail definido como proprietário pode liberar cada função.

## 1. Preparar a autenticação

1. No painel do Supabase, crie ou abra o projeto.
2. Em **Settings → API Keys**, copie:
   - a **Publishable key**;
   - uma **Secret key** exclusiva para este servidor. A chave `service_role`
     antiga também funciona, mas a Secret key é a opção atual recomendada.
3. Em **Authentication → URL Configuration**:
   - use o endereço HTTPS do painel como **Site URL**;
   - adicione o mesmo endereço em **Redirect URLs**.
4. Mantenha o cadastro por e-mail e senha habilitado.

Para enviar confirmação a qualquer endereço, configure um SMTP próprio em
**Authentication → SMTP**. O servidor de e-mail padrão do Supabase só entrega
para endereços que fazem parte da equipe do projeto e não serve para cadastro
público em produção. Depois de configurar o SMTP, o botão **Reenviar e-mail de
confirmação** do painel funciona normalmente.

Não é necessário criar tabela nem executar SQL. As permissões ficam no campo
protegido `app_metadata` de cada conta e só são alteradas pelo servidor.

## 2. Criar a conta proprietária

Para não depender do primeiro e-mail:

1. Abra **Authentication → Users → Add user → Create new user**.
2. Informe o e-mail que será usado como `OWNER_EMAIL` e uma senha nova e privada.
3. Marque **Auto Confirm User** e conclua.

Não grave a senha em variável, arquivo ou GitHub. Ela é digitada apenas na tela
de criação da conta e depois no login.

## 3. Variáveis privadas do aplicativo

Na área **Environment**, configure:

```text
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_PUBLISHABLE_KEY=SUA_CHAVE_PUBLICA
SUPABASE_SECRET_KEY=SUA_CHAVE_SECRETA_DO_SERVIDOR
OWNER_EMAIL=proprietario@exemplo.com
PUBLIC_APP_URL=https://SEU-DOMINIO-DO-PAINEL
COOKIE_SECURE=true

PORT=3000
DATA_DIR=/app/data
WWEBJS_AUTH_PATH=/app/data/.wwebjs_auth
WHATSAPP_START_DELAY_MS=35000
LOG_LEVEL=INFO
```

Nunca coloque `SUPABASE_SECRET_KEY` no repositório. Ela deve existir somente na
configuração privada do serviço.

## 4. Atualizar o aplicativo

1. Substitua os arquivos antigos do repositório pelos desta versão.
2. Não remova o volume montado em `/app/data`.
3. Faça o commit e implante a nova versão.
4. Aguarde o serviço ficar saudável e mais 35 a 60 segundos para a sessão do
   WhatsApp ser carregada.

Durante o build, o `Dockerfile` aplica automaticamente a compatibilidade exigida
pelas versões atuais do WhatsApp Web. Não edite arquivos dentro de
`node_modules` e não é necessário criar nenhuma variável adicional.

O WhatsApp já conectado será reaproveitado pelo volume. Gere outro QR somente
se a sessão tiver sido desconectada no celular.

## 5. Cadastro e liberação de usuários

1. Qualquer visitante pode usar **Criar conta**; não há código de acesso.
2. Depois da confirmação do e-mail, a conta entra em **Aguardando liberação**.
3. Entre com a conta proprietária e abra **Usuários e acessos**.
4. Marque separadamente as funções permitidas e clique em **Salvar permissões**.
5. O usuário pode clicar em **Verificar liberação**; o painel também atualiza as
   permissões automaticamente.

A conta proprietária sempre tem acesso completo. A permissão **WhatsApp** deve
ser concedida somente a quem realmente puder conectar, trocar ou administrar a
sessão. A chave secreta nunca é enviada ao navegador.

## 6. Envio de teste

1. Cole um link `meli.la` que já seja seu link afiliado.
2. Selecione o produto e apenas um grupo em que o número possa publicar.
3. Clique em **Enviar ofertas**.
4. O lote passa por `NA FILA`, `ENVIANDO` e só fica `CONCLUÍDO` depois que o
   WhatsApp aceita e cria a mensagem de saída.
5. Se a foto falhar, o painel tenta o texto com o link. Se o envio falhar, o
   motivo fica visível no histórico.

O aplicativo não lê mensagens recebidas e não copia links de outros grupos.
Somente os links cadastrados e selecionados no painel são enviados.
