const { parseIsoDateYmd } = require('./shopifyService');

const MOTICO_STATUS_DEFAULT = 'sin_revisar';

/**
 * Crea un pedido manual Motico (solo en KOVO). Misma lógica que POST /api/motico/manual-orders.
 *
 * @param {import('pg').Pool} pool
 * @param {{
 *   getActiveShopifyConnection: (orgId: number) => Promise<object|null>,
 *   shopifyRequest: (domain: string, token: string, path: string) => Promise<{ ok: boolean, data?: object }>,
 *   gananciaDiariaYmdKey: (d: Date) => string,
 * }} deps
 * @param {number} organizationId
 * @param {object} body
 * @param {{ createdByUserId?: number|null, ingestSource?: string|null }} [opts]
 * @returns {Promise<{ ok: true, row: object, meta: object } | { ok: false, status: number, error: string, code?: string }>}
 */
async function createMoticoManualOrderFromBody(pool, deps, organizationId, body, opts = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const client_name = String(b.client_name || '').trim();
  const product_summary_in = String(b.product_summary || '').trim();
  if (!client_name) {
    return { ok: false, status: 400, error: 'El nombre del cliente es obligatorio' };
  }
  const total = Number.parseFloat(String(b.total != null ? b.total : '').replace(',', '.'));
  if (!Number.isFinite(total) || total < 0) {
    return { ok: false, status: 400, error: 'Total no válido' };
  }
  const anticipoRaw = b.anticipo != null ? String(b.anticipo).replace(',', '.').trim() : '';
  const anticipo = anticipoRaw === '' ? 0 : Number.parseFloat(anticipoRaw);
  if (!Number.isFinite(anticipo) || anticipo < 0) {
    return { ok: false, status: 400, error: 'Pago anticipado no válido' };
  }
  const line_items_in = Array.isArray(b.line_items) ? b.line_items : [];
  const note = String(b.note || '').trim().slice(0, 500);
  const parsedLines = [];
  for (const raw of line_items_in) {
    if (!raw || typeof raw !== 'object') continue;
    const li = raw;
    const title = String(li.title || li.name || '').trim();
    if (!title) continue;
    const q = parseInt(String(li.quantity != null ? li.quantity : '1'), 10);
    if (!Number.isFinite(q) || q < 1) continue;
    parsedLines.push({
      product_id: li.product_id != null ? Number(li.product_id) || null : null,
      variant_id: li.variant_id != null ? Number(li.variant_id) || null : null,
      title,
      variant_title: String(li.variant_title || '').trim(),
      sku: String(li.sku || '').trim(),
      barcode: String(li.barcode || '').trim(),
      quantity: q,
    });
  }
  if (!parsedLines.length && !product_summary_in) {
    return { ok: false, status: 400, error: 'Selecciona al menos un producto del inventario' };
  }
  const qtyFallback = parseInt(String(b.quantity != null ? b.quantity : '1'), 10);
  const qty = parsedLines.length
    ? parsedLines.reduce((acc, li) => acc + li.quantity, 0)
    : Number.isFinite(qtyFallback) && qtyFallback > 0
      ? qtyFallback
      : 1;
  const fin = String(b.financial_status || 'pending').toLowerCase();
  const allowedFin = new Set([
    'paid',
    'pending',
    'unpaid',
    'partially_paid',
    'authorized',
    'voided',
    'refunded',
    'double_freight',
    'cancelado',
  ]);
  const financial_status = allowedFin.has(fin) ? fin : 'pending';

  let currency = String(b.currency || '').trim();
  if (!currency) {
    const shopRow = await deps.getActiveShopifyConnection(organizationId);
    if (shopRow) {
      const sr = await deps.shopifyRequest(shopRow.shop_domain, shopRow.access_token, 'shop.json?fields=currency');
      if (sr.ok && sr.data && sr.data.shop && sr.data.shop.currency) {
        currency = String(sr.data.shop.currency).trim();
      }
    }
  }
  if (!currency) currency = 'USD';

  const client_email = String(b.client_email || '').trim().slice(0, 320);
  const province = String(b.province || '').trim();
  const city = String(b.city || '').trim();
  const address1 = String(b.address1 || '').trim();
  const address2 = String(b.address2 || '').trim();
  const zip = String(b.zip || '').trim();
  const country = String(b.country || '').trim();
  const phone = String(b.phone || '').trim();
  const rawCreated = b.created_at != null ? String(b.created_at).trim() : '';
  let assignedDateYmd = null;
  if (rawCreated) {
    const parsed = parseIsoDateYmd(rawCreated.slice(0, 10));
    if (parsed) assignedDateYmd = deps.gananciaDiariaYmdKey(parsed);
  }

  const ingestSource = opts.ingestSource != null ? String(opts.ingestSource).trim() : '';
  const shipping_json = {
    name: client_name,
    province,
    city,
    address1,
    address2,
    zip,
    country,
    phone,
    assigned_date: assignedDateYmd,
    ...(ingestSource ? { ingest_source: ingestSource } : {}),
  };
  const unitPrice = qty > 0 ? Math.round((total / qty) * 10000) / 10000 : total;
  const line_items_json = parsedLines.length
    ? parsedLines.map((li, idx) => ({
        id: idx + 1,
        product_id: li.product_id,
        variant_id: li.variant_id,
        title: li.title,
        variant_title: li.variant_title,
        sku: li.sku,
        barcode: li.barcode,
        quantity: li.quantity,
        price: String(unitPrice),
        properties: idx === 0 && note ? [{ name: 'Observacion', value: note }] : [],
      }))
    : [
        {
          id: 1,
          title: product_summary_in || 'Producto',
          quantity: qty,
          price: String(unitPrice),
          properties: note ? [{ name: 'Observacion', value: note }] : [],
        },
      ];
  const baseSummary = parsedLines.length
    ? parsedLines
        .map((li) => (li.variant_title ? `${li.title} (${li.variant_title})` : li.title))
        .join(' + ')
    : product_summary_in || 'Producto';
  const product_summary = `${baseSummary}${note ? ` · Observación: ${note}` : ''}`.slice(0, 600);
  const anticipoClamped = Math.min(Math.max(0, anticipo), total);
  const total_outstanding =
    financial_status === 'paid' || financial_status === 'refunded' || financial_status === 'cancelado'
      ? 0
      : Math.max(0, total - anticipoClamped);

  let createdAtParam = null;
  if (rawCreated) {
    const t = Date.parse(rawCreated);
    if (!Number.isFinite(t)) {
      return { ok: false, status: 400, error: 'Fecha de creación no válida' };
    }
    const now = Date.now();
    if (t > now + 60_000) {
      return { ok: false, status: 400, error: 'La fecha de creación no puede ser futura' };
    }
    const minMs = now - 10 * 365 * 86400000;
    if (t < minMs) {
      return { ok: false, status: 400, error: 'La fecha de creación no puede ser anterior a hace 10 años' };
    }
    createdAtParam = new Date(t).toISOString();
  }

  const createdByUserId =
    opts.createdByUserId != null && Number.isFinite(Number(opts.createdByUserId))
      ? Number(opts.createdByUserId)
      : null;

  const initialOrderName = 'WHATSAPP_PENDING';
  const { rows: insRows } = await pool.query(
    `INSERT INTO motico_manual_orders (
      organization_id,
      order_name,
      client_name,
      client_email,
      financial_status,
      total_price,
      total_outstanding,
      currency,
      shipping_json,
      product_summary,
      line_items_json,
      created_by,
      motico_status,
      pago_al_recibir_override,
      created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb, $12, $13, $14, COALESCE($15::timestamptz, now()))
    RETURNING *`,
    [
      organizationId,
      initialOrderName,
      client_name,
      client_email,
      financial_status,
      total,
      total_outstanding,
      currency,
      JSON.stringify(shipping_json),
      product_summary.slice(0, 600),
      JSON.stringify(line_items_json),
      createdByUserId,
      MOTICO_STATUS_DEFAULT,
      anticipoClamped,
      createdAtParam,
    ],
  );
  const row = insRows[0];
  const finalName = `Whatsapp #${row.id}`;
  await pool.query(
    `UPDATE motico_manual_orders SET order_name = $1, updated_at = now() WHERE id = $2 AND organization_id = $3`,
    [finalName, row.id, organizationId],
  );
  row.order_name = finalName;

  return {
    ok: true,
    row,
    meta: {
      order_name: finalName,
      client_name,
      financial_status,
      total_price: total,
      quantity: qty,
      currency,
    },
  };
}

module.exports = { createMoticoManualOrderFromBody, MOTICO_STATUS_DEFAULT };
