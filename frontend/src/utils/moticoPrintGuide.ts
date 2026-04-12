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

function buildBatchPrintDocument(logoDataUrl: string | null, labels: MoticoGuideLabelData[]): string {
  const pages = chunk(labels, GUIAS_POR_HOJA);
  const pagesHtml = pages
    .map((pageRows) => {
      const strips = pageRows.map((row) => oneStripHtml(logoDataUrl, row)).join('\n');
      return `<section class="print-page">${strips}</section>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <title>Guías Motico</title>
  <style>
    @page { size: letter; margin: 0.22in; }
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
  </style>
</head>
<body>
${pagesHtml}
</body>
</html>`;
}

const PDF_REVOKE_MS = 120_000;

/**
 * Genera un PDF con las guías (máx. ${GUIAS_POR_HOJA} por hoja carta), abre una pestaña con vista previa
 * y dispara la descarga del archivo.
 */
export async function openMoticoGuidesBatchPrint(
  logoDataUrl: string | null,
  labels: MoticoGuideLabelData[],
): Promise<boolean> {
  if (!labels.length) return false;

  const html = buildBatchPrintDocument(logoDataUrl, labels);
  let iframe: HTMLIFrameElement | null = null;

  try {
    const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')]);

    iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.title = 'Motico guías PDF';
    iframe.style.cssText =
      'position:fixed;left:-10000px;top:0;width:8.5in;min-height:11in;height:auto;max-height:none;visibility:hidden;border:0;margin:0;padding:0';
    document.body.appendChild(iframe);

    const idoc = iframe.contentDocument;
    if (!idoc) return false;

    idoc.open();
    idoc.write(html);
    idoc.close();

    await new Promise<void>((resolve) => {
      const finish = () => resolve();
      if (iframe!.contentDocument?.readyState === 'complete') {
        requestAnimationFrame(() => requestAnimationFrame(finish));
      } else {
        iframe!.onload = finish;
      }
    });
    await new Promise((r) => setTimeout(r, 200));

    const pageEls = Array.from(idoc.querySelectorAll<HTMLElement>('.print-page'));
    if (!pageEls.length) return false;

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();

    for (let i = 0; i < pageEls.length; i++) {
      const el = pageEls[i];
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: el.scrollWidth,
        windowHeight: el.scrollHeight,
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      let imgW = pageW;
      let imgH = (canvas.height * imgW) / canvas.width;
      if (imgH > pageH) {
        imgH = pageH;
        imgW = (canvas.width * pageH) / canvas.height;
      }
      const x = (pageW - imgW) / 2;
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, 'JPEG', x, 0, imgW, imgH);
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const fileName = `guias-motico-${stamp}.pdf`;
    const blob = pdf.output('blob');
    const url = URL.createObjectURL(blob);

    window.open(url, '_blank', 'noopener,noreferrer');

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), PDF_REVOKE_MS);
    return true;
  } catch (e) {
    console.error('openMoticoGuidesBatchPrint', e);
    return false;
  } finally {
    if (iframe?.parentNode) iframe.parentNode.removeChild(iframe);
  }
}
