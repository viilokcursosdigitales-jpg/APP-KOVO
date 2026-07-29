import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { apiFetch } from '../auth/api';
import { DataTable, Td, Th, tableBase } from '../design-system/DataTable';
import { KpiCard } from '../design-system/KpiCard';
import { PageHeader } from '../design-system/PageHeader';
import { StatusBadge } from '../design-system/StatusBadge';
import { alpha, ds } from '../design-system/ds';
import {
  IconCart,
  IconMegaphone,
  IconPackage,
  IconShare,
  IconTarget,
  IconTrendingUp,
} from '../design-system/icons';

type TabKey = 'resumen' | 'producto';
type PeriodKey = '7d' | '14d' | '30d';

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
  utilidad: number | null;
  by_product?: Record<
    string,
    {
      label?: string;
      product_id?: number | null;
      ventas_despachadas_total?: number;
      ventas_entregadas_total?: number;
      ventas_despachadas_pedidos?: number;
      costo_producto_total?: number;
      costo_producto_entregado_total?: number;
      costo_flete_promedio_total?: number;
    }
  >;
};

type SeriesPayload = {
  days?: SeriesDay[];
  ventas_currency?: string | null;
  meta_currency?: string | null;
  ganancia_comparable?: boolean;
  product_options?: { key: string; label: string; product_id: number | null }[];
  product_id_applied?: number | null;
  warning?: string | null;
  error?: string;
};

type InsightRow = {
  id: string;
  name: string;
  spend: number;
  roas: number;
  purchases: number;
  cpa: number;
  status: string;
};

type MetaInsightsPayload = {
  rows?: InsightRow[];
  totals?: { spend?: number; roas?: number; purchases?: number; cpa?: number };
  error?: string;
};

type DayMetrics = {
  date: string;
  spend: number;
  ventas: number;
  ventasEntregadas: number;
  pedidos: number;
  costo: number;
  flete: number;
  admin: number;
  utilidad: number | null;
  roas: number;
  roasTarget: number;
  netPct: number | null;
  cpa: number;
  estado: 'optimo' | 'estable' | 'vigilar';
};

const cardBase: CSSProperties = {
  background: ds.bgCard,
  borderRadius: 14,
  padding: '18px 20px',
  border: `1px solid ${ds.borderCard}`,
};

const GOAL_PRESETS = [15, 20, 25, 30] as const;

function money(n: number, currency?: string | null): string {
  if (!Number.isFinite(n)) return '—';
  const c = (currency || 'USD').trim().toUpperCase();
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: c.length === 3 ? c : 'USD',
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return n.toLocaleString('es-CO', { maximumFractionDigits: 0 });
  }
}

function pct(n: number, decimals = 1): string {
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(decimals)}%`;
}

function roasFmt(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n.toFixed(2);
}

function parsePercentInput(raw: string): number {
  const n = Number.parseFloat(String(raw || '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function utilidadDia(row: SeriesDay, comparable: boolean | undefined, adminPercent: number): number | null {
  if (!comparable || row.utilidad == null || !Number.isFinite(row.utilidad)) return null;
  const ve = row.ventas_entregadas_total || row.ventas_despachadas_total || 0;
  return row.utilidad - ve * (adminPercent / 100);
}

function dynamicRoasTarget(ventas: number, baseCost: number, goalPct: number): number {
  if (ventas <= 0) return 0;
  const spendNeeded = ventas * (1 - goalPct / 100) - baseCost;
  if (spendNeeded <= 0) return 0;
  return ventas / spendNeeded;
}

function classifyEstado(roas: number, roasTarget: number, netPct: number | null, goalPct: number): DayMetrics['estado'] {
  if (roasTarget > 0 && roas >= roasTarget * 1.05) return 'optimo';
  if (netPct != null && netPct >= goalPct * 0.85) return 'estable';
  return 'vigilar';
}

function estadoBadge(estado: DayMetrics['estado']): ReactNode {
  if (estado === 'optimo') return <StatusBadge variant="success">Óptimo</StatusBadge>;
  if (estado === 'estable') return <StatusBadge variant="warning">Estable</StatusBadge>;
  return <StatusBadge variant="info">Vigilar</StatusBadge>;
}

function formatRangeLabel(days: SeriesDay[]): string {
  if (!days.length) return '—';
  const fmt = (iso: string) => {
    const p = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!p) return iso;
    try {
      return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }).format(
        new Date(parseInt(p[1], 10), parseInt(p[2], 10) - 1, parseInt(p[3], 10)),
      );
    } catch {
      return iso;
    }
  };
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  return `${fmt(sorted[0].date)} – ${fmt(sorted[sorted.length - 1].date)}`;
}

function formatTableDate(iso: string): string {
  const p = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!p) return iso;
  try {
    return new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' }).format(
      new Date(parseInt(p[1], 10), parseInt(p[2], 10) - 1, parseInt(p[3], 10)),
    );
  } catch {
    return iso;
  }
}

function deltaTag(current: number, prev: number): ReactNode {
  if (!Number.isFinite(current) || !Number.isFinite(prev) || prev === 0) return null;
  const change = ((current - prev) / Math.abs(prev)) * 100;
  const up = change >= 0;
  return (
    <span style={{ fontSize: 11, color: up ? ds.successText : ds.dangerText, marginTop: 4, display: 'block' }}>
      {up ? '+' : ''}
      {change.toFixed(1)}% vs periodo anterior
    </span>
  );
}

function linePath(values: number[], width: number, height: number, padY = 12): string {
  if (!values.length) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * width;
      const norm = (v - min) / range;
      const y = padY + (height - padY * 2) * (1 - norm);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

function findProductInDay(
  byProduct: SeriesDay['by_product'],
  productKey: string,
  productId: number | null,
) {
  if (!byProduct || typeof byProduct !== 'object') return null;
  if (productKey && byProduct[productKey]) return byProduct[productKey];
  if (productId != null) {
    const pidKey = `p:${productId}`;
    if (byProduct[pidKey]) return byProduct[pidKey];
    const idKey = String(productId);
    if (byProduct[idKey]) return byProduct[idKey];
    for (const row of Object.values(byProduct)) {
      if (row && Number(row.product_id) === productId) return row;
    }
  }
  return null;
}

function aggregateProductDays(
  days: SeriesDay[],
  productKey: string,
  productId: number | null,
  adminPercent: number,
): SeriesDay[] {
  if (!productKey && productId == null) return days;
  return days.map((d) => {
    const p = findProductInDay(d.by_product, productKey, productId);
    if (!p) {
      return {
        ...d,
        ventas_despachadas_total: 0,
        ventas_entregadas_total: 0,
        ventas_despachadas_pedidos: 0,
        costo_producto_total: 0,
        costo_producto_entregado_total: 0,
        costo_flete_promedio_total: 0,
        gasto_publicitario_total: 0,
        utilidad: null,
      };
    }
    const ventas = Number(p.ventas_despachadas_total || 0);
    const ventasEnt = Number(p.ventas_entregadas_total || ventas);
    const costo = Number(p.costo_producto_entregado_total || p.costo_producto_total || 0);
    const flete = Number(p.costo_flete_promedio_total || 0);
    const admin = ventasEnt * (adminPercent / 100);
    const daySpend = Number(d.gasto_publicitario_total || 0);
    const dayVentas = Number(d.ventas_despachadas_total || 0);
    const share = dayVentas > 0 ? ventas / dayVentas : 0;
    const spend = daySpend * share;
    const utilidad = ventas - spend - costo - flete - admin;
    return {
      date: d.date,
      ventas_despachadas_total: ventas,
      ventas_entregadas_total: ventasEnt,
      ventas_despachadas_pedidos: Number(p.ventas_despachadas_pedidos || 0),
      cantidad_producto_total: 0,
      costo_producto_total: Number(p.costo_producto_total || 0),
      costo_producto_entregado_total: costo,
      costo_flete_promedio_total: flete,
      gasto_publicitario_total: spend,
      utilidad,
    };
  });
}

export default function KipsPage() {
  const [tab, setTab] = useState<TabKey>('producto');
  const [period, setPeriod] = useState<PeriodKey>('7d');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [goalPct, setGoalPct] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seriesData, setSeriesData] = useState<SeriesPayload | null>(null);
  const [campaigns, setCampaigns] = useState<InsightRow[]>([]);
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopifyDomain, setShopifyDomain] = useState<string | null>(null);
  const [metaConnected, setMetaConnected] = useState(false);
  const [metaSpendByProduct, setMetaSpendByProduct] = useState<Record<string, number>>({});
  const [adminPercentInput] = useState(() => {
    try {
      return localStorage.getItem('kovo_ganancia_admin_percent') || '0';
    } catch {
      return '0';
    }
  });

  const adminPercent = useMemo(() => parsePercentInput(adminPercentInput), [adminPercentInput]);
  const currency = seriesData?.ventas_currency || seriesData?.meta_currency || 'USD';
  const comparable = seriesData?.ganancia_comparable;

  const productOptions = seriesData?.product_options ?? [];
  const selectedProduct = useMemo(() => {
    if (!selectedProductId) return productOptions[0] ?? null;
    return productOptions.find((p) => String(p.product_id ?? p.key) === selectedProductId) ?? productOptions[0] ?? null;
  }, [productOptions, selectedProductId]);

  const productKey = selectedProduct?.key ?? '';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ meta_period: period });

      const [seriesRes, insightsRes, shopRes, metaRes, spendRes] = await Promise.all([
        apiFetch(`/api/ganancia-diaria/series?${qs}`),
        apiFetch(`/api/meta/insights?level=campaigns&period=${period}`),
        apiFetch('/api/shopify/connection'),
        apiFetch('/api/meta/connections'),
        apiFetch(`/api/product-analytics/meta-spend?period=${period}`),
      ]);

      const seriesBody = (await seriesRes.json().catch(() => ({}))) as SeriesPayload;
      if (!seriesRes.ok) {
        setError(typeof seriesBody.error === 'string' ? seriesBody.error : 'No se pudo cargar KIPS');
        setSeriesData(null);
      } else {
        setSeriesData(seriesBody);
        if (!selectedProductId && seriesBody.product_options?.[0]?.product_id) {
          setSelectedProductId(String(seriesBody.product_options[0].product_id));
        }
      }

      const insightsBody = (await insightsRes.json().catch(() => ({}))) as MetaInsightsPayload;
      setCampaigns(Array.isArray(insightsBody.rows) ? insightsBody.rows : []);

      const spendBody = (await spendRes.json().catch(() => ({}))) as { product_spend?: Record<string, number> };
      setMetaSpendByProduct(spendRes.ok && spendBody.product_spend ? spendBody.product_spend : {});

      const shopBody = (await shopRes.json().catch(() => ({}))) as {
        status?: string;
        shop_domain?: string | null;
      };
      const shopOk = shopRes.ok && shopBody.status === 'connected' && Boolean(shopBody.shop_domain);
      setShopifyConnected(shopOk);
      setShopifyDomain(shopOk ? shopBody.shop_domain ?? null : null);

      const metaBody = (await metaRes.json().catch(() => ({}))) as {
        connections?: { status?: string }[];
      };
      setMetaConnected(Boolean(metaBody.connections?.some((c) => c.status === 'connected')));
    } catch {
      setError('Error de red cargando KIPS');
      setSeriesData(null);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  const rawDays = useMemo(() => {
    const days = seriesData?.days ?? [];
    return [...days].sort((a, b) => a.date.localeCompare(b.date));
  }, [seriesData]);

  const days = useMemo(() => {
    if (tab === 'resumen') return rawDays;
    const pid = selectedProduct?.product_id ?? null;
    if (!productKey && pid == null) return rawDays;
    return aggregateProductDays(rawDays, productKey, pid, adminPercent);
  }, [rawDays, productKey, tab, adminPercent, selectedProduct?.product_id]);

  const prevDays = useMemo(() => {
    const len = days.length;
    if (len < 2) return [];
    const half = Math.floor(len / 2);
    return days.slice(0, half);
  }, [days]);

  const currentDays = useMemo(() => {
    const len = days.length;
    if (len < 2) return days;
    const half = Math.floor(len / 2);
    return days.slice(half);
  }, [days]);

  const totals = useMemo(() => {
    let ventas = 0;
    let ventasEnt = 0;
    let pedidos = 0;
    let spend = 0;
    let costo = 0;
    let flete = 0;
    for (const d of days) {
      ventas += Number(d.ventas_despachadas_total || 0);
      ventasEnt += Number(d.ventas_entregadas_total || ventas);
      pedidos += Number(d.ventas_despachadas_pedidos || 0);
      spend += Number(d.gasto_publicitario_total || 0);
      costo += Number(d.costo_producto_entregado_total || d.costo_producto_total || 0);
      flete += Number(d.costo_flete_promedio_total || 0);
    }
    if (tab === 'producto' && selectedProduct?.product_id != null) {
      const metaSpend = metaSpendByProduct[String(selectedProduct.product_id)];
      if (metaSpend != null && Number.isFinite(Number(metaSpend))) {
        spend = Number(metaSpend);
      }
    }
    const admin = ventasEnt * (adminPercent / 100);
    const baseCost = costo + flete + admin;
    const utilidad = comparable ? ventas - spend - baseCost : null;
    const roas = spend > 0 ? ventas / spend : 0;
    const roasTarget = dynamicRoasTarget(ventas, baseCost, goalPct);
    const netPct = utilidad != null && ventas > 0 ? (utilidad / ventas) * 100 : null;
    const cpa = pedidos > 0 ? spend / pedidos : 0;
    return { ventas, ventasEnt, pedidos, spend, costo, flete, admin, baseCost, utilidad, roas, roasTarget, netPct, cpa };
  }, [days, adminPercent, comparable, goalPct, tab, selectedProduct?.product_id, metaSpendByProduct]);

  const prevTotals = useMemo(() => {
    let ventas = 0;
    let spend = 0;
    let pedidos = 0;
    for (const d of prevDays) {
      ventas += Number(d.ventas_despachadas_total || 0);
      spend += Number(d.gasto_publicitario_total || 0);
      pedidos += Number(d.ventas_despachadas_pedidos || 0);
    }
    const roas = spend > 0 ? ventas / spend : 0;
    const cpa = pedidos > 0 ? spend / pedidos : 0;
    return { ventas, spend, roas, cpa, pedidos };
  }, [prevDays]);

  const dayMetrics: DayMetrics[] = useMemo(() => {
    return days.map((d) => {
      const ventas = Number(d.ventas_despachadas_total || 0);
      const ventasEnt = Number(d.ventas_entregadas_total || ventas);
      const pedidos = Number(d.ventas_despachadas_pedidos || 0);
      const spend = Number(d.gasto_publicitario_total || 0);
      const costo = Number(d.costo_producto_entregado_total || d.costo_producto_total || 0);
      const flete = Number(d.costo_flete_promedio_total || 0);
      const admin = ventasEnt * (adminPercent / 100);
      const baseCost = costo + flete + admin;
      const utilidad = utilidadDia(d, comparable, adminPercent);
      const roas = spend > 0 ? ventas / spend : 0;
      const roasTarget = dynamicRoasTarget(ventas, baseCost, goalPct);
      const netPct = utilidad != null && ventas > 0 ? (utilidad / ventas) * 100 : null;
      const cpa = pedidos > 0 ? spend / pedidos : 0;
      const estado = classifyEstado(roas, roasTarget, netPct, goalPct);
      return {
        date: d.date,
        spend,
        ventas,
        ventasEntregadas: ventasEnt,
        pedidos,
        costo,
        flete,
        admin,
        utilidad,
        roas,
        roasTarget,
        netPct,
        cpa,
        estado,
      };
    });
  }, [days, adminPercent, comparable, goalPct]);

  const scalingChart = useMemo(() => {
    let cumSpend = 0;
    let cumVentas = 0;
    let cumBase = 0;
    const points: { cumSpend: number; roas: number; roasTarget: number; netPct: number }[] = [];
    for (const m of dayMetrics) {
      cumSpend += m.spend;
      cumVentas += m.ventas;
      cumBase += m.costo + m.flete + m.admin;
      const roas = cumSpend > 0 ? cumVentas / cumSpend : 0;
      const roasTarget = dynamicRoasTarget(cumVentas, cumBase, goalPct);
      const util = cumVentas - cumSpend - cumBase;
      const netPct = cumVentas > 0 ? (util / cumVentas) * 100 : 0;
      points.push({ cumSpend, roas, roasTarget, netPct });
    }
    let bestIdx = 0;
    let bestNet = -Infinity;
    points.forEach((p, i) => {
      if (p.netPct > bestNet) {
        bestNet = p.netPct;
        bestIdx = i;
      }
    });
    const zoneStart = Math.max(0, bestIdx - 1);
    const zoneEnd = Math.min(points.length - 1, bestIdx + 1);
    return { points, zoneStart, zoneEnd, bestNet, bestIdx };
  }, [dayMetrics, goalPct]);

  const diagnostic = useMemo(() => {
    const { roas, roasTarget, netPct, spend, pedidos } = totals;
    const optimal = scalingChart.points[scalingChart.bestIdx];
    const isOptimal = roasTarget > 0 && roas >= roasTarget && (netPct ?? 0) >= goalPct * 0.9;
    const recommendations: string[] = [];
    if (roas < roasTarget) {
      recommendations.push('El ROAS actual está por debajo del objetivo dinámico. Revisa creativos y segmentación.');
    } else {
      recommendations.push('Mantén el ROAS por encima del objetivo dinámico para sostener la utilidad.');
    }
    if ((netPct ?? 0) < goalPct) {
      recommendations.push('La utilidad neta está por debajo del objetivo. Considera reducir gasto o mejorar conversión.');
    } else {
      recommendations.push('La utilidad neta cumple el objetivo configurado.');
    }
    recommendations.push('Escala gradualmente el gasto dentro de la zona óptima detectada.');
    return {
      isOptimal,
      optimalNetPct: optimal?.netPct ?? 0,
      optimalRoas: optimal?.roas ?? 0,
      optimalPurchases: Math.round(pedidos * 1.15),
      maxNetPct: Math.max(...scalingChart.points.map((p) => p.netPct), 0),
      recommendations,
    };
  }, [totals, scalingChart, goalPct]);

  const campaignRows = useMemo(() => {
    return [...campaigns]
      .sort((a, b) => (b.spend || 0) - (a.spend || 0))
      .slice(0, 8)
      .map((c) => {
        const spend = Number(c.spend || 0);
        const roas = Number(c.roas || 0);
        const purchases = Number(c.purchases || 0);
        const cpa = Number(c.cpa || 0);
        const netEst =
          totals.roas > 0 && roas > 0 && totals.netPct != null
            ? totals.netPct * (roas / totals.roas)
            : null;
        const estado =
          totals.roasTarget > 0 && roas >= totals.roasTarget
            ? 'optimo'
            : roas >= totals.roasTarget * 0.85
              ? 'estable'
              : 'vigilar';
        return { ...c, spend, roas, purchases, cpa, netEst, estado: estado as DayMetrics['estado'] };
      });
  }, [campaigns, totals]);

  const chartW = 720;
  const chartH = 220;

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 4px 32px' }}>
      <PageHeader
        title="KIPS"
        subtitle="Key Indicators for Product Scaling — Escala Meta Ads y Shopify con rentabilidad"
        right={
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            {metaConnected ? (
              <StatusBadge variant="success">Meta Ads conectado</StatusBadge>
            ) : (
              <StatusBadge variant="paused">Meta Ads sin conectar</StatusBadge>
            )}
            {shopifyConnected ? (
              <StatusBadge variant="success">
                Shopify conectado{shopifyDomain ? ` · ${shopifyDomain}` : ''}
              </StatusBadge>
            ) : (
              <StatusBadge variant="paused">Shopify sin conectar</StatusBadge>
            )}
          </div>
        }
      />

      <div style={{ ...cardBase, marginBottom: 16, padding: '14px 18px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: ds.textMuted }}>Periodo:</span>
            {(['7d', '14d', '30d'] as PeriodKey[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: `1px solid ${period === p ? ds.brand : ds.borderCard}`,
                  background: period === p ? ds.brandBg : ds.bgCard,
                  color: period === p ? ds.brand : ds.textSecondary,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {p === '7d' ? '7 días' : p === '14d' ? '14 días' : '30 días'}
              </button>
            ))}
            <span style={{ fontSize: 12, color: ds.textMuted, marginLeft: 8 }}>{formatRangeLabel(days)}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: ds.textMuted }}>Producto:</span>
            <select
              value={selectedProductId || (selectedProduct?.product_id ? String(selectedProduct.product_id) : '')}
              onChange={(e) => setSelectedProductId(e.target.value)}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: `1px solid ${ds.borderCard}`,
                background: ds.bgCard,
                color: ds.textPrimary,
                fontSize: 13,
                minWidth: 180,
              }}
            >
              {productOptions.map((p) => (
                <option key={p.key} value={String(p.product_id ?? p.key)}>
                  {p.label || p.key}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: `1px solid ${ds.borderCard}` }}>
        {(
          [
            ['resumen', 'Resumen'],
            ['producto', 'Producto'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            style={{
              padding: '10px 16px',
              border: 'none',
              borderBottom: tab === key ? `2px solid ${ds.brand}` : '2px solid transparent',
              background: 'transparent',
              color: tab === key ? ds.brand : ds.textMuted,
              fontWeight: tab === key ? 700 : 500,
              fontSize: 14,
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: ds.textMuted }}>Cargando indicadores…</div>
      ) : error ? (
        <div style={{ ...cardBase, color: ds.dangerText }}>{error}</div>
      ) : (
        <>
          {seriesData?.warning ? (
            <div
              style={{
                ...cardBase,
                marginBottom: 16,
                padding: '12px 16px',
                background: ds.warningBg,
                color: ds.warningText,
                fontSize: 13,
              }}
            >
              {seriesData.warning}
            </div>
          ) : null}
          <div
            style={{
              marginBottom: 8,
              fontSize: 13,
              color: ds.textSecondary,
            }}
          >
            {tab === 'producto' ? (
              <>
                <strong style={{ color: ds.textPrimary }}>Detalle por producto</strong>
                {' · '}
                {selectedProduct?.label || '—'} — Escala Meta Ads y Shopify para maximizar rentabilidad
              </>
            ) : (
              'Vista consolidada de todos los productos en el periodo seleccionado'
            )}
          </div>

          <div className="kovo-kpi-grid-dash" style={{ marginBottom: 16 }}>
            <KpiCard
              variant="spend"
              label="Gasto publicitario"
              icon={<IconTarget />}
              value={
                <>
                  {money(totals.spend, currency)}
                  {deltaTag(totals.spend, prevTotals.spend)}
                </>
              }
            />
            <KpiCard
              variant="conversion"
              label="ROAS actual"
              icon={<IconTrendingUp />}
              value={
                <>
                  {roasFmt(totals.roas)}
                  {deltaTag(totals.roas, prevTotals.roas)}
                </>
              }
            />
            <KpiCard
              variant="sales"
              label="ROAS objetivo dinámico"
              icon={<IconTarget />}
              badge={
                <span style={{ fontSize: 10, color: ds.textMuted, background: ds.bgSubtle, padding: '2px 6px', borderRadius: 6 }}>
                  Calculado automáticamente
                </span>
              }
              value={roasFmt(totals.roasTarget)}
            />
            <KpiCard
              variant="stock"
              label="% de utilidad neta actual"
              icon={<IconPackage />}
              value={totals.netPct != null ? pct(totals.netPct) : '—'}
            />
            <KpiCard
              variant="stock"
              label="Margen neto"
              icon={<IconPackage />}
              value={totals.netPct != null ? pct(totals.netPct) : '—'}
            />
            <KpiCard
              variant="traffic"
              label="Compras"
              icon={<IconCart />}
              value={
                <>
                  {totals.pedidos.toLocaleString('es-CO')}
                  {deltaTag(totals.pedidos, prevTotals.pedidos)}
                </>
              }
            />
            <KpiCard
              variant="spend"
              label="CPA"
              icon={<IconMegaphone />}
              value={
                <>
                  {money(totals.cpa, currency)}
                  {deltaTag(totals.cpa, prevTotals.cpa)}
                </>
              }
            />
            <KpiCard
              variant="conversion"
              label="Pedidos confirmados"
              icon={<IconShare />}
              value={totals.pedidos.toLocaleString('es-CO')}
            />
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 14,
              marginBottom: 16,
            }}
          >
            <div style={cardBase}>
              <div style={{ fontSize: 13, fontWeight: 700, color: ds.textPrimary, marginBottom: 12 }}>
                Configura tu objetivo de % de utilidad neta
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
                {GOAL_PRESETS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGoalPct(g)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 8,
                      border: `1px solid ${goalPct === g ? ds.brand : ds.borderCard}`,
                      background: goalPct === g ? ds.brand : ds.bgCard,
                      color: goalPct === g ? ds.textOnBrand : ds.textSecondary,
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    {g}%
                  </button>
                ))}
              </div>
              <input
                type="range"
                min={5}
                max={40}
                step={1}
                value={goalPct}
                onChange={(e) => setGoalPct(Number(e.target.value))}
                style={{ width: '100%', accentColor: ds.brand }}
              />
              <div style={{ fontSize: 12, color: ds.textMuted, marginTop: 8 }}>Objetivo: {goalPct}%</div>
            </div>

            <div style={{ ...cardBase, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ fontSize: 12, color: ds.textMuted, marginBottom: 4 }}>ROAS objetivo dinámico</div>
              <div style={{ fontSize: 36, fontWeight: 700, color: ds.brand, lineHeight: 1 }}>{roasFmt(totals.roasTarget)}</div>
              <div style={{ fontSize: 12, color: ds.textMuted, marginTop: 8 }}>
                Para alcanzar {goalPct}% de utilidad neta con la estructura de costos actual
              </div>
            </div>

            <div style={cardBase}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 12,
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: diagnostic.isOptimal ? ds.successBg : ds.warningBg,
                  color: diagnostic.isOptimal ? ds.successText : ds.warningText,
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {diagnostic.isOptimal ? '✓ Punto óptimo detectado' : '⚠ Ajuste recomendado'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12, marginBottom: 12 }}>
                <div>
                  <div style={{ color: ds.textMuted }}>Utilidad neta óptima</div>
                  <div style={{ fontWeight: 700 }}>{pct(diagnostic.optimalNetPct)}</div>
                </div>
                <div>
                  <div style={{ color: ds.textMuted }}>ROAS en punto óptimo</div>
                  <div style={{ fontWeight: 700 }}>{roasFmt(diagnostic.optimalRoas)}</div>
                </div>
                <div>
                  <div style={{ color: ds.textMuted }}>Utilidad neta máxima est.</div>
                  <div style={{ fontWeight: 700 }}>{pct(diagnostic.maxNetPct)}</div>
                </div>
                <div>
                  <div style={{ color: ds.textMuted }}>Compras estimadas</div>
                  <div style={{ fontWeight: 700 }}>{diagnostic.optimalPurchases.toLocaleString('es-CO')}</div>
                </div>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: ds.textSecondary, lineHeight: 1.5 }}>
                {diagnostic.recommendations.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          </div>

          <div style={{ ...cardBase, marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: ds.textPrimary, marginBottom: 4 }}>
              Punto óptimo de escalado
            </div>
            <div style={{ fontSize: 12, color: ds.textMuted, marginBottom: 16 }}>
              Relación entre gasto acumulado, ROAS y % de utilidad neta
            </div>
            {scalingChart.points.length > 1 ? (
              <div style={{ overflowX: 'auto' }}>
                <svg width={chartW} height={chartH + 40} viewBox={`0 0 ${chartW} ${chartH + 40}`}>
                  {scalingChart.points.length > 0 && (
                    <rect
                      x={
                        (scalingChart.zoneStart / Math.max(scalingChart.points.length - 1, 1)) * (chartW - 48) + 24
                      }
                      y={12}
                      width={
                        ((scalingChart.zoneEnd - scalingChart.zoneStart) /
                          Math.max(scalingChart.points.length - 1, 1)) *
                          (chartW - 48) +
                        24
                      }
                      height={chartH - 24}
                      fill={alpha.success15}
                      rx={4}
                    />
                  )}
                  <text
                    x={
                      (scalingChart.zoneStart / Math.max(scalingChart.points.length - 1, 1)) * (chartW - 48) + 28
                    }
                    y={24}
                    fontSize={10}
                    fill={ds.successText}
                  >
                    Zona óptima
                  </text>
                  <path
                    d={linePath(
                      scalingChart.points.map((p) => p.roas),
                      chartW - 48,
                      chartH - 24,
                    )}
                    transform="translate(24, 12)"
                    fill="none"
                    stroke={ds.brand}
                    strokeWidth={2}
                  />
                  <path
                    d={linePath(
                      scalingChart.points.map((p) => p.roasTarget),
                      chartW - 48,
                      chartH - 24,
                    )}
                    transform="translate(24, 12)"
                    fill="none"
                    stroke={ds.brandSoft}
                    strokeWidth={1.5}
                    strokeDasharray="5 4"
                  />
                  <path
                    d={linePath(
                      scalingChart.points.map((p) => p.netPct / 10),
                      chartW - 48,
                      chartH - 24,
                    )}
                    transform="translate(24, 12)"
                    fill="none"
                    stroke={ds.successText}
                    strokeWidth={2}
                  />
                  {scalingChart.points.map((p, i) => {
                    const x = (i / Math.max(scalingChart.points.length - 1, 1)) * (chartW - 48) + 24;
                    return (
                      <text key={p.cumSpend} x={x} y={chartH + 28} fontSize={9} fill={ds.textMuted} textAnchor="middle">
                        {money(p.cumSpend, currency).replace(/\s/g, '')}
                      </text>
                    );
                  })}
                </svg>
                <div style={{ display: 'flex', gap: 16, fontSize: 11, color: ds.textMuted, marginTop: 4 }}>
                  <span>
                    <span style={{ color: ds.brand, fontWeight: 700 }}>—</span> ROAS
                  </span>
                  <span>
                    <span style={{ color: ds.brandSoft, fontWeight: 700 }}>- -</span> ROAS objetivo
                  </span>
                  <span>
                    <span style={{ color: ds.successText, fontWeight: 700 }}>—</span> % utilidad neta (÷10)
                  </span>
                </div>
              </div>
            ) : (
              <div style={{ padding: 24, textAlign: 'center', color: ds.textMuted, fontSize: 13 }}>
                Sin suficientes datos para el gráfico de escalado
              </div>
            )}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: 16,
            }}
          >
            <DataTable title="Desglose diario del producto">
              <table style={tableBase}>
                <thead>
                  <tr>
                    <Th>Fecha</Th>
                    <Th style={{ textAlign: 'right' }}>Gasto</Th>
                    <Th style={{ textAlign: 'right' }}>ROAS</Th>
                    <Th style={{ textAlign: 'right' }}>Obj.</Th>
                    <Th style={{ textAlign: 'right' }}>Compras</Th>
                    <Th style={{ textAlign: 'right' }}>CPA</Th>
                    <Th style={{ textAlign: 'right' }}>% Util.</Th>
                    <Th style={{ textAlign: 'right' }}>Estado</Th>
                  </tr>
                </thead>
                <tbody>
                  {dayMetrics.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: '12px 16px', fontSize: 12, color: ds.textMuted }}>
                        Sin datos en el periodo
                      </td>
                    </tr>
                  ) : (
                    dayMetrics
                      .slice()
                      .reverse()
                      .map((m, i, arr) => {
                        const isLast = i === arr.length - 1;
                        return (
                          <tr key={m.date}>
                            <Td isLast={isLast}>{formatTableDate(m.date)}</Td>
                            <Td isLast={isLast} style={{ textAlign: 'right' }}>
                              {money(m.spend, currency)}
                            </Td>
                            <Td isLast={isLast} style={{ textAlign: 'right' }}>
                              {roasFmt(m.roas)}
                            </Td>
                            <Td isLast={isLast} style={{ textAlign: 'right' }}>
                              {roasFmt(m.roasTarget)}
                            </Td>
                            <Td isLast={isLast} style={{ textAlign: 'right' }}>
                              {m.pedidos}
                            </Td>
                            <Td isLast={isLast} style={{ textAlign: 'right' }}>
                              {money(m.cpa, currency)}
                            </Td>
                            <Td isLast={isLast} style={{ textAlign: 'right' }}>
                              {m.netPct != null ? pct(m.netPct) : '—'}
                            </Td>
                            <Td isLast={isLast} style={{ textAlign: 'right' }}>
                              {estadoBadge(m.estado)}
                            </Td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
              </table>
            </DataTable>

            <DataTable title="Top campañas Meta Ads">
              <table style={tableBase}>
                <thead>
                  <tr>
                    <Th>Campaña</Th>
                    <Th style={{ textAlign: 'right' }}>Gasto</Th>
                    <Th style={{ textAlign: 'right' }}>ROAS</Th>
                    <Th style={{ textAlign: 'right' }}>Compras</Th>
                    <Th style={{ textAlign: 'right' }}>CPA</Th>
                    <Th style={{ textAlign: 'right' }}>% Util.</Th>
                    <Th style={{ textAlign: 'right' }}>Estado</Th>
                  </tr>
                </thead>
                <tbody>
                  {campaignRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: '12px 16px', fontSize: 12, color: ds.textMuted }}>
                        Sin campañas Meta en el periodo
                      </td>
                    </tr>
                  ) : (
                    campaignRows.map((c, i) => {
                      const isLast = i === campaignRows.length - 1;
                      return (
                        <tr key={c.id}>
                          <Td isLast={isLast}>
                            <span style={{ display: 'block', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {c.name}
                            </span>
                          </Td>
                          <Td isLast={isLast} style={{ textAlign: 'right' }}>
                            {money(c.spend, currency)}
                          </Td>
                          <Td isLast={isLast} style={{ textAlign: 'right' }}>
                            {roasFmt(c.roas)}
                          </Td>
                          <Td isLast={isLast} style={{ textAlign: 'right' }}>
                            {c.purchases}
                          </Td>
                          <Td isLast={isLast} style={{ textAlign: 'right' }}>
                            {money(c.cpa, currency)}
                          </Td>
                          <Td isLast={isLast} style={{ textAlign: 'right' }}>
                            {c.netEst != null ? pct(c.netEst) : '—'}
                          </Td>
                          <Td isLast={isLast} style={{ textAlign: 'right' }}>
                            {estadoBadge(c.estado)}
                          </Td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </DataTable>
          </div>
        </>
      )}
    </div>
  );
}
