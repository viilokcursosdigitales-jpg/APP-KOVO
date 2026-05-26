const AD_PLATFORMS = ['meta', 'tiktok', 'google', 'otros'];

const PLATFORM_LABELS = {
  meta: 'Meta',
  tiktok: 'TikTok',
  google: 'Google',
  otros: 'Otros',
};

function normalizePlatform(raw) {
  const p = String(raw || '')
    .trim()
    .toLowerCase();
  return AD_PLATFORMS.includes(p) ? p : null;
}

function parseSpendDateYmd(raw) {
  const s = String(raw || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T12:00:00`);
  if (!Number.isFinite(t)) return null;
  return s;
}

function parseSpendAmount(raw) {
  const n = Number.parseFloat(String(raw ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function rowToApi(r) {
  const d = r.spend_date;
  const spendDate =
    d instanceof Date
      ? d.toISOString().slice(0, 10)
      : String(d || '').slice(0, 10);
  return {
    id: Number(r.id),
    spend_date: spendDate,
    platform: String(r.platform),
    platform_label: PLATFORM_LABELS[r.platform] || r.platform,
    shopify_product_id: Number(r.shopify_product_id),
    product_title: String(r.product_title || ''),
    amount: Number(r.amount),
    currency: String(r.currency || 'COP'),
    notes: r.notes != null ? String(r.notes) : '',
    created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
    updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  };
}

function validateAdSpendBody(body) {
  const b = body && typeof body === 'object' ? body : {};
  const spend_date = parseSpendDateYmd(b.spend_date);
  if (!spend_date) {
    return { ok: false, status: 400, error: 'Fecha inválida' };
  }
  const platform = normalizePlatform(b.platform);
  if (!platform) {
    return { ok: false, status: 400, error: 'Plataforma inválida' };
  }
  const shopify_product_id = parseInt(String(b.shopify_product_id), 10);
  if (!Number.isFinite(shopify_product_id) || shopify_product_id <= 0) {
    return { ok: false, status: 400, error: 'Producto inválido' };
  }
  const amount = parseSpendAmount(b.amount);
  if (amount == null) {
    return { ok: false, status: 400, error: 'Gasto inválido' };
  }
  const product_title = String(b.product_title || '').trim().slice(0, 500);
  if (!product_title) {
    return { ok: false, status: 400, error: 'Título de producto requerido' };
  }
  let currency = String(b.currency || 'COP')
    .trim()
    .toUpperCase();
  if (!currency) currency = 'COP';
  if (currency.length > 8) currency = currency.slice(0, 8);
  const notes = b.notes != null ? String(b.notes).trim().slice(0, 2000) : null;
  return {
    ok: true,
    value: {
      spend_date,
      platform,
      shopify_product_id,
      product_title,
      amount,
      currency,
      notes: notes || null,
    },
  };
}

module.exports = {
  AD_PLATFORMS,
  PLATFORM_LABELS,
  normalizePlatform,
  parseSpendDateYmd,
  rowToApi,
  validateAdSpendBody,
};
