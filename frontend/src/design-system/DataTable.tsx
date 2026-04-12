import type { ReactNode } from 'react';
import { ds } from './ds';

export function DataTable({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        background: ds.bgCard,
        border: `1px solid ${ds.borderCard}`,
        borderRadius: 14,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '16px 20px',
          borderBottom: `1px solid ${ds.borderSide}`,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary }}>{title}</div>
          {subtitle ? (
            <div style={{ fontSize: 11, color: ds.textMuted, marginTop: 4 }}>{subtitle}</div>
          ) : null}
        </div>
        {action}
      </div>
      <div style={{ overflowX: 'auto' }}>{children}</div>
    </div>
  );
}

export const tableBase = {
  width: '100%' as const,
  borderCollapse: 'collapse' as const,
  tableLayout: 'fixed' as const,
};

export function Th({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <th
      style={{
        background: ds.bgApp,
        fontSize: 10.5,
        textTransform: 'uppercase' as const,
        letterSpacing: '0.4px',
        color: ds.textHint,
        padding: '11px 16px',
        textAlign: 'left' as const,
        fontWeight: 500,
        borderBottom: `1px solid ${ds.borderCard}`,
        ...style,
      }}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  isLast,
  style,
}: {
  children: ReactNode;
  isLast?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <td
      style={{
        fontSize: 12,
        color: '#333333',
        padding: '12px 16px',
        borderBottom: isLast ? 'none' : `1px solid ${ds.borderRow}`,
        verticalAlign: 'middle' as const,
        ...style,
      }}
    >
      {children}
    </td>
  );
}
