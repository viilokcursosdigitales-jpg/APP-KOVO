/** Tipos del módulo Planeación de Ventas (planes mensuales locales / futura API). */

export const MESES_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const;

export function etiquetaMesAnio(mes: number, anio: number): string {
  const m = MESES_ES[mes - 1] ?? `Mes ${mes}`;
  return `${m} ${anio}`;
}

export type TipoMeta = 'utilidad' | 'facturacion';

/** Producto tal como lo guarda el usuario en el plan. */
export type ProductoPlan = {
  id: string;
  nombre: string;
  precioVenta: number;
  margenBrutoPct: number;
  tasaConfirmacion: number;
  tasaEntrega: number;
  /** Porcentaje del total de ventas (debe sumar ~100 entre productos). */
  distribucionVentas: number;
};

export type PlanVentas = {
  id: string;
  mes: number;
  anio: number;
  nombre: string;
  creadoEn: string;
  actualizadoEn: string;
  meta: number;
  tipoMeta: TipoMeta;
  gastosAdminPct: number;
  presupuestoAds: number;
  productos: ProductoPlan[];
  notas?: string;
  /**
   * Días del mes usados para promedios “por día” (1…días naturales del mes).
   * Si falta (planes antiguos), la UI asume todos los días calendario del mes.
   */
  diasCalculo?: number;
  /**
   * ROAS mínimo deseado por etapa (facturación etapa ÷ presupuesto ads).
   * Si defines al menos uno, el presupuesto ads se ajusta al menor valor que cumple todos.
   */
  roasObjetivoMeta?: number;
  roasObjetivoConfirmados?: number;
  roasObjetivoEntregados?: number;
};

/** Resultado de aplicar la lógica de negocio a un producto (ver calculosVentas). */
export type ProductoCalculado = ProductoPlan & {
  margenBruto: number;
  margenAntesAds: number;
  /** Efectividad embudo en % (0–100). */
  efectividad: number;
  pedidosEntregados: number;
  pedidosConfirmados: number;
  pedidosMeta: number;
  facturacion: number;
  cpaMaximo: number;
  cpaObjetivo: number;
  inversionAdsObjetivo: number;
  utilidadTotal: number;
  viable: boolean;
};

export type TotalesPlan = {
  totalPedidosMeta: number;
  totalPedidosConfirmados: number;
  totalPedidosEntregados: number;
  totalFacturacion: number;
  /** Σ pedidosMeta × precioVenta (facturación “teórica” si se cerraran todos los pedidos meta). */
  totalFacturacionMeta: number;
  /** Σ pedidosConfirmados × precioVenta. */
  totalFacturacionConfirmados: number;
  totalUtilidad: number;
  totalInversionAdsObjetivo: number;
  /** Suma de inversiones objetivo ≤ presupuesto declarado. */
  adsSuficiente: boolean;
  /** Facturación / presupuesto ads (0 si no hay presupuesto). */
  roasGlobal: number;
  /** totalFacturacionMeta / presupuesto ads. */
  roasPublicidad: number;
  /** totalFacturacionConfirmados / presupuesto ads. */
  roasConfirmados: number;
  /** Igual que roasGlobal: facturación entregada / presupuesto ads. */
  roasEntregados: number;
  /** Presupuesto ads ÷ pedidos meta (null si no aplica). */
  cpaPublicidad: number | null;
  /** Presupuesto ads ÷ pedidos confirmados. */
  cpaConfirmados: number | null;
  /** Presupuesto ads ÷ pedidos entregados. */
  cpaEntregados: number | null;
  /** Todos los productos con margenAntesAds > 0. */
  viableGlobal: boolean;
};

export type ValidacionPlan = {
  distribucionValida: boolean;
  distribucionTotal: number;
  tieneProductos: boolean;
  /** Algún producto con margenAntesAds <= 0 tras cálculo. */
  algunProductoInviable: boolean;
  /** Presupuesto ads por debajo de la inversión objetivo agregada. */
  adsInsuficiente: boolean;
};

export type PlanAnalizado = {
  plan: PlanVentas;
  productos: ProductoCalculado[];
  totales: TotalesPlan;
  validacion: ValidacionPlan;
};
