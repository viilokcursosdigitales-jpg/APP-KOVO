import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { apiFetch } from '../auth/api';
import { DataTable, Td, Th, tableBase } from '../design-system/DataTable';
import { ds } from '../design-system/ds';
import { StatusBadge, type StatusBadgeVariant } from '../design-system/StatusBadge';

type ProductStatus = 'ganador' | 'prueba' | 'perdedor';
type DateFilter = 'hoy' | 'ayer' | '3d' | '7d' | '14d' | '30d' | 'custom';

type ProductAgg = {
  key: string;
  nombre: string;
  productId: number | null;
  ventas: number;
  ventasEntregadas: number;
  pedidos: number;
  cantidad: number;
  costoProducto: number;
  costoProductoEntregado: number;
  flete: number;
  adminCost: number;
  gastoAds: number;
  cpa: number;
  roasReal: number;
  roasEq: number;
  profit: number;
  estado: ProductStatus;
};

type SeriesByProduct = {
  label?: string;
  product_id?: number | null;
  ventas_despachadas_total?: number;
  ventas_entregadas_total?: number;
  ventas_despachadas_pedidos?: number;
  cantidad_producto_total?: number;
  costo_producto_total?: number;
  costo_producto_entregado_total?: number;
  costo_flete_promedio_total?: number;
};

type SeriesDay = {
  date: string;
  ventas_despachadas_total: number;
  ventas_entregadas_total: number;
  ventas_despachadas_pedidos: number;
  cantidad_producto_total: number;
  costo_producto_total: number;
  costo_producto_entregado_total: number;
  costo_flete_promedio_total: number;
  gasto_publicitario_total: number;
  by_product?: Record<string, SeriesByProduct>;
};

type SeriesPayload = {
  days?: SeriesDay[];
  error?: string;
  code?: string;
};

type MetaSpendPayload = {
  product_spend?: Record<string, number>;
  unlinked_spend?: number;
  error?: string;
};

function money(n: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n);
}

function pct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function parsePercentInput(raw: string): number {
  const n = Number.parseFloat(String(raw || '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function stateBadge(status: ProductStatus): { text: string; variant: StatusBadgeVariant } {
  if (status === 'ganador') return { text: 'Ganador', variant: 'success' };
  if (status === 'prueba') return { text: 'En Prueba', variant: 'warning' };
  return { text: 'Perdedor', variant: 'error' };
}

function linePath(values: number[], width: number, height: number): string {
  if (!values.length) return '';
  return values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * width;
      const y = height - v * height;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

function normalizeSeries(values: number[]): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return values.map(() => 0.55);
  return values.map((v) => (v - min) / (max - min));
}

function monthKeysForCount(count: number): string {
  const now = new Date();
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    out.push(`${y}-${m}`);
  }
  return out.join(',');
}

function periodConfig(filter: DateFilter): {
  currentStart: number;
  currentLen: number;
  months: number;
  metaPeriod: 'hoy' | 'ayer' | '3d' | '7d' | '14d' | '30d' | 'custom';
} {
  if (filter === 'hoy') return { currentStart: 0, currentLen: 1, months: 1, metaPeriod: 'hoy' };
  if (filter === 'ayer') return { currentStart: 1, currentLen: 1, months: 1, metaPeriod: 'ayer' };
  if (filter === '3d') return { currentStart: 0, currentLen: 3, months: 1, metaPeriod: '3d' };
  if (filter === '7d' || filter === 'custom') return { currentStart: 0, currentLen: 7, months: 2, metaPeriod: filter };
  if (filter === '14d') return { currentStart: 0, currentLen: 14, months: 2, metaPeriod: '14d' };
  return { currentStart: 0, currentLen: 30, months: 3, metaPeriod: '30d' };
}

function classifyProduct(roasReal: number, roasEq: number): ProductStatus {
  if (roasEq <= 0) return roasReal >= 2 ? 'ganador' : roasReal >= 1.2 ? 'prueba' : 'perdedor';
  if (roasReal >= roasEq * 1.15) return 'ganador';
  if (roasReal >= roasEq * 0.85) return 'prueba';
  return 'perdedor';
}

const inputStyle: CSSProperties = {
  width: '100%',
  borderRadius: 8,
  border: `1px solid ${ds.borderCard}`,
  background: ds.bgCard,
  padding: '9px 12px',
  fontSize: 13,
  color: ds.textPrimary,
};

function KpiCard({ title, value, delta }: { title: string; value: string; delta: string }) {
  return (
    <div
      style={{
        background: ds.bgCard,
        border: `1px solid ${ds.borderCard}`,
        borderRadius: 12,
        padding: '12px 14px',
      }}
    >
      <div style={{ fontSize: 12, color: ds.textMuted, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1, color: ds.textPrimary, marginBottom: 8 }}>{value}</div>
      <StatusBadge variant="success">{`${delta} vs ayer`}</StatusBadge>
    </div>
  );
}

export default function AnalisisProductoPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<DateFilter>('7d');
  const [days, setDays] = useState<SeriesDay[]>([]);
  const [metaSpendByProductId, setMetaSpendByProductId] = useState<Record<string, number>>({});
  const [metaUnlinkedSpend, setMetaUnlinkedSpend] = useState(0);
  const [adminPercentInput, setAdminPercentInput] = useState(() => {
    try {
      return localStorage.getItem('kovo_ganancia_admin_percent') || '0';
    } catch {
      return '0';
    }
  });
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string>('');
  const adminPercent = useMemo(() => parsePercentInput(adminPercentInput), [adminPercentInput]);

  useEffect(() => {
    try {
      localStorage.setItem('kovo_ganancia_admin_percent', adminPercentInput);
    } catch {
      /* noop */
    }
  }, [adminPercentInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cfg = periodConfig(filter);
      const monthsCsv = monthKeysForCount(cfg.months);
      const suffix = monthsCsv ? `?months=${encodeURIComponent(monthsCsv)}` : '';
      const [seriesRes, spendRes] = await Promise.all([
        apiFetch(`/api/ganancia-diaria/series${suffix}`),
        apiFetch(`/api/product-analytics/meta-spend?period=${cfg.metaPeriod}`),
      ]);
      const data = (await seriesRes.json().catch(() => ({}))) as SeriesPayload;
      const spendData = (await spendRes.json().catch(() => ({}))) as MetaSpendPayload;
      if (!seriesRes.ok) {
        setError(typeof data.error === 'string' ? data.error : 'No se pudo cargar analisis de producto');
        setDays([]);
        return;
      }
      setDays(Array.isArray(data.days) ? data.days : []);
      setMetaSpendByProductId(
        spendRes.ok && spendData.product_spend && typeof spendData.product_spend === 'object'
          ? spendData.product_spend
          : {},
      );
      setMetaUnlinkedSpend(
        spendRes.ok && Number.isFinite(Number(spendData.unlinked_spend)) ? Number(spendData.unlinked_spend) : 0,
      );
    } catch {
      setError('Error de red');
      setDays([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const periodDays = useMemo(() => {
    const cfg = periodConfig(filter);
    return [...days].slice(cfg.currentStart, cfg.currentStart + cfg.currentLen);
  }, [days, filter]);

  const productMap = useMemo(() => {
    const map = new Map<string, ProductAgg>();
    for (const d of periodDays) {
      const byp = d.by_product && typeof d.by_product === 'object' ? d.by_product : {};
      for (const [key, raw] of Object.entries(byp)) {
        const ventas = Number(raw.ventas_despachadas_total || 0);
        const ventasEntregadas = Number(raw.ventas_entregadas_total || 0);
        const pedidos = Number(raw.ventas_despachadas_pedidos || 0);
        const cantidad = Number(raw.cantidad_producto_total || 0);
        const costoProducto = Number(raw.costo_producto_total || 0);
        const costoProductoEntregado = Number(raw.costo_producto_entregado_total || 0);
        const flete = Number(raw.costo_flete_promedio_total || 0);
        const prev = map.get(key);
        if (prev) {
          prev.ventas += ventas;
          prev.ventasEntregadas += ventasEntregadas;
          prev.pedidos += pedidos;
          prev.cantidad += cantidad;
          prev.costoProducto += costoProducto;
          prev.costoProductoEntregado += costoProductoEntregado;
          prev.flete += flete;
        } else {
          const pid =
            raw.product_id != null && Number.isFinite(Number(raw.product_id)) ? Number(raw.product_id) : null;
          map.set(key, {
            key,
            nombre: String(raw.label || key),
            productId: pid,
            ventas,
            ventasEntregadas,
            pedidos,
            cantidad,
            costoProducto,
            costoProductoEntregado,
            flete,
            adminCost: 0,
            gastoAds: 0,
            cpa: 0,
            roasReal: 0,
            roasEq: 0,
            profit: 0,
            estado: 'prueba',
          });
        }
      }
    }
    for (const p of map.values()) {
      p.gastoAds =
        p.productId != null && Number.isFinite(Number(metaSpendByProductId[String(p.productId)]))
          ? Number(metaSpendByProductId[String(p.productId)])
          : 0;
      p.adminCost = p.ventasEntregadas * (adminPercent / 100);
      p.cpa = p.pedidos > 0 ? p.gastoAds / p.pedidos : 0;
      p.roasReal = p.gastoAds > 0 ? p.ventas / p.gastoAds : 0;
      const baseCost = p.costoProductoEntregado + p.flete + p.adminCost;
      p.roasEq = p.gastoAds > 0 ? baseCost / p.gastoAds : 0;
      p.profit = p.ventas - p.gastoAds - baseCost;
      p.estado = classifyProduct(p.roasReal, p.roasEq);
    }
    return map;
  }, [periodDays, metaSpendByProductId, adminPercent]);

  const products = useMemo(
    () =>
      [...productMap.values()].sort((a, b) => b.ventas - a.ventas),
    [productMap],
  );

  const rows = useMemo(
    () => products.filter((p) => p.nombre.toLowerCase().includes(query.toLowerCase().trim())),
    [products, query],
  );
  const active = useMemo(() => {
    if (!rows.length) return null;
    return rows.find((p) => p.key === selected) || rows[0];
  }, [rows, selected]);

  useEffect(() => {
    if (!active) {
      setSelected('');
      return;
    }
    if (!selected || !rows.some((r) => r.key === selected)) {
      setSelected(active.key);
    }
  }, [active, rows, selected]);

  const gastoTotal = products.reduce((s, p) => s + p.gastoAds, 0);
  const ventasTotal = products.reduce((s, p) => s + p.ventas, 0);
  const roasPromedio = gastoTotal > 0 ? ventasTotal / gastoTotal : 0;

  const salesSeries = normalizeSeries(periodDays.map((d) => Number(d.ventas_despachadas_total || 0)));
  const spendSeries = normalizeSeries(periodDays.map((d) => Number(d.gasto_publicitario_total || 0)));
  const ordersSeries = normalizeSeries(periodDays.map((d) => Number(d.ventas_despachadas_pedidos || 0)));
  const dayLabels = periodDays
    .slice()
    .reverse()
    .slice(0, 7)
    .reverse()
    .map((d) => {
      try {
        return new Intl.DateTimeFormat('es-CO', { weekday: 'narrow' }).format(new Date(`${d.date}T12:00:00`));
      } catch {
        return 'D';
      }
    });

  const detailRoasSeries = useMemo(() => {
    if (!active) return [];
    const vals: number[] = [];
    for (const d of periodDays) {
      const byp = d.by_product || {};
      const p = byp[active.key];
      if (!p) {
        vals.push(0);
        continue;
      }
      const ventas = Number(p.ventas_despachadas_total || 0);
      const daySales = Number(d.ventas_despachadas_total || 0);
      const share = daySales > 0 ? ventas / daySales : 0;
      const ads = Number(d.gasto_publicitario_total || 0) * share;
      vals.push(ads > 0 ? ventas / ads : 0);
    }
    return normalizeSeries(vals);
  }, [active, periodDays]);

  const detailConvSeries = useMemo(() => {
    if (!active) return [];
    const vals: number[] = [];
    for (const d of periodDays) {
      const byp = d.by_product || {};
      const p = byp[active.key];
      if (!p) {
        vals.push(0);
        continue;
      }
      const pedidos = Number(p.ventas_despachadas_pedidos || 0);
      const qty = Number(p.cantidad_producto_total || 0);
      vals.push(qty > 0 ? (pedidos / qty) * 100 : 0);
    }
    return normalizeSeries(vals);
  }, [active, periodDays]);

  return (
    <div style={{ fontFamily: ds.font, maxWidth: 1280, margin: '0 auto' }}>
      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 7,
              background: ds.brand,
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            K
          </div>
          <h1 style={{ margin: 0, color: ds.textPrimary, fontSize: 30, fontWeight: 700 }}>Analisis de productos</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            value={adminPercentInput}
            onChange={(e) => setAdminPercentInput(e.target.value)}
            inputMode="decimal"
            aria-label="Porcentaje administrativo"
            title="Porcentaje administrativo"
            style={{ ...inputStyle, width: 90 }}
          />
          <span style={{ alignSelf: 'center', fontSize: 12, color: ds.textMuted }}>Admin %</span>
          <select
            style={inputStyle}
            value={filter}
            onChange={(e) => setFilter(e.target.value as DateFilter)}
          >
            <option value="hoy">Hoy</option>
            <option value="ayer">Ayer</option>
            <option value="3d">Ultimos 3 dias</option>
            <option value="7d">Ultimos 7 dias</option>
            <option value="14d">Ultimos 14 dias</option>
            <option value="30d">Ultimos 30 dias</option>
            <option value="custom">Custom</option>
          </select>
          <button type="button" style={{ ...inputStyle, width: 'auto', cursor: 'pointer', fontWeight: 600 }}>
            Filtro
          </button>
          <button
            type="button"
            onClick={() => void load()}
            style={{ ...inputStyle, width: 'auto', cursor: loading ? 'wait' : 'pointer', fontWeight: 600 }}
          >
            {loading ? 'Actualizando...' : 'Actualizar'}
          </button>
        </div>
      </header>

      {error ? (
        <div
          style={{
            marginBottom: 12,
            padding: '10px 12px',
            borderRadius: 10,
            background: ds.dangerBg,
            color: ds.dangerText,
            border: `1px solid ${ds.borderCard}`,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}
      {metaUnlinkedSpend > 0 ? (
        <div
          style={{
            marginBottom: 12,
            padding: '10px 12px',
            borderRadius: 10,
            background: ds.warningBg,
            color: ds.warningText,
            border: `1px solid ${ds.borderCard}`,
            fontSize: 13,
          }}
        >
          Hay {money(metaUnlinkedSpend)} de campañas Meta sin vinculo campaña→producto; no se asignaron a ningún producto.
        </div>
      ) : null}

      <div className="analisis-producto-grid" style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 16 }}>
        <section style={{ minWidth: 0 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(200px,1fr) auto',
              gap: 8,
              marginBottom: 12,
            }}
          >
            <input
              style={inputStyle}
              placeholder="Buscar producto"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="button" style={{ ...inputStyle, width: 'auto', cursor: 'pointer', fontWeight: 600 }}>
              Filtro
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(150px,1fr))', gap: 10, marginBottom: 12 }}>
            <KpiCard title="Gasto Total" value={money(gastoTotal)} delta={pct(0)} />
            <KpiCard title="Ventas Totales" value={money(ventasTotal)} delta={pct(0)} />
            <KpiCard title="ROAS Promedio" value={`${roasPromedio.toFixed(2)}x`} delta={pct(0)} />
          </div>

          <DataTable title="Producto">
            <table style={tableBase}>
              <thead>
                <tr>
                  <Th style={{ width: '29%' }}>Producto</Th>
                  <Th>Estado</Th>
                  <Th>Ventas</Th>
                  <Th>Pedidos</Th>
                  <Th>CPA</Th>
                  <Th>ROAS Real</Th>
                  <Th>ROAS Equilibrio</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p, idx) => {
                  const b = stateBadge(p.estado);
                  const isLast = idx === rows.length - 1;
                  return (
                    <tr
                      key={p.key}
                      onClick={() => setSelected(p.key)}
                      style={{ cursor: 'pointer', background: selected === p.key ? ds.brandBg : 'transparent' }}
                    >
                      <Td isLast={isLast} style={{ fontWeight: 600, color: ds.textPrimary }}>
                        {p.nombre}
                      </Td>
                      <Td isLast={isLast}>
                        <StatusBadge variant={b.variant}>{b.text}</StatusBadge>
                      </Td>
                      <Td isLast={isLast}>{money(p.ventas)}</Td>
                      <Td isLast={isLast}>{p.pedidos}</Td>
                      <Td isLast={isLast}>{p.cpa > 0 ? money(p.cpa) : '—'}</Td>
                      <Td isLast={isLast}>{p.roasReal > 0 ? `${p.roasReal.toFixed(2)}x` : '—'}</Td>
                      <Td isLast={isLast}>{p.roasEq > 0 ? `${p.roasEq.toFixed(2)}x` : '—'}</Td>
                    </tr>
                  );
                })}
                {!rows.length ? (
                  <tr>
                    <td
                      colSpan={7}
                      style={{ padding: '12px 16px', fontSize: 12, color: ds.textMuted, borderBottom: 'none' }}
                    >
                      {loading ? 'Cargando productos...' : 'No hay datos para los filtros seleccionados.'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </DataTable>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 12, padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary, marginBottom: 10 }}>Gasto en Ads vs Ventas</div>
              <svg viewBox="0 0 300 130" width="100%" height={130} aria-hidden>
                <path d={linePath(salesSeries, 300, 95)} fill="none" stroke={ds.brand} strokeWidth={2.2} />
                <path d={linePath(spendSeries, 300, 95)} fill="none" stroke={ds.textHint} strokeWidth={2} />
                {dayLabels.map((d, i) => (
                  <text key={`s-${d}-${i}`} x={(i / 6) * 300} y={122} textAnchor="middle" fill="var(--color-text-hint)" fontSize="10">
                    {d}
                  </text>
                ))}
              </svg>
            </div>
            <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 12, padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary, marginBottom: 10 }}>Pedidos por Dia</div>
              <svg viewBox="0 0 300 130" width="100%" height={130} aria-hidden>
                {ordersSeries.map((v, i) => {
                  const x = 18 + i * 40;
                  const h = v * 78;
                  return (
                    <rect key={`b-${i}`} x={x} y={96 - h} width={24} height={h} rx={3} fill={i === ordersSeries.length - 1 ? ds.successText : ds.brand} />
                  );
                })}
                {dayLabels.map((d, i) => (
                  <text key={`o-${d}-${i}`} x={30 + i * 40} y={122} textAnchor="middle" fill="var(--color-text-hint)" fontSize="10">
                    {d}
                  </text>
                ))}
              </svg>
            </div>
          </div>
        </section>

        <aside
          style={{
            position: 'sticky',
            top: 8,
            alignSelf: 'start',
            background: ds.bgCard,
            border: `1px solid ${ds.borderCard}`,
            borderRadius: 14,
            padding: 14,
          }}
        >
          {active ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: ds.textPrimary }}>{active.nombre}</div>
                <StatusBadge variant={stateBadge(active.estado).variant}>{stateBadge(active.estado).text}</StatusBadge>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                <div style={{ background: ds.bgSubtle, borderRadius: 10, padding: 10 }}>
                  <div style={{ fontSize: 12, color: ds.textMuted }}>Gasto en Ads</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: ds.textPrimary }}>{money(active.gastoAds)}</div>
                </div>
                <div style={{ background: ds.bgSubtle, borderRadius: 10, padding: 10 }}>
                  <div style={{ fontSize: 12, color: ds.textMuted }}>Ventas</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: ds.textPrimary }}>{money(active.ventas)}</div>
                  <div style={{ color: active.profit >= 0 ? ds.successText : ds.dangerText, fontWeight: 700, fontSize: 12 }}>
                    Profit {active.profit >= 0 ? '+' : ''}
                    {money(active.profit)}
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <KpiCard title="Gasto en Ads" value={money(active.gastoAds)} delta={pct(0)} />
                <KpiCard title="Ventas" value={money(active.ventas)} delta={pct(0)} />
                <KpiCard title="ROAS Real" value={active.roasReal > 0 ? `${active.roasReal.toFixed(2)}x` : '—'} delta={pct(0)} />
                <KpiCard title="ROAS Equilibrio" value={active.roasEq > 0 ? `${active.roasEq.toFixed(2)}x` : '—'} delta={pct(0)} />
              </div>

              <div style={{ marginTop: 10, background: ds.bgSubtle, borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 12, color: ds.textMuted, marginBottom: 8 }}>Tendencia ROAS</div>
                <svg viewBox="0 0 280 80" width="100%" height={80} aria-hidden>
                  <path d={linePath(detailRoasSeries, 280, 60)} fill="none" stroke={ds.brand} strokeWidth={2} />
                </svg>
                <div style={{ fontSize: 12, color: ds.textMuted, marginBottom: 8 }}>Tendencia Conversion</div>
                <svg viewBox="0 0 280 80" width="100%" height={80} aria-hidden>
                  <path d={linePath(detailConvSeries, 280, 60)} fill="none" stroke={ds.successText} strokeWidth={2} />
                </svg>
              </div>
              <button
                type="button"
                style={{
                  marginTop: 10,
                  width: '100%',
                  border: `1px solid ${ds.borderCard}`,
                  background: ds.bgCard,
                  borderRadius: 8,
                  padding: '8px 12px',
                  cursor: 'pointer',
                  color: ds.textSecondary,
                  fontWeight: 600,
                }}
              >
                Cerrar
              </button>
            </>
          ) : (
            <div style={{ fontSize: 13, color: ds.textMuted }}>
              {loading ? 'Cargando detalle...' : 'No hay producto seleccionado.'}
            </div>
          )}
        </aside>
      </div>

      <style>{`
        @media (max-width: 1080px) {
          .analisis-producto-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}

