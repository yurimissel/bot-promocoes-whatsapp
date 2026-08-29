const { MessageMedia } = require('whatsapp-web.js');
const store = require('./panelStore');
const { isGroupId } = require('./groupDiscovery');
const logger = require('../utils/logger');

let chain = Promise.resolve();

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout(promise, milliseconds, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} excedeu ${milliseconds / 1000}s.`)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
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

function friendlySendError(error) {
  const message = String((error && error.message) || 'Falha desconhecida no WhatsApp.');
  if (/not a participant|not in (the )?group/i.test(message)) {
    return new Error('O número conectado não participa mais deste grupo.');
  }
  if (/only admins|read.?only|not allowed|permission/i.test(message)) {
    return new Error('Este WhatsApp não tem permissão para enviar mensagens nesse grupo.');
  }
  if (/target closed|session closed|execution context was destroyed/i.test(message)) {
    return new Error('A sessão do WhatsApp reiniciou durante o envio. Reconecte e tente novamente.');
  }
  if (/evaluation failed|widfactory|serialize/i.test(message)) {
    return new Error(`O WhatsApp Web recusou o envio. Reconecte a sessão e tente novamente. Detalhe: ${message}`);
  }
  return new Error(message);
}

async function resolveSendableChat(client, groupId) {
  if (!isGroupId(groupId)) throw new Error('O destino selecionado não é um grupo do WhatsApp.');
  const state = await withTimeout(client.getState(), 12000, 'Verificação da conexão');
  if (state !== 'CONNECTED') throw new Error(`WhatsApp sem conexão no momento do envio (${state || 'desconectado'}).`);

  const chat = await withTimeout(client.getChatById(groupId), 20000, 'Abertura do grupo');
  if (!chat || !chat.isGroup) throw new Error('O grupo selecionado não está mais disponível nesta conta.');
  if (chat.isReadOnly) throw new Error('Este WhatsApp não tem permissão para enviar mensagens nesse grupo.');
  return chat;
}

async function simulateTyping(chat, groupId) {
  try {
    if (chat && typeof chat.sendStateTyping === 'function') await chat.sendStateTyping();
    await wait(1000 + Math.floor(Math.random() * 1400));
    if (chat && typeof chat.clearState === 'function') await chat.clearState();
  } catch (error) {
    logger.warn(`[Envio] Digitação indisponível em ${groupId}; continuando o envio:`, error.message);
  }
}

async function sendConfirmedMessage(client, groupId, media, caption) {
  let message;
  let mediaError = '';
  if (media) {
    try {
      message = await withTimeout(
        client.sendMessage(groupId, media, {
          caption,
          sendSeen: false,
          waitUntilMsgSent: true,
        }),
        60000,
        'Envio da foto'
      );
    } catch (error) {
      mediaError = error.message;
      logger.warn(`[Envio] Foto falhou em ${groupId}; tentando somente o texto:`, error.message);
    }
  }

  if (!message) {
    message = await withTimeout(
      client.sendMessage(groupId, caption, {
        sendSeen: false,
        waitUntilMsgSent: true,
      }),
      45000,
      'Envio da mensagem'
    );
  }

  if (!message) throw new Error('O WhatsApp não confirmou a criação da mensagem.');
  return { message, mode: media && !mediaError ? 'photo' : 'text', mediaError };
}

async function runJob(client, job, options) {
  const products = store.getProducts(job.productIds);
  const groups = job.groupIds.filter(isGroupId);
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
  const deliveries = [];
  const totalDeliveries = orderedProducts.length * groups.length;
  let processedDeliveries = 0;

  for (let productIndex = 0; productIndex < orderedProducts.length; productIndex += 1) {
    const product = orderedProducts[productIndex];
    const caption = renderTemplate(template, product);
    const media = await downloadImage(product.image);
    const completedBeforeProduct = completed;
    store.updateJob(job.id, { currentProduct: product.title });

    for (const groupId of groups) {
      try {
        const chat = await resolveSendableChat(client, groupId);
        await simulateTyping(chat, groupId);
        const sent = await sendConfirmedMessage(client, groupId, media, caption);
        completed += 1;
        deliveries.push({
          productId: product.id,
          groupId,
          status: 'sent',
          messageId: sent.message.id && sent.message.id._serialized ? sent.message.id._serialized : '',
          mode: sent.mode,
          warning: sent.mediaError ? `A foto falhou; o texto foi enviado. ${sent.mediaError}` : '',
          sentAt: new Date().toISOString(),
        });
      } catch (error) {
        const friendlyError = friendlySendError(error);
        failed += 1;
        errors.push(`${product.title}: ${friendlyError.message}`);
        deliveries.push({
          productId: product.id,
          groupId,
          status: 'failed',
          error: friendlyError.message,
          sentAt: new Date().toISOString(),
        });
        logger.error(`[Envio] Falha em ${groupId}:`, friendlyError.message);
      }
      store.updateJob(job.id, {
        completed,
        failed,
        errors: errors.slice(-10),
        deliveries: deliveries.slice(-100),
      });
      processedDeliveries += 1;
      if (processedDeliveries < totalDeliveries) await wait(delayMs);
    }

    if (completed > completedBeforeProduct) store.markProductSent(product.id);
  }

  store.updateJob(job.id, {
    status: failed > 0 && completed === 0 ? 'failed' : (failed > 0 ? 'partial' : 'completed'),
    completed,
    failed,
    currentProduct: '',
    errors: errors.slice(-10),
    deliveries: deliveries.slice(-100),
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

module.exports = {
  enqueueJob,
  renderTemplate,
  shuffle,
  sendConfirmedMessage,
  resolveSendableChat,
  friendlySendError,
};
