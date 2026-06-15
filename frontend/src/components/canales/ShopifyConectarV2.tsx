import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../../auth/api';
import { useAuth } from '../../auth/AuthContext';
import { ds } from '../../design-system/ds';
import { StatusBadge } from '../../design-system/StatusBadge';

type ShopifyV2Estado = {
  conectado: boolean;
  shopDomain: string | null;
  status: string | null;
  connectedAt: string | null;
};

function normalizeShopDomain(raw: string) {
  const shop = raw.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  if (!shop.endsWith('.myshopify.com')) {
    return { ok: false as const, error: 'El dominio debe terminar en .myshopify.com' };
  }
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    return { ok: false as const, error: 'Formato de tienda no válido' };
  }
  return { ok: true as const, shop };
}

export default function ShopifyConectarV2() {
  const { canManageOrg } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [estado, setEstado] = useState<ShopifyV2Estado | null>(null);
  const [loadingEstado, setLoadingEstado] = useState(true);
  const [shopDomainInput, setShopDomainInput] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiSecretInput, setApiSecretInput] = useState('');
  const [domainError, setDomainError] = useState('');
  const [connectLoading, setConnectLoading] = useState(false);
  const [toast, setToast] = useState<{ type: 'error' | 'success'; message: string } | null>(null);
  const [visualDisconnected, setVisualDisconnected] = useState(false);
  const skipLoadAfterOAuthCleanupRef = useRef(false);

  const loadEstado = useCallback(async (opts?: { force?: boolean }) => {
    setLoadingEstado(true);
    try {
      const path = opts?.force
        ? `/api/shopify-v2/estado?_=${Date.now()}`
        : '/api/shopify-v2/estado';
      const res = await apiFetch(path);
      if (!res.ok) {
        setEstado(null);
        return;
      }
      const data = (await res.json()) as ShopifyV2Estado;
      setEstado(data);
      setVisualDisconnected(false);
      if (data.shopDomain) {
        setShopDomainInput(data.shopDomain);
      }
    } catch {
      setEstado(null);
    } finally {
      setLoadingEstado(false);
    }
  }, []);

  useEffect(() => {
    if (skipLoadAfterOAuthCleanupRef.current) {
      skipLoadAfterOAuthCleanupRef.current = false;
      return;
    }

    const flag = searchParams.get('shopify');
    const isOAuthReturn = flag === 'conectado' || flag === 'error';

    if (isOAuthReturn) {
      void loadEstado({ force: true });
      if (flag === 'conectado') {
        setToast({ type: 'success', message: 'Shopify conectado correctamente.' });
      } else {
        setToast({ type: 'error', message: 'No se pudo completar la conexión con Shopify.' });
      }
      skipLoadAfterOAuthCleanupRef.current = true;
      const next = new URLSearchParams(searchParams);
      next.delete('shopify');
      setSearchParams(next, { replace: true });
      return;
    }

    void loadEstado();
  }, [loadEstado, searchParams, setSearchParams]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const conectado = Boolean(estado?.conectado) && !visualDisconnected;

  const handleConnect = async () => {
    setDomainError('');
    setToast(null);
    if (!canManageOrg) {
      setToast({ type: 'error', message: 'Solo un administrador u owner puede conectar Shopify.' });
      return;
    }
    const parsed = normalizeShopDomain(shopDomainInput);
    if (!parsed.ok) {
      setDomainError(parsed.error);
      return;
    }
    if (!apiKeyInput.trim()) {
      setToast({ type: 'error', message: 'Introduce el Client ID de tu app.' });
      return;
    }
    if (!apiSecretInput.trim()) {
      setToast({ type: 'error', message: 'Introduce el Client Secret de tu app.' });
      return;
    }

    setConnectLoading(true);
    try {
      const res = await apiFetch('/api/shopify-v2/iniciar-conexion', {
        method: 'POST',
        body: JSON.stringify({
          shopDomain: parsed.shop,
          apiKey: apiKeyInput.trim(),
          apiSecret: apiSecretInput.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { authUrl?: string; error?: string };
      if (!res.ok || !data.authUrl) {
        setToast({ type: 'error', message: data.error || 'No se pudo iniciar la conexión con Shopify.' });
        return;
      }
      window.location.href = data.authUrl;
    } catch {
      setToast({ type: 'error', message: 'Error de red. Inténtalo de nuevo.' });
    } finally {
      setConnectLoading(false);
    }
  };

  return (
    <div
      style={{
        marginTop: 24,
        background: ds.bgCard,
        border: `1px solid ${ds.borderCard}`,
        borderRadius: 14,
        padding: '18px 20px',
        maxWidth: 640,
      }}
    >
      {toast ? (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            borderRadius: 10,
            fontSize: 13,
            lineHeight: 1.45,
            background: toast.type === 'error' ? ds.dangerBg : ds.successBg,
            color: toast.type === 'error' ? ds.dangerText : ds.successText,
            border: `1px solid ${ds.borderCard}`,
          }}
        >
          {toast.message}
        </div>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary }}>Shopify — conexión con tu app</div>
        {loadingEstado ? (
          <span style={{ fontSize: 12, color: ds.textMuted }}>…</span>
        ) : conectado ? (
          <StatusBadge variant="success">Shopify conectado</StatusBadge>
        ) : (
          <StatusBadge variant="paused">No conectado</StatusBadge>
        )}
      </div>

      {loadingEstado ? (
        <p style={{ margin: 0, fontSize: 12, color: ds.textMuted }}>Cargando estado…</p>
      ) : conectado && estado ? (
        <div>
          <div style={{ fontSize: 12, color: ds.textSecondary, fontWeight: 600 }}>{estado.shopDomain}</div>
          {estado.connectedAt ? (
            <div style={{ fontSize: 11, color: ds.textHint, marginTop: 4 }}>
              Conectado: {new Date(estado.connectedAt).toLocaleString('es-ES')}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setVisualDisconnected(true)}
            style={{
              marginTop: 14,
              padding: '8px 14px',
              borderRadius: 8,
              border: `1px solid ${ds.borderCard}`,
              background: ds.dangerBg,
              color: ds.dangerText,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Desconectar
          </button>
        </div>
      ) : (
        <div>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600, color: ds.textPrimary }}>
            Conectar tu tienda Shopify
          </h3>

          {!canManageOrg ? (
            <p style={{ margin: 0, fontSize: 12, color: ds.textMuted, lineHeight: 1.5 }}>
              Solo un administrador u owner de la organización puede conectar Shopify.
            </p>
          ) : (
            <>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: ds.textSecondary, marginBottom: 6 }}>
                URL de tu tienda
              </label>
              <input
                type="text"
                value={shopDomainInput}
                onChange={(e) => {
                  setShopDomainInput(e.target.value);
                  setDomainError('');
                }}
                placeholder="mitienda.myshopify.com"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: `1px solid ${domainError ? ds.dangerText : ds.borderCard}`,
                  fontSize: 13,
                  color: ds.textPrimary,
                  background: ds.bgCard,
                  marginBottom: domainError ? 6 : 12,
                }}
              />
              {domainError ? (
                <div style={{ fontSize: 12, color: ds.dangerText, marginBottom: 12 }}>{domainError}</div>
              ) : null}

              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: ds.textSecondary, marginBottom: 6 }}>
                Client ID (de tu app en Shopify Partners)
              </label>
              <input
                type="text"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="Client ID"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: `1px solid ${ds.borderCard}`,
                  fontSize: 13,
                  color: ds.textPrimary,
                  background: ds.bgCard,
                  marginBottom: 12,
                  fontFamily: 'ui-monospace, monospace',
                }}
              />

              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: ds.textSecondary, marginBottom: 6 }}>
                Client Secret
              </label>
              <input
                type="password"
                value={apiSecretInput}
                onChange={(e) => setApiSecretInput(e.target.value)}
                placeholder="Client Secret"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: `1px solid ${ds.borderCard}`,
                  fontSize: 13,
                  color: ds.textPrimary,
                  background: ds.bgCard,
                  marginBottom: 12,
                  fontFamily: 'ui-monospace, monospace',
                }}
              />

              <button
                type="button"
                disabled={connectLoading}
                onClick={() => void handleConnect()}
                style={{
                  padding: '10px 18px',
                  borderRadius: 8,
                  border: 'none',
                  background: ds.brand,
                  color: '#ffffff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: connectLoading ? 'wait' : 'pointer',
                }}
              >
                {connectLoading ? 'Conectando…' : 'Conectar con Shopify'}
              </button>

              <p style={{ margin: '12px 0 0', fontSize: 11, color: ds.textHint, lineHeight: 1.45 }}>
                ¿No tienes una app? Sigue la guía de conexión que te enviamos.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
