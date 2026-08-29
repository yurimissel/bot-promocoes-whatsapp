const assert = require('assert');

process.env.SUPABASE_URL = 'https://abcdefghijklmnopqrst.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_example_abcdefghijklmnopqrstuvwxyz';
process.env.ALLOW_SIGNUPS = 'true';
process.env.SIGNUP_ACCESS_CODE = 'convite-seguro-123';

const auth = require('./src/services/supabaseAuth');

assert.strictEqual(auth.isConfigured(), true);
assert.strictEqual(auth.signupsEnabled(), true);
assert.strictEqual(auth.verifySignupAccessCode('convite-seguro-123'), true);
assert.strictEqual(auth.verifySignupAccessCode('codigo-incorreto'), false);
assert.deepStrictEqual(auth.publicUser({
  id: 'user-id',
  email: 'pessoa@example.com',
  email_confirmed_at: '2026-08-29T00:00:00.000Z',
  created_at: '2026-08-28T00:00:00.000Z',
  user_metadata: { full_name: 'Pessoa Teste' },
}), {
  id: 'user-id',
  email: 'pessoa@example.com',
  name: 'Pessoa Teste',
  emailConfirmed: true,
  createdAt: '2026-08-28T00:00:00.000Z',
});

console.log('Teste de autenticação: OK');
