import type { CSSProperties, ReactNode } from 'react';
import { ds } from '../../design-system/ds';

export const DROPi_C = {
  estadoEntregado: '#1D9E75',
  estadoCancelado: '#B4B2A9',
  estadoDevuelto: '#D85A30',
  estadoPendiente: '#BA7517',
  estadoOtros: '#5F5E5A',
  carrier1: '#6366f1',
  carrier2: '#185FA5',
  carrier3: '#1D9E75',
  carrierRest: '#94a3b8',
  margenHigh: '#059669',
  margenMid: '#d97706',
  margenLow: '#dc2626',
  gainText: '#059669',
  costText: '#dc2626',
} as const;

export const dashboardCard: CSSProperties = {
  background: ds.bgCard,
  border: `1px solid ${ds.borderCard}`,
  borderRadius: 16,
  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.06)',
};

export const sectionGap = 28;

export function linePath(values: number[], width: number, height: number): string {
  if (!values.length) return '';
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  return values
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export function sparkFromMetrics(label: string, primary: number, secondary = 0): number[] {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) | 0;
  const base = Math.max(0.15, Math.min(1, primary / 100));
  const mix = Math.max(0.1, Math.min(1, secondary / 100));
  return Array.from({ length: 10 }, (_, i) => {
    const wobble = (((h >> (i % 8)) & 7) + 3) / 10;
    return base * (0.65 + wobble * 0.35) + mix * 0.08 * (i / 10);
  });
}

export function effBadgeStyle(pct: number): { bg: string; color: string } {
  if (pct >= 80) return { bg: 'rgba(5,150,105,0.12)', color: '#047857' };
  if (pct >= 60) return { bg: 'rgba(217,119,6,0.12)', color: '#b45309' };
  return { bg: 'rgba(220,38,38,0.1)', color: '#b91c1c' };
}

export function marginBadgeStyle(pct: number): { bg: string; color: string } {
  if (pct >= 22) return { bg: 'rgba(5,150,105,0.12)', color: '#047857' };
  if (pct >= 15) return { bg: 'rgba(217,119,6,0.12)', color: '#b45309' };
  return { bg: 'rgba(220,38,38,0.1)', color: '#b91c1c' };
}

export function effBarColor(pct: number): string {
  if (pct >= 80) return DROPi_C.margenHigh;
  if (pct >= 60) return DROPi_C.margenMid;
  return DROPi_C.margenLow;
}

export function marginBarColor(pct: number): string {
  if (pct >= 22) return DROPi_C.margenHigh;
  if (pct >= 15) return DROPi_C.margenMid;
  return DROPi_C.margenLow;
}

export function colorForStatus(s: string): string {
  if (s === 'ENTREGADO') return DROPi_C.estadoEntregado;
  if (s === 'CANCELADO') return DROPi_C.estadoCancelado;
  if (s === 'DEVOLUCION') return DROPi_C.estadoDevuelto;
  return DROPi_C.estadoPendiente;
}

export function colorForCarrierIndex(i: number): string {
  if (i === 0) return DROPi_C.carrier1;
  if (i === 1) return DROPi_C.carrier2;
  if (i === 2) return DROPi_C.carrier3;
  return DROPi_C.carrierRest;
}

export function Badge({ children, bg, color }: { children: ReactNode; bg: string; color: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 10px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        background: bg,
        color,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export function Sparkline({
  values,
  color = DROPi_C.carrier1,
  width = 72,
  height = 28,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (!values.length) return <span style={{ color: ds.textMuted, fontSize: 11 }}>—</span>;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden style={{ display: 'block' }}>
      <path
        d={linePath(values, width, height)}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MiniBar({ pct, color }: { pct: number; color: string }) {
  const w = Math.min(100, Math.max(0, pct));
  return (
    <div
      style={{
        height: 8,
        borderRadius: 999,
        background: `${DROPi_C.estadoOtros}22`,
        minWidth: 88,
        overflow: 'hidden',
      }}
    >
      <div style={{ width: `${w}%`, height: '100%', borderRadius: 999, background: color, transition: 'width 0.2s ease' }} />
    </div>
  );
}

export function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: ds.textPrimary, letterSpacing: '-0.01em' }}>{title}</h3>
      {subtitle ? (
        <p style={{ margin: '4px 0 0', fontSize: 12, color: ds.textSecondary, lineHeight: 1.45 }}>{subtitle}</p>
      ) : null}
    </div>
  );
}

export const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '12px 16px',
  fontSize: 11,
  fontWeight: 700,
  color: ds.textMuted,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  borderBottom: `1px solid ${ds.borderRow}`,
  background: ds.bgSubtle,
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  zIndex: 2,
};

export const tdStyle: CSSProperties = {
  padding: '12px 16px',
  fontSize: 13,
  color: ds.textPrimary,
  borderBottom: `1px solid ${ds.borderRow}`,
  verticalAlign: 'middle',
};

export function tableShell(maxHeight?: number): CSSProperties {
  return {
    ...dashboardCard,
    overflow: 'auto',
    maxHeight: maxHeight ?? undefined,
  };
}

export function ProductAvatar({ label }: { label: string }) {
  const letter = (label.trim()[0] || '?').toUpperCase();
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: 10,
        background: 'linear-gradient(135deg, rgba(99,102,241,0.18), rgba(99,102,241,0.06))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        fontWeight: 800,
        color: DROPi_C.carrier1,
        flexShrink: 0,
      }}
    >
      {letter}
    </div>
  );
}

export function SkeletonBlock({ height = 120 }: { height?: number }) {
  return (
    <div
      style={{
        ...dashboardCard,
        height,
        background: `linear-gradient(90deg, ${ds.bgSubtle} 0%, ${ds.bgCard} 50%, ${ds.bgSubtle} 100%)`,
        backgroundSize: '200% 100%',
        animation: 'dropiShimmer 1.2s ease-in-out infinite',
      }}
    />
  );
}
