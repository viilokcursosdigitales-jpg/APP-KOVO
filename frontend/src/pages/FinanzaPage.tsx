import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../auth/api';
import { DataTable, Td, Th, tableBase } from '../design-system/DataTable';
import { ds } from '../design-system/ds';

type PeriodKey = 'hoy' | 'ayer' | '7d';

type SeriesByProduct = {
  label?: string;
  product_id?: number | null;
  ventas_despachadas_total?: number;
  ventas_despachadas_pedidos?: number;
  costo_producto_total?: number;
  costo_producto_entregado_total?: number;
  costo_flete_promedio_total?: number;
};

type SeriesDay = {
  date: string;
  ventas_despachadas_total: number;
  costo_producto_total: number;
  costo_producto_entregado_total: number;
  costo_flete_promedio_total: number;
  gasto_publicitario_total: number;
  utilidad: number | null;
  by_product?: Record<string, SeriesByProduct>;
};

type SeriesPayload = { days?: SeriesDay[]; error?: string };
type MetaSpendPayload = { product_spend?: Record<string, number> };

type ProductFinance = {
  key: string;
  name: string;
  productId: number | null;
  sales: number;
  cost: number;
  shipping: number;
  ads: number;
  orders: number;
  cpa: number;
  profit: number;
};

function periodConfig(period: PeriodKey): { currentStart: number; currentLen: number; months: number } {
  if (period === 'hoy') return { currentStart: 0, currentLen: 1, months: 1 };
  if (period === 'ayer') return { currentStart: 1, currentLen: 1, months: 1 };
  return { currentStart: 0, currentLen: 7, months: 2 };
}

function monthKeys(count: number): string {
  const now = new Date();
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out.join(',');
}

function money(n: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

function normalize(values: number[]): number[] {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return values.map(() => 0.55);
  return values.map((v) => (v - min) / (max - min));
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

function dayLabel(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-CO', { weekday: 'narrow' }).format(new Date(`${iso}T12:00:00`));
  } catch {
    return 'D';
  }
}

function changeTag(value: number): React.ReactNode {
  const up = value >= 0;
  return (
    <span style={{ fontSize: 12, color: up ? ds.successText : ds.dangerText }}>
      {up ? '+' : ''}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function Kpi({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle?: React.ReactNode;
}) {
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
      <div style={{ fontSize: 24, fontWeight: 700, color: ds.textPrimary, marginBottom: 8 }}>{value}</div>
      {subtitle}
    </div>
  );
}

export default function FinanzaPage() {
  const [period, setPeriod] = useState<PeriodKey>('7d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<SeriesDay[]>([]);
  const [metaSpendByProduct, setMetaSpendByProduct] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cfg = periodConfig(period);
      const [seriesRes, spendRes] = await Promise.all([
        apiFetch(`/api/ganancia-diaria/series?months=${encodeURIComponent(monthKeys(cfg.months))}`),
        apiFetch('/api/product-analytics/meta-spend?period=7d'),
      ]);
      const seriesData = (await seriesRes.json().catch(() => ({}))) as SeriesPayload;
      if (!seriesRes.ok) {
        setError(typeof seriesData.error === 'string' ? seriesData.error : 'No se pudo cargar Finanza');
        setDays([]);
        return;
      }
      const spendData = (await spendRes.json().catch(() => ({}))) as MetaSpendPayload;
      setDays(Array.isArray(seriesData.days) ? seriesData.days : []);
      setMetaSpendByProduct(spendRes.ok && spendData.product_spend ? spendData.product_spend : {});
    } catch {
      setError('Error de red cargando finanzas');
      setDays([]);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  const current = useMemo(() => {
    const cfg = periodConfig(period);
    return [...days].slice(cfg.currentStart, cfg.currentStart + cfg.currentLen);
  }, [days, period]);

  const currentAsc = useMemo(() => [...current].reverse(), [current]);
  const previous = useMemo(() => {
    const cfg = periodConfig(period);
    return [...days].slice(cfg.currentStart + cfg.currentLen, cfg.currentStart + cfg.currentLen * 2);
  }, [days, period]);

  const ingresosNetos = current.reduce((s, d) => s + Number(d.ventas_despachadas_total || 0), 0);
  const costoProducto = current.reduce((s, d) => s + Number(d.costo_producto_entregado_total || d.costo_producto_total || 0), 0);
  const costoEnvio = current.reduce((s, d) => s + Number(d.costo_flete_promedio_total || 0), 0);
  const gastoAds = current.reduce((s, d) => s + Number(d.gasto_publicitario_total || 0), 0);
  const utilidadNeta = current.reduce((s, d) => s + Number(d.utilidad || 0), 0);
  const utilidadBruta = ingresosNetos - costoProducto - costoEnvio;
  const grossMarginPct = ingresosNetos > 0 ? (utilidadBruta / ingresosNetos) * 100 : 0;

  const prevIngresos = previous.reduce((s, d) => s + Number(d.ventas_despachadas_total || 0), 0);
  const prevCostoProd = previous.reduce((s, d) => s + Number(d.costo_producto_entregado_total || d.costo_producto_total || 0), 0);
  const prevCostoEnvio = previous.reduce((s, d) => s + Number(d.costo_flete_promedio_total || 0), 0);
  const prevUtilidadBruta = prevIngresos - prevCostoProd - prevCostoEnvio;
  const prevUtilidad = previous.reduce((s, d) => s + Number(d.utilidad || 0), 0);
  const prevGross = prevIngresos > 0 ? (prevUtilidadBruta / prevIngresos) * 100 : 0;
  const change = (cur: number, prev: number) => (prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : 0);

  const incomeSeries = normalize(currentAsc.map((d) => Number(d.ventas_despachadas_total || 0)));
  const expenseSeries = normalize(
    currentAsc.map((d) =>
      Number(d.costo_producto_entregado_total || d.costo_producto_total || 0) +
      Number(d.costo_flete_promedio_total || 0) +
      Number(d.gasto_publicitario_total || 0),
    ),
  );
  const utilRaw = currentAsc.map((d) => Number(d.utilidad || 0));
  const utilAbsMax = Math.max(1, ...utilRaw.map((v) => Math.abs(v)));
  const utilBars = utilRaw.map((v) => v / utilAbsMax);
  const labels = currentAsc.map((d) => dayLabel(d.date));

  const products = useMemo(() => {
    const map = new Map<string, ProductFinance>();
    for (const d of current) {
      const byp = d.by_product || {};
      for (const [k, p] of Object.entries(byp)) {
        const pid = p.product_id != null && Number.isFinite(Number(p.product_id)) ? Number(p.product_id) : null;
        const prev = map.get(k);
        const sales = Number(p.ventas_despachadas_total || 0);
        const cost = Number(p.costo_producto_entregado_total || p.costo_producto_total || 0);
        const shipping = Number(p.costo_flete_promedio_total || 0);
        const orders = Number(p.ventas_despachadas_pedidos || 0);
        if (prev) {
          prev.sales += sales;
          prev.cost += cost;
          prev.shipping += shipping;
          prev.orders += orders;
        } else {
          map.set(k, {
            key: k,
            name: String(p.label || k),
            productId: pid,
            sales,
            cost,
            shipping,
            ads: 0,
            orders,
            cpa: 0,
            profit: 0,
          });
        }
      }
    }
    for (const p of map.values()) {
      p.ads = p.productId != null ? Number(metaSpendByProduct[String(p.productId)] || 0) : 0;
      p.cpa = p.orders > 0 ? p.ads / p.orders : 0;
      p.profit = p.sales - p.cost - p.shipping - p.ads;
    }
    return [...map.values()].sort((a, b) => b.sales - a.sales).slice(0, 3);
  }, [current, metaSpendByProduct]);

  const resumen = [
    { label: 'Ingresos Netos', value: ingresosNetos },
    { label: 'Costos Producto', value: costoProducto },
    { label: 'Gasto en Ads', value: gastoAds },
    { label: 'Otros Gastos', value: Math.max(0, ingresosNetos - utilidadNeta - costoProducto - costoEnvio - gastoAds) },
  ];

  return (
    <div style={{ fontFamily: ds.font, maxWidth: 1280, margin: '0 auto' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
          marginBottom: 14,
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
              fontWeight: 700,
              display: 'grid',
              placeItems: 'center',
              fontSize: 11,
            }}
          >
            K
          </div>
          <h1 style={{ margin: 0, color: ds.textPrimary, fontSize: 29, fontWeight: 700 }}>Finanza</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select
            style={{ border: `1px solid ${ds.borderCard}`, background: ds.bgCard, borderRadius: 8, padding: '8px 10px', fontSize: 13 }}
            defaultValue="co"
          >
            <option value="co">Colombia</option>
          </select>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as PeriodKey)}
            style={{ border: `1px solid ${ds.borderCard}`, background: ds.bgCard, borderRadius: 8, padding: '8px 10px', fontSize: 13 }}
          >
            <option value="hoy">Hoy</option>
            <option value="ayer">Ayer</option>
            <option value="7d">Ultimos 7 dias</option>
          </select>
          <button
            type="button"
            onClick={() => void load()}
            style={{ border: `1px solid ${ds.borderCard}`, background: ds.bgCard, borderRadius: 8, padding: '8px 12px', fontSize: 13, cursor: loading ? 'wait' : 'pointer', fontWeight: 600 }}
          >
            {loading ? 'Actualizando...' : 'Actualizar'}
          </button>
        </div>
      </header>

      {error ? (
        <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, background: ds.dangerBg, color: ds.dangerText, border: `1px solid ${ds.borderCard}`, fontSize: 13 }}>
          {error}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(150px,1fr))', gap: 10, marginBottom: 12 }}>
        <Kpi title="Ingresos Netos" value={money(ingresosNetos)} subtitle={changeTag(change(ingresosNetos, prevIngresos))} />
        <Kpi title="Utilidad Bruta" value={money(utilidadBruta)} subtitle={changeTag(change(utilidadBruta, prevUtilidadBruta))} />
        <Kpi title="Gross Margin" value={`${grossMarginPct.toFixed(1)}%`} subtitle={changeTag(change(grossMarginPct, prevGross))} />
        <Kpi title="Utilidad Neta" value={money(utilidadNeta)} subtitle={changeTag(change(utilidadNeta, prevUtilidad))} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary, marginBottom: 8 }}>Ingresos vs. Gastos</div>
          <svg viewBox="0 0 420 170" width="100%" height={170} aria-hidden>
            <path d={linePath(incomeSeries, 420, 130)} fill="none" stroke={ds.brand} strokeWidth={2.2} />
            <path d={linePath(expenseSeries, 420, 130)} fill="none" stroke={ds.textHint} strokeWidth={2} />
            {labels.map((d, i) => (
              <text key={`f-i-${d}-${i}`} x={(i / Math.max(labels.length - 1, 1)) * 420} y={160} textAnchor="middle" fill="var(--color-text-hint)" fontSize="10">
                {d}
              </text>
            ))}
          </svg>
        </div>
        <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary, marginBottom: 8 }}>Utilidad Neta por Día</div>
          <svg viewBox="0 0 420 170" width="100%" height={170} aria-hidden>
            <line x1={0} y1={82} x2={420} y2={82} stroke={ds.borderRow} strokeWidth={1} />
            {utilBars.map((v, i) => {
              const x = 26 + i * (380 / Math.max(utilBars.length, 1));
              const h = Math.abs(v) * 62;
              const y = v >= 0 ? 82 - h : 82;
              return <rect key={`f-u-${i}`} x={x} y={y} width={22} height={h} rx={3} fill={v >= 0 ? ds.successText : ds.dangerText} />;
            })}
            {labels.map((d, i) => (
              <text key={`f-ul-${d}-${i}`} x={38 + i * (380 / Math.max(labels.length, 1))} y={160} textAnchor="middle" fill="var(--color-text-hint)" fontSize="10">
                {d}
              </text>
            ))}
          </svg>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12, marginBottom: 12 }}>
        <DataTable title="Costos de Producto & Envío">
          <table style={tableBase}>
            <thead>
              <tr>
                <Th style={{ width: '30%' }}>Producto</Th>
                <Th>Coste</Th>
                <Th>CPA</Th>
                <Th>Coste Envío</Th>
                <Th>Profit Diario</Th>
              </tr>
            </thead>
            <tbody>
              {products.map((p, idx) => {
                const isLast = idx === products.length;
                return (
                  <tr key={p.key}>
                    <Td isLast={false} style={{ fontWeight: 600, color: ds.textPrimary }}>{p.name}</Td>
                    <Td isLast={false}>{money(p.cost)}</Td>
                    <Td isLast={false}>{p.cpa > 0 ? money(p.cpa) : '—'}</Td>
                    <Td isLast={false}>{money(p.shipping)}</Td>
                    <Td isLast={false} style={{ color: p.profit >= 0 ? ds.successText : ds.dangerText, fontWeight: 700 }}>
                      {p.profit >= 0 ? '+' : ''}
                      {money(p.profit)}
                    </Td>
                  </tr>
                );
              })}
              <tr>
                <Td isLast style={{ fontWeight: 700 }}>Total</Td>
                <Td isLast style={{ fontWeight: 700 }}>{money(costoProducto)}</Td>
                <Td isLast style={{ fontWeight: 700 }}>{money(gastoAds)}</Td>
                <Td isLast style={{ fontWeight: 700 }}>{money(costoEnvio)}</Td>
                <Td isLast style={{ fontWeight: 700 }}>{money(utilidadNeta)}</Td>
              </tr>
            </tbody>
          </table>
        </DataTable>

        <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: ds.textPrimary, marginBottom: 10 }}>Resumen Financiero</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {resumen.map((r) => (
              <div
                key={r.label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  borderBottom: `1px solid ${ds.borderRow}`,
                  paddingBottom: 7,
                  fontSize: 14,
                }}
              >
                <span style={{ color: ds.textSecondary }}>{r.label}</span>
                <strong style={{ color: ds.textPrimary }}>{money(r.value)}</strong>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 6, fontSize: 22, fontWeight: 700 }}>
              <span style={{ color: ds.brand }}>Utilidad Neta</span>
              <span style={{ color: ds.textPrimary }}>{money(utilidadNeta)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

