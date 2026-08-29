#!/usr/bin/env node

const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const path = require('path');
const crypto = require('crypto');
const config = require('./src/config');
const logger = require('./src/utils/logger');
const store = require('./src/services/panelStore');
const { extractLinks, inspectAffiliateUrl } = require('./src/services/mercadoLivre');
const { enqueueJob } = require('./src/services/panelSender');

const app = express();
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

let qrCodeData = null;
let isAuthenticated = false;
let isReady = false;
let connectionStatus = 'Iniciando WhatsApp...';
let mainBotStarted = false;
let queueControls = null;

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

function secureEquals(left, right) {
  const leftHash = crypto.createHash('sha256').update(String(left)).digest();
  const rightHash = crypto.createHash('sha256').update(String(right)).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function requireAdminAuth(req, res, next) {
  if (req.path === '/api/health') return next();
  if (!ADMIN_PASSWORD) return res.status(503).send('Configure ADMIN_PASSWORD no EasyPanel.');

  const authorization = req.headers.authorization || '';
  const match = authorization.match(/^Basic\s+(.+)$/i);
  if (match) {
    try {
      const decoded = Buffer.from(match[1], 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      const username = separator >= 0 ? decoded.slice(0, separator) : '';
      const password = separator >= 0 ? decoded.slice(separator + 1) : '';
      if (username === 'admin' && secureEquals(password, ADMIN_PASSWORD)) return next();
    } catch (_) {
      // Solicita novamente as credenciais.
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="PB Promocoes", charset="UTF-8"');
  res.set('Cache-Control', 'no-store');
  return res.status(401).send('Autenticação necessária.');
}

function requireSameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  try {
    if (new URL(origin).host !== req.get('host')) {
      return res.status(403).json({ error: 'Origem não autorizada.' });
    }
  } catch (_) {
    return res.status(403).json({ error: 'Origem inválida.' });
  }
  return next();
}

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('X-Frame-Options', 'DENY');
  next();
});
app.use(requireAdminAuth);
app.use(requireSameOrigin);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/status', async (req, res) => {
  let qr = null;
  if (qrCodeData && !isReady) {
    try {
      qr = await QRCode.toDataURL(qrCodeData, { width: 320, margin: 3 });
    } catch (error) {
      logger.error('[Painel] Erro ao montar QR:', error.message);
    }
  }

  res.json({
    authenticated: isAuthenticated,
    ready: isReady,
    status: connectionStatus,
    qr,
  });
});

app.get('/api/groups', async (req, res) => {
  if (!isReady) return res.status(409).json({ error: 'Conecte o WhatsApp primeiro.' });
  try {
    const chats = await client.getChats();
    const groups = chats
      .filter((chat) => chat.isGroup && chat.id && chat.id._serialized)
      .map((chat) => ({
        id: chat.id._serialized,
        name: chat.name || 'Grupo sem nome',
        participants: Array.isArray(chat.participants) ? chat.participants.length : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    return res.json({ groups });
  } catch (error) {
    logger.error('[Painel] Erro ao listar grupos:', error.message);
    return res.status(500).json({ error: 'Não foi possível carregar os grupos.' });
  }
});

app.get('/api/products', (req, res) => res.json({ products: store.listProducts() }));

app.post('/api/products/import', async (req, res) => {
  const links = extractLinks(req.body && req.body.links);
  if (links.length === 0) return res.status(400).json({ error: 'Cole pelo menos um link HTTPS.' });

  const imported = [];
  const errors = [];
  for (const link of links) {
    try {
      const details = await inspectAffiliateUrl(link);
      const result = store.upsertProduct(details);
      imported.push({ ...result.product, created: result.created });
    } catch (error) {
      errors.push({ link, error: error.message });
    }
  }

  return res.status(imported.length > 0 ? 200 : 422).json({ imported, errors });
});

app.delete('/api/products/:id', (req, res) => {
  const removed = store.removeProduct(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Produto não encontrado.' });
  return res.json({ ok: true });
});

app.get('/api/settings', (req, res) => res.json(store.getSettings()));

app.put('/api/settings', (req, res) => {
  const template = String((req.body && req.body.template) || '').trim();
  const defaultDelaySeconds = Number(req.body && req.body.defaultDelaySeconds);
  if (!template.includes('{link}')) {
    return res.status(400).json({ error: 'O modelo precisa conter {link}.' });
  }
  if (template.length > 3000) return res.status(400).json({ error: 'O modelo está muito longo.' });
  if (!Number.isFinite(defaultDelaySeconds) || defaultDelaySeconds < 10 || defaultDelaySeconds > 3600) {
    return res.status(400).json({ error: 'Use um intervalo entre 10 e 3600 segundos.' });
  }
  return res.json(store.updateSettings({ template, defaultDelaySeconds }));
});

app.get('/api/jobs', (req, res) => res.json({ jobs: store.listJobs() }));

app.post('/api/send-jobs', (req, res) => {
  if (!isReady) return res.status(409).json({ error: 'Conecte o WhatsApp primeiro.' });
  const productIds = [...new Set(Array.isArray(req.body.productIds) ? req.body.productIds : [])];
  const groupIds = [...new Set(Array.isArray(req.body.groupIds) ? req.body.groupIds : [])];
  const delaySeconds = Number(req.body.delaySeconds || store.getSettings().defaultDelaySeconds);
  const template = String(req.body.template || store.getSettings().template);

  if (productIds.length === 0 || productIds.length > 100) {
    return res.status(400).json({ error: 'Selecione de 1 a 100 produtos.' });
  }
  if (groupIds.length === 0 || groupIds.length > 20) {
    return res.status(400).json({ error: 'Selecione de 1 a 20 grupos.' });
  }
  if (!template.includes('{link}')) {
    return res.status(400).json({ error: 'O modelo precisa conter {link}.' });
  }
  if (!Number.isFinite(delaySeconds) || delaySeconds < 10 || delaySeconds > 3600) {
    return res.status(400).json({ error: 'Use um intervalo entre 10 e 3600 segundos.' });
  }

  const availableProducts = store.getProducts(productIds);
  if (availableProducts.length !== productIds.length) {
    return res.status(400).json({ error: 'Um dos produtos selecionados não existe mais.' });
  }

  const job = enqueueJob(client, {
    productIds,
    groupIds,
    delaySeconds,
    template,
    shuffle: Boolean(req.body.shuffle),
  });
  return res.status(202).json({ job });
});

app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
}));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

client.on('qr', (qr) => {
  qrCodeData = qr;
  isAuthenticated = false;
  isReady = false;
  connectionStatus = 'Escaneie o QR Code com o WhatsApp';
  logger.info('QR Code pronto no painel web.');
});

client.on('authenticated', () => {
  isAuthenticated = true;
  connectionStatus = 'WhatsApp autenticado. Finalizando conexão...';
});

client.on('ready', () => {
  isAuthenticated = true;
  isReady = true;
  qrCodeData = null;
  connectionStatus = 'WhatsApp conectado';
  logger.info('WhatsApp conectado e painel pronto.');
  startLegacyAutomation();
});

client.on('auth_failure', (message) => {
  isAuthenticated = false;
  isReady = false;
  connectionStatus = 'Falha na autenticação. Gere um novo QR Code.';
  logger.error('Falha na autenticação:', message);
});

client.on('disconnected', (reason) => {
  isAuthenticated = false;
  isReady = false;
  connectionStatus = `WhatsApp desconectado: ${reason}`;
  logger.warn('WhatsApp desconectado:', reason);
});

function startLegacyAutomation() {
  if (mainBotStarted || config.sourceGroups.length === 0 || !config.destGroup) return;
  try {
    const { registerListener } = require('./src/services/listener');
    const { startProcessing, stopProcessing, saveBeforeExit } = require('./src/services/queue');
    registerListener(client);
    startProcessing(client);
    mainBotStarted = true;
    queueControls = { stopProcessing, saveBeforeExit };
    logger.info('Automação de grupos fonte iniciada.');
  } catch (error) {
    logger.error('Não foi possível iniciar a automação de grupos:', error.message);
  }
}

async function shutdown() {
  if (queueControls) {
    queueControls.stopProcessing();
    queueControls.saveBeforeExit();
  }
  try {
    await client.destroy();
  } catch (_) {
    // O processo já está encerrando.
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (error) => logger.error('Erro não tratado:', error.stack || error.message));
process.on('unhandledRejection', (error) => logger.error('Promise rejeitada:', error && error.stack ? error.stack : error));

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Painel PB Promoções disponível na porta ${PORT}.`);
});

if (process.env.DISABLE_WHATSAPP !== 'true') {
  setTimeout(() => {
    client.initialize().catch((error) => {
      connectionStatus = `Erro ao iniciar WhatsApp: ${error.message}`;
      logger.error('Falha ao iniciar WhatsApp:', error.message);
    });
  }, 1000);
} else {
  connectionStatus = 'WhatsApp desativado para validação local';
}
