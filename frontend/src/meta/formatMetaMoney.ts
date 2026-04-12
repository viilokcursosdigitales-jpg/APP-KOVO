/** Moneda mostrada en Meta Ads: análisis de creativos y embudo. */
const LOCALE = 'es-CO';
const CURRENCY = 'COP';

export function formatMetaMoney(n: number): string {
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency: CURRENCY,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${CURRENCY}`;
  }
}
