import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';
import { PageHeader } from '../design-system/PageHeader';

type DayProductSlice = {
  label: string;
  product_id: number | null;
  ventas_despachadas_total: number;
  ventas_entregadas_total: number;
  ventas_despachadas_pedidos: number;
  cantidad_producto_total: number;
  costo_producto_total: number;
  costo_producto_entregado_total: number;
  costo_flete_promedio_total: number;
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
  by_product?: Record<string, DayProductSlice>;
};

type ProductOption = { key: string; label: string; product_id: number | null };

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
  product_options?: ProductOption[];
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

function metaAllocForProductDay(row: SeriesDayRow, productKey: string): number {
  const slice = row.by_product?.[productKey];
  if (!slice) return 0;
  const veSlice = slice.ventas_entregadas_total || 0;
  const veDay = row.ventas_entregadas_total || row.ventas_despachadas_total || 0;
  if (veDay <= 0) return 0;
  return row.gasto_publicitario_total * (veSlice / veDay);
}

function barColorForProductKey(key: string, index: number): string {
  let h = index * 41;
  for (let i = 0; i < key.length; i += 1) h = (h + key.charCodeAt(i) * 17) % 360;
  return `hsl(${h}, 58%, 48%)`;
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
const tdColLeft: CSSProperties = { ...tdStyle, ...thTdColSizing, fontWeight: 500 };
const tdColRight: CSSProperties = {
  ...tdStyle,
  ...thTdColSizing,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
};

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  tableLayout: 'auto',
};

const tdStyle: CSSProperties = {
  fontSize: 13,
  color: ds.textPrimary,
  padding: '8px 4px',
  borderBottom: `1px solid ${ds.borderRow}`,
  wordBreak: 'break-word',
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
  const skipSeriesEffectOnce = useRef(false);
  const appliedDefaultMonthsOnce = useRef(false);
  const monthDropdownRef = useRef<HTMLDivElement>(null);

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
  const productOptions = seriesData?.product_options ?? [];
  const seriesVentasCur = seriesData?.ventas_currency;
  const seriesMetaCur = seriesData?.meta_currency;
  const comparable = seriesData?.ganancia_comparable;
  const adminPercent = useMemo(() => parsePercentInput(adminPercentInput), [adminPercentInput]);

  const productColorMap = useMemo(() => {
    const m = new Map<string, string>();
    productOptions.forEach((o, i) => m.set(o.key, barColorForProductKey(o.key, i)));
    return m;
  }, [productOptions]);

  const productUtilidadChart = useMemo(() => {
    if (!comparable || !days.length || !productOptions.length) return [];
    const rows: { key: string; label: string; utilidad: number }[] = [];
    for (const opt of productOptions) {
      let u = 0;
      for (const row of days) {
        const slice = row.by_product?.[opt.key];
        if (!slice) continue;
        const ve = slice.ventas_entregadas_total || 0;
        const metaP = metaAllocForProductDay(row, opt.key);
        const cpe = slice.costo_producto_entregado_total || slice.costo_producto_total || 0;
        const fl = slice.costo_flete_promedio_total || 0;
        u += ve - metaP - cpe - fl - ve * (adminPercent / 100);
      }
      rows.push({ key: opt.key, label: opt.label, utilidad: Math.round(u * 100) / 100 });
    }
    return rows.sort((a, b) => b.utilidad - a.utilidad);
  }, [days, productOptions, comparable, adminPercent]);

  const chartMaxAbs = useMemo(() => {
    let m = 1;
    for (const r of productUtilidadChart) m = Math.max(m, Math.abs(r.utilidad));
    return m;
  }, [productUtilidadChart]);

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
    for (const row of days) {
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
  }, [days, comparable, adminPercent]);

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
            . Los KPI se calculan con el/los mes(es) seleccionados.
          </p>

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

          {!seriesLoading && comparable && productUtilidadChart.length > 0 ? (
            <div style={{ ...cardBase, marginBottom: 16, border: `1px solid ${ds.borderCard}` }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: ds.textPrimary, marginBottom: 6 }}>
                Utilidad por producto (período)
              </div>
              <p style={{ margin: '0 0 14px', fontSize: 11, color: ds.textMuted, lineHeight: 1.45 }}>
                Reparto por líneas de pedido despachados; Meta del día se asigna a cada producto según su participación
                en ventas entregadas ese día. Misma lógica que la tabla y el % administrativo aplicado.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {productUtilidadChart.map((r) => {
                  const w = chartMaxAbs > 0 ? (Math.abs(r.utilidad) / chartMaxAbs) * 100 : 0;
                  const col = productColorMap.get(r.key) || '#6c47ff';
                  return (
                    <div
                      key={r.key}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(120px, 1fr) minmax(80px, 3fr) auto',
                        alignItems: 'center',
                        gap: 12,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          color: ds.textSecondary,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={r.label}
                      >
                        {r.label}
                      </div>
                      <div
                        style={{
                          height: 24,
                          background: ds.bgSubtle,
                          borderRadius: 8,
                          overflow: 'hidden',
                          border: `1px solid ${ds.borderRow}`,
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${w}%`,
                            minWidth: r.utilidad !== 0 ? 4 : 0,
                            background: col,
                            borderRadius: 8,
                            opacity: r.utilidad < 0 ? 0.75 : 1,
                            boxShadow: r.utilidad < 0 ? 'inset 0 0 0 1px rgba(220,38,38,0.35)' : undefined,
                          }}
                        />
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          fontVariantNumeric: 'tabular-nums',
                          color: r.utilidad < 0 ? ds.dangerText : ds.textPrimary,
                          textAlign: 'right',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {formatMoney(r.utilidad, seriesVentasCur)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
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
            ) : days.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: ds.textMuted, fontSize: 14 }}>
                No hay días en el rango seleccionado.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={tableStyle}>
                  <thead>
                    <tr style={{ background: '#6c47ff' }}>
                      <th style={thColHeadLeft}>Día</th>
                      <th style={thColHeadRight}>
                        Ventas
                        <br />
                        despachadas
                      </th>
                      <th style={thColHeadRight}>
                        Ventas
                        <br />
                        entregadas
                      </th>
                      <th style={thColHeadRight}>Pedidos</th>
                      <th style={thColHeadRight}>
                        Cantidad
                        <br />
                        producto
                      </th>
                      <th style={thColHeadRight}>
                        Gasto
                        <br />
                        administrativo
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
                    {days.map((row) => {
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
                        <td style={tdColRight}>
                          {formatMoney(row.ventas_despachadas_total, seriesVentasCur)}
                        </td>
                        <td style={tdColRight}>
                          {formatMoney(ventasEntregadasRow, seriesVentasCur)}
                        </td>
                        <td style={tdColRight}>
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
                      <td style={{ ...tdColRight, fontWeight: 700 }}>
                        {formatMoney(totals.ventas, seriesVentasCur)}
                      </td>
                      <td style={{ ...tdColRight, fontWeight: 700 }}>
                        {formatMoney(totals.ventasEntregadas, seriesVentasCur)}
                      </td>
                      <td style={{ ...tdColRight, fontWeight: 700 }}>
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
