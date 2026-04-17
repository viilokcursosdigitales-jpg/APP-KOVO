/** Demo data for Meta tabs (no API). */

import { formatMetaMoneyWhole } from './formatMetaMoney';

export type PeriodKey = 'hoy' | 'ayer' | '3d' | '7d' | '14d' | '30d' | 'custom';
export type ProductKey = 'all' | 'crema' | 'serum' | 'kit';

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  hoy: 'Hoy',
  ayer: 'Ayer',
  '3d': 'Últimos 3 días',
  '7d': 'Últimos 7 días',
  '14d': 'Últimos 14 días',
  '30d': 'Últimos 30 días',
  custom: 'Rango personalizado',
};

export const PRODUCT_LABELS: Record<ProductKey, string> = {
  all: 'Todos los productos',
  crema: 'Crema facial',
  serum: 'Sérum',
  kit: 'Kit completo',
};

function periodFactor(p: PeriodKey): number {
  const map: Record<PeriodKey, number> = {
    hoy: 0.11,
    ayer: 0.1,
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

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('es-ES').format(Math.round(n));
}

export function formatMoney2(n: number): string {
  return formatMetaMoneyWhole(n);
}

export function formatPct(n: number, decimals = 1): string {
  return `${n.toFixed(decimals)}%`;
}

export type CreativeMetrics = {
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

export type AdRow = {
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

const DEMO_THUMB = ['#6c47ff', '#9b80ff', '#e8e3ff', '#185fa5', '#3b6d11'];

export function computeCreativeData(period: PeriodKey, product: ProductKey) {
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
      thumb: DEMO_THUMB[0],
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
      thumb: DEMO_THUMB[1],
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
      thumb: DEMO_THUMB[2],
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
      thumb: DEMO_THUMB[3],
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
      thumb: DEMO_THUMB[4],
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

export type FunnelStage = { key: string; label: string; people: number };

export function computeFunnelData(period: PeriodKey, product: ProductKey) {
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
