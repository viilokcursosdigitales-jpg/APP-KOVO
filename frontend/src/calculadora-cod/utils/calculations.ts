import type { MixResult, Pack, PackKpis, PygResult, PackId } from '../types';

export function calcPack(
  costoUnitario: number,
  pack: Pick<Pack, 'units' | 'precioVenta' | 'label' | 'id'>,
  fleteEntrega: number,
  fleteDevolucion: number,
  adminPct: number,
  efectividadPct: number,
  metaUtilidadPct: number,
): PackKpis {
  const precioVenta = pack.precioVenta;
  const costoProducto = costoUnitario * pack.units;
  const adminMonto = precioVenta * (adminPct / 100);
  const gananciaSiEntrega = precioVenta - costoProducto - fleteEntrega - adminMonto;
  const perdidaSiDevuelve = -fleteDevolucion;
  const efectividad = efectividadPct / 100;
  const gananciaEsperada = efectividad * gananciaSiEntrega + (1 - efectividad) * perdidaSiDevuelve;
  const cpaEquilibrio = gananciaEsperada;
  const roasEquilibrio = cpaEquilibrio > 0 ? precioVenta / cpaEquilibrio : null;
  const utilidadDeseada = precioVenta * (metaUtilidadPct / 100);
  const cpaMeta = gananciaEsperada - utilidadDeseada;
  const roasMeta = cpaMeta > 0 ? precioVenta / cpaMeta : null;
  const margenReal = precioVenta > 0 ? (gananciaEsperada / precioVenta) * 100 : 0;
  return {
    packId: pack.id,
    label: pack.label,
    precioVenta,
    costoProducto,
    adminMonto,
    gananciaSiEntrega,
    perdidaSiDevuelve,
    efectividad,
    gananciaEsperada,
    cpaEquilibrio,
    roasEquilibrio,
    utilidadDeseada,
    cpaMeta,
    roasMeta,
    margenReal,
  };
}

function pygCore(
  pedidos: number,
  pack: Pick<Pack, 'precioVenta' | 'units'>,
  costoUnitario: number,
  fleteEntrega: number,
  fleteDevolucion: number,
  adminPct: number,
  efectividadPct: number,
  cpaMeta: number,
) {
  const precioVenta = pack.precioVenta;
  const costoProductoPack = costoUnitario * pack.units;
  const adminMontoPack = precioVenta * (adminPct / 100);
  const efectividad = efectividadPct / 100;
  const entregados = pedidos * efectividad;
  const devueltos = pedidos - entregados;
  const ventasBrutas = entregados * precioVenta;
  const costoProductos = entregados * costoProductoPack;
  const fletesEntrega = entregados * fleteEntrega;
  const fletesDevolucion = devueltos * fleteDevolucion;
  const adminTotal = entregados * adminMontoPack;
  const utilidadAntesAds = ventasBrutas - costoProductos - fletesEntrega - fletesDevolucion - adminTotal;
  const inversionAds = cpaMeta > 0 ? cpaMeta * pedidos : 0;
  const utilidadNeta = utilidadAntesAds - inversionAds;
  const margenNetoPct = ventasBrutas > 0 ? (utilidadNeta / ventasBrutas) * 100 : 0;
  return {
    entregados,
    devueltos,
    ventasBrutas,
    costoProductos,
    fletesEntrega,
    fletesDevolucion,
    adminTotal,
    utilidadAntesAds,
    inversionAds,
    utilidadNeta,
    margenNetoPct,
  };
}

export function calcPyg(
  pedidosA: number,
  pedidosB: number,
  pack: Pick<Pack, 'precioVenta' | 'units'>,
  costoUnitario: number,
  fleteEntrega: number,
  fleteDevolucion: number,
  adminPct: number,
  efectividadPct: number,
  cpaMeta: number,
): PygResult {
  const a = pygCore(pedidosA, pack, costoUnitario, fleteEntrega, fleteDevolucion, adminPct, efectividadPct, cpaMeta);
  const b = pygCore(pedidosB, pack, costoUnitario, fleteEntrega, fleteDevolucion, adminPct, efectividadPct, cpaMeta);
  const efectividad = efectividadPct / 100;
  const pctLabel = `${(efectividad * 100).toFixed(0)}%`;

  return {
    rows: [
      { concepto: 'Pedidos generados', a: pedidosA, b: pedidosB },
      {
        concepto: `Entregados (${pctLabel})`,
        sub: true,
        muted: true,
        a: a.entregados,
        b: b.entregados,
      },
      {
        concepto: `Devueltos (${fmtPctComplement(efectividad)})`,
        sub: true,
        muted: true,
        a: a.devueltos,
        b: b.devueltos,
      },
      { concepto: 'Ventas brutas', total: true, a: a.ventasBrutas, b: b.ventasBrutas },
      { concepto: '(−) Costo productos', negative: true, a: -a.costoProductos, b: -b.costoProductos },
      { concepto: '(−) Fletes entregados', negative: true, a: -a.fletesEntrega, b: -b.fletesEntrega },
      { concepto: '(−) Fletes devueltos', negative: true, a: -a.fletesDevolucion, b: -b.fletesDevolucion },
      {
        concepto: `(−) Admin (${adminPct.toFixed(0)}%)`,
        negative: true,
        a: -a.adminTotal,
        b: -b.adminTotal,
      },
      { concepto: '= Utilidad antes de ads', total: true, a: a.utilidadAntesAds, b: b.utilidadAntesAds },
      {
        concepto: `(−) Inversión ads · CPA ${cpaMeta > 0 ? cpaMeta.toFixed(0) : '—'}`,
        negative: true,
        a: -a.inversionAds,
        b: -b.inversionAds,
      },
      { concepto: '= Utilidad neta', final: true, a: a.utilidadNeta, b: b.utilidadNeta },
    ],
    margenNetoPctA: a.margenNetoPct,
    margenNetoPctB: b.margenNetoPct,
  };
}

function fmtPctComplement(efectividad: number): string {
  const p = Math.max(0, Math.min(1, 1 - efectividad));
  return `${(p * 100).toFixed(0)}%`;
}

export function calcMix(
  mix: [number, number, number],
  packs: [Pick<Pack, 'precioVenta'>, Pick<Pack, 'precioVenta'>, Pick<Pack, 'precioVenta'>],
  kpis: [Pick<PackKpis, 'cpaMeta'>, Pick<PackKpis, 'cpaMeta'>, Pick<PackKpis, 'cpaMeta'>],
): MixResult {
  const [m1, m2, m3] = mix;
  const sumaPct = m1 + m2 + m3;
  if (!Number.isFinite(sumaPct) || sumaPct <= 0) {
    return {
      sumaPct: 0,
      weights: [0, 0, 0],
      cpaPonderado: 0,
      ticketPromedio: 0,
      roasPonderado: null,
      cpaConservador: 0,
      cpaAgresivo: 0,
      roasConservador: null,
      roasAgresivo: null,
    };
  }
  const w1 = m1 / sumaPct;
  const w2 = m2 / sumaPct;
  const w3 = m3 / sumaPct;
  const weights: [number, number, number] = [w1, w2, w3];
  const cpaPonderado = w1 * kpis[0].cpaMeta + w2 * kpis[1].cpaMeta + w3 * kpis[2].cpaMeta;
  const ticketPromedio = w1 * packs[0].precioVenta + w2 * packs[1].precioVenta + w3 * packs[2].precioVenta;
  const roasPonderado = cpaPonderado > 0 ? ticketPromedio / cpaPonderado : null;
  const prices = [packs[0].precioVenta, packs[1].precioVenta, packs[2].precioVenta];
  const cpas = [kpis[0].cpaMeta, kpis[1].cpaMeta, kpis[2].cpaMeta];
  let minIdx = 0;
  let maxIdx = 0;
  for (let i = 1; i < 3; i += 1) {
    if (prices[i] < prices[minIdx]) minIdx = i;
    if (prices[i] > prices[maxIdx]) maxIdx = i;
  }
  const cpaConservador = cpas[minIdx];
  const cpaAgresivo = cpas[maxIdx];
  const roasConservador = cpaConservador > 0 ? packs[minIdx].precioVenta / cpaConservador : null;
  const roasAgresivo = cpaAgresivo > 0 ? packs[maxIdx].precioVenta / cpaAgresivo : null;
  return {
    sumaPct,
    weights,
    cpaPonderado,
    ticketPromedio,
    roasPonderado,
    cpaConservador,
    cpaAgresivo,
    roasConservador,
    roasAgresivo,
  };
}

export function packHealth(margenReal: number): 'success' | 'warning' | 'danger' {
  if (margenReal < 15) return 'danger';
  if (margenReal <= 30) return 'warning';
  return 'success';
}

export function bestPackId(kpis: PackKpis[]): PackId {
  let best = kpis[0];
  for (const k of kpis.slice(1)) {
    if (k.gananciaEsperada > best.gananciaEsperada) best = k;
  }
  return best.packId;
}

/*
 * CASO DE VALIDACIÓN — Body Mameluco
 * Inputs: costo=23000, flete E=20000, flete D=20000, admin=4%, efec=80%, meta=10%
 * Pack 1u (1 unidad × 69900):
 *   gananciaSiEntrega = 24104
 *   gananciaEsperada ≈ 15283
 *   cpaEquilibrio ≈ 15283
 *   roasEquilibrio ≈ 4.57x
 *   cpaMeta ≈ 8293
 *   roasMeta ≈ 8.43x
 * Pack 2u (2 × 109000):
 *   gananciaEsperada ≈ 26912
 *   cpaMeta ≈ 16012
 *   roasMeta ≈ 6.81x
 * Pack 3u (3 × 145000):
 *   gananciaEsperada ≈ 36160
 *   cpaMeta ≈ 21660
 *   roasMeta ≈ 6.70x
 */
