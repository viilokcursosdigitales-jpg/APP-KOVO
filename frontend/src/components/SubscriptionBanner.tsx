import { ds } from '../design-system/ds';

const HOTMART_PAYMENT_URL = 'https://pay.hotmart.com/Y105356879N?bid=1776043385569';

export type SubscriptionStatusPayload = {
  status: 'trial' | 'active' | 'expired';
  daysLeft: number;
  trialEndsAt: string | null;
  subscriptionExpiresAt: string | null;
  canAccess: boolean;
};

type SubscriptionBannerProps = {
  subscription: SubscriptionStatusPayload | null;
  userEmail?: string | null;
};

function paymentButtonLabel(subscription: SubscriptionStatusPayload): string {
  if (subscription.status === 'active') return 'Renovar plan';
  return 'Activar plan Pro';
}

function openPayment() {
  window.open(HOTMART_PAYMENT_URL, '_blank', 'noopener,noreferrer');
}

export default function SubscriptionBanner({ subscription, userEmail }: SubscriptionBannerProps) {
  if (String(userEmail || '').trim().toLowerCase() === 'cavimo25@gmail.com') return null;
  if (!subscription) return null;

  const isUrgentTrial = subscription.status === 'trial' && subscription.daysLeft <= 2;
  const showExpiringActive = subscription.status === 'active' && subscription.daysLeft < 5;
  const isExpired = subscription.status === 'expired' || !subscription.canAccess;

  if (!isExpired && subscription.status === 'active' && !showExpiringActive) {
    return null;
  }

  if (isExpired) {
    return (
      <div
        style={{
          background: '#b91c1c',
          color: '#fff',
          borderRadius: 10,
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          Tu período de prueba ha terminado. Activa tu plan para continuar.
        </div>
        <button
          type="button"
          onClick={openPayment}
          style={{
            border: 'none',
            borderRadius: 8,
            padding: '8px 14px',
            fontSize: 13,
            fontWeight: 700,
            background: '#fff',
            color: '#991b1b',
            cursor: 'pointer',
          }}
        >
          Activar plan Pro
        </button>
      </div>
    );
  }

  let background = '#fef3c7';
  let border = '#f59e0b';
  let text = '#92400e';
  let message = '';

  if (subscription.status === 'trial') {
    if (isUrgentTrial) {
      background = '#fee2e2';
      border = '#ef4444';
      text = '#991b1b';
    }
    message = `Tienes ${subscription.daysLeft} días de prueba gratuita restantes`;
  } else if (showExpiringActive) {
    message = `Tu plan vence en ${subscription.daysLeft} días`;
  }

  return (
    <div
      style={{
        background,
        border: `1px solid ${border}`,
        color: text,
        borderRadius: 10,
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600 }}>{message}</div>
      <button
        type="button"
        onClick={openPayment}
        style={{
          border: 'none',
          borderRadius: 8,
          padding: '8px 14px',
          fontSize: 13,
          fontWeight: 700,
          background: ds.brand,
          color: ds.textOnBrand,
          cursor: 'pointer',
        }}
      >
        {paymentButtonLabel(subscription)}
      </button>
    </div>
  );
}
