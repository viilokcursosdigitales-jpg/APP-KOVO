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
 * @param {string|null|undefined} linkHeader
 * @param {'next'|'previous'} rel
 * @returns {string|null} URL absoluta
 */
function parseShopifyRestLinkRel(linkHeader, rel) {
  if (!linkHeader || typeof linkHeader !== 'string') return null;
  for (const segment of linkHeader.split(',')) {
    const m = segment.trim().match(/<([^>]+)>\s*;\s*rel="([^"]+)"/);
    if (m && m[2] === rel) return m[1].trim();
  }
  return null;
}

/**
 * GET orders.json paginando con cursor (250/página, máximo de Shopify).
 * @param {string} shop
 * @param {string} accessToken
 * @param {URLSearchParams} baseQs parámetros del primer listado (status, fields, created_at_*, etc.; sin page_info)
 * @param {{ maxPages?: number }} [opts]
 * @returns {Promise<{ ok: boolean, orders: object[], error?: string, status?: number, data?: object }>}
 */
async function shopifyFetchAllOrders(shop, accessToken, baseQs, opts = {}) {
  const domain = sanitizeShopDomain(shop);
  if (!domain || !accessToken) {
    return { ok: false, orders: [], error: 'shop_or_token_invalid' };
  }
  const maxPages = Number.isFinite(Number(opts.maxPages)) && Number(opts.maxPages) > 0 ? Number(opts.maxPages) : 2000;
  const v = DEFAULT_API_VERSION;
  const all = [];
  let nextAbsUrl = null;
  for (let page = 0; page < maxPages; page += 1) {
    let url;
    if (nextAbsUrl) {
      url = nextAbsUrl;
    } else {
      const qs = new URLSearchParams(baseQs);
      qs.set('limit', '250');
      url = `https://${domain}/admin/api/${v}/orders.json?${qs.toString()}`;
    }
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
      return { ok: false, orders: all, error: e.message || 'network', status: 503 };
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        orders: all,
        error: (data.errors && JSON.stringify(data.errors)) || data.error || res.statusText,
        status: res.status || 502,
        data,
      };
    }
    const chunk = Array.isArray(data.orders) ? data.orders : [];
    all.push(...chunk);
    const link = res.headers.get('link');
    const next = parseShopifyRestLinkRel(link, 'next');
    if (!next || chunk.length === 0) {
      break;
    }
    nextAbsUrl = next;
  }
  return { ok: true, orders: all };
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

/** Quita indicativo Colombia (+57 / 57) y deja solo dígitos locales para copiar/pegar. */
function phoneWithoutColombia57(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('57') && digits.length >= 11) {
    return digits.slice(2);
  }
  return digits;
}

/**
 * Extrae parámetros utm_* de la query de una URL o ruta (p. ej. landing_site de Shopify).
 * @param {string} rawUrl * @returns {Record<string, string>} claves en minúsculas (utm_campaign, …)
 */
/**
 * Atributos de nota del pedido donde Shopify guarda a menudo UTMs
 * (pantalla «Información adicional» en el admin).
 * @param {unknown} noteAttributes
 * @returns {Record<string, string>}
 */
function utmFromNoteAttributes(noteAttributes) {
  if (!Array.isArray(noteAttributes)) return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const na of noteAttributes) {
    if (!na || typeof na !== 'object') continue;
    let n = String(na.name != null ? na.name : '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    // "utmterm" / "utm_term" / nombres con guión bajo tras normalizar
    if (n === 'utmterm' || n === 'utm-term') n = 'utm_term';
    if (!n.startsWith('utm_')) continue;
    let v = na.value != null ? String(na.value).trim() : '';
    if (!v) continue;
    try {
      v = decodeURIComponent(v.replace(/\+/g, ' '));
    } catch {
      /* keep raw */
    }
    out[n] = v;
  }
  return out;
}

function extractUtmParamsFromUrl(rawUrl) {
  const raw = String(rawUrl || '').trim();
  if (!raw) return {};
  try {
    const href =
      raw.startsWith('http://') || raw.startsWith('https://')
        ? raw
        : `https://shop.local${raw.startsWith('/') ? '' : '/'}${raw}`;
    const u = new URL(href);
    /** @type {Record<string, string>} */
    const out = {};
    u.searchParams.forEach((v, k) => {
      const lk = k.toLowerCase();
      if (lk.startsWith('utm_')) {
        try {
          out[lk] = decodeURIComponent(String(v).replace(/\+/g, ' '));
        } catch {
          out[lk] = String(v);
        }
      }
    });
    return out;
  } catch {
    return {};
  }
}

function variantTitleLooksGeneric(v) {
  const s = String(v || '').trim();
  if (!s) return true;
  if (/^default(\s+title)?$/i.test(s)) return true;
  if (s.toLowerCase() === 'default') return true;
  return false;
}

/**
 * Si `variant_title` viene vacío o genérico (p. ej. Default Title), deriva la variante del `name` de la línea Shopify.
 */
function deriveShopifyLineVariantTitle(li, title, name) {
  const raw = li.variant_title != null ? String(li.variant_title).trim() : '';
  if (raw && !variantTitleLooksGeneric(raw)) return raw;
  const t = String(title || '').trim();
  const n = String(name || '').trim();
  if (!n) return raw;
  if (t) {
    const tNorm = t.toLowerCase();
    const nLow = n.toLowerCase();
    if (nLow.startsWith(tNorm) && n.length > t.length) {
      return n.slice(t.length).replace(/^[\s\-–—:]+/, '').trim();
    }
  }
  if (t && n.toLowerCase() === t.toLowerCase()) return '';
  return n;
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
    const lineItemsDetail = lineItems.map((li) => {
      const title = String(li.title || li.name || '').trim() || 'Producto';
      const name = String(li.name || '').trim();
      const variant_title = deriveShopifyLineVariantTitle(li, title, name);
      return {
      id: li.id,
      product_id: li.product_id != null ? Number(li.product_id) : null,
      title,
      name,
      variant_title,
      quantity: parseInt(String(li.quantity), 10) || 0,
      price: li.price != null ? String(li.price) : '',
      sku: li.sku != null ? String(li.sku).trim() : '',
      properties: Array.isArray(li.properties)
        ? li.properties.map((p) => ({
            name: String(p.name != null ? p.name : '').trim(),
            value: String(p.value != null ? p.value : '').trim(),
          }))
        : [],
    };
    });
    const shippingAddress = pickShippingAddress(o);
    const shippingCity = (shippingAddress && shippingAddress.city) || '';
    const shippingProvince = (shippingAddress && shippingAddress.province) || '';
    const shippingAddressLine =
      shippingAddress && [shippingAddress.address1, shippingAddress.address2].filter(Boolean).join(' · ').trim();
    const rawPhone =
      (shippingAddress && String(shippingAddress.phone || '').trim()) ||
      (o.phone != null ? String(o.phone).trim() : '') ||
      (customer.phone != null ? String(customer.phone).trim() : '') ||
      '';
    const phoneLocal = phoneWithoutColombia57(rawPhone);
    const landingSite = o.landing_site != null ? String(o.landing_site) : '';
    const referringSite = o.referring_site != null ? String(o.referring_site) : '';
    const sourceName = o.source_name != null ? String(o.source_name) : '';
    const utmFromReferrer = extractUtmParamsFromUrl(referringSite);
    const utmFromLanding = extractUtmParamsFromUrl(landingSite);
    const utmFromNotes = utmFromNoteAttributes(o.note_attributes);
    const utm = { ...utmFromReferrer, ...utmFromLanding, ...utmFromNotes };
    return {
      id: o.id,
      orderName,
      client,
      email,
      createdAt: o.created_at,
      total: o.total_price,
      currency: o.currency || '',
      financialStatus: o.financial_status || '',
      totalOutstanding:
        o.total_outstanding != null && String(o.total_outstanding).trim() !== ''
          ? String(o.total_outstanding)
          : null,
      fulfillmentStatus: o.fulfillment_status || '',
      label: b.label,
      badgeVariant: b.variant,
      defaultQuantity,
      productIds,
      shippingAddress,
      shippingCity,
      shippingProvince,
      shippingAddressLine: shippingAddressLine || '',
      phoneLocal: phoneLocal || '',
      lineItemsDetail,
      landingSite,
      referringSite,
      sourceName,
      utm,
    };
  });
}

/**
 * Reloj de pared en `timeZone` para un instante UTC (ms).
 * @param {number} utcMillis
 * @param {string} timeZone IANA, ej. America/Bogota
 */
function wallClockPartsInZone(utcMillis, timeZone) {
  const tz = String(timeZone || 'UTC').trim() || 'UTC';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(new Date(utcMillis));
  const o = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const p of parts) {
    if (p.type !== 'literal') o[p.type] = parseInt(p.value, 10);
  }
  return { y: o.year, m: o.month, d: o.day, H: o.hour, M: o.minute, S: o.second };
}

function addCalendarDaysYmd(y, m, d, delta) {
  const x = new Date(Date.UTC(y, m - 1, d + delta));
  return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() };
}

/** Primer instante UTC (ms) del día de calendario y-m-d en la zona `timeZone`. */
function utcMillisStartOfZonedCalendarDay(timeZone, y, m, d) {
  const tz = String(timeZone || 'UTC').trim() || 'UTC';
  let t = Date.UTC(y, m - 1, d - 1, 0, 0, 0);
  const end = Date.UTC(y, m - 1, d + 2, 0, 0, 0);
  while (t < end) {
    const w = wallClockPartsInZone(t, tz);
    if (w.y === y && w.m === m && w.d === d) {
      while (t > Date.UTC(y, m - 1, d - 2, 0, 0, 0)) {
        const w2 = wallClockPartsInZone(t - 1000, tz);
        if (w2.y !== y || w2.m !== m || w2.d !== d) break;
        t -= 1000;
      }
      return t;
    }
    t += 60000;
  }
  return Date.UTC(y, m - 1, d, 12, 0, 0);
}

/**
 * Rango created_at para Shopify alineado al calendario de la tienda (como el admin de Shopify / Meta “hoy”).
 * @param {'hoy'|'ayer'|'3d'|'7d'|'14d'|'30d'|'custom'} period custom → últimos 7 días
 * @param {string} ianaTimezone ej. America/Bogota
 * @param {Date} [ref]
 * @returns {{ min: string, max: string }}
 */
function shopifyOrderCreatedRangeForMetaPeriod(period, ianaTimezone, ref = new Date()) {
  const tz = String(ianaTimezone || 'UTC').trim() || 'UTC';
  const refMs = ref instanceof Date ? ref.getTime() : Date.now();
  const { y: Y, m: M, d: D } = wallClockPartsInZone(refMs, tz);

  if (period === 'hoy') {
    const minMs = utcMillisStartOfZonedCalendarDay(tz, Y, M, D);
    const next = addCalendarDaysYmd(Y, M, D, 1);
    const nextStart = utcMillisStartOfZonedCalendarDay(tz, next.y, next.m, next.d);
    return { min: new Date(minMs).toISOString(), max: new Date(nextStart - 1).toISOString() };
  }
  if (period === 'ayer') {
    const prev = addCalendarDaysYmd(Y, M, D, -1);
    const minMs = utcMillisStartOfZonedCalendarDay(tz, prev.y, prev.m, prev.d);
    const todayStart = utcMillisStartOfZonedCalendarDay(tz, Y, M, D);
    return { min: new Date(minMs).toISOString(), max: new Date(todayStart - 1).toISOString() };
  }

  const rolling = { '3d': 3, '7d': 7, '14d': 14, '30d': 30 };
  const n = rolling[period] || 7;
  const startDay = addCalendarDaysYmd(Y, M, D, -(n - 1));
  const minMs = utcMillisStartOfZonedCalendarDay(tz, startDay.y, startDay.m, startDay.d);
  const nextToday = addCalendarDaysYmd(Y, M, D, 1);
  const maxMs = utcMillisStartOfZonedCalendarDay(tz, nextToday.y, nextToday.m, nextToday.d) - 1;
  return { min: new Date(minMs).toISOString(), max: new Date(maxMs).toISOString() };
}

/**
 * Rango created_at (ISO UTC) para un día de calendario y-m-d en la zona de la tienda.
 * @param {string} ianaTimezone
 * @param {number} y
 * @param {number} m
 * @param {number} d
 * @returns {{ min: string, max: string }}
 */
function shopifyOrderCreatedRangeForCalendarDate(ianaTimezone, y, m, d) {
  const tz = String(ianaTimezone || 'UTC').trim() || 'UTC';
  const minMs = utcMillisStartOfZonedCalendarDay(tz, y, m, d);
  const next = addCalendarDaysYmd(y, m, d, 1);
  const nextStart = utcMillisStartOfZonedCalendarDay(tz, next.y, next.m, next.d);
  return { min: new Date(minMs).toISOString(), max: new Date(nextStart - 1).toISOString() };
}

/** Fecha de calendario (y,m,d) en la zona indicada para un instante UTC. */
function shopCalendarYmdFromInstant(utcMillis, ianaTimezone) {
  return wallClockPartsInZone(utcMillis, String(ianaTimezone || 'UTC').trim() || 'UTC');
}

/** @param {string} s @returns {{ y: number, m: number, d: number } | null} */
function parseIsoDateYmd(s) {
  const m = String(s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

/** Datos informativos: desde el 1 de enero (año del calendario de la tienda) hasta el final del día de hoy. */
function shopifyInformativeOrdersRangeYearToDate(ianaTimezone) {
  const tz = String(ianaTimezone || 'UTC').trim() || 'UTC';
  const nowMs = Date.now();
  const { y } = wallClockPartsInZone(nowMs, tz);
  const minMs = utcMillisStartOfZonedCalendarDay(tz, y, 1, 1);
  const endR = shopifyOrderCreatedRangeForMetaPeriod('hoy', tz);
  return { min: new Date(minMs).toISOString(), max: endR.max };
}

/**
 * Acota created_at_min / max a la ventana informativa: no antes del 1 ene del año de `max` (tienda) ni después de hoy.
 * @param {string} ianaTimezone
 * @param {string} minIso
 * @param {string} maxIso
 */
function shopifyClampInformativeCreatedAtRange(ianaTimezone, minIso, maxIso) {
  const tz = String(ianaTimezone || 'UTC').trim() || 'UTC';
  const endToday = shopifyOrderCreatedRangeForMetaPeriod('hoy', tz).max;
  const tEndToday = Date.parse(endToday);

  let tMax = Date.parse(String(maxIso));
  if (!Number.isFinite(tMax)) tMax = tEndToday;
  if (tMax > tEndToday) tMax = tEndToday;

  const { y: yMax } = wallClockPartsInZone(tMax, tz);
  const jan1Ms = utcMillisStartOfZonedCalendarDay(tz, yMax, 1, 1);

  let tMin = Date.parse(String(minIso));
  if (!Number.isFinite(tMin)) tMin = jan1Ms;
  if (tMin < jan1Ms) tMin = jan1Ms;
  if (tMin > tMax) tMin = jan1Ms;

  return { min: new Date(tMin).toISOString(), max: new Date(tMax).toISOString() };
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
  extractUtmParamsFromUrl,
  utmFromNoteAttributes,
  mapFinancialToBadge,
  shopifyOrderCreatedRangeForMetaPeriod,
  shopifyOrderCreatedRangeForCalendarDate,
  shopCalendarYmdFromInstant,
  parseIsoDateYmd,
  shopifyFetchAllOrders,
  shopifyInformativeOrdersRangeYearToDate,
  shopifyClampInformativeCreatedAtRange,
  DEFAULT_API_VERSION,
};
