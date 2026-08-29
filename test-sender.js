const assert = require('assert');
const store = require('./src/services/panelStore');
const { enqueueJob } = require('./src/services/panelSender');

async function main() {
  const { product } = store.upsertProduct({
    title: 'Produto de teste',
    price: 'R$ 99,90',
    affiliateUrl: 'https://meli.la/meu-link',
    productUrl: 'https://www.mercadolivre.com.br/produto',
    image: '',
  });

  const messages = [];
  const fakeChat = {
    sendStateTyping: async () => {},
    clearState: async () => {},
  };
  const fakeClient = {
    getState: async () => 'CONNECTED',
    sendPresenceAvailable: async () => {},
    getChats: async () => [{ isGroup: true, id: { _serialized: 'grupo@g.us' } }],
    getContacts: async () => [],
    getChatById: async () => fakeChat,
    sendMessage: async (groupId, content) => messages.push({ groupId, content }),
  };

  enqueueJob(fakeClient, {
    productIds: [product.id],
    groupIds: ['grupo@g.us'],
    delaySeconds: 10,
    template: '🔥 {titulo}\n{link}',
    shuffle: false,
  });

  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const job = store.listJobs()[0];
    if (job && ['completed', 'failed'].includes(job.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const job = store.listJobs()[0];
  assert.strictEqual(job.status, 'completed');
  assert.strictEqual(job.completed, 1);
  assert.strictEqual(messages.length, 1);
  assert.strictEqual(messages[0].groupId, 'grupo@g.us');
  assert.ok(messages[0].content.includes('https://meli.la/meu-link'));
  assert.strictEqual(store.listProducts()[0].sendCount, 1);
  console.log('Teste de envio: OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
