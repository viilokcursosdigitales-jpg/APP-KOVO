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
  IconTarget,
  IconTrendingUp,
} from '../design-system/icons';

type SeriesDay = {
  date: string;
  ventas_despachadas_total: number;
  ventas_entregadas_total: number;
  ventas_despachadas_pedidos: number;
  gasto_publicitario_total: number;
  utilidad: number | null;
};

type SeriesPayload = {
  days?: SeriesDay[];
  ventas_currency?: string | null;
  warning?: string | null;
  error?: string;
};

type AdSpendEntry = {
  spend_date: string;
  platform: string;
  platform_label: string;
  amount: number;
};

type MonthMetrics = {
  key: string;
  shortLabel: string;
  fullLabel: string;
  spend: number;
  ventas: number;
  pedidos: number;
  utilidad: number;
  roas: number;
  cpa: number;
  estado: 'escalar' | 'optimizar' | 'reducir';
  accion: string;
};

type ChannelKey = 'all' | 'meta' | 'google' | 'tiktok' | 'otros';

const cardBase: CSSProperties = {
  background: ds.bgCard,
  borderRadius: 14,
  padding: '18px 20px',
  border: `1px solid ${ds.borderCard}`,
};

const CHANNEL_OPTIONS: { key: ChannelKey; label: string }[] = [
  { key: 'all', label: 'Todos los canales' },
  { key: 'meta', label: 'Meta Ads' },
  { key: 'google', label: 'Google Ads' },
  { key: 'tiktok', label: 'TikTok Ads' },
  { key: 'otros', label: 'Otros' },
];

const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

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

function monthShortLabel(ym: string): string {
  const mo = parseInt(ym.slice(5, 7), 10);
  return MONTH_SHORT[mo - 1] || ym;
}

function monthFullLabel(ym: string): string {
  const y = parseInt(ym.slice(0, 4), 10);
  const mo = parseInt(ym.slice(5, 7), 10);
  try {
    return new Intl.DateTimeFormat('es-CO', { month: 'long' }).format(new Date(y, mo - 1, 1));
  } catch {
    return ym;
  }
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

function aggregateByMonth(days: SeriesDay[], year: number): Map<string, Omit<MonthMetrics, 'estado' | 'accion'>> {
  const map = new Map<string, Omit<MonthMetrics, 'estado' | 'accion'>>();
  for (const ym of monthsForYear(year)) {
    map.set(ym, {
      key: ym,
      shortLabel: monthShortLabel(ym),
      fullLabel: monthFullLabel(ym),
      spend: 0,
      ventas: 0,
      pedidos: 0,
      utilidad: 0,
      roas: 0,
      cpa: 0,
    });
  }
  for (const d of days) {
    const ym = d.date.slice(0, 7);
    if (!ym.startsWith(String(year))) continue;
    const row = map.get(ym);
    if (!row) continue;
    row.spend += Number(d.gasto_publicitario_total || 0);
    row.ventas += Number(d.ventas_entregadas_total || d.ventas_despachadas_total || 0);
    row.pedidos += Number(d.ventas_despachadas_pedidos || 0);
    row.utilidad += Number(d.utilidad ?? 0);
  }
  for (const row of map.values()) {
    row.roas = row.spend > 0 ? row.ventas / row.spend : 0;
    row.cpa = row.pedidos > 0 ? row.spend / row.pedidos : 0;
  }
  return map;
}

function classifyMonths(rows: MonthMetrics[]): MonthMetrics[] {
  const withSpend = rows.filter((r) => r.spend > 0);
  const avgRoas = withSpend.length ? withSpend.reduce((s, r) => s + r.roas, 0) / withSpend.length : 0;
  const avgUtil = withSpend.length ? withSpend.reduce((s, r) => s + r.utilidad, 0) / withSpend.length : 0;

  return rows.map((r) => {
    if (r.spend <= 0) {
      return { ...r, estado: 'optimizar' as const, accion: 'Sin gasto registrado' };
    }
    const roasStrong = r.roas >= avgRoas * 1.05;
    const utilStrong = r.utilidad >= avgUtil * 0.9 && r.utilidad > 0;
    const roasWeak = r.roas < avgRoas * 0.85;
    const utilWeak = r.utilidad < 0 || r.utilidad < avgUtil * 0.5;

    if (roasStrong && utilStrong) {
      return { ...r, estado: 'escalar' as const, accion: 'Aumentar presupuesto' };
    }
    if (roasWeak || utilWeak) {
      return { ...r, estado: 'reducir' as const, accion: 'Reducir presupuesto o replantear' };
    }
    return { ...r, estado: 'optimizar' as const, accion: 'Optimizar creativos y audiencias' };
  });
}

function buildMonthRows(map: Map<string, Omit<MonthMetrics, 'estado' | 'accion'>>): MonthMetrics[] {
  const rows = [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  return classifyMonths(rows as MonthMetrics[]);
}

function scaleDaysByChannel(
  days: SeriesDay[],
  channel: ChannelKey,
  channelShares: Record<ChannelKey, number>,
): SeriesDay[] {
  if (channel === 'all') return days;
  const share = channelShares[channel] ?? 0;
  if (share <= 0) return days.map((d) => ({ ...d, gasto_publicitario_total: 0, utilidad: 0 }));
  return days.map((d) => ({
    ...d,
    gasto_publicitario_total: d.gasto_publicitario_total * share,
    utilidad: d.utilidad != null ? d.utilidad * share : null,
    ventas_entregadas_total: d.ventas_entregadas_total * share,
    ventas_despachadas_total: d.ventas_despachadas_total * share,
    ventas_despachadas_pedidos: Math.round(d.ventas_despachadas_pedidos * share),
  }));
}

function computeChannelShares(
  yearDays: SeriesDay[],
  entries: AdSpendEntry[],
  year: number,
): Record<ChannelKey, number> {
  const totalSpend = yearDays.reduce((s, d) => s + Number(d.gasto_publicitario_total || 0), 0);
  const byPlatform: Record<string, number> = { meta: 0, google: 0, tiktok: 0, otros: 0 };
  for (const e of entries) {
    if (!e.spend_date.startsWith(String(year))) continue;
    const p = e.platform in byPlatform ? e.platform : 'otros';
    byPlatform[p] += Number(e.amount || 0);
  }
  const manualTotal = Object.values(byPlatform).reduce((s, v) => s + v, 0);
  const metaAuto = Math.max(0, totalSpend - manualTotal);
  byPlatform.meta += metaAuto;

  const grand = Object.values(byPlatform).reduce((s, v) => s + v, 0) || totalSpend || 1;
  return {
    all: 1,
    meta: byPlatform.meta / grand,
    google: byPlatform.google / grand,
    tiktok: byPlatform.tiktok / grand,
    otros: byPlatform.otros / grand,
  };
}

function estadoBadge(estado: MonthMetrics['estado']) {
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

function DonutChart({
  segments,
}: {
  segments: { label: string; value: number; color: string }[];
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total <= 0) {
    return <div style={{ color: ds.textMuted, fontSize: 13 }}>Sin datos de canal</div>;
  }
  const r = 52;
  const cx = 70;
  const cy = 70;
  let angle = -90;
  const paths = segments
    .filter((s) => s.value > 0)
    .map((seg) => {
      const pct = seg.value / total;
      const sweep = pct * 360;
      const start = angle;
      angle += sweep;
      const x1 = cx + r * Math.cos((Math.PI * start) / 180);
      const y1 = cy + r * Math.sin((Math.PI * start) / 180);
      const x2 = cx + r * Math.cos((Math.PI * (start + sweep)) / 180);
      const y2 = cy + r * Math.sin((Math.PI * (start + sweep)) / 180);
      const large = sweep > 180 ? 1 : 0;
      return (
        <path
          key={seg.label}
          d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`}
          fill={seg.color}
        />
      );
    });

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={140} height={140} viewBox="0 0 140 140">
        {paths}
        <circle cx={cx} cy={cy} r={30} fill={ds.bgCard} />
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {segments
          .filter((s) => s.value > 0)
          .map((seg) => (
            <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
              <span style={{ color: ds.textSecondary }}>{seg.label}</span>
              <span style={{ fontWeight: 600, color: ds.textPrimary, marginLeft: 'auto' }}>
                {((seg.value / total) * 100).toFixed(1)}%
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

export default function GastoPublicitarioPorMesPage() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [channel, setChannel] = useState<ChannelKey>('all');
  const [tab, setTab] = useState<'resumen' | 'canales'>('resumen');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState<string | null>(null);
  const [currency, setCurrency] = useState('COP');
  const [currentDays, setCurrentDays] = useState<SeriesDay[]>([]);
  const [prevDays, setPrevDays] = useState<SeriesDay[]>([]);
  const [adEntries, setAdEntries] = useState<AdSpendEntry[]>([]);
  const [metaConnected, setMetaConnected] = useState(false);
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopifyDomain, setShopifyDomain] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const months = monthsForYear(year);
      const prevMonths = monthsForYear(year - 1);
      const from = `${year}-01-01`;
      const to = `${year}-12-31`;

      const [seriesRes, prevRes, shopRes, metaRes, spendRes] = await Promise.all([
        apiFetch(`/api/ganancia-diaria/series?months=${encodeURIComponent(months.join(','))}`),
        apiFetch(`/api/ganancia-diaria/series?months=${encodeURIComponent(prevMonths.join(','))}`),
        apiFetch('/api/shopify/connection'),
        apiFetch('/api/meta/connections'),
        apiFetch(`/api/marketing/ad-spend?from=${from}&to=${to}`).catch(() => null),
      ]);

      const seriesBody = (await seriesRes.json().catch(() => ({}))) as SeriesPayload;
      const prevBody = (await prevRes.json().catch(() => ({}))) as SeriesPayload;

      if (!seriesRes.ok) {
        setError(typeof seriesBody.error === 'string' ? seriesBody.error : 'No se pudo cargar el módulo');
        setCurrentDays([]);
        setPrevDays([]);
        return;
      }

      setCurrentDays(Array.isArray(seriesBody.days) ? seriesBody.days : []);
      setPrevDays(Array.isArray(prevBody.days) ? prevBody.days : []);
      setCurrency((seriesBody.ventas_currency || 'COP').toUpperCase());
      setWarning(seriesBody.warning ?? null);

      const shopBody = await shopRes.json().catch(() => ({}));
      setShopifyConnected(shopBody?.status === 'connected');
      setShopifyDomain(String(shopBody?.shop_domain || ''));

      const metaBody = await metaRes.json().catch(() => ({}));
      const connections = Array.isArray(metaBody?.connections) ? metaBody.connections : [];
      setMetaConnected(connections.some((c: { status?: string }) => c?.status === 'connected'));

      if (spendRes?.ok) {
        const spendBody = await spendRes.json().catch(() => ({}));
        setAdEntries(Array.isArray(spendBody.entries) ? spendBody.entries : []);
      } else {
        setAdEntries([]);
      }
    } catch {
      setError('Error de red cargando gasto publicitario por mes');
      setCurrentDays([]);
      setPrevDays([]);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

  const channelShares = useMemo(
    () => computeChannelShares(currentDays, adEntries, year),
    [currentDays, adEntries, year],
  );

  const filteredDays = useMemo(
    () => scaleDaysByChannel(currentDays, channel, channelShares),
    [currentDays, channel, channelShares],
  );

  const filteredPrevDays = useMemo(
    () => scaleDaysByChannel(prevDays, channel, channelShares),
    [prevDays, channel, channelShares],
  );

  const monthMap = useMemo(() => aggregateByMonth(filteredDays, year), [filteredDays, year]);
  const monthRows = useMemo(() => buildMonthRows(monthMap), [monthMap]);

  const prevMonthMap = useMemo(() => aggregateByMonth(filteredPrevDays, year - 1), [filteredPrevDays, year]);

  const totals = useMemo(() => {
    const spend = monthRows.reduce((s, r) => s + r.spend, 0);
    const ventas = monthRows.reduce((s, r) => s + r.ventas, 0);
    const pedidos = monthRows.reduce((s, r) => s + r.pedidos, 0);
    const utilidad = monthRows.reduce((s, r) => s + r.utilidad, 0);
    const roas = spend > 0 ? ventas / spend : 0;
    const cpa = pedidos > 0 ? spend / pedidos : 0;
    const monthsWithData = monthRows.filter((r) => r.spend > 0);
    const avgMonthly = monthsWithData.length ? spend / monthsWithData.length : 0;
    return { spend, ventas, pedidos, utilidad, roas, cpa, avgMonthly, monthsWithData };
  }, [monthRows]);

  const prevTotals = useMemo(() => {
    const rows = buildMonthRows(prevMonthMap);
    const spend = rows.reduce((s, r) => s + r.spend, 0);
    const ventas = rows.reduce((s, r) => s + r.ventas, 0);
    const pedidos = rows.reduce((s, r) => s + r.pedidos, 0);
    const utilidad = rows.reduce((s, r) => s + r.utilidad, 0);
    return {
      spend,
      roas: spend > 0 ? ventas / spend : 0,
      cpa: pedidos > 0 ? spend / pedidos : 0,
      utilidad,
      avgMonthly: rows.filter((r) => r.spend > 0).length
        ? spend / rows.filter((r) => r.spend > 0).length
        : 0,
    };
  }, [prevMonthMap]);

  const extrema = useMemo(() => {
    const withSpend = monthRows.filter((r) => r.spend > 0);
    if (!withSpend.length) return { max: null, min: null };
    const max = withSpend.reduce((a, b) => (b.spend > a.spend ? b : a));
    const min = withSpend.reduce((a, b) => (b.spend < a.spend ? b : a));
    return { max, min };
  }, [monthRows]);

  const momChange = useMemo(() => {
    const withSpend = monthRows.filter((r) => r.spend > 0);
    if (withSpend.length < 2) return null;
    const last = withSpend[withSpend.length - 1];
    const prev = withSpend[withSpend.length - 2];
    return pctChange(last.spend, prev.spend);
  }, [monthRows]);

  const avgRoas = useMemo(() => {
    const ws = monthRows.filter((r) => r.spend > 0);
    return ws.length ? ws.reduce((s, r) => s + r.roas, 0) / ws.length : 0;
  }, [monthRows]);

  const diagnostic = useMemo(() => {
    const escalar = monthRows.filter((r) => r.estado === 'escalar' && r.spend > 0).slice(-3).reverse();
    const optimizar = monthRows.filter((r) => r.estado === 'optimizar' && r.spend > 0).slice(-3).reverse();
    const reducir = monthRows.filter((r) => r.estado === 'reducir' && r.spend > 0).slice(-3).reverse();
    return { escalar, optimizar, reducir };
  }, [monthRows]);

  const quarters = useMemo(() => {
    const qs = [
      { label: 'Q1', months: [1, 2, 3] },
      { label: 'Q2', months: [4, 5, 6] },
      { label: 'Q3', months: [7, 8, 9] },
      { label: 'Q4', months: [10, 11, 12] },
    ];
    const total = totals.spend || 1;
    return qs.map((q) => {
      const spend = monthRows
        .filter((r) => q.months.includes(parseInt(r.key.slice(5, 7), 10)))
        .reduce((s, r) => s + r.spend, 0);
      return { ...q, spend, pct: (spend / total) * 100 };
    });
  }, [monthRows, totals.spend]);

  const channelSegments = useMemo(() => {
    const totalSpend = currentDays.reduce((s, d) => s + d.gasto_publicitario_total, 0);
    const byPlatform: Record<string, number> = { meta: 0, google: 0, tiktok: 0, otros: 0 };
    for (const e of adEntries) {
      const p = e.platform in byPlatform ? e.platform : 'otros';
      byPlatform[p] += e.amount;
    }
    const manualTotal = Object.values(byPlatform).reduce((s, v) => s + v, 0);
    byPlatform.meta += Math.max(0, totalSpend - manualTotal);
    return [
      { label: 'Meta Ads', value: byPlatform.meta, color: '#6C47FF' },
      { label: 'Google Ads', value: byPlatform.google, color: '#4285F4' },
      { label: 'TikTok Ads', value: byPlatform.tiktok, color: '#FE2C55' },
      { label: 'Otros', value: byPlatform.otros, color: '#94A3B8' },
    ];
  }, [currentDays, adEntries]);

  const chartW = 640;
  const chartH = 200;
  const maxSpend = Math.max(...monthRows.map((r) => r.spend), 1);
  const maxRoas = Math.max(...monthRows.map((r) => r.roas), 1);

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 4px 32px' }}>
      <PageHeader
        title="Gasto publicitario por mes"
        subtitle="Monitorea la evolución del gasto y detecta meses para recortar, optimizar o escalar."
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
            <span style={{ fontSize: 12, color: ds.textMuted, display: 'flex', alignItems: 'center', gap: 4 }}>
              <IconCalendar size={14} /> Año
            </span>
            {yearOptions().map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => setYear(y)}
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: ds.textMuted }}>Canal:</span>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as ChannelKey)}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: `1px solid ${ds.borderCard}`,
                fontSize: 12,
                background: ds.bgCard,
                color: ds.textSecondary,
              }}
            >
              {CHANNEL_OPTIONS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['resumen', 'canales'] as const).map((t) => (
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
            {t === 'resumen' ? 'Resumen' : 'Canales'}
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
            <div
              style={{
                ...cardBase,
                marginBottom: 16,
                background: ds.warningBg,
                color: ds.warningText,
                fontSize: 13,
              }}
            >
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
                  variant="spend"
                  label="Gasto anual total"
                  icon={<IconTarget />}
                  value={money(totals.spend, currency)}
                  badge={changeBadge(pctChange(totals.spend, prevTotals.spend), ` vs ${year - 1}`)}
                />
                <KpiCard
                  variant="traffic"
                  label="Promedio mensual"
                  icon={<IconCalendar />}
                  value={money(totals.avgMonthly, currency)}
                  badge={changeBadge(pctChange(totals.avgMonthly, prevTotals.avgMonthly), ` vs ${year - 1}`)}
                />
                <KpiCard
                  variant="alert"
                  label="Mes con mayor gasto"
                  icon={<IconTrendingUp />}
                  value={
                    extrema.max ? (
                      <>
                        {extrema.max.fullLabel}{' '}
                        <span style={{ fontSize: 14, fontWeight: 600 }}>({money(extrema.max.spend, currency)})</span>
                      </>
                    ) : (
                      '—'
                    )
                  }
                />
                <KpiCard
                  variant="stock"
                  label="Mes con menor gasto"
                  icon={<IconTrendingUp />}
                  value={
                    extrema.min ? (
                      <>
                        {extrema.min.fullLabel}{' '}
                        <span style={{ fontSize: 14, fontWeight: 600 }}>({money(extrema.min.spend, currency)})</span>
                      </>
                    ) : (
                      '—'
                    )
                  }
                />
                <KpiCard
                  variant="conversion"
                  label="% variación vs mes anterior"
                  icon={<IconTrendingUp />}
                  value={momChange != null ? `${momChange >= 0 ? '+' : ''}${momChange.toFixed(1)}%` : '—'}
                />
                <KpiCard
                  variant="sales"
                  label="ROAS promedio"
                  icon={<IconMegaphone />}
                  value={roasFmt(totals.roas)}
                  badge={changeBadge(pctChange(totals.roas, prevTotals.roas), ` vs ${year - 1}`)}
                />
                <KpiCard
                  variant="spend"
                  label="CPA promedio"
                  icon={<IconTarget />}
                  value={money(totals.cpa, currency)}
                  badge={changeBadge(pctChange(totals.cpa, prevTotals.cpa), ` vs ${year - 1}`)}
                />
                <KpiCard
                  variant="sales"
                  label="Utilidad neta promedio"
                  icon={<IconTrendingUp />}
                  value={money(totals.utilidad / Math.max(totals.monthsWithData.length, 1), currency)}
                  badge={changeBadge(
                    pctChange(
                      totals.utilidad / Math.max(totals.monthsWithData.length, 1),
                      prevTotals.utilidad / Math.max(monthRows.filter((r) => r.spend > 0).length, 1),
                    ),
                    ` vs ${year - 1}`,
                  )}
                />
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)',
                  gap: 16,
                  marginBottom: 16,
                }}
              >
                <div style={cardBase}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: ds.textPrimary, marginBottom: 4 }}>
                    Tendencia mensual de gasto publicitario
                  </div>
                  <div style={{ fontSize: 12, color: ds.textMuted, marginBottom: 16 }}>
                    Barras: gasto · Línea: ROAS
                  </div>
                  {monthRows.some((r) => r.spend > 0) ? (
                    <div style={{ overflowX: 'auto' }}>
                      <svg width={chartW} height={chartH + 36} viewBox={`0 0 ${chartW} ${chartH + 36}`}>
                        {monthRows.map((r, i) => {
                          const barW = (chartW - 48) / Math.max(monthRows.length, 1) - 6;
                          const x = 24 + i * ((chartW - 48) / Math.max(monthRows.length, 1));
                          const h = (r.spend / maxSpend) * (chartH - 40);
                          return (
                            <rect
                              key={r.key}
                              x={x}
                              y={chartH - 20 - h}
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
                          points={monthRows
                            .map((r, i) => {
                              const x = 24 + i * ((chartW - 48) / Math.max(monthRows.length, 1)) + 8;
                              const y = chartH - 20 - (r.roas / maxRoas) * (chartH - 40);
                              return `${x},${y}`;
                            })
                            .join(' ')}
                        />
                        {monthRows.map((r, i) => {
                          const x = 24 + i * ((chartW - 48) / Math.max(monthRows.length, 1)) + 8;
                          return (
                            <text key={`lbl-${r.key}`} x={x} y={chartH + 14} fontSize={9} fill={ds.textMuted} textAnchor="middle">
                              {r.shortLabel}
                            </text>
                          );
                        })}
                      </svg>
                    </div>
                  ) : (
                    <div style={{ color: ds.textMuted, fontSize: 13 }}>Sin gasto registrado en {year}</div>
                  )}
                </div>

                <div style={cardBase}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: ds.textPrimary, marginBottom: 12 }}>
                    Diagnóstico mensual
                  </div>
                  {[
                    { key: 'escalar', title: 'Escalar', color: ds.successText, bg: ds.successBg, rows: diagnostic.escalar },
                    { key: 'optimizar', title: 'Optimizar', color: ds.warningText, bg: ds.warningBg, rows: diagnostic.optimizar },
                    { key: 'reducir', title: 'Reducir', color: ds.dangerText, bg: ds.dangerBg, rows: diagnostic.reducir },
                  ].map((block) => (
                    <div
                      key={block.key}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 10,
                        background: block.bg,
                        marginBottom: 10,
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, color: block.color, marginBottom: 6 }}>
                        {block.title}
                      </div>
                      {block.rows.length ? (
                        <div style={{ fontSize: 12, color: ds.textSecondary }}>
                          {block.rows.map((r) => r.fullLabel).join(', ')}
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: ds.textMuted }}>—</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: 16,
                  marginBottom: 16,
                }}
              >
                <div style={cardBase}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: ds.textPrimary, marginBottom: 16 }}>
                    Comparativa por trimestre
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', minHeight: 120 }}>
                    {quarters.map((q) => (
                      <div key={q.label} style={{ flex: 1, textAlign: 'center' }}>
                        <div
                          style={{
                            height: `${Math.max(12, (q.spend / maxSpend) * 100)}px`,
                            background: alpha.brand35,
                            borderRadius: '6px 6px 0 0',
                            marginBottom: 6,
                          }}
                        />
                        <div style={{ fontSize: 12, fontWeight: 700, color: ds.textPrimary }}>{q.label}</div>
                        <div style={{ fontSize: 11, color: ds.textMuted }}>{money(q.spend, currency)}</div>
                        <div style={{ fontSize: 11, color: ds.brand, fontWeight: 600 }}>{q.pct.toFixed(1)}%</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={cardBase}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: ds.textPrimary, marginBottom: 16 }}>
                    Distribución por canal
                  </div>
                  <DonutChart segments={channelSegments} />
                </div>
              </div>

              <div style={cardBase}>
                <div style={{ fontSize: 14, fontWeight: 700, color: ds.textPrimary, marginBottom: 16 }}>
                  Resumen mensual
                </div>
                <DataTable>
                  <table style={tableBase}>
                    <thead>
                      <tr>
                        <Th>Mes</Th>
                        <Th style={{ textAlign: 'right' }}>Gasto</Th>
                        <Th style={{ textAlign: 'right' }}>ROAS</Th>
                        <Th style={{ textAlign: 'right' }}>CPA</Th>
                        <Th style={{ textAlign: 'right' }}>Compras</Th>
                        <Th style={{ textAlign: 'right' }}>Utilidad neta</Th>
                        <Th>Estado</Th>
                        <Th>Acción recomendada</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthRows.length === 0 ? (
                        <tr>
                          <td colSpan={8} style={{ padding: '12px 16px', fontSize: 12, color: ds.textMuted }}>
                            Sin datos
                          </td>
                        </tr>
                      ) : (
                        [...monthRows]
                          .reverse()
                          .map((r, i, arr) => {
                            const isLast = i === arr.length - 1;
                            return (
                              <tr key={r.key}>
                                <Td isLast={isLast}>
                                  <span
                                    style={{
                                      display: 'inline-block',
                                      width: 8,
                                      height: 8,
                                      borderRadius: '50%',
                                      background:
                                        r.estado === 'escalar'
                                          ? ds.successText
                                          : r.estado === 'reducir'
                                            ? ds.dangerText
                                            : ds.warningText,
                                      marginRight: 8,
                                    }}
                                  />
                                  {r.fullLabel}
                                </Td>
                                <Td isLast={isLast} style={{ textAlign: 'right' }}>
                                  {money(r.spend, currency)}
                                </Td>
                                <Td isLast={isLast} style={{ textAlign: 'right', color: roasColor(r.roas, avgRoas), fontWeight: 600 }}>
                                  {roasFmt(r.roas)}
                                </Td>
                                <Td isLast={isLast} style={{ textAlign: 'right' }}>
                                  {money(r.cpa, currency)}
                                </Td>
                                <Td isLast={isLast} style={{ textAlign: 'right' }}>
                                  {r.pedidos.toLocaleString('es-CO')}
                                </Td>
                                <Td isLast={isLast} style={{ textAlign: 'right' }}>
                                  {money(r.utilidad, currency)}
                                </Td>
                                <Td isLast={isLast}>{estadoBadge(r.estado)}</Td>
                                <Td isLast={isLast} style={{ fontSize: 12, color: ds.textSecondary }}>
                                  {r.accion}
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
              <div style={cardBase}>
                <div style={{ fontSize: 14, fontWeight: 700, color: ds.textPrimary, marginBottom: 16 }}>
                  Distribución anual por canal
                </div>
                <DonutChart segments={channelSegments} />
              </div>
              <div style={cardBase}>
                <div style={{ fontSize: 14, fontWeight: 700, color: ds.textPrimary, marginBottom: 16 }}>
                  Gasto por canal ({year})
                </div>
                {channelSegments
                  .filter((s) => s.value > 0)
                  .map((seg) => (
                    <div
                      key={seg.label}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '10px 0',
                        borderBottom: `1px solid ${ds.borderRow}`,
                        fontSize: 13,
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: seg.color }} />
                        {seg.label}
                      </span>
                      <span style={{ fontWeight: 700 }}>{money(seg.value, currency)}</span>
                    </div>
                  ))}
                {!channelSegments.some((s) => s.value > 0) ? (
                  <div style={{ color: ds.textMuted, fontSize: 13 }}>Sin datos de canal en {year}</div>
                ) : null}
                {adEntries.length === 0 ? (
                  <p style={{ fontSize: 12, color: ds.textMuted, marginTop: 12, marginBottom: 0 }}>
                    Los canales distintos a Meta se calculan desde registros manuales de gasto publicitario.
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
