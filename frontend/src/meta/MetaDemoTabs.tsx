import { useMemo } from 'react';
import ConexionMetaADS from '../ConexionMetaADS';
import { ds } from '../design-system/ds';
import { MetricPill } from '../design-system/MetricPill';
import { DataTable, Th, Td, tableBase } from '../design-system/DataTable';
import { MetaFunnelPanel } from './MetaFunnelPanel';
import { MetaInsightsPanel } from './MetaInsightsPanel';
import { useMetaInsightsReady } from './useMetaInsightsReady';
import {
  computeCreativeData,
  computeFunnelData,
  formatMoney2,
  formatNumber,
  formatPct,
  PERIOD_LABELS,
  PRODUCT_LABELS,
  type PeriodKey,
  type ProductKey,
} from './demoMetrics';

function MiniBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      style={{
        height: 6,
        borderRadius: 6,
        background: ds.borderSide,
        overflow: 'hidden',
        minWidth: 56,
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          borderRadius: 6,
          background: ds.brand,
        }}
      />
    </div>
  );
}

function FiltersBar(props: {
  period: PeriodKey;
  setPeriod: (p: PeriodKey) => void;
  product: ProductKey;
  setProduct: (p: ProductKey) => void;
}) {
  const periods: PeriodKey[] = ['hoy', 'ayer', '3d', '7d', '14d', '30d', 'custom'];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, rowGap: 8 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'nowrap',
          alignItems: 'center',
          gap: 3,
          padding: 3,
          border: `1px solid ${ds.borderCard}`,
          borderRadius: 24,
          background: ds.bgCard,
          overflowX: 'auto',
          flex: '1 1 auto',
          minWidth: 0,
        }}
      >
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
                padding: '6px 12px',
                borderRadius: 21,
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                whiteSpace: 'nowrap',
                flexShrink: 0,
                background: active ? ds.brand : 'transparent',
                color: active ? '#ffffff' : ds.textMuted,
              }}
            >
              {key === 'hoy'
                ? 'Hoy'
                : key === 'ayer'
                  ? 'Ayer'
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
          border: `1px solid ${ds.borderCard}`,
          fontSize: 13,
          fontWeight: 500,
          color: ds.textPrimary,
          background: ds.bgCard,
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
  const extra = period === 'custom' ? ' · 1 mar 2026 – 8 abr 2026 (ejemplo)' : '';
  return (
    <p style={{ margin: '10px 0 0', fontSize: 13, color: ds.textSecondary, textAlign: 'left' }}>
      <span style={{ color: ds.brand, fontWeight: 600 }}>Período activo:</span> {PERIOD_LABELS[period]}
      {extra} · <span style={{ fontWeight: 500 }}>{PRODUCT_LABELS[product]}</span>
    </p>
  );
}

function DemoKpiTile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      style={{
        background: highlight ? ds.brandBg : ds.bgCard,
        borderRadius: 14,
        padding: '18px 20px',
        textAlign: 'left',
        border: `1px solid ${highlight ? ds.brandPale : ds.borderCard}`,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 500, color: ds.textMuted, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: ds.textPrimary }}>{value}</div>
    </div>
  );
}

export function TabCreativo({
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
  const metaLive = useMetaInsightsReady();
  const { metrics, ads } = useMemo(() => computeCreativeData(period, product), [period, product]);
  const maxCtr = Math.max(...ads.map((a) => a.ctrLink), 1);
  const maxRet = Math.max(...ads.map((a) => a.retention), 1);

  const tiles: { label: string; value: string; highlight?: boolean }[] = [
    { label: 'Impresiones', value: formatNumber(metrics.impressions) },
    { label: 'Gasto publicitario', value: formatMoney2(metrics.spend) },
    { label: 'CPM', value: formatMoney2(metrics.cpm) },
    { label: 'CTR enlace', value: formatPct(metrics.ctrLink, 1) },
    { label: 'CPC', value: formatMoney2(metrics.cpc) },
    { label: 'Hook rate', value: formatPct(metrics.hookRate, 1) },
    { label: 'Retención video', value: formatPct(metrics.videoRetention, 1) },
    { label: 'ROAS', value: `${Math.round(metrics.roas)}×`, highlight: true },
    { label: 'CPA', value: formatMoney2(metrics.cpa), highlight: true },
    { label: 'Compras', value: formatNumber(metrics.purchases) },
  ];

  if (metaLive === 'loading') {
    return (
      <div style={{ padding: 24, color: ds.textMuted, fontSize: 13 }}>Comprobando conexión Meta…</div>
    );
  }

  if (metaLive === 'yes') {
    return <MetaInsightsPanel period={period} setPeriod={setPeriod} />;
  }

  return (
    <div>
      <FiltersBar period={period} setPeriod={setPeriod} product={product} setProduct={setProduct} />
      <PeriodCaption period={period} product={product} />
      <p style={{ margin: '12px 0 0', fontSize: 13, color: ds.textSecondary, lineHeight: 1.45, maxWidth: 720 }}>
        Vista de demostración: los números y anuncios listados se generan en la app según período y producto. Las métricas
        reales aparecen <strong>en esta misma pestaña</strong> cuando en <strong>Conexión Meta ADS</strong> guardas{' '}
        <strong>token de usuario</strong> y al menos una cuenta publicitaria seleccionada.
      </p>

      <div className="kovo-kpi-grid">
        {tiles.map((m) => (
          <DemoKpiTile key={m.label} label={m.label} value={m.value} highlight={m.highlight} />
        ))}
      </div>

      <div style={{ marginTop: 24 }}>
        <DataTable title="Rendimiento por anuncio" subtitle="Datos de ejemplo · demo">
          <table style={{ ...tableBase, minWidth: 920 }}>
            <thead>
              <tr>
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
                  <Th key={h}>{h}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ads.map((row, idx) => (
                <tr key={row.id}>
                  <Td isLast={idx === ads.length - 1}>
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
                        <div style={{ fontWeight: 600, fontSize: 12, color: ds.textPrimary }}>{row.name}</div>
                        <div style={{ fontSize: 10.5, color: ds.textHint }}>{row.format}</div>
                      </div>
                    </div>
                  </Td>
                  <Td isLast={idx === ads.length - 1}>{formatNumber(row.impressions)}</Td>
                  <Td isLast={idx === ads.length - 1}>{formatMoney2(row.spend)}</Td>
                  <Td isLast={idx === ads.length - 1}>{formatMoney2(row.cpm)}</Td>
                  <Td isLast={idx === ads.length - 1}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <MiniBar value={row.ctrLink} max={maxCtr} />
                      <span>{formatPct(row.ctrLink, 1)}</span>
                    </div>
                  </Td>
                  <Td isLast={idx === ads.length - 1}>{formatMoney2(row.cpc)}</Td>
                  <Td isLast={idx === ads.length - 1}>{formatPct(row.hookRate, 1)}</Td>
                  <Td isLast={idx === ads.length - 1}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <MiniBar value={row.retention} max={maxRet} />
                      <span>{formatPct(row.retention, 1)}</span>
                    </div>
                  </Td>
                  <Td isLast={idx === ads.length - 1}>
                    <MetricPill>{Math.round(row.roas)}×</MetricPill>
                  </Td>
                  <Td isLast={idx === ads.length - 1}>{formatMoney2(row.cpa)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      </div>
    </div>
  );
}

export function TabEmbudo({
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
  const metaLive = useMetaInsightsReady();
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

  if (metaLive === 'loading') {
    return (
      <div style={{ padding: 24, color: ds.textMuted, fontSize: 13 }}>Comprobando conexión Meta…</div>
    );
  }

  if (metaLive === 'yes') {
    return <MetaFunnelPanel period={period} setPeriod={setPeriod} />;
  }

  return (
    <div>
      <FiltersBar period={period} setPeriod={setPeriod} product={product} setProduct={setProduct} />
      <PeriodCaption period={period} product={product} />
      <p style={{ margin: '12px 0 0', fontSize: 13, color: ds.textSecondary, lineHeight: 1.45, maxWidth: 720 }}>
        Vista de demostración: el embudo y los costes son <strong>datos de ejemplo</strong>. El embudo real aparece aquí
        con token y cuentas configuradas en <strong>Conexión Meta ADS</strong>.
      </p>

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
          <svg viewBox="0 0 400 520" width="100%" style={{ maxWidth: 420, display: 'block' }} aria-label="Embudo de conversión">
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
              const dark = i % 2 === 0;
              return (
                <g key={stages[i].key}>
                  <polygon
                    points={pts}
                    fill={dark ? '#6c47ff' : '#e8e3ff'}
                    stroke={ds.borderSide}
                    strokeWidth={1}
                  />
                  <text
                    x={cx}
                    y={y1 + stageH / 2 - 6}
                    textAnchor="middle"
                    fill={dark ? '#ffffff' : ds.textPrimary}
                    fontSize={14}
                    fontWeight={700}
                  >
                    {formatNumber(stages[i].people)}
                  </text>
                  <text
                    x={cx}
                    y={y1 + stageH / 2 + 12}
                    textAnchor="middle"
                    fill={dark ? '#f0f0f0' : ds.textSecondary}
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
                <text key={`drop-${i}`} x={cx + tops[i] / 2 + 8} y={y} fill={ds.dangerText} fontSize={12} fontWeight={700}>
                  −{d.toFixed(1)}%
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
              <div style={{ fontSize: 22, fontWeight: 700, color: ds.textPrimary }}>{formatNumber(c.people)} personas</div>
              <div style={{ fontSize: 13, color: ds.textSecondary, marginTop: 6 }}>
                {formatMoney2(c.cpu)} <span style={{ color: ds.textMuted, fontWeight: 500 }}>/ persona</span>
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
            <div style={{ fontSize: 12, color: ds.brand, fontWeight: 600, marginBottom: 4 }}>Compra</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: ds.textPrimary }}>{formatNumber(purchases)} personas</div>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
              <div>
                <span style={{ color: ds.textMuted }}>CPA: </span>
                <strong style={{ fontWeight: 600, color: ds.textPrimary }}>{formatMoney2(cpa)}</strong>
              </div>
              <div>
                <span style={{ color: ds.textMuted }}>Tasa de conversión (clic → compra): </span>
                <strong style={{ fontWeight: 600, color: ds.textPrimary }}>{formatPct(convRate)}</strong>
              </div>
              <div>
                <span style={{ color: ds.textMuted }}>ROAS: </span>
                <MetricPill>{Math.round(roas)}×</MetricPill>
              </div>
            </div>
            <p style={{ margin: '12px 0 0', fontSize: 11, color: ds.textMuted }}>
              Resultado final del embudo: coste por adquisición y retorno sobre el gasto publicitario total del período.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MetaConnectionPanel() {
  return <ConexionMetaADS />;
}
