/** Parsea montos en formato colombiano (119.000) o decimal (119000 / 119,50). */
export function parseMoneyAmount(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v >= 0 ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/[$\s]/g, '');
  if (!t) return null;
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    const n = Number.parseFloat(t.replace(/\./g, ''));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  if (t.includes(',') && t.includes('.')) {
    const lastDot = t.lastIndexOf('.');
    const lastComma = t.lastIndexOf(',');
    const n =
      lastComma > lastDot
        ? Number.parseFloat(t.replace(/\./g, '').replace(',', '.'))
        : Number.parseFloat(t.replace(/,/g, ''));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  if (t.includes(',')) {
    const n = Number.parseFloat(t.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  const n = Number.parseFloat(t.replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
