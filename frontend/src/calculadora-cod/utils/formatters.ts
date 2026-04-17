import type { CurrencyCode } from '../types';

export function normalizeName(name: string): string {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function fmtPercent(n: number, decimals = 1): string {
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(decimals)}%`;
}

export function fmtCurrency(amount: number, currency: CurrencyCode): string {
  if (!Number.isFinite(amount)) return '—';
  if (currency === 'COP') {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Math.round(amount));
  }
  const cur = currency === 'MXN' ? 'MXN' : 'USD';
  return new Intl.NumberFormat(cur === 'MXN' ? 'es-MX' : 'en-US', {
    style: 'currency',
    currency: cur,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function fmtRoasMult(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return '—';
  return `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
}

export function relativeTimeShort(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'hace instantes';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}
