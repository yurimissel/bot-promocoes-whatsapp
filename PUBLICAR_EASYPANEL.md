# PB Promoções v1.1 — publicar/atualizar no EasyPanel

Esta versão oferece um painel web para salvar links afiliados prontos do
Mercado Livre, selecionar os grupos do WhatsApp conectado e enviar as ofertas
com foto e mensagem personalizada. A sessão, os produtos e o histórico ficam
em um volume persistente.

## Atualizar um aplicativo já implantado

1. Substitua no seu repositório os arquivos antigos pelos desta versão.
2. Preserve as variáveis do EasyPanel e o volume `bot-data` em `/app/data`.
3. Deixe `SOURCE_GROUPS` e `DEST_GROUP` vazios; o painel permite escolher os
   grupos diretamente na tela.
4. Faça commit das alterações no GitHub.
5. No EasyPanel, clique em **Implantar**.

Sua sessão do WhatsApp será reaproveitada automaticamente.

## 1. Nova instalação: envie o projeto para um repositório

Extraia o ZIP e envie todos os arquivos para um repositório privado no GitHub.
Não crie nem envie um arquivo `.env`.

## 2. Crie o aplicativo no EasyPanel

1. Abra o projeto desejado no EasyPanel.
2. Crie um novo **App**.
3. Escolha o repositório do GitHub.
4. Selecione **Dockerfile** como método de build.
5. Use `Dockerfile` como caminho do arquivo.
6. Configure a porta `3000`.

## 3. Configure o volume persistente

Na área de volumes/mounts, crie um volume persistente com:

```text
/app/data
```

Sem esse volume, será necessário escanear o QR Code novamente depois de cada
reinicialização.

## 4. Configure as variáveis

Na aba **Environment**, adicione:

```text
ADMIN_PASSWORD=SUA_SENHA_FORTE
SOURCE_GROUPS=
DEST_GROUP=
PORT=3000
DATA_DIR=/app/data
WWEBJS_AUTH_PATH=/app/data/.wwebjs_auth
QUEUE_DELAY_MIN=120000
QUEUE_DELAY_MAX=300000
TYPING_DELAY_MIN=3000
TYPING_DELAY_MAX=8000
QUEUE_CHECK_INTERVAL=30000
LOG_LEVEL=INFO
```

`SOURCE_GROUPS` e `DEST_GROUP` pertencem à automação antiga do projeto
original. Mantenha ambos vazios para usar somente o painel.

## 5. Domínio e publicação

1. Adicione um domínio ao aplicativo apontando para a porta `3000`.
2. Ative HTTPS.
3. Clique em **Deploy**.
4. Aguarde o estado ficar **Healthy**.
5. Abra o domínio no navegador.

O navegador pedirá:

```text
Usuário: admin
Senha: valor configurado em ADMIN_PASSWORD
```

Depois, escaneie o QR Code em WhatsApp → Aparelhos conectados. O painel então
listará automaticamente todos os grupos disponíveis.

## Como usar o painel

1. Cole um ou vários links `meli.la` já gerados na sua conta de afiliado.
2. O painel busca título, preço e foto do produto e salva o link sem alterá-lo.
3. Selecione produtos e grupos.
4. Ajuste o intervalo e clique em **Enviar ofertas**.
5. O lote continua rodando mesmo que a página seja fechada.

## Segurança

- Não publique a tela sem `ADMIN_PASSWORD`.
- Use apenas grupos nos quais você tem permissão para divulgar ofertas.
- A automação antiga de conversão de afiliados continua como placeholder, mas
  não é iniciada quando `SOURCE_GROUPS` e `DEST_GROUP` ficam vazios.
