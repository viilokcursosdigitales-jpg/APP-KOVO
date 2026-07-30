import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../auth/api';
import { formatYmdLocal } from '../utils/datePresets';
import {
  clearGananciaSeriesCache,
  consumeGananciaSeriesStale,
  isGananciaSeriesStale,
} from '../utils/gananciaSeriesCache';
import { GananciaDiariaDashboardView } from './gananciaDiaria/GananciaDiariaDashboardView';
import type { ComplementaryProductDetail } from './gananciaDiaria/dashboardUiUtils';

type ProductDaySlice = {
  label?: string;
  product_id?: number | null;
  ventas_despachadas_total: number;
  ventas_entregadas_total: number;
  ventas_despachadas_pedidos: number;
  cantidad_producto_total: number;
  costo_producto_total: number;
  costo_producto_entregado_total: number;
  costo_flete_promedio_total: number;
  gasto_publicitario_total?: number;
};

type SeriesDayRow = {
  date: string;
  ventas_despachadas_total: number;
  ventas_entregadas_total: number;
  ventas_despachadas_pedidos: number;
  cantidad_producto_total: number;
  costo_producto_total: number;
  costo_producto_entregado_total: number;
  costo_flete_promedio_total: number;
  gasto_publicitario_total: number;
  ganancia: number | null;
  utilidad: number | null;
  by_product?: Record<string, ProductDaySlice>;
};

type SeriesPayload = {
  shop_calendar_timezone?: string;
  ventas_currency?: string | null;
  meta_currency?: string | null;
  ganancia_comparable?: boolean;
  warning?: string | null;
  meta_partial_errors?: { adAccountId: string; error: string }[];
  available_months?: string[];
  months_applied?: string[];
  /** 7 cuando el servidor acotó a últimos 7 días (sin months ni meta_period). */
  implicit_window_days?: number | null;
  product_options?: { key: string; label: string; product_id: number | null }[];
  product_id_applied?: number | null;
  product_spend_allocation?: string | null;
  primary_product_ids?: number[];
  product_complementary_detail?: Record<string, ComplementaryProductDetail[]>;
  days?: SeriesDayRow[];
  error?: string;
  code?: string;
};

function shiftYmd(ymd: string, deltaDays: number): string {
  const p = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!p) return ymd;
  const d = new Date(Number(p[1]), Number(p[2]) - 1, Number(p[3]));
  d.setDate(d.getDate() + deltaDays);
  return formatYmdLocal(d);
}

function formatMoney(n: number, currency: string | null | undefined): string {
  if (!Number.isFinite(n)) return '—';
  const c = (currency || 'USD').trim().toUpperCase();
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: c.length === 3 ? c : 'USD',
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${n.toLocaleString('es-CO', { maximumFractionDigits: 0 })} ${c}`;
  }
}

function formatPercent(numerator: number, denominator: number): string {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return '0.00%';
  const pct = (numerator / denominator) * 100;
  return `${pct.toFixed(2)}%`;
}

function formatRoas(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(2)}x`;
}

function formatMonthLabel(ym: string): string {
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  if (!m) return ym;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  if (!Number.isFinite(y) || mo < 1 || mo > 12) return ym;
  try {
    return new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' }).format(new Date(y, mo - 1, 1));
  } catch {
    return ym;
  }
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

function parsePercentInput(raw: string): number {
  const n = Number.parseFloat(String(raw || '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** Misma utilidad que muestra la tabla por día: API − % admin sobre ventas entregadas. */
function utilidadMostradaPorDia(
  row: SeriesDayRow,
  comparable: boolean | undefined,
  adminPercent: number,
): number | null {
  if (!comparable || row.utilidad == null || !Number.isFinite(row.utilidad)) return null;
  const ve = row.ventas_entregadas_total || row.ventas_despachadas_total || 0;
  return (row.utilidad as number) - ve * (adminPercent / 100);
}

function normalizeProductLabel(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function collectProductDaySlices(
  byp: Record<string, ProductDaySlice>,
  productId: number,
  productLabel?: string,
): ProductDaySlice[] {
  const normLabel = productLabel ? normalizeProductLabel(productLabel) : '';
  return Object.values(byp).filter((x) => {
    if (!x) return false;
    if (Number.isFinite(Number(x.product_id)) && Number(x.product_id) === productId) return true;
    if (normLabel && normalizeProductLabel(String(x.label || '')) === normLabel) return true;
    return false;
  });
}

function sumProductDaySlices(slices: ProductDaySlice[], productId: number): ProductDaySlice | null {
  if (!slices.length) return null;
  let ventasDesp = 0;
  let ventasEnt = 0;
  let pedidos = 0;
  let qty = 0;
  let costoProd = 0;
  let costoProdEnt = 0;
  let costoFlete = 0;
  let label = '';
  for (const s of slices) {
    ventasDesp += Number(s.ventas_despachadas_total || 0);
    ventasEnt += Number(s.ventas_entregadas_total || 0);
    pedidos += Number(s.ventas_despachadas_pedidos || 0);
    qty += Number(s.cantidad_producto_total || 0);
    costoProd += Number(s.costo_producto_total || 0);
    costoProdEnt += Number(s.costo_producto_entregado_total || 0);
    costoFlete += Number(s.costo_flete_promedio_total || 0);
    if (!label && s.label) label = String(s.label);
  }
  return {
    label: label || `Producto ${productId}`,
    product_id: productId,
    ventas_despachadas_total: ventasDesp,
    ventas_entregadas_total: ventasEnt,
    ventas_despachadas_pedidos: pedidos,
    cantidad_producto_total: qty,
    costo_producto_total: costoProd,
    costo_producto_entregado_total: costoProdEnt,
    costo_flete_promedio_total: costoFlete,
  };
}

function filterDayRowByProduct(
  row: SeriesDayRow,
  productId: number,
  comparable: boolean | undefined,
  productLabel?: string,
): SeriesDayRow {
  const byp = row.by_product && typeof row.by_product === 'object' ? row.by_product : {};
  const selected = sumProductDaySlices(collectProductDaySlices(byp, productId, productLabel), productId);
  const totalVentasDay = Number(row.ventas_despachadas_total || 0);
  const totalGastoAdsDay = Number(row.gasto_publicitario_total || 0);
  if (!selected) {
    return {
      ...row,
      ventas_despachadas_total: 0,
      ventas_entregadas_total: 0,
      ventas_despachadas_pedidos: 0,
      cantidad_producto_total: 0,
      costo_producto_total: 0,
      costo_producto_entregado_total: 0,
      costo_flete_promedio_total: 0,
      gasto_publicitario_total: 0,
      ganancia: comparable ? 0 : null,
      utilidad: comparable ? 0 : null,
      by_product: {},
    };
  }
  const ventasDesp = Number(selected.ventas_despachadas_total || 0);
  const ventasEnt = Number(selected.ventas_entregadas_total || 0);
  const pedidos = Number(selected.ventas_despachadas_pedidos || 0);
  const qty = Number(selected.cantidad_producto_total || 0);
  const costoProd = Number(selected.costo_producto_total || 0);
  const costoProdEnt = Number(selected.costo_producto_entregado_total || 0);
  const costoFlete = Number(selected.costo_flete_promedio_total || 0);
  const shareByVentas =
    totalVentasDay > 0 && Number.isFinite(totalVentasDay) ? Math.max(0, Math.min(1, ventasDesp / totalVentasDay)) : 0;
  const linkedGasto = selected.gasto_publicitario_total;
  const gastoAds =
    linkedGasto != null && Number.isFinite(Number(linkedGasto))
      ? Math.round(Number(linkedGasto) * 100) / 100
      : Math.round(totalGastoAdsDay * shareByVentas * 100) / 100;
  return {
    ...row,
    ventas_despachadas_total: Math.round(ventasDesp * 100) / 100,
    ventas_entregadas_total: Math.round(ventasEnt * 100) / 100,
    ventas_despachadas_pedidos: pedidos,
    cantidad_producto_total: Math.round(qty * 100) / 100,
    costo_producto_total: Math.round(costoProd * 100) / 100,
    costo_producto_entregado_total: Math.round(costoProdEnt * 100) / 100,
    costo_flete_promedio_total: Math.round(costoFlete * 100) / 100,
    gasto_publicitario_total: gastoAds,
    ganancia: comparable ? Math.round((ventasDesp - gastoAds) * 100) / 100 : null,
    utilidad: comparable ? Math.round((ventasEnt - gastoAds - costoProdEnt - costoFlete) * 100) / 100 : null,
    by_product: {
      [String(selected.product_id ?? productId)]: selected,
    },
  };
}

type ProductAnalysisRow = {
  key: string;
  product_id: number | null;
  label: string;
  ventasTotales: number;
  ventasDespachadas: number;
  gastoPublicitario: number;
  costoProductoEntregado: number;
  costoFlete: number;
  gastoAdmin: number;
  roasTotal: number | null;
  roasDespachado: number | null;
  utilidad: number | null;
  utilidadPct: number | null;
};

function aggregateProductAnalysis(
  rows: SeriesDayRow[],
  comparable: boolean | undefined,
  adminPercent: number,
): ProductAnalysisRow[] {
  const map = new Map<
    string,
    {
      label: string;
      ventasTotales: number;
      ventasDespachadas: number;
      gastoAds: number;
      costoProdEnt: number;
      costoFlete: number;
    }
  >();

  for (const row of rows) {
    const byp = row.by_product && typeof row.by_product === 'object' ? row.by_product : {};
    const totalVentasDay = Number(row.ventas_despachadas_total || 0);
    const gastoDay = Number(row.gasto_publicitario_total || 0);

    for (const [pk, slice] of Object.entries(byp)) {
      if (!slice) continue;
      const pid = Number(slice.product_id);
      const key = Number.isFinite(pid) && pid > 0 ? `p:${pid}` : pk;
      if (!map.has(key)) {
        map.set(key, {
          label: String(slice.label || pk),
          ventasTotales: 0,
          ventasDespachadas: 0,
          gastoAds: 0,
          costoProdEnt: 0,
          costoFlete: 0,
        });
      }
      const acc = map.get(key)!;
      const vd = Number(slice.ventas_despachadas_total || 0);
      const ve = Number(slice.ventas_entregadas_total || 0);
      acc.ventasDespachadas += vd;
      acc.ventasTotales += ve;
      acc.costoProdEnt += Number(slice.costo_producto_entregado_total || slice.costo_producto_total || 0);
      acc.costoFlete += Number(slice.costo_flete_promedio_total || 0);
      const sliceGasto = slice.gasto_publicitario_total;
      if (sliceGasto != null && Number.isFinite(Number(sliceGasto))) {
        acc.gastoAds += Number(sliceGasto);
      } else {
        const share =
          totalVentasDay > 0 && Number.isFinite(totalVentasDay) ? Math.max(0, Math.min(1, vd / totalVentasDay)) : 0;
        acc.gastoAds += gastoDay * share;
      }
    }
  }

  return [...map.entries()]
    .map(([key, r]) => {
      const utilidadBase = comparable
        ? r.ventasTotales - r.gastoAds - r.costoProdEnt - r.costoFlete
        : null;
      const utilidad =
        utilidadBase != null
          ? Math.round((utilidadBase - r.ventasTotales * (adminPercent / 100)) * 100) / 100
          : null;
      const utilidadPct =
        utilidad != null && r.ventasTotales > 0 ? (utilidad / r.ventasTotales) * 100 : null;
      const roasTotal = comparable && r.gastoAds > 0 ? r.ventasTotales / r.gastoAds : null;
      const roasDespachado = comparable && r.gastoAds > 0 ? r.ventasDespachadas / r.gastoAds : null;
      const gastoAdmin = r.ventasTotales * (adminPercent / 100);
      return {
        key,
        product_id: Number.isFinite(pid) && pid > 0 ? pid : null,
        label: r.label,
        ventasTotales: r.ventasTotales,
        ventasDespachadas: r.ventasDespachadas,
        gastoPublicitario: r.gastoAds,
        costoProductoEntregado: r.costoProdEnt,
        costoFlete: r.costoFlete,
        gastoAdmin,
        roasTotal,
        roasDespachado,
        utilidad,
        utilidadPct,
      };
    })
    .sort((a, b) => {
      const ap = a.utilidadPct ?? -Infinity;
      const bp = b.utilidadPct ?? -Infinity;
      if (bp !== ap) return bp - ap;
      return a.label.localeCompare(b.label, 'es', { sensitivity: 'base' });
    });
}

export default function GananciaDiariaPage() {
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [seriesLoading, setSeriesLoading] = useState(true);
  const [seriesError, setSeriesError] = useState('');
  const [seriesData, setSeriesData] = useState<SeriesPayload | null>(null);
  const [monthOptions, setMonthOptions] = useState<string[]>([]);
  const [productOptions, setProductOptions] = useState<{ key: string; label: string; product_id: number | null }[]>([]);
  const [monthsPanelOpen, setMonthsPanelOpen] = useState(false);
  const [pendingMonths, setPendingMonths] = useState<string[]>([]);
  const [adminPercentInput, setAdminPercentInput] = useState(() => {
    try {
      return localStorage.getItem('kovo_ganancia_admin_percent') || '0';
    } catch {
      return '0';
    }
  });
  const [goalPctInput, setGoalPctInput] = useState(() => {
    try {
      return localStorage.getItem('kovo_ganancia_goal_pct') || '20';
    } catch {
      return '20';
    }
  });
  const [rangeStartIdx, setRangeStartIdx] = useState(0);
  const [rangeEndIdx, setRangeEndIdx] = useState(0);
  const [draggingRangeThumb, setDraggingRangeThumb] = useState<'start' | 'end' | null>(null);
  const monthDropdownRef = useRef<HTMLDivElement>(null);
  const rangeSliderTrackRef = useRef<HTMLDivElement>(null);

  const loadSeries = useCallback(async (options?: { force?: boolean }) => {
    const force = options?.force === true;
    const qs = new URLSearchParams();
    if (selectedMonths.length > 0) {
      qs.set('months', selectedMonths.join(','));
    }
    if (force) qs.set('refresh', '1');
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    if (force) clearGananciaSeriesCache();
    setSeriesLoading(true);
    setSeriesError('');
    try {
      const res = await apiFetch(`/api/ganancia-diaria/series${suffix}`);
      const body = (await res.json().catch(() => ({}))) as SeriesPayload;
      if (!res.ok) {
        setSeriesData(null);
        setSeriesError(typeof body.error === 'string' ? body.error : 'No se pudo cargar la tabla');
        return;
      }
      setSeriesData(body);
      if (body.available_months?.length) setMonthOptions(body.available_months);
      if (Array.isArray(body.product_options)) setProductOptions(body.product_options);
    } catch {
      setSeriesData(null);
      setSeriesError('Error de red');
    } finally {
      setSeriesLoading(false);
    }
  }, [selectedMonths]);

  useEffect(() => {
    const force = consumeGananciaSeriesStale();
    void loadSeries({ force });
  }, [loadSeries]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && isGananciaSeriesStale()) {
        void loadSeries({ force: true });
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [loadSeries]);

  useEffect(() => {
    try {
      localStorage.setItem('kovo_ganancia_admin_percent', adminPercentInput);
    } catch {
      /* noop */
    }
  }, [adminPercentInput]);

  useEffect(() => {
    try {
      localStorage.setItem('kovo_ganancia_goal_pct', goalPctInput);
    } catch {
      /* noop */
    }
  }, [goalPctInput]);

  useEffect(() => {
    if (!monthsPanelOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = monthDropdownRef.current;
      if (!el || el.contains(e.target as Node)) return;
      setMonthsPanelOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [monthsPanelOpen]);

  const seriesMetaNote = useMemo(() => {
    if (!seriesData?.meta_partial_errors?.length) return null;
    return seriesData.meta_partial_errors.map((e) => `${e.adAccountId}: ${e.error}`).join(' · ');
  }, [seriesData]);

  const appliedPeriodLabel = useMemo(() => {
    if (selectedMonths.length > 0) return selectedMonths.map(formatMonthLabel).join(', ');
    if (seriesData?.implicit_window_days === 7) return 'Últimos 7 días';
    const m = seriesData?.months_applied;
    if (m?.length) return m.map(formatMonthLabel).join(', ');
    return 'Predeterminado';
  }, [selectedMonths, seriesData?.implicit_window_days, seriesData?.months_applied]);

  const availableMonths = monthOptions.length > 0 ? monthOptions : seriesData?.available_months ?? [];
  const availableProducts = productOptions.length > 0 ? productOptions : seriesData?.product_options ?? [];

  const openMonthsPanel = () => {
    setPendingMonths(selectedMonths.length > 0 ? [...selectedMonths] : []);
    setMonthsPanelOpen(true);
  };

  const togglePendingMonth = (ym: string) => {
    setPendingMonths((prev) => (prev.includes(ym) ? prev.filter((x) => x !== ym) : [...prev, ym].sort()));
  };

  const applyMonthFilter = () => {
    if (pendingMonths.length === 0) return;
    setSelectedMonths([...new Set(pendingMonths)].sort());
    setMonthsPanelOpen(false);
  };

  const days = seriesData?.days ?? [];
  const seriesVentasCur = seriesData?.ventas_currency;
  const seriesMetaCur = seriesData?.meta_currency;
  const comparable = seriesData?.ganancia_comparable;
  const adminPercent = useMemo(() => parsePercentInput(adminPercentInput), [adminPercentInput]);
  const goalPct = useMemo(() => parsePercentInput(goalPctInput), [goalPctInput]);
  const selectedProductMeta = useMemo(() => {
    if (!selectedProductId) return null;
    const pid = Number.parseInt(selectedProductId, 10);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    const opt = availableProducts.find((p) => Number(p.product_id) === pid);
    return { productId: pid, label: opt?.label ?? '' };
  }, [selectedProductId, availableProducts]);
  const daysForTable = useMemo(() => {
    if (!selectedProductMeta) return days;
    return days.map((row) =>
      filterDayRowByProduct(row, selectedProductMeta.productId, comparable, selectedProductMeta.label),
    );
  }, [days, selectedProductMeta, comparable]);
  const dayKeys = useMemo(() => {
    const s = new Set<string>();
    for (const row of daysForTable) s.add(String(row.date || '').trim());
    return [...s].filter(Boolean).sort();
  }, [daysForTable]);

  const dayKeysSig = useMemo(() => dayKeys.join('|'), [dayKeys]);

  useEffect(() => {
    if (dayKeys.length === 0) {
      setRangeStartIdx(0);
      setRangeEndIdx(0);
      return;
    }
    const last = dayKeys.length - 1;
    setRangeStartIdx(0);
    setRangeEndIdx(last);
  }, [dayKeysSig]);

  const effectiveRangeIdx = useMemo(() => {
    if (dayKeys.length === 0) return { start: 0, end: 0 };
    const last = dayKeys.length - 1;
    const a = Math.max(0, Math.min(rangeStartIdx, last));
    const b = Math.max(0, Math.min(rangeEndIdx, last));
    return a <= b ? { start: a, end: b } : { start: b, end: a };
  }, [dayKeys, rangeStartIdx, rangeEndIdx]);

  const selectedRangeDates = useMemo(() => {
    if (dayKeys.length === 0) return { from: '', to: '' };
    return {
      from: dayKeys[effectiveRangeIdx.start] || '',
      to: dayKeys[effectiveRangeIdx.end] || '',
    };
  }, [dayKeys, effectiveRangeIdx]);

  const maxRangeIdx = Math.max(dayKeys.length - 1, 0);
  const startPercent = maxRangeIdx > 0 ? (effectiveRangeIdx.start / maxRangeIdx) * 100 : 0;
  const endPercent = maxRangeIdx > 0 ? (effectiveRangeIdx.end / maxRangeIdx) * 100 : 100;

  const updateRangeThumbAtClientX = useCallback(
    (thumb: 'start' | 'end', clientX: number) => {
      const track = rangeSliderTrackRef.current;
      if (!track || dayKeys.length === 0) return;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;
      const rel = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const idx = Math.round(rel * maxRangeIdx);
      if (thumb === 'start') {
        setRangeStartIdx(Math.max(0, Math.min(idx, effectiveRangeIdx.end)));
      } else {
        setRangeEndIdx(Math.min(maxRangeIdx, Math.max(idx, effectiveRangeIdx.start)));
      }
    },
    [dayKeys.length, maxRangeIdx, effectiveRangeIdx.start, effectiveRangeIdx.end],
  );

  useEffect(() => {
    if (!draggingRangeThumb) return;
    const onMove = (ev: PointerEvent) => {
      updateRangeThumbAtClientX(draggingRangeThumb, ev.clientX);
    };
    const onUp = () => setDraggingRangeThumb(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [draggingRangeThumb, updateRangeThumbAtClientX]);

  const ayerTargetYmd = useMemo(() => {
    if (dayKeys.length === 0) return null;
    const yesterday = shiftYmd(formatYmdLocal(), -1);
    if (dayKeys.includes(yesterday)) return yesterday;
    const today = formatYmdLocal();
    if (dayKeys.length >= 2 && dayKeys[dayKeys.length - 1] === today) {
      return dayKeys[dayKeys.length - 2];
    }
    return null;
  }, [dayKeys]);

  const applyRangeAyer = useCallback(() => {
    if (!ayerTargetYmd) return;
    const idx = dayKeys.indexOf(ayerTargetYmd);
    if (idx < 0) return;
    setRangeStartIdx(idx);
    setRangeEndIdx(idx);
  }, [dayKeys, ayerTargetYmd]);

  const applyRangeEsteAno = useCallback(() => {
    if (dayKeys.length === 0) return;
    const year = new Date().getFullYear();
    const yearStart = `${year}-01-01`;
    const firstIdx = dayKeys.findIndex((d) => d >= yearStart);
    setRangeStartIdx(firstIdx >= 0 ? firstIdx : 0);
    setRangeEndIdx(dayKeys.length - 1);
  }, [dayKeys]);

  const rangeQuickPreset = useMemo((): 'ayer' | 'este_ano' | null => {
    if (dayKeys.length === 0) return null;
    const { start, end } = effectiveRangeIdx;
    if (ayerTargetYmd && start === end && dayKeys[start] === ayerTargetYmd) return 'ayer';
    const year = new Date().getFullYear();
    const yearStart = `${year}-01-01`;
    const firstYearIdx = dayKeys.findIndex((d) => d >= yearStart);
    const expectedFirst = firstYearIdx >= 0 ? firstYearIdx : 0;
    if (start === expectedFirst && end === dayKeys.length - 1) return 'este_ano';
    return null;
  }, [dayKeys, effectiveRangeIdx, ayerTargetYmd]);

  const isFullRange =
    dayKeys.length > 0 && effectiveRangeIdx.start === 0 && effectiveRangeIdx.end === dayKeys.length - 1;

  const daysInRange = useMemo(() => {
    if (dayKeys.length === 0 || !selectedRangeDates.from || !selectedRangeDates.to) return daysForTable;
    const lo = selectedRangeDates.from;
    const hi = selectedRangeDates.to;
    return daysForTable.filter((row) => {
      const d = row.date;
      if (lo && d < lo) return false;
      if (hi && d > hi) return false;
      return true;
    });
  }, [daysForTable, dayKeys, selectedRangeDates]);

  const daysInRangeAllProducts = useMemo(() => {
    if (dayKeys.length === 0 || !selectedRangeDates.from || !selectedRangeDates.to) return days;
    const lo = selectedRangeDates.from;
    const hi = selectedRangeDates.to;
    return days.filter((row) => {
      const d = row.date;
      if (lo && d < lo) return false;
      if (hi && d > hi) return false;
      return true;
    });
  }, [days, dayKeys, selectedRangeDates]);

  const productAnalysisRows = useMemo(
    () => aggregateProductAnalysis(daysInRangeAllProducts, comparable, adminPercent),
    [daysInRangeAllProducts, comparable, adminPercent],
  );

  const totals = useMemo(() => {
    let v = 0;
    let ve = 0;
    let p = 0;
    let q = 0;
    let cp = 0;
    let cpe = 0;
    let cf = 0;
    let ga = 0;
    let g = 0;
    let ganSum = 0;
    let utiDisplayedSum = 0;
    for (const row of daysInRange) {
      v += row.ventas_despachadas_total;
      ve += row.ventas_entregadas_total || row.ventas_despachadas_total || 0;
      p += row.ventas_despachadas_pedidos;
      q += row.cantidad_producto_total || 0;
      cp += row.costo_producto_total || 0;
      cpe += row.costo_producto_entregado_total || row.costo_producto_total || 0;
      cf += row.costo_flete_promedio_total || 0;
      ga += (row.ventas_entregadas_total || row.ventas_despachadas_total || 0) * (adminPercent / 100);
      g += row.gasto_publicitario_total;
      if (row.ganancia != null && Number.isFinite(row.ganancia)) ganSum += row.ganancia;
      const um = utilidadMostradaPorDia(row, comparable, adminPercent);
      if (um != null && Number.isFinite(um)) utiDisplayedSum += um;
    }
    const utilidadAgregada = comparable ? Math.round(utiDisplayedSum * 100) / 100 : null;
    return {
      ventas: v,
      ventasEntregadas: ve,
      pedidos: p,
      cantidadProducto: q,
      costoProducto: cp,
      costoProductoEntregado: cpe,
      costoFletePromedio: cf,
      gastoAdministrativo: ga,
      gasto: g,
      ganancia: comparable ? Math.round(ganSum * 100) / 100 : null,
      utilidad: utilidadAgregada,
      utilidadNeta: utilidadAgregada,
    };
  }, [daysInRange, comparable, adminPercent]);

  const prevPeriodDays = useMemo(() => {
    if (daysInRange.length === 0 || !selectedRangeDates.from) return [];
    const sorted = [...daysForTable].sort((a, b) => a.date.localeCompare(b.date));
    const fromIdx = sorted.findIndex((d) => d.date === selectedRangeDates.from);
    if (fromIdx <= 0) return [];
    const len = daysInRange.length;
    const startIdx = Math.max(0, fromIdx - len);
    return sorted.slice(startIdx, fromIdx);
  }, [daysForTable, daysInRange.length, selectedRangeDates.from]);

  const prevPeriodDaysAllProducts = useMemo(() => {
    if (daysInRange.length === 0 || !selectedRangeDates.from) return [];
    const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
    const fromIdx = sorted.findIndex((d) => d.date === selectedRangeDates.from);
    if (fromIdx <= 0) return [];
    const len = daysInRange.length;
    const startIdx = Math.max(0, fromIdx - len);
    return sorted.slice(startIdx, fromIdx);
  }, [days, daysInRange.length, selectedRangeDates.from]);

  const prevTotals = useMemo(() => {
    let v = 0;
    let ve = 0;
    let p = 0;
    let g = 0;
    let utiDisplayedSum = 0;
    for (const row of prevPeriodDays) {
      v += row.ventas_despachadas_total;
      ve += row.ventas_entregadas_total || row.ventas_despachadas_total || 0;
      p += row.ventas_despachadas_pedidos;
      g += row.gasto_publicitario_total;
      const um = utilidadMostradaPorDia(row, comparable, adminPercent);
      if (um != null && Number.isFinite(um)) utiDisplayedSum += um;
    }
    const utilidadAgregada = comparable ? Math.round(utiDisplayedSum * 100) / 100 : null;
    return {
      ventas: v,
      ventasEntregadas: ve,
      pedidos: p,
      gasto: g,
      utilidadNeta: utilidadAgregada,
    };
  }, [prevPeriodDays, comparable, adminPercent]);

  const productComplementaryDetail = useMemo(() => {
    const raw = seriesData?.product_complementary_detail;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw;
  }, [seriesData?.product_complementary_detail]);

  return (
    <GananciaDiariaDashboardView
      seriesLoading={seriesLoading}
      seriesError={seriesError}
      seriesData={seriesData}
      seriesVentasCur={seriesVentasCur}
      seriesMetaCur={seriesMetaCur}
      comparable={comparable}
      adminPercent={adminPercent}
      adminPercentInput={adminPercentInput}
      setAdminPercentInput={setAdminPercentInput}
      goalPctInput={goalPctInput}
      setGoalPctInput={setGoalPctInput}
      goalPct={goalPct}
      selectedProductId={selectedProductId}
      setSelectedProductId={setSelectedProductId}
      availableProducts={availableProducts}
      availableMonths={availableMonths}
      appliedPeriodLabel={appliedPeriodLabel}
      monthsPanelOpen={monthsPanelOpen}
      setMonthsPanelOpen={setMonthsPanelOpen}
      pendingMonths={pendingMonths}
      togglePendingMonth={togglePendingMonth}
      applyMonthFilter={applyMonthFilter}
      openMonthsPanel={openMonthsPanel}
      monthDropdownRef={monthDropdownRef}
      dayKeys={dayKeys}
      daysInRange={daysInRange}
      daysForTable={daysForTable}
      daysInRangeAllProducts={daysInRangeAllProducts}
      prevPeriodDays={prevPeriodDays}
      prevPeriodDaysAllProducts={prevPeriodDaysAllProducts}
      productAnalysisRows={productAnalysisRows}
      productComplementaryDetail={productComplementaryDetail}
      totals={totals}
      prevTotals={prevTotals}
      selectedRangeDates={selectedRangeDates}
      rangeSliderTrackRef={rangeSliderTrackRef}
      startPercent={startPercent}
      endPercent={endPercent}
      effectiveRangeIdx={effectiveRangeIdx}
      maxRangeIdx={maxRangeIdx}
      draggingRangeThumb={draggingRangeThumb}
      setDraggingRangeThumb={setDraggingRangeThumb}
      updateRangeThumbAtClientX={updateRangeThumbAtClientX}
      setRangeStartIdx={setRangeStartIdx}
      setRangeEndIdx={setRangeEndIdx}
      ayerTargetYmd={ayerTargetYmd}
      applyRangeAyer={applyRangeAyer}
      applyRangeEsteAno={applyRangeEsteAno}
      rangeQuickPreset={rangeQuickPreset}
      isFullRange={isFullRange}
      seriesMetaNote={seriesMetaNote}
      loadSeries={loadSeries}
      formatMoney={formatMoney}
      formatRoas={formatRoas}
      formatPercent={formatPercent}
      formatTableDate={formatTableDate}
      formatMonthLabel={formatMonthLabel}
      utilidadMostradaPorDia={utilidadMostradaPorDia}
    />
  );
}
