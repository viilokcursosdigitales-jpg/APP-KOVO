import * as XLSX from 'xlsx';

export const DROPI_COL = {
  fechaReporte: 0,
  idPedido: 1,
  fechaPedido: 3,
  numeroGuia: 9,
  estatus: 10,
  departamento: 12,
  ciudad: 13,
  transportadora: 16,
  totalOrden: 17,
  ganancia: 18,
  precioFlete: 19,
  costoDevolucionFlete: 20,
  costoProducto: 24,
  producto: 28,
  cantidad: 30,
} as const;

export type DropiRow = {
  fechaReporte: Date | null;
  fechaPedido: Date | null;
  idPedido: string;
  numeroGuia: string;
  estatusNorm: string;
  departamento: string;
  ciudad: string;
  transportadora: string;
  totalOrden: number;
  ganancia: number;
  precioFlete: number;
  costoDevolucionFlete: number;
  costoProducto: number;
  producto: string;
  cantidad: number;
};

/** Estados excluidos de con guía y total ventas (KPIs). */
export const DROPI_EXCLUDED_FROM_GUIA_Y_VENTAS = new Set([
  '',
  'CANCELADO',
  'GUIA ANULADA',
  'PENDIENTE CONFIRMACION',
  'PENDIENTE',
]);

export type DropiOrderAgg = {
  key: string;
  idPedido: string;
  numeroGuia: string;
  estatusNorm: string;
  producto: string;
  departamento: string;
  ciudad: string;
  transportadora: string;
  totalOrden: number;
  ganancia: number;
  precioFlete: number;
  costoDevolucionFlete: number;
  costoProducto: number;
  cantidad: number;
};

export type DropiReportKpiPack = {
  totalPedidos: number;
  conGuia: number;
  entregados: number;
  devueltos: number;
  pendientes: number;
  cancelados: number;
  efectividad: number;
  totalVentas: number;
  gananciaNeta: number;
  margenPct: number;
  fletePromGeneral: number;
  fleteDevPromGeneral: number;
  ticketProm: number;
};

export type DropiGuiaMetrics = {
  totalPedidos: number;
  totalVenta: number;
  totalCostoProducto: number;
  totalCostoFlete: number;
  totalOtrosCostos: number;
};

function cell(r: unknown[], i: number): unknown {
  return i < r.length ? r[i] : undefined;
}

function normStatus(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ');
}

/** Normaliza número de guía (Excel puede traerlo como número). */
export function normalizeDropiGuia(raw: unknown): string {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(Math.trunc(raw));
  return String(raw).trim();
}

export function parseDropiNumber(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = v.trim().replace(/[$\s]/g, '');
    if (!t) return 0;
    if (t.includes(',') && t.includes('.')) {
      const lastDot = t.lastIndexOf('.');
      const lastComma = t.lastIndexOf(',');
      if (lastComma > lastDot) {
        return parseFloat(t.replace(/\./g, '').replace(',', '.')) || 0;
      }
      return parseFloat(t.replace(/,/g, '')) || 0;
    }
    if (t.includes(',')) return parseFloat(t.replace(/\./g, '').replace(',', '.')) || 0;
    return parseFloat(t.replace(/,/g, '.')) || 0;
  }
  return 0;
}

function parseDate(v: unknown): Date | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === 'number' && Number.isFinite(v)) {
    try {
      const d = XLSX.SSF.parse_date_code(v);
      if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d));
    } catch {
      /* ignore */
    }
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function strCell(v: unknown): string {
  return String(v ?? '').trim();
}

export function dropiRowHasGuia(r: DropiRow): boolean {
  return r.numeroGuia.trim().length > 0;
}

export function dropiStatusExcludedFromGuiaYVentas(estatusNorm: string): boolean {
  return DROPI_EXCLUDED_FROM_GUIA_Y_VENTAS.has(estatusNorm);
}

export function dropiOrderKey(r: DropiRow): string {
  const guia = r.numeroGuia.trim();
  if (guia) return `guia:${guia}`;
  const id = String(r.idPedido ?? '').trim();
  if (id) return `id:${id}`;
  const fp = r.fechaPedido?.getTime() ?? 0;
  return `row:${fp}|${r.producto}|${r.totalOrden}|${r.estatusNorm}`;
}

/** Agrupa líneas del Excel en pedidos únicos (recuento distintivo por NÚMERO GUIA, como Dropi). */
export function aggregateDropiOrders(rows: DropiRow[]): DropiOrderAgg[] {
  const map = new Map<string, DropiOrderAgg>();
  for (const r of rows) {
    const key = dropiOrderKey(r);
    const guia = r.numeroGuia.trim();
    const cur = map.get(key);
    if (!cur) {
      map.set(key, {
        key,
        idPedido: String(r.idPedido ?? '').trim(),
        numeroGuia: guia,
        estatusNorm: r.estatusNorm,
        producto: r.producto,
        departamento: r.departamento,
        ciudad: r.ciudad,
        transportadora: r.transportadora,
        totalOrden: r.totalOrden,
        ganancia: r.ganancia,
        precioFlete: r.precioFlete,
        costoDevolucionFlete: r.costoDevolucionFlete,
        costoProducto: r.costoProducto,
        cantidad: r.cantidad,
      });
      continue;
    }
    cur.totalOrden += r.totalOrden;
    cur.ganancia += r.ganancia;
    cur.precioFlete += r.precioFlete;
    cur.costoDevolucionFlete += r.costoDevolucionFlete;
    cur.costoProducto += r.costoProducto;
    cur.cantidad += r.cantidad;
    if (!cur.idPedido && r.idPedido) cur.idPedido = String(r.idPedido).trim();
    if (!cur.numeroGuia && guia) cur.numeroGuia = guia;
    if (!cur.estatusNorm && r.estatusNorm) cur.estatusNorm = r.estatusNorm;
    if (cur.producto !== r.producto) {
      cur.producto = cur.producto.includes(r.producto) ? cur.producto : `${cur.producto} + ${r.producto}`;
    }
  }
  return [...map.values()];
}

function ordersWithGuia(orders: DropiOrderAgg[]): DropiOrderAgg[] {
  return orders.filter((o) => o.numeroGuia.trim().length > 0);
}

export { ordersWithGuia };

export const DROPI_PENDIENTE_ESTATUS_DEFAULT = new Set([
  'NOVEDAD',
  'RECLAME EN OFICINA',
  'INTENTO DE ENTREGA',
  'EN REPARTO',
  'EN REEXPEDICION',
  'DESPACHADA',
]);

export function computeDropiReportKpis(
  rows: DropiRow[],
  _pendienteEstatus: ReadonlySet<string> = DROPI_PENDIENTE_ESTATUS_DEFAULT,
): DropiReportKpiPack {
  const orders = aggregateDropiOrders(rows);
  /** Dropi: recuento distintivo de NÚMERO GUIA (no ID ni filas). */
  const guiaOrders = ordersWithGuia(orders);
  const totalPedidos = guiaOrders.length;

  const conGuiaOrders = guiaOrders.filter((o) => !dropiStatusExcludedFromGuiaYVentas(o.estatusNorm));
  const conGuia = conGuiaOrders.length;

  const entregados = guiaOrders.filter((o) => o.estatusNorm === 'ENTREGADO').length;
  const devueltos = guiaOrders.filter((o) => o.estatusNorm === 'DEVOLUCION').length;
  const cancelados = guiaOrders.filter((o) => o.estatusNorm === 'CANCELADO').length;

  const pendientes = conGuiaOrders.filter(
    (o) => o.estatusNorm !== 'ENTREGADO' && o.estatusNorm !== 'DEVOLUCION',
  ).length;

  const entregadosConGuia = conGuiaOrders.filter((o) => o.estatusNorm === 'ENTREGADO').length;
  const efectividad = conGuia > 0 ? (entregadosConGuia / conGuia) * 100 : 0;

  const ventasOrders = guiaOrders.filter((o) => !dropiStatusExcludedFromGuiaYVentas(o.estatusNorm));
  const totalVentas = ventasOrders.reduce((s, o) => s + o.totalOrden, 0);
  const gananciaNeta = ventasOrders.reduce((s, o) => s + o.ganancia, 0);
  const sumFlete = ventasOrders.reduce((s, o) => s + o.precioFlete, 0);
  const sumDevFlete = ventasOrders.reduce((s, o) => s + o.costoDevolucionFlete, 0);

  const margenPct = totalVentas > 0 ? (gananciaNeta / totalVentas) * 100 : 0;
  const nVentas = ventasOrders.length;
  const fletePromGeneral = nVentas > 0 ? sumFlete / nVentas : 0;
  const fleteDevPromGeneral = nVentas > 0 ? sumDevFlete / nVentas : 0;
  const ticketProm = nVentas > 0 ? totalVentas / nVentas : 0;

  return {
    totalPedidos,
    conGuia,
    entregados,
    devueltos,
    pendientes,
    cancelados,
    efectividad,
    totalVentas,
    gananciaNeta,
    margenPct,
    fletePromGeneral,
    fleteDevPromGeneral,
    ticketProm,
  };
}

/** Costos distintos a producto y flete (devolución de flete + diferencia no explicada). */
export function dropiOtrosCostosRow(r: DropiRow): number {
  const base = r.costoDevolucionFlete;
  const known = r.costoProducto + r.precioFlete + r.costoDevolucionFlete;
  const residual = r.totalOrden - r.ganancia - known;
  if (Math.abs(residual) < 0.01) return base;
  return base + residual;
}

function parseRow(arr: unknown[]): DropiRow | null {
  const producto = strCell(cell(arr, DROPI_COL.producto));
  const guia = normalizeDropiGuia(cell(arr, DROPI_COL.numeroGuia));
  const total = parseDropiNumber(cell(arr, DROPI_COL.totalOrden));
  const fechaP = parseDate(cell(arr, DROPI_COL.fechaPedido));
  const idPedido = strCell(cell(arr, DROPI_COL.idPedido));
  if (!producto && !guia && total === 0 && !fechaP && !idPedido) return null;
  return {
    fechaReporte: parseDate(cell(arr, DROPI_COL.fechaReporte)),
    fechaPedido: fechaP,
    idPedido,
    numeroGuia: guia,
    estatusNorm: normStatus(cell(arr, DROPI_COL.estatus)),
    departamento: strCell(cell(arr, DROPI_COL.departamento)),
    ciudad: strCell(cell(arr, DROPI_COL.ciudad)),
    transportadora: strCell(cell(arr, DROPI_COL.transportadora)),
    totalOrden: total,
    ganancia: parseDropiNumber(cell(arr, DROPI_COL.ganancia)),
    precioFlete: parseDropiNumber(cell(arr, DROPI_COL.precioFlete)),
    costoDevolucionFlete: parseDropiNumber(cell(arr, DROPI_COL.costoDevolucionFlete)),
    costoProducto: parseDropiNumber(cell(arr, DROPI_COL.costoProducto)),
    producto: producto || 'Sin producto',
    cantidad: parseDropiNumber(cell(arr, DROPI_COL.cantidad)),
  };
}

export function readDropiExcel(buf: ArrayBuffer): DropiRow[] {
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const name = wb.SheetNames[0];
  if (!name) return [];
  const sheet = wb.Sheets[name];
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: true,
  }) as unknown[][];
  const out: DropiRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!Array.isArray(row)) continue;
    const parsed = parseRow(row);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function computeDropiGuiaMetrics(rows: DropiRow[]): DropiGuiaMetrics {
  const orders = aggregateDropiOrders(rows).filter((o) => o.numeroGuia);
  let totalVenta = 0;
  let totalCostoProducto = 0;
  let totalCostoFlete = 0;
  let totalOtrosCostos = 0;

  for (const o of orders) {
    totalVenta += o.totalOrden;
    totalCostoProducto += o.costoProducto;
    totalCostoFlete += o.precioFlete;
    const known = o.costoProducto + o.precioFlete + o.costoDevolucionFlete;
    const residual = o.totalOrden - o.ganancia - known;
    totalOtrosCostos +=
      Math.abs(residual) < 0.01 ? o.costoDevolucionFlete : o.costoDevolucionFlete + residual;
  }

  return {
    totalPedidos: orders.length,
    totalVenta,
    totalCostoProducto,
    totalCostoFlete,
    totalOtrosCostos,
  };
}

export function formatDropiCOP(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const rounded = Math.round(n);
  const sign = rounded < 0 ? '-' : '';
  const digits = Math.abs(rounded).toString();
  const withSeparators = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}$${withSeparators}`;
}
