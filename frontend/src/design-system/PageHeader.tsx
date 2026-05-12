import type { ReactNode } from 'react';
import { ds } from './ds';

function formatHeaderDate() {
  return new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());
}

const TITLE_FIT_LONGEST_PAD_X = 10;

export function PageHeader({
  title,
  subtitle,
  right,
  titleFitLongestWord,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  /** Ancho del título = palabra más ancha + padding horizontal (p. ej. tres palabras en columna). */
  titleFitLongestWord?: boolean;
}) {
  const titleWords = title.trim().split(/\s+/).filter(Boolean);

  return (
    <header
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        marginBottom: 24,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.3px',
            color: ds.textMuted,
            marginBottom: 6,
          }}
        >
          {formatHeaderDate()}
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 700,
            color: ds.textPrimary,
            lineHeight: 1.2,
            ...(titleFitLongestWord ? { display: 'inline-block', maxWidth: '100%' } : {}),
          }}
        >
          {titleFitLongestWord && titleWords.length > 1 ? (
            <span
              style={{
                display: 'inline-block',
                paddingLeft: TITLE_FIT_LONGEST_PAD_X,
                paddingRight: TITLE_FIT_LONGEST_PAD_X,
                boxSizing: 'border-box',
              }}
            >
              {titleWords.map((word, i) => (
                <span
                  key={`${i}-${word}`}
                  style={{
                    display: 'block',
                    whiteSpace: 'nowrap',
                    textAlign: 'center',
                    lineHeight: 1.15,
                  }}
                >
                  {word}
                </span>
              ))}
            </span>
          ) : (
            title
          )}
        </h1>
        {subtitle ? (
          <p style={{ margin: '8px 0 0', fontSize: 13, color: ds.textSecondary, maxWidth: 560 }}>{subtitle}</p>
        ) : null}
      </div>
      {right}
    </header>
  );
}

/** Period pills: active = brand fill, inactive = muted text */
export function PeriodPillGroup<T extends string>({
  options,
  value,
  onChange,
  labels,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labels: Record<T, string>;
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        gap: 3,
        padding: 3,
        border: `1px solid ${ds.borderCard}`,
        borderRadius: 24,
        background: ds.bgCard,
      }}
    >
      {options.map((key) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            style={{
              border: 'none',
              cursor: 'pointer',
              padding: '6px 14px',
              borderRadius: 21,
              fontSize: 12,
              fontWeight: active ? 600 : 500,
              background: active ? ds.brand : 'transparent',
              color: active ? '#ffffff' : ds.textMuted,
            }}
          >
            {labels[key]}
          </button>
        );
      })}
    </div>
  );
}

export function HeaderActionButton({
  children,
  onClick,
  disabled,
  icon,
}: {
  children: string;
  onClick?: () => void;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        border: `1px solid ${ds.borderCard}`,
        background: ds.bgCard,
        color: ds.textSecondary,
        borderRadius: 8,
        padding: '7px 14px',
        fontSize: 12,
        fontWeight: 500,
        cursor: disabled ? 'wait' : 'pointer',
      }}
    >
      {icon}
      {children}
    </button>
  );
}
