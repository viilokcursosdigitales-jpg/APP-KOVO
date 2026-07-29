import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../auth/api';
import { DataTable, Td, Th, tableBase } from '../design-system/DataTable';
import { KpiCard } from '../design-system/KpiCard';
import { PageHeader } from '../design-system/PageHeader';
import { StatusBadge } from '../design-system/StatusBadge';
import { alpha, ds } from '../design-system/ds';
import {
  IconCalendar,
  IconMegaphone,
  IconProduct,
  IconTarget,
  IconTrendingUp,
} from '../design-system/icons';

type PeriodKey = '7d' | '14d' | '30d' | 'year' | 'custom';

type SeriesByProduct = {
  label?: string;
  product_id?: number | null;
  ventas_despachadas_total?: number;
  ventas_entregadas_total?: number;
  ventas_despachadas_pedidos?: number;
  costo_producto_total?: number;
  costo_producto_entregado_total?: number;
  costo_flete_promedio_total?: number;
};

type SeriesDay = {
  date: string;
  ventas_despachadas_total: number;
  ventas_entregadas_total: number;
  ventas_despachadas_pedidos: number;
  gasto_publicitario_total: number;
  utilidad: number | null;
  by_product?: Record<string, SeriesByProduct>;
};

type SeriesPayload = {
  days?: SeriesDay[];
  ventas_currency?: string | null;
  product_options?: { key: string; label: string; product_id: number | null }[];
  warning?: string | null;
  error?: string;
};

type ProductRow = {
  key: string;
  nombre: string;
  productId: number | null;
  facturacion: number;
  gasto: number;
  pedidos: number;
  costoEntregado: number;
  flete: number;
  admin: number;
  utilidad: number;
  netPct: number;
  roas: number;
  cpa: number;
  estado: 'escalar' | 'optimizar' | 'reducir';
  accion: string;
};

const cardBase: CSSProperties = {
  background: ds.bgCard,
  borderRadius: 14,
  padding: '18px 20px',
  border: `1px solid ${ds.borderCard}`,
};

const PRODUCT_COLORS = ['#6C47FF', '#4285F4', '#FE2C55', '#1D9E75', '#F59E0B', '#94A3B8'];

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function defaultCustomRange(year = new Date().getFullYear()): { from: string; to: string } {
  return yearBounds(year);
}

function yearOptions(): number[] {
  const y = new Date().getFullYear();
  return [y, y - 1, y - 2, y - 3];
}

function monthsForYear(year: number): string[] {
  const now = new Date();
  const maxMonth = year === now.getFullYear() ? now.getMonth() + 1 : 12;
  const out: string[] = [];
  for (let m = 1; m <= maxMonth; m++) {
    out.push(`${year}-${String(m).padStart(2, '0')}`);
  }
  return out;
}

function yearBounds(year: number): { from: string; to: string } {
  const now = new Date();
  return {
    from: `${year}-01-01`,
    to: year === now.getFullYear() ? toYmd(now) : `${year}-12-31`,
  };
}

function filterDaysForYear(days: SeriesDay[], year: number): SeriesDay[] {
  const prefix = String(year);
  return days.filter((d) => d.date.startsWith(prefix));
}

function allocateSpendByProduct(days: SeriesDay[]): Map<string, number> {
  const spendByProduct = new Map<string, number>();
  for (const d of days) {
    const daySpend = Number(d.gasto_publicitario_total || 0);
    if (daySpend <= 0) continue;
    const byp = d.by_product && typeof d.by_product === 'object' ? d.by_product : {};
    let totalVentas = 0;
    for (const raw of Object.values(byp)) {
      totalVentas += Number(raw.ventas_despachadas_total || 0);
    }
    if (totalVentas <= 0) continue;
    for (const [key, raw] of Object.entries(byp)) {
      const share = Number(raw.ventas_despachadas_total || 0) / totalVentas;
      spendByProduct.set(key, (spendByProduct.get(key) || 0) + daySpend * share);
    }
  }
  return spendByProduct;
}


function dayCountInclusive(fromYmd: string, toYmdStr: string): number {
  const start = new Date(`${fromYmd}T12:00:00`);
  const end = new Date(`${toYmdStr}T12:00:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return 7;
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function metaPeriodForDayCount(days: number): '7d' | '14d' | '30d' {
  if (days <= 7) return '7d';
  if (days <= 14) return '14d';
  return '30d';
}

function periodLen(period: PeriodKey, customFrom: string, customTo: string): number {
  if (period === 'year') return 0;
  if (period === 'custom') return dayCountInclusive(customFrom, customTo);
  if (period === '14d') return 14;
  if (period === '30d') return 30;
  return 7;
}

function filterPeriodDays(
  days: SeriesDay[],
  period: PeriodKey,
  customFrom: string,
  customTo: string,
  offset = 0,
): SeriesDay[] {
  if (period === 'year') {
    return offset === 0 ? days : [];
  }
  if (period === 'custom' && customFrom && customTo) {
    const count = dayCountInclusive(customFrom, customTo);
    const end = new Date(`${customTo}T12:00:00`);
    end.setDate(end.getDate() - offset * count);
    const start = new Date(end);
    start.setDate(start.getDate() - (count - 1));
    const from = toYmd(start);
    const to = toYmd(end);
    return days.filter((d) => d.date >= from && d.date <= to);
  }
  const len = periodLen(period, customFrom, customTo);
  return days.slice(offset * len, offset * len + len);
}

function parsePercentInput(raw: string): number {
  const n = Number.parseFloat(String(raw || '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function money(n: number, currency = 'COP'): string {
  if (!Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: currency.length === 3 ? currency : 'COP',
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return n.toLocaleString('es-CO', { maximumFractionDigits: 0 });
  }
}

function roasFmt(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '—';
  return `${v.toFixed(2)}x`;
}

function pct(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}

function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function changeBadge(value: number | null, suffix = ''): ReactNode {
  if (value == null) return null;
  const up = value >= 0;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: up ? ds.successText : ds.dangerText }}>
      {up ? '+' : ''}
      {value.toFixed(1)}%{suffix}
    </span>
  );
}

function classifyProduct(
  roas: number,
  utilidad: number,
  avgRoas: number,
): { estado: ProductRow['estado']; accion: string } {
  if (roas >= avgRoas * 1.05 && utilidad > 0) {
    return { estado: 'escalar', accion: 'Subir presupuesto' };
  }
  if (roas < avgRoas * 0.85 || utilidad < 0) {
    return { estado: 'reducir', accion: 'Pausar o reducir presupuesto' };
  }
  return { estado: 'optimizar', accion: 'Mejorar creativos y audiencias' };
}

function aggregateProducts(
  days: SeriesDay[],
  metaSpend: Record<string, number>,
  adminPct: number,
  useMetaSpend: boolean,
): ProductRow[] {
  const allocated = allocateSpendByProduct(days);
  const map = new Map<string, Omit<ProductRow, 'roas' | 'cpa' | 'netPct' | 'estado' | 'accion'>>();
  for (const d of days) {
    const byp = d.by_product && typeof d.by_product === 'object' ? d.by_product : {};
    for (const [key, raw] of Object.entries(byp)) {
      const facturacion = Number(raw.ventas_despachadas_total || 0);
      const ventasEntregadas = Number(raw.ventas_entregadas_total || 0);
      const pedidos = Number(raw.ventas_despachadas_pedidos || 0);
      const costoEntregado = Number(raw.costo_producto_entregado_total || raw.costo_producto_total || 0);
      const flete = Number(raw.costo_flete_promedio_total || 0);
      const prev = map.get(key);
      if (prev) {
        prev.facturacion += facturacion;
        prev.pedidos += pedidos;
        prev.costoEntregado += costoEntregado;
        prev.flete += flete;
        prev.admin += ventasEntregadas * (adminPct / 100);
      } else {
        const pid =
          raw.product_id != null && Number.isFinite(Number(raw.product_id)) ? Number(raw.product_id) : null;
        map.set(key, {
          key,
          nombre: String(raw.label || key),
          productId: pid,
          facturacion,
          gasto: 0,
          pedidos,
          costoEntregado,
          flete,
          admin: ventasEntregadas * (adminPct / 100),
          utilidad: 0,
          netPct: 0,
          roas: 0,
          cpa: 0,
          estado: 'optimizar',
          accion: '',
        });
      }
    }
  }

  const rows: ProductRow[] = [];
  for (const p of map.values()) {
    p.gasto =
      useMetaSpend && p.productId != null
        ? Number(metaSpend[String(p.productId)] || 0)
        : allocated.get(p.key) || 0;
    p.utilidad = p.facturacion - p.gasto - p.costoEntregado - p.flete - p.admin;
    p.roas = p.gasto > 0 ? p.facturacion / p.gasto : 0;
    p.cpa = p.pedidos > 0 ? p.gasto / p.pedidos : 0;
    p.netPct = p.facturacion > 0 ? (p.utilidad / p.facturacion) * 100 : 0;
    rows.push(p as ProductRow);
  }

  const withSpend = rows.filter((r) => r.gasto > 0);
  const avgRoas = withSpend.length ? withSpend.reduce((s, r) => s + r.roas, 0) / withSpend.length : 0;

  return rows
    .map((r) => {
      const { estado, accion } = classifyProduct(r.roas, r.utilidad, avgRoas);
      return { ...r, estado, accion };
    })
    .sort((a, b) => b.gasto - a.gasto);
}

function estadoBadge(estado: ProductRow['estado']) {
  const map = {
    escalar: { variant: 'success' as const, label: 'Escalar' },
    optimizar: { variant: 'warning' as const, label: 'Optimizar' },
    reducir: { variant: 'error' as const, label: 'Reducir' },
  };
  const c = map[estado];
  return <StatusBadge variant={c.variant}>{c.label}</StatusBadge>;
}

function roasColor(roas: number, avg: number): string {
  if (roas >= avg * 1.05) return ds.successText;
  if (roas < avg * 0.85) return ds.dangerText;
  return ds.warningText;
}

function formatRangeLabel(period: PeriodKey, year: number, customFrom: string, customTo: string): string {
  if (period === 'year') return `Año ${year}`;
  if (period === 'custom' && customFrom && customTo) {
    try {
      const fmt = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
      return `${fmt.format(new Date(`${customFrom}T12:00:00`))} – ${fmt.format(new Date(`${customTo}T12:00:00`))}`;
    } catch {
      return `${customFrom} – ${customTo}`;
    }
  }
  if (period === '7d') return 'Últimos 7 días';
  if (period === '14d') return 'Últimos 14 días';
  return 'Últimos 30 días';
}

function ProductAvatar({ name, index }: { name: string; index: number }) {
  const color = PRODUCT_COLORS[index % PRODUCT_COLORS.length];
  const initial = (name.trim()[0] || '?').toUpperCase();
  return (
    <span
      style={{
        width: 28,
        height: 28,
        borderRadius: 8,
        background: `${color}22`,
        color,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        fontWeight: 700,
        marginRight: 8,
        flexShrink: 0,
      }}
    >
      {initial}
    </span>
  );
}

export default function GastoPublicitarioPorProductoPage() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [period, setPeriod] = useState<PeriodKey>('7d');
  const [customFrom, setCustomFrom] = useState(() => defaultCustomRange().from);
  const [customTo, setCustomTo] = useState(() => defaultCustomRange().to);
  const [tab, setTab] = useState<'resumen' | 'producto'>('resumen');
  const [selectedProductKey, setSelectedProductKey] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState<string | null>(null);
  const [currency, setCurrency] = useState('COP');
  const [allDays, setAllDays] = useState<SeriesDay[]>([]);
  const [metaSpend, setMetaSpend] = useState<Record<string, number>>({});
  const [metaConnected, setMetaConnected] = useState(false);
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopifyDomain, setShopifyDomain] = useState('');
  const [adminPercentInput] = useState(() => {
    try {
      return localStorage.getItem('kovo_ganancia_admin_percent') || '0';
    } catch {
      return '0';
    }
  });
  const adminPct = useMemo(() => parsePercentInput(adminPercentInput), [adminPercentInput]);

  const metaPeriodParam = useMemo(() => {
    if (period === 'year') return '30d';
    if (period === 'custom') return metaPeriodForDayCount(dayCountInclusive(customFrom, customTo));
    if (period === '14d') return '14d';
    if (period === '30d') return '30d';
    return '7d';
  }, [period, customFrom, customTo]);

  const useMetaSpend = useMemo(() => {
    const currentYear = new Date().getFullYear();
    if (year !== currentYear) return false;
    if (period === 'year') return false;
    if (period === 'custom') return dayCountInclusive(customFrom, customTo) <= 30;
    return true;
  }, [year, period, customFrom, customTo]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const monthKeys = [...new Set([...monthsForYear(year), ...monthsForYear(year - 1)])].sort().join(',');
      let qs = `months=${encodeURIComponent(monthKeys)}`;
      if (useMetaSpend) {
        qs += `&meta_period=${metaPeriodParam}`;
      }

      const [seriesRes, shopRes, metaRes, spendRes] = await Promise.all([
        apiFetch(`/api/ganancia-diaria/series?${qs}`),
        apiFetch('/api/shopify/connection'),
        apiFetch('/api/meta/connections'),
        useMetaSpend
          ? apiFetch(`/api/product-analytics/meta-spend?period=${metaPeriodParam}`)
          : Promise.resolve(null),
      ]);

      const seriesBody = (await seriesRes.json().catch(() => ({}))) as SeriesPayload;
      if (!seriesRes.ok) {
        setError(typeof seriesBody.error === 'string' ? seriesBody.error : 'No se pudo cargar el módulo');
        setAllDays([]);
        return;
      }

      setAllDays(Array.isArray(seriesBody.days) ? seriesBody.days : []);
      setCurrency((seriesBody.ventas_currency || 'COP').toUpperCase());
      setWarning(seriesBody.warning ?? null);

      const spendBody = spendRes
        ? ((await spendRes.json().catch(() => ({}))) as { product_spend?: Record<string, number> })
        : {};
      setMetaSpend(spendRes?.ok && spendBody.product_spend ? spendBody.product_spend : {});

      const shopBody = await shopRes.json().catch(() => ({}));
      setShopifyConnected(shopBody?.status === 'connected');
      setShopifyDomain(String(shopBody?.shop_domain || ''));

      const metaBody = await metaRes.json().catch(() => ({}));
      const connections = Array.isArray(metaBody?.connections) ? metaBody.connections : [];
      setMetaConnected(connections.some((c: { status?: string }) => c?.status === 'connected'));
    } catch {
      setError('Error de red cargando gasto publicitario por producto');
      setAllDays([]);
    } finally {
      setLoading(false);
    }
  }, [year, metaPeriodParam, useMetaSpend]);

  useEffect(() => {
    void load();
  }, [load]);

  const yearDays = useMemo(() => filterDaysForYear(allDays, year), [allDays, year]);
  const prevYearDays = useMemo(() => filterDaysForYear(allDays, year - 1), [allDays, year]);

  const currentDays = useMemo(() => {
    if (period === 'custom') {
      const { from, to } = yearBounds(year);
      const fromClamped = customFrom < from ? from : customFrom;
      const toClamped = customTo > to ? to : customTo;
      return filterPeriodDays(yearDays, period, fromClamped, toClamped, 0);
    }
    return filterPeriodDays(yearDays, period, customFrom, customTo, 0);
  }, [yearDays, period, customFrom, customTo, year]);

  const previousDays = useMemo(() => {
    if (period === 'year') return prevYearDays;
    if (period === 'custom') {
      const { from, to } = yearBounds(year);
      const fromClamped = customFrom < from ? from : customFrom;
      const toClamped = customTo > to ? to : customTo;
      return filterPeriodDays(yearDays, period, fromClamped, toClamped, 1);
    }
    return filterPeriodDays(yearDays, period, customFrom, customTo, 1);
  }, [yearDays, prevYearDays, period, customFrom, customTo, year]);

  const products = useMemo(
    () => aggregateProducts(currentDays, metaSpend, adminPct, useMetaSpend),
    [currentDays, metaSpend, adminPct, useMetaSpend],
  );
  const prevProducts = useMemo(
    () => aggregateProducts(previousDays, metaSpend, adminPct, false),
    [previousDays, metaSpend, adminPct],
  );

  const visibleProducts = useMemo(() => {
    if (selectedProductKey === 'all') return products;
    return products.filter((p) => p.key === selectedProductKey);
  }, [products, selectedProductKey]);

  const totals = useMemo(() => {
    const rows = visibleProducts;
    const gasto = rows.reduce((s, r) => s + r.gasto, 0);
    const facturacion = rows.reduce((s, r) => s + r.facturacion, 0);
    const utilidad = rows.reduce((s, r) => s + r.utilidad, 0);
    const pedidos = rows.reduce((s, r) => s + r.pedidos, 0);
    const count = rows.filter((r) => r.gasto > 0 || r.facturacion > 0).length;
    const roas = gasto > 0 ? facturacion / gasto : 0;
    const cpa = pedidos > 0 ? gasto / pedidos : 0;
    const withSpend = rows.filter((r) => r.gasto > 0);
    const max = withSpend.length ? withSpend.reduce((a, b) => (b.gasto > a.gasto ? b : a)) : null;
    const min = withSpend.length ? withSpend.reduce((a, b) => (b.gasto < a.gasto ? b : a)) : null;
    return { gasto, facturacion, utilidad, pedidos, count, roas, cpa, max, min, avgPerProduct: count > 0 ? gasto / count : 0 };
  }, [visibleProducts]);

  const prevTotals = useMemo(() => {
    const rows = selectedProductKey === 'all' ? prevProducts : prevProducts.filter((p) => p.key === selectedProductKey);
    const gasto = rows.reduce((s, r) => s + r.gasto, 0);
    const facturacion = rows.reduce((s, r) => s + r.facturacion, 0);
    const utilidad = rows.reduce((s, r) => s + r.utilidad, 0);
    const pedidos = rows.reduce((s, r) => s + r.pedidos, 0);
    const count = rows.filter((r) => r.gasto > 0 || r.facturacion > 0).length;
    return {
      gasto,
      facturacion,
      utilidad,
      roas: gasto > 0 ? facturacion / gasto : 0,
      cpa: pedidos > 0 ? gasto / pedidos : 0,
      avgPerProduct: count > 0 ? gasto / count : 0,
      count,
    };
  }, [prevProducts, selectedProductKey]);

  const avgRoas = useMemo(() => {
    const ws = products.filter((p) => p.gasto > 0);
    return ws.length ? ws.reduce((s, p) => s + p.roas, 0) / ws.length : 0;
  }, [products]);

  const diagnostic = useMemo(() => {
    const escalar = products.filter((p) => p.estado === 'escalar' && p.gasto > 0);
    const optimizar = products.filter((p) => p.estado === 'optimizar' && p.gasto > 0);
    const reducir = products.filter((p) => p.estado === 'reducir' && p.gasto > 0);
    const recs: string[] = [];
    if (escalar.length) recs.push(`Escala ${escalar.slice(0, 2).map((p) => p.nombre).join(' y ')}.`);
    if (reducir.length) recs.push(`Reduce o pausa ${reducir.slice(0, 2).map((p) => p.nombre).join(' y ')}.`);
    if (optimizar.length) recs.push(`Optimiza creativos en ${optimizar.slice(0, 2).map((p) => p.nombre).join(' y ')}.`);
    if (!recs.length) recs.push('Registra gasto en Meta vinculado a productos para obtener recomendaciones.');
    return { escalar, optimizar, reducir, recs };
  }, [products]);

  const chartProducts = useMemo(
    () => [...visibleProducts].filter((p) => p.gasto > 0).slice(0, 8),
    [visibleProducts],
  );
  const maxGasto = Math.max(...chartProducts.map((p) => p.gasto), 1);
  const maxRoasChart = Math.max(...chartProducts.map((p) => p.roas), 1);
  const chartW = 640;
  const chartH = 200;

  const selectedProduct = useMemo(
    () => products.find((p) => p.key === selectedProductKey) ?? null,
    [products, selectedProductKey],
  );

  const periodSuffix =
    period === 'year'
      ? ` vs ${year - 1}`
      : period === '7d'
        ? ' vs sem. ant.'
        : period === '14d'
          ? ' vs 14d ant.'
          : ' vs periodo ant.';

  const handleYearChange = (nextYear: number) => {
    setYear(nextYear);
    const bounds = yearBounds(nextYear);
    setCustomFrom(bounds.from);
    setCustomTo(bounds.to);
  };

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 4px 32px' }}>
      <PageHeader
        title="Gasto publicitario por producto"
        subtitle="Analiza la inversión publicitaria por producto para decidir qué escalar, optimizar o pausar."
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
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: ds.textMuted, display: 'flex', alignItems: 'center', gap: 4 }}>
            <IconCalendar size={14} /> Año
          </span>
          {yearOptions().map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => handleYearChange(y)}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: `1px solid ${year === y ? ds.brand : ds.borderCard}`,
                background: year === y ? ds.brandBg : ds.bgCard,
                color: year === y ? ds.brand : ds.textSecondary,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {y}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: ds.textMuted }}>Periodo:</span>
            {(['7d', '14d', '30d', 'year', 'custom'] as PeriodKey[]).map((p) => (
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
                {p === '7d'
                  ? '7 días'
                  : p === '14d'
                    ? '14 días'
                    : p === '30d'
                      ? '30 días'
                      : p === 'year'
                        ? 'Año completo'
                        : 'Personalizado'}
              </button>
            ))}
            {period === 'custom' ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="date"
                  value={customFrom}
                  min={yearBounds(year).from}
                  max={yearBounds(year).to}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  style={{ padding: '5px 8px', borderRadius: 8, border: `1px solid ${ds.borderCard}`, fontSize: 12 }}
                />
                <span style={{ color: ds.textMuted, fontSize: 12 }}>–</span>
                <input
                  type="date"
                  value={customTo}
                  min={yearBounds(year).from}
                  max={yearBounds(year).to}
                  onChange={(e) => setCustomTo(e.target.value)}
                  style={{ padding: '5px 8px', borderRadius: 8, border: `1px solid ${ds.borderCard}`, fontSize: 12 }}
                />
              </div>
            ) : (
              <span style={{ fontSize: 12, color: ds.textMuted }}>
                {formatRangeLabel(period, year, customFrom, customTo)}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: ds.textMuted }}>Producto:</span>
            <select
              value={selectedProductKey}
              onChange={(e) => setSelectedProductKey(e.target.value)}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: `1px solid ${ds.borderCard}`,
                fontSize: 12,
                background: ds.bgCard,
                color: ds.textSecondary,
                maxWidth: 220,
              }}
            >
              <option value="all">Todos los productos</option>
              {products.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['resumen', 'producto'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: `1px solid ${tab === t ? ds.brand : ds.borderCard}`,
              background: tab === t ? ds.brand : ds.bgCard,
              color: tab === t ? ds.textOnBrand : ds.textSecondary,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t === 'resumen' ? 'Resumen' : 'Producto'}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: ds.textMuted, padding: 24 }}>Cargando…</div>
      ) : error ? (
        <div style={{ ...cardBase, color: ds.dangerText }}>{error}</div>
      ) : (
        <>
          {warning ? (
            <div style={{ ...cardBase, marginBottom: 16, background: ds.warningBg, color: ds.warningText, fontSize: 13 }}>
              {warning}
            </div>
          ) : null}

          {tab === 'resumen' ? (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <KpiCard
                  variant="stock"
                  label="Productos analizados"
                  icon={<IconProduct />}
                  value={totals.count}
                  badge={changeBadge(pctChange(totals.count, prevTotals.count), periodSuffix)}
                />
                <KpiCard
                  variant="spend"
                  label="Gasto publicitario total"
                  icon={<IconTarget />}
                  value={money(totals.gasto, currency)}
                  badge={changeBadge(pctChange(totals.gasto, prevTotals.gasto), periodSuffix)}
                />
                <KpiCard
                  variant="traffic"
                  label="Promedio por producto"
                  icon={<IconTrendingUp />}
                  value={money(totals.avgPerProduct, currency)}
                  badge={changeBadge(pctChange(totals.avgPerProduct, prevTotals.avgPerProduct), periodSuffix)}
                />
                <KpiCard
                  variant="alert"
                  label="Producto con mayor gasto"
                  icon={<IconMegaphone />}
                  value={
                    totals.max ? (
                      <>
                        {totals.max.nombre}{' '}
                        <span style={{ fontSize: 14 }}>({money(totals.max.gasto, currency)})</span>
                      </>
                    ) : (
                      '—'
                    )
                  }
                />
                <KpiCard
                  variant="conversion"
                  label="Producto con menor gasto"
                  icon={<IconTarget />}
                  value={
                    totals.min ? (
                      <>
                        {totals.min.nombre}{' '}
                        <span style={{ fontSize: 14 }}>({money(totals.min.gasto, currency)})</span>
                      </>
                    ) : (
                      '—'
                    )
                  }
                />
                <KpiCard
                  variant="sales"
                  label="ROAS promedio"
                  icon={<IconTrendingUp />}
                  value={roasFmt(totals.roas)}
                  badge={changeBadge(pctChange(totals.roas, prevTotals.roas), periodSuffix)}
                />
                <KpiCard
                  variant="spend"
                  label="CPA promedio"
                  icon={<IconTarget />}
                  value={money(totals.cpa, currency)}
                  badge={changeBadge(pctChange(totals.cpa, prevTotals.cpa), periodSuffix)}
                />
                <KpiCard
                  variant="sales"
                  label="Utilidad neta total"
                  icon={<IconTrendingUp />}
                  value={money(totals.utilidad, currency)}
                  badge={changeBadge(pctChange(totals.utilidad, prevTotals.utilidad), periodSuffix)}
                />
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 2fr) minmax(240px, 1fr)',
                  gap: 16,
                  marginBottom: 16,
                }}
              >
                <div style={cardBase}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: ds.textPrimary, marginBottom: 4 }}>
                    Comparativa de gasto y ROAS por producto
                  </div>
                  <div style={{ fontSize: 12, color: ds.textMuted, marginBottom: 16 }}>
                    Barras: gasto · Línea: ROAS
                  </div>
                  {chartProducts.length ? (
                    <div style={{ overflowX: 'auto' }}>
                      <svg width={chartW} height={chartH + 40} viewBox={`0 0 ${chartW} ${chartH + 40}`}>
                        {chartProducts.map((p, i) => {
                          const slot = (chartW - 48) / chartProducts.length;
                          const x = 24 + i * slot;
                          const barW = slot - 10;
                          const h = (p.gasto / maxGasto) * (chartH - 36);
                          return (
                            <rect
                              key={p.key}
                              x={x}
                              y={chartH - 24 - h}
                              width={barW}
                              height={h}
                              fill={alpha.brand35}
                              rx={3}
                            />
                          );
                        })}
                        <polyline
                          fill="none"
                          stroke={ds.brand}
                          strokeWidth={2}
                          points={chartProducts
                            .map((p, i) => {
                              const slot = (chartW - 48) / chartProducts.length;
                              const x = 24 + i * slot + (slot - 10) / 2;
                              const y = chartH - 24 - (p.roas / maxRoasChart) * (chartH - 36);
                              return `${x},${y}`;
                            })
                            .join(' ')}
                        />
                        {chartProducts.map((p, i) => {
                          const slot = (chartW - 48) / chartProducts.length;
                          const x = 24 + i * slot + (slot - 10) / 2;
                          return (
                            <text
                              key={`lbl-${p.key}`}
                              x={x}
                              y={chartH + 16}
                              fontSize={8}
                              fill={ds.textMuted}
                              textAnchor="middle"
                            >
                              {p.nombre.length > 12 ? `${p.nombre.slice(0, 10)}…` : p.nombre}
                            </text>
                          );
                        })}
                      </svg>
                    </div>
                  ) : (
                    <div style={{ color: ds.textMuted, fontSize: 13 }}>Sin gasto por producto en el periodo</div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={cardBase}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: ds.textPrimary, marginBottom: 12 }}>
                      Matriz de decisiones
                    </div>
                    {[
                      { title: 'Escalar', color: ds.successText, bg: ds.successBg, rows: diagnostic.escalar },
                      { title: 'Optimizar', color: ds.warningText, bg: ds.warningBg, rows: diagnostic.optimizar },
                      { title: 'Reducir', color: ds.dangerText, bg: ds.dangerBg, rows: diagnostic.reducir },
                    ].map((block) => (
                      <div
                        key={block.title}
                        style={{ padding: '8px 10px', borderRadius: 8, background: block.bg, marginBottom: 8 }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 700, color: block.color, marginBottom: 4 }}>
                          {block.title}
                        </div>
                        <div style={{ fontSize: 12, color: ds.textSecondary }}>
                          {block.rows.length ? block.rows.map((p) => p.nombre).join(', ') : '—'}
                        </div>
                      </div>
                    ))}
                    <div style={{ fontSize: 12, color: ds.textMuted, lineHeight: 1.5, marginTop: 8 }}>
                      <strong>Recomendación:</strong> {diagnostic.recs.join(' ')}
                    </div>
                  </div>

                  <div style={cardBase}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: ds.textPrimary, marginBottom: 12 }}>
                      Ranking por gasto
                    </div>
                    {products.filter((p) => p.gasto > 0).slice(0, 5).map((p, i) => (
                      <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: ds.textMuted, width: 16 }}>{i + 1}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: ds.textPrimary, marginBottom: 4 }}>
                            {p.nombre}
                          </div>
                          <div
                            style={{
                              height: 6,
                              borderRadius: 3,
                              background: alpha.brand12,
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                width: `${(p.gasto / maxGasto) * 100}%`,
                                height: '100%',
                                background: ds.brand,
                                borderRadius: 3,
                              }}
                            />
                          </div>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 600, color: ds.textSecondary }}>
                          {money(p.gasto, currency)}
                        </span>
                      </div>
                    ))}
                    {!products.some((p) => p.gasto > 0) ? (
                      <div style={{ color: ds.textMuted, fontSize: 13 }}>Sin ranking disponible</div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div style={cardBase}>
                <div style={{ fontSize: 14, fontWeight: 700, color: ds.textPrimary, marginBottom: 16 }}>
                  Comparativa por producto
                </div>
                <DataTable>
                  <table style={tableBase}>
                    <thead>
                      <tr>
                        <Th>Producto</Th>
                        <Th style={{ textAlign: 'right' }}>Facturación</Th>
                        <Th style={{ textAlign: 'right' }}>Gasto</Th>
                        <Th style={{ textAlign: 'right' }}>ROAS</Th>
                        <Th style={{ textAlign: 'right' }}>CPA</Th>
                        <Th style={{ textAlign: 'right' }}>Compras</Th>
                        <Th style={{ textAlign: 'right' }}>Utilidad neta</Th>
                        <Th style={{ textAlign: 'right' }}>% Utilidad neta</Th>
                        <Th>Estado</Th>
                        <Th>Acción recomendada</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleProducts.length === 0 ? (
                        <tr>
                          <td colSpan={10} style={{ padding: '12px 16px', fontSize: 12, color: ds.textMuted }}>
                            Sin productos en el periodo
                          </td>
                        </tr>
                      ) : (
                        visibleProducts.map((p, i, arr) => {
                          const isLast = i === arr.length - 1;
                          return (
                            <tr key={p.key}>
                              <Td isLast={isLast}>
                                <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                                  <ProductAvatar name={p.nombre} index={i} />
                                  {p.nombre}
                                </span>
                              </Td>
                              <Td isLast={isLast} style={{ textAlign: 'right' }}>
                                {money(p.facturacion, currency)}
                              </Td>
                              <Td isLast={isLast} style={{ textAlign: 'right' }}>
                                {money(p.gasto, currency)}
                              </Td>
                              <Td
                                isLast={isLast}
                                style={{ textAlign: 'right', color: roasColor(p.roas, avgRoas), fontWeight: 600 }}
                              >
                                {roasFmt(p.roas)}
                              </Td>
                              <Td isLast={isLast} style={{ textAlign: 'right' }}>
                                {money(p.cpa, currency)}
                              </Td>
                              <Td isLast={isLast} style={{ textAlign: 'right' }}>
                                {p.pedidos.toLocaleString('es-CO')}
                              </Td>
                              <Td
                                isLast={isLast}
                                style={{
                                  textAlign: 'right',
                                  color: p.utilidad >= 0 ? ds.successText : ds.dangerText,
                                  fontWeight: 600,
                                }}
                              >
                                {money(p.utilidad, currency)}
                              </Td>
                              <Td
                                isLast={isLast}
                                style={{
                                  textAlign: 'right',
                                  color: p.netPct >= 0 ? ds.successText : ds.dangerText,
                                }}
                              >
                                {pct(p.netPct)}
                              </Td>
                              <Td isLast={isLast}>{estadoBadge(p.estado)}</Td>
                              <Td isLast={isLast} style={{ fontSize: 12, color: ds.textSecondary }}>
                                {p.accion}
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
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>
              <div style={cardBase}>
                <div style={{ fontSize: 12, color: ds.textMuted, marginBottom: 8 }}>Producto seleccionado</div>
                <select
                  value={selectedProductKey === 'all' ? products[0]?.key ?? '' : selectedProductKey}
                  onChange={(e) => setSelectedProductKey(e.target.value)}
                  style={{
                    width: '100%',
                    maxWidth: 360,
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: `1px solid ${ds.borderCard}`,
                    fontSize: 13,
                    marginBottom: 16,
                  }}
                >
                  {products.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
                {selectedProduct || products[0] ? (
                  (() => {
                    const p = selectedProduct || products[0];
                    const prev = prevProducts.find((x) => x.key === p.key);
                    return (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                          gap: 12,
                        }}
                      >
                        {[
                          { label: 'Facturación', value: money(p.facturacion, currency), ch: pctChange(p.facturacion, prev?.facturacion ?? 0) },
                          { label: 'Gasto publicitario', value: money(p.gasto, currency), ch: pctChange(p.gasto, prev?.gasto ?? 0) },
                          { label: 'ROAS', value: roasFmt(p.roas), ch: pctChange(p.roas, prev?.roas ?? 0) },
                          { label: 'CPA', value: money(p.cpa, currency), ch: pctChange(p.cpa, prev?.cpa ?? 0) },
                          { label: 'Compras', value: p.pedidos.toLocaleString('es-CO'), ch: pctChange(p.pedidos, prev?.pedidos ?? 0) },
                          { label: 'Utilidad neta', value: money(p.utilidad, currency), ch: pctChange(p.utilidad, prev?.utilidad ?? 0) },
                          { label: '% Utilidad neta', value: pct(p.netPct), ch: pctChange(p.netPct, prev?.netPct ?? 0) },
                        ].map((k) => (
                          <div
                            key={k.label}
                            style={{
                              padding: '12px 14px',
                              borderRadius: 10,
                              border: `1px solid ${ds.borderCard}`,
                              background: ds.bgSubtle,
                            }}
                          >
                            <div style={{ fontSize: 11, color: ds.textMuted, marginBottom: 4 }}>{k.label}</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: ds.textPrimary }}>{k.value}</div>
                            {changeBadge(k.ch, periodSuffix)}
                          </div>
                        ))}
                        <div style={{ gridColumn: '1 / -1', marginTop: 8 }}>
                          {estadoBadge(p.estado)}
                          <span style={{ marginLeft: 10, fontSize: 13, color: ds.textSecondary }}>{p.accion}</span>
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <div style={{ color: ds.textMuted }}>No hay productos con datos en este periodo.</div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
