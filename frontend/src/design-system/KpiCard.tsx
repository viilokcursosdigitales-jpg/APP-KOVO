import type { ReactNode } from 'react';
import { ds, kpiIconBox, type KpiVariant } from './ds';

export function KpiCard({
  variant,
  label,
  value,
  icon,
  badge,
}: {
  variant: KpiVariant;
  label: string;
  value: string;
  icon: ReactNode;
  badge?: ReactNode;
}) {
  const box = kpiIconBox[variant];
  return (
    <div
      style={{
        background: ds.bgCard,
        border: `1px solid ${ds.borderCard}`,
        borderRadius: 14,
        padding: '18px 20px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            background: box.bg,
            color: box.fg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </div>
        {badge != null ? badge : null}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: ds.textPrimary,
          lineHeight: 1.15,
        }}
      >
        {value}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 11,
          fontWeight: 500,
          color: ds.textMuted,
        }}
      >
        {label}
      </div>
    </div>
  );
}
