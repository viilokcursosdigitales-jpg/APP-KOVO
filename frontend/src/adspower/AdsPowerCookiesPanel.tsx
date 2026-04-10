import { useState } from 'react';
import { getBrowserCookieCount } from '../utils/cookies';

const META_BLUE = '#1877f2';
const SHOPIFY_GREEN = '#96bf48';
const CARD_BG = '#ffffff';
const SIDEBAR_TONE = '#1a1a2e';

export default function AdsPowerCookiesPanel() {
  const [cookiesCount, setCookiesCount] = useState<number | null>(null);

  const handleGetCookies = () => {
    const totalCookies = getBrowserCookieCount();
    setCookiesCount(totalCookies);
  };

  return (
    <div
      style={{
        background: CARD_BG,
        borderRadius: 14,
        padding: '24px 26px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        maxWidth: 640,
        border: '1px solid #e8eaef',
      }}
    >
      <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: SIDEBAR_TONE }}>
        AdsPower — cookies del navegador
      </h2>
      <p style={{ margin: '0 0 18px', fontSize: 14, color: '#6b7280', lineHeight: 1.5 }}>
        El conteo se hace en el propio navegador con <code>document.cookie</code>: solo ves cookies del{' '}
        <strong>mismo origen</strong> que esta app (no HttpOnly ni otros dominios). No se llama a ninguna API de
        AdsPower ni al backend.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <button
          type="button"
          onClick={handleGetCookies}
          style={{
            padding: '10px 18px',
            borderRadius: 10,
            border: 'none',
            background: SHOPIFY_GREEN,
            color: '#1a1a2e',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          Obtener total de cookies
        </button>
        {cookiesCount !== null ? (
          <span style={{ fontSize: 16, color: '#374151' }}>
            Total de cookies:{' '}
            <strong style={{ fontSize: 20, fontWeight: 800, color: META_BLUE }}>{cookiesCount}</strong>
          </span>
        ) : (
          <span style={{ fontSize: 14, color: '#9ca3af' }}>Pulsa el botón para calcular el total.</span>
        )}
      </div>
    </div>
  );
}
