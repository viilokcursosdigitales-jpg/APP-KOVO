import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';
import { MetaDataIssueCard, MetaFetchErrorPanel, MetaLiveDataStrip } from './MetaApiStatusBanner';
import { MetaCampaignProductAssign } from './MetaCampaignProductAssign';
import {
  aggregateTargetsForProducts,
  campaignIdForInsightRow,
  evaluateInsightAgainstTargets,
  insightMetricCellBg,
  insightRowBg,
  type ProductMarketingTargets,
} from './marketingTargetEval';
import { formatMetaMoney } from './formatMetaMoney';
import { resolveMetaDataIssue } from './metaDataIssues';

export type MetaInsightPeriod = 'hoy' | 'ayer' | '3d' | '7d' | '14d' | '30d' | 'custom';

const PERIOD_LABELS: Record<MetaInsightPeriod, string> = {
  hoy: 'Hoy',
  ayer: 'Ayer',
  '3d': 'Últimos 3 días',
  '7d': 'Últimos 7 días',
  '14d': 'Últimos 14 días',
  '30d': 'Últimos 30 días',
  custom: 'Personalizado',
};

function formatNumber(n: number): string {
  return new Intl.NumberFormat('es-ES').format(Math.round(n));
}

const formatMoney2 = formatMetaMoney;

function formatPct(n: number, decimals = 2): string {
  return `${n.toFixed(decimals)} %`;
}

type InsightLevel = 'campaigns' | 'adsets' | 'ads';

type CampaignActivityFilter = 'active' | 'inactive' | 'all';

type ShopifyProductOption = { id: number; title: string };

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

function buildRowTargetEvaluation(
  row: InsightRow,
  level: InsightLevel,
  links: Record<string, number[]>,
  targetsByProduct: Record<number, ProductMarketingTargets>,
) {
  const cid = campaignIdForInsightRow(row, level);
  const pids = cid ? links[cid] || [] : [];
  if (pids.length === 0) {
    return {
      rowHighlight: 'neutral' as const,
      cpm: 'neutral' as const,
      ctr: 'neutral' as const,
      cpc: 'neutral' as const,
      roas: 'neutral' as const,
      cpa: 'neutral' as const,
      tooltip:
        'Vincula productos Shopify a esta campaña (columna Productos) para comparar con los objetivos de Indicadores de marketing.',
    };
  }
  const agg = aggregateTargetsForProducts(pids, targetsByProduct);
  return evaluateInsightAgainstTargets(
    {
      cpm: row.cpm,
      ctr: row.ctr,
      cpc: row.cpc,
      roas: row.roas,
      cpa: row.cpa,
      purchases: row.purchases,
    },
    agg,
  );
}

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
  const [campaignActivityFilter, setCampaignActivityFilter] = useState<CampaignActivityFilter>('active');
  const [filterProductId, setFilterProductId] = useState('');
  const [campaignProductLinks, setCampaignProductLinks] = useState<Record<string, number[]>>({});
  const [shopifyProducts, setShopifyProducts] = useState<ShopifyProductOption[]>([]);
  const [shopifyCatalogOk, setShopifyCatalogOk] = useState(false);
  const [targetsByProduct, setTargetsByProduct] = useState<Record<number, ProductMarketingTargets>>({});

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

  useEffect(() => {
    let c = false;
    (async () => {
      try {
        const res = await apiFetch('/api/meta/campaign-product-links');
        if (!res.ok || c) return;
        const data = (await res.json()) as { links?: Record<string, number[]> };
        if (c) return;
        const raw = data.links && typeof data.links === 'object' ? data.links : {};
        const next: Record<string, number[]> = {};
        for (const [k, v] of Object.entries(raw)) {
          if (Array.isArray(v)) {
            next[k] = v.map((x) => Number.parseInt(String(x), 10)).filter((n) => Number.isFinite(n));
          }
        }
        setCampaignProductLinks(next);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      c = true;
    };
  }, []);

  useEffect(() => {
    let c = false;
    (async () => {
      try {
        const res = await apiFetch('/api/shopify/products?limit=250');
        if (c) return;
        if (!res.ok) {
          setShopifyCatalogOk(false);
          setShopifyProducts([]);
          return;
        }
        const data = (await res.json()) as { products?: { id: number | string; title?: string }[] };
        const list = Array.isArray(data.products)
          ? data.products.map((p) => ({
              id: Number.parseInt(String(p.id), 10),
              title: String(p.title || '(sin título)'),
            }))
          : [];
        setShopifyCatalogOk(true);
        setShopifyProducts(list.filter((p) => Number.isFinite(p.id)));
      } catch {
        setShopifyCatalogOk(false);
        setShopifyProducts([]);
      }
    })();
    return () => {
      c = true;
    };
  }, []);

  useEffect(() => {
    let c = false;
    (async () => {
      try {
        const res = await apiFetch('/api/shopify/product-marketing-targets');
        if (!res.ok || c) return;
        const data = (await res.json()) as {
          targets?: {
            product_id: number;
            cpm_target: number | null;
            ctr_target: number | null;
            cpc_target: number | null;
            roas_target: number | null;
            cpa_target: number | null;
          }[];
        };
        const map: Record<number, ProductMarketingTargets> = {};
        for (const t of Array.isArray(data.targets) ? data.targets : []) {
          map[t.product_id] = {
            cpm_target: t.cpm_target,
            ctr_target: t.ctr_target,
            cpc_target: t.cpc_target,
            roas_target: t.roas_target,
            cpa_target: t.cpa_target,
          };
        }
        if (!c) setTargetsByProduct(map);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      c = true;
    };
  }, []);

  const handleCampaignProductsSaved = useCallback((campaignId: string, ids: number[]) => {
    setCampaignProductLinks((prev) => ({ ...prev, [campaignId]: ids }));
  }, []);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const st = String(row.status || '').toUpperCase();
      if (campaignActivityFilter === 'active' && st !== 'ACTIVE') return false;
      if (campaignActivityFilter === 'inactive' && st === 'ACTIVE') return false;

      if (!filterProductId.trim()) return true;
      const pid = Number.parseInt(filterProductId, 10);
      if (!Number.isFinite(pid)) return true;
      const cid = level === 'campaigns' ? String(row.id) : String(row.campaignId || '');
      if (!cid) return false;
      const linked = campaignProductLinks[cid] || [];
      return linked.includes(pid);
    });
  }, [rows, campaignActivityFilter, filterProductId, level, campaignProductLinks]);

  const displayTotals = useMemo(() => {
    const base = filteredRows.reduce(
      (acc, x) => ({
        impressions: acc.impressions + x.impressions,
        clicks: acc.clicks + x.clicks,
        spend: acc.spend + x.spend,
        purchases: acc.purchases + x.purchases,
        revenue: acc.revenue + x.revenue,
      }),
      { impressions: 0, clicks: 0, spend: 0, purchases: 0, revenue: 0 },
    );
    const cpm = base.impressions > 0 ? (base.spend / base.impressions) * 1000 : 0;
    const cpc = base.clicks > 0 ? base.spend / base.clicks : 0;
    const ctr = base.impressions > 0 ? (base.clicks / base.impressions) * 100 : 0;
    const roas = base.spend > 0 && base.revenue > 0 ? base.revenue / base.spend : 0;
    const cpa = base.purchases > 0 ? base.spend / base.purchases : 0;
    return { ...base, cpm, cpc, ctr, roas, cpa };
  }, [filteredRows]);

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

  const periods: MetaInsightPeriod[] = ['hoy', 'ayer', '3d', '7d', '14d', '30d', 'custom'];

  const metricCards = [
    { label: 'Impresiones', value: formatNumber(displayTotals.impressions) },
    { label: 'Clics', value: formatNumber(displayTotals.clicks) },
    { label: 'Gasto', value: formatMoney2(displayTotals.spend) },
    { label: 'CPM', value: formatMoney2(displayTotals.cpm) },
    { label: 'CPC', value: formatMoney2(displayTotals.cpc) },
    { label: 'CTR', value: formatPct(displayTotals.ctr) },
    { label: 'ROAS', value: displayTotals.roas > 0 ? `${displayTotals.roas.toFixed(2)}×` : '—' },
    { label: 'CPA', value: displayTotals.purchases > 0 ? formatMoney2(displayTotals.cpa) : '—' },
    { label: 'Compras (pixel)', value: formatNumber(displayTotals.purchases) },
  ];

  const levelTabs: { id: InsightLevel; label: string }[] = [
    { id: 'campaigns', label: 'Campañas' },
    { id: 'adsets', label: 'Conjuntos de anuncios' },
    { id: 'ads', label: 'Anuncios' },
  ];

  const dataIssue = useMemo(
    () => resolveMetaDataIssue(partialErrors, error, code),
    [partialErrors, error, code],
  );

  const activityFilterCopy = useMemo(() => {
    if (level === 'campaigns') {
      return {
        active: 'Solo campañas activas',
        inactive: 'Solo campañas no activas',
        all: 'Todas (activas y no activas)',
      };
    }
    if (level === 'adsets') {
      return {
        active: 'Solo conjuntos activos',
        inactive: 'Solo conjuntos no activos',
        all: 'Todos (activos y no activos)',
      };
    }
    return {
      active: 'Solo anuncios activos',
      inactive: 'Solo anuncios no activos',
      all: 'Todos (activos y no activos)',
    };
  }, [level]);

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
        <select
          value={campaignActivityFilter}
          onChange={(e) => setCampaignActivityFilter(e.target.value as CampaignActivityFilter)}
          title="Filtra por estado efectivo en Meta (campaña, conjunto o anuncio según la pestaña)"
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: `1px solid ${ds.borderCard}`,
            fontSize: 13,
            maxWidth: 240,
            background: ds.bgCard,
            color: ds.textPrimary,
          }}
        >
          <option value="active">{activityFilterCopy.active}</option>
          <option value="inactive">{activityFilterCopy.inactive}</option>
          <option value="all">{activityFilterCopy.all}</option>
        </select>
        <select
          value={filterProductId}
          onChange={(e) => setFilterProductId(e.target.value)}
          title="Muestra solo filas cuya campaña tiene vinculado este producto"
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: `1px solid ${ds.borderCard}`,
            fontSize: 13,
            maxWidth: 260,
            background: ds.bgCard,
            color: ds.textPrimary,
          }}
        >
          <option value="">Todos los productos</option>
          {shopifyProducts.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.title}
            </option>
          ))}
        </select>
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
      ) : totals ? (
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
                ...(level === 'campaigns' ? ['Productos (Shopify)'] : []),
                ...(level !== 'campaigns' ? ['ID ref.'] : []),
                'Impresiones',
                'Clics',
                'Gasto',
                'CPM',
                'CTR',
                'CPC',
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
            {filteredRows.length === 0 && !loading ? (
              <tr>
                <td
                  colSpan={12}
                  style={{ padding: 24, color: ds.textMuted, textAlign: 'center', fontSize: 13 }}
                >
                  {tokenBlocked ? (
                    <>
                      Meta no devolvió filas porque el access token no es válido.{' '}
                      <strong style={{ color: ds.textSecondary }}>Renueva el token</strong> en la pestaña Conexión Meta ADS
                      y vuelve a actualizar.
                    </>
                  ) : rows.length === 0 ? (
                    <>
                      No hay filas con datos de insights en este período (puede que no haya entregas o que el token no
                      tenga permisos).
                    </>
                  ) : (
                    <>
                      Ninguna fila coincide con los filtros de estado de campaña o producto. Prueba &quot;Todas las
                      campañas&quot; o &quot;Todos los productos&quot;.
                    </>
                  )}
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => {
                const ev = buildRowTargetEvaluation(row, level, campaignProductLinks, targetsByProduct);
                const rowBg = insightRowBg(ev.rowHighlight);
                return (
                  <tr
                    key={`${row.adAccountId}-${row.id}`}
                    style={{
                      borderBottom: `1px solid ${ds.borderRow}`,
                      background: rowBg,
                    }}
                    title={ev.tooltip}
                  >
                    <td style={{ padding: '12px 16px', maxWidth: 160 }} title={row.adAccountId}>
                      <div style={{ fontWeight: 600, fontSize: 12, color: ds.textPrimary }}>{row.adAccountName}</div>
                      <div style={{ fontSize: 10.5, color: ds.textHint }}>{row.adAccountId}</div>
                    </td>
                    <td style={{ padding: '12px 16px', maxWidth: 220 }}>
                      <div style={{ fontWeight: 600, fontSize: 12, color: ds.textPrimary }}>{row.name}</div>
                      <div style={{ fontSize: 10.5, color: ds.textHint }}>id {row.id}</div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>{row.status || '—'}</td>
                    {level === 'campaigns' ? (
                      <td style={{ padding: '12px 16px', verticalAlign: 'top' }}>
                        <MetaCampaignProductAssign
                          campaignId={String(row.id)}
                          productIds={campaignProductLinks[String(row.id)] || []}
                          products={shopifyProducts}
                          shopifyOk={shopifyCatalogOk}
                          onUpdate={handleCampaignProductsSaved}
                        />
                      </td>
                    ) : null}
                    {level !== 'campaigns' && (
                      <td style={{ padding: '12px 16px', fontSize: 11, color: ds.textMuted, maxWidth: 100 }}>
                        {level === 'adsets' ? row.campaignId : row.adsetId}
                      </td>
                    )}
                    <td style={{ padding: '12px 16px' }}>{formatNumber(row.impressions)}</td>
                    <td style={{ padding: '12px 16px' }}>{formatNumber(row.clicks)}</td>
                    <td style={{ padding: '12px 16px' }}>{formatMoney2(row.spend)}</td>
                    <td style={{ padding: '12px 16px', background: insightMetricCellBg(ev.cpm) }}>{formatMoney2(row.cpm)}</td>
                    <td style={{ padding: '12px 16px', background: insightMetricCellBg(ev.ctr) }}>{formatPct(row.ctr)}</td>
                    <td style={{ padding: '12px 16px', background: insightMetricCellBg(ev.cpc) }}>{formatMoney2(row.cpc)}</td>
                    <td style={{ padding: '12px 16px', background: insightMetricCellBg(ev.roas) }}>
                      {row.roas > 0 ? `${row.roas.toFixed(2)}×` : '—'}
                    </td>
                    <td style={{ padding: '12px 16px', background: insightMetricCellBg(ev.cpa) }}>
                      {row.purchases > 0 ? formatMoney2(row.cpa) : '—'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
