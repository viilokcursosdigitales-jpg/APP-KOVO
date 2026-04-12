import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';
import { DataTable, Th, Td, tableBase } from '../design-system/DataTable';
import { IconCart } from '../design-system/icons';
import { KpiCard } from '../design-system/KpiCard';
import { PageHeader } from '../design-system/PageHeader';
import { StatusBadge, type StatusBadgeVariant } from '../design-system/StatusBadge';
import { type DatePreset, DATE_PRESETS, buildDateRange } from '../utils/datePresets';

const DEMO_TOP_PRODUCTS = [
  { product_id: 1, title: 'Crema hidratante', orders_count: 42, orders_despachados: 36, sales_total: 2100, sales_despachados: 1820 },
  { product_id: 2, title: 'Sérum vitamina C', orders_count: 31, orders_despachados: 28, sales_total: 1550, sales_despachados: 1390 },
  { product_id: 3, title: 'Kit rutina PM', orders_count: 24, orders_despachados: 20, sales_total: 980, sales_despachados: 820 },
  { product_id: 4, title: 'Protector solar SPF50', orders_count: 18, orders_despachados: 15, sales_total: 540, sales_despachados: 450 },
];

const CHART_COLORS = [
  '#6c47ff',
  '#22c55e',
  '#3b82f6',
  '#f97316',
  '#a855f7',
  '#14b8a6',
  '#ec4899',
  '#eab308',
  '#6366f1',
];

type DashboardTotals = {
  sales_all: number;
  sales_despachados: number;
  orders_count: number;
  orders_despachados: number;
  despachados_pct: number;
  orders_cancelados: number;
  cancelados_pct: number;
  ad_spend: number | null;
  roas: number | null;
  roas_despachado: number | null;
};

type ChartPoint = { date: string; amount: number };

type TopProductRow = {
  product_id: number;
  title: string;
  orders_count: number;
  orders_despachados: number;
  sales_total: number;
  sales_despachados: number;
};

type RecentRow = {
  id: number;
  orderName: string;
  client: string;
  total: string;
  currency: string;
  financialLabel: string;
  badgeVariant: string;
};

type ShopifyProduct = { id: number; title: string };

const filterCtl: CSSProperties = {
  padding: '7px 12px',
  borderRadius: 8,
  border: `1px solid ${ds.borderCard}`,
  background: ds.bgCard,
  color: ds.textPrimary,
  fontSize: 12,
  fontWeight: 500,
  minWidth: 0,
};

function formatMoney(n: number, currency: string) {
  const curRaw = currency && currency.length === 3 ? currency : 'EUR';
  const cur = curRaw.toUpperCase();
  if (cur === 'COP') {
    const formatted = new Intl.NumberFormat('es-CO', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(n);
    return `$${formatted}`;
  }
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: cur }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

function formatRoas(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
}

function formatDayLabel(isoDate: string) {
  try {
    const [y, m, d] = isoDate.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  } catch {
    return isoDate;
  }
}

function safeBadgeVariant(v: string): StatusBadgeVariant {
  return ['success', 'paused', 'error', 'info', 'warning'].includes(v)
    ? (v as StatusBadgeVariant)
    : 'info';
}

export default function DashboardHome() {
  const [datePreset, setDatePreset] = useState<DatePreset>('hoy');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [productId, setProductId] = useState('');

  const [shopifyOk, setShopifyOk] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [totals, setTotals] = useState<DashboardTotals | null>(null);
  const [chart, setChart] = useState<ChartPoint[]>([]);
  const [topProducts, setTopProducts] = useState<TopProductRow[]>([]);
  const [recent, setRecent] = useState<RecentRow[]>([]);
  const [products, setProducts] = useState<ShopifyProduct[]>([]);

  const dateQuery = useMemo(
    () => buildDateRange(datePreset, customFrom, customTo),
    [datePreset, customFrom, customTo],
  );

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const conn = await apiFetch('/api/shopify/connection');
      if (!conn.ok) {
        setShopifyOk(false);
        setTotals(null);
        setChart([]);
        setTopProducts([]);
        setRecent([]);
        setProducts([]);
        return;
      }
      const crow = (await conn.json()) as { status?: string; shop_domain?: string | null };
      const ok = crow.status === 'connected' && Boolean(crow.shop_domain);
      setShopifyOk(ok);
      if (!ok) {
        setTotals(null);
        setChart([]);
        setTopProducts([]);
        setRecent([]);
        setProducts([]);
        return;
      }

      const qs = new URLSearchParams();
      if (dateQuery.min) qs.set('created_at_min', dateQuery.min);
      if (dateQuery.max) qs.set('created_at_max', dateQuery.max);
      if (productId.trim()) qs.set('product_id', productId.trim());

      const [dashRes, prodRes] = await Promise.all([
        apiFetch(`/api/shopify/dashboard?${qs.toString()}`),
        apiFetch('/api/shopify/products?limit=250'),
      ]);

      if (!dashRes.ok) {
        const err = (await dashRes.json().catch(() => ({}))) as { error?: string };
        setError(typeof err.error === 'string' ? err.error : 'Error al cargar el dashboard');
        setTotals({
          sales_all: 0,
          sales_despachados: 0,
          orders_count: 0,
          orders_despachados: 0,
          despachados_pct: 0,
          orders_cancelados: 0,
          cancelados_pct: 0,
          ad_spend: null,
          roas: null,
          roas_despachado: null,
        });
        setChart([]);
        setTopProducts([]);
        setRecent([]);
        return;
      }
      const data = (await dashRes.json()) as {
        currency?: string;
        totals: DashboardTotals;
        chart: ChartPoint[];
        top_products?: TopProductRow[];
        recent: RecentRow[];
      };
      setCurrency(data.currency || 'EUR');
      const tot = data.totals;
      setTotals({
        ...tot,
        ad_spend: tot.ad_spend ?? null,
        roas: tot.roas ?? null,
        roas_despachado: tot.roas_despachado ?? null,
      });
      setChart(Array.isArray(data.chart) ? data.chart : []);
      setTopProducts(Array.isArray(data.top_products) ? data.top_products : []);
      setRecent(Array.isArray(data.recent) ? data.recent : []);

      if (prodRes.ok) {
        const pdata = (await prodRes.json()) as { products?: ShopifyProduct[] };
        setProducts(Array.isArray(pdata.products) ? pdata.products : []);
      }
    } catch {
      setError('Error de red');
      setShopifyOk(false);
      setTopProducts([]);
    } finally {
      setLoading(false);
    }
  }, [dateQuery.min, dateQuery.max, productId]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const maxChart = useMemo(() => Math.max(...chart.map((c) => c.amount), 1), [chart]);

  const topRows = shopifyOk ? topProducts : !loading ? DEMO_TOP_PRODUCTS : [];
  const maxTopSales = useMemo(() => {
    const rows = shopifyOk ? topProducts : !loading ? DEMO_TOP_PRODUCTS : [];
    return Math.max(...rows.map((r) => r.sales_total), 1);
  }, [shopifyOk, loading, topProducts]);

  const t = totals;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={
          shopifyOk
            ? 'Ventas y pedidos desde Shopify (estado Despachado / Cancelado según KOVO y pago en Shopify).'
            : 'Resumen de ventas y pedidos. Conecta Shopify en Canales para datos reales.'
        }
      />

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
          marginBottom: 18,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: ds.textMuted }}>Fecha</span>
        {DATE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={!shopifyOk && loading}
            onClick={() => setDatePreset(p.id)}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              border: `1px solid ${ds.borderCard}`,
              background: datePreset === p.id ? ds.brandBg : ds.bgCard,
              color: datePreset === p.id ? ds.brand : ds.textSecondary,
              fontSize: 11,
              fontWeight: datePreset === p.id ? 600 : 500,
              cursor: shopifyOk || !loading ? 'pointer' : 'not-allowed',
              opacity: shopifyOk || !loading ? 1 : 0.6,
            }}
          >
            {p.id === 'este_ano' ? 'Este año (hasta hoy)' : p.label}
          </button>
        ))}
        {datePreset === 'personalizado' ? (
          <>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              disabled={!shopifyOk}
              style={{ ...filterCtl, maxWidth: 150 }}
            />
            <span style={{ fontSize: 12, color: ds.textMuted }}>a</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              disabled={!shopifyOk}
              style={{ ...filterCtl, maxWidth: 150 }}
            />
          </>
        ) : null}

        <span style={{ fontSize: 12, fontWeight: 600, color: ds.textMuted, marginLeft: 8 }}>Producto</span>
        <select
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          disabled={!shopifyOk}
          style={{ ...filterCtl, minWidth: 200, maxWidth: 320, fontWeight: 600 }}
        >
          <option value="">Todos los productos</option>
          {products.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.title}
            </option>
          ))}
        </select>
      </div>

      {productId.trim() ? (
        <div style={{ fontSize: 11, color: ds.textMuted, marginBottom: 12, maxWidth: 560, lineHeight: 1.45 }}>
          Con un producto concreto seleccionado no se muestran gasto publicitario ni ROAS (el gasto Meta es de toda la cuenta y las ventas están filtradas por producto).
        </div>
      ) : null}

      {error ? (
        <div
          style={{
            marginBottom: 16,
            padding: '12px 16px',
            borderRadius: 12,
            background: ds.dangerBg,
            color: ds.dangerText,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      {shopifyOk && t ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 14,
            marginBottom: 24,
          }}
        >
          <KpiCard
            variant="sales"
            label="Total ventas (pedidos en rango)"
            value={formatMoney(t.sales_all, currency)}
            icon={<IconCart />}
          />
          <KpiCard
            variant="conversion"
            label="Ventas pedidos despachados"
            value={formatMoney(t.sales_despachados, currency)}
            icon={<IconCart />}
          />
          <KpiCard
            variant="spend"
            label="Gasto publicitario (Meta, mismo rango)"
            value={t.ad_spend != null ? formatMoney(t.ad_spend, currency) : '—'}
            icon={<IconCart />}
          />
          <KpiCard
            variant="sales"
            label="ROAS (ventas Shopify ÷ gasto)"
            value={formatRoas(t.roas)}
            icon={<IconCart />}
          />
          <KpiCard
            variant="conversion"
            label="ROAS despachado (ventas despachadas ÷ gasto)"
            value={formatRoas(t.roas_despachado)}
            icon={<IconCart />}
          />
          <KpiCard
            variant="traffic"
            label="Total pedidos"
            value={String(t.orders_count)}
            icon={<IconCart />}
          />
          <KpiCard
            variant="stock"
            label="Pedidos despachados"
            value={`${t.orders_despachados} · ${t.despachados_pct.toFixed(1)} %`}
            icon={<IconCart />}
          />
          <KpiCard
            variant="alert"
            label="Pedidos cancelados / anulados / reembolsados"
            value={`${t.orders_cancelados} · ${t.cancelados_pct.toFixed(1)} %`}
            icon={<IconCart />}
          />
        </div>
      ) : !loading ? (
        <div className="kovo-kpi-grid-dash" style={{ marginBottom: 24 }}>
          <KpiCard variant="sales" label="Ingresos (30 días) — demo" value="€ 18.420,00" icon={<IconCart />} />
          <KpiCard variant="traffic" label="Pedidos — demo" value="326" icon={<IconCart />} />
          <KpiCard variant="spend" label="Ticket medio — demo" value="€ 56,50" icon={<IconCart />} />
          <KpiCard variant="conversion" label="Tasa conversión — demo" value="3,2 %" icon={<IconCart />} />
        </div>
      ) : null}

      <div
        style={{
          marginTop: 8,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
          gap: 14,
          alignItems: 'stretch',
        }}
        className="kovo-dash-grid"
      >
        <div
          style={{
            background: ds.bgCard,
            border: `1px solid ${ds.borderCard}`,
            borderRadius: 14,
            padding: '18px 20px',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary, marginBottom: 4 }}>
            Ventas por día
          </div>
          <div style={{ fontSize: 11, color: ds.textMuted, marginBottom: 16 }}>
            {shopifyOk ? 'Importe por fecha de creación del pedido (colores por día)' : 'Serie demo'}
          </div>
          {shopifyOk && chart.length > 0 ? (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: 8,
                  minHeight: 180,
                  paddingTop: 8,
                  overflowX: 'auto',
                  paddingBottom: 4,
                }}
              >
                {chart.map((row, idx) => (
                  <div
                    key={row.date}
                    style={{
                      flex: '1 0 36px',
                      maxWidth: 48,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <div
                      title={`${formatDayLabel(row.date)}: ${formatMoney(row.amount, currency)}`}
                      style={{
                        width: '100%',
                        height: `${Math.max(8, (row.amount / maxChart) * 140)}px`,
                        minHeight: 8,
                        background: CHART_COLORS[idx % CHART_COLORS.length],
                        borderRadius: 8,
                        boxShadow: `0 2px 8px ${CHART_COLORS[idx % CHART_COLORS.length]}40`,
                      }}
                    />
                    <span style={{ fontSize: 9, color: ds.textHint, textAlign: 'center', lineHeight: 1.2 }}>
                      {formatDayLabel(row.date)}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14, fontSize: 10, color: ds.textMuted }}>
                {chart.slice(0, 8).map((row, idx) => (
                  <span key={row.date} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 3,
                        background: CHART_COLORS[idx % CHART_COLORS.length],
                      }}
                    />
                    {formatDayLabel(row.date)} {formatMoney(row.amount, currency)}
                  </span>
                ))}
                {chart.length > 8 ? <span>+{chart.length - 8} días más en el gráfico</span> : null}
              </div>
            </>
          ) : shopifyOk && !loading ? (
            <div style={{ padding: 32, textAlign: 'center', color: ds.textMuted, fontSize: 13 }}>
              No hay ventas en el rango y filtros seleccionados.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 160, paddingTop: 8 }}>
                {[
                  { w: 'S1', h: 62 },
                  { w: 'S2', h: 55 },
                  { w: 'S3', h: 70 },
                  { w: 'S4', h: 58 },
                ].map((row, idx) => (
                  <div key={row.w} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        width: '70%',
                        height: `${row.h}%`,
                        minHeight: 40,
                        background: CHART_COLORS[idx % CHART_COLORS.length],
                        borderRadius: 8,
                      }}
                    />
                    <span style={{ fontSize: 10, color: ds.textHint }}>{row.w}</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: ds.textMuted, marginTop: 12 }}>Datos de demostración</div>
            </>
          )}
        </div>

        <div
          style={{
            background: ds.bgCard,
            border: `1px solid ${ds.borderCard}`,
            borderRadius: 14,
            padding: '18px 20px',
            minHeight: 280,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary }}>Productos más vendidos</div>
          <div style={{ fontSize: 11, color: ds.textMuted, marginBottom: 14 }}>
            {shopifyOk
              ? 'Barras por importe total (líneas de pedido). Incluye pedidos, ventas totales, ventas despachadas y pedidos despachados.'
              : 'Ejemplo ilustrativo — conecta Shopify para tus datos'}
          </div>
          {topRows.length > 0 ? (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {topRows.map((row, idx) => {
                const color = CHART_COLORS[idx % CHART_COLORS.length];
                const pct = Math.max(6, (row.sales_total / maxTopSales) * 100);
                return (
                  <li key={row.product_id}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: ds.textPrimary,
                        marginBottom: 6,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={row.title}
                    >
                      {row.title}
                    </div>
                    <div
                      style={{
                        height: 10,
                        borderRadius: 6,
                        background: ds.borderRow,
                        overflow: 'hidden',
                        marginBottom: 8,
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${pct}%`,
                          borderRadius: 6,
                          background: color,
                          boxShadow: `0 1px 6px ${color}55`,
                          transition: 'width 0.25s ease',
                        }}
                      />
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                        gap: '6px 10px',
                        fontSize: 10,
                        color: ds.textMuted,
                        lineHeight: 1.35,
                      }}
                    >
                      <span>
                        <span style={{ color: ds.textHint }}>Pedidos</span> ·{' '}
                        <span style={{ fontWeight: 600, color: ds.textSecondary }}>{row.orders_count}</span>
                      </span>
                      <span>
                        <span style={{ color: ds.textHint }}>Ventas totales</span> ·{' '}
                        <span style={{ fontWeight: 600, color: ds.textSecondary }}>
                          {formatMoney(row.sales_total, currency)}
                        </span>
                      </span>
                      <span>
                        <span style={{ color: ds.textHint }}>Ventas despachadas</span> ·{' '}
                        <span style={{ fontWeight: 600, color: ds.textSecondary }}>
                          {formatMoney(row.sales_despachados, currency)}
                        </span>
                      </span>
                      <span>
                        <span style={{ color: ds.textHint }}>Pedidos despachados</span> ·{' '}
                        <span style={{ fontWeight: 600, color: ds.textSecondary }}>{row.orders_despachados}</span>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : shopifyOk && !loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: ds.textMuted, fontSize: 13 }}>
              No hay líneas de producto en el rango y filtros seleccionados.
            </div>
          ) : (
            <div style={{ padding: 24, textAlign: 'center', color: ds.textMuted, fontSize: 13 }}>Cargando…</div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <DataTable
          title="Pedidos recientes"
          subtitle={shopifyOk ? 'En el rango y filtro de producto actual' : 'Últimas transacciones (demo)'}
          action={
            <Link to="/pedidos" style={{ fontSize: 13, fontWeight: 600, color: ds.brand, textDecoration: 'none' }}>
              Ver todos →
            </Link>
          }
        >
          <table style={{ ...tableBase, minWidth: 520 }}>
            <thead>
              <tr>
                <Th>Pedido</Th>
                <Th>Cliente</Th>
                <Th>Total</Th>
                <Th>Estado</Th>
              </tr>
            </thead>
            <tbody>
              {shopifyOk && recent.length > 0
                ? recent.map((o, i) => (
                    <tr key={o.id}>
                      <Td isLast={i === recent.length - 1}>
                        <div style={{ fontWeight: 600, fontSize: 12, color: ds.textPrimary }}>{o.orderName}</div>
                      </Td>
                      <Td isLast={i === recent.length - 1}>{o.client}</Td>
                      <Td isLast={i === recent.length - 1}>
                        {formatMoney(Number.parseFloat(String(o.total)) || 0, o.currency || currency)}
                      </Td>
                      <Td isLast={i === recent.length - 1}>
                        <StatusBadge variant={safeBadgeVariant(o.badgeVariant)}>{o.financialLabel}</StatusBadge>
                      </Td>
                    </tr>
                  ))
                : [
                    { id: '#4821', name: 'María G.', sub: 'Hace 2 h', total: '€ 124,90', status: 'success' as const, label: 'Completado' },
                    { id: '#4820', name: 'Pedro L.', sub: 'Hace 5 h', total: '€ 89,00', status: 'info' as const, label: 'En proceso' },
                    { id: '#4819', name: 'Ana R.', sub: 'Ayer', total: '€ 210,50', status: 'success' as const, label: 'Completado' },
                    { id: '#4818', name: 'Luis M.', sub: 'Ayer', total: '€ 45,00', status: 'paused' as const, label: 'Pendiente' },
                  ].map((o, i, arr) => (
                    <tr key={o.id}>
                      <Td isLast={i === arr.length - 1}>
                        <div style={{ fontWeight: 600, fontSize: 12, color: ds.textPrimary }}>{o.id}</div>
                        <div style={{ fontSize: 10.5, color: ds.textHint }}>{o.sub}</div>
                      </Td>
                      <Td isLast={i === arr.length - 1}>{o.name}</Td>
                      <Td isLast={i === arr.length - 1}>{o.total}</Td>
                      <Td isLast={i === arr.length - 1}>
                        <StatusBadge variant={o.status}>{o.label}</StatusBadge>
                      </Td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </DataTable>
      </div>

      {!shopifyOk && !loading ? (
        <div style={{ marginTop: 16, fontSize: 13, color: ds.textSecondary }}>
          <Link to="/canales" style={{ color: ds.brand, fontWeight: 600 }}>
            Conectar Shopify en Canales
          </Link>
          {' '}para filtros, KPIs y gráfico con datos reales (máx. 250 pedidos por consulta).
        </div>
      ) : null}

      <style>{`
        @media (max-width: 900px) {
          .kovo-dash-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </>
  );
}
