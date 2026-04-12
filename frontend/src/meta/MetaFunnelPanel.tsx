import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';
import { MetricPill } from '../design-system/MetricPill';
import type { MetaInsightPeriod } from './MetaInsightsPanel';

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

type Stage = { key: string; label: string; people: number };

const STAGE_NOTES: Record<string, string> = {
  imp: 'Alcance bruto de anuncios en el período.',
  clk: 'Clics en enlace u otros clics que Meta agrega en esta fila.',
  lpv: 'Vistas de landing o eventos de contenido (según pixel / CAPI).',
  atc: 'Eventos de añadir al carrito atribuidos.',
  ico: 'Inicios de checkout.',
  pur: 'Compras atribuidas (pixel, web o informadas por Meta).',
};

export function MetaFunnelPanel({
  period,
  setPeriod,
}: {
  period: MetaInsightPeriod;
  setPeriod: (p: MetaInsightPeriod) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [drops, setDrops] = useState<number[]>([]);
  const [spend, setSpend] = useState(0);
  const [purchases, setPurchases] = useState(0);
  const [linkClicks, setLinkClicks] = useState(0);
  const [convRate, setConvRate] = useState(0);
  const [cpa, setCpa] = useState(0);
  const [roas, setRoas] = useState(0);
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
      const q = new URLSearchParams({ period });
      if (filterActId) q.set('adAccountId', filterActId);
      const res = await apiFetch(`/api/meta/funnel?${q.toString()}`);
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        stages?: Stage[];
        drops?: number[];
        spend?: number;
        purchases?: number;
        linkClicks?: number;
        convRate?: number;
        cpa?: number;
        roas?: number;
        partialErrors?: { adAccountId: string; error: string }[];
        datePreset?: string;
        fetchedAt?: string;
      };
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'No se pudo cargar el embudo');
        setCode(typeof data.code === 'string' ? data.code : null);
        setStages([]);
        setDrops([]);
        setPartialErrors([]);
        setMeta(null);
        return;
      }
      setStages(Array.isArray(data.stages) ? data.stages : []);
      setDrops(Array.isArray(data.drops) ? data.drops : []);
      setSpend(typeof data.spend === 'number' ? data.spend : 0);
      setPurchases(typeof data.purchases === 'number' ? data.purchases : 0);
      setLinkClicks(typeof data.linkClicks === 'number' ? data.linkClicks : 0);
      setConvRate(typeof data.convRate === 'number' ? data.convRate : 0);
      setCpa(typeof data.cpa === 'number' ? data.cpa : 0);
      setRoas(typeof data.roas === 'number' ? data.roas : 0);
      setPartialErrors(Array.isArray(data.partialErrors) ? data.partialErrors : []);
      setMeta(
        data.datePreset && data.fetchedAt
          ? { datePreset: data.datePreset, fetchedAt: data.fetchedAt }
          : null,
      );
    } catch {
      setError('Error de red');
      setStages([]);
    } finally {
      setLoading(false);
    }
  }, [period, filterActId]);

  useEffect(() => {
    void load();
  }, [load]);

  const periods: MetaInsightPeriod[] = ['hoy', '3d', '7d', '14d', '30d', 'custom'];
  const n = stages.length;
  const maxP = Math.max(...stages.map((s) => s.people), 1);
  const maxW = 360;
  const minW = 72;
  const tops = stages.map((s) => minW + (maxW - minW) * Math.pow(Math.max(s.people, 0) / maxP, 0.92));
  const cx = 200;
  const stageH = 50;
  const gap = 24;

  const cards = stages.slice(0, -1).map((s, i) => ({
    title: s.label,
    people: s.people,
    cpu: s.people > 0 ? spend / s.people : 0,
    note: STAGE_NOTES[s.key] || '',
  }));

  return (
    <div>
      <p
        style={{
          margin: '0 0 12px',
          fontSize: 13,
          color: ds.infoText,
          background: ds.infoBg,
          padding: '10px 14px',
          borderRadius: 8,
          border: `1px solid ${ds.borderCard}`,
          maxWidth: 920,
        }}
      >
        Embudo construido con los <strong>actions</strong> agregados que devuelve Meta por cuenta (insights a nivel
        cuenta). Los nombres de eventos dependen de tu pixel / CAPI; si falta un paso, verás 0 en esa etapa.
        {meta && (
          <span style={{ display: 'block', marginTop: 6, fontSize: 12, color: ds.infoText }}>
            Actualizado: {new Date(meta.fetchedAt).toLocaleString('es-ES')} · preset: {meta.datePreset}
          </span>
        )}
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 14 }}>
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
          {loading ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>

      {error && (
        <div
          style={{
            marginBottom: 16,
            padding: '12px 14px',
            borderRadius: 8,
            background: ds.dangerBg,
            color: ds.dangerText,
            fontSize: 13,
          }}
        >
          {error}
          {code === 'no_ad_accounts' && (
            <div style={{ marginTop: 8, fontSize: 13 }}>
              Configura cuentas en <strong>Conexión Meta ADS</strong>.
            </div>
          )}
        </div>
      )}

      {partialErrors.length > 0 && (
        <div
          style={{
            marginBottom: 12,
            fontSize: 13,
            color: ds.warningText,
            background: ds.warningBg,
            padding: '10px 12px',
            borderRadius: 8,
            border: `1px solid ${ds.borderCard}`,
          }}
        >
          {partialErrors.map((e) => (
            <span key={e.adAccountId} style={{ display: 'block' }}>
              {e.adAccountId}: {e.error}
            </span>
          ))}
        </div>
      )}

      {loading && stages.length === 0 ? (
        <p style={{ color: ds.textMuted }}>Cargando embudo…</p>
      ) : (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 24,
            marginTop: 12,
            alignItems: 'flex-start',
          }}
        >
          <div style={{ flex: '1 1 380px', minWidth: 280 }}>
            <svg
              viewBox={`0 0 400 ${20 + n * (stageH + gap) + 20}`}
              width="100%"
              style={{ maxWidth: 420, display: 'block' }}
              aria-label="Embudo de conversión Meta"
            >
              {stages.map((st, i) => {
                const y1 = 20 + i * (stageH + gap);
                const y2 = y1 + stageH;
                const tw = tops[i];
                const bw = i < n - 1 ? tops[i + 1] : Math.max(tw * 0.78, minW);
                const pts = [
                  [cx - tw / 2, y1],
                  [cx + tw / 2, y1],
                  [cx + bw / 2, y2],
                  [cx - bw / 2, y2],
                ]
                  .map((p) => p.join(','))
                  .join(' ');
                const dark = i % 2 === 0;
                return (
                  <g key={st.key}>
                    <polygon
                      points={pts}
                      fill={dark ? '#6c47ff' : '#e8e3ff'}
                      stroke="#f0f0f0"
                      strokeWidth={1}
                    />
                    <text
                      x={cx}
                      y={y1 + stageH / 2 - 6}
                      textAnchor="middle"
                      fill={dark ? '#ffffff' : '#111111'}
                      fontSize={14}
                      fontWeight={700}
                    >
                      {formatNumber(st.people)}
                    </text>
                    <text
                      x={cx}
                      y={y1 + stageH / 2 + 10}
                      textAnchor="middle"
                      fill={dark ? '#f0f0f0' : ds.textSecondary}
                      fontSize={10}
                      fontWeight={500}
                    >
                      {st.label.length > 22 ? `${st.label.slice(0, 20)}…` : st.label}
                    </text>
                  </g>
                );
              })}
              {drops.map((d, i) => {
                const y = 20 + (i + 1) * (stageH + gap) - 14;
                const tw = tops[i];
                return (
                  <text
                    key={`drop-${i}`}
                    x={cx + tw / 2 + 6}
                    y={y}
                    fill="#a32d2d"
                    fontSize={11}
                    fontWeight={700}
                  >
                    −{d.toFixed(1)} %
                  </text>
                );
              })}
            </svg>
          </div>

          <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 260 }}>
            {cards.map((c) => (
              <div
                key={c.title}
                style={{
                  background: ds.bgCard,
                  borderRadius: 14,
                  padding: '18px 20px',
                  border: `1px solid ${ds.borderCard}`,
                  textAlign: 'left',
                }}
              >
                <div style={{ fontSize: 12, color: ds.brand, fontWeight: 600, marginBottom: 4 }}>{c.title}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: ds.textPrimary }}>{formatNumber(c.people)} eventos</div>
                <div style={{ fontSize: 13, color: ds.textSecondary, marginTop: 6 }}>
                  {formatMoney2(c.cpu)}{' '}
                  <span style={{ color: ds.textMuted, fontWeight: 500 }}>/ evento (gasto total)</span>
                </div>
                <p style={{ margin: '10px 0 0', fontSize: 11, color: ds.textMuted, lineHeight: 1.45 }}>{c.note}</p>
              </div>
            ))}

            <div
              style={{
                background: ds.brandBg,
                borderRadius: 14,
                padding: '18px 20px',
                border: `1px solid ${ds.brandPale}`,
                textAlign: 'left',
              }}
            >
              <div style={{ fontSize: 12, color: ds.brand, fontWeight: 600, marginBottom: 4 }}>Compras (Meta)</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: ds.textPrimary }}>{formatNumber(purchases)} eventos</div>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                <div>
                  <span style={{ color: ds.textMuted }}>Gasto período: </span>
                  <strong style={{ fontWeight: 600, color: ds.textPrimary }}>{formatMoney2(spend)}</strong>
                </div>
                <div>
                  <span style={{ color: ds.textMuted }}>CPA (gasto / compras): </span>
                  <strong style={{ fontWeight: 600, color: ds.textPrimary }}>
                    {purchases > 0 ? formatMoney2(cpa) : '—'}
                  </strong>
                </div>
                <div>
                  <span style={{ color: ds.textMuted }}>Clic → compra: </span>
                  <strong style={{ fontWeight: 600, color: ds.textPrimary }}>{formatPct(convRate, 2)}</strong>
                  <span style={{ color: ds.textHint, fontSize: 11 }}> ({formatNumber(linkClicks)} clics)</span>
                </div>
                <div>
                  <span style={{ color: ds.textMuted }}>ROAS (valor compras / gasto): </span>
                  {roas > 0 ? <MetricPill>{`${roas.toFixed(2)}×`}</MetricPill> : <strong>—</strong>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
