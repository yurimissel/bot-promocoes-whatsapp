const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-sender-test-'));
process.env.DATA_DIR = testDataDir;
const store = require('./src/services/panelStore');
const { enqueueJob, sendConfirmedMessage } = require('./src/services/panelSender');

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
    isGroup: true,
    isReadOnly: false,
    sendStateTyping: async () => {},
    clearState: async () => {},
  };
  const fakeClient = {
    getState: async () => 'CONNECTED',
    sendPresenceAvailable: async () => {},
    getChats: async () => [{ isGroup: true, id: { _serialized: 'grupo@g.us' } }],
    getContacts: async () => [],
    getChatById: async () => fakeChat,
    sendMessage: async (groupId, content) => {
      messages.push({ groupId, content });
      return { id: { _serialized: `mensagem-${messages.length}` } };
    },
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

  let attempts = 0;
  const fallbackClient = {
    sendMessage: async (groupId, content) => {
      attempts += 1;
      if (attempts === 1) throw new Error('falha simulada na foto');
      assert.strictEqual(groupId, 'grupo@g.us');
      assert.strictEqual(content, 'texto de fallback');
      return { id: { _serialized: 'mensagem-fallback' } };
    },
  };
  const fallback = await sendConfirmedMessage(
    fallbackClient,
    'grupo@g.us',
    { mimetype: 'image/jpeg', data: 'ZmFrZQ==' },
    'texto de fallback'
  );
  assert.strictEqual(fallback.mode, 'text');
  assert.strictEqual(fallback.message.id._serialized, 'mensagem-fallback');
  assert.strictEqual(attempts, 2);
  console.log('Teste de envio: OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(() => {
  fs.rmSync(testDataDir, { recursive: true, force: true });
});
