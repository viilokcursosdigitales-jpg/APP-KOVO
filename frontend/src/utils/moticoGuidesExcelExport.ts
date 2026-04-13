import * as XLSX from 'xlsx';

/** Filas con cabeceras en español para Excel (misma relación que las guías a imprimir). */
export type MoticoGuideExcelRow = Record<string, string | number>;

export function downloadMoticoGuidesOrdersExcel(rows: MoticoGuideExcelRow[], filePrefix = 'motico_guias_pedidos') {
  if (!rows.length) return;
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pedidos guías');
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '');
  XLSX.writeFile(wb, `${filePrefix}_${stamp}.xlsx`);
}
