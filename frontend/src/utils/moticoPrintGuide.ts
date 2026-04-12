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

function esc(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPrintHtml(opts: {
  logoDataUrl: string | null;
  orderName: string;
  client: string;
  email: string;
  createdAt: string;
  displayTotal: string;
  currency: string;
  shipping: MoticoShippingAddress | null;
  lineItems: MoticoLineItemRow[];
  shopDomain: string | null;
  shopifyOrderId: number;
}): string {
  const addr = opts.shipping;
  let envioCol = '';
  if (addr) {
    envioCol = `
      <div class="box">
        <div class="box-title">Envío</div>
        <p><strong>${esc(addr.name)}</strong></p>
        <p>${esc(addr.address1)}${addr.address2 ? `<br/>${esc(addr.address2)}` : ''}</p>
        <p>${esc([addr.city, addr.province, addr.zip].filter(Boolean).join(', '))}</p>
        <p>${esc(addr.country || '')}</p>
        ${addr.phone ? `<p>Tel: ${esc(addr.phone)}</p>` : ''}
      </div>`;
  } else {
    envioCol = `<div class="box"><div class="box-title">Envío</div><p class="muted">Sin dirección en Shopify.</p></div>`;
  }

  const rows = opts.lineItems.length
    ? opts.lineItems
        .map(
          (li) =>
            `<tr><td>${esc(li.title)}</td><td class="num">${li.quantity}</td><td class="num">${esc(li.price)}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="3" class="muted">—</td></tr>';

  const logoHtml = opts.logoDataUrl
    ? `<img class="logo" src="${String(opts.logoDataUrl).replace(/"/g, '&quot;')}" alt="Logo" />`
    : '<div class="logo-placeholder">Logo</div>';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <title>Guía ${esc(opts.orderName)}</title>
  <style>
    @page { size: letter; margin: 0.55in; }
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      font-size: 11pt;
      color: #111;
      margin: 0;
      padding: 0;
    }
    .sheet { max-width: 7.4in; margin: 0 auto; }
    .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; border-bottom: 2px solid #222; padding-bottom: 14px; margin-bottom: 16px; }
    .logo { max-height: 72px; max-width: 220px; object-fit: contain; }
    .logo-placeholder {
      width: 160px; height: 56px; border: 2px dashed #ccc; display: flex; align-items: center; justify-content: center;
      font-size: 10pt; color: #999; border-radius: 6px;
    }
    h1 { font-size: 16pt; margin: 0 0 4px 0; }
    .muted { color: #666; font-size: 10pt; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }
    .box { border: 1px solid #ddd; border-radius: 8px; padding: 10px 12px; }
    .box-title { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.06em; color: #666; margin-bottom: 6px; font-weight: 700; }
    .box p { margin: 2px 0; line-height: 1.35; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border-bottom: 1px solid #e5e5e5; padding: 8px 6px; text-align: left; font-size: 10pt; }
    th { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.04em; color: #555; }
    .num { text-align: right; }
    .total { margin-top: 14px; font-size: 13pt; font-weight: 700; text-align: right; }
    .footer { margin-top: 22px; padding-top: 10px; border-top: 1px solid #ddd; font-size: 9pt; color: #666; }
    .order-id { font-family: ui-monospace, monospace; font-size: 10pt; }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div>${logoHtml}</div>
      <div style="text-align:right">
        <h1>Guía de envío · Motico</h1>
        <div class="order-id">${esc(opts.orderName)}</div>
        <div class="muted">Pedido Shopify #${opts.shopifyOrderId}</div>
      </div>
    </div>
    <div class="grid">
      <div class="box">
        <div class="box-title">Cliente</div>
        <p><strong>${esc(opts.client)}</strong></p>
        <p>${esc(opts.email)}</p>
        <p class="muted">${esc(opts.createdAt)}</p>
      </div>
      ${envioCol}
    </div>
    <div class="box">
      <div class="box-title">Productos</div>
      <table>
        <thead><tr><th>Descripción</th><th class="num">Cant.</th><th class="num">P. unit.</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="total">Total: ${esc(opts.displayTotal)} ${esc(opts.currency)}</div>
    </div>
    <div class="footer">
      ${opts.shopDomain ? `Tienda: ${esc(opts.shopDomain)} · ` : ''}
      Generado desde KOVO · Hoja carta (Letter).
    </div>
  </div>
  <script>window.onload=function(){window.print();};</script>
</body>
</html>`;
}

export function openMoticoGuidePrint(opts: Parameters<typeof buildPrintHtml>[0]): boolean {
  const w = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1200');
  if (!w) return false;
  w.document.open();
  w.document.write(buildPrintHtml(opts));
  w.document.close();
  return true;
}
