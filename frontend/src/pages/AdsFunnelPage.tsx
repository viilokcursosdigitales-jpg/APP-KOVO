import { useCallback, useEffect, useState, useId, useRef } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';
import { DataTable, Td, Th, tableBase } from '../design-system/DataTable';
import { formatMetaMoneyWhole } from '../meta/formatMetaMoney';
import {
  MetaDataIssueCard,
  MetaFetchErrorPanel,
  MetaLiveDataStrip,
} from '../meta/MetaApiStatusBanner';
import type { MetaInsightPeriod } from '../meta/MetaInsightsPanel';
import { MetaDataSourceBadge, type MetaDataSource } from '../meta/MetaInsightsPanel';
import { resolveMetaDataIssue } from '../meta/metaDataIssues';
import { useMetaInsightsReady } from '../meta/useMetaInsightsReady';

const PERIOD_LABELS: Record<MetaInsightPeriod, string> = {
  hoy: 'Hoy',
  ayer: 'Ayer',
  '3d': 'Últimos 3 días',
  '7d': 'Últimos 7 días',
  '14d': 'Últimos 14 días',
  '30d': 'Últimos 30 días',
  custom: 'Personalizado',
};

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

function formatNumber(n: number): string {
  return new Intl.NumberFormat('es-ES').format(Math.round(n));
}

function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

function formatPct(n: number, decimals = 1): string {
  return `${n.toFixed(decimals)}%`;
}

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
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
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
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
      <div style={{ fontSize: 22, fontWeight: 700, color: ds.textPrimary, marginBottom: 8 }}>{value}</div>
      {hint ? (
        <div style={{ fontSize: 11, fontWeight: 500, color: ds.textHint }}>{hint}</div>
      ) : null}
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

function roasTone(roas: number): 'good' | 'mid' | 'low' {
  if (roas >= 3) return 'good';
  if (roas >= 2) return 'mid';
  return 'low';
}

function CreativeThumb({ label }: { label: string }) {
  const hue = hashHue(label);
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
      {label.trim().slice(0, 2).toUpperCase() || '—'}
    </div>
  );
}

function sparkPath(ys: number[], w: number, h: number, padX: number, padY: number, close = false) {
  if (ys.length === 0) return '';
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

function normalize01(values: number[]): number[] {
  if (values.length === 0) return [];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
    return values.map(() => 0.5);
  }
  return values.map((v) => (v - lo) / (hi - lo));
}

function dayLabel(isoDate: string): string {
  try {
    return new Intl.DateTimeFormat('es-ES', { weekday: 'narrow' }).format(new Date(`${isoDate}T12:00:00`));
  } catch {
    return '';
  }
}

type StageApi = { key: string; label: string; people: number };

type DailyRow = {
  date_start: string;
  cpc: number;
  cpm: number;
  convPct: number;
  roas: number;
};

type AdRow = {
  id: string;
  name: string;
  impressions: number;
  clicks: number;
  spend: number;
  ctr: number;
  cpc: number;
  purchases: number;
  revenue: number;
  roas: number;
  cpa: number;
};

type PanelResponse = {
  error?: string;
  code?: string;
  live?: boolean;
  period?: string;
  datePreset?: string;
  fetchedAt?: string;
  funnel?: {
    stages: StageApi[];
    drops: number[];
    spend: number;
    revenue: number;
    impressions: number;
    purchases: number;
    linkClicks: number;
    convRate: number;
    cpa: number;
    roas: number;
  };
  totals?: {
    impressions: number;
    clicks: number;
    spend: number;
    purchases: number;
    revenue: number;
    cpm: number;
    cpc: number;
    ctr: number;
    roas: number;
    cpa: number;
  };
  adsRows?: AdRow[];
  daily?: DailyRow[];
  kpi?: { ctr: number; cpc: number; convRate: number };
  partialErrors?: { adAccountId: string; error: string; source?: string }[];
};

function MiniLineChart({
  title,
  yLabelMax,
  ySuffix,
  legend,
  children,
  emptyHint,
}: {
  title: string;
  yLabelMax: string;
  ySuffix?: string;
  legend: React.ReactNode;
  children: React.ReactNode;
  emptyHint?: string;
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
          <span>
            {yLabelMax}
            {ySuffix ?? ''}
          </span>
          <span>{ySuffix ? `—${ySuffix}` : '—'}</span>
          <span>
            0
            {ySuffix ?? ''}
          </span>
        </div>
        <div style={{ marginLeft: 34, height: 'calc(100% - 22px)' }}>
          {emptyHint ? <p style={{ margin: 0, fontSize: 12, color: ds.textMuted }}>{emptyHint}</p> : children}
        </div>
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
  const metaReady = useMetaInsightsReady();
  const chartGradId = `adsFunnelGrad-${useId().replace(/:/g, '')}`;
  const [period, setPeriod] = useState<MetaInsightPeriod>('7d');
  const [filterActId, setFilterActId] = useState('');
  const [accountOptions, setAccountOptions] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelResponse | null>(null);
  const [dataSource, setDataSource] = useState<MetaDataSource>(null);
  const [dataFresh, setDataFresh] = useState<boolean | null>(null);
  const snapshotPollRef = useRef(false);

  useEffect(() => {
    let c = false;
    (async () => {
      try {
        const res = await apiFetch('/api/meta/selected-ad-accounts');
        if (!res.ok || c) return;
        const data = (await res.json()) as { accounts?: { id: string; name: string }[] };
        if (c) return;
        setAccountOptions(Array.isArray(data.accounts) ? data.accounts : []);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      c = true;
    };
  }, []);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true);
    }
    setError(null);
    setCode(null);
    try {
      const q = new URLSearchParams({ period });
      if (filterActId) q.set('adAccountId', filterActId);
      const res = await apiFetch(`/api/meta/ads-funnel-panel?${q.toString()}`);
      const sourceHeader = res.headers.get('X-Data-Source');
      const freshHeader = res.headers.get('X-Data-Fresh');
      const source: MetaDataSource =
        sourceHeader === 'cache' || sourceHeader === 'snapshot' || sourceHeader === 'live'
          ? sourceHeader
          : null;
      setDataSource(source);
      setDataFresh(freshHeader === 'false' ? false : freshHeader === 'true' ? true : null);
      const data = (await res.json().catch(() => ({}))) as PanelResponse;
      if (!res.ok) {
        setPanel(null);
        setError(typeof data.error === 'string' ? data.error : 'No se pudo cargar el panel');
        setCode(typeof data.code === 'string' ? data.code : null);
        return;
      }
      setPanel(data);
      if (source === 'snapshot' && !snapshotPollRef.current) {
        snapshotPollRef.current = true;
        window.setTimeout(() => {
          snapshotPollRef.current = false;
          void load({ silent: true });
        }, 8000);
      }
    } catch {
      setPanel(null);
      if (!opts?.silent) setError('Error de red');
      setCode(null);
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [period, filterActId]);

  useEffect(() => {
    void load();
  }, [load]);

  const stages = panel?.funnel?.stages ?? [];
  const maxP = Math.max(...stages.map((s) => s.people), 1);
  const funnelWidths = stages.map((s) => Math.max(38, Math.round(52 + 48 * (s.people / maxP))));

  const imp0 = stages[0]?.people ?? 0;
  const clk1 = stages[1]?.people ?? 0;
  const ctrImp =
    imp0 > 0 && stages.length > 1 ? formatPct((clk1 / imp0) * 100, 1) : null;
  const atcIdx = stages.findIndex((s) => s.key === 'atc');
  const totals = panel?.totals;
  const cpcGlobal =
    totals && totals.clicks > 0 ? formatMetaMoneyWhole(totals.spend / totals.clicks) : null;

  const daily = panel?.daily ?? [];
  const cpcSeries = normalize01(daily.map((d) => d.cpc));
  const cpmSeries = normalize01(daily.map((d) => d.cpm));
  const roasSeries = normalize01(daily.map((d) => d.roas));
  const convSeries = normalize01(daily.map((d) => d.convPct));

  const maxSpendish = Math.max(
    ...daily.map((d) => Math.max(d.cpc, d.cpm, Number.EPSILON)),
    1,
  );
  const yMoneyLabel = formatMetaMoneyWhole(maxSpendish);

  const maxConv = Math.max(...daily.map((d) => d.convPct), 0.01);
  const yConvLabel = `${maxConv.toFixed(1)}%`;

  const kpi = panel?.kpi;
  const fetchedHint = panel?.fetchedAt
    ? `Actualizado ${new Date(panel.fetchedAt).toLocaleString('es-ES')}`
    : undefined;

  const dataIssue = resolveMetaDataIssue(
    (panel?.partialErrors ?? []).map((e) => ({ adAccountId: e.adAccountId, error: e.error })),
    error,
    code,
  );

  const metaStrip = panel?.datePreset && panel?.fetchedAt
    ? { datePreset: panel.datePreset, fetchedAt: panel.fetchedAt }
    : null;

  const adsRows = panel?.adsRows ?? [];

  const chartW = 320;
  const chartH = 178;
  const padX = 4;
  const padY = 8;

  const periods: MetaInsightPeriod[] = ['hoy', 'ayer', '3d', '7d', '14d', '30d', 'custom'];

  return (
    <div style={{ fontFamily: ds.font, maxWidth: 1200, margin: '0 auto' }}>
      {metaReady === 'no' && !error && (
        <p
          style={{
            margin: '0 0 16px',
            padding: '12px 14px',
            borderRadius: 10,
            background: ds.warningBg,
            color: ds.warningText,
            fontSize: 13,
            maxWidth: 720,
          }}
        >
          Conecta Meta y elige cuentas publicitarias para ver datos reales.{' '}
          <Link to="/conexion-meta" style={{ color: ds.warningText, fontWeight: 700 }}>
            Ir a conexión con Meta
          </Link>
        </p>
      )}

      <MetaLiveDataStrip issue={dataIssue} meta={metaStrip} variant="insights" />

      <MetaDataSourceBadge source={dataSource} fresh={dataFresh} />

      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 20,
        }}
      >
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', color: ds.textHint, marginBottom: 6 }}>
            KOVO
          </div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: ds.textPrimary }}>Embudo de anuncios</h1>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: ds.textSecondary, maxWidth: 520 }}>
            Embudo (acciones agregadas por cuenta), anuncios con mejor gasto y tendencias diarias desde la API de Meta.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          {accountOptions.length > 1 ? (
            <select
              aria-label="Cuenta publicitaria"
              value={filterActId}
              onChange={(e) => setFilterActId(e.target.value)}
              style={selectStyle}
            >
              <option value="">Todas las cuentas</option>
              {accountOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          ) : null}
          <select
            aria-label="Rango de fechas"
            value={period}
            onChange={(e) => setPeriod(e.target.value as MetaInsightPeriod)}
            style={selectStyle}
          >
            {periods.map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            style={{
              ...selectStyle,
              fontWeight: 600,
              background: ds.bgSubtle,
              cursor: loading ? 'wait' : 'pointer',
            }}
          >
            {loading ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
      </header>

      {dataIssue && <MetaDataIssueCard issue={dataIssue} />}
      {error && <MetaFetchErrorPanel error={error} code={code} />}

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
          {loading && stages.length === 0 ? (
            <p style={{ color: ds.textMuted, fontSize: 13 }}>Cargando embudo…</p>
          ) : stages.length === 0 ? (
            <p style={{ color: ds.textMuted, fontSize: 13 }}>Sin etapas de embudo para mostrar.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              {stages.map((s, i) => (
                <div key={s.key} style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <FunnelStage
                    widthPct={funnelWidths[i] ?? 70}
                    tag={
                      i === 1 && ctrImp ? (
                        <FunnelTag>CTR {ctrImp}</FunnelTag>
                      ) : i === atcIdx && cpcGlobal ? (
                        <FunnelTag>CPC {cpcGlobal}</FunnelTag>
                      ) : undefined
                    }
                  >
                    <>
                      {formatCompact(s.people)}
                      <br />
                      <span style={{ fontSize: 12, fontWeight: 500, color: ds.textSecondary }}>{s.label}</span>
                    </>
                  </FunnelStage>
                  {i < stages.length - 1 ? <FunnelArrow /> : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <KpiMiniCard
              label="CTR promedio (anuncios)"
              value={kpi ? formatPct(kpi.ctr, 1) : '—'}
              hint={fetchedHint}
            />
            <KpiMiniCard
              label="Costo por clic"
              value={kpi ? formatMetaMoneyWhole(kpi.cpc) : '—'}
              hint="Gasto / clics (insights por anuncio)"
            />
            <KpiMiniCard
              label="Tasa de conversión (compra / clic)"
              value={kpi ? formatPct(kpi.convRate, 1) : '—'}
              hint="Basada en compras y clics agregados de anuncios"
            />
          </div>

          <DataTable title="Rendimiento por creativo (anuncio)">
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
                {adsRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      style={{
                        fontSize: 12,
                        color: ds.textMuted,
                        padding: '12px 16px',
                        borderBottom: 'none',
                        verticalAlign: 'middle',
                      }}
                    >
                      No hay filas de anuncios para este período.
                    </td>
                  </tr>
                ) : (
                  adsRows.map((row, idx) => {
                    const last = idx === adsRows.length - 1;
                    return (
                      <tr key={row.id}>
                        <Td isLast={last}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <CreativeThumb label={row.name} />
                            <span style={{ fontWeight: 500, color: ds.textPrimary }}>{row.name}</span>
                          </div>
                        </Td>
                        <Td isLast={last}>{formatPct(row.ctr, 1)}</Td>
                        <Td isLast={last}>{formatMetaMoneyWhole(row.cpc)}</Td>
                        <Td isLast={last}>
                          {row.revenue > 0 ? formatMetaMoneyWhole(row.revenue) : row.purchases > 0 ? formatNumber(row.purchases) : '—'}
                        </Td>
                        <Td isLast={last}>
                          {row.purchases > 0 ? formatMetaMoneyWhole(row.cpa) : '—'}
                        </Td>
                        <Td isLast={last}>
                          {row.roas > 0 ? (
                            <RoasPill value={`${row.roas.toFixed(1)}×`} tone={roasTone(row.roas)} />
                          ) : (
                            '—'
                          )}
                        </Td>
                      </tr>
                    );
                  })
                )}
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
          title="Costo por clic y CPM (cuenta, por día)"
          yLabelMax={yMoneyLabel}
          legend={
            <>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 10, height: 3, borderRadius: 2, background: ds.brand }} />
                CPC {kpi ? formatMetaMoneyWhole(kpi.cpc) : ''}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: ds.successText }} />
                CPM
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 2, borderRadius: 1, background: ds.dangerText }} />
                ROAS {totals && totals.roas > 0 ? `${totals.roas.toFixed(2)}×` : '—'}
              </span>
            </>
          }
          emptyHint={daily.length === 0 ? 'Meta no devolvió serie diaria para este período.' : undefined}
        >
          {daily.length > 0 ? (
            <svg
              width="100%"
              height={chartH}
              viewBox={`0 0 ${chartW} ${chartH}`}
              preserveAspectRatio="none"
              role="img"
              aria-label="CPC, CPM y ROAS por día"
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
                d={sparkPath(cpcSeries, chartW, chartH, padX, padY)}
                fill="none"
                stroke={ds.brand}
                strokeWidth={2.2}
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={sparkPath(cpmSeries, chartW, chartH, padX, padY)}
                fill="none"
                stroke={ds.successText}
                strokeWidth={2.2}
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={sparkPath(roasSeries, chartW, chartH, padX, padY)}
                fill="none"
                stroke={ds.dangerText}
                strokeWidth={1.6}
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
              />
              {daily.map((d, i) => {
                const innerW = chartW - padX * 2;
                const x = padX + (i / Math.max(1, daily.length - 1)) * innerW;
                return (
                  <text
                    key={d.date_start}
                    x={x}
                    y={chartH - 2}
                    textAnchor="middle"
                    fill="var(--color-text-hint)"
                    fontSize="10"
                  >
                    {dayLabel(d.date_start)}
                  </text>
                );
              })}
            </svg>
          ) : null}
        </MiniLineChart>

        <MiniLineChart
          title="Tasa de conversión del sitio (compras / clics, por día)"
          yLabelMax={yConvLabel}
          ySuffix="%"
          legend={
            <>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 10, height: 3, borderRadius: 2, background: ds.brand }} />
                Conv. {kpi ? formatPct(kpi.convRate, 1) : ''}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 2, borderRadius: 1, background: ds.dangerText }} />
                ROAS {totals && totals.roas > 0 ? `${totals.roas.toFixed(2)}×` : '—'}
              </span>
            </>
          }
          emptyHint={daily.length === 0 ? 'Sin datos diarios para graficar.' : undefined}
        >
          {daily.length > 0 ? (
            <svg
              width="100%"
              height={chartH}
              viewBox={`0 0 ${chartW} ${chartH}`}
              preserveAspectRatio="none"
              role="img"
              aria-label="Conversión por día"
            >
              <defs>
                <linearGradient id={chartGradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <path
                d={sparkPath(convSeries, chartW, chartH, padX, padY, true)}
                fill={`url(#${chartGradId})`}
                stroke={ds.brand}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
              {daily.map((d, i) => {
                const innerW = chartW - padX * 2;
                const x = padX + (i / Math.max(1, daily.length - 1)) * innerW;
                return (
                  <text
                    key={`c-${d.date_start}`}
                    x={x}
                    y={chartH - 2}
                    textAnchor="middle"
                    fill="var(--color-text-hint)"
                    fontSize="10"
                  >
                    {dayLabel(d.date_start)}
                  </text>
                );
              })}
            </svg>
          ) : null}
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
