export type MoticoShippingAddress = {
  name: string;
  address1: string;
  address2: string;
  city: string;
  province: string;
  zip: string;
  country: string;
  phone: string;
};

export type MoticoLineItemRow = {
  title: string;
  quantity: number;
  price: string;
};

/** Datos de una guía (una franja horizontal por pedido). */
export type MoticoGuideLabelData = {
  nombre: string;
  direccion: string;
  ciudad: string;
  celular: string;
  valorCobrar: string;
  observacion: string;
  orderRef: string;
};

export const GUIAS_POR_HOJA = 5;

/** Margen delgado e igual en los cuatro lados (impresión @page y colocación en PDF). */
const GUIDE_PAGE_MARGIN_PT = 14;

function esc(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function logoCellHtml(logoDataUrl: string | null): string {
  if (logoDataUrl) {
    return `<img class="guide-logo-img" src="${String(logoDataUrl).replace(/"/g, '&quot;')}" alt="" />`;
  }
  return '<div class="guide-logo-fallback">LOGO</div>';
}

function oneStripHtml(logoDataUrl: string | null, row: MoticoGuideLabelData): string {
  return `
  <div class="guide-strip">
    <div class="guide-logo-cell">${logoCellHtml(logoDataUrl)}</div>
    <table class="guide-table" aria-label="Guía ${esc(row.orderRef)}">
      <tbody>
        <tr>
          <th scope="row">NOMBRE :</th>
          <td>${esc(row.nombre)}</td>
        </tr>
        <tr>
          <th scope="row">DIRECCION:</th>
          <td>${esc(row.direccion)}</td>
        </tr>
        <tr>
          <th scope="row">CIUDAD:</th>
          <td>${esc(row.ciudad)}</td>
        </tr>
        <tr>
          <th scope="row">CELULAR:</th>
          <td>${esc(row.celular)}</td>
        </tr>
        <tr>
          <th scope="row">VALOR A COBRAR :</th>
          <td>${esc(row.valorCobrar)}</td>
        </tr>
        <tr>
          <th scope="row" class="th-obs"><strong>Observación</strong></th>
          <td>${esc(row.observacion)}</td>
        </tr>
      </tbody>
    </table>
  </div>`;
}

/**
 * Formato tipo “$55.000” para COP; resto con Intl estándar.
 */
export function formatValorCobrarDisplay(amount: number, currency: string): string {
  if (!Number.isFinite(amount)) return '—';
  const c = String(currency || '').toUpperCase();
  if (c === 'COP') {
    return `$${new Intl.NumberFormat('es-CO', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Math.round(amount))}`;
  }
  try {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: c.length === 3 ? c : 'USD' }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** Texto tipo “1 BODY CALI, 2 OTRO” en mayúsculas. */
export function buildObservacionLine(
  lineItems: MoticoLineItemRow[],
  fallbackTitle: string,
  fallbackQty: number,
): string {
  if (lineItems.length) {
    return lineItems
      .map((li) => `${li.quantity} ${li.title}`.trim())
      .join(', ')
      .toUpperCase();
  }
  return `${fallbackQty} ${fallbackTitle}`.trim().toUpperCase();
}

export function buildMoticoGuideLabelData(opts: {
  orderName: string;
  client: string;
  shipping: MoticoShippingAddress | null;
  lineItems: MoticoLineItemRow[];
  totalAmount: number;
  currency: string;
  fallbackProductSummary: string;
  defaultQuantity: number;
}): MoticoGuideLabelData {
  const ship = opts.shipping;
  const nombre = (ship?.name && ship.name.trim()) || opts.client || '—';
  const dirParts = [ship?.address1, ship?.address2].filter((x) => String(x || '').trim());
  const direccion = dirParts.join(' ').trim() || '—';
  const ciudadRaw = ship?.city || ship?.province || '';
  const ciudad = ciudadRaw ? ciudadRaw.toUpperCase() : '—';
  const celular = (ship?.phone && String(ship.phone).trim()) || '—';
  const valorCobrar = formatValorCobrarDisplay(opts.totalAmount, opts.currency);
  const observacion = buildObservacionLine(opts.lineItems, opts.fallbackProductSummary, opts.defaultQuantity);
  return {
    nombre,
    direccion,
    ciudad,
    celular,
    valorCobrar,
    observacion,
    orderRef: opts.orderName,
  };
}

type BuildBatchPrintOptions = {
  /** Barra en pantalla con botón Imprimir; oculta al imprimir. */
  screenPreviewToolbar?: boolean;
};

function buildBatchPrintDocument(
  logoDataUrl: string | null,
  labels: MoticoGuideLabelData[],
  options?: BuildBatchPrintOptions,
): string {
  const pages = chunk(labels, GUIAS_POR_HOJA);
  const pagesHtml = pages
    .map((pageRows) => {
      const strips = pageRows.map((row) => oneStripHtml(logoDataUrl, row)).join('\n');
      return `<section class="print-page">${strips}</section>`;
    })
    .join('\n');

  const previewCss = options?.screenPreviewToolbar
    ? `
    @media screen {
      body { padding-top: 52px; }
    }
    .motico-preview-toolbar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      padding: 10px 16px;
      background: #0f172a;
      color: #f8fafc;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      font-size: 14px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    }
    .motico-preview-toolbar span { font-weight: 600; }
    .motico-preview-toolbar button {
      padding: 8px 18px;
      border-radius: 8px;
      border: none;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      background: #3b82f6;
      color: #fff;
    }
    .motico-preview-toolbar button:hover { background: #2563eb; }
    @media print {
      .motico-preview-toolbar { display: none !important; }
    }
    `
    : '';

  const previewBar = options?.screenPreviewToolbar
    ? `<div class="motico-preview-toolbar" role="toolbar" aria-label="Vista previa de guías">
  <span>Vista previa · Guías Motico</span>
  <button type="button" onclick="window.print()">Imprimir</button>
</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <title>Guías Motico</title>
  <style>
    @page { size: letter; margin: ${GUIDE_PAGE_MARGIN_PT}pt; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      font-family: Arial, Helvetica, "Segoe UI", sans-serif;
      color: #000;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .print-page {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 0.08in;
      justify-content: flex-start;
      page-break-after: always;
      page-break-inside: avoid;
    }
    .print-page:last-of-type {
      page-break-after: auto;
    }
    .guide-strip {
      flex: 0 0 auto;
      height: 1.88in;
      display: flex;
      flex-direction: row;
      align-items: stretch;
      border: 1px solid #000;
      page-break-inside: avoid;
    }
    .guide-logo-cell {
      flex: 0 0 18%;
      min-width: 0.95in;
      max-width: 1.35in;
      border-right: 1px solid #000;
      background: #e8f4fc;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px;
    }
    .guide-logo-img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    .guide-logo-fallback {
      font-size: 8pt;
      font-weight: 700;
      color: #64748b;
    }
    .guide-table {
      flex: 1 1 auto;
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 8.5pt;
      line-height: 1.22;
    }
    .guide-table th,
    .guide-table td {
      border-bottom: 1px solid #000;
      padding: 3px 6px;
      vertical-align: top;
      word-wrap: break-word;
    }
    .guide-table tr:last-child th,
    .guide-table tr:last-child td {
      border-bottom: none;
    }
    .guide-table th {
      width: 28%;
      border-right: 1px solid #000;
      text-align: left;
      font-weight: 400;
      text-transform: uppercase;
    }
    .guide-table .th-obs {
      font-weight: 700;
    }
    .guide-table td {
      width: 72%;
    }
    ${previewCss}
  </style>
</head>
<body>
${previewBar}
${pagesHtml}
</body>
</html>`;
}

const PREVIEW_BLOB_REVOKE_MS = 120_000;

/**
 * Abre una pestaña con vista previa HTML de las guías (máx. ${GUIAS_POR_HOJA} por hoja carta).
 * El usuario imprime desde el botón "Imprimir" o el menú del navegador; no se abre el diálogo de impresión solo.
 */
export function openMoticoGuidesBatchPrint(logoDataUrl: string | null, labels: MoticoGuideLabelData[]): boolean {
  if (!labels.length) return false;
  try {
    const html = buildBatchPrintDocument(logoDataUrl, labels, { screenPreviewToolbar: true });
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) {
      URL.revokeObjectURL(url);
      return false;
    }
    setTimeout(() => URL.revokeObjectURL(url), PREVIEW_BLOB_REVOKE_MS);
    return true;
  } catch (e) {
    console.error('openMoticoGuidesBatchPrint', e);
    return false;
  }
}
