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

/** Semáforo de lista/detalle: sin alertas vs con alertas. */
export function planSinAlertas(a: PlanAnalizado): boolean {
  return (
    a.validacion.distribucionValida &&
    !a.validacion.algunProductoInviable &&
    !a.validacion.adsInsuficiente &&
    a.totales.viableGlobal
  );
}
