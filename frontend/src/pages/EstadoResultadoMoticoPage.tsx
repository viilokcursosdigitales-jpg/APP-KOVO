import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { apiFetch } from '../auth/api';
import { coerceOrderInternalEstadoForSelect } from '../constants/orderInternalEstado';
import { ds } from '../design-system/ds';
import { PageHeader } from '../design-system/PageHeader';
import { type DatePreset, DATE_PRESETS, buildDateRange } from '../utils/datePresets';

const C = {
  costText: '#993C1D',
  gainText: '#0F6E56',
  badgeGreenBg: '#EAF3DE',
  badgeGreenText: '#3B6D11',
  badgeAmberBg: '#FAEEDA',
  badgeAmberText: '#854F0B',
  badgeCoralBg: '#FAECE7',
  badgeCoralText: '#993C1D',
} as const;

const ENTREGADO_ESTADOS = new Set(['despachado', 'pagado']);

type LineItemDetail = {
  title?: string;
  name?: string;
  quantity?: number | string;
  price?: number | string;
};

type OrderRow = {
  id: number;
  createdAt?: string;
  mensajero?: string | null;
  internal_status?: string;
  motico_status?: string;
  financialStatus?: string;
  price_override?: number | null;
  total?: string;
  shopifyTotal?: string;
  product_cost_motico?: number | null;
  freight_cost_motico?: number | null;
  lineItemsDetail?: LineItemDetail[];
};

type PnlTotals = {
  ventas: number;
  costoProducto: number;
  costoFlete: number;
  costoFleteDevolucion: number;
  gananciaBruta: number;
  margenBruto: number;
};

function formatCOP(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const rounded = Math.round(n);
  const sign = rounded < 0 ? '-' : '';
  const digits = Math.abs(rounded).toString();
  const withSeparators = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}$${withSeparators}`;
}

function formatPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

function numOrZero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function orderVentas(o: OrderRow): number {
  const raw =
    o.price_override != null && Number.isFinite(Number(o.price_override))
      ? Number(o.price_override)
      : Number.parseFloat(String(o.shopifyTotal ?? o.total ?? '0').replace(',', '.'));
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

function moticoFleteDevolucion(o: OrderRow): number {
  const fc = numOrZero(o.freight_cost_motico);
  const pay = String(o.financialStatus || '').toLowerCase();
  if (pay === 'refunded') return fc;
  if (pay === 'double_freight') return fc * 2;
  return 0;
}

function isPruebaRow(o: OrderRow): boolean {
  const st = coerceOrderInternalEstadoForSelect(o.motico_status || o.internal_status);
  return st === 'prueba';
}

function isMoticoScope(o: OrderRow): boolean {
  const mensajero = String(o.mensajero || '')
    .trim()
    .toLowerCase();
  const internalStatus = String(o.internal_status || '')
    .trim()
    .toLowerCase();
  return mensajero === 'motico' || internalStatus === 'motico';
}

function isEntregadoMotico(o: OrderRow): boolean {
  const st = coerceOrderInternalEstadoForSelect(o.motico_status || o.internal_status);
  return ENTREGADO_ESTADOS.has(st);
}

function computePnl(ventas: number, cp: number, cf: number, fd: number): PnlTotals {
  const gananciaBruta = ventas - cp - cf - fd;
  const margenBruto = ventas > 0 ? (gananciaBruta / ventas) * 100 : 0;
  return { ventas, costoProducto: cp, costoFlete: cf, costoFleteDevolucion: fd, gananciaBruta, margenBruto };
}

function marginBadgeStyle(pct: number): { bg: string; color: string } {
  if (pct >= 22) return { bg: C.badgeGreenBg, color: C.badgeGreenText };
  if (pct >= 15) return { bg: C.badgeAmberBg, color: C.badgeAmberText };
  return { bg: C.badgeCoralBg, color: C.badgeCoralText };
}

function Badge({ children, bg, color }: { children: ReactNode; bg: string; color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        background: bg,
        color,
      }}
    >
      {children}
    </span>
  );
}

function thStyle(): CSSProperties {
  return {
    textAlign: 'left',
    padding: '10px 12px',
    fontSize: 11,
    fontWeight: 700,
    color: ds.textMuted,
    textTransform: 'uppercase',
    letterSpacing: '0.02em',
    borderBottom: `0.5px solid ${ds.borderCard}`,
    background: ds.bgSubtle,
    whiteSpace: 'nowrap',
  };
}

function tdStyle(): CSSProperties {
  return {
    padding: '8px 12px',
    fontSize: 12,
    color: ds.textPrimary,
    borderBottom: `0.5px solid ${ds.borderRow}`,
    verticalAlign: 'middle',
  };
}

function tableWrapStyle(): CSSProperties {
  return {
    border: `0.5px solid ${ds.borderCard}`,
    borderRadius: 14,
    overflow: 'auto',
    background: ds.bgCard,
  };
}

function allocateOrderByProduct(o: OrderRow): Map<string, { ventas: number; cp: number; cf: number; fd: number }> {
  const ventas = orderVentas(o);
  const cp = numOrZero(o.product_cost_motico);
  const cf = numOrZero(o.freight_cost_motico);
  const fd = moticoFleteDevolucion(o);
  const lines = (o.lineItemsDetail || [])
    .map((li) => {
      const qty = Number.parseInt(String(li.quantity ?? 0), 10);
      const price = Number.parseFloat(String(li.price ?? '0').replace(',', '.'));
      const rev = Number.isFinite(qty) && qty > 0 && Number.isFinite(price) && price >= 0 ? price * qty : 0;
      const label = String(li.title || li.name || 'Sin producto').trim() || 'Sin producto';
      return { label, rev };
    })
    .filter((l) => l.rev > 0);
  const out = new Map<string, { ventas: number; cp: number; cf: number; fd: number }>();
  if (!lines.length) {
    out.set('Sin producto', { ventas, cp, cf, fd });
    return out;
  }
  const totalRev = lines.reduce((s, l) => s + l.rev, 0);
  const n = lines.length;
  for (const l of lines) {
    const share = totalRev > 0 ? l.rev / totalRev : 1 / n;
    const prev = out.get(l.label) || { ventas: 0, cp: 0, cf: 0, fd: 0 };
    prev.ventas += ventas * share;
    prev.cp += cp * share;
    prev.cf += cf * share;
    prev.fd += fd * share;
    out.set(l.label, prev);
  }
  return out;
}

export default function EstadoResultadoMoticoPage() {
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [datePreset, setDatePreset] = useState<DatePreset>('este_ano');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const dateQuery = useMemo(
    () => buildDateRange(datePreset, customFrom, customTo),
    [datePreset, customFrom, customTo],
  );

  const loadOrders = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const conn = await apiFetch('/api/shopify/connection');
      const cj = (await conn.json().catch(() => ({}))) as { status?: string; shop_domain?: string | null };
      if (!conn.ok || cj.status !== 'connected' || !cj.shop_domain) {
        setShopifyConnected(false);
        setOrders([]);
        return;
      }
      setShopifyConnected(true);
      const qs = new URLSearchParams({ mensajero_filter: 'motico' });
      if (dateQuery.min) qs.set('created_at_min', dateQuery.min);
      if (dateQuery.max) qs.set('created_at_max', dateQuery.max);
      const ordRes = await apiFetch(`/api/shopify/orders?${qs.toString()}`);
      const data = (await ordRes.json().catch(() => ({}))) as { orders?: OrderRow[]; error?: string; code?: string };
      if (!ordRes.ok) {
        if (data.code === 'not_connected') {
          setShopifyConnected(false);
          setOrders([]);
          return;
        }
        setError(typeof data.error === 'string' ? data.error : 'No se pudieron cargar los pedidos');
        setOrders([]);
        return;
      }
      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } catch {
      setError('Error de red al cargar datos');
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [dateQuery.min, dateQuery.max]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const entregadosRows = useMemo(() => {
    return orders.filter((o) => {
      if (!isMoticoScope(o) || isPruebaRow(o)) return false;
      return isEntregadoMotico(o);
    });
  }, [orders]);

  const estadoResultados = useMemo(() => {
    let ventas = 0;
    let costoProducto = 0;
    let costoFlete = 0;
    let costoFleteDevolucion = 0;
    for (const o of entregadosRows) {
      ventas += orderVentas(o);
      costoProducto += numOrZero(o.product_cost_motico);
      costoFlete += numOrZero(o.freight_cost_motico);
      costoFleteDevolucion += moticoFleteDevolucion(o);
    }
    return computePnl(ventas, costoProducto, costoFlete, costoFleteDevolucion);
  }, [entregadosRows]);

  const productPnl = useMemo(() => {
    const map = new Map<string, { ventas: number; cp: number; cf: number; fd: number }>();
    for (const o of entregadosRows) {
      const parts = allocateOrderByProduct(o);
      for (const [producto, v] of parts) {
        const prev = map.get(producto) || { ventas: 0, cp: 0, cf: 0, fd: 0 };
        prev.ventas += v.ventas;
        prev.cp += v.cp;
        prev.cf += v.cf;
        prev.fd += v.fd;
        map.set(producto, prev);
      }
    }
    const rows = Array.from(map.entries()).map(([producto, v]) => {
      const pnl = computePnl(v.ventas, v.cp, v.cf, v.fd);
      return { producto, ...pnl };
    });
    rows.sort((a, b) => b.gananciaBruta - a.gananciaBruta);
    const totals = rows.reduce(
      (acc, r) => {
        acc.ventas += r.ventas;
        acc.costoProducto += r.costoProducto;
        acc.costoFlete += r.costoFlete;
        acc.costoFleteDevolucion += r.costoFleteDevolucion;
        return acc;
      },
      { ventas: 0, costoProducto: 0, costoFlete: 0, costoFleteDevolucion: 0 },
    );
    return { rows, totals: computePnl(totals.ventas, totals.costoProducto, totals.costoFlete, totals.costoFleteDevolucion) };
  }, [entregadosRows]);

  const inputStyle: CSSProperties = {
    padding: '8px 10px',
    borderRadius: 8,
    border: `1px solid ${ds.borderCard}`,
    fontSize: 13,
    background: ds.bgCard,
    color: ds.textPrimary,
  };

  return (
    <div style={{ maxWidth: 1100 }}>
      <PageHeader
        title="Estado de resultado Motico"
        subtitle="Ventas y costos de pedidos Motico en estado Despachado o Pagado."
      />

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'flex-end',
          padding: 16,
          border: `0.5px solid ${ds.borderCard}`,
          borderRadius: 14,
          background: ds.bgCard,
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: ds.textMuted }}>Período</label>
          <select
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value as DatePreset)}
            style={inputStyle}
          >
            {DATE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        {datePreset === 'personalizado' ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: ds.textMuted }}>Desde</label>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: ds.textMuted }}>Hasta</label>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={inputStyle} />
            </div>
          </>
        ) : null}
        <button
          type="button"
          onClick={() => void loadOrders()}
          disabled={loading}
          style={{
            padding: '10px 18px',
            borderRadius: 10,
            border: 'none',
            background: ds.brand,
            color: '#fff',
            fontWeight: 700,
            fontSize: 13,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? 'Cargando…' : 'Actualizar'}
        </button>
      </div>

      {error ? (
        <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, background: ds.dangerBg, color: ds.dangerText, fontSize: 13 }}>
          {error}
        </div>
      ) : null}

      {!shopifyConnected && !loading ? (
        <div
          style={{
            padding: 24,
            borderRadius: 14,
            border: `0.5px solid ${ds.borderCard}`,
            background: ds.bgCard,
            color: ds.textSecondary,
            fontSize: 14,
          }}
        >
          Conecta Shopify en Integraciones para ver el estado de resultados Motico.
        </div>
      ) : null}

      {shopifyConnected ? (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 12,
              marginBottom: 20,
            }}
          >
            <div style={{ background: ds.bgCard, border: `0.5px solid ${ds.borderCard}`, borderRadius: 14, padding: '14px 16px' }}>
              <div style={{ fontSize: 11, color: ds.textMuted, fontWeight: 600, marginBottom: 6 }}>Pedidos entregados</div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{entregadosRows.length}</div>
              <div style={{ fontSize: 11, color: ds.textHint, marginTop: 6 }}>Despachado o Pagado</div>
            </div>
          </div>

          <section style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px' }}>Estado de resultados (entregados Motico)</h3>
            <p style={{ fontSize: 12, color: ds.textSecondary, margin: '0 0 12px', lineHeight: 1.5 }}>
              Ganancia bruta = ventas entregados Motico − costo producto − costo flete − costo flete devolución.
            </p>
            <div style={tableWrapStyle()}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {[
                      'Ventas entregados Motico',
                      'Costo producto entregados Motico',
                      'Costo de flete Motico',
                      'Costo flete devolución Motico',
                      'Ganancia bruta',
                      'Margen bruto',
                    ].map((h) => (
                      <th key={h} style={thStyle()}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ ...tdStyle(), fontWeight: 700 }}>{formatCOP(estadoResultados.ventas)}</td>
                    <td style={{ ...tdStyle(), color: C.costText, fontWeight: 600 }}>
                      -{formatCOP(estadoResultados.costoProducto)}
                    </td>
                    <td style={{ ...tdStyle(), color: C.costText, fontWeight: 600 }}>
                      -{formatCOP(estadoResultados.costoFlete)}
                    </td>
                    <td style={{ ...tdStyle(), color: C.costText, fontWeight: 600 }}>
                      -{formatCOP(estadoResultados.costoFleteDevolucion)}
                    </td>
                    <td style={{ ...tdStyle(), color: C.gainText, fontWeight: 800 }}>
                      {formatCOP(estadoResultados.gananciaBruta)}
                    </td>
                    <td style={tdStyle()}>
                      <Badge
                        bg={marginBadgeStyle(estadoResultados.margenBruto).bg}
                        color={marginBadgeStyle(estadoResultados.margenBruto).color}
                      >
                        {formatPct(estadoResultados.margenBruto)}
                      </Badge>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px' }}>Estado de resultados por producto (entregados Motico)</h3>
            <div style={tableWrapStyle()}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {[
                      'Producto',
                      'Ventas entregados',
                      'Costo producto',
                      'Costo flete',
                      'Flete devolución',
                      'Ganancia bruta',
                      'Margen bruto',
                    ].map((h) => (
                      <th key={h} style={thStyle()}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {productPnl.rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ ...tdStyle(), color: ds.textMuted, textAlign: 'center', padding: 24 }}>
                        {loading ? 'Cargando pedidos…' : 'No hay pedidos entregados en el período seleccionado.'}
                      </td>
                    </tr>
                  ) : (
                    productPnl.rows.map((r) => {
                      const st = marginBadgeStyle(r.margenBruto);
                      return (
                        <tr key={r.producto}>
                          <td style={tdStyle()}>{r.producto}</td>
                          <td style={tdStyle()}>{formatCOP(r.ventas)}</td>
                          <td style={{ ...tdStyle(), color: C.costText, fontWeight: 600 }}>-{formatCOP(r.costoProducto)}</td>
                          <td style={{ ...tdStyle(), color: C.costText, fontWeight: 600 }}>-{formatCOP(r.costoFlete)}</td>
                          <td style={{ ...tdStyle(), color: C.costText, fontWeight: 600 }}>-{formatCOP(r.costoFleteDevolucion)}</td>
                          <td style={{ ...tdStyle(), color: C.gainText, fontWeight: 700 }}>{formatCOP(r.gananciaBruta)}</td>
                          <td style={tdStyle()}>
                            <Badge bg={st.bg} color={st.color}>
                              {formatPct(r.margenBruto)}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })
                  )}
                  {productPnl.rows.length > 0 ? (
                    <tr style={{ background: 'var(--color-background-secondary)', fontWeight: 800 }}>
                      <td style={{ ...tdStyle(), fontWeight: 800 }}>TOTAL GENERAL</td>
                      <td style={tdStyle()}>{formatCOP(productPnl.totals.ventas)}</td>
                      <td style={{ ...tdStyle(), color: C.costText }}>-{formatCOP(productPnl.totals.costoProducto)}</td>
                      <td style={{ ...tdStyle(), color: C.costText }}>-{formatCOP(productPnl.totals.costoFlete)}</td>
                      <td style={{ ...tdStyle(), color: C.costText }}>-{formatCOP(productPnl.totals.costoFleteDevolucion)}</td>
                      <td style={{ ...tdStyle(), color: C.gainText }}>{formatCOP(productPnl.totals.gananciaBruta)}</td>
                      <td style={tdStyle()}>
                        <Badge
                          bg={marginBadgeStyle(productPnl.totals.margenBruto).bg}
                          color={marginBadgeStyle(productPnl.totals.margenBruto).color}
                        >
                          {formatPct(productPnl.totals.margenBruto)}
                        </Badge>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
