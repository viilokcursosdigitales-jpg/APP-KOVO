import { ds } from './ds';

export function MetricPill({ children }: { children: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        background: ds.brandBg,
        color: ds.brand,
        borderRadius: 6,
        padding: '2px 8px',
        fontWeight: 700,
        fontSize: 12,
      }}
    >
      {children}
    </span>
  );
}
