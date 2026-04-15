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
  /** Variante / opción del producto para la columna VARIABLE; «NO APLICA» si no hay. */
  variable: string;
};

export type MoticoGuideExportOrder = {
  orderIndex: number;
  cliente: string;
  celular: string;
  direccion: string;
  ciudad: string;
  cobro: number;
  observacion: string;
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

/** Título de variante genérico de Shopify (no es una opción real). */
function isGenericVariantTitle(raw: string): boolean {
  const s = raw.trim();
  if (!s) return true;
  if (/^default(\s+title)?$/i.test(s)) return true;
  if (s.toLowerCase() === 'default') return true;
  return false;
}

/**
 * Una sola parte del título de variante y coincide con patrón de talla/medida (no cuenta como variable de producto).
 */
function variantTitleIsOnlySizeLike(raw: string): boolean {
  const v = raw.trim();
  if (!v) return true;
  const parts = v.split('/').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return false;
  const one = parts[0] || v;
  return /\d\s*-\s*\d|meses?|MES|años?|AÑO|cm|CM|\bXL\b|\bXXL\b|\bXS\b|\bS\b|\bM\b|\bL\b/i.test(one);
}

/**
 * En líneas Shopify, `name` suele ser «Título producto + variante»; si `variant_title` falta o es genérico,
 * extrae la parte variable quitando el título base.
 */
function shopifyNameVariantExcerpt(name: string, title: string): string {
  const n = String(name || '').trim();
  const t = String(title || '').trim();
  if (!n) return '';
  if (t) {
    const tNorm = t.toLowerCase();
    const nLow = n.toLowerCase();
    if (nLow.startsWith(tNorm) && n.length > t.length) {
      return n.slice(t.length).replace(/^[\s\-–—:]+/, '').trim();
    }
  }
  if (t && n.toLowerCase() === t.toLowerCase()) return '';
  return n;
}

/** Texto fuente para variante (API o nombre compuesto Shopify). */
function lineVariantSourceForParse(li: MoticoGuideLineSource): string {
  const raw = String(li.variant_title || '').trim();
  if (raw && !isGenericVariantTitle(raw)) return raw;
  return shopifyNameVariantExcerpt(String(li.name || ''), String(li.title || ''));
}

/**
 * Texto para la columna VARIABLE: variante u opciones (diseño/color) si aplica; si no hay, «NO APLICA» (nunca vacío).
 */
export function moticoGuideVariableFromLineSource(li: MoticoGuideLineSource): string {
  const m = mapLineItemToExportLineCore(li);
  const tallaNorm = String(m.talla || '').trim().toLowerCase();

  const variantPick = lineVariantSourceForParse(li).trim();
  if (variantPick && !isGenericVariantTitle(variantPick) && !variantTitleIsOnlySizeLike(variantPick)) {
    const vNorm = variantPick.toLowerCase();
    if (!tallaNorm || vNorm !== tallaNorm) {
      return variantPick;
    }
  }

  const fromOpts = [m.diseño, m.color].filter((x) => String(x || '').trim()).join(' / ').trim();
  if (fromOpts) {
    if (tallaNorm && fromOpts.toLowerCase() === tallaNorm) return 'NO APLICA';
    return fromOpts;
  }

  return 'NO APLICA';
}

/**
 * Columna VARIABLE en la relación Excel (y vista previa): solo texto **antes** del primer «/»;
 * lo que va después del slash no se muestra. Vacío → «NO APLICA».
 */
export function moticoGuideVariableForExcelCell(raw: string | null | undefined): string {
  const full = String(raw ?? '').trim();
  if (!full) return 'NO APLICA';
  const idx = full.indexOf('/');
  const head = (idx === -1 ? full : full.slice(0, idx)).trim();
  return head || 'NO APLICA';
}

function mapLineItemToExportLineCore(li: MoticoGuideLineSource): Omit<MoticoGuideExportLine, 'numero' | 'variable'> {
  const props = li.properties || [];
  let color = propByName(props, 'Color', 'Colour', 'color');
  let talla = propByName(props, 'Talla', 'Size', 'Tamaño');
  const nombre = propByName(props, 'Nombre', 'Name', 'Personalizado', 'Texto');
  let diseño = propByName(props, 'Diseño', 'Design', 'Estilo');

  const variantSrc = lineVariantSourceForParse(li);
  const vt = parseVariant(variantSrc);
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

/** Mapea una línea de Shopify a columnas PRODUCTO…NOMBRE del Excel relación. */
export function mapLineItemToExportLine(li: MoticoGuideLineSource): Omit<MoticoGuideExportLine, 'numero'> {
  const base = mapLineItemToExportLineCore(li);
  return { ...base, variable: moticoGuideVariableFromLineSource(li) };
}

function formatCobroDisplay(value: number, currency: string): string {
  if (!Number.isFinite(value)) return '$0';
  const c = String(currency || 'COP')
    .trim()
    .toUpperCase();
  if (c === 'COP') {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Math.round(value));
  }
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: c.length === 3 ? c : 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${c}`;
  }
}

const LOCALE_RELACION_EXCEL = 'es-CO';

/**
 * Relación Excel / vista previa: minúsculas con mayúscula solo en la inicial de cada palabra (letras Unicode).
 * Los números finitos no se alteran. No usar sobre el texto ya formateado de COBRO.
 */
export function toMoticoRelacionExcelDisplayCase(raw: string | number | null | undefined): string | number {
  if (raw == null) return '';
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw).trim();
  if (!s) return '';
  const lower = s.toLocaleLowerCase(LOCALE_RELACION_EXCEL);
  return lower.replace(/\p{L}+/gu, (w) => {
    if (!w) return w;
    return (
      w.charAt(0).toLocaleUpperCase(LOCALE_RELACION_EXCEL) + w.slice(1).toLocaleLowerCase(LOCALE_RELACION_EXCEL)
    );
  });
}

/** Fila de datos: columna 9 = cobro sin reformatear; el resto pasa por {@link toMoticoRelacionExcelDisplayCase}. */
function relacionExcelRowDisplayValues(values: (string | number)[]): (string | number)[] {
  return values.map((v, idx) => {
    const col = idx + 1;
    if (col === 9) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    return toMoticoRelacionExcelDisplayCase(v);
  });
}

const HEADER_FILL = 'FF6C47FF';
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF000000' } },
  left: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  right: { style: 'thin', color: { argb: 'FF000000' } },
};

/** Encabezados de columnas (Excel y vista previa en pantalla). */
export const MOTICO_GUIAS_EXCEL_COLUMN_HEADERS = [
  '#',
  'CLIENTE',
  'CELULAR',
  'DIRECCIÓN',
  'CIUDAD',
  'PRODUCTO',
  'VARIABLE',
  'TALLA',
  'COBRO',
  'OBSERVACION',
] as const;

/** Una fila de la relación (para vista previa HTML, alineada al Excel). */
export type MoticoGuidesExcelPreviewRow = {
  orderIndex: number;
  cliente: string;
  celular: string;
  direccion: string;
  ciudad: string;
  producto: string;
  variable: string;
  talla: string;
  cobro: string;
  observacion: string;
  lineIndex: number;
  lineCount: number;
};

export function buildMoticoGuidesExcelPreviewRows(
  orders: MoticoGuideExportOrder[],
  currency: string,
): MoticoGuidesExcelPreviewRow[] {
  const rows: MoticoGuidesExcelPreviewRow[] = [];
  for (const ord of orders) {
    const n = Math.max(1, ord.lines.length);
    const cobroStr = formatCobroDisplay(ord.cobro, currency);
    const observacion = ord.observacion || '';
    for (let i = 0; i < n; i++) {
      const line = ord.lines[i];
      rows.push({
        orderIndex: ord.orderIndex,
        cliente: String(toMoticoRelacionExcelDisplayCase(ord.cliente)),
        celular: String(toMoticoRelacionExcelDisplayCase(ord.celular)),
        direccion: String(toMoticoRelacionExcelDisplayCase(ord.direccion)),
        ciudad: String(toMoticoRelacionExcelDisplayCase(ord.ciudad)),
        producto: String(toMoticoRelacionExcelDisplayCase(line.producto)),
        variable: String(toMoticoRelacionExcelDisplayCase(moticoGuideVariableForExcelCell(line.variable))),
        talla: String(toMoticoRelacionExcelDisplayCase(line.talla)),
        cobro: cobroStr,
        observacion: String(toMoticoRelacionExcelDisplayCase(observacion)),
        lineIndex: i,
        lineCount: n,
      });
    }
  }
  return rows;
}

function fillMoticoGuidesWorksheet(ws: ExcelJS.Worksheet, orders: MoticoGuideExportOrder[], currency: string): void {
  ws.addRow([...MOTICO_GUIAS_EXCEL_COLUMN_HEADERS.map((h) => String(toMoticoRelacionExcelDisplayCase(h)))]);
  const headerRow = ws.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell((cell, col) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = THIN_BORDER;
  });

  ws.columns = [{ width: 5 }, { width: 22 }, { width: 14 }, { width: 36 }, { width: 14 }, { width: 22 }, { width: 24 }, { width: 12 }, { width: 14 }, { width: 28 }];

  let r = 2;
  for (const ord of orders) {
    const n = Math.max(1, ord.lines.length);
    const startRow = r;
    const endRow = r + n - 1;
    const cobroStr = formatCobroDisplay(ord.cobro, currency);

    for (let i = 0; i < n; i++) {
      const line = ord.lines[i];
      const row = ws.addRow(
        relacionExcelRowDisplayValues([
          ord.orderIndex,
          ord.cliente,
          ord.celular,
          ord.direccion,
          ord.ciudad,
          line.producto,
          moticoGuideVariableForExcelCell(line.variable),
          line.talla,
          cobroStr,
          ord.observacion || '',
        ]),
      );
      row.eachCell((cell, col) => {
        cell.border = THIN_BORDER;
        if (col === 1 || col === 5) {
          cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        } else if (col === 9) {
          cell.alignment = { vertical: 'middle', horizontal: 'right', wrapText: true };
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        }
      });
      r += 1;
    }

    if (n > 1) {
      for (const col of [1, 2, 3, 4, 5, 9, 10]) {
        ws.mergeCells(startRow, col, endRow, col);
      }
      for (const col of [1, 2, 3, 4, 5, 9, 10]) {
        const cell = ws.getCell(startRow, col);
        cell.alignment = {
          ...cell.alignment,
          vertical: 'middle',
          horizontal: col === 1 || col === 5 ? 'center' : col === 9 ? 'right' : 'left',
          wrapText: true,
        };
      }
    } else {
      const cell = ws.getCell(startRow, 9);
      cell.alignment = { vertical: 'middle', horizontal: 'right', wrapText: true };
      const obsCell = ws.getCell(startRow, 10);
      obsCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    }
  }
}

function moticoGuidesExcelFilename(filePrefix: string): string {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '');
  return `${filePrefix}_${stamp}.xlsx`;
}

/**
 * Genera el mismo .xlsx que la descarga, sin disparar el navegador (p. ej. vista previa).
 */
export async function buildMoticoGuidesLayoutExcelBlob(
  orders: MoticoGuideExportOrder[],
  filePrefix = 'motico_guias_pedidos',
  currency = 'COP',
): Promise<{ blob: Blob; filename: string } | null> {
  if (!orders.length) return null;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Pedidos guías', {
    views: [{ state: 'normal' }],
  });
  fillMoticoGuidesWorksheet(ws, orders, currency);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  return { blob, filename: moticoGuidesExcelFilename(filePrefix) };
}

/**
 * Excel tipo relación de pedidos: una fila por ítem; #, cliente, dirección, ciudad y COBRO
 * combinados en vertical cuando un pedido tiene varias líneas.
 */
export async function downloadMoticoGuidesLayoutExcel(
  orders: MoticoGuideExportOrder[],
  filePrefix = 'motico_guias_pedidos',
  currency = 'COP',
): Promise<void> {
  const built = await buildMoticoGuidesLayoutExcelBlob(orders, filePrefix, currency);
  if (!built) return;
  const url = URL.createObjectURL(built.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = built.filename;
  a.click();
  URL.revokeObjectURL(url);
}
