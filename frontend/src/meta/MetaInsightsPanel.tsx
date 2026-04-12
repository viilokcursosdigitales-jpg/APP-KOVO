import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';
import { MetaDataIssueCard, MetaFetchErrorPanel, MetaLiveDataStrip } from './MetaApiStatusBanner';
import { resolveMetaDataIssue } from './metaDataIssues';

export type MetaInsightPeriod = 'hoy' | '3d' | '7d' | '14d' | '30d' | 'custom';

const PERIOD_LABELS: Record<MetaInsightPeriod, string> = {
  hoy: 'Hoy',
  '3d': 'Últimos 3 días',
  '7d': 'Últimos 7 días',
  '14d': 'Últimos 14 días',
  '30d': 'Últimos 30 días',
  custom: 'Personalizado',
};

function formatNumber(n: number): string {
  return new Intl.NumberFormat('es-ES').format(Math.round(n));
}

function formatMoney2(n: number): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatPct(n: number, decimals = 2): string {
  return `${n.toFixed(decimals)} %`;
}

type InsightLevel = 'campaigns' | 'adsets' | 'ads';

type InsightRow = {
  adAccountId: string;
  adAccountName: string;
  id: string;
  name: string;
  status: string;
  campaignId: string;
  adsetId: string;
  impressions: number;
  clicks: number;
  spend: number;
  cpm: number;
  cpc: number;
  ctr: number;
  reach: number;
  purchases: number;
  revenue: number;
  roas: number;
  cpa: number;
  level: string;
};

type Totals = {
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

export function MetaInsightsPanel({
  period,
  setPeriod,
}: {
  period: MetaInsightPeriod;
  setPeriod: (p: MetaInsightPeriod) => void;
}) {
  const [level, setLevel] = useState<InsightLevel>('campaigns');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [rows, setRows] = useState<InsightRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [partialErrors, setPartialErrors] = useState<{ adAccountId: string; error: string }[]>([]);
  const [meta, setMeta] = useState<{ datePreset: string; fetchedAt: string } | null>(null);
  const [accountOptions, setAccountOptions] = useState<{ id: string; name: string }[]>([]);
  const [filterActId, setFilterActId] = useState('');

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCode(null);
    try {
      const q = new URLSearchParams({ level, period });
      if (filterActId) q.set('adAccountId', filterActId);
      const res = await apiFetch(`/api/meta/insights?${q.toString()}`);
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        rows?: InsightRow[];
        totals?: Totals;
        partialErrors?: { adAccountId: string; error: string }[];
        datePreset?: string;
        fetchedAt?: string;
      };
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'No se pudieron cargar las métricas');
        setCode(typeof data.code === 'string' ? data.code : null);
        setRows([]);
        setTotals(null);
        setPartialErrors([]);
        setMeta(null);
        return;
      }
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setTotals(data.totals ?? null);
      setPartialErrors(Array.isArray(data.partialErrors) ? data.partialErrors : []);
      setMeta(
        data.datePreset && data.fetchedAt
          ? { datePreset: data.datePreset, fetchedAt: data.fetchedAt }
          : null,
      );
    } catch {
      setError('Error de red al consultar Meta');
      setRows([]);
      setTotals(null);
    } finally {
      setLoading(false);
    }
  }, [level, period, filterActId]);

  useEffect(() => {
    void load();
  }, [load]);

  const periods: MetaInsightPeriod[] = ['hoy', '3d', '7d', '14d', '30d', 'custom'];

  const metricCards =
    totals != null
      ? [
          { label: 'Impresiones', value: formatNumber(totals.impressions) },
          { label: 'Clics', value: formatNumber(totals.clicks) },
          { label: 'Gasto', value: formatMoney2(totals.spend) },
          { label: 'CPM', value: formatMoney2(totals.cpm) },
          { label: 'CPC', value: formatMoney2(totals.cpc) },
          { label: 'CTR', value: formatPct(totals.ctr) },
          { label: 'ROAS', value: totals.roas > 0 ? `${totals.roas.toFixed(2)}×` : '—' },
          { label: 'CPA', value: totals.purchases > 0 ? formatMoney2(totals.cpa) : '—' },
          { label: 'Compras (pixel)', value: formatNumber(totals.purchases) },
        ]
      : [];

  const levelTabs: { id: InsightLevel; label: string }[] = [
    { id: 'campaigns', label: 'Campañas' },
    { id: 'adsets', label: 'Conjuntos de anuncios' },
    { id: 'ads', label: 'Anuncios' },
  ];

  const dataIssue = useMemo(
    () => resolveMetaDataIssue(partialErrors, error, code),
    [partialErrors, error, code],
  );

  const tokenBlocked = dataIssue?.type === 'token_expired';

  return (
    <div>
      <MetaLiveDataStrip issue={dataIssue} meta={meta} variant="insights" />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 3,
            padding: 3,
            border: `1px solid ${ds.borderCard}`,
            borderRadius: 24,
            background: ds.bgCard,
          }}
        >
          {periods.map((key) => {
            const active = period === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setPeriod(key)}
                style={{
                  border: 'none',
                  cursor: 'pointer',
                  padding: '6px 14px',
                  borderRadius: 21,
                  fontSize: 12,
                  fontWeight: active ? 600 : 500,
                  whiteSpace: 'nowrap',
                  background: active ? ds.brand : 'transparent',
                  color: active ? '#ffffff' : ds.textMuted,
                }}
              >
                {PERIOD_LABELS[key]}
              </button>
            );
          })}
        </div>
        {accountOptions.length > 1 && (
          <select
            value={filterActId}
            onChange={(e) => setFilterActId(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: `1px solid ${ds.borderCard}`,
              fontSize: 13,
              maxWidth: 280,
              background: ds.bgCard,
              color: ds.textPrimary,
            }}
          >
            <option value="">Todas las cuentas</option>
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.id})
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          style={{
            marginLeft: 'auto',
            padding: '7px 14px',
            borderRadius: 8,
            border: `1px solid ${ds.borderCard}`,
            background: ds.bgCard,
            color: ds.textSecondary,
            fontWeight: 500,
            cursor: loading ? 'wait' : 'pointer',
            fontSize: 12,
          }}
        >
          {loading ? 'Actualizando…' : 'Actualizar datos'}
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 0,
          marginBottom: 18,
          borderBottom: `1px solid ${ds.borderCard}`,
        }}
      >
        {levelTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setLevel(t.id)}
            style={{
              padding: '10px 18px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: level === t.id ? 600 : 500,
              color: level === t.id ? ds.brand : ds.textMuted,
              borderBottom: level === t.id ? `2px solid ${ds.brand}` : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <MetaFetchErrorPanel error={error} code={code} />}

      {dataIssue && !error && <MetaDataIssueCard issue={dataIssue} />}

      {loading && !totals ? (
        <p style={{ color: ds.textMuted }}>Cargando métricas desde Meta…</p>
      ) : totals && metricCards.length > 0 ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 14,
            marginBottom: 20,
          }}
        >
          {metricCards.map((m) => (
            <div
              key={m.label}
              style={{
                background: ds.bgCard,
                borderRadius: 14,
                padding: '18px 20px',
                border: `1px solid ${ds.borderCard}`,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 500, color: ds.textMuted, marginBottom: 6 }}>{m.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: ds.textPrimary }}>{m.value}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div
        style={{
          background: ds.bgCard,
          borderRadius: 14,
          border: `1px solid ${ds.borderCard}`,
          overflow: 'auto',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 960 }}>
          <thead>
            <tr style={{ background: ds.bgApp, textAlign: 'left' }}>
              {[
                'Cuenta publicitaria',
                level === 'campaigns' ? 'Campaña' : level === 'adsets' ? 'Conjunto' : 'Anuncio',
                'Estado',
                ...(level !== 'campaigns' ? ['ID ref.'] : []),
                'Impresiones',
                'Clics',
                'Gasto',
                'CPM',
                'CTR',
                'ROAS',
                'CPA',
              ].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: '11px 16px',
                    fontWeight: 500,
                    fontSize: 10.5,
                    textTransform: 'uppercase',
                    letterSpacing: '0.4px',
                    color: ds.textHint,
                    borderBottom: `1px solid ${ds.borderCard}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading ? (
              <tr>
                <td
                  colSpan={level === 'campaigns' ? 10 : 11}
                  style={{ padding: 24, color: ds.textMuted, textAlign: 'center', fontSize: 13 }}
                >
                  {tokenBlocked ? (
                    <>
                      Meta no devolvió filas porque el access token no es válido.{' '}
                      <strong style={{ color: ds.textSecondary }}>Renueva el token</strong> en la pestaña Conexión Meta ADS
                      y vuelve a actualizar.
                    </>
                  ) : (
                    <>
                      No hay filas con datos de insights en este período (puede que no haya entregas o que el token no
                      tenga permisos).
                    </>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={`${row.adAccountId}-${row.id}`} style={{ borderBottom: `1px solid ${ds.borderRow}` }}>
                  <td style={{ padding: '12px 16px', maxWidth: 160 }} title={row.adAccountId}>
                    <div style={{ fontWeight: 600, fontSize: 12, color: ds.textPrimary }}>{row.adAccountName}</div>
                    <div style={{ fontSize: 10.5, color: ds.textHint }}>{row.adAccountId}</div>
                  </td>
                  <td style={{ padding: '12px 16px', maxWidth: 220 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, color: ds.textPrimary }}>{row.name}</div>
                    <div style={{ fontSize: 10.5, color: ds.textHint }}>id {row.id}</div>
                  </td>
                  <td style={{ padding: '12px 16px' }}>{row.status || '—'}</td>
                  {level !== 'campaigns' && (
                    <td style={{ padding: '12px 16px', fontSize: 11, color: ds.textMuted, maxWidth: 100 }}>
                      {level === 'adsets' ? row.campaignId : row.adsetId}
                    </td>
                  )}
                  <td style={{ padding: '12px 16px' }}>{formatNumber(row.impressions)}</td>
                  <td style={{ padding: '12px 16px' }}>{formatNumber(row.clicks)}</td>
                  <td style={{ padding: '12px 16px' }}>{formatMoney2(row.spend)}</td>
                  <td style={{ padding: '12px 16px' }}>{formatMoney2(row.cpm)}</td>
                  <td style={{ padding: '12px 16px' }}>{formatPct(row.ctr)}</td>
                  <td style={{ padding: '12px 16px' }}>{row.roas > 0 ? `${row.roas.toFixed(2)}×` : '—'}</td>
                  <td style={{ padding: '12px 16px' }}>{row.purchases > 0 ? formatMoney2(row.cpa) : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
