import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch, getStoredToken } from '../auth/api';
import { useAuth } from '../auth/AuthContext';
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

const step1Items = [
  'En Shopify Admin: Configuración → Apps y canales de ventas → Desarrollar apps → crea una app o abre la que usarás con KOVO (puedes llamarla KOVO).',
  'Abre el Dev Dashboard de esa app. En Configuration / Configuración → Client credentials encontrarás el Client ID (Shopify también lo llama API key) y el Client secret.',
  'En Admin API integration / Configuración de la API de Admin activa los alcances que necesites (pedidos, productos, inventario, clientes, analytics, fulfillments, locations, informes, envíos — lectura y/o escritura según tu caso) y guarda.',
  'Instala la app en tu tienda si Shopify muestra "Install app" / "Instalar app" (así quedan aplicados los permisos).',
  'Si no ves el Client secret completo, puedes revelarlo una vez o usar "Rotate" para generar uno nuevo y copiarlo en ese momento.',
];

export default function CanalesPage() {
  const navigate = useNavigate();
  const { organization, canManageOrg } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [shopifyPanelOpen, setShopifyPanelOpen] = useState(false);
  const [shopDomainInput, setShopDomainInput] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiSecretInput, setApiSecretInput] = useState('');
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

  const handleConnectCredentials = async () => {
    if (!canManageOrg) {
      setShopifyFormError('Solo un administrador u owner de la organización puede conectar Shopify.');
      return;
    }
    const shop = shopDomainInput.trim().toLowerCase();
    if (!shop.endsWith('.myshopify.com')) {
      setShopifyFormError('El dominio debe terminar en .myshopify.com');
      return;
    }
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
      setShopifyFormError('Formato de tienda no válido');
      return;
    }
    const apiKey = apiKeyInput.trim();
    const apiSecret = apiSecretInput.trim();
    if (!apiKey) {
      setShopifyFormError('Introduce el Client ID (API key) de tu app.');
      return;
    }
    if (!apiSecret) {
      setShopifyFormError('Introduce el Client secret de tu app.');
      return;
    }
    if (!getStoredToken()) {
      setShopifyFormError('Inicia sesión para conectar Shopify.');
      navigate('/login');
      return;
    }
    const orgId = organization?.id;
    if (orgId == null) {
      setShopifyFormError('No se pudo obtener tu organización. Vuelve a iniciar sesión.');
      return;
    }

    setShopifyFormError('');
    setShopifyActionLoading(true);
    try {
      const res = await apiFetch('/api/shopify/connect-credentials', {
        method: 'POST',
        body: JSON.stringify({
          shop,
          apiKey,
          apiSecret,
          organizationId: orgId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        const msg =
          data.error ||
          data.message ||
          (res.status === 403
            ? 'No tienes permiso para conectar (se requiere administrador u owner).'
            : res.status === 400
              ? 'Shopify rechazó las credenciales o el dominio no coincide. Revisa Client ID, Client secret e instalación de la app.'
              : 'No se pudo conectar. Inténtalo de nuevo.');
        setShopifyFormError(msg);
        return;
      }
      setApiKeyInput('');
      setApiSecretInput('');
      setShopifyPanelOpen(false);
      await loadShopifyConnection();
    } catch {
      setShopifyFormError('Error de red. Comprueba tu conexión e inténtalo de nuevo.');
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
            Revisa el dominio .myshopify.com, el Client ID y el Client secret del Dev Dashboard, que la app esté instalada en la tienda y los permisos de Admin API, e inténtalo de nuevo.
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
            Cerrar aviso
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
          <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary }}>Anuncios Meta</div>
          <div style={{ fontSize: 11, color: ds.textMuted, marginTop: 6, lineHeight: 1.45 }}>
            Campañas y embudo desde el módulo Anuncios Meta.
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
            Gestionar en Anuncios Meta →
          </Link>
        </div>

        <div
          style={{
            background: ds.bgCard,
            border: `1px solid ${ds.borderCard}`,
            borderRadius: 14,
            padding: '18px 20px',
            gridColumn: '1 / -1',
            maxWidth: 640,
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
            Usa tu propia app en el Dev Dashboard de Shopify: pegas el dominio de la tienda y las credenciales Client ID +
            Client secret. KOVO valida la conexión con Shopify automáticamente.
          </div>

          {!shopifyLoading && shopifyConnected && shopifyConn ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, color: ds.textSecondary, fontWeight: 600 }}>{shopifyConn.shop_domain}</div>
              {shopifyConn.installed_at ? (
                <div style={{ fontSize: 11, color: ds.textHint, marginTop: 4 }}>
                  Conectado: {new Date(shopifyConn.installed_at).toLocaleString('es-ES')}
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
              {!canManageOrg ? (
                <p style={{ margin: 0, fontSize: 12, color: ds.textMuted, lineHeight: 1.5 }}>
                  Solo un administrador u owner de la organización puede conectar o desconectar Shopify.
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setShopifyFormError('');
                      setShopifyPanelOpen((o) => !o);
                    }}
                    style={{
                      padding: '10px 18px',
                      borderRadius: 8,
                      border: 'none',
                      background: ds.brand,
                      color: '#ffffff',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {shopifyPanelOpen ? 'Ocultar pasos' : 'Conectar Shopify'}
                  </button>

                  {shopifyPanelOpen ? (
                    <div
                      style={{
                        marginTop: 18,
                        paddingTop: 18,
                        borderTop: `1px solid ${ds.borderCard}`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 20,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: ds.textPrimary,
                            marginBottom: 10,
                            letterSpacing: 0.2,
                          }}
                        >
                          Paso 1 — Crear tu app en Shopify
                        </div>
                        <ol
                          style={{
                            margin: 0,
                            paddingLeft: 18,
                            fontSize: 12,
                            color: ds.textSecondary,
                            lineHeight: 1.55,
                          }}
                        >
                          {step1Items.map((line) => (
                            <li key={line} style={{ marginBottom: 6 }}>
                              {line}
                            </li>
                          ))}
                        </ol>
                      </div>

                      <div>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: ds.textPrimary,
                            marginBottom: 10,
                            letterSpacing: 0.2,
                          }}
                        >
                          Paso 2 — Conectar con Kovo
                        </div>
                        <p style={{ margin: '0 0 12px', fontSize: 11, color: ds.textMuted, lineHeight: 1.5 }}>
                          Usa el mismo dominio que aparece en la URL de administración de Shopify (formato{' '}
                          <strong>tu-tienda.myshopify.com</strong>). Lo encuentras también en Configuración → Tienda →
                          Dominios.
                        </p>
                        <label
                          style={{ display: 'block', fontSize: 12, fontWeight: 500, color: ds.textSecondary, marginBottom: 6 }}
                        >
                          Dominio de tu tienda
                        </label>
                        <input
                          type="text"
                          value={shopDomainInput}
                          onChange={(e) => setShopDomainInput(e.target.value)}
                          placeholder="mitienda.myshopify.com"
                          autoComplete="off"
                          spellCheck={false}
                          style={{
                            width: '100%',
                            maxWidth: 400,
                            boxSizing: 'border-box',
                            padding: '8px 12px',
                            borderRadius: 8,
                            border: `1px solid ${ds.borderCard}`,
                            fontSize: 13,
                            color: ds.textPrimary,
                            background: ds.bgCard,
                            marginBottom: 12,
                          }}
                        />
                        <label
                          style={{ display: 'block', fontSize: 12, fontWeight: 500, color: ds.textSecondary, marginBottom: 6 }}
                        >
                          API Key (Client ID)
                        </label>
                        <p style={{ margin: '0 0 6px', fontSize: 11, color: ds.textHint, lineHeight: 1.45 }}>
                          En el Dev Dashboard de tu app: <strong>Configuration</strong> → <strong>Client credentials</strong>{' '}
                          → <strong>Client ID</strong> (Shopify puede mostrarlo como API key).
                        </p>
                        <input
                          type="text"
                          value={apiKeyInput}
                          onChange={(e) => setApiKeyInput(e.target.value)}
                          placeholder="Client ID de tu app"
                          autoComplete="off"
                          spellCheck={false}
                          style={{
                            width: '100%',
                            maxWidth: 400,
                            boxSizing: 'border-box',
                            padding: '8px 12px',
                            borderRadius: 8,
                            border: `1px solid ${ds.borderCard}`,
                            fontSize: 13,
                            color: ds.textPrimary,
                            background: ds.bgCard,
                            fontFamily: 'ui-monospace, monospace',
                            marginBottom: 12,
                          }}
                        />
                        <label
                          style={{ display: 'block', fontSize: 12, fontWeight: 500, color: ds.textSecondary, marginBottom: 6 }}
                        >
                          API Secret (Client secret)
                        </label>
                        <p style={{ margin: '0 0 6px', fontSize: 11, color: ds.textHint, lineHeight: 1.45 }}>
                          Mismo apartado <strong>Client credentials</strong>: <strong>Client secret</strong>. Es
                          confidencial; no lo compartas fuera de KOVO.
                        </p>
                        <input
                          type="password"
                          value={apiSecretInput}
                          onChange={(e) => setApiSecretInput(e.target.value)}
                          placeholder="Client secret"
                          autoComplete="off"
                          spellCheck={false}
                          style={{
                            width: '100%',
                            maxWidth: 400,
                            boxSizing: 'border-box',
                            padding: '8px 12px',
                            borderRadius: 8,
                            border: `1px solid ${ds.borderCard}`,
                            fontSize: 13,
                            color: ds.textPrimary,
                            background: ds.bgCard,
                            fontFamily: 'ui-monospace, monospace',
                            marginBottom: 8,
                          }}
                        />
                        {shopifyFormError ? (
                          <div
                            style={{
                              fontSize: 12,
                              color: ds.dangerText,
                              marginBottom: 8,
                              lineHeight: 1.45,
                              whiteSpace: 'pre-line',
                            }}
                          >
                            {shopifyFormError}
                          </div>
                        ) : null}
                        <button
                          type="button"
                          disabled={shopifyActionLoading}
                          onClick={() => void handleConnectCredentials()}
                          style={{
                            marginTop: 4,
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
                          {shopifyActionLoading ? 'Conectando…' : 'Conectar'}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
