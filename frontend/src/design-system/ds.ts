/** Design system — use with inline `style` (React). Maps to tokens.css */

export const ds = {
  brand: 'var(--color-brand)',
  brandSoft: 'var(--color-brand-soft)',
  brandBg: 'var(--color-brand-bg)',
  brandPale: 'var(--color-brand-pale)',
  bgApp: 'var(--color-bg-app)',
  bgCard: 'var(--color-bg-card)',
  bgSubtle: 'var(--color-bg-subtle)',
  borderCard: 'var(--color-border-card)',
  borderSide: 'var(--color-border-side)',
  borderRow: 'var(--color-border-row)',
  textPrimary: 'var(--color-text-primary)',
  textSecondary: 'var(--color-text-secondary)',
  textMuted: 'var(--color-text-muted)',
  textHint: 'var(--color-text-hint)',
  successBg: 'var(--color-success-bg)',
  successText: 'var(--color-success-text)',
  infoBg: 'var(--color-info-bg)',
  infoText: 'var(--color-info-text)',
  warningBg: 'var(--color-warning-bg)',
  warningText: 'var(--color-warning-text)',
  dangerBg: 'var(--color-danger-bg)',
  dangerText: 'var(--color-danger-text)',
  font: 'var(--font-base)',
  kpiSalesBg: 'var(--kpi-sales-bg)',
  kpiSalesIcon: 'var(--kpi-sales-icon)',
  kpiTrafficBg: 'var(--kpi-traffic-bg)',
  kpiTrafficIcon: 'var(--kpi-traffic-icon)',
  kpiSpendBg: 'var(--kpi-spend-bg)',
  kpiSpendIcon: 'var(--kpi-spend-icon)',
  kpiConvBg: 'var(--kpi-conv-bg)',
  kpiConvIcon: 'var(--kpi-conv-icon)',
  kpiStockBg: 'var(--kpi-stock-bg)',
  kpiStockIcon: 'var(--kpi-stock-icon)',
  kpiAlertBg: 'var(--kpi-alert-bg)',
  kpiAlertIcon: 'var(--kpi-alert-icon)',
} as const;

export type KpiVariant = 'sales' | 'traffic' | 'spend' | 'conversion' | 'stock' | 'alert';

/** Opacidades sobre brand / success (evita concatenar hex + sufijos en template strings). */
export const alpha = {
  brand08: 'rgba(108, 71, 255, 0.08)',
  brand12: 'rgba(108, 71, 255, 0.12)',
  brand18: 'rgba(108, 71, 255, 0.15)',
  brand35: 'rgba(108, 71, 255, 0.35)',
  brand40: 'rgba(108, 71, 255, 0.4)',
  brand45: 'rgba(108, 71, 255, 0.45)',
  success15: 'rgba(29, 158, 117, 0.15)',
} as const;

export const kpiIconBox: Record<KpiVariant, { bg: string; fg: string }> = {
  sales: { bg: ds.kpiSalesBg, fg: ds.kpiSalesIcon },
  traffic: { bg: ds.kpiTrafficBg, fg: ds.kpiTrafficIcon },
  spend: { bg: ds.kpiSpendBg, fg: ds.kpiSpendIcon },
  conversion: { bg: ds.kpiConvBg, fg: ds.kpiConvIcon },
  stock: { bg: ds.kpiStockBg, fg: ds.kpiStockIcon },
  alert: { bg: ds.kpiAlertBg, fg: ds.kpiAlertIcon },
};
