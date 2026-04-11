import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../auth/api';

const META_BLUE = '#1877f2';
const SHOPIFY_GREEN = '#96bf48';
const CARD_BG = '#ffffff';

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

  return (
    <div>
      <p
        style={{
          margin: '0 0 12px',
          fontSize: 13,
          color: '#166534',
          background: 'rgba(22,101,52,0.08)',
          padding: '10px 14px',
          borderRadius: 8,
          border: '1px solid rgba(22,101,52,0.2)',
          maxWidth: 900,
        }}
      >
        Métricas en vivo desde la API de Meta (Marketing API) para las cuentas publicitarias que elegiste al conectar. Los
        datos dependen del período seleccionado y pueden tardar unos segundos en cargar.
        {meta && (
          <span style={{ display: 'block', marginTop: 6, fontSize: 12, color: '#15803d' }}>
            Actualizado: {new Date(meta.fetchedAt).toLocaleString('es-ES')} · preset Meta: {meta.datePreset}
          </span>
        )}
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
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
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  background: active ? SHOPIFY_GREEN : '#e8eaef',
                  color: active ? '#fff' : '#333',
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
              border: `1px solid ${META_BLUE}44`,
              fontSize: 13,
              maxWidth: 280,
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
            padding: '8px 16px',
            borderRadius: 8,
            border: `1px solid ${META_BLUE}55`,
            background: CARD_BG,
            color: META_BLUE,
            fontWeight: 600,
            cursor: loading ? 'wait' : 'pointer',
            fontSize: 13,
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
          borderBottom: '2px solid #e2e5eb',
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
              fontSize: 14,
              fontWeight: level === t.id ? 700 : 500,
              color: level === t.id ? META_BLUE : '#6b7280',
              borderBottom: level === t.id ? `3px solid ${SHOPIFY_GREEN}` : '3px solid transparent',
              marginBottom: -2,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div
          style={{
            marginBottom: 16,
            padding: '12px 14px',
            borderRadius: 10,
            background: 'rgba(220,80,80,0.1)',
            color: '#991b1b',
            fontSize: 14,
          }}
        >
          {error}
          {code === 'no_ad_accounts' && (
            <div style={{ marginTop: 8, fontSize: 13 }}>
              Ve a la pestaña <strong>Conexión Meta ADS</strong> y elige al menos una cuenta publicitaria (o vuelve a
              conectar con token de usuario).
            </div>
          )}
        </div>
      )}

      {partialErrors.length > 0 && (
        <div
          style={{
            marginBottom: 12,
            fontSize: 13,
            color: '#92400e',
            background: 'rgba(234,179,8,0.12)',
            padding: '10px 12px',
            borderRadius: 8,
          }}
        >
          Algunas cuentas no devolvieron datos:{' '}
          {partialErrors.map((e) => (
            <span key={e.adAccountId} style={{ display: 'block' }}>
              {e.adAccountId}: {e.error}
            </span>
          ))}
        </div>
      )}

      {loading && !totals ? (
        <p style={{ color: '#6b7280' }}>Cargando métricas desde Meta…</p>
      ) : totals && metricCards.length > 0 ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 12,
            marginBottom: 20,
          }}
        >
          {metricCards.map((m) => (
            <div
              key={m.label}
              style={{
                background: CARD_BG,
                borderRadius: 12,
                padding: '12px 14px',
                border: '1px solid #e8eaef',
              }}
            >
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>{m.label}</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#111827' }}>{m.value}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div
        style={{
          background: CARD_BG,
          borderRadius: 12,
          border: '1px solid #e8eaef',
          overflow: 'auto',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 960 }}>
          <thead>
            <tr style={{ background: '#f8f9fb', textAlign: 'left' }}>
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
                    padding: '10px 12px',
                    fontWeight: 600,
                    color: '#374151',
                    borderBottom: '1px solid #e8eaef',
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
                  style={{ padding: 24, color: '#6b7280', textAlign: 'center' }}
                >
                  No hay filas con datos de insights en este período (puede que no haya entregas o que el token no tenga
                  permisos).
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={`${row.adAccountId}-${row.id}`} style={{ borderBottom: '1px solid #f0f1f4' }}>
                  <td style={{ padding: '10px 12px', maxWidth: 160 }} title={row.adAccountId}>
                    <div style={{ fontWeight: 600, color: '#1a1a2e' }}>{row.adAccountName}</div>
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>{row.adAccountId}</div>
                  </td>
                  <td style={{ padding: '10px 12px', maxWidth: 220 }}>
                    <div style={{ fontWeight: 600 }}>{row.name}</div>
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>id {row.id}</div>
                  </td>
                  <td style={{ padding: '10px 12px' }}>{row.status || '—'}</td>
                  {level !== 'campaigns' && (
                    <td style={{ padding: '10px 12px', fontSize: 11, color: '#6b7280', maxWidth: 100 }}>
                      {level === 'adsets' ? row.campaignId : row.adsetId}
                    </td>
                  )}
                  <td style={{ padding: '10px 12px' }}>{formatNumber(row.impressions)}</td>
                  <td style={{ padding: '10px 12px' }}>{formatNumber(row.clicks)}</td>
                  <td style={{ padding: '10px 12px' }}>{formatMoney2(row.spend)}</td>
                  <td style={{ padding: '10px 12px' }}>{formatMoney2(row.cpm)}</td>
                  <td style={{ padding: '10px 12px' }}>{formatPct(row.ctr)}</td>
                  <td style={{ padding: '10px 12px' }}>{row.roas > 0 ? `${row.roas.toFixed(2)}×` : '—'}</td>
                  <td style={{ padding: '10px 12px' }}>{row.purchases > 0 ? formatMoney2(row.cpa) : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
