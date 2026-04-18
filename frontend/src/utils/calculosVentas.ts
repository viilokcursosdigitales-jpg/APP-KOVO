import type {
  PlanVentas,
  ProductoCalculado,
  ProductoPlan,
  TotalesPlan,
  TipoMeta,
  ValidacionPlan,
  PlanAnalizado,
} from '../types/planVentas';

/** Formato peso colombiano para UI. */
export function formatCop(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

export function diasEnMes(anio: number, mes: number): number {
  return new Date(anio, mes, 0).getDate();
}

/**
 * Calcula métricas derivadas de un producto según la meta total del plan
 * y el % de distribución asignado a la línea.
 */
export function calcularProducto(
  producto: ProductoPlan,
  metaTotal: number,
  tipoMeta: TipoMeta,
  gastosAdminPct: number,
): ProductoCalculado {
  const margenBruto = producto.precioVenta * (producto.margenBrutoPct / 100);
  const gastosAdmin = producto.precioVenta * (gastosAdminPct / 100);
  const margenAntesAds = margenBruto - gastosAdmin;

  const efectividad = (producto.tasaConfirmacion / 100) * (producto.tasaEntrega / 100);
  const pedidosMetaPorEntregado = efectividad > 0 ? 1 / efectividad : 0;

  const metaAsignada = metaTotal * (producto.distribucionVentas / 100);

  let pedidosEntregados: number;
  if (tipoMeta === 'facturacion') {
    pedidosEntregados =
      producto.precioVenta > 0 ? Math.ceil(metaAsignada / producto.precioVenta) : 0;
  } else {
    const utilidadPorPedido = margenAntesAds * 0.4;
    pedidosEntregados = utilidadPorPedido > 0 ? Math.ceil(metaAsignada / utilidadPorPedido) : 0;
  }

  const pedidosConfirmados =
    producto.tasaEntrega > 0 ? Math.ceil(pedidosEntregados / (producto.tasaEntrega / 100)) : 0;
  const pedidosMeta = Math.ceil(pedidosEntregados * pedidosMetaPorEntregado);

  const facturacion = pedidosEntregados * producto.precioVenta;
  const cpaMaximo = margenAntesAds;
  const cpaObjetivo = margenAntesAds * 0.6;
  const inversionAdsObjetivo = pedidosEntregados * cpaObjetivo;
  const utilidadTotal = pedidosEntregados * (margenAntesAds * 0.4);

  return {
    ...producto,
    margenBruto,
    margenAntesAds,
    efectividad: efectividad * 100,
    pedidosEntregados,
    pedidosConfirmados,
    pedidosMeta,
    facturacion,
    cpaMaximo,
    cpaObjetivo,
    inversionAdsObjetivo,
    utilidadTotal,
    viable: margenAntesAds > 0,
  };
}

export function calcularTotales(
  productosCalculados: ProductoCalculado[],
  presupuestoAds: number,
): TotalesPlan {
  const totalPedidosMeta = productosCalculados.reduce((s, p) => s + p.pedidosMeta, 0);
  const totalPedidosConfirmados = productosCalculados.reduce((s, p) => s + p.pedidosConfirmados, 0);
  const totalPedidosEntregados = productosCalculados.reduce((s, p) => s + p.pedidosEntregados, 0);
  const totalFacturacion = productosCalculados.reduce((s, p) => s + p.facturacion, 0);
  const totalFacturacionMeta = productosCalculados.reduce(
    (s, p) => s + p.pedidosMeta * p.precioVenta,
    0,
  );
  const totalFacturacionConfirmados = productosCalculados.reduce(
    (s, p) => s + p.pedidosConfirmados * p.precioVenta,
    0,
  );
  const totalUtilidad = productosCalculados.reduce((s, p) => s + p.utilidadTotal, 0);
  const totalInversionAdsObjetivo = productosCalculados.reduce((s, p) => s + p.inversionAdsObjetivo, 0);

  const adsSuficiente =
    totalInversionAdsObjetivo <= 0 ? true : presupuestoAds + 1e-6 >= totalInversionAdsObjetivo;
  const roasEntregados = presupuestoAds > 0 ? totalFacturacion / presupuestoAds : 0;
  const roasGlobal = roasEntregados;
  const roasPublicidad = presupuestoAds > 0 ? totalFacturacionMeta / presupuestoAds : 0;
  const roasConfirmados = presupuestoAds > 0 ? totalFacturacionConfirmados / presupuestoAds : 0;
  const cpaPublicidad =
    presupuestoAds > 0 && totalPedidosMeta > 0 ? presupuestoAds / totalPedidosMeta : null;
  const cpaConfirmados =
    presupuestoAds > 0 && totalPedidosConfirmados > 0 ? presupuestoAds / totalPedidosConfirmados : null;
  const cpaEntregados =
    presupuestoAds > 0 && totalPedidosEntregados > 0 ? presupuestoAds / totalPedidosEntregados : null;
  const viableGlobal = productosCalculados.length > 0 && productosCalculados.every((p) => p.viable);

  return {
    totalPedidosMeta,
    totalPedidosConfirmados,
    totalPedidosEntregados,
    totalFacturacion,
    totalFacturacionMeta,
    totalFacturacionConfirmados,
    totalUtilidad,
    totalInversionAdsObjetivo,
    adsSuficiente,
    roasGlobal,
    roasPublicidad,
    roasConfirmados,
    roasEntregados,
    cpaPublicidad,
    cpaConfirmados,
    cpaEntregados,
    viableGlobal,
  };
}

export function validarPlan(plan: PlanVentas, totales: TotalesPlan): ValidacionPlan {
  const distribucionTotal = plan.productos.reduce((s, p) => s + p.distribucionVentas, 0);
  const distribucionValida = Math.abs(distribucionTotal - 100) < 0.01;
  const tieneProductos = plan.productos.length > 0;
  const algunProductoInviable = plan.productos.some((p) => {
    const c = calcularProducto(p, plan.meta, plan.tipoMeta, plan.gastosAdminPct);
    return !c.viable;
  });
  const adsInsuficiente = !totales.adsSuficiente;

  return {
    distribucionValida,
    distribucionTotal,
    tieneProductos,
    algunProductoInviable,
    adsInsuficiente,
  };
}

/** Analiza un plan completo: productos calculados, totales y validación. */
export function analizarPlan(plan: PlanVentas): PlanAnalizado {
  const productos = plan.productos.map((p) => calcularProducto(p, plan.meta, plan.tipoMeta, plan.gastosAdminPct));
  const totales = calcularTotales(productos, plan.presupuestoAds);
  const validacion = validarPlan(plan, totales);
  return { plan, productos, totales, validacion };
}

function normRoasObjetivo(v: unknown): number | undefined {
  const n = Number(v);
  return v != null && Number.isFinite(n) && n > 0 ? n : undefined;
}

export function tieneObjetivosRoas(plan: PlanVentas): boolean {
  return (
    normRoasObjetivo(plan.roasObjetivoMeta) != null ||
    normRoasObjetivo(plan.roasObjetivoConfirmados) != null ||
    normRoasObjetivo(plan.roasObjetivoEntregados) != null
  );
}

/** Presupuesto mínimo (redondeado) que cumple todos los ROAS objetivo definidos; null si ninguno. */
export function presupuestoAdsDesdeObjetivosRoas(plan: PlanVentas, totales: TotalesPlan): number | null {
  const parts: number[] = [];
  const rm = normRoasObjetivo(plan.roasObjetivoMeta);
  if (rm != null) parts.push(totales.totalFacturacionMeta / rm);
  const rc = normRoasObjetivo(plan.roasObjetivoConfirmados);
  if (rc != null) parts.push(totales.totalFacturacionConfirmados / rc);
  const re = normRoasObjetivo(plan.roasObjetivoEntregados);
  if (re != null) parts.push(totales.totalFacturacion / re);
  if (!parts.length) return null;
  return Math.max(1, Math.round(Math.min(...parts)));
}

/**
 * Ajusta `presupuestoAds` según los ROAS objetivo (menor gasto que cumple todas las cotas).
 * No modifica los objetivos.
 */
export function aplicarObjetivosRoasAlPresupuesto(plan: PlanVentas): PlanVentas {
  if (!tieneObjetivosRoas(plan)) return plan;
  const productos = plan.productos.map((p) => calcularProducto(p, plan.meta, plan.tipoMeta, plan.gastosAdminPct));
  const totales = calcularTotales(productos, plan.presupuestoAds);
  const np = presupuestoAdsDesdeObjetivosRoas(plan, totales);
  if (np == null) return plan;
  if (np === plan.presupuestoAds) return plan;
  return { ...plan, presupuestoAds: np };
}

export function sincronizarPresupuestoSiObjetivosRoas(plan: PlanVentas): PlanVentas {
  return tieneObjetivosRoas(plan) ? aplicarObjetivosRoasAlPresupuesto(plan) : plan;
}

/**
 * Fusiona un parche al plan y, si aplica, sincroniza presupuesto por ROAS objetivo.
 * Si el usuario edita solo el presupuesto ads, se eliminan los objetivos ROAS (modo manual).
 */
export function mergePlanYObjetivosRoas(doc: PlanVentas, patch: Partial<PlanVentas>): PlanVentas {
  let next: PlanVentas = { ...doc, ...patch };
  const editoSoloPresupuesto =
    Object.prototype.hasOwnProperty.call(patch, 'presupuestoAds') &&
    !Object.prototype.hasOwnProperty.call(patch, 'roasObjetivoMeta') &&
    !Object.prototype.hasOwnProperty.call(patch, 'roasObjetivoConfirmados') &&
    !Object.prototype.hasOwnProperty.call(patch, 'roasObjetivoEntregados');
  if (editoSoloPresupuesto) {
    next = {
      ...next,
      roasObjetivoMeta: undefined,
      roasObjetivoConfirmados: undefined,
      roasObjetivoEntregados: undefined,
    };
  }
  return sincronizarPresupuestoSiObjetivosRoas(next);
}

/** Semáforo de lista/detalle: sin alertas vs con alertas. */
export function planSinAlertas(a: PlanAnalizado): boolean {
  return (
    a.validacion.distribucionValida &&
    !a.validacion.algunProductoInviable &&
    !a.validacion.adsInsuficiente &&
    a.totales.viableGlobal
  );
}
