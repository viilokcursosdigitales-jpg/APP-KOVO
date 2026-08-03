import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Ban,
  Calendar,
  ChevronDown,
  Info,
  Megaphone,
  Package,
  RefreshCw,
  Rocket,
  Settings2,
  ShoppingCart,
  Target,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { ds } from '../../design-system/ds';
import {
  buildProductSeriesMap,
  classifyDayEstado,
  computeInsights,
  dashboardCard,
  deltaLabel,
  enrichProductRows,
  estadoBadgeStyle,
  estadoLabel,
  linePath,
  pctChange,
  type DashboardInsight,
  type EnrichedProductRow,
  type ComplementaryProductDetail,
  type ProductAnalysisRow,
  type SeriesDayRow,
} from './dashboardUiUtils';
import { productImageUrl, type ProductImageMap } from './productImages';

/* ─── Shared styles ─── */

const filterLabelStyle: CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: ds.textMuted,
  marginBottom: 6,
  letterSpacing: '0.02em',
};

const filterInputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 10,
  border: `1px solid ${ds.borderCard}`,
  background: ds.bgCard,
  color: ds.textPrimary,
  fontSize: 13,
  boxSizing: 'border-box',
  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
};

function quickRangeButtonStyle(active: boolean, disabled?: boolean): CSSProperties {
  return {
    padding: '6px 12px',
    borderRadius: 8,
    border: `1px solid ${active ? '#6366f1' : ds.borderCard}`,
    background: active ? 'rgba(99, 102, 241, 0.08)' : ds.bgCard,
    color: active ? '#6366f1' : ds.textSecondary,
    fontSize: 12,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    whiteSpace: 'nowrap',
    transition: 'all 0.15s ease',
  };
}

const thStyle: CSSProperties = {
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: ds.textMuted,
  padding: '12px 14px',
  borderBottom: `1px solid ${ds.borderRow}`,
  whiteSpace: 'nowrap',
  background: ds.bgSubtle,
};

const thRight: CSSProperties = { ...thStyle, textAlign: 'right' };

const tdStyle: CSSProperties = {
  fontSize: 13,
  color: ds.textPrimary,
  padding: '14px',
  borderBottom: `1px solid ${ds.borderRow}`,
  verticalAlign: 'middle',
};

const tdRight: CSSProperties = { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

/* Detalle diario — tabla compacta con columnas fijas */
const DAILY_TABLE_MAX_HEIGHT = 380;
const DAILY_STICKY_SHADOW = '4px 0 12px -4px rgba(15, 23, 42, 0.12)';
const DAILY_COL_DAY_W = 122;
const DAILY_COL_PCT_UNIT_ENT_W = 132;
const DAILY_COL_GANANCIA_W = 96;
const DAILY_COL_UNIT_W = 104;
const DAILY_COL_PCT_UNIT_ENT_L = DAILY_COL_DAY_W;
const DAILY_COL_GANANCIA_L = DAILY_COL_DAY_W + DAILY_COL_PCT_UNIT_ENT_W;
const DAILY_COL_UNIT_L = DAILY_COL_GANANCIA_L + DAILY_COL_GANANCIA_W;

const dailyThBase: CSSProperties = {
  textAlign: 'left',
  fontSize: 10,
  fontWeight: 600,
  color: ds.textMuted,
  padding: '7px 10px',
  borderBottom: `1px solid ${ds.borderRow}`,
  whiteSpace: 'nowrap',
  background: ds.bgSubtle,
};

const dailyThRight: CSSProperties = { ...dailyThBase, textAlign: 'right' };

const dailyTdBase: CSSProperties = {
  fontSize: 12,
  color: ds.textPrimary,
  padding: '7px 10px',
  borderBottom: `1px solid ${ds.borderRow}`,
  verticalAlign: 'middle',
};

const dailyTdRight: CSSProperties = { ...dailyTdBase, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

function dailyStickyTh(
  left: number,
  width: number,
  zIndex: number,
  base: CSSProperties,
  lastSticky: boolean,
): CSSProperties {
  return {
    ...base,
    position: 'sticky',
    top: 0,
    left,
    zIndex,
    minWidth: width,
    width,
    maxWidth: width,
    boxShadow: lastSticky ? `${DAILY_STICKY_SHADOW}, 0 1px 0 ${ds.borderRow}` : `0 1px 0 ${ds.borderRow}`,
  };
}

function dailyStickyTd(
  left: number,
  width: number,
  zIndex: number,
  base: CSSProperties,
  bg: string,
  lastSticky: boolean,
): CSSProperties {
  return {
    ...base,
    position: 'sticky',
    left,
    zIndex,
    minWidth: width,
    width,
    maxWidth: width,
    background: bg,
    boxShadow: lastSticky ? DAILY_STICKY_SHADOW : undefined,
  };
}

function dailyThTop(base: CSSProperties): CSSProperties {
  return {
    ...base,
    position: 'sticky',
    top: 0,
    zIndex: 3,
    background: ds.bgSubtle,
    boxShadow: `0 1px 0 ${ds.borderRow}`,
  };
}

function setDailyRowHover(tr: HTMLTableRowElement, hover: boolean) {
  const bg = hover ? ds.bgSubtle : ds.bgCard;
  tr.style.background = bg;
  tr.querySelectorAll('td').forEach((cell) => {
    (cell as HTMLTableCellElement).style.background = bg;
  });
}

/* ─── Sub-components ─── */

function Sparkline({
  values,
  color = '#6366f1',
  width = 56,
  height = 24,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (!values.length) return <span style={{ color: ds.textMuted, fontSize: 11 }}>—</span>;
  const path = linePath(values, width, height);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path d={path} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MiniDelta({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value == null || !Number.isFinite(value)) return null;
  const positive = invert ? value <= 0 : value >= 0;
  const Icon = value >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        fontSize: 11,
        fontWeight: 600,
        color: positive ? '#059669' : '#dc2626',
      }}
    >
      <Icon size={12} />
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function EstadoBadge({ estado }: { estado: EnrichedProductRow['estado'] }) {
  return (
    <span
      style={{
        ...estadoBadgeStyle(estado),
        display: 'inline-flex',
        alignItems: 'center',
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {estadoLabel(estado)}
    </span>
  );
}

function formatChartDayLabel(iso: string): string {
  const p = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!p) return iso;
  return `${parseInt(p[3], 10)}/${parseInt(p[2], 10)}`;
}

function DailyUtilidadBarChart({
  days,
  utilidadForDay,
  fmt,
  formatTableDate,
}: {
  days: SeriesDayRow[];
  utilidadForDay: (row: SeriesDayRow) => number | null;
  fmt: (n: number) => string;
  formatTableDate: (iso: string) => string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateWidth = () => {
      const w = el.clientWidth;
      if (w > 0) setContainerWidth(w);
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const chartPoints = useMemo(() => {
    const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
    return sorted
      .map((row) => ({
        date: row.date,
        utilidad: utilidadForDay(row),
      }))
      .filter((d): d is { date: string; utilidad: number } => d.utilidad != null && Number.isFinite(d.utilidad));
  }, [days, utilidadForDay]);

  if (!chartPoints.length) {
    return (
      <div
        style={{
          padding: '12px 18px',
          borderBottom: `1px solid ${ds.borderRow}`,
          color: ds.textMuted,
          fontSize: 12,
        }}
      >
        Sin datos de utilidad para graficar en este rango.
      </div>
    );
  }

  const values = chartPoints.map((d) => d.utilidad);
  const maxVal = Math.max(...values, 0);
  const minVal = Math.min(...values, 0);
  const range = maxVal - minVal || Math.max(Math.abs(maxVal), Math.abs(minVal), 1);

  const chartH = 180;
  const minBarSlot = 16;
  const padL = 68;
  const padR = 12;
  const padT = 12;
  const padB = 36;
  const plotH = chartH - padT - padB;
  const minChartW = padL + padR + chartPoints.length * minBarSlot;
  const chartW = containerWidth > 0 ? Math.max(containerWidth, minChartW) : minChartW;
  const barSlot = (chartW - padL - padR) / chartPoints.length;
  const needsScroll = containerWidth > 0 && minChartW > containerWidth;

  const valueToY = (v: number) => padT + ((maxVal - v) / range) * plotH;
  const zeroY = valueToY(0);

  const yTicks = [...new Set([maxVal, minVal, ...(minVal < 0 && maxVal > 0 ? [0] : [])])].sort((a, b) => b - a);

  return (
    <div style={{ padding: '12px 18px', borderBottom: `1px solid ${ds.borderRow}` }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: ds.textSecondary, marginBottom: 8 }}>
        Utilidad neta por día
      </div>
      <div ref={containerRef} style={{ width: '100%', overflowX: needsScroll ? 'auto' : 'hidden' }}>
        <svg
          width={needsScroll ? chartW : '100%'}
          height={chartH}
          viewBox={`0 0 ${chartW} ${chartH}`}
          style={{ display: 'block', minWidth: needsScroll ? chartW : undefined }}
        >
          {yTicks.map((tick) => {
            const y = valueToY(tick);
            return (
              <g key={`tick-${tick}`}>
                <line
                  x1={padL}
                  y1={y}
                  x2={chartW - padR}
                  y2={y}
                  stroke={tick === 0 ? ds.textHint : ds.borderRow}
                  strokeWidth={tick === 0 ? 1.25 : 1}
                  strokeDasharray={tick === 0 ? undefined : '4 4'}
                />
                <text x={padL - 8} y={y + 4} fontSize={10} fill={ds.textMuted} textAnchor="end">
                  {fmt(Math.round(tick))}
                </text>
              </g>
            );
          })}

          {chartPoints.map((d, i) => {
            const v = d.utilidad;
            const barGap = Math.min(10, barSlot * 0.25);
            const barW = Math.max(4, barSlot - barGap);
            const x = padL + i * barSlot + barGap / 2;
            const yVal = valueToY(v);
            const yTop = Math.min(zeroY, yVal);
            const barH = v === 0 ? 0 : Math.max(Math.abs(yVal - zeroY), 2);
            const color = v >= 0 ? '#059669' : '#dc2626';
            return (
              <g key={d.date}>
                {barH > 0 ? (
                  <rect x={x} y={yTop} width={barW} height={barH} fill={color} rx={4} opacity={0.92}>
                    <title>{`${formatTableDate(d.date)}: ${fmt(v)}`}</title>
                  </rect>
                ) : null}
                <text x={x + barW / 2} y={chartH - 10} fontSize={9} fill={ds.textMuted} textAnchor="middle">
                  {formatChartDayLabel(d.date)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function ProductThumbnail({
  label,
  productId,
  imageUrl,
  size = 36,
}: {
  label: string;
  productId?: number | null;
  imageUrl?: string;
  size?: number;
}) {
  const letter = (label.trim()[0] || '?').toUpperCase();
  const radius = size <= 28 ? 8 : 10;
  const shared: CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    border: `1px solid ${ds.borderCard}`,
    flexShrink: 0,
  };

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={label ? `Imagen de ${label}` : 'Producto'}
        style={{ ...shared, display: 'block', objectFit: 'cover', background: ds.bgSubtle }}
      />
    );
  }

  return (
    <div
      style={{
        ...shared,
        background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(99,102,241,0.05))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size <= 28 ? 11 : 14,
        fontWeight: 700,
        color: '#6366f1',
      }}
    >
      {letter}
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  change,
  sparkValues,
  sparkColor,
  invertDelta,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  change: number | null;
  sparkValues: number[];
  sparkColor?: string;
  invertDelta?: boolean;
}) {
  return (
    <div
      style={{
        ...dashboardCard,
        padding: '18px 20px',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
        cursor: 'default',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 4px 16px rgba(15, 23, 42, 0.08)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'none';
        e.currentTarget.style.boxShadow = dashboardCard.boxShadow as string;
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: 'rgba(99, 102, 241, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#6366f1',
          }}
        >
          {icon}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: ds.textMuted }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
          <Info size={12} />
        </div>
      </div>
      <div style={{ marginTop: 14, fontSize: 26, fontWeight: 700, color: ds.textPrimary, letterSpacing: '-0.02em' }}>
        {value}
      </div>
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        {deltaLabel(change, invertDelta)}
        <Sparkline values={sparkValues} color={sparkColor} />
      </div>
    </div>
  );
}

function DecisionCard({
  tone,
  icon,
  count,
  title,
  products,
  productImageById,
}: {
  tone: 'success' | 'warning' | 'danger';
  icon: ReactNode;
  count: number;
  title: string;
  products: EnrichedProductRow[];
  productImageById: ProductImageMap;
}) {
  const colors = {
    success: { bg: 'rgba(5,150,105,0.08)', border: 'rgba(5,150,105,0.2)', fg: '#047857' },
    warning: { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)', fg: '#b45309' },
    danger: { bg: 'rgba(220,38,38,0.08)', border: 'rgba(220,38,38,0.2)', fg: '#b91c1c' },
  }[tone];

  return (
    <div
      style={{
        ...dashboardCard,
        padding: '16px 18px',
        background: colors.bg,
        borderColor: colors.border,
        flex: 1,
        minWidth: 180,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: colors.fg, marginBottom: 8 }}>
        {icon}
        <span style={{ fontSize: 13, fontWeight: 700 }}>{count} {title}</span>
      </div>
      <p style={{ margin: '0 0 10px', fontSize: 12, color: ds.textSecondary, lineHeight: 1.45 }}>
        {tone === 'success'
          ? 'Superan tu objetivo de utilidad neta.'
          : tone === 'warning'
            ? 'Cerca del objetivo; conviene optimizar.'
            : 'Utilidad negativa o por debajo del umbral.'}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {products.slice(0, 3).map((p) => (
          <ProductThumbnail
            key={p.key}
            label={p.label}
            productId={p.product_id}
            imageUrl={productImageUrl(productImageById, p.product_id)}
            size={32}
          />
        ))}
      </div>
    </div>
  );
}

function InsightCard({
  insight,
  productImageById,
}: {
  insight: DashboardInsight;
  productImageById: ProductImageMap;
}) {
  const toneBg = {
    success: 'rgba(5,150,105,0.08)',
    warning: 'rgba(245,158,11,0.08)',
    danger: 'rgba(220,38,38,0.08)',
    brand: 'rgba(99,102,241,0.08)',
    neutral: ds.bgSubtle,
  }[insight.tone];
  const imageUrl = productImageUrl(productImageById, insight.product_id);

  return (
    <div
      style={{
        ...dashboardCard,
        padding: '14px 16px',
        background: toneBg,
        transition: 'transform 0.15s ease',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: ds.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {insight.title}
      </div>
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
        <ProductThumbnail
          label={insight.subtitle}
          productId={insight.product_id}
          imageUrl={imageUrl}
          size={40}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: ds.textPrimary, lineHeight: 1.35 }}>{insight.subtitle}</div>
          <div style={{ marginTop: 4, fontSize: 13, fontWeight: 600, color: ds.textSecondary }}>{insight.value}</div>
        </div>
      </div>
    </div>
  );
}

function complementaryCantidadPct(cantidad: number, mainPedidos: number): number | null {
  if (mainPedidos <= 0) return null;
  return Math.round(((cantidad || 0) / mainPedidos) * 1000) / 10;
}

const complementaryRowBg = 'rgba(99, 102, 241, 0.04)';

function ComplementaryProductTableRow({
  comp,
  mainPedidos,
  fmt,
  productImageById,
}: {
  comp: ComplementaryProductDetail;
  mainPedidos: number;
  fmt: (n: number) => string;
  productImageById: ProductImageMap;
}) {
  const pctCantidad = complementaryCantidadPct(comp.cantidad || 0, mainPedidos);
  const costosComp = (comp.costo_producto || 0) + (comp.costo_flete || 0);
  const tdComp: CSSProperties = { ...tdStyle, background: complementaryRowBg, fontSize: 12 };
  const tdCompRight: CSSProperties = { ...tdRight, background: complementaryRowBg, fontSize: 12 };

  return (
    <tr
      style={{ background: complementaryRowBg }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(99, 102, 241, 0.08)';
        e.currentTarget.querySelectorAll('td').forEach((cell) => {
          (cell as HTMLTableCellElement).style.background = 'rgba(99, 102, 241, 0.08)';
        });
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = complementaryRowBg;
        e.currentTarget.querySelectorAll('td').forEach((cell) => {
          (cell as HTMLTableCellElement).style.background = complementaryRowBg;
        });
      }}
    >
      <td style={{ ...tdComp, width: 48, paddingLeft: 20 }}>
        <ProductThumbnail
          label={comp.label}
          productId={comp.product_id}
          imageUrl={productImageUrl(productImageById, comp.product_id)}
          size={28}
        />
      </td>
      <td style={{ ...tdComp, maxWidth: 180, paddingLeft: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ color: ds.textMuted, fontSize: 11, lineHeight: 1 }} aria-hidden>
            ↳
          </span>
          <span style={{ fontWeight: 500, color: ds.textSecondary }}>{comp.label}</span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '2px 6px',
              borderRadius: 6,
              background: 'rgba(99, 102, 241, 0.1)',
              color: '#6366f1',
              whiteSpace: 'nowrap',
            }}
          >
            Complementario
          </span>
        </div>
      </td>
      <td style={tdCompRight}>{fmt(comp.ventas_despachadas || 0)}</td>
      <td style={tdCompRight}>{fmt(comp.ventas_entregadas || 0)}</td>
      <td style={tdCompRight}>{fmt(costosComp)}</td>
      <td style={tdCompRight}>
        <div>{(comp.cantidad || 0).toLocaleString('es-CO')}</div>
        {pctCantidad != null ? (
          <div style={{ fontSize: 11, color: '#6366f1', fontWeight: 600, marginTop: 2 }}>
            {pctCantidad.toFixed(1)}% vs pedidos
          </div>
        ) : mainPedidos <= 0 ? (
          <div style={{ fontSize: 11, color: ds.textMuted, marginTop: 2 }}>—</div>
        ) : null}
      </td>
      <td style={tdCompRight}>—</td>
      <td style={tdCompRight}>—</td>
      <td style={tdCompRight}>—</td>
      <td style={tdCompRight}>—</td>
      <td style={tdCompRight}>—</td>
      <td style={tdCompRight}>—</td>
      <td style={tdComp}>—</td>
      <td style={tdComp}>—</td>
    </tr>
  );
}

/* ─── Props ─── */

export type GananciaDiariaDashboardViewProps = {
  seriesLoading: boolean;
  seriesError: string;
  seriesData: {
    warning?: string | null;
    shop_calendar_timezone?: string;
    implicit_window_days?: number | null;
  } | null;
  seriesVentasCur: string | null | undefined;
  seriesMetaCur: string | null | undefined;
  comparable: boolean | undefined;
  adminPercent: number;
  adminPercentInput: string;
  setAdminPercentInput: (v: string) => void;
  goalPctInput: string;
  setGoalPctInput: (v: string) => void;
  goalPct: number;
  selectedProductId: string;
  setSelectedProductId: (v: string) => void;
  availableProducts: { key: string; label: string; product_id: number | null }[];
  availableMonths: string[];
  appliedPeriodLabel: string;
  monthsPanelOpen: boolean;
  setMonthsPanelOpen: (v: boolean) => void;
  pendingMonths: string[];
  togglePendingMonth: (ym: string) => void;
  applyMonthFilter: () => void;
  openMonthsPanel: () => void;
  monthDropdownRef: RefObject<HTMLDivElement | null>;
  dayKeys: string[];
  daysInRange: SeriesDayRow[];
  daysForTable: SeriesDayRow[];
  daysInRangeAllProducts: SeriesDayRow[];
  prevPeriodDays: SeriesDayRow[];
  prevPeriodDaysAllProducts: SeriesDayRow[];
  productAnalysisRows: ProductAnalysisRow[];
  productComplementaryDetail: Record<string, ComplementaryProductDetail[]>;
  productImageById: ProductImageMap;
  totals: {
    ventas: number;
    ventasEntregadas: number;
    pedidos: number;
    cantidadProducto: number;
    gasto: number;
    utilidadNeta: number | null;
  };
  prevTotals: {
    ventas: number;
    ventasEntregadas: number;
    pedidos: number;
    gasto: number;
    utilidadNeta: number | null;
  };
  selectedRangeDates: { from: string; to: string };
  rangeSliderTrackRef: RefObject<HTMLDivElement | null>;
  startPercent: number;
  endPercent: number;
  effectiveRangeIdx: { start: number; end: number };
  maxRangeIdx: number;
  draggingRangeThumb: 'start' | 'end' | null;
  setDraggingRangeThumb: (v: 'start' | 'end' | null) => void;
  updateRangeThumbAtClientX: (thumb: 'start' | 'end', clientX: number) => void;
  setRangeStartIdx: (v: number | ((p: number) => number)) => void;
  setRangeEndIdx: (v: number | ((p: number) => number)) => void;
  ayerTargetYmd: string | null;
  applyRangeAyer: () => void;
  rangeQuickPreset: 'ayer' | null;
  isFullRange: boolean;
  seriesMetaNote: string | null;
  loadSeries: (options?: { force?: boolean }) => Promise<void>;
  formatMoney: (n: number, currency?: string | null) => string;
  formatRoas: (v: number | null) => string;
  formatPercent: (num: number, den: number) => string;
  formatTableDate: (iso: string) => string;
  formatMonthLabel: (ym: string) => string;
  utilidadMostradaPorDia: (
    row: SeriesDayRow,
    comparable: boolean | undefined,
    adminPercent: number,
  ) => number | null;
};

export function GananciaDiariaDashboardView(props: GananciaDiariaDashboardViewProps) {
  const {
    seriesLoading,
    seriesError,
    seriesData,
    seriesVentasCur,
    seriesMetaCur,
    comparable,
    adminPercent,
    adminPercentInput,
    setAdminPercentInput,
    goalPctInput,
    setGoalPctInput,
    goalPct,
    selectedProductId,
    setSelectedProductId,
    availableProducts,
    availableMonths,
    appliedPeriodLabel,
    monthsPanelOpen,
    setMonthsPanelOpen,
    pendingMonths,
    togglePendingMonth,
    applyMonthFilter,
    openMonthsPanel,
    monthDropdownRef,
    dayKeys,
    daysInRange,
    daysForTable,
    daysInRangeAllProducts,
    prevPeriodDays,
    prevPeriodDaysAllProducts,
    productAnalysisRows,
    productComplementaryDetail = {},
    productImageById = {},
    totals,
    prevTotals,
    selectedRangeDates,
    rangeSliderTrackRef,
    startPercent,
    endPercent,
    effectiveRangeIdx,
    maxRangeIdx,
    setDraggingRangeThumb,
    updateRangeThumbAtClientX,
    setRangeStartIdx,
    setRangeEndIdx,
    ayerTargetYmd,
    applyRangeAyer,
    rangeQuickPreset,
    isFullRange,
    seriesMetaNote,
    loadSeries,
    formatMoney,
    formatRoas,
    formatPercent,
    formatTableDate,
    formatMonthLabel,
    utilidadMostradaPorDia,
  } = props;

  const fmt = (n: number) => formatMoney(n, seriesVentasCur);

  const complementaryByProductId = useMemo(() => {
    const raw = productComplementaryDetail;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw;
  }, [productComplementaryDetail]);

  const sortedRangeDays = useMemoSortedDays(daysInRange);
  const kpiSparklines = {
    ventas: sortedRangeDays.map((d) => d.ventas_despachadas_total),
    utilidad: sortedRangeDays.map((d) => utilidadMostradaPorDia(d, comparable, adminPercent) ?? 0),
    roas: sortedRangeDays.map((d) => {
      const g = d.gasto_publicitario_total || 0;
      return g > 0 ? d.ventas_despachadas_total / g : 0;
    }),
    cpa: sortedRangeDays.map((d) => {
      const p = d.ventas_despachadas_pedidos || 0;
      const g = d.gasto_publicitario_total || 0;
      return p > 0 ? g / p : 0;
    }),
    pedidos: sortedRangeDays.map((d) => d.ventas_despachadas_pedidos),
    margen: sortedRangeDays.map((d) => {
      const u = utilidadMostradaPorDia(d, comparable, adminPercent);
      const v = d.ventas_entregadas_total || d.ventas_despachadas_total || 0;
      return u != null && v > 0 ? (u / v) * 100 : 0;
    }),
  };

  const roasPromedio = totals.gasto > 0 ? totals.ventas / totals.gasto : null;
  const prevRoasPromedio = prevTotals.gasto > 0 ? prevTotals.ventas / prevTotals.gasto : null;
  const cpaPromedio = totals.pedidos > 0 ? totals.gasto / totals.pedidos : null;
  const prevCpaPromedio = prevTotals.pedidos > 0 ? prevTotals.gasto / prevTotals.pedidos : null;
  const margenNeto =
    totals.utilidadNeta != null && totals.ventasEntregadas > 0
      ? (totals.utilidadNeta / totals.ventasEntregadas) * 100
      : null;
  const prevMargenNeto =
    prevTotals.utilidadNeta != null && prevTotals.ventasEntregadas > 0
      ? (prevTotals.utilidadNeta / prevTotals.ventasEntregadas) * 100
      : null;

  const seriesMap = buildProductSeriesMap(daysInRangeAllProducts);
  const prevSeriesMap = buildProductSeriesMap(prevPeriodDaysAllProducts);
  const prevVentasOnly = new Map([...prevSeriesMap.entries()].map(([k, v]) => [k, { ventas: v.ventas }]));
  const enrichedProducts = enrichProductRows(productAnalysisRows, seriesMap, prevVentasOnly, goalPct);
  const insights = computeInsights(enrichedProducts, fmt, formatRoas);

  const escalar = enrichedProducts.filter((p) => p.estado === 'escalar');
  const optimizar = enrichedProducts.filter((p) => p.estado === 'optimizar');
  const apagar = enrichedProducts.filter((p) => p.estado === 'apagar');

  const selectedProductLabel =
    selectedProductId && availableProducts.find((p) => String(p.product_id) === selectedProductId)?.label;

  return (
    <div style={{ width: '100%', fontFamily: ds.font }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 20,
          marginBottom: 28,
        }}
      >
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 28,
              fontWeight: 800,
              color: ds.textPrimary,
              letterSpacing: '-0.03em',
              lineHeight: 1.2,
            }}
          >
            Detalle por día y producto
          </h1>
          <p style={{ margin: '8px 0 0', fontSize: 14, color: ds.textMuted, lineHeight: 1.5, maxWidth: 520 }}>
            Monitorea el rendimiento diario de tus productos y toma mejores decisiones para escalar.
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', flex: '2 1 480px' }}>
          <div style={{ minWidth: 160, flex: '1 1 160px' }}>
            <span style={filterLabelStyle}>Producto</span>
            <div style={{ position: 'relative' }}>
              <Package size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#6366f1' }} />
              <select
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                style={{ ...filterInputStyle, paddingLeft: 32 }}
              >
                <option value="">Todos los productos</option>
                {availableProducts
                  .filter((p) => Number.isFinite(Number(p.product_id)) && Number(p.product_id)! > 0)
                  .map((p) => (
                    <option key={p.key} value={String(p.product_id)}>
                      {p.label}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div style={{ minWidth: 140, flex: '0 1 140px' }}>
            <span style={filterLabelStyle}>Período</span>
            <div ref={monthDropdownRef as RefObject<HTMLDivElement>} style={{ position: 'relative' }}>
              <button
                type="button"
                disabled={!availableMonths.length}
                onClick={() => (monthsPanelOpen ? setMonthsPanelOpen(false) : openMonthsPanel())}
                style={{
                  ...filterInputStyle,
                  textAlign: 'left',
                  cursor: !availableMonths.length ? 'not-allowed' : 'pointer',
                  opacity: !availableMonths.length ? 0.55 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {appliedPeriodLabel}
                </span>
                <ChevronDown size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
              </button>
              {monthsPanelOpen ? (
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    left: 0,
                    top: '100%',
                    marginTop: 6,
                    minWidth: 260,
                    maxHeight: 320,
                    overflowY: 'auto',
                    background: ds.bgCard,
                    border: `1px solid ${ds.borderCard}`,
                    borderRadius: 12,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                    zIndex: 30,
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
                        style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer' }}
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
                      onClick={applyMonthFilter}
                      disabled={pendingMonths.length === 0}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 8,
                        border: 'none',
                        background: '#6366f1',
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

          <div style={{ minWidth: 100, flex: '0 1 100px' }}>
            <span style={filterLabelStyle}>% Gasto administrativo</span>
            <input
              type="text"
              inputMode="decimal"
              value={adminPercentInput}
              onChange={(e) => setAdminPercentInput(e.target.value)}
              placeholder="0"
              style={filterInputStyle}
            />
          </div>

          <div style={{ minWidth: 200, flex: '1 1 220px' }}>
            <span style={filterLabelStyle}>Rango de fechas</span>
            <div
              style={{
                ...filterInputStyle,
                padding: '10px 12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: ds.textSecondary, marginBottom: 8 }}>
                <Calendar size={13} style={{ color: '#6366f1' }} />
                <span>
                  {selectedRangeDates.from ? formatTableDate(selectedRangeDates.from) : '—'} —{' '}
                  {selectedRangeDates.to ? formatTableDate(selectedRangeDates.to) : '—'}
                </span>
              </div>
              <div
                ref={rangeSliderTrackRef as RefObject<HTMLDivElement>}
                style={{ position: 'relative', height: 24, userSelect: 'none', touchAction: 'none', marginBottom: 8 }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: '50%',
                    height: 4,
                    transform: 'translateY(-50%)',
                    borderRadius: 999,
                    background: ds.bgSubtle,
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    left: `${startPercent}%`,
                    width: `${Math.max(0, endPercent - startPercent)}%`,
                    top: '50%',
                    height: 4,
                    transform: 'translateY(-50%)',
                    borderRadius: 999,
                    background: '#6366f1',
                  }}
                />
                {(['start', 'end'] as const).map((thumb) => {
                  const isStart = thumb === 'start';
                  const x = isStart ? startPercent : endPercent;
                  return (
                    <button
                      key={thumb}
                      type="button"
                      aria-label={isStart ? 'Inicio del rango' : 'Fin del rango'}
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
                        left: `calc(${x}% - 7px)`,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        border: '2px solid #6366f1',
                        background: '#fff',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                        cursor: dayKeys.length <= 1 ? 'not-allowed' : 'grab',
                        padding: 0,
                      }}
                    />
                  );
                })}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <button
                  type="button"
                  disabled={!ayerTargetYmd}
                  onClick={applyRangeAyer}
                  style={quickRangeButtonStyle(rangeQuickPreset === 'ayer', !ayerTargetYmd)}
                >
                  Ayer
                </button>
                <button
                  type="button"
                  disabled={dayKeys.length === 0 || isFullRange}
                  onClick={() => {
                    if (dayKeys.length === 0) return;
                    setRangeStartIdx(0);
                    setRangeEndIdx(dayKeys.length - 1);
                  }}
                  style={quickRangeButtonStyle(false, dayKeys.length === 0 || isFullRange)}
                >
                  Quitar rango
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={seriesLoading}
            onClick={() => void loadSeries({ force: true })}
            style={{
              padding: '9px 16px',
              borderRadius: 10,
              border: 'none',
              background: '#6366f1',
              color: '#fff',
              fontWeight: 600,
              fontSize: 13,
              cursor: seriesLoading ? 'not-allowed' : 'pointer',
              opacity: seriesLoading ? 0.65 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              alignSelf: 'flex-end',
              transition: 'opacity 0.15s ease',
            }}
          >
            <RefreshCw size={14} />
            {seriesLoading ? 'Actualizando…' : 'Actualizar informe'}
          </button>
        </div>
      </div>

      {seriesError ? (
        <div
          style={{
            ...dashboardCard,
            padding: 16,
            marginBottom: 20,
            borderColor: 'rgba(220,38,38,0.3)',
            background: 'rgba(220,38,38,0.06)',
            color: ds.dangerText,
          }}
        >
          {seriesError}
        </div>
      ) : null}

      {!seriesError ? (
        <>
          {seriesData?.warning ? (
            <div
              style={{
                ...dashboardCard,
                padding: '12px 16px',
                marginBottom: 16,
                background: ds.warningBg,
                color: ds.warningText,
                fontSize: 13,
              }}
            >
              {seriesData.warning}
            </div>
          ) : null}
          {seriesMetaNote ? (
            <p style={{ margin: '0 0 12px', fontSize: 12, color: ds.textHint }}>Meta (tabla): {seriesMetaNote}</p>
          ) : null}
          {selectedProductId ? (
            <p
              style={{
                margin: '0 0 16px',
                padding: '10px 14px',
                borderRadius: 12,
                background: ds.bgSubtle,
                color: ds.textSecondary,
                fontSize: 12,
                border: `1px solid ${ds.borderCard}`,
              }}
            >
              Producto filtrado activo: el gasto Meta del día se prorratea por la participación de ventas despachadas
              del producto en ese día.
            </p>
          ) : null}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 300px)',
              gap: 24,
              alignItems: 'start',
            }}
          >
            <div style={{ minWidth: 0 }}>
              {/* KPIs */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 16,
                  marginBottom: 24,
                }}
              >
                <KpiCard
                  icon={<ShoppingCart size={18} />}
                  label="Ventas despachadas"
                  value={fmt(totals.ventas)}
                  change={pctChange(totals.ventas, prevTotals.ventas)}
                  sparkValues={kpiSparklines.ventas}
                  sparkColor="#6366f1"
                />
                <KpiCard
                  icon={<Wallet size={18} />}
                  label="Utilidad neta"
                  value={totals.utilidadNeta != null ? fmt(totals.utilidadNeta) : '—'}
                  change={
                    totals.utilidadNeta != null && prevTotals.utilidadNeta != null
                      ? pctChange(totals.utilidadNeta, prevTotals.utilidadNeta)
                      : null
                  }
                  sparkValues={kpiSparklines.utilidad}
                  sparkColor="#059669"
                />
                <KpiCard
                  icon={<TrendingUp size={18} />}
                  label="ROAS promedio"
                  value={formatRoas(roasPromedio)}
                  change={
                    roasPromedio != null && prevRoasPromedio != null
                      ? pctChange(roasPromedio, prevRoasPromedio)
                      : null
                  }
                  sparkValues={kpiSparklines.roas}
                  sparkColor="#6366f1"
                />
                <KpiCard
                  icon={<Megaphone size={18} />}
                  label="CPA promedio"
                  value={cpaPromedio != null ? fmt(cpaPromedio) : '—'}
                  change={
                    cpaPromedio != null && prevCpaPromedio != null
                      ? pctChange(cpaPromedio, prevCpaPromedio)
                      : null
                  }
                  sparkValues={kpiSparklines.cpa}
                  sparkColor="#f59e0b"
                  invertDelta
                />
                <KpiCard
                  icon={<Package size={18} />}
                  label="Pedidos"
                  value={String(totals.pedidos)}
                  change={pctChange(totals.pedidos, prevTotals.pedidos)}
                  sparkValues={kpiSparklines.pedidos}
                  sparkColor="#6366f1"
                />
                <KpiCard
                  icon={<Target size={18} />}
                  label="Margen neto"
                  value={margenNeto != null ? `${margenNeto.toFixed(1)}%` : '—'}
                  change={
                    margenNeto != null && prevMargenNeto != null ? pctChange(margenNeto, prevMargenNeto) : null
                  }
                  sparkValues={kpiSparklines.margen}
                  sparkColor="#059669"
                />
              </div>

              {/* Decision summary */}
              <div style={{ ...dashboardCard, padding: '20px 22px', marginBottom: 24 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'stretch' }}>
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: ds.textPrimary }}>Resumen de decisiones</div>
                    <p style={{ margin: '6px 0 0', fontSize: 13, color: ds.textMuted, lineHeight: 1.5 }}>
                      En base a tu objetivo de utilidad neta del {goalPct}%.
                    </p>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, flex: '3 1 400px' }}>
                    <DecisionCard
                      tone="success"
                      icon={<Rocket size={16} />}
                      count={escalar.length}
                      title="productos para escalar"
                      products={escalar}
                      productImageById={productImageById}
                    />
                    <DecisionCard
                      tone="warning"
                      icon={<Settings2 size={16} />}
                      count={optimizar.length}
                      title="productos para optimizar"
                      products={optimizar}
                      productImageById={productImageById}
                    />
                    <DecisionCard
                      tone="danger"
                      icon={<Ban size={16} />}
                      count={apagar.length}
                      title="productos para apagar"
                      products={apagar}
                      productImageById={productImageById}
                    />
                  </div>
                  <div
                    style={{
                      ...dashboardCard,
                      padding: '16px 20px',
                      minWidth: 160,
                      textAlign: 'center',
                      alignSelf: 'stretch',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600, color: ds.textMuted }}>Objetivo de utilidad neta</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 8 }}>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={goalPctInput}
                        onChange={(e) => setGoalPctInput(e.target.value)}
                        style={{
                          width: 56,
                          textAlign: 'center',
                          fontSize: 28,
                          fontWeight: 800,
                          border: 'none',
                          background: 'transparent',
                          color: ds.textPrimary,
                          outline: 'none',
                        }}
                      />
                      <span style={{ fontSize: 28, fontWeight: 800, color: ds.textPrimary }}>%</span>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 11, color: ds.textMuted }}>Editable</div>
                  </div>
                </div>
              </div>

              {/* Product summary table */}
              {!seriesLoading && enrichedProducts.length > 0 ? (
                <div style={{ ...dashboardCard, padding: 0, overflow: 'hidden', marginBottom: 24 }}>
                  <div
                    style={{
                      padding: '18px 22px',
                      borderBottom: `1px solid ${ds.borderRow}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                    }}
                  >
                    <div>
                      <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Resumen por producto</h2>
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: ds.textMuted }}>
                        Totales del rango seleccionado · solo productos principales · ordenado por % utilidad
                      </p>
                    </div>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1280 }}>
                      <thead>
                        <tr>
                          <th style={thStyle} />
                          <th style={thStyle}>Producto</th>
                          <th style={thRight}>Ventas despachadas</th>
                          <th style={thRight}>Ventas entregadas</th>
                          <th style={thRight}>Costos y gastos</th>
                          <th style={thRight}>Pedidos</th>
                          <th style={thRight}>Gasto publicitario</th>
                          <th style={thRight}>ROAS</th>
                          <th style={thRight}>CPA</th>
                          <th style={thRight}>% utilidad neta</th>
                          <th style={thRight}>Utilidad neta</th>
                          <th style={thRight}>Utilidad unitaria</th>
                          <th style={thStyle}>Estado</th>
                          <th style={thStyle}>Acción recomendada</th>
                        </tr>
                      </thead>
                      <tbody>
                        {enrichedProducts.map((row) => {
                          const complementaries = complementaryByProductId[String(row.product_id ?? '')];
                          const hasComplementaries =
                            row.product_id != null &&
                            Array.isArray(complementaries) &&
                            complementaries.length > 0;
                          const utilidadUnitStyle: CSSProperties =
                            row.utilidadUnitaria == null
                              ? tdRight
                              : row.utilidadUnitaria < 0
                                ? { ...tdRight, color: '#dc2626', fontWeight: 700 }
                                : { ...tdRight, color: '#059669', fontWeight: 700 };
                          const costosYGastos =
                            row.costoProductoEntregado + row.gastoAdmin + row.costoFlete;
                          return (
                            <Fragment key={row.key}>
                              <tr
                                style={{ transition: 'background 0.12s ease' }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = ds.bgSubtle;
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = 'transparent';
                                }}
                              >
                                <td style={{ ...tdStyle, width: 48 }}>
                                  <ProductThumbnail
                                    label={row.label}
                                    productId={row.product_id}
                                    imageUrl={productImageUrl(productImageById, row.product_id)}
                                  />
                                </td>
                                <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 180 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    <span>{row.label}</span>
                                    {hasComplementaries ? (
                                      <span
                                        style={{
                                          fontSize: 10,
                                          fontWeight: 600,
                                          padding: '2px 6px',
                                          borderRadius: 6,
                                          background: ds.bgSubtle,
                                          color: ds.textMuted,
                                          whiteSpace: 'nowrap',
                                        }}
                                      >
                                        {complementaries.length} compl.
                                      </span>
                                    ) : null}
                                  </div>
                                </td>
                                <td style={tdRight}>
                                  <div>{fmt(row.ventasDespachadas)}</div>
                                  <MiniDelta value={row.ventasGrowthPct} />
                                  <Sparkline values={row.ventasSeries} />
                                </td>
                                <td style={tdRight}>{fmt(row.ventasTotales)}</td>
                                <td style={tdRight}>{fmt(costosYGastos)}</td>
                                <td style={tdRight}>{row.pedidos}</td>
                                <td style={tdRight}>
                                  <div>{fmt(row.gastoPublicitario)}</div>
                                  <Sparkline values={row.adsSeries} color="#f59e0b" />
                                </td>
                                <td style={tdRight}>
                                  <div>{formatRoas(row.roasDespachado)}</div>
                                  <Sparkline values={row.roasSeries} color="#6366f1" />
                                </td>
                                <td style={tdRight}>{row.cpa != null ? fmt(row.cpa) : '—'}</td>
                                <td style={tdRight}>
                                  {row.utilidadPct != null ? `${row.utilidadPct.toFixed(1)}%` : '—'}
                                </td>
                                <td style={tdRight}>
                                  {row.utilidad != null ? fmt(row.utilidad) : '—'}
                                </td>
                                <td style={utilidadUnitStyle}>
                                  {row.utilidadUnitaria != null ? fmt(row.utilidadUnitaria) : '—'}
                                </td>
                                <td style={tdStyle}>
                                  <EstadoBadge estado={row.estado} />
                                </td>
                                <td style={tdStyle}>
                                  <span
                                    style={{
                                      display: 'inline-flex',
                                      padding: '6px 12px',
                                      borderRadius: 8,
                                      border: `1px solid ${ds.borderCard}`,
                                      background: ds.bgSubtle,
                                      fontSize: 12,
                                      fontWeight: 600,
                                      color: ds.textSecondary,
                                    }}
                                  >
                                    {row.accionRecomendada}
                                  </span>
                                </td>
                              </tr>
                              {hasComplementaries
                                ? [...complementaries]
                                    .sort((a, b) => (b.cantidad || 0) - (a.cantidad || 0))
                                    .map((comp, idx) => (
                                    <ComplementaryProductTableRow
                                      key={`${row.key}-comp-${comp.product_id ?? comp.label}-${idx}`}
                                      comp={comp}
                                      mainPedidos={row.pedidos}
                                      fmt={fmt}
                                      productImageById={productImageById}
                                    />
                                  ))
                                : null}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {/* Daily detail */}
              <div style={{ ...dashboardCard, padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '12px 18px', borderBottom: `1px solid ${ds.borderRow}` }}>
                  <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                    Detalle diario{selectedProductLabel ? ` — ${selectedProductLabel}` : ''}
                  </h2>
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: ds.textMuted }}>
                    {daysInRange.length} día{daysInRange.length === 1 ? '' : 's'} en el rango
                    {daysInRange.length !== daysForTable.length
                      ? ` (de ${daysForTable.length} cargados)`
                      : ''}
                  </p>
                </div>
                {!seriesLoading && daysInRange.length > 0 ? (
                  <DailyUtilidadBarChart
                    days={daysInRange}
                    utilidadForDay={(row) => utilidadMostradaPorDia(row, comparable, adminPercent)}
                    fmt={fmt}
                    formatTableDate={formatTableDate}
                  />
                ) : null}
                {seriesLoading ? (
                  <div style={{ padding: 20, textAlign: 'center', color: ds.textMuted, fontSize: 13 }}>
                    Cargando tabla…
                  </div>
                ) : daysInRange.length === 0 ? (
                  <div style={{ padding: 20, textAlign: 'center', color: ds.textMuted, fontSize: 13 }}>
                    No hay días en el rango seleccionado.
                  </div>
                ) : (
                  <div
                    style={{
                      overflowX: 'auto',
                      overflowY: 'auto',
                      maxHeight: DAILY_TABLE_MAX_HEIGHT,
                      WebkitOverflowScrolling: 'touch',
                    }}
                  >
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
                      <thead>
                        <tr>
                          <th style={dailyStickyTh(0, DAILY_COL_DAY_W, 14, dailyThBase, false)}>Día</th>
                          <th
                            style={dailyStickyTh(
                              DAILY_COL_PCT_UNIT_ENT_L,
                              DAILY_COL_PCT_UNIT_ENT_W,
                              13,
                              dailyThRight,
                              false,
                            )}
                          >
                            % Utilidad Unitaria (Entregados)
                          </th>
                          <th
                            style={dailyStickyTh(
                              DAILY_COL_GANANCIA_L,
                              DAILY_COL_GANANCIA_W,
                              12,
                              dailyThRight,
                              false,
                            )}
                          >
                            Ganancia
                          </th>
                          <th
                            style={dailyStickyTh(
                              DAILY_COL_UNIT_L,
                              DAILY_COL_UNIT_W,
                              11,
                              dailyThRight,
                              true,
                            )}
                          >
                            Utilidad unitaria
                          </th>
                          <th style={dailyThTop(dailyThRight)}>Ventas despachadas</th>
                          <th style={dailyThTop(dailyThRight)}>Ventas entregadas</th>
                          <th style={dailyThTop(dailyThRight)}>Pedidos</th>
                          <th style={dailyThTop(dailyThRight)}>Cantidad</th>
                          <th style={dailyThTop(dailyThRight)}>Gasto admon</th>
                          <th style={dailyThTop(dailyThRight)}>Costo producto</th>
                          <th style={dailyThTop(dailyThRight)}>Costo entregado</th>
                          <th style={dailyThTop(dailyThRight)}>% Costo prod.</th>
                          <th style={dailyThTop(dailyThRight)}>Flete promedio</th>
                          <th style={dailyThTop(dailyThRight)}>% Flete</th>
                          <th style={dailyThTop(dailyThRight)}>Gasto publicitario</th>
                          <th style={dailyThTop(dailyThRight)}>% Publicidad</th>
                          <th style={dailyThTop(dailyThRight)}>ROAS</th>
                          <th style={dailyThTop(dailyThRight)}>ROAS real</th>
                          <th style={dailyThTop(dailyThRight)}>ROAS equilibrio</th>
                          <th style={dailyThTop(dailyThBase)}>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {daysInRange.map((row) => {
                          const ventasEntregadasRow = row.ventas_entregadas_total || row.ventas_despachadas_total || 0;
                          const costoProductoEntregadoRow =
                            row.costo_producto_entregado_total || row.costo_producto_total || 0;
                          const gastoMetaRow = row.gasto_publicitario_total || 0;
                          const gastoAdminRow = ventasEntregadasRow * (adminPercent / 100);
                          const roasRow = gastoMetaRow > 0 ? row.ventas_despachadas_total / gastoMetaRow : null;
                          const roasRealRow = gastoMetaRow > 0 ? ventasEntregadasRow / gastoMetaRow : null;
                          const roasEquilibrioRow =
                            gastoMetaRow > 0
                              ? (costoProductoEntregadoRow + (row.costo_flete_promedio_total || 0) + gastoAdminRow) /
                                gastoMetaRow
                              : null;
                          const utilidadRow = utilidadMostradaPorDia(row, comparable, adminPercent);
                          const pedidosRow = row.ventas_despachadas_pedidos || 0;
                          const utilidadUnitRow =
                            utilidadRow != null && pedidosRow > 0
                              ? Math.round((utilidadRow / pedidosRow) * 100) / 100
                              : null;
                          const pctUtilUnitEntregados =
                            utilidadRow != null && ventasEntregadasRow > 0
                              ? Math.round((utilidadRow / ventasEntregadasRow) * 10000) / 100
                              : null;
                          const dayEstado = classifyDayEstado(utilidadRow, ventasEntregadasRow, goalPct);
                          const pctUtilUnitEntStyle: CSSProperties =
                            pctUtilUnitEntregados == null
                              ? dailyTdRight
                              : pctUtilUnitEntregados < 0
                                ? { ...dailyTdRight, color: '#dc2626', fontWeight: 700 }
                                : pctUtilUnitEntregados > 0
                                  ? { ...dailyTdRight, color: '#059669', fontWeight: 700 }
                                  : dailyTdRight;
                          const utilidadUnitStyle: CSSProperties =
                            utilidadUnitRow == null
                              ? dailyTdRight
                              : utilidadUnitRow < 0
                                ? { ...dailyTdRight, color: '#dc2626', fontWeight: 700 }
                                : { ...dailyTdRight, color: '#059669', fontWeight: 700 };
                          const utilidadStyle: CSSProperties =
                            utilidadRow == null
                              ? dailyTdRight
                              : utilidadRow < 0
                                ? { ...dailyTdRight, color: '#dc2626', fontWeight: 600 }
                                : utilidadRow > 0
                                  ? { ...dailyTdRight, color: '#059669', fontWeight: 600 }
                                  : dailyTdRight;
                          const rowBg = ds.bgCard;

                          return (
                            <tr
                              key={row.date}
                              style={{ background: rowBg, transition: 'background 0.12s ease' }}
                              onMouseEnter={(e) => setDailyRowHover(e.currentTarget, true)}
                              onMouseLeave={(e) => setDailyRowHover(e.currentTarget, false)}
                            >
                              <td
                                style={dailyStickyTd(0, DAILY_COL_DAY_W, 3, dailyTdBase, rowBg, false)}
                                title={formatTableDate(row.date)}
                              >
                                <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{formatTableDate(row.date)}</span>
                              </td>
                              <td
                                style={dailyStickyTd(
                                  DAILY_COL_PCT_UNIT_ENT_L,
                                  DAILY_COL_PCT_UNIT_ENT_W,
                                  4,
                                  pctUtilUnitEntStyle,
                                  rowBg,
                                  false,
                                )}
                              >
                                {pctUtilUnitEntregados != null ? `${pctUtilUnitEntregados.toFixed(1)}%` : '—'}
                              </td>
                              <td style={dailyStickyTd(DAILY_COL_GANANCIA_L, DAILY_COL_GANANCIA_W, 5, utilidadStyle, rowBg, false)}>
                                {utilidadRow != null ? fmt(utilidadRow) : '—'}
                              </td>
                              <td style={dailyStickyTd(DAILY_COL_UNIT_L, DAILY_COL_UNIT_W, 6, utilidadUnitStyle, rowBg, true)}>
                                {utilidadUnitRow != null ? fmt(utilidadUnitRow) : '—'}
                              </td>
                              <td style={dailyTdRight}>{fmt(row.ventas_despachadas_total)}</td>
                              <td style={dailyTdRight}>{fmt(ventasEntregadasRow)}</td>
                              <td style={dailyTdRight}>{row.ventas_despachadas_pedidos}</td>
                              <td style={dailyTdRight}>{Number(row.cantidad_producto_total || 0).toLocaleString('es-CO')}</td>
                              <td style={dailyTdRight}>{fmt(gastoAdminRow)}</td>
                              <td style={dailyTdRight}>{fmt(row.costo_producto_total || 0)}</td>
                              <td style={dailyTdRight}>{fmt(costoProductoEntregadoRow)}</td>
                              <td style={dailyTdRight}>{formatPercent(costoProductoEntregadoRow, ventasEntregadasRow)}</td>
                              <td style={dailyTdRight}>{fmt(row.costo_flete_promedio_total || 0)}</td>
                              <td style={dailyTdRight}>{formatPercent(row.costo_flete_promedio_total || 0, ventasEntregadasRow)}</td>
                              <td style={dailyTdRight}>{formatMoney(gastoMetaRow, seriesMetaCur || seriesVentasCur)}</td>
                              <td style={dailyTdRight}>{formatPercent(gastoMetaRow, row.ventas_despachadas_total || 0)}</td>
                              <td style={dailyTdRight}>{formatRoas(roasRow)}</td>
                              <td style={dailyTdRight}>{formatRoas(roasRealRow)}</td>
                              <td style={dailyTdRight}>{formatRoas(roasEquilibrioRow)}</td>
                              <td style={dailyTdBase}>
                                <EstadoBadge estado={dayEstado} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: ds.bgSubtle }}>
                          <td
                            style={dailyStickyTd(0, DAILY_COL_DAY_W, 3, { ...dailyTdBase, fontWeight: 700 }, ds.bgSubtle, false)}
                          >
                            Total período
                          </td>
                          <td
                            style={dailyStickyTd(
                              DAILY_COL_PCT_UNIT_ENT_L,
                              DAILY_COL_PCT_UNIT_ENT_W,
                              4,
                              { ...dailyTdRight, fontWeight: 700 },
                              ds.bgSubtle,
                              false,
                            )}
                          >
                            {totals.utilidadNeta != null && totals.ventasEntregadas > 0
                              ? `${((totals.utilidadNeta / totals.ventasEntregadas) * 100).toFixed(1)}%`
                              : '—'}
                          </td>
                          <td
                            style={dailyStickyTd(
                              DAILY_COL_GANANCIA_L,
                              DAILY_COL_GANANCIA_W,
                              5,
                              { ...dailyTdRight, fontWeight: 700 },
                              ds.bgSubtle,
                              false,
                            )}
                          >
                            {totals.utilidadNeta != null ? fmt(totals.utilidadNeta) : '—'}
                          </td>
                          <td
                            style={dailyStickyTd(
                              DAILY_COL_UNIT_L,
                              DAILY_COL_UNIT_W,
                              6,
                              { ...dailyTdRight, fontWeight: 700 },
                              ds.bgSubtle,
                              true,
                            )}
                          >
                            {totals.utilidadNeta != null && totals.pedidos > 0
                              ? fmt(Math.round((totals.utilidadNeta / totals.pedidos) * 100) / 100)
                              : '—'}
                          </td>
                          <td style={{ ...dailyTdRight, fontWeight: 700 }}>{fmt(totals.ventas)}</td>
                          <td style={{ ...dailyTdRight, fontWeight: 700 }}>{fmt(totals.ventasEntregadas)}</td>
                          <td style={{ ...dailyTdRight, fontWeight: 700 }}>{totals.pedidos}</td>
                          <td style={{ ...dailyTdRight, fontWeight: 700 }}>
                            {Number(totals.cantidadProducto || 0).toLocaleString('es-CO')}
                          </td>
                          <td style={{ ...dailyTdRight, fontWeight: 700 }}>
                            {fmt(totals.ventasEntregadas * (adminPercent / 100))}
                          </td>
                          <td style={{ ...dailyTdRight, fontWeight: 700 }}>
                            {fmt(
                              daysInRange.reduce((s, r) => s + (r.costo_producto_total || 0), 0),
                            )}
                          </td>
                          <td style={{ ...dailyTdRight, fontWeight: 700 }}>
                            {fmt(
                              daysInRange.reduce(
                                (s, r) => s + (r.costo_producto_entregado_total || r.costo_producto_total || 0),
                                0,
                              ),
                            )}
                          </td>
                          <td style={{ ...dailyTdRight, fontWeight: 700 }}>
                            {formatPercent(
                              daysInRange.reduce(
                                (s, r) => s + (r.costo_producto_entregado_total || r.costo_producto_total || 0),
                                0,
                              ),
                              totals.ventasEntregadas,
                            )}
                          </td>
                          <td style={{ ...dailyTdRight, fontWeight: 700 }}>
                            {fmt(daysInRange.reduce((s, r) => s + (r.costo_flete_promedio_total || 0), 0))}
                          </td>
                          <td style={{ ...dailyTdRight, fontWeight: 700 }}>
                            {formatPercent(
                              daysInRange.reduce((s, r) => s + (r.costo_flete_promedio_total || 0), 0),
                              totals.ventasEntregadas,
                            )}
                          </td>
                          <td style={{ ...dailyTdRight, fontWeight: 700 }}>
                            {formatMoney(totals.gasto, seriesMetaCur || seriesVentasCur)}
                          </td>
                          <td style={{ ...dailyTdRight, fontWeight: 700 }}>
                            {formatPercent(totals.gasto, totals.ventas)}
                          </td>
                          <td style={{ ...dailyTdRight, fontWeight: 700 }}>
                            {formatRoas(totals.gasto > 0 ? totals.ventas / totals.gasto : null)}
                          </td>
                          <td style={{ ...dailyTdRight, fontWeight: 700 }}>
                            {formatRoas(totals.gasto > 0 ? totals.ventasEntregadas / totals.gasto : null)}
                          </td>
                          <td style={{ ...dailyTdRight, fontWeight: 700 }}>
                            {formatRoas(
                              totals.gasto > 0
                                ? (daysInRange.reduce(
                                    (s, r) =>
                                      s +
                                      (r.costo_producto_entregado_total || r.costo_producto_total || 0) +
                                      (r.costo_flete_promedio_total || 0),
                                    0,
                                  ) +
                                    totals.ventasEntregadas * (adminPercent / 100)) /
                                    totals.gasto
                                : null,
                            )}
                          </td>
                          <td style={dailyTdBase} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Insights sidebar — alineado con KPIs, fijo al hacer scroll */}
            <aside
              style={{
                width: '100%',
                maxWidth: 300,
                position: 'sticky',
                top: 16,
                alignSelf: 'start',
                maxHeight: 'calc(100vh - 32px)',
                overflowY: 'auto',
              }}
            >
              <div style={{ ...dashboardCard, padding: '18px 16px' }}>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Insights clave</div>
                <p style={{ margin: '0 0 16px', fontSize: 12, color: ds.textMuted }}>
                  Calculados del rango seleccionado
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {insights.length === 0 ? (
                    <p style={{ fontSize: 13, color: ds.textMuted, margin: 0 }}>Sin datos suficientes.</p>
                  ) : (
                    insights.map((ins) => (
                      <InsightCard key={ins.id} insight={ins} productImageById={productImageById} />
                    ))
                  )}
                </div>
              </div>
            </aside>
          </div>
        </>
      ) : null}
    </div>
  );
}

function useMemoSortedDays(days: SeriesDayRow[]): SeriesDayRow[] {
  return [...days].sort((a, b) => a.date.localeCompare(b.date));
}
