const assert = require('assert');
const { discoverGroups, serializedId } = require('./src/services/groupDiscovery');

async function main() {
  const fakeClient = {
    getState: async () => 'CONNECTED',
    sendPresenceAvailable: async () => {},
    pupPage: {
      evaluate: async () => [
        { id: '120363111111111111@g.us', name: 'Grupo pelo cache', participants: 18 },
      ],
    },
    getChats: async () => [
      { id: { $1: '120363222222222222@g.us' }, name: 'Grupo pelos chats', isGroup: true },
    ],
    getContacts: async () => [
      { id: { user: '120363333333333333', server: 'g.us' }, name: 'Grupo pelos contatos', isGroup: true },
    ],
    getChatById: async (id) => ({ id: { _serialized: id }, name: 'Grupo manual', isGroup: true }),
  };

  const result = await discoverGroups(fakeClient, [
    { id: '120363444444444444@g.us', name: 'Nome de reserva' },
  ]);

  assert.strictEqual(result.state, 'CONNECTED');
  assert.strictEqual(result.groups.length, 4);
  assert.ok(result.groups.some((group) => group.name === 'Grupo pelo cache'));
  assert.ok(result.groups.some((group) => group.name === 'Grupo pelos chats'));
  assert.ok(result.groups.some((group) => group.name === 'Grupo pelos contatos'));
  assert.ok(result.groups.some((group) => group.name === 'Grupo manual'));
  assert.strictEqual(serializedId({ user: '123', server: 'g.us' }), '123@g.us');

  const disconnected = await discoverGroups({ getState: async () => 'UNPAIRED' });
  assert.deepStrictEqual(disconnected.groups, []);
  console.log('Teste de sincronização de grupos: OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
