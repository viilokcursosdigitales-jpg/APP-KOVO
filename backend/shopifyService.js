const crypto = require('crypto');

const DEFAULT_API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-04';

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
  registerUninstallWebhook,
  normalizeShopifyOrdersForApp,
  mapFinancialToBadge,
  DEFAULT_API_VERSION,
};
