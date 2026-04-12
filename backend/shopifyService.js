const crypto = require('crypto');

const DEFAULT_API_VERSION =
  process.env.SHOPIFY_API_VERSION || process.env.SHOPIFY_API_VERSTON || '2026-04';

/**
 * @param {string} shop ej. mitienda.myshopify.com
 * @returns {string | null} dominio normalizado o null
 */
function sanitizeShopDomain(shop) {
  const s = String(shop || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0];
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)) return null;
  return s;
}

/**
 * Verificación HMAC del callback OAuth (query params).
 * @see https://shopify.dev/docs/apps/auth/oauth/getting-started#step-3-validate-oauth-request
 */
function verifyShopifyOAuthHmac(query, clientSecret) {
  const hmac = query.hmac;
  if (!hmac || typeof hmac !== 'string') return false;
  const params = { ...query };
  delete params.hmac;
  delete params.signature;
  const keys = Object.keys(params).sort();
  const message = keys.map((k) => `${k}=${params[k]}`).join('&');
  const digest = crypto.createHmac('sha256', clientSecret).update(message).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest, 'utf8'), Buffer.from(String(hmac), 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Verificación webhook X-Shopify-Hmac-Sha256 (body raw, base64).
 */
function verifyShopifyWebhookHmac(rawBody, hmacHeader, clientSecret) {
  if (!hmacHeader || !rawBody) return false;
  const hash = crypto.createHmac('sha256', clientSecret).update(rawBody).digest('base64');
  const a = Buffer.from(hash, 'utf8');
  const b = Buffer.from(String(hmacHeader), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * @param {string} shop
 * @param {string} accessToken
 * @param {string} endpoint path + query, ej. orders.json?limit=50
 */
async function shopifyRequest(shop, accessToken, endpoint, apiVersion = DEFAULT_API_VERSION) {
  const domain = sanitizeShopDomain(shop);
  if (!domain || !accessToken) {
    return { ok: false, status: 400, error: 'shop_or_token_invalid', data: null };
  }
  const path = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
  const url = `https://${domain}/admin/api/${apiVersion}/${path}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    });
  } catch (e) {
    return { ok: false, status: 503, error: e.message || 'network', data: null };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: (data.errors && JSON.stringify(data.errors)) || data.error || res.statusText,
      data,
    };
  }
  return { ok: true, status: res.status, data };
}

/**
 * GET/PUT/PATCH a la Admin API (JSON).
 * @param {string} shop
 * @param {string} accessToken
 * @param {'GET'|'PUT'|'POST'|'DELETE'} method
 * @param {string} endpoint path relativo, ej. orders/123.json?fields=line_items
 * @param {object | null} body objeto serializado a JSON (omitir en GET)
 */
async function shopifyJsonRequest(shop, accessToken, method, endpoint, body = null, apiVersion = DEFAULT_API_VERSION) {
  const domain = sanitizeShopDomain(shop);
  if (!domain || !accessToken) {
    return { ok: false, status: 400, error: 'shop_or_token_invalid', data: null };
  }
  const path = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
  const url = `https://${domain}/admin/api/${apiVersion}/${path}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: body != null && method !== 'GET' ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    return { ok: false, status: 503, error: e.message || 'network', data: null };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: (data.errors && JSON.stringify(data.errors)) || data.error || res.statusText,
      data,
    };
  }
  return { ok: true, status: res.status, data };
}

/**
 * Actualiza la primera línea del pedido con cantidad y precio unitario (REST Admin).
 * Pedidos con varias líneas: solo se modifica la primera; el resto mantiene cantidad.
 * @returns {Promise<{ ok: boolean, error?: string, data?: object }>}
 */
async function shopifySyncFirstLineItemQuantityAndPrice(shop, accessToken, orderId, quantity, unitPrice) {
  const oid = Number(orderId);
  if (!Number.isFinite(oid) || oid <= 0) {
    return { ok: false, error: 'ID de pedido inválido' };
  }
  const q = parseInt(String(quantity), 10);
  if (!Number.isFinite(q) || q < 1) {
    return { ok: false, error: 'La cantidad debe ser al menos 1 para sincronizar con Shopify' };
  }
  const unit = Number(unitPrice);
  if (!Number.isFinite(unit) || unit < 0) {
    return { ok: false, error: 'Precio unitario no válido' };
  }
  const priceStr = unit.toFixed(2);
  const getRes = await shopifyJsonRequest(
    shop,
    accessToken,
    'GET',
    `orders/${oid}.json?fields=id,line_items`,
  );
  if (!getRes.ok || !getRes.data || !getRes.data.order) {
    return { ok: false, error: getRes.error || 'No se pudo leer el pedido en Shopify' };
  }
  const lineItems = getRes.data.order.line_items || [];
  if (!lineItems.length) {
    return { ok: false, error: 'El pedido no tiene líneas en Shopify' };
  }
  const line_items = lineItems.map((li, idx) => {
    if (idx === 0) {
      return { id: li.id, quantity: q, price: priceStr };
    }
    const qKeep = parseInt(String(li.quantity), 10);
    return { id: li.id, quantity: Number.isFinite(qKeep) && qKeep >= 0 ? qKeep : 1 };
  });
  const putRes = await shopifyJsonRequest(shop, accessToken, 'PUT', `orders/${oid}.json`, {
    order: { id: oid, line_items },
  });
  if (!putRes.ok) {
    return { ok: false, error: putRes.error || 'Shopify rechazó la actualización del pedido' };
  }
  return { ok: true, data: putRes.data };
}

/**
 * Actualiza la dirección de envío del pedido en Shopify (REST Admin).
 * Conserva nombre y códigos de país/provincia si no se envían en updates.
 * @param {Record<string, string>} updates province, city, address1, address2, zip, country, phone (opcionales por clave)
 * @returns {Promise<{ ok: boolean, error?: string, shippingAddress?: object }>}
 */
async function shopifyUpdateOrderShippingAddress(shop, accessToken, orderId, updates) {
  const oid = Number(orderId);
  if (!Number.isFinite(oid) || oid <= 0) {
    return { ok: false, error: 'ID de pedido inválido' };
  }
  const patch = updates && typeof updates === 'object' ? updates : {};
  const getRes = await shopifyJsonRequest(
    shop,
    accessToken,
    'GET',
    `orders/${oid}.json?fields=id,shipping_address,customer`,
  );
  if (!getRes.ok || !getRes.data || !getRes.data.order) {
    return { ok: false, error: getRes.error || 'No se pudo leer el pedido en Shopify' };
  }
  const ord = getRes.data.order;
  const cur = ord.shipping_address && typeof ord.shipping_address === 'object' ? ord.shipping_address : {};
  const customer = ord.customer && typeof ord.customer === 'object' ? ord.customer : {};
  const field = (k, curVal) => {
    if (Object.prototype.hasOwnProperty.call(patch, k)) {
      return patch[k] == null ? '' : String(patch[k]).trim();
    }
    return String(curVal ?? '').trim();
  };

  const shipping_address = {
    first_name: cur.first_name || customer.first_name || '',
    last_name: cur.last_name || customer.last_name || '',
    address1: field('address1', cur.address1),
    address2: field('address2', cur.address2),
    city: field('city', cur.city),
    province: field('province', cur.province),
    zip: field('zip', cur.zip),
    country: field('country', cur.country),
    phone: field('phone', cur.phone),
  };
  if (cur.country_code) shipping_address.country_code = cur.country_code;
  if (cur.province_code) shipping_address.province_code = cur.province_code;

  const putRes = await shopifyJsonRequest(shop, accessToken, 'PUT', `orders/${oid}.json`, {
    order: { id: oid, shipping_address },
  });
  if (!putRes.ok) {
    return { ok: false, error: putRes.error || 'Shopify rechazó la actualización de la dirección' };
  }
  const outOrd = putRes.data && putRes.data.order;
  const sa = outOrd && outOrd.shipping_address;
  const normalized = sa
    ? pickShippingAddress({ shipping_address: sa, billing_address: null })
    : pickShippingAddress(ord);
  return { ok: true, shippingAddress: normalized };
}

function resolveOrderAddress(o) {
  const candidates = [o.shipping_address, o.billing_address];
  for (const raw of candidates) {
    if (!raw || typeof raw !== 'object') continue;
    if (raw.address1 || raw.city || raw.province || raw.zip || raw.country) return raw;
  }
  return null;
}

function pickShippingAddress(o) {
  const s = resolveOrderAddress(o);
  if (!s) return null;
  const name = [s.first_name, s.last_name].filter(Boolean).join(' ').trim();
  const lines = [s.address1, s.address2].filter(Boolean).map(String);
  const cityLine = [s.city, s.province, s.zip].filter(Boolean).join(', ');
  return {
    name: name || '—',
    address1: s.address1 || '',
    address2: s.address2 || '',
    city: s.city || '',
    province: s.province || '',
    zip: s.zip || '',
    country: s.country || '',
    phone: s.phone || '',
    lines,
    cityLine,
  };
}

/**
 * Registra el webhook app/uninstalled en la tienda (tras OAuth).
 * La URL debe ser HTTPS pública y coincidir con la app en Partners.
 */
async function registerUninstallWebhook(shop, accessToken) {
  const appUrl = String(process.env.SHOPIFY_APP_URL || '').replace(/\/$/, '');
  if (!appUrl) {
    console.error('[shopify] registerUninstallWebhook: falta SHOPIFY_APP_URL');
    return;
  }
  const webhookUrl = `${appUrl}/api/shopify/webhooks/uninstalled`;
  const domain = sanitizeShopDomain(shop);
  if (!domain || !accessToken) {
    console.error('[shopify] registerUninstallWebhook: shop o token inválido');
    return;
  }
  const apiVersion = process.env.SHOPIFY_API_VERSION || DEFAULT_API_VERSION;

  let response;
  try {
    response = await fetch(`https://${domain}/admin/api/${apiVersion}/webhooks.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        webhook: {
          topic: 'app/uninstalled',
          address: webhookUrl,
          format: 'json',
        },
      }),
    });
  } catch (e) {
    console.error(`[shopify] registerUninstallWebhook red ${domain}:`, e.message || e);
    return;
  }

  const data = await response.json().catch(() => ({}));
  if (data.webhook && data.webhook.id) {
    console.log(`[shopify] Webhook uninstalled registrado para ${domain}: ${data.webhook.id}`);
  } else {
    console.error(`[shopify] Error registrando webhook para ${domain}:`, data);
  }
}

/**
 * Mapea pedidos REST Admin a filas listas para el front (Pedidos KOVO).
 * @param {object|null} apiData cuerpo JSON de orders.json
 * @returns {object[]}
 */
function normalizeShopifyOrdersForApp(apiData) {
  const list = (apiData && apiData.orders) || [];
  return list.map((o) => {
    const b = mapFinancialToBadge(o.financial_status);
    const customer = o.customer || {};
    const client =
      [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim() || 'Invitado';
    const email = o.email || customer.email || '—';
    const orderName = o.name || (o.order_number != null ? `#${o.order_number}` : `#${o.id}`);
    const lineItems = o.line_items || [];
    const defaultQuantity = lineItems.reduce(
      (s, li) => s + (parseInt(String(li.quantity), 10) || 0),
      0,
    );
    const productIds = [
      ...new Set(
        lineItems
          .map((li) => (li.product_id != null ? Number(li.product_id) : NaN))
          .filter((n) => Number.isFinite(n)),
      ),
    ];
    const lineItemsDetail = lineItems.map((li) => ({
      id: li.id,
      title: String(li.title || li.name || '').trim() || 'Producto',
      quantity: parseInt(String(li.quantity), 10) || 0,
      price: li.price != null ? String(li.price) : '',
    }));
    const shippingAddress = pickShippingAddress(o);
    const shippingCity = (shippingAddress && shippingAddress.city) || '';
    const shippingProvince = (shippingAddress && shippingAddress.province) || '';
    const shippingAddressLine =
      shippingAddress && [shippingAddress.address1, shippingAddress.address2].filter(Boolean).join(' · ').trim();
    return {
      id: o.id,
      orderName,
      client,
      email,
      createdAt: o.created_at,
      total: o.total_price,
      currency: o.currency || '',
      financialStatus: o.financial_status || '',
      fulfillmentStatus: o.fulfillment_status || '',
      label: b.label,
      badgeVariant: b.variant,
      defaultQuantity,
      productIds,
      shippingAddress,
      shippingCity,
      shippingProvince,
      shippingAddressLine: shippingAddressLine || '',
      lineItemsDetail,
    };
  });
}

function mapFinancialToBadge(financial) {
  const f = String(financial || '').toLowerCase();
  if (f === 'paid') return { label: 'Pagado', variant: 'success' };
  if (f === 'pending' || f === 'unpaid') return { label: 'Pendiente de pago', variant: 'paused' };
  if (f === 'authorized') return { label: 'Autorizado', variant: 'info' };
  if (f === 'partially_paid') return { label: 'Pago parcial', variant: 'info' };
  if (f === 'refunded') return { label: 'Reembolsado', variant: 'error' };
  if (f === 'partially_refunded') return { label: 'Reemb. parcial', variant: 'warning' };
  if (f === 'voided') return { label: 'Anulado', variant: 'error' };
  return { label: financial != null && financial !== '' ? String(financial) : '—', variant: 'info' };
}

module.exports = {
  sanitizeShopDomain,
  verifyShopifyOAuthHmac,
  verifyShopifyWebhookHmac,
  shopifyRequest,
  shopifyJsonRequest,
  shopifySyncFirstLineItemQuantityAndPrice,
  shopifyUpdateOrderShippingAddress,
  registerUninstallWebhook,
  normalizeShopifyOrdersForApp,
  mapFinancialToBadge,
  DEFAULT_API_VERSION,
};
