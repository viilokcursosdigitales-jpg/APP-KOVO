import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';
import { PageHeader } from '../design-system/PageHeader';

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
  days?: SeriesDayRow[];
  error?: string;
  code?: string;
};

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

const cardBase: CSSProperties = {
  background: ds.bgCard,
  borderRadius: 14,
  padding: '20px 22px',
  border: `1px solid ${ds.borderCard}`,
};

const thStyle: CSSProperties = {
  textAlign: 'left',
  fontSize: 10,
  fontWeight: 700,
  color: '#ffffff',
  backgroundColor: '#6c47ff',
  textTransform: 'uppercase',
  letterSpacing: '0.02em',
  lineHeight: 1.2,
  padding: '8px 4px',
  borderBottom: '1px solid rgba(255,255,255,0.12)',
  whiteSpace: 'normal',
  verticalAlign: 'bottom',
  wordBreak: 'break-word',
  hyphens: 'auto',
};

const thRight: CSSProperties = { ...thStyle, textAlign: 'right' };

/** Columna al ancho del texto más largo + 20px izq. y 20px der. */
const thTdColSizing: CSSProperties = {
  width: '1%',
  whiteSpace: 'nowrap',
  paddingTop: 8,
  paddingBottom: 8,
  paddingLeft: 20,
  paddingRight: 20,
  boxSizing: 'border-box',
  wordBreak: 'normal',
  hyphens: 'manual',
};

const thColLeft: CSSProperties = { ...thStyle, ...thTdColSizing };
const thColRight: CSSProperties = { ...thRight, ...thTdColSizing };

/** Encabezados: texto completo o varias líneas; sin nowrap para poder partir palabras con <br />. */
const thHeadPad: CSSProperties = {
  paddingTop: 8,
  paddingBottom: 8,
  paddingLeft: 20,
  paddingRight: 20,
  boxSizing: 'border-box',
  width: '1%',
  minWidth: 0,
  whiteSpace: 'normal',
  wordBreak: 'break-word',
  lineHeight: 1.25,
  hyphens: 'auto',
  verticalAlign: 'bottom',
};

const thColHeadLeft: CSSProperties = { ...thStyle, ...thHeadPad };
const thColHeadRight: CSSProperties = { ...thRight, ...thHeadPad };

/** Pedidos: ancho al texto del encabezado + 20px izq. y der. */
const thColHeadPedidos: CSSProperties = {
  ...thRight,
  paddingTop: 8,
  paddingBottom: 8,
  paddingLeft: 20,
  paddingRight: 20,
  boxSizing: 'border-box',
  whiteSpace: 'nowrap',
  width: '1%',
  verticalAlign: 'bottom',
  lineHeight: 1.25,
  wordBreak: 'normal',
  hyphens: 'manual',
};

/** Ventas despachadas: ancho al texto más largo (encabezado o celdas) + 20px lateral. */
const thColHeadVentasDespachadas: CSSProperties = {
  ...thRight,
  paddingTop: 8,
  paddingBottom: 8,
  paddingLeft: 20,
  paddingRight: 20,
  boxSizing: 'border-box',
  width: '1%',
  verticalAlign: 'bottom',
  lineHeight: 1.25,
  whiteSpace: 'normal',
  wordBreak: 'normal',
  hyphens: 'manual',
};

/** Cantidad / producto: ancho = palabra más larga del encabezado + 20px lateral. */
const thColHeadCantidad: CSSProperties = {
  ...thRight,
  paddingTop: 8,
  paddingBottom: 8,
  paddingLeft: 20,
  paddingRight: 20,
  boxSizing: 'border-box',
  width: '1%',
  verticalAlign: 'bottom',
  lineHeight: 1.25,
  whiteSpace: 'normal',
  wordBreak: 'normal',
  hyphens: 'manual',
};

const tdStyle: CSSProperties = {
  fontSize: 13,
  color: ds.textPrimary,
  padding: '8px 4px',
  borderBottom: `1px solid ${ds.borderRow}`,
  wordBreak: 'break-word',
};

const tdColLeft: CSSProperties = { ...tdStyle, ...thTdColSizing, fontWeight: 500 };
const tdColRight: CSSProperties = {
  ...tdStyle,
  ...thTdColSizing,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
};

const tdColVentasDespachadas: CSSProperties = { ...tdColRight };

const tdColPedidos: CSSProperties = {
  ...tdStyle,
  paddingTop: 8,
  paddingBottom: 8,
  paddingLeft: 20,
  paddingRight: 20,
  boxSizing: 'border-box',
  textAlign: 'right',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
  fontWeight: 500,
  width: '1%',
  wordBreak: 'normal',
  hyphens: 'manual',
};

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  tableLayout: 'auto',
};

export default function GananciaDiariaPage() {
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const [seriesLoading, setSeriesLoading] = useState(true);
  const [seriesError, setSeriesError] = useState('');
  const [seriesData, setSeriesData] = useState<SeriesPayload | null>(null);
  const [monthOptions, setMonthOptions] = useState<string[]>([]);
  const [monthsPanelOpen, setMonthsPanelOpen] = useState(false);
  const [pendingMonths, setPendingMonths] = useState<string[]>([]);
  const [adminPercentInput, setAdminPercentInput] = useState(() => {
    try {
      return localStorage.getItem('kovo_ganancia_admin_percent') || '0';
    } catch {
      return '0';
    }
  });
  const [rangeStartIdx, setRangeStartIdx] = useState(0);
  const [rangeEndIdx, setRangeEndIdx] = useState(0);
  const [draggingRangeThumb, setDraggingRangeThumb] = useState<'start' | 'end' | null>(null);
  const skipSeriesEffectOnce = useRef(false);
  const appliedDefaultMonthsOnce = useRef(false);
  const monthDropdownRef = useRef<HTMLDivElement>(null);
  const rangeSliderTrackRef = useRef<HTMLDivElement>(null);

  const loadSeries = useCallback(async () => {
    setSeriesLoading(true);
    setSeriesError('');
    try {
      const useServerDefault = !appliedDefaultMonthsOnce.current && selectedMonths.length === 0;
      const qs = new URLSearchParams();
      if (!useServerDefault && selectedMonths.length > 0) {
        qs.set('months', selectedMonths.join(','));
      }
      const suffix = qs.toString() ? `?${qs}` : '';
      const res = await apiFetch(`/api/ganancia-diaria/series${suffix}`);
      const body = (await res.json().catch(() => ({}))) as SeriesPayload;
      if (!res.ok) {
        setSeriesData(null);
        setSeriesError(typeof body.error === 'string' ? body.error : 'No se pudo cargar la tabla');
        return;
      }
      setSeriesData(body);
      if (body.available_months?.length) setMonthOptions(body.available_months);
      if (!appliedDefaultMonthsOnce.current && selectedMonths.length === 0 && body.months_applied?.length) {
        appliedDefaultMonthsOnce.current = true;
        skipSeriesEffectOnce.current = true;
        setSelectedMonths(body.months_applied);
      }
    } catch {
      setSeriesData(null);
      setSeriesError('Error de red');
    } finally {
      setSeriesLoading(false);
    }
  }, [selectedMonths]);

  useEffect(() => {
    if (skipSeriesEffectOnce.current) {
      skipSeriesEffectOnce.current = false;
      return;
    }
    void loadSeries();
  }, [selectedMonths, loadSeries]);

  useEffect(() => {
    try {
      localStorage.setItem('kovo_ganancia_admin_percent', adminPercentInput);
    } catch {
      /* noop */
    }
  }, [adminPercentInput]);

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

  const availableMonths = monthOptions.length > 0 ? monthOptions : seriesData?.available_months ?? [];

  const openMonthsPanel = () => {
    setPendingMonths(selectedMonths.length > 0 ? [...selectedMonths] : [...(seriesData?.months_applied ?? [])]);
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
  const dayKeys = useMemo(() => {
    const s = new Set<string>();
    for (const row of days) s.add(String(row.date || '').trim());
    return [...s].filter(Boolean).sort();
  }, [days]);

  useEffect(() => {
    if (dayKeys.length === 0) {
      setRangeStartIdx(0);
      setRangeEndIdx(0);
      return;
    }
    const last = dayKeys.length - 1;
    setRangeStartIdx((prev) => Math.max(0, Math.min(prev, last)));
    setRangeEndIdx((prev) => Math.max(0, Math.min(prev, last)));
  }, [dayKeys]);

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

  const daysInRange = useMemo(() => {
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

  const utilidadKpiValue =
    totals.utilidadNeta != null && Number.isFinite(totals.utilidadNeta) ? totals.utilidadNeta : null;
  const utilidadKpiStyle: CSSProperties = {
    ...cardBase,
    borderColor: utilidadKpiValue == null ? ds.borderCard : utilidadKpiValue < 0 ? ds.dangerText : ds.successText,
    background: utilidadKpiValue == null ? ds.bgCard : utilidadKpiValue < 0 ? ds.dangerBg : ds.successBg,
  };
  const utilidadKpiLabelColor = utilidadKpiValue == null ? ds.textMuted : utilidadKpiValue < 0 ? ds.dangerText : ds.successText;

  return (
    <div style={{ width: '100%', maxWidth: 1440 }}>
      <PageHeader title="GANANCIA DIARIA ESTIMADA" />

      {!seriesError ? (
        <>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: ds.textMuted }}>
            Periodo aplicado:{' '}
            <strong style={{ color: ds.textSecondary }}>
              {(seriesData?.months_applied || selectedMonths).length
                ? (seriesData?.months_applied || selectedMonths).map(formatMonthLabel).join(', ')
                : 'Mes actual'}
            </strong>
            {seriesData?.shop_calendar_timezone ? (
              <>
                {' '}
                · Zona tienda: <code style={{ fontSize: 11 }}>{seriesData.shop_calendar_timezone}</code>
              </>
            ) : null}
            . Los KPI y la tabla usan el/los mes(es) seleccionados; el rango de fechas acota los días mostrados.
          </p>
          {dayKeys.length > 0 && daysInRange.length !== days.length ? (
            <p style={{ margin: '0 0 12px', fontSize: 12, color: ds.textHint }}>
              Mostrando {daysInRange.length} de {days.length} día{days.length === 1 ? '' : 's'} según el rango de fechas.
            </p>
          ) : null}

          <div
            style={{
              display: 'flex',
              marginBottom: 24,
            }}
          >
            <div style={{ ...utilidadKpiStyle, width: '100%', maxWidth: 420 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: utilidadKpiLabelColor, marginBottom: 8 }}>Utilidad</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: ds.textPrimary }}>
                {totals.utilidadNeta != null && Number.isFinite(totals.utilidadNeta)
                  ? formatMoney(totals.utilidadNeta, seriesVentasCur)
                  : '—'}
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: ds.textPrimary, flex: '1 1 auto' }}>
              Detalle por día
            </h2>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                color: ds.textSecondary,
                fontWeight: 600,
              }}
            >
              % gasto administrativo
              <input
                type="text"
                inputMode="decimal"
                value={adminPercentInput}
                onChange={(e) => setAdminPercentInput(e.target.value)}
                placeholder="0"
                style={{
                  width: 96,
                  padding: '7px 9px',
                  borderRadius: 8,
                  border: `1px solid ${ds.borderCard}`,
                  background: ds.bgCard,
                  color: ds.textPrimary,
                  fontSize: 12,
                }}
              />
            </label>
            <div
              style={{
                display: 'inline-flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 8,
                fontSize: 12,
                color: ds.textSecondary,
                fontWeight: 600,
                minWidth: 280,
              }}
            >
              <span>Rango (deslizador)</span>
              <div
                style={{
                  width: '100%',
                  border: `1px solid ${ds.borderCard}`,
                  borderRadius: 10,
                  background: ds.bgCard,
                  padding: '8px 10px',
                  boxSizing: 'border-box',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: ds.textHint }}>
                  <span>{selectedRangeDates.from ? formatTableDate(selectedRangeDates.from) : '—'}</span>
                  <span>{selectedRangeDates.to ? formatTableDate(selectedRangeDates.to) : '—'}</span>
                </div>
                <div
                  ref={rangeSliderTrackRef}
                  style={{
                    marginTop: 8,
                    position: 'relative',
                    height: 30,
                    userSelect: 'none',
                    touchAction: 'none',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: '50%',
                      height: 6,
                      transform: 'translateY(-50%)',
                      borderRadius: 999,
                      background: ds.bgSubtle,
                      border: `1px solid ${ds.borderCard}`,
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      left: `${startPercent}%`,
                      width: `${Math.max(0, endPercent - startPercent)}%`,
                      top: '50%',
                      height: 6,
                      transform: 'translateY(-50%)',
                      borderRadius: 999,
                      background: '#6c47ff',
                    }}
                  />
                  {(['start', 'end'] as const).map((thumb) => {
                    const isStart = thumb === 'start';
                    const x = isStart ? startPercent : endPercent;
                    return (
                      <button
                        key={thumb}
                        type="button"
                        aria-label={isStart ? 'Inicio del rango de fechas' : 'Fin del rango de fechas'}
                        disabled={dayKeys.length <= 1}
                        onPointerDown={(e) => {
                          if (dayKeys.length <= 1) return;
                          e.preventDefault();
                          setDraggingRangeThumb(thumb);
                          updateRangeThumbAtClientX(thumb, e.clientX);
                        }}
                        onKeyDown={(e) => {
                          if (dayKeys.length <= 1) return;
                          const delta = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
                          if (!delta) return;
                          e.preventDefault();
                          if (isStart) {
                            setRangeStartIdx((prev) => Math.max(0, Math.min(prev + delta, effectiveRangeIdx.end)));
                          } else {
                            setRangeEndIdx((prev) => Math.min(maxRangeIdx, Math.max(prev + delta, effectiveRangeIdx.start)));
                          }
                        }}
                        style={{
                          position: 'absolute',
                          left: `calc(${x}% - 8px)`,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          width: 16,
                          height: 16,
                          borderRadius: '50%',
                          border: '2px solid #6c47ff',
                          background: '#fff',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.22)',
                          cursor: dayKeys.length <= 1 ? 'not-allowed' : 'grab',
                          padding: 0,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
              <button
                type="button"
                disabled={dayKeys.length === 0 || (effectiveRangeIdx.start === 0 && effectiveRangeIdx.end === dayKeys.length - 1)}
                onClick={() => {
                  if (dayKeys.length === 0) return;
                  setRangeStartIdx(0);
                  setRangeEndIdx(dayKeys.length - 1);
                }}
                style={{
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: `1px solid ${ds.borderCard}`,
                  background: ds.bgSubtle,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor:
                    dayKeys.length === 0 || (effectiveRangeIdx.start === 0 && effectiveRangeIdx.end === dayKeys.length - 1)
                      ? 'not-allowed'
                      : 'pointer',
                  opacity:
                    dayKeys.length === 0 || (effectiveRangeIdx.start === 0 && effectiveRangeIdx.end === dayKeys.length - 1)
                      ? 0.5
                      : 1,
                }}
              >
                Quitar rango
              </button>
            </div>
            <div ref={monthDropdownRef} style={{ position: 'relative' }}>
              <button
                type="button"
                disabled={!availableMonths.length}
                onClick={() => (monthsPanelOpen ? setMonthsPanelOpen(false) : openMonthsPanel())}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: `1px solid ${ds.borderCard}`,
                  background: ds.bgCard,
                  color: ds.textPrimary,
                  fontSize: 13,
                  cursor: !availableMonths.length ? 'not-allowed' : 'pointer',
                  minWidth: 200,
                  maxWidth: 'min(92vw, 580px)',
                  textAlign: 'left',
                  opacity: !availableMonths.length ? 0.55 : 1,
                }}
              >
                Meses:{' '}
                {selectedMonths.length > 0
                  ? selectedMonths.map(formatMonthLabel).join(', ')
                  : seriesData?.months_applied?.map(formatMonthLabel).join(', ') || '…'}
                <span style={{ float: 'right', opacity: 0.6 }}>{monthsPanelOpen ? '▲' : '▼'}</span>
              </button>
              {monthsPanelOpen ? (
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: '100%',
                    marginTop: 6,
                    minWidth: 280,
                    maxHeight: 320,
                    overflowY: 'auto',
                    background: ds.bgCard,
                    border: `1px solid ${ds.borderCard}`,
                    borderRadius: 10,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                    zIndex: 20,
                    padding: '12px 14px',
                  }}
                >
                  <div style={{ fontSize: 12, color: ds.textMuted, marginBottom: 10 }}>
                    Selecciona uno o varios meses (calendario tienda)
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {availableMonths.map((ym) => (
                      <label
                        key={ym}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          fontSize: 14,
                          color: ds.textPrimary,
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={pendingMonths.includes(ym)}
                          onChange={() => togglePendingMonth(ym)}
                        />
                        <span style={{ textTransform: 'capitalize' }}>{formatMonthLabel(ym)}</span>
                      </label>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => setMonthsPanelOpen(false)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 8,
                        border: `1px solid ${ds.borderCard}`,
                        background: ds.bgSubtle,
                        fontSize: 13,
                        cursor: 'pointer',
                      }}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => applyMonthFilter()}
                      disabled={pendingMonths.length === 0}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 8,
                        border: 'none',
                        background: ds.brand,
                        color: '#fff',
                        fontWeight: 600,
                        fontSize: 13,
                        cursor: pendingMonths.length === 0 ? 'not-allowed' : 'pointer',
                        opacity: pendingMonths.length === 0 ? 0.5 : 1,
                      }}
                    >
                      Aplicar
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {seriesError ? (
            <p style={{ color: ds.dangerText, fontSize: 14, marginBottom: 12 }}>{seriesError}</p>
          ) : null}

          {seriesData?.warning ? (
            <p
              style={{
                margin: '0 0 12px',
                padding: '10px 12px',
                borderRadius: 10,
                background: ds.warningBg,
                color: ds.warningText,
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              {seriesData.warning}
            </p>
          ) : null}

          {seriesMetaNote ? (
            <p style={{ margin: '0 0 12px', fontSize: 12, color: ds.textHint }}>Meta (tabla): {seriesMetaNote}</p>
          ) : null}

          <div
            style={{
              ...cardBase,
              padding: 0,
              overflow: 'hidden',
              border: '1px solid #6c47ff',
            }}
          >
            {seriesLoading ? (
              <div style={{ padding: 24, textAlign: 'center', color: ds.textMuted, fontSize: 14 }}>
                Cargando tabla…
              </div>
            ) : daysInRange.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: ds.textMuted, fontSize: 14 }}>
                No hay días en el rango seleccionado.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={tableStyle}>
                  <thead>
                    <tr style={{ background: '#6c47ff' }}>
                      <th style={thColHeadLeft}>Día</th>
                      <th style={thColHeadVentasDespachadas}>
                        <span style={{ display: 'block', whiteSpace: 'nowrap' }}>Ventas</span>
                        <span style={{ display: 'block', whiteSpace: 'nowrap' }}>despachadas</span>
                      </th>
                      <th style={thColHeadRight}>
                        Ventas
                        <br />
                        entregadas
                      </th>
                      <th style={thColHeadPedidos}>Pedidos</th>
                      <th style={thColHeadCantidad}>
                        <span style={{ display: 'block', whiteSpace: 'nowrap' }}>Cantidad</span>
                        <span style={{ display: 'block', whiteSpace: 'nowrap' }}>producto</span>
                      </th>
                      <th style={thColHeadRight}>
                        Gasto
                        <br />
                        admon
                      </th>
                      <th style={thColHeadRight}>
                        Costo
                        <br />
                        producto
                      </th>
                      <th style={thColHeadRight}>
                        Costo
                        <br />
                        entregado
                      </th>
                      <th style={thColHeadRight}>
                        Flete
                        <br />
                        promedio
                      </th>
                      <th style={thColHeadRight}>
                        Gasto
                        <br />
                        Meta
                      </th>
                      <th style={thColHeadRight}>Utilidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daysInRange.map((row) => {
                      const ventasEntregadasRow = row.ventas_entregadas_total || row.ventas_despachadas_total || 0;
                      const costoProductoEntregadoRow =
                        row.costo_producto_entregado_total || row.costo_producto_total || 0;
                      const utilidadRow = utilidadMostradaPorDia(row, comparable, adminPercent);
                      const rowBg =
                        utilidadRow == null
                          ? 'transparent'
                          : utilidadRow < 0
                            ? '#fef2f2'
                            : utilidadRow > 0
                              ? '#f0fdf4'
                              : 'transparent';
                      return (
                        <tr key={row.date} style={rowBg !== 'transparent' ? { background: rowBg } : undefined}>
                          <td style={tdColLeft}>{formatTableDate(row.date)}</td>
                        <td style={tdColVentasDespachadas}>
                          {formatMoney(row.ventas_despachadas_total, seriesVentasCur)}
                        </td>
                        <td style={tdColRight}>
                          {formatMoney(ventasEntregadasRow, seriesVentasCur)}
                        </td>
                        <td style={tdColPedidos}>
                          {row.ventas_despachadas_pedidos}
                        </td>
                        <td style={tdColRight}>
                          {Number(row.cantidad_producto_total || 0).toLocaleString('es-CO')}
                        </td>
                        <td style={tdColRight}>
                          {formatMoney(ventasEntregadasRow * (adminPercent / 100), seriesVentasCur)}
                        </td>
                        <td style={tdColRight}>
                          {formatMoney(row.costo_producto_total || 0, seriesVentasCur)}
                        </td>
                        <td style={tdColRight}>
                          {formatMoney(costoProductoEntregadoRow, seriesVentasCur)}
                        </td>
                        <td style={tdColRight}>
                          {formatMoney(row.costo_flete_promedio_total || 0, seriesVentasCur)}
                        </td>
                        <td style={tdColRight}>
                          {formatMoney(row.gasto_publicitario_total, seriesMetaCur || seriesVentasCur)}
                        </td>
                        <td style={tdColRight}>
                          {utilidadRow != null && Number.isFinite(utilidadRow)
                            ? formatMoney(utilidadRow, seriesVentasCur)
                            : '—'}
                        </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: ds.bgSubtle }}>
                      <td style={{ ...tdColLeft, fontWeight: 700 }}>Total período</td>
                      <td style={{ ...tdColVentasDespachadas, fontWeight: 700 }}>
                        {formatMoney(totals.ventas, seriesVentasCur)}
                      </td>
                      <td style={{ ...tdColRight, fontWeight: 700 }}>
                        {formatMoney(totals.ventasEntregadas, seriesVentasCur)}
                      </td>
                      <td style={{ ...tdColPedidos, fontWeight: 700 }}>
                        {totals.pedidos}
                      </td>
                      <td style={{ ...tdColRight, fontWeight: 700 }}>
                        {Number(totals.cantidadProducto || 0).toLocaleString('es-CO')}
                      </td>
                      <td style={{ ...tdColRight, fontWeight: 700 }}>
                        {formatMoney(totals.gastoAdministrativo, seriesVentasCur)}
                      </td>
                      <td style={{ ...tdColRight, fontWeight: 700 }}>
                        {formatMoney(totals.costoProducto, seriesVentasCur)}
                      </td>
                      <td style={{ ...tdColRight, fontWeight: 700 }}>
                        {formatMoney(totals.costoProductoEntregado, seriesVentasCur)}
                      </td>
                      <td style={{ ...tdColRight, fontWeight: 700 }}>
                        {formatMoney(totals.costoFletePromedio, seriesVentasCur)}
                      </td>
                      <td style={{ ...tdColRight, fontWeight: 700 }}>
                        {formatMoney(totals.gasto, seriesMetaCur || seriesVentasCur)}
                      </td>
                      <td style={{ ...tdColRight, fontWeight: 700 }}>
                        {totals.utilidad != null ? formatMoney(totals.utilidad, seriesVentasCur) : '—'}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
