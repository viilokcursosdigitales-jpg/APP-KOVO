import { useAuth } from '../auth/AuthContext';
import { ds } from '../design-system/ds';

const CHECKOUT_URL = (import.meta.env.VITE_HOTMART_CHECKOUT_URL || '').trim();

/**
 * CTA Hotmart: upgrade si el plan es free; badge si ya es Pro (u Enterprise).
 */
export function UpgradeButton() {
  const { organization } = useAuth();
  if (!organization) return null;

  if (organization.plan === 'free') {
    const disabled = !CHECKOUT_URL;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
        <button
          type="button"
          disabled={disabled}
          title={disabled ? 'Falta VITE_HOTMART_CHECKOUT_URL en el entorno del frontend' : undefined}
          onClick={() => {
            if (!CHECKOUT_URL) return;
            window.open(CHECKOUT_URL, '_blank', 'noopener,noreferrer');
          }}
          style={{
            padding: '10px 18px',
            borderRadius: 10,
            border: 'none',
            background: disabled ? ds.borderCard : ds.brand,
            color: disabled ? ds.textMuted : '#fff',
            fontWeight: 700,
            fontSize: 14,
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        >
          Pasar a plan Pro
        </button>
        {disabled ? (
          <span style={{ fontSize: 11, color: ds.textHint }}>
            Define <code style={{ fontSize: 10 }}>VITE_HOTMART_CHECKOUT_URL</code> para abrir la página de pago.
          </span>
        ) : null}
      </div>
    );
  }

  if (organization.plan === 'pro') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '8px 14px',
          borderRadius: 10,
          background: '#dcfce7',
          color: '#14532d',
          fontWeight: 700,
          fontSize: 13,
          border: '1px solid #86efac',
        }}
      >
        Plan Pro ✓
      </span>
    );
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '8px 14px',
        borderRadius: 10,
        background: '#e0e7ff',
        color: '#312e81',
        fontWeight: 700,
        fontSize: 13,
        border: '1px solid #a5b4fc',
      }}
    >
      Plan Enterprise ✓
    </span>
  );
}
