import ExcelJS from 'exceljs';

const HEADER_FILL = 'FF6C47FF';
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF000000' } },
  left: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  right: { style: 'thin', color: { argb: 'FF000000' } },
};

export const RELACION_MOTICO_DESPACHADOS_HEADERS = [
  'Estado pedido',
  'Fecha último despacho',
  'Cliente',
  'Ref pedido',
  'Teléfono',
  'Correo',
  'Precio total',
  'Pendiente pago al recibir',
  'Costo producto',
  'Costo flete',
  'Ganancia Motico',
  'Debe proveedor',
  'Pagos por Nequi',
  'Saldo',
  'Estado cobro Motico',
] as const;

export type RelacionMoticoDespachoExcelRow = {
  estadoPedido: string;
  fechaUltimoDespacho: string;
  cliente: string;
  refPedido: string;
  telefono: string;
  correo: string;
  precioTotal: number;
  pendientePagoAlRecibir: number;
  costoProducto: number;
  costoFlete: number;
  gananciaMotico: number;
  debeProveedor: number;
  pagosNequi: number;
  saldo: number;
  estadoCobroMotico: string;
};

function moneyNumFmt(currency: string): string {
  const c = String(currency || 'COP').trim().toUpperCase() || 'COP';
  if (c === 'COP' || c === 'CLP' || c === 'JPY') return '#,##0';
  return '#,##0.00';
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function filenameRelacionDespachados(): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}`;
  return `relacion_pagos_motico_despachados_${stamp}.xlsx`;
}

/**
 * Excel con los pedidos en estado Despachado (misma relación numérica que la tabla en pantalla).
 */
export async function buildRelacionMoticoDespachadosExcelBlob(
  rows: RelacionMoticoDespachoExcelRow[],
  currency: string,
): Promise<{ blob: Blob; filename: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'KOVO';
  const ws = wb.addWorksheet('Despachados', { views: [{ state: 'frozen', ySplit: 1 }] });

  ws.addRow([...RELACION_MOTICO_DESPACHADOS_HEADERS]);
  const headerRow = ws.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = THIN_BORDER;
  });

  const fmt = moneyNumFmt(currency);
  const moneyCols = new Set([7, 8, 9, 10, 11, 12, 13, 14]);

  for (const r of rows) {
    const row = ws.addRow([
      r.estadoPedido,
      r.fechaUltimoDespacho,
      r.cliente,
      r.refPedido,
      r.telefono,
      r.correo,
      r.precioTotal,
      r.pendientePagoAlRecibir,
      r.costoProducto,
      r.costoFlete,
      r.gananciaMotico,
      r.debeProveedor,
      r.pagosNequi,
      r.saldo,
      r.estadoCobroMotico,
    ]);
    row.eachCell((cell, col) => {
      cell.border = THIN_BORDER;
      if (col <= 6 || col === 15) {
        cell.alignment = { vertical: 'middle', wrapText: true };
      } else if (moneyCols.has(col)) {
        cell.numFmt = fmt;
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      }
    });
  }

  ws.columns = [
    { width: 14 },
    { width: 20 },
    { width: 28 },
    { width: 18 },
    { width: 16 },
    { width: 26 },
    { width: 14 },
    { width: 18 },
    { width: 14 },
    { width: 12 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 20 },
  ];

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  return { blob, filename: filenameRelacionDespachados() };
}

export function triggerExcelBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
