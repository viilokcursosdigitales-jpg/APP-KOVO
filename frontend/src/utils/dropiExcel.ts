import * as XLSX from 'xlsx';

export const DROPI_COL = {
  fechaReporte: 0,
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
    .replace(/\p{M}/gu, '');
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
  const guia = strCell(cell(arr, DROPI_COL.numeroGuia));
  const total = parseDropiNumber(cell(arr, DROPI_COL.totalOrden));
  const fechaP = parseDate(cell(arr, DROPI_COL.fechaPedido));
  if (!producto && !guia && total === 0 && !fechaP) return null;
  return {
    fechaReporte: parseDate(cell(arr, DROPI_COL.fechaReporte)),
    fechaPedido: fechaP,
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
  let totalPedidos = 0;
  let totalVenta = 0;
  let totalCostoProducto = 0;
  let totalCostoFlete = 0;
  let totalOtrosCostos = 0;

  for (const r of rows) {
    if (!dropiRowHasGuia(r)) continue;
    totalPedidos++;
    totalVenta += r.totalOrden;
    totalCostoProducto += r.costoProducto;
    totalCostoFlete += r.precioFlete;
    totalOtrosCostos += dropiOtrosCostosRow(r);
  }

  return {
    totalPedidos,
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
