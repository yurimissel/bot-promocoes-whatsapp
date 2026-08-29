const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, '../..');
const STORE_FILE = path.join(DATA_DIR, 'pb-panel.json');

const defaultState = () => ({
  products: [],
  settings: {
    template: '🔥 *{titulo}*\n\n💰 *Por {preco}*\n\n🛒 Compre aqui: {link}',
    defaultDelaySeconds: 120,
    customGroups: [],
  },
  jobs: [],
});

let state = defaultState();

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporary = `${STORE_FILE}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(temporary, STORE_FILE);
}

function load() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(STORE_FILE)) {
      persist();
      return;
    }

    const stored = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    state = {
      products: Array.isArray(stored.products) ? stored.products : [],
      settings: { ...defaultState().settings, ...(stored.settings || {}) },
      jobs: Array.isArray(stored.jobs) ? stored.jobs.slice(0, 50) : [],
    };

    // Uma reinicialização não deve deixar um envio parecendo ativo.
    let changed = false;
    state.jobs.forEach((job) => {
      if (job.status === 'queued' || job.status === 'sending') {
        job.status = 'interrupted';
        job.finishedAt = new Date().toISOString();
        changed = true;
      }
    });
    if (changed) persist();
  } catch (error) {
    logger.error('[Painel] Falha ao carregar dados:', error.message);
    state = defaultState();
    persist();
  }
}

function listProducts() {
  return [...state.products].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function getProducts(ids) {
  const wanted = new Set(ids);
  return state.products.filter((product) => wanted.has(product.id));
}

function upsertProduct(product) {
  const existingIndex = state.products.findIndex(
    (item) => item.affiliateUrl.toLowerCase() === product.affiliateUrl.toLowerCase()
  );

  if (existingIndex >= 0) {
    state.products[existingIndex] = {
      ...state.products[existingIndex],
      ...product,
      id: state.products[existingIndex].id,
      updatedAt: new Date().toISOString(),
    };
    persist();
    return { product: state.products[existingIndex], created: false };
  }

  const record = {
    id: crypto.randomUUID(),
    title: product.title || 'Produto Mercado Livre',
    price: product.price || '',
    originalPrice: product.originalPrice || '',
    discount: product.discount || '',
    image: product.image || '',
    affiliateUrl: product.affiliateUrl,
    productUrl: product.productUrl || '',
    status: 'saved',
    lastSentAt: null,
    sendCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  state.products.push(record);
  persist();
  return { product: record, created: true };
}

function removeProduct(id) {
  const before = state.products.length;
  state.products = state.products.filter((product) => product.id !== id);
  if (state.products.length !== before) persist();
  return state.products.length !== before;
}

function markProductSent(id) {
  const product = state.products.find((item) => item.id === id);
  if (!product) return;
  product.status = 'sent';
  product.lastSentAt = new Date().toISOString();
  product.sendCount = Number(product.sendCount || 0) + 1;
  product.updatedAt = new Date().toISOString();
  persist();
}

function getSettings() {
  return { ...state.settings };
}

function updateSettings(next) {
  state.settings = { ...state.settings, ...next };
  persist();
  return getSettings();
}

function addCustomGroup(group) {
  const groups = Array.isArray(state.settings.customGroups)
    ? state.settings.customGroups
    : [];
  const existing = groups.find((item) => item.id === group.id);
  if (existing) {
    existing.name = group.name || existing.name;
  } else {
    groups.push({ id: group.id, name: group.name || group.id });
  }
  state.settings.customGroups = groups;
  persist();
  return [...groups];
}

function removeCustomGroup(id) {
  const groups = Array.isArray(state.settings.customGroups)
    ? state.settings.customGroups
    : [];
  state.settings.customGroups = groups.filter((group) => group.id !== id);
  persist();
  return [...state.settings.customGroups];
}

function createJob(details) {
  const job = {
    id: crypto.randomUUID(),
    status: 'queued',
    productIds: details.productIds,
    groupIds: details.groupIds,
    total: details.productIds.length * details.groupIds.length,
    completed: 0,
    failed: 0,
    currentProduct: '',
    errors: [],
    deliveries: [],
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
  };
  state.jobs.unshift(job);
  state.jobs = state.jobs.slice(0, 50);
  persist();
  return job;
}

function updateJob(id, patch) {
  const job = state.jobs.find((item) => item.id === id);
  if (!job) return null;
  Object.assign(job, patch);
  persist();
  return job;
}

function listJobs() {
  return state.jobs.slice(0, 20);
}

load();

module.exports = {
  listProducts,
  getProducts,
  upsertProduct,
  removeProduct,
  markProductSent,
  getSettings,
  updateSettings,
  addCustomGroup,
  removeCustomGroup,
  createJob,
  updateJob,
  listJobs,
};
