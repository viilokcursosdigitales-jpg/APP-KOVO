/**
 * Totales de comisión por ventas (misma lógica que GET /api/comision-ventas/roles) en un rango
 * [sinceMs, untilExclusiveMs) sobre updated_at de pedidos despachados.
 */
async function computeOrganizationCommissionPeriodTotals(
  pool,
  organizationId,
  sinceMs,
  untilExclusiveMs,
  {
    listOrganizationRoleRows,
    fetchShopifyTotalsByOrderIds,
    normalizeLegacyMoticoEstadoToUnified,
  },
) {
  const roleRows = await listOrganizationRoleRows(organizationId);
  const commissionBySlug = new Map();
  try {
    const cRows = await pool.query(
      `SELECT role_slug, commission_percent FROM organization_role_commissions WHERE organization_id = $1`,
      [organizationId],
    );
    for (const r of cRows.rows) {
      const slug = String(r.role_slug || '').trim();
      const pct = Number(r.commission_percent);
      if (!slug) continue;
      commissionBySlug.set(slug, Number.isFinite(pct) && pct >= 0 ? pct : 0);
    }
  } catch (e) {
    if (e && e.code !== '42P01') throw e;
  }

  const shopifyDespachados = [];
  try {
    const sRows = await pool.query(
      `SELECT shopify_order_id, internal_status, motico_status, price_override, updated_at, updated_by
       FROM shopify_order_local_fields
       WHERE organization_id = $1`,
      [organizationId],
    );
    for (const r of sRows.rows) {
      const updatedMs = Date.parse(String(r.updated_at || ''));
      if (!Number.isFinite(updatedMs) || updatedMs < sinceMs || updatedMs >= untilExclusiveMs) continue;
      const stInternal = normalizeLegacyMoticoEstadoToUnified(r.internal_status);
      if (stInternal !== 'despachado') continue;
      const orderId = Number(r.shopify_order_id);
      if (!Number.isFinite(orderId) || orderId <= 0) continue;
      let amount = null;
      if (r.price_override != null && String(r.price_override).trim() !== '') {
        const amountRaw = Number(r.price_override);
        if (Number.isFinite(amountRaw) && amountRaw >= 0) amount = amountRaw;
      }
      const fallbackUserIdRaw = Number(r.updated_by);
      shopifyDespachados.push({
        orderId,
        amount,
        fallback_user_id: Number.isFinite(fallbackUserIdRaw) && fallbackUserIdRaw > 0 ? fallbackUserIdRaw : null,
      });
    }
  } catch (e) {
    if (e && e.code !== '42P01') throw e;
  }

  const manualDespachados = [];
  try {
    const mRows = await pool.query(
      `SELECT id, motico_status, price_override, total_price, updated_at, created_by
       FROM motico_manual_orders
       WHERE organization_id = $1`,
      [organizationId],
    );
    for (const r of mRows.rows) {
      const updatedMs = Date.parse(String(r.updated_at || ''));
      if (!Number.isFinite(updatedMs) || updatedMs < sinceMs || updatedMs >= untilExclusiveMs) continue;
      const st = normalizeLegacyMoticoEstadoToUnified(r.motico_status);
      if (st !== 'despachado') continue;
      const orderId = Number(r.id);
      if (!Number.isFinite(orderId) || orderId <= 0) continue;
      const hasOvr = r.price_override != null && String(r.price_override).trim() !== '';
      const ovr = hasOvr ? Number(r.price_override) : NaN;
      const totalPrice = Number(r.total_price);
      const fallbackUserIdRaw = Number(r.created_by);
      const amount = Number.isFinite(ovr) && ovr >= 0 ? ovr : Number.isFinite(totalPrice) && totalPrice >= 0 ? totalPrice : 0;
      manualDespachados.push({
        orderId,
        amount,
        fallback_user_id: Number.isFinite(fallbackUserIdRaw) && fallbackUserIdRaw > 0 ? fallbackUserIdRaw : null,
      });
    }
  } catch (e) {
    if (e && e.code !== '42P01') throw e;
  }

  const queryLatestActorMap = async (orderSource, orderIds) => {
    const out = new Map();
    if (!orderIds.length) return out;
    try {
      const q = await pool.query(
        `SELECT DISTINCT ON (order_id) order_id, user_id, user_name, user_email, user_role
         FROM order_change_logs
         WHERE organization_id = $1 AND order_source = $2 AND order_id = ANY($3::bigint[])
         ORDER BY order_id, created_at DESC, id DESC`,
        [organizationId, orderSource, orderIds],
      );
      for (const r of q.rows) {
        const id = Number(r.order_id);
        if (!Number.isFinite(id) || id <= 0) continue;
        const roleSlug = String(r.user_role || '').trim() || 'sin_asignar';
        const userId = Number(r.user_id);
        out.set(id, {
          role_slug: roleSlug,
          user_id: Number.isFinite(userId) && userId > 0 ? userId : null,
          user_name: String(r.user_name || '').trim(),
          user_email: String(r.user_email || '').trim(),
        });
      }
    } catch (e) {
      if (e && e.code === '42P01') return out;
      throw e;
    }
    return out;
  };

  const shopActorMap = await queryLatestActorMap(
    'shopify',
    shopifyDespachados.map((x) => x.orderId),
  );
  const manualActorMap = await queryLatestActorMap(
    'motico_manual',
    manualDespachados.map((x) => x.orderId),
  );

  const missingShopifyTotals = shopifyDespachados.filter((x) => x.amount == null).map((x) => x.orderId);
  const shopifyFetchedTotals = await fetchShopifyTotalsByOrderIds(organizationId, missingShopifyTotals);

  const ventasByRole = new Map();
  const roleLabelBySlug = new Map(roleRows.map((r) => [String(r.slug), String(r.label || r.slug)]));
  const membersByKey = new Map();
  try {
    const um = await pool.query(
      `SELECT id, name, email, role FROM users WHERE organization_id = $1 AND is_active = true`,
      [organizationId],
    );
    for (const m of um.rows) {
      const id = Number(m.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      const roleSlug = String(m.role || '').trim() || 'member';
      membersByKey.set(`uid:${id}`, {
        member_id: id,
        role_slug: roleSlug,
        role_label: String(roleLabelBySlug.get(roleSlug) || roleSlug || 'Sin rol'),
      });
    }
  } catch (e) {
    if (e && e.code !== '42P01') throw e;
  }

  const resolveActor = (actorRaw, fallbackUserIdRaw) => {
    const actor = actorRaw && typeof actorRaw === 'object' ? actorRaw : {};
    const actorUserIdRaw = Number(actor.user_id);
    const fallbackUserId = Number(fallbackUserIdRaw);
    const userId =
      Number.isFinite(actorUserIdRaw) && actorUserIdRaw > 0
        ? actorUserIdRaw
        : Number.isFinite(fallbackUserId) && fallbackUserId > 0
          ? fallbackUserId
          : null;
    let roleSlug = String(actor.role_slug || '').trim();
    if (userId != null) {
      const seeded = membersByKey.get(`uid:${userId}`);
      if (seeded) {
        if (!roleSlug) roleSlug = String(seeded.role_slug || '').trim();
      }
    }
    if (!roleSlug) roleSlug = 'sin_asignar';
    return { user_id: userId, role_slug: roleSlug };
  };

  const addToRole = (slugRaw, amountRaw) => {
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const slug = String(slugRaw || '').trim() || 'sin_asignar';
    ventasByRole.set(slug, Number(ventasByRole.get(slug) || 0) + amount);
  };

  for (const o of shopifyDespachados) {
    const actor = resolveActor(shopActorMap.get(o.orderId), o.fallback_user_id);
    const roleSlug = String(actor.role_slug || 'sin_asignar');
    const amount = o.amount != null ? o.amount : Number(shopifyFetchedTotals.get(o.orderId) || 0);
    addToRole(roleSlug, amount);
  }
  for (const o of manualDespachados) {
    const actor = resolveActor(manualActorMap.get(o.orderId), o.fallback_user_id);
    const roleSlug = String(actor.role_slug || 'sin_asignar');
    addToRole(roleSlug, o.amount);
  }

  const baseRows = roleRows.map((r) => {
    const slug = String(r.slug);
    const ventas = Number(ventasByRole.get(slug) || 0);
    const percent = Number(commissionBySlug.get(slug) || 0);
    const gain = ventas * (percent / 100);
    return { role_slug: slug, ventas_despachadas_total: ventas, commission_percent: percent, gain };
  });

  if (ventasByRole.has('sin_asignar')) {
    baseRows.push({
      role_slug: 'sin_asignar',
      ventas_despachadas_total: Number(ventasByRole.get('sin_asignar') || 0),
      commission_percent: 0,
      gain: 0,
    });
  }

  const totals = baseRows.reduce(
    (acc, r) => {
      acc.ventas_despachadas_total += Number(r.ventas_despachadas_total || 0);
      acc.commission_percent_total += Number(r.commission_percent || 0);
      acc.gain_total += Number(r.gain || 0);
      return acc;
    },
    { ventas_despachadas_total: 0, commission_percent_total: 0, gain_total: 0 },
  );

  return {
    gain_total: Number(totals.gain_total || 0),
    ventas_total: Number(totals.ventas_despachadas_total || 0),
  };
}

module.exports = { computeOrganizationCommissionPeriodTotals };
