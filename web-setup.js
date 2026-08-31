#!/usr/bin/env node

const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const logger = require('./src/utils/logger');
const store = require('./src/services/panelStore');
const { extractLinks, inspectAffiliateUrl } = require('./src/services/mercadoLivre');
const { enqueueJob } = require('./src/services/panelSender');
const { discoverGroups, isGroupId, serializedId } = require('./src/services/groupDiscovery');
const supabaseAuth = require('./src/services/supabaseAuth');

const app = express();
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
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

const authAttempts = new Map();

function authRateLimit(req, res, next) {
  const key = String(req.ip || req.socket.remoteAddress || 'unknown');
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const record = authAttempts.get(key);
  if (!record || now - record.startedAt > windowMs) {
    authAttempts.set(key, { count: 1, startedAt: now });
    return next();
  }
  record.count += 1;
  if (record.count > 12) {
    res.set('Retry-After', String(Math.ceil((windowMs - (now - record.startedAt)) / 1000)));
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  }
  return next();
}

const rateLimitCleanup = setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [key, record] of authAttempts.entries()) {
    if (record.startedAt < cutoff) authAttempts.delete(key);
  }
}, 15 * 60 * 1000);
rateLimitCleanup.unref();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('X-Frame-Options', 'DENY');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(requireSameOrigin);

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/auth/settings', (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  return res.json({
    configured: supabaseAuth.isConfigured(),
    allowSignups: true,
  });
});

app.post('/api/auth/signup', authRateLimit, async (req, res) => {
  if (!supabaseAuth.isConfigured()) {
    return res.status(503).json({ error: 'A criação de contas ainda está em configuração.' });
  }
  const name = String((req.body && req.body.name) || '').trim();
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const password = String((req.body && req.body.password) || '');
  if (name.length < 2 || name.length > 80) {
    return res.status(400).json({ error: 'Informe seu nome com 2 a 80 caracteres.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Informe um e-mail válido.' });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'A senha precisa ter entre 8 e 128 caracteres.' });
  }

  try {
    const result = await supabaseAuth.signUp({ name, email, password });
    if (result.session) supabaseAuth.setSessionCookies(req, res, result.session);
    return res.status(201).json({
      user: result.user,
      authenticated: Boolean(result.session),
      requiresEmailConfirmation: result.requiresEmailConfirmation,
      permissionDefinitions: supabaseAuth.PERMISSION_DEFINITIONS,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post('/api/auth/resend-confirmation', authRateLimit, async (req, res) => {
  if (!supabaseAuth.isConfigured()) {
    return res.status(503).json({ error: 'A criação de contas ainda está em configuração.' });
  }
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Informe um e-mail válido.' });
  }
  try {
    await supabaseAuth.resendSignup(email);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post('/api/auth/login', authRateLimit, async (req, res) => {
  if (!supabaseAuth.isConfigured()) {
    return res.status(503).json({ error: 'O acesso ao painel ainda está em configuração.' });
  }
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const password = String((req.body && req.body.password) || '');
  if (!email || !password) return res.status(400).json({ error: 'Informe e-mail e senha.' });

  try {
    const result = await supabaseAuth.signIn({ email, password });
    supabaseAuth.setSessionCookies(req, res, result.session);
    return res.json({
      authenticated: true,
      user: result.user,
      permissionDefinitions: supabaseAuth.PERMISSION_DEFINITIONS,
    });
  } catch (error) {
    return res.status(401).json({ error: error.message });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  await supabaseAuth.signOut(req, res);
  return res.json({ ok: true });
});

app.get('/api/auth/me', supabaseAuth.authenticateRequest, (req, res) => {
  return res.json({
    authenticated: true,
    user: req.publicUser,
    permissionDefinitions: supabaseAuth.PERMISSION_DEFINITIONS,
  });
});

app.use('/api', supabaseAuth.authenticateRequest);

const requireAnyAccess = supabaseAuth.requireAnyPermission();
const requireOverview = supabaseAuth.requirePermission('overview');
const requireProducts = supabaseAuth.requirePermission('products');
const requireGroups = supabaseAuth.requirePermission('groups');
const requireSend = supabaseAuth.requirePermission('send');
const requireTemplate = supabaseAuth.requirePermission('template');
const requireWhatsApp = supabaseAuth.requirePermission('whatsapp');

app.get('/api/admin/users', supabaseAuth.requireOwner, async (req, res) => {
  try {
    const users = await supabaseAuth.listUsers();
    return res.json({ users, permissions: supabaseAuth.PERMISSION_DEFINITIONS });
  } catch (error) {
    logger.error('[Acessos] Erro ao listar contas:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/users/:id/permissions', supabaseAuth.requireOwner, async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Conta inválida.' });
  try {
    const user = await supabaseAuth.updateUserPermissions(id, req.body && req.body.permissions);
    return res.json({ user });
  } catch (error) {
    logger.error('[Acessos] Erro ao salvar permissões:', error.message);
    return res.status(400).json({ error: error.message });
  }
});

app.get('/api/overview', requireOverview, (req, res) => {
  const products = store.listProducts();
  const jobs = store.listJobs();
  return res.json({
    products: products.length,
    groups: groupCache.length,
    sent: products.reduce((total, item) => total + Number(item.sendCount || 0), 0),
    jobs,
  });
});

app.get('/api/status', requireAnyAccess, async (req, res) => {
  if (isAuthenticated || isReady) await refreshConnectionState();
  const canManageWhatsApp = req.authAccess.owner || req.authAccess.permissions.whatsapp;
  let qr = null;
  if (canManageWhatsApp && qrCodeData && !isReady) {
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
    account: canManageWhatsApp ? accountInfo() : null,
    webVersion: canManageWhatsApp ? webVersion : '',
    groupsCount: groupCache.length,
    lastGroupSyncAt,
    error: whatsappError,
    qr,
  });
});

app.get('/api/groups', requireGroups, async (req, res) => {
  try {
    const groups = await syncGroups(false);
    return res.json({ groups, syncedAt: lastGroupSyncAt, warnings: lastGroupWarnings });
  } catch (error) {
    logger.error('[Painel] Erro ao listar grupos:', error.message);
    return res.status(isReady ? 500 : 409).json({ error: error.message });
  }
});

app.post('/api/groups/sync', requireGroups, async (req, res) => {
  try {
    const groups = await syncGroups(true);
    return res.json({ groups, syncedAt: lastGroupSyncAt, warnings: lastGroupWarnings });
  } catch (error) {
    logger.error('[Painel] Erro ao sincronizar grupos:', error.message);
    return res.status(isReady ? 500 : 409).json({ error: error.message });
  }
});

app.post('/api/groups/manual', requireGroups, async (req, res) => {
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

app.delete('/api/groups/manual/:id', requireGroups, async (req, res) => {
  store.removeCustomGroup(req.params.id);
  const groups = await syncGroups(true).catch(() => []);
  return res.json({ groups });
});

app.post('/api/whatsapp/reconnect', requireWhatsApp, async (req, res) => {
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

app.post('/api/whatsapp/new-qr', requireWhatsApp, async (req, res) => {
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

app.get('/api/products', requireProducts, (req, res) => res.json({ products: store.listProducts() }));

app.post('/api/products/import', requireProducts, async (req, res) => {
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

app.delete('/api/products/:id', requireProducts, (req, res) => {
  const removed = store.removeProduct(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Produto não encontrado.' });
  return res.json({ ok: true });
});

app.get('/api/settings', supabaseAuth.requireAnyPermission('template', 'send'), (req, res) => {
  return res.json(store.getSettings());
});

app.put('/api/settings', requireTemplate, (req, res) => {
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

app.get('/api/jobs', supabaseAuth.requireAnyPermission('overview', 'send'), (req, res) => {
  return res.json({ jobs: store.listJobs() });
});

app.post('/api/send-jobs', requireSend, async (req, res) => {
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
  if (groupIds.some((id) => !isGroupId(id))) {
    return res.status(400).json({ error: 'A seleção contém um destino que não é grupo do WhatsApp.' });
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

  try {
    const availableGroups = new Set((await syncGroups(false)).map((group) => group.id));
    const unavailable = groupIds.filter((id) => !availableGroups.has(id));
    if (unavailable.length > 0) {
      return res.status(409).json({
        error: 'Um grupo selecionado não está mais disponível. Sincronize os grupos e tente novamente.',
      });
    }
  } catch (error) {
    return res.status(409).json({ error: `Não foi possível validar os grupos: ${error.message}` });
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

async function shutdown() {
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
