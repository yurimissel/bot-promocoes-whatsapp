#!/usr/bin/env node

const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./src/config');
const logger = require('./src/utils/logger');
const store = require('./src/services/panelStore');
const { extractLinks, inspectAffiliateUrl } = require('./src/services/mercadoLivre');
const { enqueueJob } = require('./src/services/panelSender');
const { discoverGroups, isGroupId, serializedId } = require('./src/services/groupDiscovery');

const app = express();
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const AUTH_PATH = process.env.WWEBJS_AUTH_PATH || path.resolve(__dirname, '.wwebjs_auth');
const START_DELAY_MS = Math.max(1000, Number(process.env.WHATSAPP_START_DELAY_MS || 35000));

let qrCodeData = null;
let isAuthenticated = false;
let isReady = false;
let connectionStatus = 'Iniciando WhatsApp...';
let connectionState = null;
let whatsappError = '';
let webVersion = '';
let groupCache = [];
let lastGroupSyncAt = null;
let lastGroupWarnings = [];
let groupSyncPromise = null;
let initializationPromise = null;
let mainBotStarted = false;
let queueControls = null;

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: AUTH_PATH,
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

function withTimeout(promise, milliseconds, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} excedeu ${milliseconds / 1000}s.`)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

function clearStaleChromiumLocks() {
  const sessionPath = path.join(AUTH_PATH, 'session');
  for (const file of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    try {
      fs.rmSync(path.join(sessionPath, file), { force: true });
    } catch (error) {
      logger.warn(`[WhatsApp] Não foi possível limpar ${file}:`, error.message);
    }
  }
}

function getCustomGroups() {
  const settings = store.getSettings();
  return Array.isArray(settings.customGroups) ? settings.customGroups : [];
}

async function refreshConnectionState() {
  try {
    const state = await withTimeout(client.getState(), 12000, 'Consulta do WhatsApp');
    connectionState = state || null;
    isReady = state === 'CONNECTED';
    isAuthenticated = isAuthenticated || isReady;
    if (isReady) {
      connectionStatus = 'WhatsApp conectado';
      whatsappError = '';
    } else if (state) {
      connectionStatus = `WhatsApp: ${state}`;
    }
    return connectionState;
  } catch (error) {
    isReady = false;
    connectionState = null;
    whatsappError = error.message;
    return null;
  }
}

async function syncGroups(force = false) {
  const cacheIsFresh = lastGroupSyncAt
    && Date.now() - new Date(lastGroupSyncAt).getTime() < 30000;
  if (!force && cacheIsFresh) return groupCache;
  if (groupSyncPromise) return groupSyncPromise;

  groupSyncPromise = (async () => {
    await refreshConnectionState();
    if (!isReady) throw new Error('O WhatsApp ainda não está conectado de verdade.');
    const result = await withTimeout(
      discoverGroups(client, getCustomGroups()),
      45000,
      'Sincronização dos grupos'
    );
    connectionState = result.state || connectionState;
    groupCache = result.groups;
    lastGroupWarnings = result.warnings;
    lastGroupSyncAt = new Date().toISOString();
    return groupCache;
  })().finally(() => {
    groupSyncPromise = null;
  });

  return groupSyncPromise;
}

function accountInfo() {
  const info = client.info || {};
  return {
    id: serializedId(info.wid),
    name: info.pushname || '',
    platform: info.platform || '',
  };
}

function initializeClient() {
  if (initializationPromise) return initializationPromise;
  const pageIsAlive = client.pupPage
    && (typeof client.pupPage.isClosed !== 'function' || !client.pupPage.isClosed());
  if (pageIsAlive) return Promise.resolve();
  clearStaleChromiumLocks();
  connectionStatus = 'Iniciando WhatsApp...';
  whatsappError = '';
  initializationPromise = client.initialize()
    .catch((error) => {
      connectionStatus = `Erro ao iniciar WhatsApp: ${error.message}`;
      whatsappError = error.message;
      isReady = false;
      logger.error('Falha ao iniciar WhatsApp:', error.message);
      throw error;
    })
    .finally(() => {
      initializationPromise = null;
    });
  return initializationPromise;
}

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
  if (isAuthenticated || isReady) await refreshConnectionState();
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
    state: connectionState,
    account: accountInfo(),
    webVersion,
    groupsCount: groupCache.length,
    lastGroupSyncAt,
    error: whatsappError,
    qr,
  });
});

app.get('/api/groups', async (req, res) => {
  try {
    const groups = await syncGroups(false);
    return res.json({ groups, syncedAt: lastGroupSyncAt, warnings: lastGroupWarnings });
  } catch (error) {
    logger.error('[Painel] Erro ao listar grupos:', error.message);
    return res.status(isReady ? 500 : 409).json({ error: error.message });
  }
});

app.post('/api/groups/sync', async (req, res) => {
  try {
    const groups = await syncGroups(true);
    return res.json({ groups, syncedAt: lastGroupSyncAt, warnings: lastGroupWarnings });
  } catch (error) {
    logger.error('[Painel] Erro ao sincronizar grupos:', error.message);
    return res.status(isReady ? 500 : 409).json({ error: error.message });
  }
});

app.post('/api/groups/manual', async (req, res) => {
  const value = String((req.body && req.body.id) || '').trim();
  let id = value;
  let requestedName = String((req.body && req.body.name) || '').trim();
  const inviteMatch = value.match(/(?:https?:\/\/)?chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i);
  if (inviteMatch) {
    if (!isReady) return res.status(409).json({ error: 'Conecte o WhatsApp antes de consultar o convite.' });
    try {
      const info = await withTimeout(client.getInviteInfo(inviteMatch[1]), 20000, 'Consulta do convite');
      id = serializedId(info.groupWid || info.id || info.wid || info.groupId || info.gid);
      requestedName = requestedName || info.subject || info.name || '';
    } catch (error) {
      return res.status(400).json({ error: `Não foi possível consultar esse convite: ${error.message}` });
    }
  }
  if (!isGroupId(id)) {
    return res.status(400).json({ error: 'Cole o link de convite do grupo ou um ID terminado em @g.us.' });
  }
  if (!isReady) return res.status(409).json({ error: 'Conecte o WhatsApp antes de adicionar o grupo.' });

  let name = requestedName;
  try {
    const chat = await withTimeout(client.getChatById(id), 15000, 'Validação do grupo');
    if (!chat || !chat.isGroup) return res.status(400).json({ error: 'Este ID não é de um grupo.' });
    name = chat.name || name;
  } catch (error) {
    if (!name) {
      return res.status(400).json({
        error: `Não foi possível confirmar esse grupo. Informe também um nome. (${error.message})`,
      });
    }
  }

  store.addCustomGroup({ id, name: name || id });
  const groups = await syncGroups(true);
  return res.status(201).json({ groups });
});

app.delete('/api/groups/manual/:id', async (req, res) => {
  store.removeCustomGroup(req.params.id);
  const groups = await syncGroups(true).catch(() => []);
  return res.json({ groups });
});

app.post('/api/whatsapp/reconnect', async (req, res) => {
  try {
    connectionStatus = 'Reconectando ao WhatsApp...';
    whatsappError = '';
    groupCache = [];
    if (client.pupPage && typeof client.resetState === 'function') {
      try {
        await client.resetState();
      } catch (_) {
        await client.destroy().catch(() => {});
        initializeClient().catch(() => {});
      }
    } else {
      initializeClient().catch(() => {});
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
    if (client.pupPage) await refreshConnectionState();
    if (isReady) await syncGroups(true);
    return res.json({ ready: isReady, state: connectionState, status: connectionStatus });
  } catch (error) {
    whatsappError = error.message;
    return res.status(500).json({ error: `Falha ao reconectar: ${error.message}` });
  }
});

app.post('/api/whatsapp/new-qr', async (req, res) => {
  try {
    connectionStatus = 'Removendo a sessão antiga...';
    isAuthenticated = false;
    isReady = false;
    connectionState = null;
    qrCodeData = null;
    groupCache = [];
    if (client.pupPage) {
      try {
        await client.logout();
      } catch (_) {
        await client.destroy().catch(() => {});
      }
    }
    fs.rmSync(AUTH_PATH, { recursive: true, force: true });
    fs.mkdirSync(AUTH_PATH, { recursive: true });
    setTimeout(() => initializeClient().catch(() => {}), 1500);
    return res.status(202).json({ ok: true, status: 'Nova sessão iniciada. Aguarde o QR Code.' });
  } catch (error) {
    whatsappError = error.message;
    return res.status(500).json({ error: `Não foi possível gerar uma nova sessão: ${error.message}` });
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

app.post('/api/send-jobs', async (req, res) => {
  await refreshConnectionState();
  if (!isReady) return res.status(409).json({ error: 'O WhatsApp não está conectado de verdade.' });
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
  connectionState = null;
  groupCache = [];
  connectionStatus = 'Escaneie o QR Code com o WhatsApp';
  logger.info('QR Code pronto no painel web.');
});

client.on('authenticated', () => {
  isAuthenticated = true;
  connectionStatus = 'WhatsApp autenticado. Finalizando conexão...';
});

client.on('ready', async () => {
  isAuthenticated = true;
  qrCodeData = null;
  await refreshConnectionState();
  try {
    webVersion = await withTimeout(client.getWWebVersion(), 10000, 'Versão do WhatsApp Web');
  } catch (_) {
    webVersion = '';
  }
  if (isReady) {
    logger.info('WhatsApp conectado e painel pronto.');
    try {
      await syncGroups(true);
    } catch (error) {
      whatsappError = `Conectado, mas os grupos ainda não sincronizaram: ${error.message}`;
    }
    startLegacyAutomation();
  } else {
    connectionStatus = 'Sessão carregada, aguardando conexão real com o WhatsApp...';
  }
});

client.on('change_state', (state) => {
  connectionState = state || null;
  isReady = state === 'CONNECTED';
  if (isReady) {
    isAuthenticated = true;
    connectionStatus = 'WhatsApp conectado';
    whatsappError = '';
  } else {
    connectionStatus = state ? `WhatsApp: ${state}` : 'WhatsApp sem conexão';
  }
});

client.on('auth_failure', (message) => {
  isAuthenticated = false;
  isReady = false;
  connectionState = null;
  groupCache = [];
  connectionStatus = 'Falha na autenticação. Gere um novo QR Code.';
  whatsappError = String(message || 'Falha na autenticação');
  logger.error('Falha na autenticação:', message);
});

client.on('disconnected', (reason) => {
  isAuthenticated = false;
  isReady = false;
  connectionState = null;
  groupCache = [];
  connectionStatus = `WhatsApp desconectado: ${reason}`;
  whatsappError = String(reason || 'Desconectado');
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
    initializeClient().catch(() => {});
  }, START_DELAY_MS);

  const monitor = setInterval(async () => {
    if (!client.pupPage) return;
    await refreshConnectionState();
    const cacheExpired = !lastGroupSyncAt
      || Date.now() - new Date(lastGroupSyncAt).getTime() > 60000;
    if (isReady && (groupCache.length === 0 || cacheExpired)) {
      await syncGroups(true).catch((error) => {
        whatsappError = `Falha ao sincronizar grupos: ${error.message}`;
      });
    }
  }, 15000);
  monitor.unref();
} else {
  connectionStatus = 'WhatsApp desativado para validação local';
}
