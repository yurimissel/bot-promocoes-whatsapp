#!/usr/bin/env node

/**
 * Interface Web para Autenticação do WhatsApp
 * Mostra QR Code bonitão no navegador
 * Acesso: http://localhost:3000
 */

const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const path = require('path');
const crypto = require('crypto');
const logger = require('./src/utils/logger');

const app = express();
const PORT = Number.parseInt(process.env.PORT || '3000', 10);

let qrCodeData = null;
let isAuthenticated = false;
let connectionStatus = 'Conectando...';
let mainBotStarted = false;
let queueControls = null;
let shuttingDown = false;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function secureEquals(left, right) {
  const leftHash = crypto.createHash('sha256').update(String(left)).digest();
  const rightHash = crypto.createHash('sha256').update(String(right)).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function requireAdminAuth(req, res, next) {
  // O health check precisa ficar acessível ao EasyPanel.
  if (req.path === '/api/health') return next();

  if (!ADMIN_PASSWORD) {
    return res.status(503).send('Configure ADMIN_PASSWORD no EasyPanel.');
  }

  const authorization = req.headers.authorization || '';
  const match = authorization.match(/^Basic\s+(.+)$/i);

  if (match) {
    try {
      const decoded = Buffer.from(match[1], 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      const username = separator >= 0 ? decoded.slice(0, separator) : '';
      const password = separator >= 0 ? decoded.slice(separator + 1) : '';

      if (username === 'admin' && secureEquals(password, ADMIN_PASSWORD)) {
        return next();
      }
    } catch (_) {
      // Responde com novo pedido de autenticação.
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="Painel do bot", charset="UTF-8"');
  res.set('Cache-Control', 'no-store');
  return res.status(401).send('Autenticação necessária.');
}

app.use(requireAdminAuth);

// --- Configurar Client WhatsApp ---
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: process.env.WWEBJS_AUTH_PATH || path.resolve(__dirname, '.wwebjs_auth'),
  }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
    ],
  },
});

// --- Eventos do Client ---
client.on('qr', async (qr) => {
  logger.info('QR Code gerado — acesse o domínio configurado no EasyPanel');
  qrCodeData = qr;
  connectionStatus = 'QR Code pronto — escaneie com o celular';
});

client.on('authenticated', () => {
  logger.info('✅ Autenticação bem-sucedida!');
  isAuthenticated = true;
  connectionStatus = 'Autenticado! Iniciando bot...';
});

client.on('ready', () => {
  logger.info('✅ Bot conectado e pronto para operar!');
  connectionStatus = 'Bot conectado — você pode fechar esta página';

  setTimeout(() => {
    logger.info('Iniciando bot principal em 3 segundos...');
    setTimeout(() => {
      startMainBot();
    }, 3000);
  }, 2000);
});

client.on('auth_failure', (msg) => {
  logger.error('❌ Falha na autenticação:', msg);
  connectionStatus = `Erro: ${msg}`;
});

client.on('disconnected', (reason) => {
  logger.warn('⚠️  Desconectado:', reason);
  isAuthenticated = false;
  connectionStatus = `Desconectado: ${reason}`;
});

// --- Página HTML do QR Code ---
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Bot WhatsApp — Autenticação</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }

        .container {
          background: white;
          border-radius: 20px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          padding: 40px;
          max-width: 600px;
          width: 100%;
          text-align: center;
        }

        .header {
          margin-bottom: 30px;
        }

        .logo {
          font-size: 48px;
          margin-bottom: 10px;
        }

        h1 {
          color: #333;
          font-size: 28px;
          margin-bottom: 10px;
        }

        .subtitle {
          color: #666;
          font-size: 16px;
          margin-bottom: 5px;
        }

        .status {
          display: inline-block;
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 14px;
          font-weight: 500;
          margin-top: 10px;
        }

        .status.connecting {
          background: #fff3cd;
          color: #856404;
        }

        .status.ready {
          background: #d4edda;
          color: #155724;
        }

        .status.authenticated {
          background: #d1ecf1;
          color: #0c5460;
        }

        .status.success {
          background: #d4edda;
          color: #155724;
        }

        .status.error {
          background: #f8d7da;
          color: #721c24;
        }

        .qr-container {
          background: #f8f9fa;
          border-radius: 15px;
          padding: 30px;
          margin: 30px 0;
          display: flex;
          justify-content: center;
          min-height: 350px;
          align-items: center;
        }

        #qrCode {
          max-width: 300px;
          width: 100%;
          height: auto;
        }

        .loading {
          display: inline-block;
          width: 40px;
          height: 40px;
          border: 4px solid #f3f3f3;
          border-top: 4px solid #667eea;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .instructions {
          background: #e7f3ff;
          border-left: 4px solid #2196F3;
          padding: 20px;
          border-radius: 8px;
          margin: 20px 0;
          text-align: left;
          font-size: 14px;
          line-height: 1.6;
          color: #333;
        }

        .instructions h3 {
          color: #2196F3;
          margin-bottom: 10px;
          font-size: 16px;
        }

        .instructions ol {
          margin-left: 20px;
        }

        .instructions li {
          margin-bottom: 8px;
        }

        .info-box {
          background: #f0f0f0;
          padding: 15px;
          border-radius: 8px;
          margin: 20px 0;
          font-size: 13px;
          color: #666;
        }

        .button-group {
          margin-top: 30px;
          display: flex;
          gap: 10px;
          justify-content: center;
        }

        button {
          padding: 12px 24px;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          cursor: pointer;
          font-weight: 600;
          transition: all 0.3s ease;
        }

        .btn-primary {
          background: #667eea;
          color: white;
        }

        .btn-primary:hover {
          background: #5568d3;
          transform: translateY(-2px);
          box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
        }

        .btn-secondary {
          background: #e0e0e0;
          color: #333;
        }

        .btn-secondary:hover {
          background: #d0d0d0;
        }

        .success-message {
          display: none;
          text-align: center;
        }

        .success-icon {
          font-size: 60px;
          margin: 20px 0;
          animation: bounce 0.6s ease-in-out;
        }

        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-20px); }
        }

        footer {
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #eee;
          font-size: 12px;
          color: #999;
        }

        .spinner {
          display: inline-block;
          width: 20px;
          height: 20px;
          border: 3px solid rgba(102, 126, 234, 0.3);
          border-radius: 50%;
          border-top-color: #667eea;
          animation: spin 1s ease-in-out infinite;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">💬</div>
          <h1>Bot de Promoções WhatsApp</h1>
          <p class="subtitle">Autenticação Visual</p>
          <div class="status connecting" id="status">
            <span class="spinner"></span> ${connectionStatus}
          </div>
        </div>

        <div class="qr-container" id="qrContainer">
          <div class="loading"></div>
        </div>

        <div class="instructions">
          <h3>📱 Como conectar:</h3>
          <ol>
            <li>Pegue o celular com a conta do WhatsApp que será usada pelo bot</li>
            <li>Abra <strong>WhatsApp</strong></li>
            <li>Vá em: <strong>Configurações → Aparelhos conectados → Conectar aparelho</strong></li>
            <li><strong>Aponte a câmera para o QR Code</strong> acima</li>
            <li>Aguarde a confirmação</li>
          </ol>
        </div>

        <div class="info-box">
          ⚠️ O QR Code expira em 30 segundos. Se expirar, ele será gerado automaticamente.
        </div>

        <div class="success-message" id="successMessage">
          <div class="success-icon">✅</div>
          <h2>Autenticação bem-sucedida!</h2>
          <p>O bot está iniciando...</p>
          <p style="font-size: 13px; margin-top: 10px; color: #666;">
            Você pode fechar esta página. O bot continuará rodando no servidor.
          </p>
        </div>

        <div class="button-group">
          <button class="btn-primary" onclick="location.reload()">🔄 Recarregar</button>
          <button class="btn-secondary" onclick="window.close()">❌ Fechar</button>
        </div>

        <footer>
          Bot WhatsApp • Fase 1 • ${new Date().getFullYear()}
        </footer>
      </div>

      <script>
        // Atualizar status a cada 2 segundos
        setInterval(async () => {
          try {
            const response = await fetch('/api/status');
            const data = await response.json();

            const statusEl = document.getElementById('status');
            const qrContainer = document.getElementById('qrContainer');
            const successMessage = document.getElementById('successMessage');

            // Atualizar status
            statusEl.textContent = data.status;
            statusEl.className = 'status ' + data.type;

            // Se autenticado, mostrar sucesso
            if (data.authenticated) {
              qrContainer.style.display = 'none';
              successMessage.style.display = 'block';
              statusEl.className = 'status success';

              setTimeout(() => {
                window.close();
              }, 5000);
            } else if (data.qr) {
              // Mostrar QR Code
              qrContainer.innerHTML = \`<img id="qrCode" src="\${data.qr}" alt="QR Code" />\`;
            }
          } catch (e) {
            console.error('Erro ao atualizar status:', e);
          }
        }, 2000);

        // Primeira carga
        window.addEventListener('load', async () => {
          try {
            const response = await fetch('/api/status');
            const data = await response.json();

            if (data.qr) {
              document.getElementById('qrContainer').innerHTML = \`<img id="qrCode" src="\${data.qr}" alt="QR Code" />\`;
            }
          } catch (e) {
            console.error('Erro na primeira carga:', e);
          }
        });
      </script>
    </body>
    </html>
  `);
});

// --- API para status e QR Code ---
app.get('/api/status', async (req, res) => {
  let statusType = 'connecting';
  let statusText = '⏳ Aguardando QR Code...';

  if (isAuthenticated) {
    statusType = 'authenticated';
    statusText = '✅ Autenticado! Iniciando bot...';
  } else if (qrCodeData) {
    statusType = 'ready';
    statusText = '📱 Escaneie o QR Code com o celular';
  }

  let qrImage = null;
  if (qrCodeData) {
    try {
      qrImage = await QRCode.toDataURL(qrCodeData, {
        width: 300,
        margin: 10,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      });
    } catch (e) {
      logger.error('Erro ao gerar QR Code:', e.message);
    }
  }

  res.json({
    status: statusText,
    type: statusType,
    qr: qrImage,
    authenticated: isAuthenticated,
  });
});

// Endpoint usado pelo EasyPanel para verificar se o container está pronto.
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// --- Iniciar Interface Web ---
async function startWebInterface() {
  app.listen(PORT, '0.0.0.0', () => {
    logger.info('');
    logger.info('='.repeat(60));
    logger.info('🌐 INTERFACE WEB INICIADA');
    logger.info('='.repeat(60));
    logger.info(`🔗 Interface disponível na porta ${PORT}`);
    logger.info('');
    logger.info('📱 Instruções:');
    logger.info('  1. Abra o domínio configurado no EasyPanel');
    logger.info('  2. Pegue o celular com a conta do WhatsApp do bot');
    logger.info('  3. Vá em: WhatsApp → Configurações → Aparelhos conectados');
    logger.info('  4. Escaneie o QR Code na página');
    logger.info('');
    logger.info('='.repeat(60));
  });

  // Inicializar client WhatsApp
  setTimeout(() => {
    logger.info('Conectando ao WhatsApp...');
    client.initialize().catch((error) => {
      logger.error('Falha ao inicializar o WhatsApp:', error.message);
      connectionStatus = `Erro ao iniciar: ${error.message}`;
    });
  }, 1000);
}

// --- Função para Iniciar Bot Principal ---
function startMainBot() {
  if (mainBotStarted) {
    logger.info('Bot principal já iniciado. Ignorando nova inicialização.');
    return;
  }

  logger.info('Iniciando bot principal...');

  // Importar e executar o bot
  const config = require('./src/config');
  const { registerListener } = require('./src/services/listener');
  const { startProcessing, stopProcessing, saveBeforeExit } = require('./src/services/queue');

  // Validar configuração
  if (config.sourceGroups.length === 0 || !config.destGroup) {
    logger.warn('');
    logger.warn('⚠️  CONFIGURAÇÃO INCOMPLETA!');
    logger.warn('');
    logger.warn('Para usar o bot, configure:');
    logger.warn('  1. npm run list-groups');
    logger.warn('  2. Edite o arquivo .env');
    logger.warn('  3. Defina SOURCE_GROUPS e DEST_GROUP');
    logger.warn('');
    return;
  }

  // Registrar listener
  registerListener(client);

  // Iniciar fila
  startProcessing(client);

  mainBotStarted = true;
  queueControls = { stopProcessing, saveBeforeExit };

  logger.info('✅ Bot principal iniciado!');
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Encerrando bot por ${signal}...`);

  if (queueControls) {
    queueControls.stopProcessing();
    queueControls.saveBeforeExit();
  }

  try {
    await client.destroy();
    logger.info('Sessão encerrada.');
  } catch (err) {
    logger.warn('Não foi possível encerrar a sessão normalmente:', err.message);
  }

  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

// --- Iniciar ---
startWebInterface();
