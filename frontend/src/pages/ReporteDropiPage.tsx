import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from 'chart.js';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import ReporteDropiDashboardView, { ReporteDropiEmptyState } from './reporteDropi/ReporteDropiDashboardView';
import { colorForCarrierIndex, colorForStatus, marginBarColor } from './reporteDropi/reporteDropiUi';
import {
  aggregateDropiOrders,
  computeDropiReportKpis,
  dropiStatusExcludedFromGuiaYVentas,
  ordersWithGuia,
  readDropiExcel,
  type DropiRow,
} from '../utils/dropiExcel';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

/** Paleta reporte Dropi (graficos) */
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
  const rounded = Math.round(n);
  const sign = rounded < 0 ? '-' : '';
  const digits = Math.abs(rounded).toString();
  const withSeparators = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}$${withSeparators}`;
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

function effBarColor(pct: number): string {
  if (pct >= 80) return C.efectividadHigh;
  if (pct >= 60) return C.efectividadMid;
  return C.efectividadLow;
}

type ReturnStatsRow = {
  label: string;
  pedidos: number;
  conGuia: number;
  devueltos: number;
  entregados: number;
  devPct: number;
};

function aggregateReturnStats(rows: DropiRow[], labelFn: (r: DropiRow) => string): ReturnStatsRow[] {
  const rowsByLabel = new Map<string, DropiRow[]>();
  for (const r of rows) {
    const label = labelFn(r).trim() || 'Sin dato';
    if (!rowsByLabel.has(label)) rowsByLabel.set(label, []);
    rowsByLabel.get(label)!.push(r);
  }
  return Array.from(rowsByLabel.entries())
    .map(([label, groupRows]) => {
      const orders = ordersWithGuia(aggregateDropiOrders(groupRows));
      const pedidos = orders.length;
      const conGuiaOrders = orders.filter((o) => !dropiStatusExcludedFromGuiaYVentas(o.estatusNorm));
      const conGuia = conGuiaOrders.length;
      const dev = orders.filter((o) => o.estatusNorm === 'DEVOLUCION').length;
      const ent = orders.filter((o) => o.estatusNorm === 'ENTREGADO').length;
      return {
        label,
        pedidos,
        conGuia,
        devueltos: dev,
        entregados: ent,
        devPct: conGuia > 0 ? (dev / conGuia) * 100 : 0,
      };
    })
    .sort((a, b) => b.devPct - a.devPct || b.devueltos - a.devueltos || a.label.localeCompare(b.label, 'es'));
}

type KpiPack = ReturnType<typeof computeDropiReportKpis>;

function computeKpis(rows: DropiRow[]): KpiPack {
  return computeDropiReportKpis(rows, PENDIENTE_ESTATUS);
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
  const [cityReportCarrier, setCityReportCarrier] = useState('');
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
    const rowsByProduct = new Map<string, DropiRow[]>();
    for (const r of filteredRows) {
      if (!rowsByProduct.has(r.producto)) rowsByProduct.set(r.producto, []);
      rowsByProduct.get(r.producto)!.push(r);
    }
    const rows = Array.from(rowsByProduct.entries()).map(([producto, groupRows]) => {
      const orders = ordersWithGuia(aggregateDropiOrders(groupRows));
      const pedidos = orders.length;
      const conGuiaOrders = orders.filter((o) => !dropiStatusExcludedFromGuiaYVentas(o.estatusNorm));
      const conG = conGuiaOrders.length;
      const ent = orders.filter((o) => o.estatusNorm === 'ENTREGADO').length;
      const dev = orders.filter((o) => o.estatusNorm === 'DEVOLUCION').length;
      const pend = conGuiaOrders.filter(
        (o) => o.estatusNorm !== 'ENTREGADO' && o.estatusNorm !== 'DEVOLUCION',
      ).length;
      const gan = orders.reduce((s, o) => s + o.ganancia, 0);
      const eff = conG > 0 ? (ent / conG) * 100 : 0;
      return { producto, pedidos, conG, ent, dev, pend, eff, gan };
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
    const orders = ordersWithGuia(aggregateDropiOrders(filteredRows));
    const m = new Map<string, number>();
    for (const o of orders) {
      const k = o.estatusNorm || 'â€”';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [filteredRows]);

  const carrierCounts = useMemo(() => {
    const orders = ordersWithGuia(aggregateDropiOrders(filteredRows));
    const m = new Map<string, number>();
    for (const o of orders) {
      const k = o.transportadora || 'Sin transportadora';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [filteredRows]);

  const carrierReturnStats = useMemo(
    () => aggregateReturnStats(filteredRows, (r) => r.transportadora || 'Sin transportadora'),
    [filteredRows],
  );

  const cityReportCarrierOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of filteredRows) {
      if (r.transportadora) s.add(r.transportadora);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'es'));
  }, [filteredRows]);

  const cityReturnStats = useMemo(() => {
    const rows = cityReportCarrier
      ? filteredRows.filter((r) => r.transportadora === cityReportCarrier)
      : filteredRows;
    return aggregateReturnStats(rows, (r) => r.ciudad || 'Sin ciudad');
  }, [filteredRows, cityReportCarrier]);

  useEffect(() => {
    if (cityReportCarrier && !cityReportCarrierOptions.includes(cityReportCarrier)) {
      setCityReportCarrier('');
    }
  }, [cityReportCarrier, cityReportCarrierOptions]);

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

  const productFleteDelivered = useMemo(() => {
    const rowsByProduct = new Map<string, DropiRow[]>();
    for (const r of filteredRows) {
      if (r.estatusNorm !== 'ENTREGADO') continue;
      if (!rowsByProduct.has(r.producto)) rowsByProduct.set(r.producto, []);
      rowsByProduct.get(r.producto)!.push(r);
    }
    return Array.from(rowsByProduct.entries())
      .map(([producto, groupRows]) => {
        const orders = ordersWithGuia(aggregateDropiOrders(groupRows));
        const pedidosEnt = orders.length;
        const costoTotalFlete = orders.reduce((s, o) => s + o.precioFlete, 0);
        const fleteProm = pedidosEnt > 0 ? costoTotalFlete / pedidosEnt : 0;
        return { producto, pedidosEnt, costoTotalFlete, fleteProm };
      })
      .sort((a, b) => b.costoTotalFlete - a.costoTotalFlete);
  }, [filteredRows]);

  const productEffectivenessView = useMemo(() => {
    const margenByProduct = new Map(productPnl.rows.map((r) => [r.producto, r.margenBruto]));
    return productEffectiveness.map((r) => ({
      ...r,
      margenPct: margenByProduct.get(r.producto) ?? null,
    }));
  }, [productEffectiveness, productPnl.rows]);

  const cityReturnStatsView = useMemo(
    () =>
      cityReturnStats.map((r) => ({
        ...r,
        effPct: r.conGuia > 0 ? (r.entregados / r.conGuia) * 100 : 0,
      })),
    [cityReturnStats],
  );

  const carrierReturnStatsView = useMemo(
    () =>
      carrierReturnStats.map((r) => ({
        ...r,
        effPct: r.conGuia > 0 ? (r.entregados / r.conGuia) * 100 : 0,
      })),
    [carrierReturnStats],
  );

  const barProductGanancia: ChartData<'bar'> = useMemo(() => {
    const slice = productPnl.rows.slice(0, 10);
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

  const chartOpts: ChartOptions<'doughnut'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false as const,
      plugins: { legend: { display: false } },
      cutout: '68%',
    }),
    [],
  );

  const barHorizOpts: ChartOptions<'bar'> = useMemo(
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
        setCityReportCarrier('');
        setProductMenuOpen(false);
        setProductSearch('');
      } catch {
        setError('No se pudo leer el Excel. Revisa que sea el export estÃ¡ndar de Dropi.');
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

  const productFilterSummary =
    selectedProducts.length === 0
      ? 'Todos los productos'
      : selectedProducts.length === 1
        ? selectedProducts[0]
        : `${selectedProducts.length} productos`;

  if (!hasData) {
    return (
      <ReporteDropiEmptyState
        error={error}
        isDragActive={isDragActive}
        fileRef={fileRef}
        onFileInput={onFile}
        onDragOver={onDropZoneDragOver}
        onDragLeave={onDropZoneDragLeave}
        onDrop={onDropZoneDrop}
        onPickFile={() => fileRef.current?.click()}
      />
    );
  }

  return (
    <ReporteDropiDashboardView
      exportRef={exportRef}
      fileRef={fileRef}
      productMenuRef={productMenuRef}
      fileName={fileName}
      rawRowCount={rawRows.length}
      error={error}
      isDragActive={isDragActive}
      pdfLoading={pdfLoading}
      productMenuOpen={productMenuOpen}
      productSearch={productSearch}
      productFilterSummary={productFilterSummary}
      selectedProducts={selectedProducts}
      productOptions={productOptions}
      filteredProductOptions={filteredProductOptions}
      dateStart={dateStart}
      dateEnd={dateEnd}
      carrier={carrier}
      carrierOptions={carrierOptions}
      cityReportCarrier={cityReportCarrier}
      cityReportCarrierOptions={cityReportCarrierOptions}
      kpi={kpi}
      formatCOP={formatCOP}
      formatPct={formatPct}
      productEffectiveness={productEffectivenessView}
      productFleteDelivered={productFleteDelivered}
      cityReturnStats={cityReturnStatsView}
      carrierReturnStats={carrierReturnStatsView}
      productPnlRows={productPnl.rows}
      productPnlTotals={{ producto: 'TOTAL', ...productPnl.totals }}
      estadoResultadosEntregados={estadoResultadosEntregados}
      statusCounts={statusCounts}
      carrierCounts={carrierCounts}
      donutEstados={donutEstados}
      donutCarrier={donutCarrier}
      barProductGanancia={barProductGanancia}
      chartOpts={chartOpts}
      barHorizOpts={barHorizOpts}
      doughnutCardBorder={doughnutCardBorder}
      onFileInput={onFile}
      onDragOver={onDropZoneDragOver}
      onDragLeave={onDropZoneDragLeave}
      onDrop={onDropZoneDrop}
      onPickFile={() => fileRef.current?.click()}
      onDownloadPdf={() => void downloadPdf()}
      onToggleProductMenu={() => setProductMenuOpen((o) => !o)}
      onProductSearch={setProductSearch}
      onToggleProduct={(p) =>
        setSelectedProducts((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))
      }
      onSelectAllProducts={() => setSelectedProducts([...productOptions])}
      onClearProducts={() => {
        setSelectedProducts([]);
        setProductSearch('');
      }}
      onDateStart={setDateStart}
      onDateEnd={setDateEnd}
      onCarrier={setCarrier}
      onCityReportCarrier={setCityReportCarrier}
    />
  );
}
