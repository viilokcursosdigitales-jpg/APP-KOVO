import { useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import ConexionMetaADS from './ConexionMetaADS';
import AdsPowerCookiesPanel from './adspower/AdsPowerCookiesPanel';

const SIDEBAR_BG = '#1a1a2e';
const SHOPIFY_GREEN = '#96bf48';
const META_BLUE = '#1877f2';
const MAIN_BG = '#f4f5f7';
const CARD_BG = '#ffffff';

type PeriodKey = 'hoy' | '3d' | '7d' | '14d' | '30d' | 'custom';
type ProductKey = 'all' | 'crema' | 'serum' | 'kit';

const PERIOD_LABELS: Record<PeriodKey, string> = {
  hoy: 'Hoy',
  '3d': 'Últimos 3 días',
  '7d': 'Últimos 7 días',
  '14d': 'Últimos 14 días',
  '30d': 'Últimos 30 días',
  custom: 'Rango personalizado',
};

const PRODUCT_LABELS: Record<ProductKey, string> = {
  all: 'Todos los productos',
  crema: 'Crema facial',
  serum: 'Sérum',
  kit: 'Kit completo',
};

function periodFactor(p: PeriodKey): number {
  const map: Record<PeriodKey, number> = {
    hoy: 0.11,
    '3d': 0.32,
    '7d': 0.58,
    '14d': 0.78,
    '30d': 1,
    custom: 0.45,
  };
  return map[p];
}

function productFactor(pr: ProductKey): number {
  const map: Record<ProductKey, number> = {
    all: 1,
    crema: 0.44,
    serum: 0.36,
    kit: 0.26,
  };
  return map[pr];
}

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

function formatPct(n: number, decimals = 1): string {
  return `${n.toFixed(decimals)} %`;
}

type BadgeTone = 'good' | 'bad' | 'neutral';

function badgeToneRoas(roas: number): BadgeTone {
  if (roas >= 3.2) return 'good';
  if (roas < 2.1) return 'bad';
  return 'neutral';
}

function badgeToneCpa(cpa: number): BadgeTone {
  if (cpa <= 22) return 'good';
  if (cpa > 38) return 'bad';
  return 'neutral';
}

const badgeColors: Record<BadgeTone, { bg: string; color: string }> = {
  good: { bg: 'rgba(150, 191, 72, 0.2)', color: '#5a7a2a' },
  bad: { bg: 'rgba(220, 80, 80, 0.18)', color: '#b03030' },
  neutral: { bg: 'rgba(24, 119, 242, 0.15)', color: META_BLUE },
};

type CreativeMetrics = {
  impressions: number;
  spend: number;
  cpm: number;
  ctrLink: number;
  cpc: number;
  hookRate: number;
  videoRetention: number;
  roas: number;
  cpa: number;
  purchases: number;
};

type AdRow = {
  id: string;
  thumb: string;
  name: string;
  format: string;
  impressions: number;
  spend: number;
  cpm: number;
  ctrLink: number;
  cpc: number;
  hookRate: number;
  retention: number;
  roas: number;
  cpa: number;
};

function computeCreativeData(period: PeriodKey, product: ProductKey) {
  const f = periodFactor(period) * productFactor(product);
  const baseImp = 185000 * f;
  const spend = baseImp * 0.0072 * (1 + (product === 'kit' ? 0.08 : 0));
  const purchases = Math.max(12, Math.round(420 * f * (product === 'all' ? 1 : 0.85)));
  const revenue = purchases * (product === 'serum' ? 42 : product === 'kit' ? 89 : 34);
  const roas = revenue / Math.max(spend, 1);
  const cpa = spend / Math.max(purchases, 1);
  const ctrLink = 1.85 + f * 1.2 + (product === 'crema' ? 0.35 : 0);
  const hookRate = 28 + f * 14 + (product === 'kit' ? -3 : 2);
  const videoRetention = 22 + f * 18;
  const cpm = (spend / Math.max(baseImp, 1)) * 1000;
  const cpc = spend / Math.max(baseImp * (ctrLink / 100), 1);

  const metrics: CreativeMetrics = {
    impressions: Math.round(baseImp),
    spend,
    cpm,
    ctrLink,
    cpc,
    hookRate,
    videoRetention,
    roas,
    cpa,
    purchases,
  };

  const ads: AdRow[] = [
    {
      id: '1',
      thumb: '#5b8def',
      name: 'Video UGC antes/después',
      format: 'Reels',
      impressions: Math.round(baseImp * 0.28),
      spend: spend * 0.28,
      cpm: cpm * 0.92,
      ctrLink: ctrLink * 1.15,
      cpc: cpc * 0.88,
      hookRate: hookRate * 1.08,
      retention: videoRetention * 1.05,
      roas: roas * 1.12,
      cpa: cpa * 0.9,
    },
    {
      id: '2',
      thumb: SHOPIFY_GREEN,
      name: 'Carrusel beneficios piel',
      format: 'Carrusel',
      impressions: Math.round(baseImp * 0.22),
      spend: spend * 0.2,
      cpm: cpm * 1.05,
      ctrLink: ctrLink * 0.85,
      cpc: cpc * 1.1,
      hookRate: hookRate * 0.92,
      retention: videoRetention * 0.78,
      roas: roas * 0.88,
      cpa: cpa * 1.15,
    },
    {
      id: '3',
      thumb: '#e879a8',
      name: 'Estático promo 20 %',
      format: 'Imagen',
      impressions: Math.round(baseImp * 0.18),
      spend: spend * 0.17,
      cpm: cpm * 1.02,
      ctrLink: ctrLink * 0.95,
      cpc: cpc * 1.02,
      hookRate: hookRate * 0.65,
      retention: videoRetention * 0.5,
      roas: roas * 0.95,
      cpa: cpa * 1.05,
    },
    {
      id: '4',
      thumb: META_BLUE,
      name: 'Testimonio corto + CTA',
      format: 'Reels',
      impressions: Math.round(baseImp * 0.2),
      spend: spend * 0.21,
      cpm: cpm * 0.98,
      ctrLink: ctrLink * 1.22,
      cpc: cpc * 0.82,
      hookRate: hookRate * 1.15,
      retention: videoRetention * 1.12,
      roas: roas * 1.25,
      cpa: cpa * 0.82,
    },
    {
      id: '5',
      thumb: '#9b7ed9',
      name: 'Demostración textura',
      format: 'Reels',
      impressions: Math.round(baseImp * 0.12),
      spend: spend * 0.14,
      cpm: cpm * 1.12,
      ctrLink: ctrLink * 0.78,
      cpc: cpc * 1.18,
      hookRate: hookRate * 1.02,
      retention: videoRetention * 0.95,
      roas: roas * 0.9,
      cpa: cpa * 1.08,
    },
  ];

  return { metrics, ads };
}

type FunnelStage = { key: string; label: string; people: number };

function computeFunnelData(period: PeriodKey, product: ProductKey) {
  const f = periodFactor(period) * productFactor(product);
  const linkClicks = Math.round(8200 * f);
  const pageViews = Math.round(linkClicks * 0.72);
  const checkouts = Math.round(pageViews * 0.38);
  const paymentInfo = Math.round(checkouts * 0.62);
  const purchases = Math.max(8, Math.round(paymentInfo * 0.48));

  const spend = 185000 * f * 0.0072;
  const stages: FunnelStage[] = [
    { key: 'clicks', label: 'Clics al enlace', people: linkClicks },
    { key: 'pv', label: 'Vistas de página', people: pageViews },
    { key: 'co', label: 'Pagos iniciados', people: checkouts },
    { key: 'pi', label: 'Info pago agregada', people: paymentInfo },
    { key: 'pur', label: 'Compras', people: purchases },
  ];

  const drops: number[] = [];
  for (let i = 0; i < stages.length - 1; i++) {
    const from = stages[i].people;
    const to = stages[i + 1].people;
    drops.push(from > 0 ? ((from - to) / from) * 100 : 0);
  }

  const costPer = (count: number) => (count > 0 ? spend / count : 0);
  const revenue = purchases * (product === 'serum' ? 42 : product === 'kit' ? 89 : 34);
  const roas = revenue / Math.max(spend, 1);
  const cpa = spend / Math.max(purchases, 1);
  const convRate = linkClicks > 0 ? (purchases / linkClicks) * 100 : 0;

  return { stages, drops, spend, costPer, roas, cpa, convRate, purchases };
}

function MiniBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      style={{
        height: 6,
        borderRadius: 3,
        background: '#e8eaef',
        overflow: 'hidden',
        minWidth: 56,
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          borderRadius: 3,
          background: `linear-gradient(90deg, ${META_BLUE}, ${SHOPIFY_GREEN})`,
        }}
      />
    </div>
  );
}

function MetricBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  const c = badgeColors[tone];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        background: c.bg,
        color: c.color,
      }}
    >
      {children}
    </span>
  );
}

function FiltersBar(props: {
  period: PeriodKey;
  setPeriod: (p: PeriodKey) => void;
  product: ProductKey;
  setProduct: (p: ProductKey) => void;
}) {
  const periods: PeriodKey[] = ['hoy', '3d', '7d', '14d', '30d', 'custom'];
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 10,
        rowGap: 8,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: 6, overflowX: 'auto', flex: '1 1 auto', minWidth: 0 }}>
        {periods.map((key) => {
          const active = props.period === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => props.setPeriod(key)}
              style={{
                border: 'none',
                cursor: 'pointer',
                padding: '6px 14px',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                flexShrink: 0,
                background: active ? SHOPIFY_GREEN : '#e8eaef',
                color: active ? '#fff' : '#333',
                boxShadow: active ? `0 0 0 2px ${SHOPIFY_GREEN}44` : 'none',
              }}
            >
              {key === 'hoy'
                ? 'Hoy'
                : key === 'custom'
                  ? 'Personalizado'
                  : key.replace('d', ' días')}
            </button>
          );
        })}
      </div>
      <select
        value={props.product}
        onChange={(e) => props.setProduct(e.target.value as ProductKey)}
        style={{
          padding: '8px 12px',
          borderRadius: 8,
          border: `1px solid ${META_BLUE}44`,
          fontSize: 13,
          fontWeight: 500,
          color: '#1a1a2e',
          background: CARD_BG,
          cursor: 'pointer',
          minWidth: 160,
          flexShrink: 0,
        }}
      >
        <option value="all">Todos</option>
        <option value="crema">Crema facial</option>
        <option value="serum">Sérum</option>
        <option value="kit">Kit completo</option>
      </select>
    </div>
  );
}

function PeriodCaption({ period, product }: { period: PeriodKey; product: ProductKey }) {
  const extra =
    period === 'custom'
      ? ' · 1 mar 2026 – 8 abr 2026 (ejemplo)'
      : '';
  return (
    <p
      style={{
        margin: '10px 0 0',
        fontSize: 13,
        color: '#5c6370',
        textAlign: 'left',
      }}
    >
      <span style={{ color: META_BLUE, fontWeight: 600 }}>Período activo:</span>{' '}
      {PERIOD_LABELS[period]}
      {extra}
      {' · '}
      <span style={{ fontWeight: 500 }}>{PRODUCT_LABELS[product]}</span>
    </p>
  );
}

function TabCreativo({
  period,
  setPeriod,
  product,
  setProduct,
}: {
  period: PeriodKey;
  setPeriod: (p: PeriodKey) => void;
  product: ProductKey;
  setProduct: (p: ProductKey) => void;
}) {
  const { metrics, ads } = useMemo(
    () => computeCreativeData(period, product),
    [period, product],
  );

  const maxCtr = Math.max(...ads.map((a) => a.ctrLink), 1);
  const maxRet = Math.max(...ads.map((a) => a.retention), 1);

  const metricItems: { label: string; value: string; highlight?: boolean }[] = [
    { label: 'Impresiones', value: formatNumber(metrics.impressions) },
    { label: 'Gasto publicitario', value: formatMoney2(metrics.spend) },
    { label: 'CPM', value: formatMoney2(metrics.cpm) },
    { label: 'CTR enlace', value: formatPct(metrics.ctrLink) },
    { label: 'CPC', value: formatMoney2(metrics.cpc) },
    { label: 'Hook rate', value: formatPct(metrics.hookRate) },
    { label: 'Retención video', value: formatPct(metrics.videoRetention) },
    { label: 'ROAS', value: metrics.roas.toFixed(2) + '×', highlight: true },
    { label: 'CPA', value: formatMoney2(metrics.cpa), highlight: true },
    { label: 'Compras', value: formatNumber(metrics.purchases) },
  ];

  return (
    <div>
      <FiltersBar
        period={period}
        setPeriod={setPeriod}
        product={product}
        setProduct={setProduct}
      />
      <PeriodCaption period={period} product={product} />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 12,
          marginTop: 20,
        }}
      >
        {metricItems.map((m) => (
          <div
            key={m.label}
            style={{
              background: m.highlight
                ? `linear-gradient(135deg, ${SHOPIFY_GREEN}18, ${META_BLUE}12)`
                : CARD_BG,
              borderRadius: 12,
              padding: '14px 16px',
              textAlign: 'left',
              border: m.highlight ? `1px solid ${SHOPIFY_GREEN}55` : '1px solid #e8eaef',
              boxShadow: m.highlight ? `0 4px 14px ${SHOPIFY_GREEN}22` : '0 1px 3px rgba(0,0,0,0.06)',
            }}
          >
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>{m.label}</div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: m.highlight ? '#1a1a2e' : '#111827',
              }}
            >
              {m.value}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 24,
          background: CARD_BG,
          borderRadius: 12,
          border: '1px solid #e8eaef',
          overflow: 'auto',
        }}
      >
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 13,
            minWidth: 920,
          }}
        >
          <thead>
            <tr style={{ background: '#f8f9fb', textAlign: 'left' }}>
              {[
                'Anuncio',
                'Impresiones',
                'Gasto',
                'CPM',
                'CTR enlace',
                'CPC',
                'Hook rate',
                'Retención',
                'ROAS',
                'CPA',
              ].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: '12px 14px',
                    fontWeight: 600,
                    color: '#374151',
                    borderBottom: '1px solid #e8eaef',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ads.map((row) => (
              <tr key={row.id} style={{ borderBottom: '1px solid #f0f1f4' }}>
                <td style={{ padding: '12px 14px', verticalAlign: 'middle' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 8,
                        background: row.thumb,
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontWeight: 600, color: '#1a1a2e' }}>{row.name}</div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>{row.format}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '12px 14px' }}>{formatNumber(row.impressions)}</td>
                <td style={{ padding: '12px 14px' }}>{formatMoney2(row.spend)}</td>
                <td style={{ padding: '12px 14px' }}>{formatMoney2(row.cpm)}</td>
                <td style={{ padding: '12px 14px', minWidth: 120 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <MiniBar value={row.ctrLink} max={maxCtr} />
                    <span>{formatPct(row.ctrLink)}</span>
                  </div>
                </td>
                <td style={{ padding: '12px 14px' }}>{formatMoney2(row.cpc)}</td>
                <td style={{ padding: '12px 14px' }}>{formatPct(row.hookRate)}</td>
                <td style={{ padding: '12px 14px', minWidth: 120 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <MiniBar value={row.retention} max={maxRet} />
                    <span>{formatPct(row.retention)}</span>
                  </div>
                </td>
                <td style={{ padding: '12px 14px' }}>
                  <MetricBadge tone={badgeToneRoas(row.roas)}>{row.roas.toFixed(2)}×</MetricBadge>
                </td>
                <td style={{ padding: '12px 14px' }}>
                  <MetricBadge tone={badgeToneCpa(row.cpa)}>{formatMoney2(row.cpa)}</MetricBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabEmbudo({
  period,
  setPeriod,
  product,
  setProduct,
}: {
  period: PeriodKey;
  setPeriod: (p: PeriodKey) => void;
  product: ProductKey;
  setProduct: (p: ProductKey) => void;
}) {
  const data = useMemo(() => computeFunnelData(period, product), [period, product]);
  const { stages, drops, costPer, roas, cpa, convRate, purchases } = data;

  const cx = 200;
  const stageH = 64;
  const tops = [360, 300, 246, 200, 162];
  const bots = [300, 246, 200, 162, 130];

  const cards = stages.slice(0, -1).map((s, i) => ({
    title: s.label,
    people: s.people,
    cpu: costPer(s.people),
    note:
      i === 0
        ? 'Coste por clic cualificado al sitio.'
        : i === 1
          ? 'Tráfico que carga la ficha o colección.'
          : i === 2
            ? 'Intención de compra en checkout.'
            : 'Usuarios que completaron datos de pago.',
  }));

  return (
    <div>
      <FiltersBar
        period={period}
        setPeriod={setPeriod}
        product={product}
        setProduct={setProduct}
      />
      <PeriodCaption period={period} product={product} />

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 24,
          marginTop: 20,
          alignItems: 'flex-start',
        }}
      >
        <div style={{ flex: '1 1 380px', minWidth: 280 }}>
          <svg
            viewBox="0 0 400 520"
            width="100%"
            style={{ maxWidth: 420, display: 'block' }}
            aria-label="Embudo de conversión"
          >
            <defs>
              <linearGradient id="fgrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor={META_BLUE} stopOpacity={0.95} />
                <stop offset="100%" stopColor="#0d4a9c" stopOpacity={0.9} />
              </linearGradient>
            </defs>
            {stages.map((_, i) => {
              const y1 = 20 + i * (stageH + 36);
              const y2 = y1 + stageH;
              const tw = tops[i];
              const bw = bots[i];
              const pts = [
                [cx - tw / 2, y1],
                [cx + tw / 2, y1],
                [cx + bw / 2, y2],
                [cx - bw / 2, y2],
              ]
                .map((p) => p.join(','))
                .join(' ');
              return (
                <g key={stages[i].key}>
                  <polygon points={pts} fill="url(#fgrad)" stroke="#ffffff22" strokeWidth={1} />
                  <text
                    x={cx}
                    y={y1 + stageH / 2 - 6}
                    textAnchor="middle"
                    fill="#fff"
                    fontSize={15}
                    fontWeight={700}
                  >
                    {formatNumber(stages[i].people)}
                  </text>
                  <text
                    x={cx}
                    y={y1 + stageH / 2 + 12}
                    textAnchor="middle"
                    fill="#ffffffcc"
                    fontSize={11}
                    fontWeight={500}
                  >
                    {stages[i].label}
                  </text>
                </g>
              );
            })}
            {drops.map((d, i) => {
              const y = 20 + (i + 1) * (stageH + 36) - 18;
              return (
                <text
                  key={`drop-${i}`}
                  x={cx + tops[i] / 2 + 8}
                  y={y}
                  fill="#dc2626"
                  fontSize={12}
                  fontWeight={700}
                >
                  −{d.toFixed(1)} %
                </text>
              );
            })}
          </svg>
        </div>

        <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 260 }}>
          {cards.map((c) => (
            <div
              key={c.title}
              style={{
                background: CARD_BG,
                borderRadius: 12,
                padding: '14px 16px',
                border: '1px solid #e8eaef',
                textAlign: 'left',
              }}
            >
              <div style={{ fontSize: 12, color: META_BLUE, fontWeight: 700, marginBottom: 4 }}>{c.title}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#1a1a2e' }}>{formatNumber(c.people)} personas</div>
              <div style={{ fontSize: 14, color: '#374151', marginTop: 6 }}>
                {formatMoney2(c.cpu)} <span style={{ color: '#6b7280', fontWeight: 500 }}>/ persona</span>
              </div>
              <p style={{ margin: '10px 0 0', fontSize: 12, color: '#6b7280', lineHeight: 1.45 }}>{c.note}</p>
            </div>
          ))}

          <div
            style={{
              background: `linear-gradient(135deg, ${SHOPIFY_GREEN}14, #fff)`,
              borderRadius: 12,
              padding: '16px 18px',
              border: `2px solid ${SHOPIFY_GREEN}`,
              textAlign: 'left',
            }}
          >
            <div style={{ fontSize: 12, color: SHOPIFY_GREEN, fontWeight: 800, marginBottom: 4 }}>Compra</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#1a1a2e' }}>{formatNumber(purchases)} personas</div>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 14 }}>
                <span style={{ color: '#6b7280' }}>CPA: </span>
                <strong>{formatMoney2(cpa)}</strong>
              </div>
              <div style={{ fontSize: 14 }}>
                <span style={{ color: '#6b7280' }}>Tasa de conversión (clic → compra): </span>
                <strong>{formatPct(convRate, 2)}</strong>
              </div>
              <div style={{ fontSize: 14 }}>
                <span style={{ color: '#6b7280' }}>ROAS: </span>
                <strong style={{ color: META_BLUE }}>{roas.toFixed(2)}×</strong>
              </div>
            </div>
            <p style={{ margin: '12px 0 0', fontSize: 12, color: '#5c6370' }}>
              Resultado final del embudo: coste por adquisición y retorno sobre el gasto publicitario total del período.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

const navBtnBase = {
  margin: '0 12px',
  padding: '12px 16px',
  border: 'none',
  borderRadius: 10,
  cursor: 'pointer',
  textAlign: 'left' as const,
  fontSize: 14,
  textDecoration: 'none' as const,
  display: 'block' as const,
};

export function DashboardApp() {
  const { canManageOrg } = useAuth();
  const navItems: string[] = [
    'Dashboard',
    'Pedidos',
    'Meta Ads',
    'Inventario',
    ...(canManageOrg ? ['Configuración'] : []),
    'Cuenta',
  ];

  const [metaTab, setMetaTab] = useState<'creativo' | 'embudo' | 'conexion' | 'adspower'>('creativo');
  const [p1, setP1] = useState<PeriodKey>('7d');
  const [pr1, setPr1] = useState<ProductKey>('all');
  const [p2, setP2] = useState<PeriodKey>('7d');
  const [pr2, setPr2] = useState<ProductKey>('all');

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        width: '100%',
        maxWidth: '100%',
        margin: 0,
        textAlign: 'left',
        fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <aside
        style={{
          width: 220,
          flexShrink: 0,
          background: SIDEBAR_BG,
          padding: '24px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <Link
          to="/dashboard"
          style={{
            padding: '0 20px 20px',
            fontSize: 18,
            fontWeight: 800,
            color: '#fff',
            letterSpacing: '-0.02em',
            textDecoration: 'none',
          }}
        >
          KOVO
        </Link>
        {navItems.map((item) => {
          const active = item === 'Meta Ads';
          if (item === 'Cuenta') {
            return (
              <NavLink
                key={item}
                to="/profile"
                style={({ isActive }) => ({
                  ...navBtnBase,
                  fontWeight: isActive ? 700 : 500,
                  background: isActive ? `${META_BLUE}33` : 'transparent',
                  color: isActive ? '#fff' : '#a8b0c4',
                  borderLeft: isActive ? `3px solid ${SHOPIFY_GREEN}` : '3px solid transparent',
                })}
              >
                {item}
              </NavLink>
            );
          }
          if (item === 'Configuración') {
            return (
              <NavLink
                key={item}
                to="/settings"
                style={({ isActive }) => ({
                  ...navBtnBase,
                  fontWeight: isActive ? 700 : 500,
                  background: isActive ? `${META_BLUE}33` : 'transparent',
                  color: isActive ? '#fff' : '#a8b0c4',
                  borderLeft: isActive ? `3px solid ${SHOPIFY_GREEN}` : '3px solid transparent',
                })}
              >
                {item}
              </NavLink>
            );
          }
          return (
            <button
              key={item}
              type="button"
              style={{
                ...navBtnBase,
                fontWeight: active ? 700 : 500,
                background: active ? `${META_BLUE}33` : 'transparent',
                color: active ? '#fff' : '#a8b0c4',
                borderLeft: active ? `3px solid ${SHOPIFY_GREEN}` : '3px solid transparent',
              }}
            >
              {item}
            </button>
          );
        })}
      </aside>

      <main
        style={{
          flex: 1,
          background: MAIN_BG,
          padding: '28px 32px 40px',
          overflow: 'auto',
          minWidth: 0,
        }}
      >
        <div style={{ marginBottom: 8 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 26,
              fontWeight: 700,
              color: '#1a1a2e',
            }}
          >
            {metaTab === 'adspower' ? 'AdsPower' : 'Meta Ads'}
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: '#6b7280' }}>
            {metaTab === 'conexion'
              ? 'Vincula tu app de Facebook Developer y gestiona el acceso a tus anuncios'
              : metaTab === 'adspower'
                ? 'Vincula tu perfil y consulta el total de cookies vía Local API (servidor → AdsPower)'
                : 'Análisis de campañas y embudo de conversión'}
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 0,
            marginTop: 20,
            marginBottom: 22,
            borderBottom: '2px solid #e2e5eb',
          }}
        >
          {(
            [
              { id: 'creativo' as const, label: 'Análisis de creativo' },
              { id: 'embudo' as const, label: 'Análisis embudo' },
              { id: 'conexion' as const, label: 'Conexión Meta ADS' },
              { id: 'adspower' as const, label: 'AdsPower (cookies)' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setMetaTab(t.id)}
              style={{
                padding: '12px 20px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: metaTab === t.id ? 700 : 500,
                color: metaTab === t.id ? META_BLUE : '#6b7280',
                borderBottom: metaTab === t.id ? `3px solid ${SHOPIFY_GREEN}` : '3px solid transparent',
                marginBottom: -2,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {metaTab === 'creativo' ? (
          <TabCreativo period={p1} setPeriod={setP1} product={pr1} setProduct={setPr1} />
        ) : metaTab === 'embudo' ? (
          <TabEmbudo period={p2} setPeriod={setP2} product={pr2} setProduct={setPr2} />
        ) : metaTab === 'conexion' ? (
          <ConexionMetaADS />
        ) : (
          <AdsPowerCookiesPanel />
        )}
      </main>
    </div>
  );
}
