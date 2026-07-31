import { useCallback, useMemo, useRef, useState } from 'react';
import {
  IconCurrencyDollar,
  IconPackage,
  IconReceipt,
  IconTruck,
  IconUpload,
  IconWallet,
} from '@tabler/icons-react';
import { DataTable, Td, Th, tableBase } from '../design-system/DataTable';
import { KpiCard } from '../design-system/KpiCard';
import { PageHeader } from '../design-system/PageHeader';
import { ds } from '../design-system/ds';
import {
  aggregateDropiOrders,
  computeDropiGuiaMetrics,
  dropiRowHasGuia,
  formatDropiCOP,
  readDropiExcel,
  type DropiRow,
} from '../utils/dropiExcel';

type ProductRow = {
  producto: string;
  pedidos: number;
  venta: number;
  costoProducto: number;
  costoFlete: number;
  otrosCostos: number;
};

function aggregateByProduct(rows: DropiRow[]): ProductRow[] {
  const rowsByProduct = new Map<string, DropiRow[]>();
  for (const r of rows) {
    if (!dropiRowHasGuia(r)) continue;
    if (!rowsByProduct.has(r.producto)) rowsByProduct.set(r.producto, []);
    rowsByProduct.get(r.producto)!.push(r);
  }
  return Array.from(rowsByProduct.entries())
    .map(([producto, groupRows]) => {
      const orders = aggregateDropiOrders(groupRows);
      let venta = 0;
      let costoProducto = 0;
      let costoFlete = 0;
      let otrosCostos = 0;
      for (const o of orders) {
        venta += o.totalOrden;
        costoProducto += o.costoProducto;
        costoFlete += o.precioFlete;
        const known = o.costoProducto + o.precioFlete + o.costoDevolucionFlete;
        const residual = o.totalOrden - o.ganancia - known;
        otrosCostos +=
          Math.abs(residual) < 0.01 ? o.costoDevolucionFlete : o.costoDevolucionFlete + residual;
      }
      return {
        producto,
        pedidos: orders.length,
        venta,
        costoProducto,
        costoFlete,
        otrosCostos,
      };
    })
    .sort((a, b) => b.venta - a.venta || a.producto.localeCompare(b.producto, 'es'));
}

export default function Reporte2DropiPage() {
  const [rawRows, setRawRows] = useState<DropiRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [productFilter, setProductFilter] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const productOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rawRows) {
      if (dropiRowHasGuia(r)) s.add(r.producto);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'es'));
  }, [rawRows]);

  const rowsConGuia = useMemo(() => {
    return rawRows.filter((r) => {
      if (!dropiRowHasGuia(r)) return false;
      if (productFilter && r.producto !== productFilter) return false;
      return true;
    });
  }, [rawRows, productFilter]);

  const metrics = useMemo(() => computeDropiGuiaMetrics(rowsConGuia), [rowsConGuia]);
  const productRows = useMemo(() => {
    const base = rawRows.filter(dropiRowHasGuia);
    const filtered = productFilter ? base.filter((r) => r.producto === productFilter) : base;
    return aggregateByProduct(filtered);
  }, [rawRows, productFilter]);

  const totalSinGuia = useMemo(
    () => rawRows.filter((r) => !dropiRowHasGuia(r)).length,
    [rawRows],
  );

  const hasData = rawRows.length > 0;

  const processFile = useCallback((file: File) => {
    setError(null);
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setError('Usa un archivo .xlsx exportado desde Dropi.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const buf = reader.result as ArrayBuffer;
        const rows = readDropiExcel(buf);
        if (rows.length === 0) {
          setError('El archivo no tiene filas válidas. Revisa que sea el export estándar de Dropi.');
          return;
        }
        setRawRows(rows);
        setFileName(file.name);
        setProductFilter('');
      } catch {
        setError('No se pudo leer el Excel. Revisa que sea el export estándar de Dropi.');
      }
    };
    reader.onerror = () => setError('No se pudo leer el archivo.');
    reader.readAsArrayBuffer(file);
  }, []);

  const onFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
      e.target.value = '';
    },
    [processFile],
  );

  const onDropZoneDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(true);
  }, []);

  const onDropZoneDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);
  }, []);

  const onDropZoneDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const cardStyle = {
    background: ds.bgCard,
    border: `1px solid ${ds.borderCard}`,
    borderRadius: 14,
    padding: '18px 20px',
  } as const;

  const selectStyle = {
    padding: '8px 12px',
    borderRadius: 10,
    border: `1px solid ${ds.borderCard}`,
    background: ds.bgCard,
    color: ds.textPrimary,
    fontSize: 13,
    minWidth: 220,
  } as const;

  const uploadInput = (
    <input
      ref={fileRef}
      type="file"
      accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      style={{ display: 'none' }}
      onChange={onFile}
    />
  );

  if (!hasData) {
    return (
      <div style={{ maxWidth: 980 }}>
        {uploadInput}
        <PageHeader
          title="Reporte 2 Dropi"
          subtitle="Resumen financiero de pedidos con guía. Procesamiento local, sin subir al servidor."
        />
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
            border: isDragActive ? `1.5px dashed ${ds.brand}` : `1px solid ${ds.borderCard}`,
            borderRadius: 14,
            background: isDragActive ? ds.bgSubtle : ds.bgCard,
            padding: '48px 32px',
            textAlign: 'center',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16, color: ds.brand }}>
            <IconUpload size={56} stroke={1.25} />
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: ds.textPrimary, marginBottom: 8 }}>
            Carga tu reporte de Dropi
          </div>
          <div
            style={{
              fontSize: 13,
              color: ds.textSecondary,
              maxWidth: 460,
              margin: '0 auto 24px',
              lineHeight: 1.5,
            }}
          >
            Solo se contabilizan pedidos que tienen número de guía. Dropi → Mis órdenes → Exportar → .xlsx
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            style={{
              padding: '12px 28px',
              borderRadius: 10,
              border: 'none',
              background: ds.brand,
              color: ds.textOnBrand,
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
      {uploadInput}
      <PageHeader
        title="Reporte 2 Dropi"
        subtitle="Totales basados únicamente en pedidos con guía de envío."
      />

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
        <div
          style={{
            marginBottom: 14,
            padding: 12,
            borderRadius: 10,
            background: ds.warningBg,
            color: ds.warningText,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      <div
        style={{
          ...cardStyle,
          marginBottom: 16,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          alignItems: 'flex-end',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: ds.textMuted, marginBottom: 6 }}>Archivo</div>
            <div style={{ fontSize: 13, color: ds.textPrimary, fontWeight: 600 }}>{fileName}</div>
          </div>
          <div>
            <label htmlFor="dropi2-product-filter" style={{ fontSize: 11, fontWeight: 600, color: ds.textMuted, display: 'block', marginBottom: 6 }}>
              Producto
            </label>
            <select
              id="dropi2-product-filter"
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
              style={selectStyle}
            >
              <option value="">Todos los productos</option>
              {productOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          style={{
            padding: '10px 16px',
            borderRadius: 10,
            border: `1px solid ${ds.borderCard}`,
            background: ds.bgSubtle,
            color: ds.textPrimary,
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Cambiar archivo
        </button>
      </div>

      <p style={{ margin: '0 0 16px', fontSize: 12, color: ds.textMuted, lineHeight: 1.5 }}>
        {metrics.totalPedidos.toLocaleString('es-CO')} pedidos con guía
        {productFilter ? ` · filtro: ${productFilter}` : ''}
        {totalSinGuia > 0 ? ` · ${totalSinGuia.toLocaleString('es-CO')} pedidos sin guía excluidos` : ''}
      </p>

      <div className="kovo-kpi-grid-dash" style={{ marginBottom: 20 }}>
        <KpiCard
          variant="sales"
          label="Total venta"
          value={formatDropiCOP(metrics.totalVenta)}
          icon={<IconCurrencyDollar size={18} stroke={1.75} />}
        />
        <KpiCard
          variant="traffic"
          label="Total pedidos (con guía)"
          value={metrics.totalPedidos.toLocaleString('es-CO')}
          icon={<IconReceipt size={18} stroke={1.75} />}
        />
        <KpiCard
          variant="stock"
          label="Total costo producto"
          value={formatDropiCOP(metrics.totalCostoProducto)}
          icon={<IconPackage size={18} stroke={1.75} />}
        />
        <KpiCard
          variant="spend"
          label="Total costo flete"
          value={formatDropiCOP(metrics.totalCostoFlete)}
          icon={<IconTruck size={18} stroke={1.75} />}
        />
        {metrics.totalOtrosCostos > 0 ? (
          <KpiCard
            variant="alert"
            label="Total otros costos"
            value={formatDropiCOP(metrics.totalOtrosCostos)}
            icon={<IconWallet size={18} stroke={1.75} />}
          />
        ) : null}
      </div>

      <DataTable title="Desglose por producto" subtitle="Solo pedidos con guía">
          <table style={tableBase}>
            <thead>
              <tr>
                <Th>Producto</Th>
                <Th style={{ textAlign: 'right' }}>Pedidos</Th>
                <Th style={{ textAlign: 'right' }}>Venta</Th>
                <Th style={{ textAlign: 'right' }}>Costo producto</Th>
                <Th style={{ textAlign: 'right' }}>Costo flete</Th>
                <Th style={{ textAlign: 'right' }}>Otros costos</Th>
              </tr>
            </thead>
            <tbody>
              {productRows.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '12px 16px', fontSize: 12, color: ds.textMuted }}>
                    No hay pedidos con guía en el periodo seleccionado.
                  </td>
                </tr>
              ) : (
                productRows.map((r, i, arr) => {
                  const isLast = i === arr.length - 1;
                  return (
                    <tr key={r.producto}>
                      <Td isLast={isLast}>{r.producto}</Td>
                      <Td isLast={isLast} style={{ textAlign: 'right' }}>
                        {r.pedidos.toLocaleString('es-CO')}
                      </Td>
                      <Td isLast={isLast} style={{ textAlign: 'right' }}>
                        {formatDropiCOP(r.venta)}
                      </Td>
                      <Td isLast={isLast} style={{ textAlign: 'right' }}>
                        {formatDropiCOP(r.costoProducto)}
                      </Td>
                      <Td isLast={isLast} style={{ textAlign: 'right' }}>
                        {formatDropiCOP(r.costoFlete)}
                      </Td>
                      <Td isLast={isLast} style={{ textAlign: 'right' }}>
                        {r.otrosCostos > 0 ? formatDropiCOP(r.otrosCostos) : '—'}
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </DataTable>
    </div>
  );
}
