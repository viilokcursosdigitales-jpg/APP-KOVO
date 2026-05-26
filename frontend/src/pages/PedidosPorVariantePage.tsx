import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../auth/api';
import { DataTable, Td, Th, tableBase } from '../design-system/DataTable';
import { PageHeader } from '../design-system/PageHeader';
import { ds } from '../design-system/ds';
import { buildDateRange } from '../utils/datePresets';

type ProductOption = { name?: string; values?: string[] };
type ProductRow = { id: number; title: string; options?: ProductOption[] };

type ShopifyOrderRow = {
  id?: number;
  internal_status?: string;
  motico_status?: string;
  lineItemsDetail?: {
    product_id?: number | null;
    variant_id?: number | null;
    quantity?: number;
  }[];
};

type ShopifyOrdersPayload = { orders?: ShopifyOrderRow[]; error?: string };

type ShopifyVariant = {
  id?: number | string;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
};
type VariantsPayload = { product_id?: number; variants?: ShopifyVariant[]; error?: string };

type TrendKey = 'up' | 'down' | 'same' | 'new';
type GroupRow = {
  value: string;
  orders: number;
  units: number;
  pct: number;
  prev_orders: number;
  prev_pct: number;
  trend: TrendKey;
};

const inputStyle: React.CSSProperties = {
  borderRadius: 8,
  border: `1px solid ${ds.borderCard}`,
  background: ds.bgCard,
  padding: '9px 12px',
  fontSize: 13,
  color: ds.textPrimary,
};

function todayYmdLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDaysYmd(ymd: string, deltaDays: number): string {
  const m = String(ymd || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return todayYmdLocal();
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const base = new Date(y, mo - 1, d, 12, 0, 0);
  base.setDate(base.getDate() + deltaDays);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
}

function shiftMonthYmd(ymd: string, deltaMonths: number): string | null {
  const m = String(ymd || '')
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const base = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  base.setUTCMonth(base.getUTCMonth() + Number(deltaMonths || 0));
  const yy = base.getUTCFullYear();
  const mm = base.getUTCMonth() + 1;
  const dd = base.getUTCDate();
  return `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function trendLabel(t: TrendKey): { text: string; color: string } {
  if (t === 'up') return { text: 'Subió', color: ds.successText };
  if (t === 'down') return { text: 'Bajó', color: ds.dangerText };
  if (t === 'new') return { text: 'Nuevo', color: ds.warningText };
  return { text: 'Igual', color: ds.textMuted };
}

function pct(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return `${v.toFixed(1)}%`;
}

function BarRow({
  label,
  pctValue,
  right,
  action,
}: {
  label: string;
  pctValue: number;
  right: React.ReactNode;
  action?: React.ReactNode;
}) {
  const p = Math.max(0, Math.min(100, Number.isFinite(pctValue) ? pctValue : 0));
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1.2fr 2fr auto',
        gap: 10,
        alignItems: 'center',
        padding: '10px 12px',
        borderBottom: `1px solid ${ds.borderRow}`,
      }}
    >
      <div style={{ fontSize: 12, color: ds.textPrimary, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </div>
      <div style={{ height: 10, background: ds.bgApp, borderRadius: 999, overflow: 'hidden', border: `1px solid ${ds.borderCard}` }}>
        <div style={{ height: '100%', width: `${p}%`, background: ds.brand, borderRadius: 999 }} />
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ fontSize: 12, color: ds.textSecondary, fontWeight: 700 }}>{pct(p)}</span>
        {right}
      </div>
      {action ? (
        <div style={{ gridColumn: '1 / -1', marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
          {action}
        </div>
      ) : null}
    </div>
  );
}

export default function PedidosPorVariantePage() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [shopifyOk, setShopifyOk] = useState(false);
  const [productId, setProductId] = useState<string>('');
  const [from, setFrom] = useState(() => shiftDaysYmd(todayYmdLocal(), -29));
  const [to, setTo] = useState(() => todayYmdLocal());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [orders, setOrders] = useState<ShopifyOrderRow[]>([]);
  const [ordersPrev, setOrdersPrev] = useState<ShopifyOrderRow[]>([]);
  const [variantMap, setVariantMap] = useState<Map<number, ShopifyVariant>>(new Map());
  const [path, setPath] = useState<string[]>([]);

  const loadProducts = useCallback(async () => {
    try {
      const res = await apiFetch('/api/shopify/products?limit=250');
      if (!res.ok) {
        setProducts([]);
        setShopifyOk(false);
        return;
      }
      const j = (await res.json()) as {
        products?: { id: number | string; title?: string; options?: ProductOption[] }[];
      };
      const list = Array.isArray(j.products)
        ? j.products
            .map((p) => ({
              id: Number.parseInt(String(p.id), 10),
              title: String(p.title || '(sin título)'),
              options: Array.isArray(p.options) ? p.options : [],
            }))
            .filter((p) => Number.isFinite(p.id))
        : [];
      list.sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }));
      setProducts(list);
      setShopifyOk(true);
      if (!productId && list[0]) setProductId(String(list[0].id));
    } catch {
      setProducts([]);
      setShopifyOk(false);
    }
  }, [productId]);

  const selectedProduct = useMemo(() => {
    const pid = Number.parseInt(productId, 10);
    if (!Number.isFinite(pid)) return null;
    return products.find((p) => p.id === pid) || null;
  }, [products, productId]);

  const optionLevels = useMemo(() => {
    const opts = Array.isArray(selectedProduct?.options) ? selectedProduct!.options : [];
    return opts
      .map((o) => String(o?.name || '').trim())
      .filter(Boolean)
      .slice(0, 3);
  }, [selectedProduct]);

  const activeLevelIdx = Math.min(path.length, Math.max(0, optionLevels.length - 1));
  const canDrill = activeLevelIdx < optionLevels.length - 1;
  const nextLevelName = optionLevels[activeLevelIdx + 1] || '';

  const ordersRangeQs = useMemo(() => {
    const range = buildDateRange('personalizado', from, to);
    const qs = new URLSearchParams();
    if (range.min) qs.set('created_at_min', range.min);
    if (range.max) qs.set('created_at_max', range.max);
    return qs.toString();
  }, [from, to]);

  const prevRange = useMemo(() => {
    const pf = shiftMonthYmd(from, -1);
    const pt = shiftMonthYmd(to, -1);
    if (!pf || !pt) return null;
    return { from: pf, to: pt };
  }, [from, to]);

  const ordersPrevRangeQs = useMemo(() => {
    if (!prevRange) return '';
    const range = buildDateRange('personalizado', prevRange.from, prevRange.to);
    const qs = new URLSearchParams();
    if (range.min) qs.set('created_at_min', range.min);
    if (range.max) qs.set('created_at_max', range.max);
    return qs.toString();
  }, [prevRange]);

  const loadVariants = useCallback(async (pid: number) => {
    const res = await apiFetch(`/api/shopify/products/${pid}/variants`);
    const j = (await res.json().catch(() => ({}))) as VariantsPayload;
    if (!res.ok) {
      throw new Error(typeof j.error === 'string' ? j.error : 'No se pudieron cargar variantes');
    }
    const m = new Map<number, ShopifyVariant>();
    for (const v of Array.isArray(j.variants) ? j.variants : []) {
      const id = Number.parseInt(String(v?.id ?? ''), 10);
      if (!Number.isFinite(id) || id <= 0) continue;
      m.set(id, v);
    }
    setVariantMap(m);
  }, []);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError('');
    setOrders([]);
    setOrdersPrev([]);
    try {
      const pid = Number.parseInt(productId, 10);
      if (!Number.isFinite(pid) || pid <= 0) {
        setError('Selecciona un producto');
        return;
      }
      await loadVariants(pid);
      const [curRes, prevRes] = await Promise.all([
        apiFetch(`/api/shopify/orders?${ordersRangeQs}`),
        prevRange && ordersPrevRangeQs ? apiFetch(`/api/shopify/orders?${ordersPrevRangeQs}`) : Promise.resolve(null),
      ]);
      const curJ = (await curRes.json().catch(() => ({}))) as ShopifyOrdersPayload;
      if (!curRes.ok) throw new Error(typeof curJ.error === 'string' ? curJ.error : 'No se pudieron cargar pedidos');
      setOrders(Array.isArray(curJ.orders) ? curJ.orders : []);
      if (prevRes) {
        const prevJ = (await prevRes.json().catch(() => ({}))) as ShopifyOrdersPayload;
        if (prevRes.ok) setOrdersPrev(Array.isArray(prevJ.orders) ? prevJ.orders : []);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error de red';
      setError(msg || 'Error de red');
    } finally {
      setLoading(false);
    }
  }, [productId, ordersRangeQs, prevRange, ordersPrevRangeQs, loadVariants]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    if (!productId) return;
    setPath([]);
  }, [productId]);

  useEffect(() => {
    if (!productId) return;
    if (optionLevels.length === 0) return;
    void loadOrders();
  }, [productId, from, to, optionLevels.length, loadOrders]);

  const computeGroups = useCallback(
    (srcOrders: ShopifyOrderRow[]) => {
      const pid = Number.parseInt(productId, 10);
      if (!Number.isFinite(pid) || pid <= 0) return { totalOrdersInGroup: 0, rows: [] as { value: string; orders: number; units: number }[] };
      const levelIdx = activeLevelIdx;
      const byValue = new Map<string, { orders: number; units: number }>();
      let totalOrdersInGroup = 0;

      for (const o of srcOrders) {
        const st = String(o?.internal_status || o?.motico_status || '').trim().toLowerCase();
        if (st === 'prueba') continue;
        const details = Array.isArray(o?.lineItemsDetail) ? o.lineItemsDetail : [];
        const orderSeen = new Set<string>();
        let orderHasAnyInParent = false;

        for (const li of details) {
          const lp = li?.product_id != null && Number.isFinite(Number(li.product_id)) ? Number(li.product_id) : null;
          if (lp !== pid) continue;
          const vid = li?.variant_id != null && Number.isFinite(Number(li.variant_id)) ? Number(li.variant_id) : null;
          if (!vid) continue;
          const v = variantMap.get(vid);
          if (!v) continue;

          const opts = [v.option1, v.option2, v.option3].map((x) => String(x ?? '').trim());
          let matchesParent = true;
          for (let i = 0; i < path.length; i += 1) {
            if (String(opts[i] || '') !== String(path[i] || '')) {
              matchesParent = false;
              break;
            }
          }
          if (!matchesParent) continue;
          orderHasAnyInParent = true;

          const value = String(opts[levelIdx] || '').trim() || '—';
          const seenKey = value.toLowerCase();
          if (!orderSeen.has(seenKey)) {
            orderSeen.add(seenKey);
            const prev = byValue.get(value) || { orders: 0, units: 0 };
            byValue.set(value, { ...prev, orders: prev.orders + 1 });
          }
          const qty = Number.parseInt(String(li?.quantity ?? 0), 10);
          if (Number.isFinite(qty) && qty > 0) {
            const prev = byValue.get(value) || { orders: 0, units: 0 };
            byValue.set(value, { ...prev, units: prev.units + qty });
          }
        }
        if (orderHasAnyInParent) totalOrdersInGroup += 1;
      }

      const rows = [...byValue.entries()]
        .map(([value, agg]) => ({ value, orders: agg.orders, units: agg.units }))
        .sort(
          (a, b) =>
            b.orders - a.orders ||
            b.units - a.units ||
            a.value.localeCompare(b.value, 'es', { sensitivity: 'base' }),
        );
      return { totalOrdersInGroup, rows };
    },
    [productId, activeLevelIdx, path, variantMap],
  );

  const curAgg = useMemo(() => computeGroups(orders), [orders, computeGroups]);
  const prevAgg = useMemo(() => computeGroups(ordersPrev), [ordersPrev, computeGroups]);

  const rows: GroupRow[] = useMemo(() => {
    const prevBy = new Map(prevAgg.rows.map((r) => [r.value, r]));
    return curAgg.rows.map((r) => {
      const prev = prevBy.get(r.value);
      const prevOrders = prev ? prev.orders : 0;
      let trend: TrendKey = 'same';
      if (r.orders > prevOrders) trend = prevOrders === 0 ? 'new' : 'up';
      else if (r.orders < prevOrders) trend = 'down';
      return {
        value: r.value,
        orders: r.orders,
        units: r.units,
        pct: curAgg.totalOrdersInGroup > 0 ? Math.round((r.orders / curAgg.totalOrdersInGroup) * 1000) / 10 : 0,
        prev_orders: prevOrders,
        prev_pct: prevAgg.totalOrdersInGroup > 0 ? Math.round((prevOrders / prevAgg.totalOrdersInGroup) * 1000) / 10 : 0,
        trend,
      };
    });
  }, [curAgg, prevAgg]);

  const totalOrders = curAgg.totalOrdersInGroup;
  const activeVariants = rows.length;
  const top = rows[0] || null;

  const goToLevel = (level: number) => {
    const next = Math.max(0, Math.min(level, path.length));
    setPath((p) => p.slice(0, next));
  };

  return (
    <div style={{ fontFamily: ds.font, maxWidth: 1280, margin: '0 auto' }}>
      <PageHeader
        title="Pedidos por variante"
        subtitle="Drill-down por niveles de opciones Shopify (option1/2/3)."
        right={
          <Link
            to="/analisis-producto"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              border: `1px solid ${ds.borderCard}`,
              background: ds.bgCard,
              color: ds.textSecondary,
              borderRadius: 8,
              padding: '7px 14px',
              fontSize: 12,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Volver a Análisis
          </Link>
        }
      />

      {!shopifyOk && !loading ? (
        <div style={{ marginBottom: 14, padding: '12px 14px', borderRadius: 12, background: ds.infoBg, color: ds.infoText, fontSize: 13 }}>
          Conecta tu tienda en Canales para listar productos.
        </div>
      ) : null}

      {optionLevels.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {optionLevels.map((name, idx) => {
            const active = idx === activeLevelIdx;
            const clickable = idx <= path.length;
            return (
              <button
                key={`${idx}-${name}`}
                type="button"
                onClick={() => {
                  if (!clickable) return;
                  goToLevel(idx);
                }}
                style={{
                  border: `1px solid ${ds.borderCard}`,
                  background: active ? ds.brandBg : ds.bgCard,
                  color: active ? ds.brand : ds.textSecondary,
                  padding: '8px 12px',
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: clickable ? 'pointer' : 'not-allowed',
                  opacity: clickable ? 1 : 0.6,
                }}
              >
                {name}
              </button>
            );
          })}
        </div>
      ) : null}

      <div style={{ marginBottom: 12, fontSize: 12, color: ds.textSecondary }}>
        <button
          type="button"
          onClick={() => goToLevel(0)}
          style={{
            border: 'none',
            background: 'transparent',
            color: path.length ? ds.brand : ds.textPrimary,
            cursor: path.length ? 'pointer' : 'default',
            fontWeight: path.length ? 800 : 900,
            padding: 0,
          }}
        >
          Todos
        </button>
        {path.map((p, i) => (
          <span key={`${i}-${p}`}>
            <span style={{ color: ds.textMuted }}> › </span>
            {i < path.length - 1 ? (
              <button
                type="button"
                onClick={() => goToLevel(i + 1)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: ds.brand,
                  cursor: 'pointer',
                  fontWeight: 800,
                  padding: 0,
                }}
              >
                {p || '—'}
              </button>
            ) : (
              <span style={{ color: ds.textPrimary, fontWeight: 900 }}>{p || '—'}</span>
            )}
          </span>
        ))}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.4fr 1fr 1fr',
          gap: 10,
          marginBottom: 12,
          alignItems: 'end',
        }}
      >
        <label style={{ display: 'block', fontSize: 12, color: ds.textSecondary, fontWeight: 600 }}>
          Producto
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            style={{ ...inputStyle, width: '100%', marginTop: 6 }}
            disabled={!shopifyOk || products.length === 0}
          >
            {products.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'block', fontSize: 12, color: ds.textSecondary, fontWeight: 600 }}>
          Desde
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ ...inputStyle, width: '100%', marginTop: 6 }} />
        </label>
        <label style={{ display: 'block', fontSize: 12, color: ds.textSecondary, fontWeight: 600 }}>
          Hasta
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ ...inputStyle, width: '100%', marginTop: 6 }} />
        </label>
      </div>

      {error ? (
        <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, background: ds.dangerBg, color: ds.dangerText, border: `1px solid ${ds.borderCard}`, fontSize: 13 }}>
          {error}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(180px,1fr))', gap: 10, marginBottom: 12 }}>
        <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ fontSize: 12, color: ds.textMuted, marginBottom: 6 }}>Total de pedidos</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: ds.textPrimary, lineHeight: 1.1 }}>{loading ? '—' : totalOrders}</div>
          <div style={{ fontSize: 12, color: ds.textSecondary, marginTop: 6 }}>
            Rango: <span style={{ fontWeight: 700 }}>{from}</span> → <span style={{ fontWeight: 700 }}>{to}</span>
          </div>
        </div>
        <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ fontSize: 12, color: ds.textMuted, marginBottom: 6 }}>
            {optionLevels[activeLevelIdx] ? `Top ${optionLevels[activeLevelIdx]}` : 'Top'}
          </div>
          <div style={{ fontSize: 14, fontWeight: 800, color: ds.textPrimary, lineHeight: 1.2, minHeight: 34 }}>
            {loading ? '—' : top ? top.value : '—'}
          </div>
          <div style={{ fontSize: 12, color: ds.textSecondary, marginTop: 6 }}>
            {loading ? '—' : top ? (
              <>
                <span style={{ fontWeight: 800 }}>{pct(top.pct)}</span> · {top.orders} pedidos
              </>
            ) : (
              '—'
            )}
          </div>
        </div>
        <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ fontSize: 12, color: ds.textMuted, marginBottom: 6 }}>Variantes activas</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: ds.textPrimary, lineHeight: 1.1 }}>{loading ? '—' : activeVariants}</div>
          <div style={{ fontSize: 12, color: ds.textSecondary, marginTop: 6 }}>Con al menos 1 pedido en el rango</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 12, marginBottom: 12 }}>
        <DataTable
          title={`Distribución por ${optionLevels[activeLevelIdx] || 'variante'}`}
          subtitle={loading ? 'Cargando…' : `${rows.length} fila${rows.length === 1 ? '' : 's'}`}
        >
          <div>
            {loading ? (
              <div style={{ padding: '14px 16px', fontSize: 12, color: ds.textMuted }}>Cargando distribución…</div>
            ) : rows.length === 0 ? (
              <div style={{ padding: '14px 16px', fontSize: 12, color: ds.textMuted }}>Sin datos en el rango.</div>
            ) : (
              rows.map((v) => (
                <BarRow
                  key={v.value}
                  label={v.value}
                  pctValue={v.pct}
                  right={
                    <span style={{ fontSize: 12, color: ds.textSecondary }}>
                      <strong style={{ color: ds.textPrimary }}>{v.orders}</strong> pedidos
                    </span>
                  }
                  action={
                    canDrill ? (
                      <button
                        type="button"
                        onClick={() => setPath((p) => [...p, v.value])}
                        style={{
                          border: `1px solid ${ds.borderCard}`,
                          background: ds.bgCard,
                          color: ds.textSecondary,
                          borderRadius: 10,
                          padding: '8px 12px',
                          fontSize: 12,
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        Ver por {nextLevelName}
                      </button>
                    ) : (
                      <span style={{ fontSize: 12, color: ds.textMuted, fontWeight: 800 }}>Nivel final</span>
                    )
                  }
                />
              ))
            )}
          </div>
        </DataTable>

        <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${ds.borderSide}` }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: ds.textPrimary }}>Notas</div>
            <div style={{ fontSize: 11, color: ds.textMuted, marginTop: 4, lineHeight: 1.4 }}>
              La tendencia se calcula comparando el rango seleccionado contra el mismo rango del mes anterior.
            </div>
          </div>
          <div style={{ padding: '14px 16px', fontSize: 12, color: ds.textSecondary, lineHeight: 1.5 }}>
            - Pedidos: cuenta órdenes únicas dentro del grupo padre actual.<br />
            - %: se recalcula sobre el total del grupo padre en cada nivel.<br />
            - Tendencia: compara contra el mismo rango del mes anterior.
          </div>
        </div>
      </div>

      <DataTable title="Detalle" subtitle={loading ? 'Cargando…' : `Comparación vs mes anterior`}>
        <table style={{ ...tableBase, minWidth: 860 }}>
          <thead>
            <tr>
              <Th>{optionLevels[activeLevelIdx] || 'Variante'}</Th>
              <Th style={{ textAlign: 'right' }}>Pedidos</Th>
              <Th style={{ textAlign: 'right' }}>% del total</Th>
              <Th style={{ textAlign: 'right' }}>Tendencia</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} style={{ padding: '16px 20px', fontSize: 12, color: ds.textMuted, borderBottom: 'none' }}>
                  Cargando detalle…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: '16px 20px', fontSize: 12, color: ds.textMuted, borderBottom: 'none' }}>
                  Sin variantes con pedidos en el rango.
                </td>
              </tr>
            ) : (
              rows.map((v, i) => {
                const t = trendLabel(v.trend);
                const isLast = i === rows.length - 1;
                return (
                  <tr key={`row-${v.value}`}>
                    <Td isLast={false} style={{ fontWeight: 600, color: ds.textPrimary }}>
                      {v.value}
                    </Td>
                    <Td isLast={false} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {v.orders}
                    </Td>
                    <Td isLast={false} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                      {pct(v.pct)}
                    </Td>
                    <Td isLast={isLast} style={{ textAlign: 'right' }}>
                      <span style={{ color: t.color, fontWeight: 800 }}>{t.text}</span>
                      <span style={{ color: ds.textMuted, marginLeft: 8, fontVariantNumeric: 'tabular-nums' }}>
                        ({v.prev_orders} prev)
                      </span>
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </DataTable>
    </div>
  );
}

