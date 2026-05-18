import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import * as XLSX from 'xlsx';
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
  type ChartData,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { IconChevronDown, IconUpload } from '@tabler/icons-react';
import { PageHeader } from '../design-system/PageHeader';
import { ds } from '../design-system/ds';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

/** Paleta reporte Dropi (gráficos, badges, barras) */
const C = {
  estadoEntregado: '#1D9E75',
  estadoCancelado: '#B4B2A9',
  estadoDevuelto: '#D85A30',
  estadoPendiente: '#BA7517',
  estadoOtros: '#5F5E5A',
  carrier1: '#185FA5',
  carrier2: '#534AB7',
  carrier3: '#1D9E75',
  carrierRest: '#B4B2A9',
  margenHigh: '#1D9E75',
  margenMid: '#BA7517',
  margenLow: '#D85A30',
  efectividadHigh: '#1D9E75',
  efectividadMid: '#BA7517',
  efectividadLow: '#D85A30',
  badgeGreenBg: '#EAF3DE',
  badgeGreenText: '#3B6D11',
  badgeAmberBg: '#FAEEDA',
  badgeAmberText: '#854F0B',
  badgeCoralBg: '#FAECE7',
  badgeCoralText: '#993C1D',
  badgeBlueBg: '#E6F1FB',
  badgeBlueText: '#185FA5',
  costText: '#993C1D',
  gainText: '#0F6E56',
  kpiEfectividadBorder: '#0F6E56',
} as const;

const COL = {
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

type DropiRow = {
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

function cell(r: unknown[], i: number): unknown {
  return i < r.length ? r[i] : undefined;
}

function normStatus(raw: unknown): string {
  const s = String(raw ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  return s;
}

function parseNumber(v: unknown): number {
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

function parseRow(arr: unknown[]): DropiRow | null {
  const producto = strCell(cell(arr, COL.producto));
  const guia = strCell(cell(arr, COL.numeroGuia));
  const total = parseNumber(cell(arr, COL.totalOrden));
  const fechaP = parseDate(cell(arr, COL.fechaPedido));
  if (!producto && !guia && total === 0 && !fechaP) return null;
  return {
    fechaReporte: parseDate(cell(arr, COL.fechaReporte)),
    fechaPedido: fechaP,
    numeroGuia: guia,
    estatusNorm: normStatus(cell(arr, COL.estatus)),
    departamento: strCell(cell(arr, COL.departamento)),
    ciudad: strCell(cell(arr, COL.ciudad)),
    transportadora: strCell(cell(arr, COL.transportadora)),
    totalOrden: total,
    ganancia: parseNumber(cell(arr, COL.ganancia)),
    precioFlete: parseNumber(cell(arr, COL.precioFlete)),
    costoDevolucionFlete: parseNumber(cell(arr, COL.costoDevolucionFlete)),
    costoProducto: parseNumber(cell(arr, COL.costoProducto)),
    producto: producto || 'Sin producto',
    cantidad: parseNumber(cell(arr, COL.cantidad)),
  };
}

function readDropiExcel(buf: ArrayBuffer): DropiRow[] {
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

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function rowInDateRange(r: DropiRow, start: string, end: string): boolean {
  if (!start && !end) return true;
  const fd = r.fechaPedido;
  if (!fd) return false;
  const t = startOfDay(fd).getTime();
  if (start) {
    if (t < startOfDay(new Date(start + 'T12:00:00')).getTime()) return false;
  }
  if (end) {
    const e = new Date(end + 'T23:59:59.999');
    if (fd > e) return false;
  }
  return true;
}

function formatCOP(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000 && abs < 1_000_000_000) {
    return `$${(n / 1_000_000).toFixed(1)}M`;
  }
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n);
}

function formatPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

const PENDIENTE_ESTATUS = new Set([
  'NOVEDAD',
  'RECLAME EN OFICINA',
  'INTENTO DE ENTREGA',
  'EN REPARTO',
  'EN REEXPEDICION',
  'DESPACHADA',
]);

function colorForStatus(s: string): string {
  if (s === 'ENTREGADO') return C.estadoEntregado;
  if (s === 'CANCELADO') return C.estadoCancelado;
  if (s === 'DEVOLUCION') return C.estadoDevuelto;
  if (PENDIENTE_ESTATUS.has(s)) return C.estadoPendiente;
  return C.estadoOtros;
}

function colorForCarrierIndex(i: number): string {
  if (i === 0) return C.carrier1;
  if (i === 1) return C.carrier2;
  if (i === 2) return C.carrier3;
  return C.carrierRest;
}

function marginBarColor(pct: number): string {
  if (pct >= 22) return C.margenHigh;
  if (pct >= 15) return C.margenMid;
  return C.margenLow;
}

function effBarColor(pct: number): string {
  if (pct >= 80) return C.efectividadHigh;
  if (pct >= 60) return C.efectividadMid;
  return C.efectividadLow;
}

function effBadgeStyle(pct: number): { bg: string; color: string } {
  if (pct >= 80) return { bg: C.badgeGreenBg, color: C.badgeGreenText };
  if (pct >= 60) return { bg: C.badgeAmberBg, color: C.badgeAmberText };
  return { bg: C.badgeCoralBg, color: C.badgeCoralText };
}

function marginBadgeStyle(pct: number): { bg: string; color: string } {
  if (pct >= 22) return { bg: C.badgeGreenBg, color: C.badgeGreenText };
  if (pct >= 15) return { bg: C.badgeAmberBg, color: C.badgeAmberText };
  return { bg: C.badgeCoralBg, color: C.badgeCoralText };
}

function Badge({ children, bg, color }: { children: ReactNode; bg: string; color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        background: bg,
        color,
      }}
    >
      {children}
    </span>
  );
}

function MiniBar({ pct, color }: { pct: number; color: string }) {
  const w = Math.min(100, Math.max(0, pct));
  return (
    <div
      style={{
        height: 6,
        borderRadius: 4,
        background: `${C.estadoOtros}33`,
        minWidth: 72,
        overflow: 'hidden',
      }}
    >
      <div style={{ width: `${w}%`, height: '100%', borderRadius: 4, background: color }} />
    </div>
  );
}

function tableWrapStyle(): CSSProperties {
  return {
    border: `0.5px solid ${ds.borderCard}`,
    borderRadius: 14,
    overflow: 'auto',
    background: ds.bgCard,
  };
}

function thStyle(): CSSProperties {
  return {
    textAlign: 'left' as const,
    padding: '10px 12px',
    fontSize: 11,
    fontWeight: 700,
    color: ds.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.02em',
    borderBottom: `0.5px solid ${ds.borderCard}`,
    background: ds.bgSubtle,
    whiteSpace: 'nowrap' as const,
  };
}

function tdStyle(): CSSProperties {
  return {
    padding: '8px 12px',
    fontSize: 12,
    color: ds.textPrimary,
    borderBottom: `0.5px solid ${ds.borderRow}`,
    verticalAlign: 'middle',
  };
}

type KpiPack = {
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

function computeKpis(rows: DropiRow[]): KpiPack {
  const n = rows.length;
  let conGuia = 0;
  let entregados = 0;
  let devueltos = 0;
  let cancelados = 0;
  let sumVentas = 0;
  let sumGanancia = 0;
  let sumFlete = 0;
  let sumDevFlete = 0;
  for (const r of rows) {
    if (r.numeroGuia) conGuia++;
    if (r.estatusNorm === 'ENTREGADO') entregados++;
    if (r.estatusNorm === 'DEVOLUCION') devueltos++;
    if (r.estatusNorm === 'CANCELADO') cancelados++;
    sumVentas += r.totalOrden;
    sumGanancia += r.ganancia;
    sumFlete += r.precioFlete;
    sumDevFlete += r.costoDevolucionFlete;
  }
  const pendientes = Math.max(0, conGuia - entregados - devueltos);
  const efectividad = conGuia > 0 ? (entregados / conGuia) * 100 : 0;
  const margenPct = sumVentas > 0 ? (sumGanancia / sumVentas) * 100 : 0;
  const fletePromGeneral = n > 0 ? sumFlete / n : 0;
  const fleteDevPromGeneral = n > 0 ? sumDevFlete / n : 0;
  const ticketProm = n > 0 ? sumVentas / n : 0;
  return {
    totalPedidos: n,
    conGuia,
    entregados,
    devueltos,
    pendientes,
    cancelados,
    efectividad,
    totalVentas: sumVentas,
    gananciaNeta: sumGanancia,
    margenPct,
    fletePromGeneral,
    fleteDevPromGeneral,
    ticketProm,
  };
}

export default function ReporteDropiPage() {
  const [rawRows, setRawRows] = useState<DropiRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [carrier, setCarrier] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [productMenuOpen, setProductMenuOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const productMenuRef = useRef<HTMLDivElement>(null);

  const productOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rawRows) s.add(r.producto);
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'es'));
  }, [rawRows]);

  const filteredProductOptions = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return productOptions;
    return productOptions.filter((p) => p.toLowerCase().includes(q));
  }, [productOptions, productSearch]);

  useEffect(() => {
    if (!productMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const el = productMenuRef.current;
      if (el && !el.contains(e.target as Node)) setProductMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setProductMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [productMenuOpen]);

  const carrierOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rawRows) {
      if (r.transportadora) s.add(r.transportadora);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'es'));
  }, [rawRows]);

  const filteredRows = useMemo(() => {
    return rawRows.filter((r) => {
      if (selectedProducts.length > 0 && !selectedProducts.includes(r.producto)) return false;
      if (!rowInDateRange(r, dateStart, dateEnd)) return false;
      if (carrier && r.transportadora !== carrier) return false;
      return true;
    });
  }, [rawRows, selectedProducts, dateStart, dateEnd, carrier]);

  const kpi = useMemo(() => computeKpis(filteredRows), [filteredRows]);

  const productEffectiveness = useMemo(() => {
    const map = new Map<
      string,
      { pedidos: number; conG: number; ent: number; dev: number; gan: number }
    >();
    for (const r of filteredRows) {
      const k = r.producto;
      if (!map.has(k)) map.set(k, { pedidos: 0, conG: 0, ent: 0, dev: 0, gan: 0 });
      const a = map.get(k)!;
      a.pedidos++;
      if (r.numeroGuia) a.conG++;
      if (r.estatusNorm === 'ENTREGADO') a.ent++;
      if (r.estatusNorm === 'DEVOLUCION') a.dev++;
      a.gan += r.ganancia;
    }
    const rows = Array.from(map.entries()).map(([producto, v]) => {
      const pend = Math.max(0, v.conG - v.ent - v.dev);
      const eff = v.conG > 0 ? (v.ent / v.conG) * 100 : 0;
      return { producto, ...v, pend, eff };
    });
    rows.sort((a, b) => b.eff - a.eff);
    return rows;
  }, [filteredRows]);

  const productFlete = useMemo(() => {
    const map = new Map<string, { n: number; sv: number; sf: number; sd: number }>();
    for (const r of filteredRows) {
      const k = r.producto;
      if (!map.has(k)) map.set(k, { n: 0, sv: 0, sf: 0, sd: 0 });
      const a = map.get(k)!;
      a.n++;
      a.sv += r.totalOrden;
      a.sf += r.precioFlete;
      a.sd += r.costoDevolucionFlete;
    }
    return Array.from(map.entries())
      .map(([producto, v]) => {
        const ticketProm = v.n > 0 ? v.sv / v.n : 0;
        const fleteProm = v.n > 0 ? v.sf / v.n : 0;
        const devProm = v.n > 0 ? v.sd / v.n : 0;
        const ftPct = v.sv > 0 ? (v.sf / v.sv) * 100 : 0;
        return { producto, ...v, ticketProm, fleteProm, devProm, ftPct };
      })
      .sort((a, b) => b.sv - a.sv);
  }, [filteredRows]);

  const estadoResultadosEntregados = useMemo(() => {
    let ventas = 0;
    let costoProducto = 0;
    let costoFlete = 0;
    let costoFleteDevolucion = 0;
    for (const r of filteredRows) {
      if (r.estatusNorm !== 'ENTREGADO') continue;
      ventas += r.totalOrden;
      costoProducto += r.costoProducto;
      costoFlete += r.precioFlete;
      costoFleteDevolucion += r.costoDevolucionFlete;
    }
    const gananciaBruta = ventas - costoProducto - costoFlete - costoFleteDevolucion;
    const margenBruto = ventas > 0 ? (gananciaBruta / ventas) * 100 : 0;
    return { ventas, costoProducto, costoFlete, costoFleteDevolucion, gananciaBruta, margenBruto };
  }, [filteredRows]);

  const productPnl = useMemo(() => {
    const map = new Map<string, { ventas: number; cp: number; cf: number; fd: number }>();
    for (const r of filteredRows) {
      if (r.estatusNorm !== 'ENTREGADO') continue;
      const k = r.producto;
      if (!map.has(k)) map.set(k, { ventas: 0, cp: 0, cf: 0, fd: 0 });
      const a = map.get(k)!;
      a.ventas += r.totalOrden;
      a.cp += r.costoProducto;
      a.cf += r.precioFlete;
      a.fd += r.costoDevolucionFlete;
    }
    const rows = Array.from(map.entries()).map(([producto, v]) => {
      const gananciaBruta = v.ventas - v.cp - v.cf - v.fd;
      const margenBruto = v.ventas > 0 ? (gananciaBruta / v.ventas) * 100 : 0;
      return { producto, ...v, gananciaBruta, margenBruto };
    });
    rows.sort((a, b) => b.gananciaBruta - a.gananciaBruta);
    const totals = rows.reduce(
      (acc, r) => {
        acc.ventas += r.ventas;
        acc.cp += r.cp;
        acc.cf += r.cf;
        acc.fd += r.fd;
        return acc;
      },
      { ventas: 0, cp: 0, cf: 0, fd: 0 },
    );
    const gananciaBrutaTotal = totals.ventas - totals.cp - totals.cf - totals.fd;
    const margenBrutoTotal = totals.ventas > 0 ? (gananciaBrutaTotal / totals.ventas) * 100 : 0;
    return {
      rows,
      totals: { ...totals, gananciaBruta: gananciaBrutaTotal, margenBruto: margenBrutoTotal },
    };
  }, [filteredRows]);

  const statusCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of filteredRows) {
      const k = r.estatusNorm || '—';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [filteredRows]);

  const carrierCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of filteredRows) {
      const k = r.transportadora || 'Sin transportadora';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [filteredRows]);

  const doughnutCardBorder = useMemo(() => {
    if (typeof document === 'undefined') return '#ffffff';
    const v = getComputedStyle(document.documentElement).getPropertyValue('--color-bg-card').trim();
    return v || '#ffffff';
  }, []);

  const donutEstados: ChartData<'doughnut'> = useMemo(() => {
    const labels = statusCounts.map(([s]) => s);
    const data = statusCounts.map(([, n]) => n);
    const colors = labels.map((s) => colorForStatus(s));
    return {
      labels,
      datasets: [
        {
          data,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: doughnutCardBorder,
          hoverOffset: 4,
        },
      ],
    };
  }, [statusCounts, doughnutCardBorder]);

  const donutCarrier: ChartData<'doughnut'> = useMemo(() => {
    const labels = carrierCounts.map(([s]) => s);
    const data = carrierCounts.map(([, n]) => n);
    const colors = labels.map((_, i) => colorForCarrierIndex(i));
    return {
      labels,
      datasets: [
        {
          data,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: doughnutCardBorder,
          hoverOffset: 4,
        },
      ],
    };
  }, [carrierCounts, doughnutCardBorder]);

  const barProductGanancia: ChartData<'bar'> = useMemo(() => {
    const slice = productPnl.rows.slice(0, 7);
    const labels = slice.map((r) => r.producto);
    const data = slice.map((r) => r.gananciaBruta);
    const backgroundColor = slice.map((r) => marginBarColor(r.margenBruto));
    return {
      labels,
      datasets: [
        {
          label: 'Ganancia',
          data,
          backgroundColor,
          borderRadius: 6,
          borderSkipped: false,
        },
      ],
    };
  }, [productPnl.rows]);

  const chartOpts = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false as const,
      plugins: { legend: { display: false } },
      cutout: '68%',
    }),
    [],
  );

  const barHorizOpts = useMemo(
    () => ({
      indexAxis: 'y' as const,
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: `${C.estadoOtros}22` }, ticks: { font: { size: 11 } } },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    }),
    [],
  );

  const processFile = useCallback((f: File) => {
    if (!f.name.toLowerCase().endsWith('.xlsx')) {
      setError('Usa un archivo .xlsx exportado desde Dropi.');
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const buf = reader.result as ArrayBuffer;
        const rows = readDropiExcel(buf);
        setRawRows(rows);
        setFileName(f.name);
        setSelectedProducts([]);
        setDateStart('');
        setDateEnd('');
        setCarrier('');
        setProductMenuOpen(false);
        setProductSearch('');
      } catch {
        setError('No se pudo leer el Excel. Revisa que sea el export estándar de Dropi.');
      }
    };
    reader.readAsArrayBuffer(f);
  }, []);

  const onFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      processFile(f);
    },
    [processFile],
  );

  const onDropZoneDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragActive(true);
  }, []);

  const onDropZoneDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragActive(false);
  }, []);

  const onDropZoneDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragActive(false);
      const f = e.dataTransfer.files?.[0];
      if (!f) return;
      processFile(f);
    },
    [processFile],
  );


  const selectAllProducts = useCallback(() => setSelectedProducts([]), []);

  const downloadPdf = useCallback(async () => {
    const el = exportRef.current;
    if (!el || filteredRows.length === 0) return;
    setPdfLoading(true);
    try {
      const canvas = await html2canvas(el, {
        scale: 1.25,
        useCORS: true,
        logging: false,
        backgroundColor: getComputedStyle(document.body).backgroundColor || '#ffffff',
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW;
      const imgH = (canvas.height * pageW) / canvas.width;
      let y = 0;
      while (y < imgH) {
        pdf.addImage(imgData, 'JPEG', 0, -y, imgW, imgH);
        y += pageH;
        if (y < imgH) pdf.addPage();
      }
      pdf.save('reporte-dropi-kovo.pdf');
    } catch {
      window.alert('No se pudo generar el PDF.');
    } finally {
      setPdfLoading(false);
    }
  }, [filteredRows.length]);

  const hasData = rawRows.length > 0;

  const efectividadTotalPct = kpi.efectividad;

  const kpiItems: Array<{
    label: string;
    value: string;
    sub: string;
    highlight?: boolean;
    valueColor?: string;
  }> = [
    { label: 'Total pedidos', value: String(kpi.totalPedidos), sub: '100% del filtro' },
    {
      label: 'Con guía',
      value: String(kpi.conGuia),
      sub: formatPct(kpi.totalPedidos > 0 ? (kpi.conGuia / kpi.totalPedidos) * 100 : 0) + ' del total',
    },
    {
      label: 'Efectividad total',
      value: formatPct(efectividadTotalPct),
      sub: 'entregados / pedidos con guía',
      highlight: true,
      valueColor: C.kpiEfectividadBorder,
    },
    {
      label: 'Entregados',
      value: String(kpi.entregados),
      sub: formatPct(kpi.conGuia > 0 ? (kpi.entregados / kpi.conGuia) * 100 : 0) + ' sobre con guía',
    },
    {
      label: 'Devueltos',
      value: String(kpi.devueltos),
      sub: formatPct(kpi.conGuia > 0 ? (kpi.devueltos / kpi.conGuia) * 100 : 0) + ' sobre con guía',
    },
    {
      label: 'Pendientes',
      value: String(kpi.pendientes),
      sub: formatPct(kpi.conGuia > 0 ? (kpi.pendientes / kpi.conGuia) * 100 : 0) + ' sobre con guía',
    },
    {
      label: 'Cancelados',
      value: String(kpi.cancelados),
      sub: formatPct(kpi.totalPedidos > 0 ? (kpi.cancelados / kpi.totalPedidos) * 100 : 0) + ' del total',
    },
    { label: 'Total ventas', value: formatCOP(kpi.totalVentas), sub: 'COP' },
    { label: 'Ganancia neta', value: formatCOP(kpi.gananciaNeta), sub: `Margen ${formatPct(kpi.margenPct)}` },
  ];

  const kpiGrid = (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: 12,
      }}
    >
      {kpiItems.map((c) => (
        <div
          key={c.label}
          style={{
            background: ds.bgCard,
            border: c.highlight ? `1.5px solid ${C.kpiEfectividadBorder}` : `0.5px solid ${ds.borderCard}`,
            borderRadius: 14,
            padding: '14px 16px',
          }}
        >
          <div style={{ fontSize: 11, color: ds.textMuted, fontWeight: 600, marginBottom: 6 }}>{c.label}</div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: c.valueColor ?? ds.textPrimary,
              lineHeight: 1.2,
            }}
          >
            {c.value}
          </div>
          <div style={{ fontSize: 11, color: ds.textHint, marginTop: 6 }}>{c.sub}</div>
        </div>
      ))}
    </div>
  );

  const productFilterSummary =
    selectedProducts.length === 0
      ? 'Todos los productos'
      : selectedProducts.length === 1
        ? selectedProducts[0]
        : `${selectedProducts.length} productos`;

  const filtersPanel = (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 14,
        alignItems: 'flex-end',
        padding: 16,
        border: `0.5px solid ${ds.borderCard}`,
        borderRadius: 14,
        background: ds.bgCard,
        marginBottom: 16,
      }}
    >
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        style={{
          padding: '10px 18px',
          borderRadius: 10,
          border: 'none',
          background: ds.brand,
          color: '#fff',
          fontWeight: 700,
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        Cargar archivo
      </button>
      {fileName ? (
        <span style={{ fontSize: 12, color: ds.textSecondary }}>
          <strong>{fileName}</strong> · {rawRows.length} filas
        </span>
      ) : null}
      <div
        ref={productMenuRef}
        style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 220, flex: '1 1 200px', position: 'relative' }}
      >
        <label style={{ fontSize: 11, fontWeight: 600, color: ds.textMuted }}>Productos</label>
        <button
          type="button"
        onClick={() => {
          setProductMenuOpen((o) => !o);
        }}
        aria-expanded={productMenuOpen}
        aria-haspopup="true"
          style={{
            ...inputStyle(),
            width: '100%',
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
            {productFilterSummary}
          </span>
          <IconChevronDown
            size={18}
            stroke={1.5}
            style={{
              flexShrink: 0,
              color: ds.textMuted,
              transform: productMenuOpen ? 'rotate(180deg)' : undefined,
              transition: 'transform 0.15s ease',
            }}
          />
        </button>
        {productMenuOpen ? (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: '100%',
              marginTop: 4,
              background: ds.bgCard,
              border: `1px solid ${ds.borderCard}`,
              borderRadius: 10,
              boxShadow: '0 10px 28px rgba(0,0,0,0.14)',
              zIndex: 60,
              display: 'flex',
              flexDirection: 'column',
              maxHeight: 320,
            }}
          >
            <div style={{ padding: 8, borderBottom: `0.5px solid ${ds.borderCard}` }}>
              <input
                type="search"
                placeholder="Buscar producto…"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                style={{ ...inputStyle(), width: '100%', boxSizing: 'border-box' }}
                autoFocus
              />
            </div>
            <div style={{ overflowY: 'auto', maxHeight: 220, padding: '4px 6px' }}>
              {filteredProductOptions.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12, color: ds.textMuted }}>Sin coincidencias</div>
              ) : (
                filteredProductOptions.map((p) => (
                  <label
                    key={p}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '7px 8px',
                      borderRadius: 8,
                      cursor: 'pointer',
                      fontSize: 12,
                      color: ds.textPrimary,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedProducts.includes(p)}
                      onChange={() => {
                        setSelectedProducts((prev) =>
                          prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
                        );
                      }}
                    />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p}</span>
                  </label>
                ))
              )}
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                padding: 8,
                borderTop: `0.5px solid ${ds.borderCard}`,
              }}
            >
              <button
                type="button"
                onClick={() => setSelectedProducts([...productOptions])}
                style={{
                  fontSize: 11,
                  background: ds.bgSubtle,
                  border: `0.5px solid ${ds.borderCard}`,
                  borderRadius: 8,
                  padding: '6px 10px',
                  cursor: 'pointer',
                  color: ds.textPrimary,
                  fontWeight: 600,
                }}
              >
                Marcar todos
              </button>
              <button
                type="button"
                onClick={() => {
                  selectAllProducts();
                  setProductSearch('');
                }}
                style={{
                  fontSize: 11,
                  background: 'none',
                  border: `0.5px solid ${ds.borderCard}`,
                  borderRadius: 8,
                  padding: '6px 10px',
                  cursor: 'pointer',
                  color: ds.brand,
                  fontWeight: 600,
                }}
              >
                Limpiar selección
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: ds.textMuted }}>Desde (FECHA pedido)</label>
          <input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} style={inputStyle()} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: ds.textMuted }}>Hasta</label>
          <input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} style={inputStyle()} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 160 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: ds.textMuted }}>Transportadora</label>
          <select value={carrier} onChange={(e) => setCarrier(e.target.value)} style={selectStyle()}>
            <option value="">Todas</option>
            {carrierOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button
        type="button"
        disabled={!hasData || pdfLoading}
        onClick={() => void downloadPdf()}
        style={{
          padding: '10px 18px',
          borderRadius: 10,
          border: `0.5px solid ${ds.borderCard}`,
          background: hasData ? ds.bgSubtle : ds.bgSubtle,
          color: ds.textPrimary,
          fontWeight: 700,
          fontSize: 13,
          cursor: hasData && !pdfLoading ? 'pointer' : 'not-allowed',
          opacity: hasData ? 1 : 0.5,
        }}
      >
        {pdfLoading ? 'Generando PDF…' : 'Descargar PDF'}
      </button>
    </div>
  );

  if (!hasData) {
    return (
      <div style={{ maxWidth: 980 }}>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          style={{ display: 'none' }}
          onChange={onFile}
        />
        <PageHeader title="Reporte Dropi" subtitle="Analiza exportaciones .xlsx sin subirlas al servidor." />
        {error ? (
          <div
            style={{
              marginBottom: 14,
              padding: 12,
              borderRadius: 10,
              background: ds.dangerBg,
              color: ds.dangerText,
              fontSize: 13,
            }}
          >
            {error}
          </div>
        ) : null}
        <div
          onDragOver={onDropZoneDragOver}
          onDragLeave={onDropZoneDragLeave}
          onDrop={onDropZoneDrop}
          style={{
            border: isDragActive ? `1.5px dashed ${ds.brand}` : `0.5px solid ${ds.borderCard}`,
            borderRadius: 14,
            background: isDragActive ? ds.bgSubtle : ds.bgCard,
            padding: '48px 32px',
            textAlign: 'center',
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16, color: C.carrier2 }}>
            <IconUpload size={56} stroke={1.25} />
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: ds.textPrimary, marginBottom: 8 }}>Carga tu reporte de Dropi para comenzar</div>
          <div style={{ fontSize: 13, color: ds.textSecondary, maxWidth: 420, margin: '0 auto 24px', lineHeight: 1.5 }}>
            Arrastra y suelta aquí tu archivo o descárgalo desde Dropi: Mis órdenes → Exportar → .xlsx
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            style={{
              padding: '12px 28px',
              borderRadius: 10,
              border: 'none',
              background: ds.brand,
              color: '#fff',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Cargar archivo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ maxWidth: 1100 }}
      onDragOver={onDropZoneDragOver}
      onDragLeave={onDropZoneDragLeave}
      onDrop={onDropZoneDrop}
    >
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        style={{ display: 'none' }}
        onChange={onFile}
      />
      <PageHeader title="Reporte Dropi" subtitle="Procesamiento local: el archivo no se envía al servidor." />
      {isDragActive ? (
        <div
          style={{
            marginBottom: 14,
            padding: 14,
            borderRadius: 10,
            border: `1.5px dashed ${ds.brand}`,
            background: ds.bgSubtle,
            color: ds.brand,
            fontSize: 13,
            fontWeight: 700,
            textAlign: 'center',
          }}
        >
          Suelta el archivo .xlsx para reemplazar el reporte actual
        </div>
      ) : null}
      {error ? (
        <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, background: ds.warningBg, color: ds.warningText, fontSize: 13 }}>{error}</div>
      ) : null}
      {filtersPanel}
      <div
        ref={exportRef}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          background: ds.bgApp,
          padding: 8,
          borderRadius: 8,
        }}
      >
        <section>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: ds.textPrimary, margin: '0 0 12px' }}>KPIs principales</h3>
          {kpiGrid}
        </section>
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 8px' }}>Distribución por estado</h3>
            <div style={{ height: 260, position: 'relative' }}>
              <Doughnut data={donutEstados} options={chartOpts} />
            </div>
            <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, fontSize: 12, color: ds.textSecondary }}>
              {statusCounts.map(([s, n]) => (
                <li key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: colorForStatus(s) }} />
                  {s}: <strong>{n}</strong>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 8px' }}>Pedidos por transportadora</h3>
            <div style={{ height: 260, position: 'relative' }}>
              <Doughnut data={donutCarrier} options={chartOpts} />
            </div>
            <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, fontSize: 12, color: ds.textSecondary }}>
              {carrierCounts.slice(0, 12).map(([s, n], i) => {
                const col = colorForCarrierIndex(i);
                return (
                  <li key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: col }} />
                    {s}: <strong>{n}</strong>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
        <section>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px' }}>Efectividad por producto</h3>
          <div style={tableWrapStyle()}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Producto', 'Pedidos', 'Entregados', 'Devueltos', 'Pendientes', 'Efectividad', 'Ganancia', ''].map((h) => (
                    <th key={h || 'bar'} style={thStyle()}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {productEffectiveness.map((r) => {
                  const st = effBadgeStyle(r.eff);
                  return (
                    <tr key={r.producto}>
                      <td style={tdStyle()}>{r.producto}</td>
                      <td style={tdStyle()}>{r.pedidos}</td>
                      <td style={tdStyle()}>
                        <Badge bg={C.badgeGreenBg} color={C.badgeGreenText}>
                          {r.ent}
                        </Badge>
                      </td>
                      <td style={tdStyle()}>
                        <Badge bg={C.badgeCoralBg} color={C.badgeCoralText}>
                          {r.dev}
                        </Badge>
                      </td>
                      <td style={tdStyle()}>
                        <Badge bg={C.badgeAmberBg} color={C.badgeAmberText}>
                          {r.pend}
                        </Badge>
                      </td>
                      <td style={tdStyle()}>
                        <Badge bg={st.bg} color={st.color}>
                          {formatPct(r.eff)}
                        </Badge>
                      </td>
                      <td style={tdStyle()}>{formatCOP(r.gan)}</td>
                      <td style={tdStyle()} width={100}>
                        <MiniBar pct={r.eff} color={effBarColor(r.eff)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        <section>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px' }}>Flete por producto</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
            <span style={pillStyle()}>
              Flete prom. general: <strong>{formatCOP(kpi.fletePromGeneral)}</strong>
            </span>
            <span style={pillStyle()}>
              Flete dev. prom.: <strong>{formatCOP(kpi.fleteDevPromGeneral)}</strong>
            </span>
            <span style={pillStyle()}>
              Ticket prom.: <strong>{formatCOP(kpi.ticketProm)}</strong>
            </span>
          </div>
          <div style={tableWrapStyle()}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Producto', 'Pedidos', 'Ticket prom.', 'Flete prom. envío', 'Flete prom. devol.', 'Flete / ticket', 'Impacto'].map((h) => (
                    <th key={h} style={thStyle()}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {productFlete.map((r) => {
                  const st = r.ftPct <= 15 ? effBadgeStyle(85) : r.ftPct <= 25 ? effBadgeStyle(70) : effBadgeStyle(55);
                  return (
                    <tr key={r.producto}>
                      <td style={tdStyle()}>{r.producto}</td>
                      <td style={tdStyle()}>{r.n}</td>
                      <td style={tdStyle()}>{formatCOP(r.ticketProm)}</td>
                      <td style={tdStyle()}>{formatCOP(r.fleteProm)}</td>
                      <td style={tdStyle()}>{formatCOP(r.devProm)}</td>
                      <td style={tdStyle()}>
                        <Badge bg={st.bg} color={st.color}>
                          {formatPct(r.ftPct)}
                        </Badge>
                      </td>
                      <td style={tdStyle()}>
                        <MiniBar pct={Math.min(100, r.ftPct * 2)} color={C.carrier1} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        <section>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px' }}>Estado de resultados (entregados)</h3>
          <p style={{ fontSize: 12, color: ds.textSecondary, margin: '0 0 12px', lineHeight: 1.5 }}>
            Solo pedidos con estatus ENTREGADO. Ganancia bruta = ventas − costo producto − costo flete − costo flete devolución.
          </p>
          <div style={tableWrapStyle()}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {[
                    'Ventas entregados',
                    'Costo producto entregados',
                    'Costo de flete',
                    'Costo flete devolución',
                    'Ganancia bruta',
                    'Margen bruto',
                  ].map((h) => (
                    <th key={h} style={thStyle()}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ ...tdStyle(), fontWeight: 700 }}>{formatCOP(estadoResultadosEntregados.ventas)}</td>
                  <td style={{ ...tdStyle(), color: C.costText, fontWeight: 600 }}>
                    -{formatCOP(estadoResultadosEntregados.costoProducto)}
                  </td>
                  <td style={{ ...tdStyle(), color: C.costText, fontWeight: 600 }}>
                    -{formatCOP(estadoResultadosEntregados.costoFlete)}
                  </td>
                  <td style={{ ...tdStyle(), color: C.costText, fontWeight: 600 }}>
                    -{formatCOP(estadoResultadosEntregados.costoFleteDevolucion)}
                  </td>
                  <td style={{ ...tdStyle(), color: C.gainText, fontWeight: 800 }}>
                    {formatCOP(estadoResultadosEntregados.gananciaBruta)}
                  </td>
                  <td style={tdStyle()}>
                    <Badge
                      bg={marginBadgeStyle(estadoResultadosEntregados.margenBruto).bg}
                      color={marginBadgeStyle(estadoResultadosEntregados.margenBruto).color}
                    >
                      {formatPct(estadoResultadosEntregados.margenBruto)}
                    </Badge>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <section>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px' }}>Estado de resultados por producto (entregados)</h3>
          <div style={tableWrapStyle()}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {[
                    'Producto',
                    'Ventas entregados',
                    'Costo producto',
                    'Costo flete',
                    'Flete devolución',
                    'Ganancia bruta',
                    'Margen bruto',
                    'Rentabilidad',
                  ].map((h) => (
                    <th key={h} style={thStyle()}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {productPnl.rows.map((r) => {
                  const st = marginBadgeStyle(r.margenBruto);
                  return (
                    <tr key={r.producto}>
                      <td style={tdStyle()}>{r.producto}</td>
                      <td style={tdStyle()}>{formatCOP(r.ventas)}</td>
                      <td style={{ ...tdStyle(), color: C.costText, fontWeight: 600 }}>-{formatCOP(r.cp)}</td>
                      <td style={{ ...tdStyle(), color: C.costText, fontWeight: 600 }}>-{formatCOP(r.cf)}</td>
                      <td style={{ ...tdStyle(), color: C.costText, fontWeight: 600 }}>-{formatCOP(r.fd)}</td>
                      <td style={{ ...tdStyle(), color: C.gainText, fontWeight: 700 }}>{formatCOP(r.gananciaBruta)}</td>
                      <td style={tdStyle()}>
                        <Badge bg={st.bg} color={st.color}>
                          {formatPct(r.margenBruto)}
                        </Badge>
                      </td>
                      <td style={tdStyle()}>
                        <MiniBar pct={Math.min(100, Math.max(0, r.margenBruto))} color={marginBarColor(r.margenBruto)} />
                      </td>
                    </tr>
                  );
                })}
                <tr
                  style={{
                    background: 'var(--color-background-secondary)',
                    fontWeight: 800,
                  }}
                >
                  <td style={{ ...tdStyle(), fontWeight: 800 }}>TOTAL GENERAL</td>
                  <td style={tdStyle()}>{formatCOP(productPnl.totals.ventas)}</td>
                  <td style={{ ...tdStyle(), color: C.costText }}>-{formatCOP(productPnl.totals.cp)}</td>
                  <td style={{ ...tdStyle(), color: C.costText }}>-{formatCOP(productPnl.totals.cf)}</td>
                  <td style={{ ...tdStyle(), color: C.costText }}>-{formatCOP(productPnl.totals.fd)}</td>
                  <td style={{ ...tdStyle(), color: C.gainText }}>{formatCOP(productPnl.totals.gananciaBruta)}</td>
                  <td style={tdStyle()}>
                    <Badge
                      bg={marginBadgeStyle(productPnl.totals.margenBruto).bg}
                      color={marginBadgeStyle(productPnl.totals.margenBruto).color}
                    >
                      {formatPct(productPnl.totals.margenBruto)}
                    </Badge>
                  </td>
                  <td style={tdStyle()}>
                    <MiniBar
                      pct={Math.min(100, Math.max(0, productPnl.totals.margenBruto))}
                      color={marginBarColor(productPnl.totals.margenBruto)}
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <section>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px' }}>Ganancia bruta por producto (color = margen bruto %)</h3>
          <div style={{ height: 280, position: 'relative', ...tableWrapStyle(), padding: 12 }}>
            <Bar data={barProductGanancia} options={barHorizOpts} />
          </div>
        </section>
      </div>
    </div>
  );
}

function inputStyle(): CSSProperties {
  return {
    padding: '8px 10px',
    borderRadius: 8,
    border: `1px solid ${ds.borderCard}`,
    fontSize: 13,
    background: ds.bgCard,
    color: ds.textPrimary,
  };
}

function selectStyle(): CSSProperties {
  return {
    ...inputStyle(),
    width: '100%',
  };
}

function pillStyle(): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 14px',
    borderRadius: 999,
    fontSize: 12,
    background: C.badgeBlueBg,
    color: C.badgeBlueText,
    border: `0.5px solid ${C.carrier1}44`,
  };
}
