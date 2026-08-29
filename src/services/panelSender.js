const { MessageMedia } = require('whatsapp-web.js');
const store = require('./panelStore');
const { discoverGroups, isGroupId } = require('./groupDiscovery');
const logger = require('../utils/logger');

let chain = Promise.resolve();

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function renderTemplate(template, product) {
  const replacements = {
    '{titulo}': product.title || 'Oferta Mercado Livre',
    '{preco}': product.price || 'Confira no link',
    '{preco_original}': product.originalPrice || '',
    '{desconto}': product.discount || '',
    '{link}': product.affiliateUrl,
  };

  let message = template;
  Object.entries(replacements).forEach(([token, value]) => {
    message = message.split(token).join(value);
  });
  return message.replace(/\n{3,}/g, '\n\n').trim();
}

async function downloadImage(imageUrl) {
  if (!imageUrl || !imageUrl.startsWith('https://')) return null;
  try {
    const response = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 12 * 1024 * 1024) return null;
    const extension = contentType.split('/')[1].split(';')[0].replace('jpeg', 'jpg');
    return new MessageMedia(contentType, bytes.toString('base64'), `produto.${extension}`);
  } catch (error) {
    logger.warn('[Envio] Foto indisponível; enviando somente texto:', error.message);
    return null;
  }
}

async function verifyGroups(client, groupIds) {
  const customGroups = store.getSettings().customGroups || [];
  const discovery = await discoverGroups(client, customGroups);
  const available = new Set(discovery.groups.map((group) => group.id));
  return groupIds.filter((id) => isGroupId(id) && available.has(id));
}

async function runJob(client, job, options) {
  const products = store.getProducts(job.productIds);
  const groups = await verifyGroups(client, job.groupIds);
  const orderedProducts = options.shuffle ? shuffle(products) : products;
  const template = options.template || store.getSettings().template;
  const delayMs = Math.min(3600, Math.max(10, Number(options.delaySeconds || 120))) * 1000;

  if (groups.length === 0) throw new Error('Nenhum grupo selecionado está disponível no WhatsApp.');
  if (products.length === 0) throw new Error('Nenhum produto selecionado foi encontrado.');

  store.updateJob(job.id, {
    status: 'sending',
    total: orderedProducts.length * groups.length,
    startedAt: new Date().toISOString(),
  });

  let completed = 0;
  let failed = 0;
  const errors = [];

  for (let productIndex = 0; productIndex < orderedProducts.length; productIndex += 1) {
    const product = orderedProducts[productIndex];
    const caption = renderTemplate(template, product);
    const media = await downloadImage(product.image);
    const completedBeforeProduct = completed;
    store.updateJob(job.id, { currentProduct: product.title });

    for (const groupId of groups) {
      try {
        const chat = await client.getChatById(groupId);
        await chat.sendStateTyping();
        await wait(1200 + Math.floor(Math.random() * 1800));
        await chat.clearState();

        if (media) {
          await client.sendMessage(groupId, media, { caption });
        } else {
          await client.sendMessage(groupId, caption);
        }
        completed += 1;
      } catch (error) {
        failed += 1;
        errors.push(`${product.title}: ${error.message}`);
        logger.error(`[Envio] Falha em ${groupId}:`, error.message);
      }
      store.updateJob(job.id, { completed, failed, errors: errors.slice(-10) });
    }

    if (completed > completedBeforeProduct) store.markProductSent(product.id);
    if (productIndex < orderedProducts.length - 1) await wait(delayMs);
  }

  store.updateJob(job.id, {
    status: failed > 0 && completed === 0 ? 'failed' : 'completed',
    completed,
    failed,
    currentProduct: '',
    errors: errors.slice(-10),
    finishedAt: new Date().toISOString(),
  });
}

function enqueueJob(client, options) {
  const job = store.createJob(options);
  chain = chain
    .then(() => runJob(client, job, options))
    .catch((error) => {
      logger.error('[Envio] Lote interrompido:', error.message);
      store.updateJob(job.id, {
        status: 'failed',
        errors: [error.message],
        finishedAt: new Date().toISOString(),
      });
    });
  return job;
}

module.exports = { enqueueJob, renderTemplate, shuffle };
