import type { CalculatorInputsState, FunnelMixLevel, MixResult, Pack, PackKpis, PackId, PygResult } from '../types';

export function calcPack(pack: Pack, inputs: CalculatorInputsState): PackKpis {
  const {
    costoUnitario,
    fleteIda,
    cobraFleteDevolucion,
    fleteDevolucion,
    canceladosPct,
    devueltosPct,
    adminPct,
    metaUtilidadPct,
  } = inputs;

  const pCanc = canceladosPct / 100;
  const pDev = devueltosPct / 100;
  const efEnvios = 1 - pCanc;
  const efEntrega = 1 - pDev;
  const efTotal = efEnvios * efEntrega;

  const fleteDev = cobraFleteDevolucion ? fleteDevolucion : 0;
  const precio = pack.precioVenta;
  const unidades = pack.units;
  const costoProducto = costoUnitario * unidades;
  const adminMonto = precio * (adminPct / 100);

  const ingresos = efTotal * precio;
  const costoProductos = efTotal * costoProducto;
  const fletesIda = efEnvios * fleteIda;
  const fletesDev = efEnvios * pDev * fleteDev;
  const adminTotal = efTotal * adminMonto;

  const gananciaBruta = ingresos - costoProductos - fletesIda - fletesDev - adminTotal;

  const cpaGenEq = gananciaBruta;
  const cpaDespEq = efEnvios > 0 ? gananciaBruta / efEnvios : 0;
  const cpaEntrEq = efTotal > 0 ? gananciaBruta / efTotal : 0;

  const roasGenEq = cpaGenEq > 0 ? precio / cpaGenEq : null;
  const roasDespEq = cpaDespEq > 0 ? precio / cpaDespEq : null;
  const roasEntrEq = cpaEntrEq > 0 ? precio / cpaEntrEq : null;

  const utilidadDeseada = precio * (metaUtilidadPct / 100) * efTotal;
  const gananciaConMeta = gananciaBruta - utilidadDeseada;

  const cpaGenMeta = gananciaConMeta;
  const cpaDespMeta = efEnvios > 0 ? gananciaConMeta / efEnvios : 0;
  const cpaEntrMeta = efTotal > 0 ? gananciaConMeta / efTotal : 0;

  const roasGenMeta = cpaGenMeta > 0 ? precio / cpaGenMeta : null;
  const roasDespMeta = cpaDespMeta > 0 ? precio / cpaDespMeta : null;
  const roasEntrMeta = cpaEntrMeta > 0 ? precio / cpaEntrMeta : null;

  const margen = efTotal > 0 ? (gananciaBruta / (precio * efTotal)) * 100 : 0;

  return {
    packId: pack.id,
    label: pack.label,
    precio,
    unidades,
    gananciaBruta,
    margen,
    efEnvios,
    efEntrega,
    efTotal,
    cpaGenEq,
    roasGenEq,
    cpaDespEq,
    roasDespEq,
    cpaEntrEq,
    roasEntrEq,
    cpaGenMeta,
    roasGenMeta,
    cpaDespMeta,
    roasDespMeta,
    cpaEntrMeta,
    roasEntrMeta,
  };
}

function funnelMetaCpa(k: PackKpis, level: FunnelMixLevel): number {
  if (level === 'gen') return k.cpaGenMeta;
  if (level === 'desp') return k.cpaDespMeta;
  return k.cpaEntrMeta;
}

function funnelMetaRoas(k: PackKpis, level: FunnelMixLevel): number | null {
  if (level === 'gen') return k.roasGenMeta;
  if (level === 'desp') return k.roasDespMeta;
  return k.roasEntrMeta;
}

export function calcMix(
  mix: [number, number, number],
  packs: [Pack, Pack, Pack],
  packKpis: [PackKpis, PackKpis, PackKpis],
  level: FunnelMixLevel,
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
  const cpaPonderado =
    w1 * funnelMetaCpa(packKpis[0], level) +
    w2 * funnelMetaCpa(packKpis[1], level) +
    w3 * funnelMetaCpa(packKpis[2], level);
  const ticketPromedio = w1 * packs[0].precioVenta + w2 * packs[1].precioVenta + w3 * packs[2].precioVenta;
  const roasPonderado = cpaPonderado > 0 ? ticketPromedio / cpaPonderado : null;
  const prices = [packs[0].precioVenta, packs[1].precioVenta, packs[2].precioVenta];
  const cpas = [
    funnelMetaCpa(packKpis[0], level),
    funnelMetaCpa(packKpis[1], level),
    funnelMetaCpa(packKpis[2], level),
  ];
  let minIdx = 0;
  let maxIdx = 0;
  for (let i = 1; i < 3; i += 1) {
    if (prices[i] < prices[minIdx]) minIdx = i;
    if (prices[i] > prices[maxIdx]) maxIdx = i;
  }
  const cpaConservador = cpas[minIdx];
  const cpaAgresivo = cpas[maxIdx];
  const roasConservador = funnelMetaRoas(packKpis[minIdx], level);
  const roasAgresivo = funnelMetaRoas(packKpis[maxIdx], level);
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

function pygScenario(
  pedidosGen: number,
  pack: Pick<Pack, 'precioVenta' | 'units'>,
  inputs: CalculatorInputsState,
  cpaGenMeta: number,
) {
  const pCanc = inputs.canceladosPct / 100;
  const pDev = inputs.devueltosPct / 100;
  const efEnvios = 1 - pCanc;
  const efEntrega = 1 - pDev;
  const efTotal = efEnvios * efEntrega;

  const cancelados = pedidosGen * pCanc;
  const despachados = pedidosGen * efEnvios;
  const devueltos = despachados * pDev;
  const entregados = pedidosGen * efTotal;

  const precioVenta = pack.precioVenta;
  const costoProductoPack = inputs.costoUnitario * pack.units;
  const adminMontoPack = precioVenta * (inputs.adminPct / 100);
  const fleteDevEfectivo = inputs.cobraFleteDevolucion ? inputs.fleteDevolucion : 0;

  const ventasBrutas = entregados * precioVenta;
  const costoProductos = entregados * costoProductoPack;
  const fletesIda = despachados * inputs.fleteIda;
  const fletesDevolucion = devueltos * fleteDevEfectivo;
  const adminTotal = entregados * adminMontoPack;
  const utilidadAntesAds = ventasBrutas - costoProductos - fletesIda - fletesDevolucion - adminTotal;
  const inversionAds = cpaGenMeta > 0 ? cpaGenMeta * pedidosGen : 0;
  const utilidadNeta = utilidadAntesAds - inversionAds;
  const margenNetoPct = ventasBrutas > 0 ? (utilidadNeta / ventasBrutas) * 100 : 0;

  return {
    pedidosGen,
    cancelados,
    despachados,
    devueltos,
    entregados,
    ventasBrutas,
    costoProductos,
    fletesIda: fletesIda,
    fletesDevolucion,
    adminTotal,
    utilidadAntesAds,
    inversionAds,
    utilidadNeta,
    margenNetoPct,
    pCanc,
    pDev,
    efEnvios,
    efEntrega,
    efTotal,
    fleteDevEfectivo,
  };
}

export function calcPyg(
  pedidosA: number,
  pedidosB: number,
  pack: Pick<Pack, 'precioVenta' | 'units'>,
  inputs: CalculatorInputsState,
  cpaGenMeta: number,
): PygResult {
  const a = pygScenario(pedidosA, pack, inputs, cpaGenMeta);
  const b = pygScenario(pedidosB, pack, inputs, cpaGenMeta);

  const rows: PygResult['rows'] = [
    { concepto: 'Pedidos generados', a: a.pedidosGen, b: b.pedidosGen },
    {
      concepto: `· Cancelados (${(a.pCanc * 100).toFixed(0)}%)`,
      sub: true,
      muted: true,
      a: a.cancelados,
      b: b.cancelados,
    },
    {
      concepto: `· Despachados (${(a.efEnvios * 100).toFixed(0)}%)`,
      sub: true,
      muted: true,
      a: a.despachados,
      b: b.despachados,
    },
    {
      concepto: `  · Devueltos (${(a.pDev * 100).toFixed(0)}% del despachado)`,
      sub: true,
      subSub: true,
      muted: true,
      a: a.devueltos,
      b: b.devueltos,
    },
    {
      concepto: `  · Entregados (${(a.efTotal * 100).toFixed(0)}% del generado)`,
      sub: true,
      subSub: true,
      muted: true,
      a: a.entregados,
      b: b.entregados,
    },
    { concepto: 'Ventas brutas', total: true, a: a.ventasBrutas, b: b.ventasBrutas },
    { concepto: '(−) Costo productos', negative: true, a: -a.costoProductos, b: -b.costoProductos },
    { concepto: '(−) Flete ida (despachados)', negative: true, a: -a.fletesIda, b: -b.fletesIda },
  ];

  if (inputs.cobraFleteDevolucion && a.fleteDevEfectivo > 0) {
    rows.push({
      concepto: '(−) Flete devolución (solo devueltos)',
      negative: true,
      a: -a.fletesDevolucion,
      b: -b.fletesDevolucion,
    });
  }

  rows.push(
    {
      concepto: `(−) Admin (${inputs.adminPct.toFixed(0)}% sobre ventas)`,
      negative: true,
      a: -a.adminTotal,
      b: -b.adminTotal,
    },
    { concepto: '= Utilidad antes de ads', total: true, a: a.utilidadAntesAds, b: b.utilidadAntesAds },
    {
      concepto: `(−) Inversión ads · CPA meta ${
        cpaGenMeta > 0 ? Math.round(cpaGenMeta).toString() : '—'
      }`,
      negative: true,
      a: -a.inversionAds,
      b: -b.inversionAds,
    },
    { concepto: '= Utilidad neta', final: true, a: a.utilidadNeta, b: b.utilidadNeta },
  );

  return {
    rows,
    margenNetoPctA: a.margenNetoPct,
    margenNetoPctB: b.margenNetoPct,
  };
}

export function packHealth(margen: number): 'success' | 'warning' | 'danger' {
  if (margen < 15) return 'danger';
  if (margen <= 30) return 'warning';
  return 'success';
}

export function bestPackId(kpis: PackKpis[]): PackId {
  let best = kpis[0];
  for (const k of kpis.slice(1)) {
    if (k.gananciaBruta > best.gananciaBruta) best = k;
  }
  return best.packId;
}

/*
 * CASO DE VALIDACIÓN — Body Mameluco (COP)
 * Inputs: costo=23000, fleteIda=20000, cobraFleteDevolucion=true, fleteDev=20000,
 *         canceladosPct=20, devueltosPct=20, admin=4%, meta=10%
 * Pack 3u (3 unidades × 145000):
 *   efEnvios=0.80, efEntrega=0.80, efTotal=0.64
 *   ingresos = 0.64 × 145000 = 92800
 *   costoProds = 0.64 × 69000 = 44160
 *   fletesIda = 0.80 × 20000 = 16000
 *   fletesDev = 0.80 × 0.20 × 20000 = 3200
 *   adminTotal = 0.64 × 5800 = 3712
 *   gananciaBruta ≈ 25728
 *   cpaGenEq ≈ 25728  | roasGenEq ≈ 5.64x
 *   cpaDespEq ≈ 32160 | roasDespEq ≈ 4.51x
 *   cpaEntrEq ≈ 40200 | roasEntrEq ≈ 3.61x
 *   utilDeseada = 145000 × 0.10 × 0.64 = 9280
 *   cpaGenMeta ≈ 16448 | roasGenMeta ≈ 8.82x
 *   cpaDespMeta ≈ 20560 | roasDespMeta ≈ 7.05x
 *   cpaEntrMeta ≈ 25700 | roasEntrMeta ≈ 5.64x
 */
