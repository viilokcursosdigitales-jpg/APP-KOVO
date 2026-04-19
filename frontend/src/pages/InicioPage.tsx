import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';

type PeriodKey = 'hoy' | 'ayer' | '7d';

type SeriesByProduct = {
  label?: string;
  product_id?: number | null;
  ventas_despachadas_total?: number;
  costo_producto_entregado_total?: number;
  costo_flete_promedio_total?: number;
};

type SeriesDay = {
  date: string;
  ventas_despachadas_total: number;
  ventas_entregadas_total: number;
  gasto_publicitario_total: number;
  utilidad: number | null;
  by_product?: Record<string, SeriesByProduct>;
};

type SeriesPayload = {
  days?: SeriesDay[];
  error?: string;
};

type MetaSpendPayload = {
  product_spend?: Record<string, number>;
};

type MetaCtrComparePayload = {
  current_ctr?: number | null;
  previous_ctr?: number | null;
};

type ProductAgg = {
  key: string;
  name: string;
  ventas: number;
  gastoAds: number;
  costoEq: number;
  roas: number;
  roasEq: number;
  profit: number;
};
type InicioUtilidadCacheEntry = {
  adminPercent: number;
  utilidadNeta: number;
  utilidadDelta: number | null;
  updatedAt: number;
};
type InicioUtilidadCacheMap = Partial<Record<PeriodKey, InicioUtilidadCacheEntry>>;
const INICIO_UTILIDAD_CACHE_KEY = 'kovo_inicio_utilidad_cache_v1';

function monthKeys(count: number): string {
  const now = new Date();
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    out.push(`${y}-${m}`);
  }
  return out.join(',');
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

function parsePercentInput(raw: string): number {
  const n = Number.parseFloat(String(raw || '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function utilidadConAdmin(row: SeriesDay, adminPercent: number): number {
  const base = Number(row.utilidad || 0);
  const ventasEntregadas = Number(row.ventas_entregadas_total || row.ventas_despachadas_total || 0);
  return base - ventasEntregadas * (adminPercent / 100);
}

function normalize(values: number[]): number[] {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return values.map(() => 0.55);
  return values.map((v) => (v - min) / (max - min));
}

function linePath(values: number[], width: number, height: number): string {
  if (!values.length) return '';
  return values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * width;
      const y = height - v * height;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

function dayLabel(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-CO', { weekday: 'narrow' }).format(new Date(`${iso}T12:00:00`));
  } catch {
    return 'D';
  }
}

function periodConfig(period: PeriodKey): {
  currentStart: number;
  currentLen: number;
  prevStart: number;
  prevLen: number;
  months: number;
  seriesPeriod: string;
  metaPeriod: string;
} {
  if (period === 'hoy') {
    return {
      currentStart: 0,
      currentLen: 1,
      prevStart: 1,
      prevLen: 1,
      months: 1,
      seriesPeriod: '3d',
      metaPeriod: 'hoy',
    };
  }
  if (period === 'ayer') {
    return {
      currentStart: 1,
      currentLen: 1,
      prevStart: 2,
      prevLen: 1,
      months: 1,
      seriesPeriod: '3d',
      metaPeriod: 'ayer',
    };
  }
  return {
    currentStart: 0,
    currentLen: 7,
    prevStart: 7,
    prevLen: 7,
    months: 2,
    seriesPeriod: '14d',
    metaPeriod: '7d',
  };
}

function deltaPct(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function deltaTag(n: number | null): React.ReactNode {
  if (n == null) return <span style={{ fontSize: 12, color: ds.textHint }}>Sin base de comparación</span>;
  const up = n >= 0;
  return (
    <span style={{ fontSize: 12, color: up ? ds.successText : ds.dangerText }}>
      {up ? '+' : ''}
      {n.toFixed(1)}% vs. período anterior
    </span>
  );
}

function Kpi({
  title,
  value,
  tag,
}: {
  title: string;
  value: string;
  tag?: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: ds.bgCard,
        border: `1px solid ${ds.borderCard}`,
        borderRadius: 12,
        padding: '12px 14px',
      }}
    >
      <div style={{ fontSize: 12, color: ds.textMuted, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: ds.textPrimary, marginBottom: 8 }}>{value}</div>
      {tag}
    </div>
  );
}

export default function InicioPage() {
  const [period, setPeriod] = useState<PeriodKey>('ayer');
  const [loading, setLoading] = useState(true);
  const [secondaryReady, setSecondaryReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<SeriesDay[]>([]);
  const [adminPercentInput, setAdminPercentInput] = useState(() => {
    try {
      return localStorage.getItem('kovo_ganancia_admin_percent') || '0';
    } catch {
      return '0';
    }
  });
  const [metaSpend, setMetaSpend] = useState<Record<string, number>>({});
  const [ctrCurrent, setCtrCurrent] = useState<number | null>(null);
  const [ctrPrevious, setCtrPrevious] = useState<number | null>(null);
  const [utilidadCache, setUtilidadCache] = useState<InicioUtilidadCacheMap>(() => {
    try {
      const raw = localStorage.getItem(INICIO_UTILIDAD_CACHE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as InicioUtilidadCacheMap;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  });
  const loadSeqRef = useRef(0);
  const adminPercent = useMemo(() => parsePercentInput(adminPercentInput), [adminPercentInput]);

  useEffect(() => {
    try {
      localStorage.setItem('kovo_ganancia_admin_percent', adminPercentInput);
    } catch {
      /* noop */
    }
  }, [adminPercentInput]);

  const load = useCallback(async () => {
    loadSeqRef.current += 1;
    const seq = loadSeqRef.current;
    setLoading(true);
    setSecondaryReady(false);
    setError(null);
    setCtrCurrent(null);
    setCtrPrevious(null);
    setMetaSpend({});
    try {
      const cfg = periodConfig(period);
      const monthsCsv = monthKeys(cfg.months);
      const seriesRes = await apiFetch(
        `/api/ganancia-diaria/series?meta_period=${encodeURIComponent(cfg.seriesPeriod)}&months=${encodeURIComponent(monthsCsv)}`,
      );

      const seriesData = (await seriesRes.json().catch(() => ({}))) as SeriesPayload;
      if (!seriesRes.ok) {
        setError(typeof seriesData.error === 'string' ? seriesData.error : 'No se pudo cargar Inicio');
        setDays([]);
        return;
      }

      setDays(Array.isArray(seriesData.days) ? seriesData.days : []);
      // Los secundarios no bloquean la primera pintura del dashboard.
      void apiFetch(`/api/meta/ctr-compare?period=${cfg.metaPeriod}`)
        .then(async (ctrCompareRes) => {
          const ctrCompareData = (await ctrCompareRes.json().catch(() => ({}))) as MetaCtrComparePayload;
          setCtrCurrent(
            ctrCompareRes.ok && Number.isFinite(Number(ctrCompareData?.current_ctr))
              ? Number(ctrCompareData.current_ctr)
              : null,
          );
          setCtrPrevious(
            ctrCompareRes.ok && Number.isFinite(Number(ctrCompareData?.previous_ctr))
              ? Number(ctrCompareData.previous_ctr)
              : null,
          );
        })
        .catch(() => {
          setCtrCurrent(null);
          setCtrPrevious(null);
        });
      void apiFetch(`/api/product-analytics/meta-spend?period=${cfg.metaPeriod}`)
        .then(async (spendRes) => {
          const spendData = (await spendRes.json().catch(() => ({}))) as MetaSpendPayload;
          setMetaSpend(spendRes.ok && spendData.product_spend ? spendData.product_spend : {});
        })
        .catch(() => {
          setMetaSpend({});
        });
    } catch {
      setError('Error de red cargando datos de Inicio');
      setDays([]);
    } finally {
      setLoading(false);
      window.setTimeout(() => {
        if (loadSeqRef.current === seq) setSecondaryReady(true);
      }, 120);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const cfg = periodConfig(period);
    return [...days].slice(cfg.currentStart, cfg.currentStart + cfg.currentLen);
  }, [days, period]);
  const previousFiltered = useMemo(() => {
    const cfg = periodConfig(period);
    return [...days].slice(cfg.prevStart, cfg.prevStart + cfg.prevLen);
  }, [days, period]);

  const filteredAsc = useMemo(() => [...filtered].reverse(), [filtered]);

  const ventas = filtered.reduce((s, d) => s + Number(d.ventas_despachadas_total || 0), 0);
  const gastoAds = filtered.reduce((s, d) => s + Number(d.gasto_publicitario_total || 0), 0);
  const utilidadNeta = filtered.reduce((s, d) => s + utilidadConAdmin(d, adminPercent), 0);
  const roas = gastoAds > 0 ? ventas / gastoAds : 0;
  const prevVentas = previousFiltered.reduce((s, d) => s + Number(d.ventas_despachadas_total || 0), 0);
  const prevGastoAds = previousFiltered.reduce((s, d) => s + Number(d.gasto_publicitario_total || 0), 0);
  const prevUtilidadNeta = previousFiltered.reduce((s, d) => s + utilidadConAdmin(d, adminPercent), 0);
  const prevRoas = prevGastoAds > 0 ? prevVentas / prevGastoAds : 0;

  const ventasDelta = deltaPct(ventas, prevVentas);
  const gastoDelta = deltaPct(gastoAds, prevGastoAds);
  const roasDelta = deltaPct(roas, prevRoas);
  const utilidadDelta = deltaPct(utilidadNeta, prevUtilidadNeta);
  const cachedUtilidad = useMemo(() => {
    const entry = utilidadCache[period];
    if (!entry) return null;
    if (!Number.isFinite(entry.adminPercent) || Math.abs(entry.adminPercent - adminPercent) > 0.0001) return null;
    if (!Number.isFinite(entry.updatedAt) || Date.now() - entry.updatedAt > 1000 * 60 * 60 * 6) return null;
    return entry;
  }, [utilidadCache, period, adminPercent]);
  const hasFreshForCurrentPeriod = filtered.length > 0;
  const utilidadNetaShown = hasFreshForCurrentPeriod ? utilidadNeta : cachedUtilidad?.utilidadNeta ?? utilidadNeta;
  const utilidadDeltaShown = hasFreshForCurrentPeriod ? utilidadDelta : cachedUtilidad?.utilidadDelta ?? utilidadDelta;
  const roasTarget = 2.5;

  const salesSeries = useMemo(
    () => (secondaryReady ? normalize(filteredAsc.map((d) => Number(d.ventas_despachadas_total || 0))) : []),
    [secondaryReady, filteredAsc],
  );
  const adsSeries = useMemo(
    () => (secondaryReady ? normalize(filteredAsc.map((d) => Number(d.gasto_publicitario_total || 0))) : []),
    [secondaryReady, filteredAsc],
  );
  const utilBars = useMemo(() => {
    if (!secondaryReady) return [];
    const utilSeriesRaw = filteredAsc.map((d) => utilidadConAdmin(d, adminPercent));
    const utilAbsMax = Math.max(1, ...utilSeriesRaw.map((v) => Math.abs(v)));
    return utilSeriesRaw.map((v) => v / utilAbsMax);
  }, [secondaryReady, filteredAsc, adminPercent]);
  const labels = useMemo(
    () => (secondaryReady ? filteredAsc.map((d) => dayLabel(d.date)) : []),
    [secondaryReady, filteredAsc],
  );

  const topProducts = useMemo(() => {
    if (!secondaryReady) return [];
    const agg = new Map<string, ProductAgg>();
    for (const d of filtered) {
      const byp = d.by_product || {};
      for (const [k, row] of Object.entries(byp)) {
        const name = String(row.label || k);
        const ventasP = Number(row.ventas_despachadas_total || 0);
        const costoEqAdd =
          Number(row.costo_producto_entregado_total || 0) + Number(row.costo_flete_promedio_total || 0);
        const pid = row.product_id != null && Number.isFinite(Number(row.product_id)) ? String(row.product_id) : null;
        const ads = pid && Number.isFinite(Number(metaSpend[pid])) ? Number(metaSpend[pid]) : 0;
        const prev = agg.get(k);
        if (prev) {
          prev.ventas += ventasP;
          prev.costoEq += costoEqAdd;
          prev.gastoAds = ads;
        } else {
          agg.set(k, {
            key: k,
            name,
            ventas: ventasP,
            gastoAds: ads,
            costoEq: costoEqAdd,
            roas: 0,
            roasEq: 0,
            profit: 0,
          });
        }
      }
    }
    for (const p of agg.values()) {
      p.roas = p.gastoAds > 0 ? p.ventas / p.gastoAds : 0;
      p.roasEq = p.costoEq > 0 ? p.ventas / p.costoEq : 0;
      p.profit = p.ventas - p.gastoAds - p.costoEq;
    }
    return [...agg.values()].sort((a, b) => b.ventas - a.ventas).slice(0, 3);
  }, [filtered, metaSpend]);

  const alerts = useMemo(() => {
    if (!secondaryReady) return [{ text: 'Cargando insights secundarios…', tone: 'success' as const }];
    const out: { text: string; tone: 'warning' | 'success' }[] = [];
    const low = topProducts.find((p) => p.roas > 0 && p.roasEq > 0 && p.roas < p.roasEq);
    if (low) out.push({ text: `${low.name} bajo el ROAS de equilibrio.`, tone: 'warning' });
    if (ctrCurrent != null && ctrPrevious != null && ctrPrevious > 0 && ctrCurrent < ctrPrevious) {
      const drop = Math.round(((ctrPrevious - ctrCurrent) / ctrPrevious) * 100);
      out.push({ text: `CTR promedio ha caído un ${drop}%.`, tone: 'warning' });
    }
    if (roas >= roasTarget) out.push({ text: 'ROAS general arriba del objetivo.', tone: 'success' });
    if (!out.length) out.push({ text: 'Sin alertas críticas para el período seleccionado.', tone: 'success' });
    return out;
  }, [ctrCurrent, ctrPrevious, roas, roasTarget, topProducts]);

  useEffect(() => {
    if (!hasFreshForCurrentPeriod || !Number.isFinite(utilidadNeta)) return;
    setUtilidadCache((prev) => {
      const next: InicioUtilidadCacheMap = {
        ...prev,
        [period]: {
          adminPercent,
          utilidadNeta,
          utilidadDelta,
          updatedAt: Date.now(),
        },
      };
      try {
        localStorage.setItem(INICIO_UTILIDAD_CACHE_KEY, JSON.stringify(next));
      } catch {
        /* noop */
      }
      return next;
    });
  }, [hasFreshForCurrentPeriod, period, adminPercent, utilidadNeta, utilidadDelta]);

  return (
    <div style={{ fontFamily: ds.font, maxWidth: 1280, margin: '0 auto' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 7,
              background: ds.brand,
              color: '#fff',
              fontWeight: 700,
              display: 'grid',
              placeItems: 'center',
              fontSize: 11,
            }}
          >
            K
          </div>
          <h1 style={{ margin: 0, color: ds.textPrimary, fontSize: 29, fontWeight: 700 }}>Resumen del panel</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={adminPercentInput}
            onChange={(e) => setAdminPercentInput(e.target.value)}
            inputMode="decimal"
            aria-label="Porcentaje administrativo"
            title="Porcentaje administrativo"
            style={{
              width: 86,
              border: `1px solid ${ds.borderCard}`,
              background: ds.bgCard,
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 13,
              color: ds.textPrimary,
            }}
          />
          <span style={{ alignSelf: 'center', fontSize: 12, color: ds.textMuted, marginRight: 4 }}>Admin %</span>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as PeriodKey)}
            style={{
              border: `1px solid ${ds.borderCard}`,
              background: ds.bgCard,
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 13,
            }}
          >
            <option value="hoy">Hoy</option>
            <option value="ayer">Ayer</option>
            <option value="7d">Últimos 7 días</option>
          </select>
          <button
            type="button"
            onClick={() => void load()}
            style={{
              border: `1px solid ${ds.borderCard}`,
              background: ds.bgCard,
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 13,
              cursor: loading ? 'wait' : 'pointer',
              fontWeight: 600,
            }}
          >
            {loading ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
      </header>

      {error ? (
        <div
          style={{
            marginBottom: 12,
            padding: '10px 12px',
            borderRadius: 10,
            background: ds.dangerBg,
            color: ds.dangerText,
            border: `1px solid ${ds.borderCard}`,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(150px,1fr))', gap: 10, marginBottom: 12 }}>
        <Kpi title="Ventas" value={formatMoney(ventas)} tag={deltaTag(ventasDelta)} />
        <Kpi title="Gasto en Ads" value={formatMoney(gastoAds)} tag={deltaTag(gastoDelta)} />
        <Kpi
          title="ROAS Real"
          value={roas > 0 ? roas.toFixed(2) : '—'}
          tag={
            <span style={{ fontSize: 12, color: ds.textSecondary }}>
              Meta: {roasTarget} ·{' '}
              {roasDelta == null ? '—' : `${roasDelta >= 0 ? '+' : ''}${roasDelta.toFixed(1)}%`}
            </span>
          }
        />
        <Kpi title="Utilidad Neta" value={formatMoney(utilidadNetaShown)} tag={deltaTag(utilidadDeltaShown)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary, marginBottom: 8 }}>Ventas vs Gasto en Ads</div>
          {!secondaryReady ? (
            <div style={{ height: 170, borderRadius: 8, background: ds.bgApp }} />
          ) : (
            <svg viewBox="0 0 420 170" width="100%" height={170} aria-hidden>
              <path d={linePath(salesSeries, 420, 130)} fill="none" stroke={ds.brand} strokeWidth={2.2} />
              <path d={linePath(adsSeries, 420, 130)} fill="none" stroke={ds.textHint} strokeWidth={2} />
              {labels.map((d, i) => (
                <text key={`a-${d}-${i}`} x={(i / Math.max(labels.length - 1, 1)) * 420} y={160} textAnchor="middle" fill="var(--color-text-hint)" fontSize="10">
                  {d}
                </text>
              ))}
            </svg>
          )}
        </div>
        <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary, marginBottom: 8 }}>Utilidad Diaria</div>
          {!secondaryReady ? (
            <div style={{ height: 170, borderRadius: 8, background: ds.bgApp }} />
          ) : (
            <svg viewBox="0 0 420 170" width="100%" height={170} aria-hidden>
              <line x1={0} y1={82} x2={420} y2={82} stroke={ds.borderRow} strokeWidth={1} />
              {utilBars.map((v, i) => {
                const x = 26 + i * (380 / Math.max(utilBars.length, 1));
                const h = Math.abs(v) * 62;
                const y = v >= 0 ? 82 - h : 82;
                return <rect key={`u-${i}`} x={x} y={y} width={22} height={h} rx={3} fill={v >= 0 ? ds.successText : ds.dangerText} />;
              })}
              {labels.map((d, i) => (
                <text key={`u-t-${d}-${i}`} x={38 + i * (380 / Math.max(labels.length, 1))} y={160} textAnchor="middle" fill="var(--color-text-hint)" fontSize="10">
                  {d}
                </text>
              ))}
            </svg>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary, marginBottom: 8 }}>Top Productos</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', fontSize: 11, color: ds.textHint, padding: '8px 6px' }}>Producto</th>
                <th style={{ textAlign: 'right', fontSize: 11, color: ds.textHint, padding: '8px 6px' }}>ROAS</th>
                <th style={{ textAlign: 'right', fontSize: 11, color: ds.textHint, padding: '8px 6px' }}>Profit</th>
              </tr>
            </thead>
            <tbody>
              {topProducts.map((p) => (
                <tr key={p.key}>
                  <td style={{ borderTop: `1px solid ${ds.borderRow}`, padding: '10px 6px', fontWeight: 600 }}>{p.name}</td>
                  <td style={{ borderTop: `1px solid ${ds.borderRow}`, padding: '10px 6px', textAlign: 'right', fontWeight: 700 }}>
                    {p.roas > 0 ? p.roas.toFixed(1) : '—'}
                  </td>
                  <td
                    style={{
                      borderTop: `1px solid ${ds.borderRow}`,
                      padding: '10px 6px',
                      textAlign: 'right',
                      fontWeight: 700,
                      color: p.profit >= 0 ? ds.successText : ds.dangerText,
                    }}
                  >
                    {p.profit >= 0 ? '+' : ''}
                    {formatMoney(p.profit)}
                  </td>
                </tr>
              ))}
              {!topProducts.length ? (
                <tr>
                  <td colSpan={3} style={{ borderTop: `1px solid ${ds.borderRow}`, padding: '10px 6px', color: ds.textMuted }}>
                    {loading ? 'Cargando…' : 'Sin productos para este período.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary, marginBottom: 8 }}>Alertas</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {alerts.map((a, i) => (
              <div
                key={`${a.text}-${i}`}
                style={{
                  border: `1px solid ${ds.borderCard}`,
                  borderRadius: 10,
                  padding: '9px 10px',
                  background: a.tone === 'warning' ? ds.warningBg : ds.successBg,
                  color: a.tone === 'warning' ? ds.warningText : ds.successText,
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {a.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

