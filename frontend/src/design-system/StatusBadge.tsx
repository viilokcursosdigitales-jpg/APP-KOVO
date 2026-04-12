import { ds } from './ds';

export type StatusBadgeVariant = 'success' | 'paused' | 'error' | 'info' | 'warning';

const map: Record<StatusBadgeVariant, { bg: string; text: string; dot: string }> = {
  success: { bg: ds.successBg, text: ds.successText, dot: ds.successText },
  paused: { bg: ds.bgSubtle, text: ds.textMuted, dot: ds.textHint },
  error: { bg: ds.dangerBg, text: ds.dangerText, dot: ds.dangerText },
  info: { bg: ds.infoBg, text: ds.infoText, dot: ds.infoText },
  warning: { bg: ds.warningBg, text: ds.warningText, dot: ds.warningText },
};

export function StatusBadge({ variant, children }: { variant: StatusBadgeVariant; children: string }) {
  const c = map[variant];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 9px',
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 500,
        background: c.bg,
        color: c.text,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: c.dot,
          flexShrink: 0,
        }}
      />
      {children}
    </span>
  );
}
