import type { CSSProperties, ReactNode } from 'react';
import { ds } from '../../design-system/ds';

export type ProductEstado = 'escalar' | 'optimizar' | 'apagar';

export type ProductDaySlice = {
  label?: string;
  product_id?: number | null;
  ventas_despachadas_total: number;
  ventas_entregadas_total: number;
  ventas_despachadas_pedidos: number;
  cantidad_producto_total: number;
  costo_producto_total: number;
  costo_producto_entregado_total: number;
  costo_flete_promedio_total: number;
};

export type SeriesDayRow = {
  date: string;
  ventas_despachadas_total: number;
  ventas_entregadas_total: number;
  ventas_despachadas_pedidos: number;
  cantidad_producto_total: number;
  costo_producto_total: number;
  costo_producto_entregado_total: number;
  costo_flete_promedio_total: number;
  gasto_publicitario_total: number;
  ganancia: number | null;
  utilidad: number | null;
  by_product?: Record<string, ProductDaySlice>;
};

export type ProductAnalysisRow = {
  key: string;
  label: string;
  ventasTotales: number;
  ventasDespachadas: number;
  gastoPublicitario: number;
  costoProductoEntregado: number;
  costoFlete: number;
  gastoAdmin: number;
  roasTotal: number | null;
  roasDespachado: number | null;
  utilidad: number | null;
  utilidadPct: number | null;
};

export type EnrichedProductRow = ProductAnalysisRow & {
  pedidos: number;
  cantidad: number;
  utilidadUnitaria: number | null;
  cpa: number | null;
  estado: ProductEstado;
  accionRecomendada: string;
  ventasSeries: number[];
  adsSeries: number[];
  roasSeries: number[];
  ventasGrowthPct: number | null;
};

export type DashboardInsight = {
  id: string;
  title: string;
  subtitle: string;
  value: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral' | 'brand';
};

export const dashboardCard: CSSProperties = {
  background: ds.bgCard,
  borderRadius: 16,
  border: `1px solid ${ds.borderCard}`,
  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.03)',
};

export function linePath(values: number[], width: number, height: number, padY = 4): string {
  if (!values.length) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * width;
      const norm = (v - min) / range;
      const y = padY + (height - padY * 2) * (1 - norm);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

export function pctChange(current: number, prev: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(prev) || prev === 0) return null;
  return ((current - prev) / Math.abs(prev)) * 100;
}

export function deltaLabel(change: number | null, invert = false): ReactNode {
  if (change == null || !Number.isFinite(change)) {
    return <span style={{ fontSize: 12, color: ds.textMuted }}>— vs periodo anterior</span>;
  }
  const positive = invert ? change <= 0 : change >= 0;
  const arrow = change >= 0 ? '↑' : '↓';
  return (
    <span style={{ fontSize: 12, fontWeight: 600, color: positive ? '#059669' : '#dc2626' }}>
      {arrow} {Math.abs(change).toFixed(1)}% vs periodo anterior
    </span>
  );
}

export function classifyProductEstado(
  utilidad: number | null,
  utilidadPct: number | null,
  goalPct: number,
): ProductEstado {
  if (utilidad != null && utilidad < 0) return 'apagar';
  if (utilidadPct != null && utilidadPct < 0) return 'apagar';
  if (utilidadPct != null && utilidadPct >= goalPct) return 'escalar';
  if (utilidadPct != null && utilidadPct >= goalPct * 0.5) return 'optimizar';
  if (utilidad != null && utilidad <= 0) return 'apagar';
  return 'optimizar';
}

export function accionRecomendadaForEstado(estado: ProductEstado): string {
  if (estado === 'escalar') return 'Aumentar presupuesto';
  if (estado === 'apagar') return 'Pausar publicidad';
  return 'Optimizar campaña';
}

export function classifyDayEstado(
  utilidad: number | null,
  ventasEntregadas: number,
  goalPct: number,
): ProductEstado {
  if (utilidad == null) return 'optimizar';
  const netPct = ventasEntregadas > 0 ? (utilidad / ventasEntregadas) * 100 : null;
  return classifyProductEstado(utilidad, netPct, goalPct);
}

export function buildProductSeriesMap(days: SeriesDayRow[]): Map<
  string,
  {
    pedidos: number;
    cantidad: number;
    ventas: number;
    ventasSeries: number[];
    adsSeries: number[];
    roasSeries: number[];
  }
> {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const map = new Map<
    string,
    {
      pedidos: number;
      cantidad: number;
      ventas: number;
      ventasSeries: number[];
      adsSeries: number[];
      roasSeries: number[];
    }
  >();

  for (const row of sorted) {
    const byp = row.by_product && typeof row.by_product === 'object' ? row.by_product : {};
    const totalVentasDay = Number(row.ventas_despachadas_total || 0);
    const gastoDay = Number(row.gasto_publicitario_total || 0);

    for (const [pk, slice] of Object.entries(byp)) {
      if (!slice) continue;
      const pid = Number(slice.product_id);
      const key = Number.isFinite(pid) && pid > 0 ? `p:${pid}` : pk;
      if (!map.has(key)) {
        map.set(key, { pedidos: 0, cantidad: 0, ventas: 0, ventasSeries: [], adsSeries: [], roasSeries: [] });
      }
      const acc = map.get(key)!;
      const vd = Number(slice.ventas_despachadas_total || 0);
      const share =
        totalVentasDay > 0 && Number.isFinite(totalVentasDay) ? Math.max(0, Math.min(1, vd / totalVentasDay)) : 0;
      const ads = gastoDay * share;
      acc.pedidos += Number(slice.ventas_despachadas_pedidos || 0);
      acc.cantidad += Number(slice.cantidad_producto_total || 0);
      acc.ventas += vd;
      acc.ventasSeries.push(vd);
      acc.adsSeries.push(ads);
      acc.roasSeries.push(ads > 0 ? vd / ads : 0);
    }
  }
  return map;
}

export function enrichProductRows(
  rows: ProductAnalysisRow[],
  seriesMap: Map<
    string,
    {
      pedidos: number;
      cantidad: number;
      ventas: number;
      ventasSeries: number[];
      adsSeries: number[];
      roasSeries: number[];
    }
  >,
  prevSeriesMap: Map<string, { ventas: number }>,
  goalPct: number,
): EnrichedProductRow[] {
  return rows.map((row) => {
    const extra = seriesMap.get(row.key);
    const pedidos = extra?.pedidos ?? 0;
    const cantidad = extra?.cantidad ?? 0;
    const utilidadUnitaria =
      row.utilidad != null && cantidad > 0 ? Math.round((row.utilidad / cantidad) * 100) / 100 : null;
    const cpa = pedidos > 0 && row.gastoPublicitario > 0 ? row.gastoPublicitario / pedidos : null;
    const estado = classifyProductEstado(row.utilidad, row.utilidadPct, goalPct);
    const prevVentas = prevSeriesMap.get(row.key)?.ventas ?? 0;
    const ventasGrowthPct = pctChange(extra?.ventas ?? row.ventasDespachadas, prevVentas);
    return {
      ...row,
      pedidos,
      cantidad,
      utilidadUnitaria,
      cpa,
      estado,
      accionRecomendada: accionRecomendadaForEstado(estado),
      ventasSeries: extra?.ventasSeries ?? [],
      adsSeries: extra?.adsSeries ?? [],
      roasSeries: extra?.roasSeries ?? [],
      ventasGrowthPct,
    };
  });
}

export function computeInsights(
  products: EnrichedProductRow[],
  formatMoney: (n: number) => string,
  formatRoas: (n: number | null) => string,
): DashboardInsight[] {
  const active = products.filter((p) => p.ventasDespachadas > 0 || (p.utilidad ?? 0) !== 0);
  if (!active.length) return [];

  const byUtilidadPct = [...active].sort((a, b) => (b.utilidadPct ?? -Infinity) - (a.utilidadPct ?? -Infinity));
  const byUtilidadUnit = [...active].sort(
    (a, b) => (b.utilidadUnitaria ?? -Infinity) - (a.utilidadUnitaria ?? -Infinity),
  );
  const byUtilidadTotal = [...active].sort((a, b) => (b.utilidad ?? -Infinity) - (a.utilidad ?? -Infinity));
  const byRoas = [...active].sort((a, b) => (b.roasDespachado ?? -Infinity) - (a.roasDespachado ?? -Infinity));
  const bySpend = [...active].sort((a, b) => b.gastoPublicitario - a.gastoPublicitario);
  const byGrowth = [...active].sort((a, b) => (b.ventasGrowthPct ?? -Infinity) - (a.ventasGrowthPct ?? -Infinity));
  const atRisk = [...active].sort((a, b) => (a.utilidadPct ?? Infinity) - (b.utilidadPct ?? Infinity));

  const insights: DashboardInsight[] = [];

  const topPct = byUtilidadPct[0];
  if (topPct?.utilidadPct != null) {
    insights.push({
      id: 'rentable',
      title: 'Producto más rentable',
      subtitle: topPct.label,
      value: `${topPct.utilidadPct.toFixed(1)}% utilidad neta`,
      tone: 'success',
    });
  }

  const topUnit = byUtilidadUnit[0];
  if (topUnit?.utilidadUnitaria != null) {
    insights.push({
      id: 'unitaria',
      title: 'Mayor utilidad unitaria',
      subtitle: topUnit.label,
      value: formatMoney(topUnit.utilidadUnitaria),
      tone: 'brand',
    });
  }

  const topTotal = byUtilidadTotal[0];
  if (topTotal?.utilidad != null) {
    insights.push({
      id: 'total',
      title: 'Mayor utilidad total',
      subtitle: topTotal.label,
      value: formatMoney(topTotal.utilidad),
      tone: 'success',
    });
  }

  const topRoas = byRoas[0];
  if (topRoas?.roasDespachado != null) {
    insights.push({
      id: 'roas',
      title: 'Mayor ROAS',
      subtitle: topRoas.label,
      value: formatRoas(topRoas.roasDespachado),
      tone: 'brand',
    });
  }

  const risk = atRisk.find((p) => (p.utilidad ?? 0) < 0 || (p.utilidadPct ?? 0) < 5) ?? atRisk[0];
  if (risk) {
    insights.push({
      id: 'riesgo',
      title: 'Producto en riesgo',
      subtitle: risk.label,
      value:
        risk.utilidadPct != null
          ? `${risk.utilidadPct.toFixed(1)}% utilidad neta`
          : risk.utilidad != null
            ? formatMoney(risk.utilidad)
            : '—',
      tone: 'danger',
    });
  }

  const growth = byGrowth.find((p) => p.ventasGrowthPct != null && p.ventasGrowthPct > 0);
  if (growth?.ventasGrowthPct != null) {
    insights.push({
      id: 'crecimiento',
      title: 'Mayor crecimiento',
      subtitle: growth.label,
      value: `+${growth.ventasGrowthPct.toFixed(1)}% ventas`,
      tone: 'success',
    });
  }

  const topSpend = bySpend[0];
  if (topSpend && topSpend.gastoPublicitario > 0) {
    insights.push({
      id: 'spend',
      title: 'Mayor gasto publicitario',
      subtitle: topSpend.label,
      value: formatMoney(topSpend.gastoPublicitario),
      tone: 'warning',
    });
  }

  return insights;
}

export function estadoBadgeStyle(estado: ProductEstado): CSSProperties {
  if (estado === 'escalar') {
    return { background: 'rgba(5, 150, 105, 0.12)', color: '#047857', border: '1px solid rgba(5, 150, 105, 0.25)' };
  }
  if (estado === 'apagar') {
    return { background: 'rgba(220, 38, 38, 0.1)', color: '#b91c1c', border: '1px solid rgba(220, 38, 38, 0.22)' };
  }
  return { background: 'rgba(245, 158, 11, 0.12)', color: '#b45309', border: '1px solid rgba(245, 158, 11, 0.25)' };
}

export function estadoLabel(estado: ProductEstado): string {
  if (estado === 'escalar') return 'Escalar';
  if (estado === 'apagar') return 'Apagar';
  return 'Optimizar';
}
