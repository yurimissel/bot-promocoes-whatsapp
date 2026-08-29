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

function itemPropValue(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+itemprop=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+itemprop=["']${escaped}["'][^>]*>`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeEntities(match[1].trim());
  }
  return '';
}

function jsonLdProduct(html) {
  const scripts = String(html || '').matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );

  const findProduct = (value) => {
    if (!value || typeof value !== 'object') return null;
    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = findProduct(entry);
        if (found) return found;
      }
      return null;
    }
    const type = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
    if (type.some((entry) => String(entry || '').toLowerCase() === 'product')) return value;
    for (const nested of Object.values(value)) {
      const found = findProduct(nested);
      if (found) return found;
    }
    return null;
  };

  for (const match of scripts) {
    try {
      const product = findProduct(JSON.parse(decodeEntities(match[1].trim())));
      if (!product) continue;
      const offers = Array.isArray(product.offers) ? product.offers[0] : (product.offers || {});
      const imageValue = Array.isArray(product.image) ? product.image[0] : product.image;
      const image = typeof imageValue === 'object' ? imageValue.url : imageValue;
      return {
        title: product.name || '',
        image: image || '',
        price: offers.price || offers.lowPrice || '',
        originalPrice: offers.highPrice || '',
      };
    } catch (_) {
      // Alguns anúncios publicam blocos JSON-LD incompletos; tenta o próximo.
    }
  }
  return {};
}

function extractItemId(value) {
  const match = String(value || '').match(/\bMLB[-_]?([0-9]{6,})\b/i);
  return match ? `MLB${match[1]}` : '';
}

function extractCatalogId(value) {
  const match = String(value || '').match(/\/p\/(MLB[0-9]{6,})\b/i);
  return match ? match[1].toUpperCase() : '';
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

async function loadCatalogApi(catalogId) {
  if (!catalogId) return null;
  try {
    const response = await fetchWithTimeout(`https://api.mercadolibre.com/products/${catalogId}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    logger.warn(`[Mercado Livre] Catálogo indisponível para ${catalogId}: ${error.message}`);
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
  const catalogId = extractCatalogId(finalUrl);
  const catalog = await loadCatalogApi(catalogId);
  const catalogWinner = catalog && catalog.buy_box_winner;
  const itemId = (catalogWinner && catalogWinner.item_id)
    || (!catalogId && extractItemId(finalUrl))
    || extractItemId(html);
  const apiItem = await loadItemApi(itemId);
  const structured = jsonLdProduct(html);

  const apiPrice = (apiItem && apiItem.price) || (catalogWinner && catalogWinner.price);
  const apiOriginal = (apiItem && apiItem.original_price)
    || (catalogWinner && catalogWinner.original_price);
  const pagePrice = structured.price
    || metaValue(html, 'product:price:amount')
    || metaValue(html, 'og:price:amount')
    || itemPropValue(html, 'price');
  const pageOriginal = structured.originalPrice
    || metaValue(html, 'product:original_price:amount')
    || itemPropValue(html, 'highPrice');

  const title = (apiItem && apiItem.title)
    || (catalog && catalog.name)
    || structured.title
    || metaValue(html, 'og:title')
    || metaValue(html, 'twitter:title')
    || 'Produto Mercado Livre';
  const image = (apiItem && apiItem.pictures && apiItem.pictures[0] && apiItem.pictures[0].secure_url)
    || (apiItem && (apiItem.secure_thumbnail || apiItem.thumbnail))
    || (catalog && catalog.pictures && catalog.pictures[0] && (catalog.pictures[0].secure_url || catalog.pictures[0].url))
    || structured.image
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
  extractCatalogId,
  jsonLdProduct,
  inspectAffiliateUrl,
};
