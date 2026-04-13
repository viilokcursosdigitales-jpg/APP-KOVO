import ExcelJS from 'exceljs';

/** Propiedades de línea Shopify (cart properties). */
export type MoticoLineItemProperty = { name: string; value: string };

/** Línea tal como llega del backend (tras ampliar shopifyService). */
export type MoticoGuideLineSource = {
  title: string;
  name?: string;
  variant_title?: string;
  quantity: number;
  properties?: MoticoLineItemProperty[];
};

export type MoticoGuideExportLine = {
  producto: string;
  diseño: string;
  color: string;
  numero: number;
  talla: string;
  nombre: string;
};

export type MoticoGuideExportOrder = {
  orderIndex: number;
  cliente: string;
  celular: string;
  direccion: string;
  ciudad: string;
  cobro: number;
  lines: MoticoGuideExportLine[];
};

function propByName(props: MoticoLineItemProperty[] | undefined, ...candidates: string[]): string {
  if (!props?.length) return '';
  const norm = props.map((p) => ({ k: String(p.name || '').toLowerCase(), v: String(p.value || '').trim() }));
  for (const c of candidates) {
    const cl = c.toLowerCase();
    const hit = norm.find((p) => p.k === cl);
    if (hit?.v) return hit.v;
  }
  return '';
}

function parseVariant(variantTitle: string): { color: string; talla: string } {
  const v = variantTitle.trim();
  if (!v) return { color: '', talla: '' };
  const parts = v.split('/').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { color: parts[0], talla: parts.slice(1).join(' / ') };
  }
  const one = parts[0] || v;
  const looksLikeSize =
    /\d\s*-\s*\d|meses?|MES|años?|AÑO|cm|CM|\bXL\b|\bXXL\b|\bXS\b|\bS\b|\bM\b|\bL\b/i.test(one);
  if (looksLikeSize) return { color: '', talla: one };
  return { color: one, talla: '' };
}

function productoFromTitle(title: string): string {
  const t = title.trim();
  const idx = t.indexOf(' - ');
  if (idx > 0) return t.slice(0, idx).trim();
  return t;
}

function diseñoFromTitle(title: string): string {
  const t = title.trim();
  const idx = t.indexOf(' - ');
  if (idx > 0) return t.slice(idx + 3).trim();
  return '';
}

/** Mapea una línea de Shopify a columnas PRODUCTO…NOMBRE del Excel relación. */
export function mapLineItemToExportLine(li: MoticoGuideLineSource): Omit<MoticoGuideExportLine, 'numero'> {
  const props = li.properties || [];
  let color = propByName(props, 'Color', 'Colour', 'color');
  let talla = propByName(props, 'Talla', 'Size', 'Tamaño');
  const nombre = propByName(props, 'Nombre', 'Name', 'Personalizado', 'Texto');
  let diseño = propByName(props, 'Diseño', 'Design', 'Estilo');

  const vt = parseVariant(li.variant_title || '');
  if (!color) color = vt.color;
  if (!talla) talla = vt.talla;

  const title = String(li.title || li.name || '').trim() || 'Producto';
  const titleDiseño = diseñoFromTitle(title);
  if (!diseño) diseño = titleDiseño;

  return {
    producto: productoFromTitle(title) || title,
    diseño,
    color,
    talla,
    nombre,
  };
}

function formatCobroEsCO(value: number): string {
  if (!Number.isFinite(value)) return '$0';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

const HEADER_FILL = 'FF1F4E79';
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF000000' } },
  left: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  right: { style: 'thin', color: { argb: 'FF000000' } },
};

/**
 * Excel tipo relación de pedidos: una fila por ítem; #, cliente, dirección, ciudad y COBRO
 * combinados en vertical cuando un pedido tiene varias líneas.
 */
export async function downloadMoticoGuidesLayoutExcel(
  orders: MoticoGuideExportOrder[],
  filePrefix = 'motico_guias_pedidos',
): Promise<void> {
  if (!orders.length) return;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Pedidos guías', {
    views: [{ state: 'normal' }],
  });

  const headers = [
    '#',
    'CLIENTE',
    'CELULAR',
    'DIRECCIÓN',
    'CIUDAD',
    'PRODUCTO',
    'DISEÑO',
    'COLOR',
    'NÚMERO',
    'TALLA',
    'NOMBRE',
    'COBRO',
  ];
  ws.addRow(headers);
  const headerRow = ws.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell((cell, col) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = THIN_BORDER;
  });

  ws.columns = [
    { width: 5 },
    { width: 22 },
    { width: 14 },
    { width: 36 },
    { width: 14 },
    { width: 14 },
    { width: 22 },
    { width: 12 },
    { width: 9 },
    { width: 18 },
    { width: 14 },
    { width: 14 },
  ];

  let r = 2;
  for (const ord of orders) {
    const n = Math.max(1, ord.lines.length);
    const startRow = r;
    const endRow = r + n - 1;
    const cobroStr = formatCobroEsCO(ord.cobro);

    for (let i = 0; i < n; i++) {
      const line = ord.lines[i];
      const row = ws.addRow([
        ord.orderIndex,
        ord.cliente,
        ord.celular,
        ord.direccion,
        ord.ciudad,
        line.producto,
        line.diseño,
        line.color,
        line.numero,
        line.talla,
        line.nombre,
        cobroStr,
      ]);
      row.eachCell((cell, col) => {
        cell.border = THIN_BORDER;
        if (col === 1 || col === 5) {
          cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        } else if (col === 12) {
          cell.alignment = { vertical: 'middle', horizontal: 'right', wrapText: true };
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        }
      });
      r += 1;
    }

    if (n > 1) {
      for (const col of [1, 2, 3, 4, 5, 12]) {
        ws.mergeCells(startRow, col, endRow, col);
      }
      for (const col of [1, 2, 3, 4, 5, 12]) {
        const cell = ws.getCell(startRow, col);
        cell.alignment = {
          ...cell.alignment,
          vertical: 'middle',
          horizontal: col === 1 || col === 5 ? 'center' : col === 12 ? 'right' : 'left',
          wrapText: true,
        };
      }
    } else {
      const cell = ws.getCell(startRow, 12);
      cell.alignment = { vertical: 'middle', horizontal: 'right', wrapText: true };
    }
  }

  const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '');
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filePrefix}_${stamp}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
