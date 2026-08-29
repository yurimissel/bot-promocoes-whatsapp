const logger = require('../utils/logger');

const ALLOWED_HOSTS = [
  'meli.la',
  'mercadolivre.com.br',
  'www.mercadolivre.com.br',
  'produto.mercadolivre.com.br',
];

function isMercadoLivreUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ALLOWED_HOSTS.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
    );
  } catch (_) {
    return false;
  }
}

function extractLinks(input) {
  const matches = String(input || '').match(/https:\/\/[^\s<>"{}|\\^`[\]]+/gi) || [];
  return [...new Set(matches.map((url) => url.replace(/[),.;]+$/, '')))].slice(0, 30);
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function metaValue(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeEntities(match[1].trim());
  }
  return '';
}

function extractItemId(value) {
  const match = String(value || '').match(/\bMLB[-_]?([0-9]{6,})\b/i);
  return match ? `MLB${match[1]}` : '';
}

function formatMoney(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  return numeric.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function calculateDiscount(price, originalPrice) {
  const current = Number(price);
  const original = Number(originalPrice);
  if (!Number.isFinite(current) || !Number.isFinite(original) || original <= current) return '';
  return `${Math.round(((original - current) / original) * 100)}%`;
}

async function fetchWithTimeout(url, options = {}, timeout = 18000) {
  return fetch(url, {
    ...options,
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(timeout),
  });
}

async function loadItemApi(itemId) {
  if (!itemId) return null;
  try {
    const response = await fetchWithTimeout(`https://api.mercadolibre.com/items/${itemId}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    logger.warn(`[Mercado Livre] API indisponível para ${itemId}: ${error.message}`);
    return null;
  }
}

async function inspectAffiliateUrl(affiliateUrl) {
  if (!isMercadoLivreUrl(affiliateUrl)) {
    throw new Error('Use somente links HTTPS do Mercado Livre ou meli.la.');
  }

  let response;
  try {
    response = await fetchWithTimeout(affiliateUrl);
  } catch (error) {
    throw new Error(`Não foi possível abrir o link: ${error.message}`);
  }

  const finalUrl = response.url || affiliateUrl;
  if (!isMercadoLivreUrl(finalUrl)) {
    throw new Error('O link redirecionou para um endereço que não pertence ao Mercado Livre.');
  }

  const html = await response.text();
  const itemId = extractItemId(finalUrl) || extractItemId(html);
  const apiItem = await loadItemApi(itemId);

  const apiPrice = apiItem && apiItem.price;
  const apiOriginal = apiItem && apiItem.original_price;
  const pagePrice = metaValue(html, 'product:price:amount');
  const pageOriginal = metaValue(html, 'product:original_price:amount');

  const title = (apiItem && apiItem.title)
    || metaValue(html, 'og:title')
    || metaValue(html, 'twitter:title')
    || 'Produto Mercado Livre';
  const image = (apiItem && apiItem.pictures && apiItem.pictures[0] && apiItem.pictures[0].secure_url)
    || (apiItem && (apiItem.secure_thumbnail || apiItem.thumbnail))
    || metaValue(html, 'og:image')
    || '';
  const rawPrice = apiPrice || pagePrice;
  const rawOriginal = apiOriginal || pageOriginal;

  return {
    affiliateUrl,
    productUrl: finalUrl,
    title: title.replace(/\s+Mercado Livre.*$/i, '').trim(),
    price: formatMoney(rawPrice),
    originalPrice: formatMoney(rawOriginal),
    discount: calculateDiscount(rawPrice, rawOriginal),
    image,
  };
}

module.exports = {
  isMercadoLivreUrl,
  extractLinks,
  extractItemId,
  inspectAffiliateUrl,
};
