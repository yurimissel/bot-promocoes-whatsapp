const assert = require('assert');

process.env.SUPABASE_URL = 'https://abcdefghijklmnopqrst.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_example_abcdefghijklmnopqrstuvwxyz';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_example_abcdefghijklmnopqrstuvwxyz';
process.env.OWNER_EMAIL = 'owner@example.com';

const auth = require('./src/services/supabaseAuth');

assert.strictEqual(auth.isConfigured(), true);
assert.strictEqual(auth.isOwnerEmail('OWNER@example.com'), true);
assert.strictEqual(auth.isOwnerEmail('other@example.com'), false);
assert.deepStrictEqual(auth.normalizePermissions({ products: true, send: 1, unknown: true }), {
  overview: false,
  products: true,
  groups: false,
  send: false,
  template: false,
  whatsapp: false,
});

const regularAccess = auth.accessForUser({
  email: 'person@example.com',
  app_metadata: { pb_permissions: { products: true, groups: true } },
});
assert.strictEqual(regularAccess.owner, false);
assert.strictEqual(regularAccess.permissions.products, true);
assert.strictEqual(regularAccess.permissions.send, false);
assert.strictEqual(regularAccess.hasAnyPermission, true);

const ownerAccess = auth.accessForUser({ email: 'owner@example.com', app_metadata: {} });
assert.strictEqual(ownerAccess.owner, true);
assert.ok(Object.values(ownerAccess.permissions).every(Boolean));

assert.deepStrictEqual(auth.publicUser({
  id: 'user-id',
  email: 'person@example.com',
  email_confirmed_at: '2026-08-29T00:00:00.000Z',
  created_at: '2026-08-28T00:00:00.000Z',
  last_sign_in_at: null,
  user_metadata: { full_name: 'Pessoa Teste' },
  app_metadata: {},
}), {
  id: 'user-id',
  email: 'person@example.com',
  name: 'Pessoa Teste',
  emailConfirmed: true,
  createdAt: '2026-08-28T00:00:00.000Z',
  lastSignInAt: null,
  owner: false,
  permissions: {
    overview: false,
    products: false,
    groups: false,
    send: false,
    template: false,
    whatsapp: false,
  },
  hasAnyPermission: false,
});

console.log('Teste de autenticação e permissões: OK');
