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

const cardBase: CSSProperties = {
  background: ds.bgCard,
  borderRadius: 14,
  padding: '20px 22px',
  border: `1px solid ${ds.borderCard}`,
};

const thStyle: CSSProperties = {
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 700,
  color: ds.textMuted,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  padding: '10px 12px',
  borderBottom: `1px solid ${ds.borderRow}`,
  whiteSpace: 'nowrap',
};

const tdStyle: CSSProperties = {
  fontSize: 14,
  color: ds.textPrimary,
  padding: '10px 12px',
  borderBottom: `1px solid ${ds.borderRow}`,
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
  const seriesVentasCur = seriesData?.ventas_currency;
  const seriesMetaCur = seriesData?.meta_currency;
  const comparable = seriesData?.ganancia_comparable;
  const adminPercent = useMemo(() => parsePercentInput(adminPercentInput), [adminPercentInput]);

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
    let utiSum = 0;
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
      if (row.utilidad != null && Number.isFinite(row.utilidad)) utiSum += row.utilidad;
    }
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
      utilidad: comparable ? Math.round(utiSum * 100) / 100 : null,
      utilidadNeta:
        comparable
          ? Math.round((ve - g - cpe - cf - ga) * 100) / 100
          : null,
    };
  }, [days, comparable, adminPercent]);

  return (
    <div style={{ width: '100%', maxWidth: 1440 }}>
      <PageHeader
        title="Ganancia Diaria"
        subtitle="Ventas despachadas (Shopify + estado KOVO), ventas entregadas (según % de efectividad), gasto Meta, costo del producto y costo de flete promedio. Solo desde el 1 de enero del año en curso hasta hoy (calendario de la tienda)."
      />

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
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
              gap: 14,
              marginBottom: 24,
            }}
          >
            <div style={cardBase}>
              <div style={{ fontSize: 11, fontWeight: 600, color: ds.textMuted, marginBottom: 8 }}>
                Ventas despachadas
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: ds.textPrimary }}>
                {formatMoney(totals.ventas || 0, seriesVentasCur)}
              </div>
              <div style={{ fontSize: 12, color: ds.textHint, marginTop: 6 }}>
                {totals.pedidos ?? 0} pedidos
              </div>
            </div>
            <div style={cardBase}>
              <div style={{ fontSize: 11, fontWeight: 600, color: ds.textMuted, marginBottom: 8 }}>
                Gasto publicitario (Meta)
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: ds.textPrimary }}>
                {formatMoney(totals.gasto || 0, seriesMetaCur || seriesVentasCur)}
              </div>
              <div style={{ fontSize: 12, color: ds.textHint, marginTop: 6 }}>
                Cuentas vinculadas · {seriesData?.meta_currency || '—'}
              </div>
            </div>
            <div style={cardBase}>
              <div style={{ fontSize: 11, fontWeight: 600, color: ds.textMuted, marginBottom: 8 }}>
                Costo del producto
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: ds.textPrimary }}>
                {formatMoney(totals.costoProducto || 0, seriesVentasCur)}
              </div>
              <div style={{ fontSize: 12, color: ds.textHint, marginTop: 6 }}>
                Basado en costo manual por producto en Inventario
              </div>
            </div>
            <div style={cardBase}>
              <div style={{ fontSize: 11, fontWeight: 600, color: ds.textMuted, marginBottom: 8 }}>
                Costo flete promedio
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: ds.textPrimary }}>
                {formatMoney(totals.costoFletePromedio || 0, seriesVentasCur)}
              </div>
              <div style={{ fontSize: 12, color: ds.textHint, marginTop: 6 }}>
                Basado en flete promedio manual por producto
              </div>
            </div>
            <div style={{ ...cardBase, borderColor: ds.brand, background: ds.brandBg }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: ds.brand, marginBottom: 8 }}>Utilidad</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: ds.textPrimary }}>
                {totals.utilidadNeta != null && Number.isFinite(totals.utilidadNeta)
                  ? formatMoney(totals.utilidadNeta, seriesVentasCur)
                  : '—'}
              </div>
              <div style={{ fontSize: 12, color: ds.textSecondary, marginTop: 6 }}>
                Ventas entregadas − gasto Meta − costo producto entregado − flete promedio − gasto administrativo
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

          <div
            style={{
              ...cardBase,
              padding: 0,
              overflow: 'hidden',
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
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: ds.bgSubtle }}>
                      <th style={thStyle}>Día</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Ventas desp.</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Ventas entreg.</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Pedidos</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Cantidad producto</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Gasto administrativo</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Costo producto</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Costo prod. entreg.</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Flete prom.</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Gasto Meta</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Utilidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((row) => {
                      const ventasEntregadasRow = row.ventas_entregadas_total || row.ventas_despachadas_total || 0;
                      const costoProductoEntregadoRow =
                        row.costo_producto_entregado_total || row.costo_producto_total || 0;
                      const utilidadRow =
                        comparable && Number.isFinite(row.utilidad as number)
                          ? (row.utilidad as number) - ventasEntregadasRow * (adminPercent / 100)
                          : null;
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
                          <td style={{ ...tdStyle, fontWeight: 500 }}>{formatTableDate(row.date)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {formatMoney(row.ventas_despachadas_total, seriesVentasCur)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {formatMoney(ventasEntregadasRow, seriesVentasCur)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {row.ventas_despachadas_pedidos}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {Number(row.cantidad_producto_total || 0).toLocaleString('es-CO')}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {formatMoney(ventasEntregadasRow * (adminPercent / 100), seriesVentasCur)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {formatMoney(row.costo_producto_total || 0, seriesVentasCur)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {formatMoney(costoProductoEntregadoRow, seriesVentasCur)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {formatMoney(row.costo_flete_promedio_total || 0, seriesVentasCur)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {formatMoney(row.gasto_publicitario_total, seriesMetaCur || seriesVentasCur)}
                        </td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
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
                      <td style={{ ...tdStyle, fontWeight: 700 }}>Total período</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {formatMoney(totals.ventas, seriesVentasCur)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {formatMoney(totals.ventasEntregadas, seriesVentasCur)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {totals.pedidos}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {Number(totals.cantidadProducto || 0).toLocaleString('es-CO')}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {formatMoney(totals.gastoAdministrativo, seriesVentasCur)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {formatMoney(totals.costoProducto, seriesVentasCur)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {formatMoney(totals.costoProductoEntregado, seriesVentasCur)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {formatMoney(totals.costoFletePromedio, seriesVentasCur)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {formatMoney(totals.gasto, seriesMetaCur || seriesVentasCur)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
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
