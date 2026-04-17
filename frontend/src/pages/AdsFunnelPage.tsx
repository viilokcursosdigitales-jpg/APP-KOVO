import { useState } from 'react';
import { ds } from '../design-system/ds';
import { DataTable, Td, Th, tableBase } from '../design-system/DataTable';

const selectStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 8,
  border: `1px solid ${ds.borderCard}`,
  background: ds.bgCard,
  fontSize: 12,
  fontWeight: 500,
  color: ds.textPrimary,
  fontFamily: ds.font,
  cursor: 'pointer',
};

function DeltaPill({ children }: { children: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        background: ds.successBg,
        color: ds.successText,
      }}
    >
      {children}
    </span>
  );
}

function FunnelTag({ children }: { children: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        marginTop: 6,
        padding: '2px 8px',
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 600,
        background: ds.successBg,
        color: ds.successText,
      }}
    >
      {children}
    </span>
  );
}

function FunnelArrow() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '2px 0 6px', color: ds.brand }}>
      <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden>
        <path d="M7 9L1 2h12L7 9z" fill="currentColor" opacity={0.45} />
      </svg>
    </div>
  );
}

function FunnelStage({
  widthPct,
  children,
  tag,
}: {
  widthPct: number;
  children: React.ReactNode;
  tag?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
      <div
        style={{
          width: `${widthPct}%`,
          maxWidth: '100%',
          minWidth: 120,
          background: ds.brandBg,
          border: `1px solid ${ds.borderCard}`,
          clipPath: 'polygon(6% 0%, 94% 0%, 100% 100%, 0% 100%)',
          borderRadius: 0,
          padding: '14px 12px 16px',
          textAlign: 'center',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: ds.textPrimary, lineHeight: 1.25 }}>{children}</div>
        {tag}
      </div>
    </div>
  );
}

function KpiMiniCard({
  label,
  value,
  deltas,
}: {
  label: string;
  value: string;
  deltas: [string, string];
}) {
  return (
    <div
      style={{
        flex: '1 1 160px',
        background: ds.bgCard,
        border: `1px solid ${ds.borderCard}`,
        borderRadius: 14,
        padding: '16px 18px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 500, color: ds.textMuted, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: ds.textPrimary, marginBottom: 10 }}>{value}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <DeltaPill>{deltas[0]}</DeltaPill>
        <DeltaPill>{deltas[1]}</DeltaPill>
      </div>
    </div>
  );
}

function RoasPill({ value, tone }: { value: string; tone: 'good' | 'mid' | 'low' }) {
  const bg =
    tone === 'good' ? ds.successBg : tone === 'mid' ? ds.bgSubtle : ds.dangerBg;
  const fg =
    tone === 'good' ? ds.successText : tone === 'mid' ? ds.textSecondary : ds.dangerText;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        background: bg,
        color: fg,
      }}
    >
      {value}
    </span>
  );
}

function CreativeThumb({ label, hue }: { label: string; hue: number }) {
  return (
    <div
      style={{
        width: 44,
        height: 44,
        borderRadius: 10,
        flexShrink: 0,
        background: `linear-gradient(135deg, hsl(${hue} 55% 88%) 0%, hsl(${hue} 45% 72%) 100%)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
        fontWeight: 700,
        color: ds.textPrimary,
        border: `1px solid ${ds.borderCard}`,
      }}
      aria-hidden
    >
      {label.slice(0, 2).toUpperCase()}
    </div>
  );
}

/** Normaliza 0–1; y=0 abajo del área de trazado */
function sparkPath(ys: number[], w: number, h: number, padX: number, padY: number, close = false) {
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;
  const pts = ys.map((yv, i) => {
    const x = padX + (i / Math.max(1, ys.length - 1)) * innerW;
    const y = padY + (1 - yv) * innerH;
    return [x, y] as const;
  });
  let d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  if (close && pts.length) {
    const last = pts[pts.length - 1];
    const first = pts[0];
    d += ` L ${last[0].toFixed(1)} ${(h - padY).toFixed(1)} L ${first[0].toFixed(1)} ${(h - padY).toFixed(1)} Z`;
  }
  return d;
}

const CHART_DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'S', 'D', 'D'];

const CPC_SERIES = [0.42, 0.38, 0.52, 0.48, 0.55, 0.5, 0.47, 0.58, 0.45, 0.5];
const CPM_SERIES = [0.35, 0.4, 0.33, 0.36, 0.38, 0.34, 0.32, 0.37, 0.35, 0.36];
const ROAS_SERIES = [0.62, 0.58, 0.72, 0.68, 0.78, 0.7, 0.66, 0.75, 0.6, 0.65];
const CONV_SERIES = [0.35, 0.42, 0.38, 0.45, 0.52, 0.48, 0.55, 0.5, 0.58, 0.55];

function MiniLineChart({
  title,
  yLabelMax,
  ySuffix,
  legend,
  children,
}: {
  title: string;
  yLabelMax: string;
  ySuffix?: string;
  legend: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: ds.bgCard,
        border: `1px solid ${ds.borderCard}`,
        borderRadius: 14,
        padding: '16px 18px 12px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        minHeight: 280,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary, marginBottom: 14 }}>{title}</div>
      <div style={{ position: 'relative', height: 200 }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 22,
            width: 28,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            fontSize: 10,
            color: ds.textHint,
            textAlign: 'right',
            paddingRight: 6,
          }}
        >
          <span>{yLabelMax}{ySuffix ?? ''}</span>
          <span>{ySuffix ? `—${ySuffix}` : '—'}</span>
          <span>0{ySuffix ?? ''}</span>
        </div>
        <div style={{ marginLeft: 34, height: 'calc(100% - 22px)' }}>{children}</div>
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '10px 16px',
          marginTop: 8,
          paddingTop: 10,
          borderTop: `1px solid ${ds.borderSide}`,
          fontSize: 11,
          color: ds.textMuted,
        }}
      >
        {legend}
      </div>
    </div>
  );
}

export default function AdsFunnelPage() {
  const [region, setRegion] = useState('co');
  const [range, setRange] = useState('7d');

  const chartW = 320;
  const chartH = 178;
  const padX = 4;
  const padY = 8;

  return (
    <div style={{ fontFamily: ds.font, maxWidth: 1200, margin: '0 auto' }}>
      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', color: ds.textHint, marginBottom: 6 }}>
            KOVO
          </div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: ds.textPrimary }}>Ads Funnel</h1>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: ds.textSecondary, maxWidth: 480 }}>
            Vista de embudo y creativos (datos de ejemplo alineados con tu referencia visual).
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <select
            aria-label="Ubicación"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            style={selectStyle}
          >
            <option value="co">Colombia</option>
          </select>
          <select
            aria-label="Rango de fechas"
            value={range}
            onChange={(e) => setRange(e.target.value)}
            style={selectStyle}
          >
            <option value="7d">Últimos 7 días</option>
          </select>
          <button
            type="button"
            onClick={() => undefined}
            style={{
              ...selectStyle,
              fontWeight: 600,
              background: ds.bgSubtle,
              cursor: 'pointer',
            }}
          >
            Actualizar
          </button>
        </div>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(260px, 340px) minmax(0, 1fr)',
          gap: 20,
          alignItems: 'start',
        }}
        className="ads-funnel-grid"
      >
        <div
          style={{
            background: ds.bgCard,
            border: `1px solid ${ds.borderCard}`,
            borderRadius: 14,
            padding: '20px 16px 24px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary, marginBottom: 16 }}>Embudo</div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <FunnelStage widthPct={100}>
              <>
                200.5k
                <br />
                <span style={{ fontSize: 12, fontWeight: 500, color: ds.textSecondary }}>Impresiones</span>
              </>
            </FunnelStage>
            <FunnelArrow />
            <FunnelStage widthPct={88} tag={<FunnelTag>CTR 2.6%</FunnelTag>}>
              <>
                5,200
                <br />
                <span style={{ fontSize: 12, fontWeight: 500, color: ds.textSecondary }}>Clics</span>
              </>
            </FunnelStage>
            <FunnelArrow />
            <FunnelStage widthPct={76} tag={<FunnelTag>CPC $231</FunnelTag>}>
              <>
                800
                <br />
                <span style={{ fontSize: 12, fontWeight: 500, color: ds.textSecondary }}>Añadir al Carrito</span>
              </>
            </FunnelStage>
            <FunnelArrow />
            <FunnelStage widthPct={64}>
              <>
                450
                <br />
                <span style={{ fontSize: 12, fontWeight: 500, color: ds.textSecondary }}>Iniciar Pago</span>
              </>
            </FunnelStage>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <KpiMiniCard label="CTR promedio" value="2.6%" deltas={['+21%', '+11%']} />
            <KpiMiniCard label="Costo por clic" value="$231" deltas={['+10%', '+10%']} />
            <KpiMiniCard label="Tasa de conversión" value="4.0%" deltas={['+16%', '+16%']} />
          </div>

          <DataTable title="Rendimiento por creativo">
            <table style={tableBase}>
              <thead>
                <tr>
                  <Th style={{ width: '38%' }}>Creativo</Th>
                  <Th>CTR</Th>
                  <Th>CPC</Th>
                  <Th>Compras</Th>
                  <Th>CPA</Th>
                  <Th>ROAS</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td isLast={false}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <CreativeThumb label="Masajeador" hue={200} />
                      <span style={{ fontWeight: 500, color: ds.textPrimary }}>Masajeador — Video 1</span>
                    </div>
                  </Td>
                  <Td isLast={false}>3.2%</Td>
                  <Td isLast={false}>$188</Td>
                  <Td isLast={false}>$14.4k</Td>
                  <Td isLast={false}>$14.4k</Td>
                  <Td isLast={false}>
                    <RoasPill value="4.8" tone="good" />
                  </Td>
                </tr>
                <tr>
                  <Td isLast={false}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <CreativeThumb label="Corrector" hue={145} />
                      <span style={{ fontWeight: 500, color: ds.textPrimary }}>Corrector de Postura</span>
                    </div>
                  </Td>
                  <Td isLast={false}>2.1%</Td>
                  <Td isLast={false}>$252</Td>
                  <Td isLast={false}>$20.3k</Td>
                  <Td isLast={false}>$20.3k</Td>
                  <Td isLast={false}>
                    <RoasPill value="2.8" tone="mid" />
                  </Td>
                </tr>
                <tr>
                  <Td isLast>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <CreativeThumb label="Mini" hue={28} />
                      <span style={{ fontWeight: 500, color: ds.textPrimary }}>Mini Printer — Imagen 1</span>
                    </div>
                  </Td>
                  <Td isLast>1.5%</Td>
                  <Td isLast>$294</Td>
                  <Td isLast>$31.4k</Td>
                  <Td isLast>$31.4k</Td>
                  <Td isLast>
                    <RoasPill value="1.9" tone="low" />
                  </Td>
                </tr>
              </tbody>
            </table>
          </DataTable>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 16,
          marginTop: 20,
        }}
        className="ads-funnel-charts"
      >
        <MiniLineChart
          title="Costo por clic y CPM"
          yLabelMax="$700"
          legend={
            <>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 10, height: 3, borderRadius: 2, background: ds.brand }} />
                CPC $231
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: ds.successText }} />
                CPM
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 2, borderRadius: 1, background: ds.dangerText }} />
                ROAS 4.48
              </span>
            </>
          }
        >
          <svg
            width="100%"
            height={chartH}
            viewBox={`0 0 ${chartW} ${chartH}`}
            preserveAspectRatio="none"
            role="img"
            aria-label="Tendencia de CPC, CPM y ROAS"
          >
            <line
              x1={padX}
              y1={chartH - padY}
              x2={chartW - padX}
              y2={chartH - padY}
              stroke={ds.borderRow}
              strokeWidth={1}
            />
            <path
              d={sparkPath(CPC_SERIES, chartW, chartH, padX, padY)}
              fill="none"
              stroke={ds.brand}
              strokeWidth={2.2}
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={sparkPath(CPM_SERIES, chartW, chartH, padX, padY)}
              fill="none"
              stroke={ds.successText}
              strokeWidth={2.2}
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={sparkPath(ROAS_SERIES, chartW, chartH, padX, padY)}
              fill="none"
              stroke={ds.dangerText}
              strokeWidth={1.6}
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
            {CHART_DAYS.map((d, i) => {
              const innerW = chartW - padX * 2;
              const x = padX + (i / Math.max(1, CHART_DAYS.length - 1)) * innerW;
              return (
                <text
                  key={`${d}-${i}`}
                  x={x}
                  y={chartH - 2}
                  textAnchor="middle"
                  fill="var(--color-text-hint)"
                  fontSize="10"
                >
                  {d}
                </text>
              );
            })}
          </svg>
        </MiniLineChart>

        <MiniLineChart
          title="Tasa de conversión del sitio"
          yLabelMax="5%"
          ySuffix="%"
          legend={
            <>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 10, height: 3, borderRadius: 2, background: ds.brand }} />
                CPC $231
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 2, borderRadius: 1, background: ds.dangerText }} />
                ROAS 1.9
              </span>
            </>
          }
        >
          <svg
            width="100%"
            height={chartH}
            viewBox={`0 0 ${chartW} ${chartH}`}
            preserveAspectRatio="none"
            role="img"
            aria-label="Tendencia de conversión del sitio"
          >
            <defs>
              <linearGradient id="convFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <path
              d={sparkPath(CONV_SERIES, chartW, chartH, padX, padY, true)}
              fill="url(#convFill)"
              stroke={ds.brand}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
            {CHART_DAYS.map((d, i) => {
              const innerW = chartW - padX * 2;
              const x = padX + (i / Math.max(1, CHART_DAYS.length - 1)) * innerW;
              return (
                <text
                  key={`c-${d}-${i}`}
                  x={x}
                  y={chartH - 2}
                  textAnchor="middle"
                  fill="var(--color-text-hint)"
                  fontSize="10"
                >
                  {d}
                </text>
              );
            })}
          </svg>
        </MiniLineChart>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .ads-funnel-grid {
            grid-template-columns: 1fr !important;
          }
          .ads-funnel-charts {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
