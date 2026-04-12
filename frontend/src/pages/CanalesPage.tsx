import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';
import { IconMegaphone } from '../design-system/icons';
import { PageHeader } from '../design-system/PageHeader';
import { StatusBadge } from '../design-system/StatusBadge';

type ShopifyConnection = {
  status: string;
  shop_domain: string | null;
  scope: string | null;
  installed_at: string | null;
};

function ShopifyGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M16.5 8.5c-1.1 0-2 .9-2 2v5M12 6.5v9M8.5 8.5c-1.1 0-2 .9-2 2v5M6 4.5h12v15H6z"
        stroke="#95BF47"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function CanalesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [shopDomainInput, setShopDomainInput] = useState('');
  const [shopifyConn, setShopifyConn] = useState<ShopifyConnection | null>(null);
  const [shopifyLoading, setShopifyLoading] = useState(true);
  const [shopifyActionLoading, setShopifyActionLoading] = useState(false);
  const [shopifyFormError, setShopifyFormError] = useState('');

  const urlShopifyFlag = searchParams.get('shopify');

  const loadShopifyConnection = useCallback(async () => {
    setShopifyLoading(true);
    try {
      const res = await apiFetch('/api/shopify/connection');
      if (!res.ok) {
        setShopifyConn(null);
        return;
      }
      const data = (await res.json()) as ShopifyConnection;
      setShopifyConn(data);
    } catch {
      setShopifyConn(null);
    } finally {
      setShopifyLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadShopifyConnection();
  }, [loadShopifyConnection]);

  useEffect(() => {
    if (urlShopifyFlag === 'connected' || urlShopifyFlag === 'error') {
      void loadShopifyConnection();
    }
  }, [urlShopifyFlag, loadShopifyConnection]);

  const clearShopifyQuery = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('shopify');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const shopifyConnected = shopifyConn?.status === 'connected' && Boolean(shopifyConn.shop_domain);

  const handleConnectShopify = async () => {
    const trimmed = shopDomainInput.trim().toLowerCase();
    if (!trimmed.endsWith('.myshopify.com')) {
      setShopifyFormError('El dominio debe terminar en .myshopify.com');
      return;
    }
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(trimmed)) {
      setShopifyFormError('Formato de tienda no válido');
      return;
    }
    setShopifyFormError('');
    setShopifyActionLoading(true);
    try {
      const res = await apiFetch(`/api/shopify/auth?shop=${encodeURIComponent(trimmed)}`, {
        headers: { Accept: 'application/json' },
      });
      const data = (await res.json().catch(() => ({}))) as { authorizeUrl?: string; error?: string };
      if (!res.ok) {
        setShopifyFormError(typeof data.error === 'string' ? data.error : 'No se pudo iniciar la conexión');
        return;
      }
      if (data.authorizeUrl) {
        window.location.href = data.authorizeUrl;
        return;
      }
      setShopifyFormError('Respuesta inesperada del servidor');
    } catch {
      setShopifyFormError('Error de red');
    } finally {
      setShopifyActionLoading(false);
    }
  };

  const handleDisconnectShopify = async () => {
    setShopifyActionLoading(true);
    try {
      const res = await apiFetch('/api/shopify/connection', { method: 'DELETE' });
      if (res.ok) {
        await loadShopifyConnection();
      }
    } finally {
      setShopifyActionLoading(false);
    }
  };

  return (
    <>
      <PageHeader title="Canales" subtitle="Integraciones con tiendas y plataformas de marketing." />

      {urlShopifyFlag === 'error' && (
        <div
          style={{
            marginBottom: 16,
            padding: '14px 18px',
            borderRadius: 14,
            border: `1px solid ${ds.borderCard}`,
            background: ds.dangerBg,
            color: ds.dangerText,
            fontSize: 13,
            maxWidth: 720,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>No pudimos conectar tu tienda</div>
          <p style={{ margin: 0, lineHeight: 1.45 }}>
            Revisa que la app Shopify tenga el mismo App URL y redirect que en producción, e inténtalo de nuevo.
          </p>
          <button
            type="button"
            onClick={() => {
              clearShopifyQuery();
              navigate('/canales', { replace: true });
            }}
            style={{
              marginTop: 12,
              padding: '8px 16px',
              borderRadius: 8,
              border: `1px solid ${ds.dangerText}`,
              background: ds.bgCard,
              color: ds.dangerText,
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Reintentar
          </button>
        </div>
      )}

      {urlShopifyFlag === 'connected' && (
        <div
          style={{
            marginBottom: 16,
            padding: '12px 16px',
            borderRadius: 14,
            border: `1px solid ${ds.borderCard}`,
            background: ds.successBg,
            color: ds.successText,
            fontSize: 13,
            maxWidth: 720,
          }}
        >
          Tienda Shopify vinculada correctamente.
          <button
            type="button"
            onClick={() => clearShopifyQuery()}
            style={{
              marginLeft: 12,
              border: 'none',
              background: 'transparent',
              color: ds.successText,
              textDecoration: 'underline',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Cerrar
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        <div
          style={{
            background: ds.bgCard,
            border: `1px solid ${ds.borderCard}`,
            borderRadius: 14,
            padding: '18px 20px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 9,
                background: ds.brandBg,
                color: ds.brand,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <IconMegaphone />
            </div>
            <StatusBadge variant="success">Conectado</StatusBadge>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary }}>Meta Ads</div>
          <div style={{ fontSize: 11, color: ds.textMuted, marginTop: 6, lineHeight: 1.45 }}>
            Campañas y embudo desde el módulo Meta Ads.
          </div>
          <Link
            to="/meta-ads"
            style={{
              display: 'inline-block',
              marginTop: 14,
              fontSize: 12,
              fontWeight: 600,
              color: ds.brand,
              textDecoration: 'none',
            }}
          >
            Gestionar en Meta Ads →
          </Link>
        </div>

        <div
          style={{
            background: ds.bgCard,
            border: `1px solid ${ds.borderCard}`,
            borderRadius: 14,
            padding: '18px 20px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 9,
                background: ds.bgSubtle,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ShopifyGlyph />
            </div>
            {shopifyLoading ? (
              <span style={{ fontSize: 12, color: ds.textMuted }}>…</span>
            ) : shopifyConnected ? (
              <StatusBadge variant="success">Conectado</StatusBadge>
            ) : (
              <StatusBadge variant="paused">No conectado</StatusBadge>
            )}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary }}>Shopify</div>
          <div style={{ fontSize: 11, color: ds.textMuted, marginTop: 6, lineHeight: 1.45 }}>
            Conecta tu tienda para ver pedidos e inventario en KOVO (OAuth, sin pegar tokens).
          </div>

          {!shopifyLoading && shopifyConnected && shopifyConn ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, color: ds.textSecondary, fontWeight: 600 }}>{shopifyConn.shop_domain}</div>
              {shopifyConn.installed_at ? (
                <div style={{ fontSize: 11, color: ds.textHint, marginTop: 4 }}>
                  Instalado: {new Date(shopifyConn.installed_at).toLocaleString('es-ES')}
                </div>
              ) : null}
              <button
                type="button"
                disabled={shopifyActionLoading}
                onClick={() => void handleDisconnectShopify()}
                style={{
                  marginTop: 14,
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: `1px solid ${ds.borderCard}`,
                  background: ds.dangerBg,
                  color: ds.dangerText,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: shopifyActionLoading ? 'wait' : 'pointer',
                }}
              >
                Desconectar
              </button>
            </div>
          ) : !shopifyLoading ? (
            <div style={{ marginTop: 14 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: ds.textSecondary, marginBottom: 6 }}>
                Dominio de tu tienda
              </label>
              <input
                type="text"
                value={shopDomainInput}
                onChange={(e) => setShopDomainInput(e.target.value)}
                placeholder="mitienda.myshopify.com"
                autoComplete="off"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: `1px solid ${ds.borderCard}`,
                  fontSize: 13,
                  color: ds.textPrimary,
                  background: ds.bgCard,
                  marginBottom: 8,
                }}
              />
              {shopifyFormError ? (
                <div style={{ fontSize: 12, color: ds.dangerText, marginBottom: 8 }}>{shopifyFormError}</div>
              ) : null}
              <button
                type="button"
                disabled={shopifyActionLoading}
                onClick={() => void handleConnectShopify()}
                style={{
                  width: '100%',
                  padding: '8px 18px',
                  borderRadius: 8,
                  border: 'none',
                  background: ds.brand,
                  color: '#ffffff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: shopifyActionLoading ? 'wait' : 'pointer',
                }}
              >
                {shopifyActionLoading ? 'Abriendo Shopify…' : 'Conectar Shopify'}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
