const assert = require('assert');
const { extractLinks, extractItemId, isMercadoLivreUrl } = require('./src/services/mercadoLivre');
const { renderTemplate, shuffle } = require('./src/services/panelSender');

assert.deepStrictEqual(
  extractLinks('x https://meli.la/abc y https://meli.la/abc'),
  ['https://meli.la/abc']
);
assert.strictEqual(
  extractItemId('https://produto.mercadolivre.com.br/MLB-123456789-produto'),
  'MLB123456789'
);
assert.strictEqual(isMercadoLivreUrl('https://meli.la/abc'), true);
assert.strictEqual(isMercadoLivreUrl('https://meli.la.evil.test/abc'), false);
assert.strictEqual(
  renderTemplate('{titulo} - {preco} - {link}', {
    title: 'Produto',
    price: 'R$ 10,00',
    affiliateUrl: 'https://meli.la/meu',
  }),
  'Produto - R$ 10,00 - https://meli.la/meu'
);

const values = ['a', 'b', 'c'];
assert.deepStrictEqual([...shuffle(values)].sort(), values);
assert.deepStrictEqual(values, ['a', 'b', 'c']);

console.log('Testes do painel: OK');
