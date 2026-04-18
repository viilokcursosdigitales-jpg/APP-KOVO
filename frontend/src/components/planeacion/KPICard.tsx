import type { ReactNode } from 'react';
import { KpiCard } from '../../design-system/KpiCard';
import type { KpiVariant } from '../../design-system/ds';

/** Fachada del módulo sobre `KpiCard` del design system (variantes y layout unificados). */
export function KPICard({
  variant,
  label,
  value,
  icon,
  badge,
}: {
  variant: KpiVariant;
  label: string;
  value: ReactNode;
  icon: ReactNode;
  badge?: ReactNode;
}) {
  return <KpiCard variant={variant} label={label} value={value} icon={icon} badge={badge} />;
}
