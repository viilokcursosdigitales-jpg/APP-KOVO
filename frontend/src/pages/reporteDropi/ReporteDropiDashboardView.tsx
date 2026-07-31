import type { CSSProperties, ReactNode, RefObject } from 'react';
import type { ChartData, ChartOptions } from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import {
  Calendar,
  ChevronDown,
  Download,
  Info,
  Package,
  RotateCcw,
  ShoppingBag,
  Target,
  Truck,
  Upload,
} from 'lucide-react';
import { ds } from '../../design-system/ds';
import {
  Badge,
  MiniBar,
  ProductAvatar,
  SectionTitle,
  SkeletonBlock,
  Sparkline,
  dashboardCard,
  effBadgeStyle,
  effBarColor,
  marginBadgeStyle,
  marginBarColor,
  sectionGap,
  sparkFromMetrics,
  tableShell,
  tdStyle,
  thStyle,
  DROPi_C,
  colorForCarrierIndex,
  colorForStatus,
} from './reporteDropiUi';

export type DropiKpiView = {
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
};

export type ProductEffRow = {
  producto: string;
  pedidos: number;
  ent: number;
  dev: number;
  pend: number;
  eff: number;
  gan: number;
  margenPct: number | null;
};

export type ProductFleteDeliveredRow = {
  producto: string;
  pedidosEnt: number;
  costoTotalFlete: number;
  fleteProm: number;
};

export type ReturnStatsRow = {
  label: string;
  pedidos: number;
  conGuia: number;
  devueltos: number;
  entregados: number;
  devPct: number;
  effPct: number;
};

export type ProductPnlRow = {
  producto: string;
  ventas: number;
  cp: number;
  cf: number;
  fd: number;
  gananciaBruta: number;
  margenBruto: number;
};

export type EstadoResultadosEntregados = {
  ventas: number;
  costoProducto: number;
  costoFlete: number;
  costoFleteDevolucion: number;
  gananciaBruta: number;
  margenBruto: number;
};

type Props = {
  exportRef: RefObject<HTMLDivElement | null>;
  fileRef: RefObject<HTMLInputElement | null>;
  productMenuRef: RefObject<HTMLDivElement | null>;
  fileName: string;
  rawRowCount: number;
  error: string | null;
  isDragActive: boolean;
  pdfLoading: boolean;
  productMenuOpen: boolean;
  productSearch: string;
  productFilterSummary: string;
  selectedProducts: string[];
  productOptions: string[];
  filteredProductOptions: string[];
  dateStart: string;
  dateEnd: string;
  carrier: string;
  carrierOptions: string[];
  cityReportCarrier: string;
  cityReportCarrierOptions: string[];
  kpi: DropiKpiView;
  formatCOP: (n: number) => string;
  formatPct: (n: number, digits?: number) => string;
  productEffectiveness: ProductEffRow[];
  productFleteDelivered: ProductFleteDeliveredRow[];
  cityReturnStats: ReturnStatsRow[];
  carrierReturnStats: ReturnStatsRow[];
  productPnlRows: ProductPnlRow[];
  productPnlTotals: ProductPnlRow & { producto: string };
  estadoResultadosEntregados: EstadoResultadosEntregados;
  statusCounts: [string, number][];
  carrierCounts: [string, number][];
  donutEstados: ChartData<'doughnut'>;
  donutCarrier: ChartData<'doughnut'>;
  barProductGanancia: ChartData<'bar'>;
  chartOpts: ChartOptions<'doughnut'>;
  barHorizOpts: ChartOptions<'bar'>;
  doughnutCardBorder: string;
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onPickFile: () => void;
  onDownloadPdf: () => void;
  onToggleProductMenu: () => void;
  onProductSearch: (v: string) => void;
  onToggleProduct: (p: string) => void;
  onSelectAllProducts: () => void;
  onClearProducts: () => void;
  onDateStart: (v: string) => void;
  onDateEnd: (v: string) => void;
  onCarrier: (v: string) => void;
  onCityReportCarrier: (v: string) => void;
};

const filterLabel: CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: ds.textMuted,
  marginBottom: 6,
  letterSpacing: '0.02em',
};

const filterInput: CSSProperties = {
  padding: '10px 12px',
  borderRadius: 12,
  border: `1px solid ${ds.borderCard}`,
  fontSize: 13,
  background: ds.bgCard,
  color: ds.textPrimary,
  boxSizing: 'border-box',
  width: '100%',
  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
};

function KpiHero({
  icon,
  label,
  value,
  sub,
  accent,
  highlight,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub: string;
  accent: string;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        ...dashboardCard,
        padding: '20px 22px',
        border: highlight ? `1.5px solid ${accent}` : `1px solid ${ds.borderCard}`,
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 8px 24px rgba(15, 23, 42, 0.08)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'none';
        e.currentTarget.style.boxShadow = '0 1px 3px rgba(15, 23, 42, 0.06)';
      }}
      title={sub}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: `${accent}18`,
            color: accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </div>
        <Info size={14} color={ds.textMuted} aria-hidden />
      </div>
      <div style={{ marginTop: 14, fontSize: 12, fontWeight: 600, color: ds.textMuted }}>{label}</div>
      <div
        style={{
          marginTop: 6,
          fontSize: 28,
          fontWeight: 800,
          color: highlight ? accent : ds.textPrimary,
          letterSpacing: '-0.03em',
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: ds.textHint, lineHeight: 1.4 }}>{sub}</div>
    </div>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        ...dashboardCard,
        padding: '14px 18px',
        flex: '1 1 200px',
        minWidth: 180,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: ds.textMuted, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: ds.textPrimary }}>{value}</div>
    </div>
  );
}

function DonutCard({
  title,
  totalLabel,
  data,
  options,
  legendItems,
}: {
  title: string;
  totalLabel: string;
  data: ChartData<'doughnut'>;
  options: ChartOptions<'doughnut'>;
  legendItems: { label: string; value: number; pct: number; color: string }[];
}) {
  return (
    <div style={{ ...dashboardCard, padding: '20px 22px' }}>
      <SectionTitle title={title} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1fr) minmax(140px, 1fr)', gap: 16, alignItems: 'center' }}>
        <div style={{ height: 220, position: 'relative' }}>
          <Doughnut data={data} options={options} />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <span style={{ fontSize: 22, fontWeight: 800, color: ds.textPrimary }}>{totalLabel}</span>
            <span style={{ fontSize: 11, color: ds.textMuted, marginTop: 2 }}>Pedidos</span>
          </div>
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {legendItems.slice(0, 8).map((item) => (
            <li key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: ds.textSecondary }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: item.color, flexShrink: 0 }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
              <strong style={{ color: ds.textPrimary }}>{item.value}</strong>
              <span style={{ color: ds.textMuted, minWidth: 38, textAlign: 'right' }}>{item.pct.toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function DataTable({
  title,
  subtitle,
  headers,
  children,
  maxHeight,
  headerExtra,
}: {
  title: string;
  subtitle?: string;
  headers: string[];
  children: ReactNode;
  maxHeight?: number;
  headerExtra?: ReactNode;
}) {
  return (
    <section>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <SectionTitle title={title} subtitle={subtitle} />
        {headerExtra}
      </div>
      <div style={tableShell(maxHeight)}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h} style={thStyle}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </section>
  );
}

export function ReporteDropiEmptyState({
  error,
  isDragActive,
  fileRef,
  onFileInput,
  onDragOver,
  onDragLeave,
  onDrop,
  onPickFile,
}: {
  error: string | null;
  isDragActive: boolean;
  fileRef: RefObject<HTMLInputElement | null>;
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onPickFile: () => void;
}) {
  return (
    <div style={{ maxWidth: 920 }}>
      <input ref={fileRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={onFileInput} />
      <header style={{ marginBottom: sectionGap }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: ds.textPrimary, letterSpacing: '-0.03em' }}>Reporte Dropi</h1>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: ds.textSecondary }}>
          Procesamiento local: el archivo no se envía al servidor.
        </p>
      </header>
      {error ? (
        <div style={{ marginBottom: 16, padding: 14, borderRadius: 12, background: ds.dangerBg, color: ds.dangerText, fontSize: 13 }}>
          {error}
        </div>
      ) : null}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        style={{
          ...dashboardCard,
          border: isDragActive ? `2px dashed ${ds.brand}` : `1px solid ${ds.borderCard}`,
          background: isDragActive ? ds.bgSubtle : ds.bgCard,
          padding: '56px 32px',
          textAlign: 'center',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18, color: DROPi_C.carrier1 }}>
          <Upload size={52} strokeWidth={1.5} />
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: ds.textPrimary, marginBottom: 8 }}>Carga tu reporte de Dropi</div>
        <p style={{ fontSize: 13, color: ds.textSecondary, maxWidth: 440, margin: '0 auto 24px', lineHeight: 1.55 }}>
          Arrastra y suelta tu .xlsx o expórtalo desde Dropi: Mis órdenes → Exportar.
        </p>
        <button type="button" onClick={onPickFile} style={primaryBtn}>
          Cargar archivo
        </button>
      </div>
    </div>
  );
}

const primaryBtn: CSSProperties = {
  padding: '12px 24px',
  borderRadius: 12,
  border: 'none',
  background: ds.brand,
  color: '#fff',
  fontWeight: 700,
  fontSize: 14,
  cursor: 'pointer',
};

export default function ReporteDropiDashboardView(props: Props) {
  const {
    exportRef,
    fileRef,
    productMenuRef,
    fileName,
    rawRowCount,
    error,
    isDragActive,
    pdfLoading,
    productMenuOpen,
    productSearch,
    productFilterSummary,
    filteredProductOptions,
    selectedProducts,
    productOptions,
    dateStart,
    dateEnd,
    carrier,
    carrierOptions,
    cityReportCarrier,
    cityReportCarrierOptions,
    kpi,
    formatCOP,
    formatPct,
    productEffectiveness,
    productFleteDelivered,
    cityReturnStats,
    carrierReturnStats,
    productPnlRows,
    productPnlTotals,
    estadoResultadosEntregados,
    statusCounts,
    carrierCounts,
    donutEstados,
    donutCarrier,
    barProductGanancia,
    chartOpts,
    barHorizOpts,
    onFileInput,
    onDragOver,
    onDragLeave,
    onDrop,
    onPickFile,
    onDownloadPdf,
    onToggleProductMenu,
    onProductSearch,
    onToggleProduct,
    onSelectAllProducts,
    onClearProducts,
    onDateStart,
    onDateEnd,
    onCarrier,
    onCityReportCarrier,
  } = props;

  const totalStatus = statusCounts.reduce((s, [, n]) => s + n, 0);
  const totalCarrier = carrierCounts.reduce((s, [, n]) => s + n, 0);

  const statusLegend = statusCounts.map(([label, value], i) => ({
    label,
    value,
    pct: totalStatus > 0 ? (value / totalStatus) * 100 : 0,
    color: colorForStatus(label),
  }));

  const carrierLegend = carrierCounts.map(([label, value], i) => ({
    label,
    value,
    pct: totalCarrier > 0 ? (value / totalCarrier) * 100 : 0,
    color: colorForCarrierIndex(i),
  }));

  const topProductsRank = [...productPnlRows].slice(0, 5);

  return (
    <div
      style={{ width: '100%', maxWidth: '100%' }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input ref={fileRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={onFileInput} />

      {/* 1. Header */}
      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: sectionGap,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: ds.textPrimary, letterSpacing: '-0.03em' }}>
            Reporte Dropi
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: ds.textSecondary }}>
            Procesamiento local: el archivo no se envía al servidor.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: ds.textMuted }}>Datos del archivo cargado</span>
          <button
            type="button"
            disabled={pdfLoading}
            onClick={onDownloadPdf}
            style={{
              ...filterInput,
              width: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              cursor: pdfLoading ? 'wait' : 'pointer',
              fontWeight: 700,
            }}
          >
            <Download size={16} />
            {pdfLoading ? 'Generando PDF…' : 'Descargar PDF'}
          </button>
        </div>
      </header>

      {isDragActive ? (
        <div
          style={{
            marginBottom: 16,
            padding: 14,
            borderRadius: 12,
            border: `2px dashed ${ds.brand}`,
            background: ds.bgSubtle,
            color: ds.brand,
            fontSize: 13,
            fontWeight: 700,
            textAlign: 'center',
          }}
        >
          Suelta el archivo .xlsx para reemplazar el reporte
        </div>
      ) : null}
      {error ? (
        <div style={{ marginBottom: 16, padding: 14, borderRadius: 12, background: ds.warningBg, color: ds.warningText, fontSize: 13 }}>
          {error}
        </div>
      ) : null}

      {/* 2. Filtros */}
      <div style={{ ...dashboardCard, padding: '18px 20px', marginBottom: sectionGap }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
          <button type="button" onClick={onPickFile} style={{ ...primaryBtn, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Upload size={16} />
            Cargar archivo
          </button>
          {fileName ? (
            <div style={{ fontSize: 12, color: ds.textSecondary, paddingBottom: 10 }}>
              <strong style={{ color: ds.textPrimary }}>{fileName}</strong> · {rawRowCount.toLocaleString('es-CO')} filas
            </div>
          ) : null}

          <div ref={productMenuRef} style={{ flex: '1 1 200px', minWidth: 200, position: 'relative' }}>
            <label style={filterLabel}>Productos</label>
            <button type="button" onClick={onToggleProductMenu} style={{ ...filterInput, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{productFilterSummary}</span>
              <ChevronDown size={16} style={{ transform: productMenuOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
            </button>
            {productMenuOpen ? (
              <div style={{ position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 6, ...dashboardCard, zIndex: 80, boxShadow: '0 16px 40px rgba(15,23,42,0.12)' }}>
                <div style={{ padding: 10, borderBottom: `1px solid ${ds.borderRow}` }}>
                  <input type="search" placeholder="Buscar producto…" value={productSearch} onChange={(e) => onProductSearch(e.target.value)} style={filterInput} autoFocus />
                </div>
                <div style={{ maxHeight: 220, overflowY: 'auto', padding: '6px 8px' }}>
                  {filteredProductOptions.map((p) => (
                    <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={selectedProducts.includes(p)} onChange={() => onToggleProduct(p)} />
                      <span>{p}</span>
                    </label>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, padding: 10, borderTop: `1px solid ${ds.borderRow}` }}>
                  <button type="button" onClick={() => onSelectAllProducts()} style={ghostBtn}>Marcar todos</button>
                  <button type="button" onClick={onClearProducts} style={ghostBtn}>Limpiar</button>
                </div>
              </div>
            ) : null}
          </div>

          <div style={{ minWidth: 150 }}>
            <label style={filterLabel}>Desde (FECHA pedido)</label>
            <input type="date" value={dateStart} onChange={(e) => onDateStart(e.target.value)} style={filterInput} />
          </div>
          <div style={{ minWidth: 150 }}>
            <label style={filterLabel}>Hasta</label>
            <input type="date" value={dateEnd} onChange={(e) => onDateEnd(e.target.value)} style={filterInput} />
          </div>
          <div style={{ minWidth: 170, flex: '1 1 160px' }}>
            <label style={filterLabel}>Transportadora</label>
            <select value={carrier} onChange={(e) => onCarrier(e.target.value)} style={filterInput}>
              <option value="">Todas</option>
              {carrierOptions.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div ref={exportRef} style={{ display: 'flex', flexDirection: 'column', gap: sectionGap }}>
        {pdfLoading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonBlock key={i} height={130} />
            ))}
          </div>
        ) : null}

        {/* 3. KPIs */}
        <section>
          <SectionTitle title="KPIs principales" subtitle="Guías distintas y métricas operativas del periodo filtrado." />
          <div className="dropi-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 14, marginBottom: 14 }}>
            <KpiHero icon={<Package size={20} />} label="Total pedidos" value={String(kpi.totalPedidos)} sub="Guías distintas" accent={DROPi_C.carrier1} />
            <KpiHero icon={<ShoppingBag size={20} />} label="Con guía" value={String(kpi.conGuia)} sub={formatPct(kpi.totalPedidos > 0 ? (kpi.conGuia / kpi.totalPedidos) * 100 : 0) + ' del total'} accent="#8b5cf6" />
            <KpiHero icon={<Target size={20} />} label="Efectividad total" value={formatPct(kpi.efectividad)} sub="Entregados / pedidos con guía" accent={DROPi_C.gainText} highlight />
            <KpiHero icon={<Truck size={20} />} label="Entregados" value={String(kpi.entregados)} sub={formatPct(kpi.conGuia > 0 ? (kpi.entregados / kpi.conGuia) * 100 : 0) + ' sobre con guía'} accent={DROPi_C.estadoEntregado} />
            <KpiHero icon={<RotateCcw size={20} />} label="Devueltos" value={String(kpi.devueltos)} sub={formatPct(kpi.conGuia > 0 ? (kpi.devueltos / kpi.conGuia) * 100 : 0) + ' sobre con guía'} accent={DROPi_C.estadoDevuelto} />
            <KpiHero icon={<Calendar size={20} />} label="Pendientes" value={String(kpi.pendientes)} sub={formatPct(kpi.conGuia > 0 ? (kpi.pendientes / kpi.conGuia) * 100 : 0) + ' sobre con guía'} accent={DROPi_C.estadoPendiente} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            <SummaryPill label="Cancelados" value={`${kpi.cancelados} (${formatPct(kpi.totalPedidos > 0 ? (kpi.cancelados / kpi.totalPedidos) * 100 : 0)})`} />
            <SummaryPill label="Total ventas" value={`${formatCOP(kpi.totalVentas)} COP`} />
            <SummaryPill label="Ganancia neta" value={`${formatCOP(kpi.gananciaNeta)} · Margen ${formatPct(kpi.margenPct)}`} />
          </div>
        </section>

        {/* 4. Efectividad por producto */}
        <DataTable
          title="Efectividad por producto"
          subtitle="Entregados, devoluciones y margen por producto."
          headers={['Producto', 'Pedidos', 'Entregados', 'Devueltos', 'Pendientes', '% Efectividad', 'Ganancia neta', 'Margen neto', 'Tendencia']}
          maxHeight={420}
        >
          {productEffectiveness.map((r) => {
            const st = effBadgeStyle(r.eff);
            const mst = r.margenPct != null ? marginBadgeStyle(r.margenPct) : null;
            return (
              <tr key={r.producto} style={{ transition: 'background 0.12s ease' }} onMouseEnter={(e) => { e.currentTarget.style.background = ds.bgSubtle; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <ProductAvatar label={r.producto} />
                    <span style={{ fontWeight: 600 }}>{r.producto}</span>
                  </div>
                </td>
                <td style={tdStyle}>{r.pedidos}</td>
                <td style={tdStyle}><Badge bg="rgba(5,150,105,0.12)" color="#047857">{r.ent}</Badge></td>
                <td style={tdStyle}><Badge bg="rgba(220,38,38,0.1)" color="#b91c1c">{r.dev}</Badge></td>
                <td style={tdStyle}><Badge bg="rgba(217,119,6,0.12)" color="#b45309">{r.pend}</Badge></td>
                <td style={tdStyle}><Badge bg={st.bg} color={st.color}>{formatPct(r.eff)}</Badge></td>
                <td style={tdStyle}>{formatCOP(r.gan)}</td>
                <td style={tdStyle}>
                  {mst && r.margenPct != null ? <Badge bg={mst.bg} color={mst.color}>{formatPct(r.margenPct)}</Badge> : '—'}
                </td>
                <td style={tdStyle}><Sparkline values={sparkFromMetrics(r.producto, r.eff, r.dev)} color={effBarColor(r.eff)} /></td>
              </tr>
            );
          })}
        </DataTable>

        {/* 5. Costo promedio de flete por producto */}
        <DataTable
          title="Costo promedio de flete por producto"
          subtitle="Solo pedidos entregados. Variación disponible cuando exista periodo anterior."
          headers={['Producto', 'Pedidos entregados', 'Costo total de flete', 'Costo promedio de flete', 'Variación vs periodo anterior', 'Tendencia']}
          maxHeight={420}
        >
          {productFleteDelivered.map((r) => (
            <tr key={r.producto}>
              <td style={tdStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <ProductAvatar label={r.producto} />
                  <span style={{ fontWeight: 600 }}>{r.producto}</span>
                </div>
              </td>
              <td style={tdStyle}>{r.pedidosEnt}</td>
              <td style={tdStyle}>{formatCOP(r.costoTotalFlete)}</td>
              <td style={tdStyle}>{formatCOP(r.fleteProm)}</td>
              <td style={{ ...tdStyle, color: ds.textMuted }}>—</td>
              <td style={tdStyle}>
                <Sparkline values={sparkFromMetrics(r.producto, r.fleteProm, r.pedidosEnt)} color={DROPi_C.carrier2} />
              </td>
            </tr>
          ))}
        </DataTable>

        {/* 6. Gráficos */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
          <DonutCard title="Distribución por estado" totalLabel={String(totalStatus)} data={donutEstados} options={chartOpts} legendItems={statusLegend} />
          <DonutCard title="Pedidos por transportadora" totalLabel={String(totalCarrier)} data={donutCarrier} options={chartOpts} legendItems={carrierLegend} />
        </section>

        {/* 7. Tabla ciudad */}
        <DataTable
          title="Distribuciones por ciudad"
          subtitle="% efectividad = entregados / pedidos con guía por ciudad."
          headers={['Ciudad', 'Pedidos', 'Con guía', 'Devueltos', 'Entregados', 'Efectividad', 'Tendencia']}
          maxHeight={480}
          headerExtra={
            <div style={{ minWidth: 200 }}>
              <label style={filterLabel}>Filtrar por transportadora</label>
              <select value={cityReportCarrier} onChange={(e) => onCityReportCarrier(e.target.value)} style={filterInput}>
                <option value="">Todas las transportadoras</option>
                {cityReportCarrierOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          }
        >
          {cityReturnStats.map((r) => {
            const st = effBadgeStyle(r.effPct);
            return (
              <tr key={r.label}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{r.label}</td>
                <td style={tdStyle}>{r.pedidos}</td>
                <td style={tdStyle}>{r.conGuia}</td>
                <td style={tdStyle}><Badge bg="rgba(220,38,38,0.1)" color="#b91c1c">{r.devueltos}</Badge></td>
                <td style={tdStyle}><Badge bg="rgba(5,150,105,0.12)" color="#047857">{r.entregados}</Badge></td>
                <td style={tdStyle}><Badge bg={st.bg} color={st.color}>{formatPct(r.effPct)}</Badge></td>
                <td style={tdStyle}><MiniBar pct={r.effPct} color={effBarColor(r.effPct)} /></td>
              </tr>
            );
          })}
        </DataTable>

        {/* 8. Inferior: transportadora + sidebar */}
        <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(280px, 0.8fr)', gap: 16, alignItems: 'start' }}>
          <DataTable
            title="% efectividad por transportadora"
            subtitle="Entregados sobre pedidos con guía."
            headers={['Transportadora', 'Pedidos', 'Con guía', 'Entregados', 'Efectividad', 'Tendencia']}
            maxHeight={360}
          >
            {carrierReturnStats.map((r) => {
              const st = effBadgeStyle(r.effPct);
              return (
                <tr key={r.label}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{r.label}</td>
                  <td style={tdStyle}>{r.pedidos}</td>
                  <td style={tdStyle}>{r.conGuia}</td>
                  <td style={tdStyle}>{r.entregados}</td>
                  <td style={tdStyle}><Badge bg={st.bg} color={st.color}>{formatPct(r.effPct)}</Badge></td>
                  <td style={tdStyle}><Sparkline values={sparkFromMetrics(r.label, r.effPct)} color={effBarColor(r.effPct)} /></td>
                </tr>
              );
            })}
          </DataTable>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ ...dashboardCard, padding: '18px 20px' }}>
              <SectionTitle title="Resumen rápido" />
              <div style={{ display: 'grid', gap: 10 }}>
                {[
                  ['Total pedidos', String(kpi.totalPedidos)],
                  ['Con guía', String(kpi.conGuia)],
                  ['Entregados', String(kpi.entregados)],
                  ['Total ventas', formatCOP(kpi.totalVentas)],
                  ['Ganancia neta', formatCOP(kpi.gananciaNeta)],
                ].map(([l, v]) => (
                  <div key={l} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
                    <span style={{ color: ds.textSecondary }}>{l}</span>
                    <strong style={{ color: ds.textPrimary }}>{v}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ ...dashboardCard, padding: '18px 20px' }}>
              <SectionTitle title="Rank productos por ganancia neta" subtitle="Top entregados." />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {topProductsRank.map((r, i) => (
                  <div key={r.producto} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 22, fontSize: 12, fontWeight: 800, color: ds.textMuted }}>{i + 1}</span>
                    <ProductAvatar label={r.producto} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.producto}</div>
                      <div style={{ fontSize: 11, color: ds.textMuted }}>{formatCOP(r.gananciaBruta)} · {formatPct(r.margenBruto)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 9. Parte final */}
        <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
          <div style={{ ...dashboardCard, padding: '20px 22px' }}>
            <SectionTitle title="Ganancia neta por producto (Top 10)" subtitle="Entregados — color = margen bruto." />
            <div style={{ height: 320, position: 'relative' }}>
              <Bar data={barProductGanancia} options={barHorizOpts} />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ ...dashboardCard, padding: '18px 20px' }}>
              <SectionTitle title="Resumen de resultados (entregado)" />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                {[
                  ['Ventas entregados', formatCOP(estadoResultadosEntregados.ventas)],
                  ['Costo producto', `-${formatCOP(estadoResultadosEntregados.costoProducto)}`],
                  ['Costo de flete', `-${formatCOP(estadoResultadosEntregados.costoFlete)}`],
                  ['Flete devolución', `-${formatCOP(estadoResultadosEntregados.costoFleteDevolucion)}`],
                  ['Ganancia bruta', formatCOP(estadoResultadosEntregados.gananciaBruta)],
                  ['Margen bruto', formatPct(estadoResultadosEntregados.margenBruto)],
                ].map(([l, v]) => (
                  <div key={l} style={{ padding: '10px 12px', borderRadius: 12, background: ds.bgSubtle }}>
                    <div style={{ fontSize: 11, color: ds.textMuted, marginBottom: 4 }}>{l}</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: l.includes('Ganancia') ? DROPi_C.gainText : ds.textPrimary }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={tableShell(360)}>
              <div style={{ padding: '16px 18px 0' }}>
                <SectionTitle title="Resumen por producto (entregado)" />
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Producto', 'Ventas', 'Ganancia', 'Margen'].map((h) => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {productPnlRows.slice(0, 8).map((r) => {
                    const st = marginBadgeStyle(r.margenBruto);
                    return (
                      <tr key={r.producto}>
                        <td style={tdStyle}>{r.producto}</td>
                        <td style={tdStyle}>{formatCOP(r.ventas)}</td>
                        <td style={{ ...tdStyle, color: DROPi_C.gainText, fontWeight: 700 }}>{formatCOP(r.gananciaBruta)}</td>
                        <td style={tdStyle}><Badge bg={st.bg} color={st.color}>{formatPct(r.margenBruto)}</Badge></td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: ds.bgSubtle, fontWeight: 800 }}>
                    <td style={tdStyle}>TOTAL</td>
                    <td style={tdStyle}>{formatCOP(productPnlTotals.ventas)}</td>
                    <td style={{ ...tdStyle, color: DROPi_C.gainText }}>{formatCOP(productPnlTotals.gananciaBruta)}</td>
                    <td style={tdStyle}><Badge bg={marginBadgeStyle(productPnlTotals.margenBruto).bg} color={marginBadgeStyle(productPnlTotals.margenBruto).color}>{formatPct(productPnlTotals.margenBruto)}</Badge></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <footer style={{ fontSize: 11, color: ds.textMuted, paddingTop: 8, borderTop: `1px solid ${ds.borderRow}` }}>
          % efectividad = entregados / pedidos con guía · Datos referenciales · Todas las ventas en COP
        </footer>
      </div>

      <style>{`
        @keyframes dropiShimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @media (max-width: 1200px) {
          .dropi-kpi-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
        }
        @media (max-width: 900px) {
          .dropi-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
        @media (max-width: 640px) {
          .dropi-kpi-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

const ghostBtn: CSSProperties = {
  fontSize: 12,
  background: ds.bgSubtle,
  border: `1px solid ${ds.borderCard}`,
  borderRadius: 10,
  padding: '8px 12px',
  cursor: 'pointer',
  color: ds.textPrimary,
  fontWeight: 600,
};
