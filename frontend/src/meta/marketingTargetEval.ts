/** Objetivos por producto (Shopify) para comparar con filas de Meta Insights. */

export type ProductMarketingTargets = {
  cpm_target: number | null;
  ctr_target: number | null;
  cpc_target: number | null;
  roas_target: number | null;
  cpa_target: number | null;
};

export type MetricHighlight = 'neutral' | 'good' | 'bad';

export type RowTargetEvaluation = {
  rowHighlight: 'neutral' | 'good' | 'bad';
  cpm: MetricHighlight;
  ctr: MetricHighlight;
  cpc: MetricHighlight;
  roas: MetricHighlight;
  cpa: MetricHighlight;
  tooltip: string;
};

const TIP_CPM_BAD =
  'CPM por encima del objetivo: revisa pujas y creatividad; prueba audiencias más acotadas o formatos con mejor retención para reducir coste por mil impresiones.';
const TIP_CTR_BAD =
  'CTR por debajo del objetivo: mejora el hook (primeros segundos en vídeo), prueba nuevos mensajes o CTAs más claros y relevantes.';
const TIP_CPC_BAD =
  'CPC por encima del objetivo: afina segmentación, revisa coherencia anuncio–landing o amplía el embudo para clics más baratos.';
const TIP_ROAS_BAD =
  'ROAS por debajo del objetivo: optimiza landing, oferta y checkout; refuerza remarketing y revisa la atribución del pixel.';
const TIP_CPA_BAD =
  'CPA por encima del objetivo: mejora conversión en web (velocidad, confianza, fricción en checkout) o reduce el coste por clic cualificado.';

function avgDefined(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Promedia solo productos que tienen valor definido para cada métrica. */
export function aggregateTargetsForProducts(
  productIds: number[],
  byProduct: Record<number, ProductMarketingTargets>,
): ProductMarketingTargets {
  const keys: (keyof ProductMarketingTargets)[] = [
    'cpm_target',
    'ctr_target',
    'cpc_target',
    'roas_target',
    'cpa_target',
  ];
  const out: ProductMarketingTargets = {
    cpm_target: null,
    ctr_target: null,
    cpc_target: null,
    roas_target: null,
    cpa_target: null,
  };
  for (const key of keys) {
    const vals: number[] = [];
    for (const pid of productIds) {
      const t = byProduct[pid];
      if (!t) continue;
      const v = t[key];
      if (v != null && Number.isFinite(Number(v))) vals.push(Number(v));
    }
    const m = avgDefined(vals);
    out[key] = m;
  }
  return out;
}

function hasAnyTarget(t: ProductMarketingTargets): boolean {
  return (
    (t.cpm_target != null && Number.isFinite(t.cpm_target)) ||
    (t.ctr_target != null && Number.isFinite(t.ctr_target)) ||
    (t.cpc_target != null && Number.isFinite(t.cpc_target)) ||
    (t.roas_target != null && Number.isFinite(t.roas_target)) ||
    (t.cpa_target != null && Number.isFinite(t.cpa_target))
  );
}

type InsightMetrics = {
  cpm: number;
  ctr: number;
  cpc: number;
  roas: number;
  cpa: number;
  purchases: number;
};

/**
 * CPM, CPC, CPA: menor es mejor. CTR, ROAS: mayor es mejor.
 * CTR en API Meta en % (p. ej. 1,25 = 1,25 %).
 */
export function evaluateInsightAgainstTargets(
  m: InsightMetrics,
  t: ProductMarketingTargets,
): RowTargetEvaluation {
  if (!hasAnyTarget(t)) {
    return {
      rowHighlight: 'neutral',
      cpm: 'neutral',
      ctr: 'neutral',
      cpc: 'neutral',
      roas: 'neutral',
      cpa: 'neutral',
      tooltip:
        'Los productos vinculados a esta campaña aún no tienen objetivos numéricos. Configúralos en Indicadores de marketing.',
    };
  }

  const failures: string[] = [];
  const passes: string[] = [];

  let cpmH: MetricHighlight = 'neutral';
  if (t.cpm_target != null && Number.isFinite(t.cpm_target)) {
    if (m.cpm <= t.cpm_target) {
      cpmH = 'good';
      passes.push(`CPM ≤ ${t.cpm_target.toFixed(2)} €`);
    } else {
      cpmH = 'bad';
      failures.push(TIP_CPM_BAD);
    }
  }

  let ctrH: MetricHighlight = 'neutral';
  if (t.ctr_target != null && Number.isFinite(t.ctr_target)) {
    if (m.ctr >= t.ctr_target) {
      ctrH = 'good';
      passes.push(`CTR ≥ ${t.ctr_target.toFixed(2)} %`);
    } else {
      ctrH = 'bad';
      failures.push(TIP_CTR_BAD);
    }
  }

  let cpcH: MetricHighlight = 'neutral';
  if (t.cpc_target != null && Number.isFinite(t.cpc_target)) {
    if (m.cpc <= t.cpc_target) {
      cpcH = 'good';
      passes.push(`CPC ≤ ${t.cpc_target.toFixed(2)} €`);
    } else {
      cpcH = 'bad';
      failures.push(TIP_CPC_BAD);
    }
  }

  let roasH: MetricHighlight = 'neutral';
  if (t.roas_target != null && Number.isFinite(t.roas_target)) {
    if (m.roas >= t.roas_target) {
      roasH = 'good';
      passes.push(`ROAS ≥ ${t.roas_target.toFixed(2)}×`);
    } else {
      roasH = 'bad';
      failures.push(TIP_ROAS_BAD);
    }
  }

  let cpaH: MetricHighlight = 'neutral';
  if (t.cpa_target != null && Number.isFinite(t.cpa_target)) {
    if (m.purchases <= 0) {
      cpaH = 'neutral';
    } else if (m.cpa <= t.cpa_target) {
      cpaH = 'good';
      passes.push(`CPA ≤ ${t.cpa_target.toFixed(2)} €`);
    } else {
      cpaH = 'bad';
      failures.push(TIP_CPA_BAD);
    }
  }

  const evaluatedCount = [cpmH, ctrH, cpcH, roasH, cpaH].filter((h) => h !== 'neutral').length;
  let rowHighlight: 'neutral' | 'good' | 'bad' = 'neutral';
  if (evaluatedCount > 0) {
    rowHighlight = failures.length > 0 ? 'bad' : 'good';
  }

  let tooltip = '';
  if (failures.length > 0) {
    tooltip = ['Mejoras sugeridas:', ...failures.map((f) => `• ${f}`)].join('\n');
  } else if (passes.length > 0) {
    tooltip = ['Objetivos cumplidos o superados:', ...passes.map((p) => `• ${p}`)].join('\n');
    tooltip +=
      '\n\nSigue testando creativos y audiencias para mantener el rendimiento; revisa Indicadores de marketing si cambia tu estrategia.';
  } else {
    tooltip =
      'Define al menos un objetivo numérico (CPM, CTR, CPC, ROAS o CPA) en Indicadores de marketing para este producto.';
  }

  return {
    rowHighlight,
    cpm: cpmH,
    ctr: ctrH,
    cpc: cpcH,
    roas: roasH,
    cpa: cpaH,
    tooltip,
  };
}

const CELL_GOOD = 'rgba(34, 197, 94, 0.2)';
const CELL_BAD = 'rgba(239, 68, 68, 0.18)';
const ROW_GOOD = 'rgba(34, 197, 94, 0.1)';
const ROW_BAD = 'rgba(239, 68, 68, 0.09)';

export function insightMetricCellBg(h: MetricHighlight): string | undefined {
  if (h === 'good') return CELL_GOOD;
  if (h === 'bad') return CELL_BAD;
  return undefined;
}

export function insightRowBg(h: 'neutral' | 'good' | 'bad'): string | undefined {
  if (h === 'good') return ROW_GOOD;
  if (h === 'bad') return ROW_BAD;
  return undefined;
}

export function campaignIdForInsightRow(
  row: { id: string; campaignId: string },
  level: 'campaigns' | 'adsets' | 'ads',
): string {
  if (level === 'campaigns') return String(row.id);
  return String(row.campaignId || '');
}
