import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../auth/api';
import { DataTable, Td, Th, tableBase } from '../design-system/DataTable';
import { PageHeader } from '../design-system/PageHeader';
import { ds } from '../design-system/ds';

type ProductRow = { id: number; title: string };

type VariantRow = {
  key: string;
  variant_id: number | null;
  variant: string;
  orders: number;
  units: number;
  pct: number;
  prev_orders: number;
  prev_pct: number;
  trend: 'up' | 'down' | 'same' | 'new';
};

type Payload = {
  product_id: number;
  range: { from: string; to: string };
  previous_range: { from: string; to: string } | null;
  total_orders: number;
  top_variant: { variant: string; orders: number; pct: number } | null;
  active_variants: number;
  variants: VariantRow[];
  error?: string;
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

function trendLabel(t: VariantRow['trend']): { text: string; color: string } {
  if (t === 'up') return { text: 'Subió', color: ds.successText };
  if (t === 'down') return { text: 'Bajó', color: ds.dangerText };
  if (t === 'new') return { text: 'Nuevo', color: ds.warningText };
  return { text: 'Igual', color: ds.textMuted };
}

function pct(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return `${v.toFixed(1)}%`;
}

function BarRow({ label, pctValue, right }: { label: string; pctValue: number; right: React.ReactNode }) {
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
  const [data, setData] = useState<Payload | null>(null);

  const loadProducts = useCallback(async () => {
    try {
      const res = await apiFetch('/api/shopify/products?limit=250');
      if (!res.ok) {
        setProducts([]);
        setShopifyOk(false);
        return;
      }
      const j = (await res.json()) as { products?: { id: number | string; title?: string }[] };
      const list = Array.isArray(j.products)
        ? j.products
            .map((p) => ({ id: Number.parseInt(String(p.id), 10), title: String(p.title || '(sin título)') }))
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

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setData(null);
    try {
      const pid = Number.parseInt(productId, 10);
      if (!Number.isFinite(pid) || pid <= 0) {
        setError('Selecciona un producto');
        setLoading(false);
        return;
      }
      const qs = new URLSearchParams();
      qs.set('product_id', String(pid));
      qs.set('from', from);
      qs.set('to', to);
      const res = await apiFetch(`/api/product-analytics/orders-by-variant?${qs.toString()}`);
      const j = (await res.json().catch(() => ({}))) as Payload;
      if (!res.ok) {
        setError(typeof j.error === 'string' ? j.error : 'No se pudo cargar pedidos por variante');
        return;
      }
      setData(j);
    } catch {
      setError('Error de red');
    } finally {
      setLoading(false);
    }
  }, [productId, from, to]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    if (!productId) return;
    void load();
  }, [productId, from, to, load]);

  const top = data?.top_variant;
  const variants = Array.isArray(data?.variants) ? data!.variants : [];
  const totalOrders = Number(data?.total_orders || 0);
  const activeVariants = Number(data?.active_variants || 0);

  const tableRows = useMemo(() => variants, [variants]);

  return (
    <div style={{ fontFamily: ds.font, maxWidth: 1280, margin: '0 auto' }}>
      <PageHeader
        title="Pedidos por variante"
        subtitle="Distribución de pedidos por variante (talla, color, etc.) para un producto Shopify."
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
          <div style={{ fontSize: 12, color: ds.textMuted, marginBottom: 6 }}>Variante con más pedidos</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: ds.textPrimary, lineHeight: 1.2, minHeight: 34 }}>
            {loading ? '—' : top ? top.variant : '—'}
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
        <DataTable title="Distribución por variante" subtitle={loading ? 'Cargando…' : `${variants.length} variante${variants.length === 1 ? '' : 's'}`}>
          <div>
            {loading ? (
              <div style={{ padding: '14px 16px', fontSize: 12, color: ds.textMuted }}>Cargando distribución…</div>
            ) : variants.length === 0 ? (
              <div style={{ padding: '14px 16px', fontSize: 12, color: ds.textMuted }}>Sin datos en el rango.</div>
            ) : (
              variants.map((v, idx) => (
                <BarRow
                  key={v.key}
                  label={v.variant}
                  pctValue={v.pct}
                  right={
                    <span style={{ fontSize: 12, color: ds.textSecondary }}>
                      <strong style={{ color: ds.textPrimary }}>{v.orders}</strong> pedidos
                    </span>
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
            - Pedidos: cuenta órdenes únicas donde aparece el producto (si en una orden hay 2 variantes del mismo producto, suma 1 a cada variante).<br />
            - %: participación de pedidos por variante sobre el total del producto en el rango.
          </div>
        </div>
      </div>

      <DataTable title="Detalle" subtitle={loading ? 'Cargando…' : `Comparación vs mes anterior`}>
        <table style={{ ...tableBase, minWidth: 860 }}>
          <thead>
            <tr>
              <Th>Variante</Th>
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
            ) : tableRows.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: '16px 20px', fontSize: 12, color: ds.textMuted, borderBottom: 'none' }}>
                  Sin variantes con pedidos en el rango.
                </td>
              </tr>
            ) : (
              tableRows.map((v, i) => {
                const t = trendLabel(v.trend);
                const isLast = i === tableRows.length - 1;
                return (
                  <tr key={`row-${v.key}`}>
                    <Td isLast={false} style={{ fontWeight: 600, color: ds.textPrimary }}>
                      {v.variant}
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

