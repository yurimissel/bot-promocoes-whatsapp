# Publicar no EasyPanel

Esta versão executa o bot em Docker com Chromium e mantém a sessão do
WhatsApp em um volume persistente.

## 1. Envie o projeto para um repositório

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
SOURCE_GROUPS=ID_DO_GRUPO_FONTE@g.us
DEST_GROUP=ID_DO_GRUPO_DESTINO@g.us
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

Para vários grupos fonte, separe os IDs com vírgula e sem espaços.

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

Depois, escaneie o QR Code em WhatsApp → Aparelhos conectados.

## Observações

- O link de afiliado continua no modo simulado do projeto original.
- Esta versão ainda encaminha somente texto; fotos não foram adicionadas.
- Não publique a tela do QR sem `ADMIN_PASSWORD`.
