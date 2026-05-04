import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from './auth/api';
import { useAuth } from './auth/AuthContext';
import { alpha, ds } from './design-system/ds';
import { KOVO_META_CONNECTION_EVENT } from './meta/useMetaInsightsReady';

const DEVELOPERS_URL = 'https://developers.facebook.com';

function notifyMetaDashboardRefresh() {
  window.dispatchEvent(new Event(KOVO_META_CONNECTION_EVENT));
}

export type MetaConnectionErrorCode =
  | 'invalid_credentials'
  | 'token_expired'
  | 'permissions'
  | 'network'
  | 'unknown';

type FlowStep = 'home' | 'guide' | 'form' | 'accounts' | 'edit_accounts' | 'success' | 'error';

type AdAccountOption = {
  id: string;
  name: string;
  account_status?: number;
  currency?: string;
};

type SavedConnection = {
  connectionId: number;
  accountName: string;
  connectedAt: string;
  appIdHint: string;
  selectedAdAccountIds: string[];
  insightsReady: boolean;
};

export function messageForErrorCode(code: MetaConnectionErrorCode): string {
  switch (code) {
    case 'invalid_credentials':
      return 'El App ID o App Secret son incorrectos';
    case 'token_expired':
      return 'El Access Token ha expirado, genera uno nuevo';
    case 'permissions':
      return 'Tu app no tiene los permisos necesarios de Meta';
    case 'network':
      return 'No se pudo conectar, verifica tu internet';
    default:
      return 'Algo salió mal. Inténtalo de nuevo en unos minutos';
  }
}

function FieldTooltip({ id, text }: { id: string; text: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-flex', marginLeft: 6 }}>
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          border: `1px solid ${alpha.brand35}`,
          background: alpha.brand12,
          color: ds.brand,
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 700,
          lineHeight: 1,
          padding: 0,
          flexShrink: 0,
        }}
        aria-label="Más información"
      >
        i
      </button>
      {open && (
        <div
          id={id}
          role="tooltip"
          style={{
            position: 'absolute',
            left: 0,
            top: 'calc(100% + 8px)',
            zIndex: 20,
            width: 'min(320px, calc(100vw - 48px))',
            padding: '12px 14px',
            background: ds.textPrimary,
            color: ds.borderCard,
            fontSize: 13,
            lineHeight: 1.45,
            borderRadius: 10,
            fontWeight: 400,
          }}
        >
          {text}
        </div>
      )}
    </span>
  );
}

function Spinner() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 18,
        height: 18,
        border: '2px solid #fff6',
        borderTopColor: '#fff',
        borderRadius: '50%',
        animation: 'conexionMetaSpin 0.7s linear infinite',
        verticalAlign: 'middle',
        marginRight: 8,
      }}
    />
  );
}

function StatusBadge({
  status,
}: {
  status: 'disconnected' | 'loading' | 'connected' | 'error';
}) {
  const map = {
    disconnected: { label: 'Sin conectar', bg: ds.bgSubtle, color: ds.textSecondary, dot: ds.textHint },
    loading: { label: 'Conectando…', bg: alpha.brand18, color: ds.brand, dot: ds.brand },
    connected: { label: 'Conectado', bg: alpha.success15, color: ds.successText, dot: ds.successText },
    error: { label: 'Error', bg: ds.dangerBg, color: ds.dangerText, dot: ds.dangerText },
  }[status];

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 14px',
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 600,
        background: map.bg,
        color: map.color,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: map.dot,
          ...(status === 'loading'
            ? { animation: 'conexionMetaPulse 1s ease-in-out infinite' }
            : {}),
        }}
      />
      {map.label}
    </span>
  );
}

function CheckAnimated() {
  return (
    <div
      style={{
        width: 72,
        height: 72,
        borderRadius: '50%',
        background: alpha.success15,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'conexionMetaPop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}
    >
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M5 12.5l5.5 5.5L19 7"
          stroke={ds.successText}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            strokeDasharray: 32,
            strokeDashoffset: 32,
            animation: 'conexionMetaDraw 0.5s ease forwards 0.15s',
          }}
        />
      </svg>
    </div>
  );
}

const GUIDE_STEPS: { title: string; body: string }[] = [
  {
    title: 'Crea tu cuenta de desarrollador',
    body: `Entra en Facebook Developers y regístrate o inicia sesión con tu cuenta de Facebook. Así tendrás tu propio espacio para gestionar apps.`,
  },
  {
    title: 'Crea una nueva app',
    body: `En el panel, elige crear una app nueva y sigue el asistente. Es la app que Meta usará para identificar tu integración.`,
  },
  {
    title: 'Copia App ID y App Secret',
    body: `En Configuración → Básico encontrarás el identificador de la app (App ID) y el secreto (App Secret). Guárdalos en un lugar seguro.`,
  },
  {
    title: 'Token y cuentas publicitarias',
    body: `Genera un token de usuario con permisos ads_read (y de gestión si aplica) en Graph API Explorer o tu flujo OAuth. En KOVO podrás elegir qué cuentas publicitarias (act_) sincronizar para ver campañas, conjuntos y anuncios en tiempo real.`,
  },
];

function formatConnectedDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-ES', {
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function ConexionMetaADS() {
  const { refreshUser } = useAuth();
  const baseId = useId();
  const [saved, setSaved] = useState<SavedConnection | null>(null);
  const [step, setStep] = useState<FlowStep>('home');
  const [bootstrapLoading, setBootstrapLoading] = useState(true);

  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [accessToken, setAccessToken] = useState('');

  const [fieldErrors, setFieldErrors] = useState<{ appId?: string; appSecret?: string }>({});
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<MetaConnectionErrorCode | null>(null);

  const [adAccounts, setAdAccounts] = useState<AdAccountOption[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showTokenReconnectBanner, setShowTokenReconnectBanner] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/meta/connections');
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as {
          connections: Array<{
            id: number;
            status: string;
            account_name: string;
            connected_at: string;
            app_id_hint: string;
            selected_ad_account_ids?: string[];
            insights_ready?: boolean;
            disconnect_reason?: string | null;
            token_type?: string;
          }>;
        };
        const hasConnected = data.connections.some((x) => x.status === 'connected');
        const tokenFail = data.connections.some((x) => x.disconnect_reason === 'token_refresh_failed');
        setShowTokenReconnectBanner(tokenFail && !hasConnected);
        const c = data.connections.find((x) => x.status === 'connected');
        if (c) {
          setShowTokenReconnectBanner(false);
          const sel = Array.isArray(c.selected_ad_account_ids) ? c.selected_ad_account_ids.map(String) : [];
          setSaved({
            connectionId: c.id,
            accountName: c.account_name,
            connectedAt: c.connected_at,
            appIdHint: c.app_id_hint,
            selectedAdAccountIds: sel,
            insightsReady: Boolean(c.insights_ready),
          });
          setStep('success');
        }
      } finally {
        if (!cancelled) setBootstrapLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const validateForm = useCallback(() => {
    const err: { appId?: string; appSecret?: string } = {};
    const id = appId.trim().replace(/\s/g, '');
    if (!id) err.appId = 'El App ID es obligatorio';
    else if (!/^\d+$/.test(id)) err.appId = 'El App ID solo debe contener números';
    else if (id.length < 8) err.appId = 'El App ID parece demasiado corto';
    else if (id.length > 22) err.appId = 'Revisa el App ID (demasiado largo)';

    if (!appSecret.trim()) err.appSecret = 'El App Secret es obligatorio';
    else if (appSecret.trim().length < 8) err.appSecret = 'El App Secret parece demasiado corto';

    setFieldErrors(err);
    return Object.keys(err).length === 0;
  }, [appId, appSecret]);

  const toggleAccountId = useCallback((id: string) => {
    setSelectedAccountIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const handleConnectAppOnly = useCallback(async () => {
    if (!validateForm()) return;
    setLoading(true);
    setErrorCode(null);
    setPreviewError(null);
    try {
      const res = await apiFetch('/api/meta/connections', {
        method: 'POST',
        body: JSON.stringify({
          appId: appId.trim(),
          appSecret: appSecret.trim(),
          accessToken: undefined,
          selectedAdAccountIds: [],
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        connection?: {
          id: number;
          account_name: string;
          connected_at: string;
          app_id_hint: string;
          selected_ad_account_ids?: string[];
          insights_ready?: boolean;
        };
      };

      if (!res.ok) {
        const code = data.code as MetaConnectionErrorCode | undefined;
        if (
          code === 'invalid_credentials' ||
          code === 'token_expired' ||
          code === 'network' ||
          code === 'permissions'
        ) {
          setErrorCode(code);
        } else {
          setErrorCode('unknown');
        }
        setStep('error');
        return;
      }

      if (data.connection) {
        const sel = Array.isArray(data.connection.selected_ad_account_ids)
          ? data.connection.selected_ad_account_ids.map(String)
          : [];
        setSaved({
          connectionId: data.connection.id,
          accountName: data.connection.account_name,
          connectedAt: data.connection.connected_at,
          appIdHint: data.connection.app_id_hint,
          selectedAdAccountIds: sel,
          insightsReady: Boolean(data.connection.insights_ready),
        });
      }
      setAppSecret('');
      setAccessToken('');
      setAdAccounts([]);
      setSelectedAccountIds([]);
      setShowTokenReconnectBanner(false);
      setStep('success');
      await refreshUser();
      notifyMetaDashboardRefresh();
    } catch {
      setErrorCode('network');
      setStep('error');
    } finally {
      setLoading(false);
    }
  }, [appId, appSecret, validateForm, refreshUser]);

  const handlePreviewAdAccounts = useCallback(async () => {
    if (!validateForm()) return;
    const tok = accessToken.trim();
    if (!tok) {
      setPreviewError('Para listar cuentas publicitarias necesitas un access token de usuario.');
      return;
    }
    setLoading(true);
    setPreviewError(null);
    setErrorCode(null);
    try {
      const res = await apiFetch('/api/meta/preview-ad-accounts', {
        method: 'POST',
        body: JSON.stringify({
          appId: appId.trim(),
          appSecret: appSecret.trim(),
          accessToken: tok,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        accounts?: AdAccountOption[];
      };
      if (!res.ok) {
        setPreviewError(typeof data.error === 'string' ? data.error : 'No se pudieron cargar las cuentas');
        return;
      }
      const list = Array.isArray(data.accounts) ? data.accounts : [];
      if (list.length === 0) {
        setPreviewError(
          'Meta no devolvió cuentas publicitarias. Comprueba que el token incluya el permiso ads_read y que tu usuario tenga acceso a alguna cuenta.',
        );
        return;
      }
      setAdAccounts(list);
      setSelectedAccountIds(list.map((a) => a.id));
      setStep('accounts');
    } catch {
      setPreviewError('Error de red al consultar Meta');
    } finally {
      setLoading(false);
    }
  }, [appId, appSecret, accessToken, validateForm]);

  const handleConfirmAccountsSave = useCallback(async () => {
    if (selectedAccountIds.length === 0) {
      setPreviewError('Selecciona al menos una cuenta publicitaria para ver métricas en el panel.');
      return;
    }
    setLoading(true);
    setPreviewError(null);
    setErrorCode(null);
    try {
      if (step === 'edit_accounts' && saved) {
        const res = await apiFetch(`/api/meta/connections/${saved.connectionId}/ad-accounts`, {
          method: 'PUT',
          body: JSON.stringify({ adAccountIds: selectedAccountIds }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          selected_ad_account_ids?: string[];
          insights_ready?: boolean;
        };
        if (!res.ok) {
          setPreviewError(typeof data.error === 'string' ? data.error : 'No se pudo actualizar');
          return;
        }
        const sel = Array.isArray(data.selected_ad_account_ids) ? data.selected_ad_account_ids.map(String) : [];
        setSaved((prev) =>
          prev
            ? {
                ...prev,
                selectedAdAccountIds: sel,
                insightsReady: Boolean(data.insights_ready),
              }
            : prev,
        );
        setShowTokenReconnectBanner(false);
        setStep('success');
        await refreshUser();
        notifyMetaDashboardRefresh();
        return;
      }

      const res = await apiFetch('/api/meta/connections', {
        method: 'POST',
        body: JSON.stringify({
          appId: appId.trim(),
          appSecret: appSecret.trim(),
          accessToken: accessToken.trim(),
          selectedAdAccountIds: selectedAccountIds,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        connection?: {
          id: number;
          account_name: string;
          connected_at: string;
          app_id_hint: string;
          selected_ad_account_ids?: string[];
          insights_ready?: boolean;
        };
      };

      if (!res.ok) {
        const code = data.code as MetaConnectionErrorCode | undefined;
        if (
          code === 'invalid_credentials' ||
          code === 'token_expired' ||
          code === 'network' ||
          code === 'permissions'
        ) {
          setErrorCode(code);
        } else {
          setErrorCode('unknown');
        }
        setStep('error');
        return;
      }

      if (data.connection) {
        const sel = Array.isArray(data.connection.selected_ad_account_ids)
          ? data.connection.selected_ad_account_ids.map(String)
          : [];
        setSaved({
          connectionId: data.connection.id,
          accountName: data.connection.account_name,
          connectedAt: data.connection.connected_at,
          appIdHint: data.connection.app_id_hint,
          selectedAdAccountIds: sel,
          insightsReady: Boolean(data.connection.insights_ready),
        });
      }
      setAppSecret('');
      setAccessToken('');
      setAdAccounts([]);
      setSelectedAccountIds([]);
      setShowTokenReconnectBanner(false);
      setStep('success');
      await refreshUser();
      notifyMetaDashboardRefresh();
    } catch {
      setErrorCode('network');
      setStep('error');
    } finally {
      setLoading(false);
    }
  }, [
    selectedAccountIds,
    step,
    saved,
    appId,
    appSecret,
    accessToken,
    refreshUser,
  ]);

  const handleOpenEditAccounts = useCallback(async () => {
    if (!saved) return;
    setLoading(true);
    setPreviewError(null);
    try {
      const res = await apiFetch('/api/meta/ad-accounts');
      const data = (await res.json().catch(() => ({}))) as { error?: string; accounts?: AdAccountOption[] };
      if (!res.ok) {
        window.alert(
          typeof data.error === 'string' ? data.error : 'No se pudieron cargar las cuentas (¿falta token de usuario?)',
        );
        return;
      }
      const list = Array.isArray(data.accounts) ? data.accounts : [];
      setAdAccounts(list);
      const allowed = new Set(list.map((a) => a.id));
      const pre = saved.selectedAdAccountIds.filter((id) => allowed.has(id));
      setSelectedAccountIds(pre.length > 0 ? pre : list.map((a) => a.id));
      setStep('edit_accounts');
    } catch {
      window.alert('Error de red al contactar el servidor');
    } finally {
      setLoading(false);
    }
  }, [saved]);

  const handleDisconnect = useCallback(async () => {
    if (
      !window.confirm(
        '¿Desconectar tu cuenta de anuncios en Meta? Deberás volver a introducir las credenciales para sincronizar datos.',
      )
    ) {
      return;
    }
    if (!saved) return;
    try {
      await apiFetch(`/api/meta/connections/${saved.connectionId}`, { method: 'DELETE' });
    } catch {
      /* ignore */
    }
    setSaved(null);
    setStep('home');
    setAppId('');
    setAppSecret('');
    setAccessToken('');
    setFieldErrors({});
    setErrorCode(null);
    setAdAccounts([]);
    setSelectedAccountIds([]);
    setPreviewError(null);
    await refreshUser();
    notifyMetaDashboardRefresh();
  }, [saved, refreshUser]);

  const badgeStatus: 'disconnected' | 'loading' | 'connected' | 'error' =
    bootstrapLoading || loading
      ? 'loading'
      : step === 'success' && saved
        ? 'connected'
        : step === 'error'
          ? 'error'
          : 'disconnected';

  const shell = (children: ReactNode) => (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <style>{`
        @keyframes conexionMetaSpin { to { transform: rotate(360deg); } }
        @keyframes conexionMetaPulse { 50% { opacity: 0.45; } }
        @keyframes conexionMetaPop { from { transform: scale(0.6); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes conexionMetaDraw { to { stroke-dashoffset: 0; } }
      `}</style>
      {showTokenReconnectBanner ? (
        <div
          style={{
            marginBottom: 20,
            padding: '16px 18px',
            borderRadius: 14,
            border: `1px solid ${ds.borderCard}`,
            background: ds.warningBg,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8, color: ds.textPrimary }}>
            Tu conexión con Meta expiró
          </div>
          <p style={{ margin: 0, fontSize: 13, color: ds.textSecondary, lineHeight: 1.5 }}>
            No pudimos renovar el access token automáticamente (revocado, caducado o permisos retirados). Vuelve a
            conectar con un token nuevo; el resto de KOVO sigue funcionando con normalidad.
          </p>
          <Link
            to="/meta-ads?tab=conexion"
            onClick={() => setStep('guide')}
            style={{
              display: 'inline-flex',
              marginTop: 12,
              padding: '8px 18px',
              borderRadius: 8,
              background: ds.brand,
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Reconectar
          </Link>
        </div>
      ) : null}
      {children}
    </div>
  );

  if (bootstrapLoading) {
    return shell(
      <div
        style={{
          background: ds.bgCard,
          borderRadius: 16,
          padding: 40,
          textAlign: 'center',
          color: ds.textSecondary,
        }}
      >
        Cargando conexión Meta…
      </div>,
    );
  }

  if (step === 'success' && saved) {
    return shell(
      <div
        style={{
          background: ds.bgCard,
          borderRadius: 16,
          padding: 'clamp(20px, 4vw, 36px)',
          border: `1px solid ${ds.borderCard}`,
          textAlign: 'center',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <CheckAnimated />
        </div>
        <h2 style={{ margin: '0 0 8px', fontSize: 22, color: ds.textPrimary }}>¡Conexión correcta con Meta!</h2>
        <p style={{ margin: '0 0 20px', color: ds.textSecondary, fontSize: 15, lineHeight: 1.5 }}>
          Tu app de Meta está vinculada. Si elegiste cuentas publicitarias y guardaste un token de usuario, el apartado{' '}
          <strong>Análisis de creativo</strong> mostrará métricas reales (campañas, conjuntos y anuncios). Si conectaste
          solo App ID y Secret, el panel seguirá en modo demostración hasta que añadas token y cuentas.
        </p>
        {saved.selectedAdAccountIds.length > 0 && (
          <p style={{ margin: '0 0 16px', fontSize: 14, color: ds.textPrimary, textAlign: 'left' }}>
            <strong>Cuentas enlazadas:</strong> {saved.selectedAdAccountIds.length} —{' '}
            {saved.selectedAdAccountIds.join(', ')}
          </p>
        )}
        <div
          style={{
            textAlign: 'left',
            background: ds.bgSubtle,
            borderRadius: 12,
            padding: '16px 18px',
            marginBottom: 24,
            border: `1px solid ${ds.borderCard}`,
          }}
        >
          <div style={{ fontSize: 13, color: ds.textSecondary, marginBottom: 4 }}>Cuenta conectada</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: ds.textPrimary }}>{saved.accountName}</div>
          <div style={{ fontSize: 13, color: ds.textSecondary, marginTop: 12 }}>App ID (referencia)</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: ds.textPrimary }}>{saved.appIdHint}</div>
          <div style={{ fontSize: 13, color: ds.textSecondary, marginTop: 12 }}>Fecha de conexión</div>
          <div style={{ fontSize: 15, fontWeight: 500, color: ds.textPrimary }}>{formatConnectedDate(saved.connectedAt)}</div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center', alignItems: 'center' }}>
          <StatusBadge status="connected" />
          <button
            type="button"
            onClick={() => void handleOpenEditAccounts()}
            disabled={loading}
            style={{
              padding: '10px 18px',
              borderRadius: 10,
              border: `1px solid ${ds.brand}`,
              background: ds.bgCard,
              color: ds.brand,
              fontWeight: 600,
              cursor: loading ? 'wait' : 'pointer',
              fontSize: 14,
            }}
          >
            Cambiar cuentas publicitarias
          </button>
          <button
            type="button"
            onClick={() => void handleDisconnect()}
            style={{
              padding: '12px 22px',
              borderRadius: 10,
              border: `1px solid ${ds.dangerText}`,
              background: ds.bgCard,
              color: ds.dangerText,
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Desconectar
          </button>
        </div>
      </div>,
    );
  }

  if (step === 'error' && errorCode) {
    return shell(
      <div
        style={{
          background: ds.bgCard,
          borderRadius: 16,
          padding: 'clamp(20px, 4vw, 36px)',
          border: `1px solid ${ds.dangerText}`,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            margin: '0 auto 16px',
            borderRadius: '50%',
            background: ds.dangerBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          aria-hidden
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="10" stroke={ds.dangerText} strokeWidth="2" />
            <path d="M12 7v6M12 16v.01" stroke={ds.dangerText} strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </div>
        <h2 style={{ margin: '0 0 10px', fontSize: 20, color: ds.textPrimary }}>No se pudo completar la conexión</h2>
        <p style={{ margin: '0 0 24px', color: ds.textPrimary, fontSize: 16, lineHeight: 1.5 }}>
          {messageForErrorCode(errorCode)}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'stretch' }}>
          <button
            type="button"
            onClick={() => {
              setStep('form');
              setErrorCode(null);
            }}
            style={{
              padding: '14px 20px',
              borderRadius: 10,
              border: 'none',
              background: ds.brand,
              color: '#fff',
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: 15,
            }}
          >
            Intentar de nuevo
          </button>
          <button
            type="button"
            onClick={() => {
              setStep('guide');
              setErrorCode(null);
            }}
            style={{
              padding: '12px 20px',
              borderRadius: 10,
              border: 'none',
              background: 'transparent',
              color: ds.brand,
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: 14,
              textDecoration: 'underline',
            }}
          >
            Ver guía paso a paso
          </button>
        </div>
      </div>,
    );
  }

  if (step === 'guide') {
    return shell(
      <div>
        <button
          type="button"
          onClick={() => setStep('home')}
          style={{
            border: 'none',
            background: 'none',
            color: ds.brand,
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 16,
            padding: 0,
          }}
        >
          ← Volver
        </button>
        <div
          style={{
            background: ds.bgCard,
            borderRadius: 16,
            padding: 'clamp(20px, 4vw, 32px)',
            border: `1px solid ${ds.borderCard}`,
          }}
        >
          <h2 style={{ margin: '0 0 8px', fontSize: 22, color: ds.textPrimary }}>Antes de conectar</h2>
          <p style={{ margin: '0 0 20px', color: ds.textSecondary, fontSize: 15 }}>
            Sigue estos pasos en Meta. En unos minutos tendrás lo necesario para enlazar tu cuenta.
          </p>
          <a
            href={DEVELOPERS_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 28,
              color: ds.brand,
              fontWeight: 700,
              fontSize: 15,
            }}
          >
            Abrir Facebook Developers
            <span aria-hidden>↗</span>
          </a>
          <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {GUIDE_STEPS.map((s, i) => (
              <li
                key={s.title}
                style={{
                  display: 'flex',
                  gap: 16,
                  marginBottom: i < GUIDE_STEPS.length - 1 ? 22 : 0,
                  alignItems: 'flex-start',
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: alpha.brand18,
                    color: ds.brand,
                    fontWeight: 700,
                    fontSize: 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {i + 1}
                </span>
                <div>
                  <div style={{ fontWeight: 700, color: ds.textPrimary, marginBottom: 6 }}>{s.title}</div>
                  <p style={{ margin: 0, color: ds.textSecondary, fontSize: 14, lineHeight: 1.5 }}>{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={() => setStep('form')}
            style={{
              marginTop: 28,
              width: '100%',
              padding: '14px 20px',
              borderRadius: 10,
              border: 'none',
              background: ds.brand,
              color: '#fff',
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: 16,
            }}
          >
            Continuar al formulario
          </button>
        </div>
      </div>,
    );
  }

  if (step === 'accounts' || step === 'edit_accounts') {
    const editing = step === 'edit_accounts';
    return shell(
      <div>
        <button
          type="button"
          onClick={() => {
            setPreviewError(null);
            setStep(editing ? 'success' : 'form');
          }}
          style={{
            border: 'none',
            background: 'none',
            color: ds.brand,
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 16,
            padding: 0,
          }}
        >
          {editing ? '← Volver al resumen' : '← Volver al formulario'}
        </button>
        <div
          style={{
            background: ds.bgCard,
            borderRadius: 16,
            padding: 'clamp(20px, 4vw, 32px)',
            border: `1px solid ${ds.borderCard}`,
          }}
        >
          <h2 style={{ margin: '0 0 8px', fontSize: 22, color: ds.textPrimary }}>
            {editing ? 'Actualizar cuentas publicitarias' : 'Elige tus cuentas publicitarias'}
          </h2>
          <p style={{ margin: '0 0 20px', color: ds.textSecondary, fontSize: 14, lineHeight: 1.5 }}>
            Marca una o varias cuentas (act_). Las métricas del panel se agregarán de todas ellas.
          </p>
          {previewError && (
            <div
              style={{
                marginBottom: 16,
                padding: '12px 14px',
                borderRadius: 10,
                background: ds.dangerBg,
                color: ds.dangerText,
                fontSize: 14,
              }}
            >
              {previewError}
            </div>
          )}
          <ul style={{ margin: '0 0 24px', padding: 0, listStyle: 'none' }}>
            {adAccounts.map((a) => (
              <li
                key={a.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: `1px solid ${ds.borderCard}`,
                  marginBottom: 10,
                  background: ds.bgSubtle,
                }}
              >
                <input
                  type="checkbox"
                  id={`acct-${a.id}`}
                  checked={selectedAccountIds.includes(a.id)}
                  onChange={() => toggleAccountId(a.id)}
                  style={{ marginTop: 4, width: 18, height: 18, cursor: 'pointer' }}
                />
                <label htmlFor={`acct-${a.id}`} style={{ cursor: 'pointer', flex: 1, margin: 0 }}>
                  <div style={{ fontWeight: 700, color: ds.textPrimary }}>{a.name}</div>
                  <div style={{ fontSize: 13, color: ds.textSecondary }}>
                    {a.id}
                    {a.currency ? ` · ${a.currency}` : ''}
                    {a.account_status != null ? ` · estado ${a.account_status}` : ''}
                  </div>
                </label>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={loading}
            onClick={() => void handleConfirmAccountsSave()}
            style={{
              width: '100%',
              padding: '14px 20px',
              borderRadius: 10,
              border: 'none',
              background: loading ? alpha.brand45 : ds.brand,
              color: '#fff',
              fontWeight: 700,
              cursor: loading ? 'wait' : 'pointer',
              fontSize: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {loading ? (
              <>
                <Spinner />
                Guardando…
              </>
            ) : editing ? (
              'Guardar cuentas'
            ) : (
              'Guardar conexión y cuentas'
            )}
          </button>
        </div>
      </div>,
    );
  }

  if (step === 'form') {
    return shell(
      <div>
        <button
          type="button"
          onClick={() => setStep('guide')}
          style={{
            border: 'none',
            background: 'none',
            color: ds.brand,
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 16,
            padding: 0,
          }}
        >
          ← Ver la guía otra vez
        </button>
        <div
          style={{
            background: ds.bgCard,
            borderRadius: 16,
            padding: 'clamp(20px, 4vw, 32px)',
            border: `1px solid ${ds.borderCard}`,
          }}
        >
          <h2 style={{ margin: '0 0 8px', fontSize: 22, color: ds.textPrimary }}>Datos de tu app</h2>
          <p style={{ margin: '0 0 24px', color: ds.textSecondary, fontSize: 14 }}>
            Los datos se guardan en el servidor y quedan aislados por organización (multi-tenant). Solo usuarios
            autorizados de tu empresa pueden gestionarlos.
          </p>

          <label style={{ display: 'block', marginBottom: 18 }}>
            <span style={{ display: 'flex', alignItems: 'center', fontWeight: 600, color: ds.textPrimary, marginBottom: 8 }}>
              App ID (Facebook Developer)
              <FieldTooltip
                id={`${baseId}-appid`}
                text="Identificador numérico de tu app. En developers.facebook.com: tu app → Configuración → Básico → sección «Identificador de la aplicación»."
              />
            </span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              placeholder="Ej. 1234567890123456"
              aria-invalid={!!fieldErrors.appId}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '12px 14px',
                borderRadius: 10,
                border: fieldErrors.appId ? `2px solid ${ds.dangerText}` : `1px solid ${ds.borderCard}`,
                fontSize: 15,
              }}
            />
            {fieldErrors.appId && (
              <span style={{ display: 'block', marginTop: 6, fontSize: 13, color: ds.dangerText }}>{fieldErrors.appId}</span>
            )}
          </label>

          <label style={{ display: 'block', marginBottom: 18 }}>
            <span style={{ display: 'flex', alignItems: 'center', fontWeight: 600, color: ds.textPrimary, marginBottom: 8 }}>
              App Secret
              <FieldTooltip
                id={`${baseId}-secret`}
                text="Clave secreta de la app. En la misma página de Configuración → Básico, pulsa «Mostrar» junto a Secreto de la aplicación. No la compartas con nadie."
              />
            </span>
            <input
              type="password"
              autoComplete="new-password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              placeholder="Pega el App Secret"
              aria-invalid={!!fieldErrors.appSecret}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '12px 14px',
                borderRadius: 10,
                border: fieldErrors.appSecret ? `2px solid ${ds.dangerText}` : `1px solid ${ds.borderCard}`,
                fontSize: 15,
              }}
            />
            {fieldErrors.appSecret && (
              <span style={{ display: 'block', marginTop: 6, fontSize: 13, color: ds.dangerText }}>{fieldErrors.appSecret}</span>
            )}
          </label>

          <label style={{ display: 'block', marginBottom: 24 }}>
            <span style={{ display: 'flex', alignItems: 'center', fontWeight: 600, color: ds.textPrimary, marginBottom: 8 }}>
              Access Token de usuario (para métricas en vivo)
              <FieldTooltip
                id={`${baseId}-token`}
                text="Token de usuario de Meta con permisos ads_read (y ads_management si gestionas anuncios). Genera uno en Graph API Explorer seleccionando tu app, o con el flujo OAuth. Sin token solo puedes validar App ID y Secret; no habrá cuentas publicitarias ni datos reales en el panel."
              />
            </span>
            <input
              type="password"
              autoComplete="off"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="Recomendado para listar cuentas y ver campañas"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '12px 14px',
                borderRadius: 10,
                border: `1px solid ${ds.borderCard}`,
                fontSize: 15,
              }}
            />
          </label>

          {previewError && (
            <div
              style={{
                marginBottom: 16,
                padding: '12px 14px',
                borderRadius: 10,
                background: ds.dangerBg,
                color: ds.dangerText,
                fontSize: 14,
              }}
            >
              {previewError}
            </div>
          )}

          <button
            type="button"
            disabled={loading}
            onClick={() => void handlePreviewAdAccounts()}
            style={{
              width: '100%',
              padding: '14px 20px',
              borderRadius: 10,
              border: 'none',
              background: loading ? alpha.brand45 : ds.brand,
              color: '#fff',
              fontWeight: 700,
              cursor: loading ? 'wait' : 'pointer',
              fontSize: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 12,
            }}
          >
            {loading ? (
              <>
                <Spinner />
                Consultando Meta…
              </>
            ) : (
              'Siguiente: elegir cuentas publicitarias'
            )}
          </button>

          <button
            type="button"
            disabled={loading}
            onClick={() => void handleConnectAppOnly()}
            style={{
              width: '100%',
              padding: '12px 20px',
              borderRadius: 10,
              border: `1px solid ${alpha.brand40}`,
              background: ds.bgCard,
              color: ds.brand,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 14,
            }}
          >
            Solo validar app (sin token ni métricas en vivo)
          </button>
        </div>
      </div>,
    );
  }

  /* home */
  return shell(
    <div
      style={{
        background: ds.bgCard,
        borderRadius: 16,
        padding: 'clamp(24px, 5vw, 40px)',
        border: `1px solid ${ds.borderCard}`,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
        <StatusBadge status={badgeStatus} />
      </div>
      <h2 style={{ margin: '0 0 12px', fontSize: 'clamp(22px, 4vw, 28px)', color: ds.textPrimary, lineHeight: 1.2 }}>
        Conecta tu cuenta de anuncios en Meta
      </h2>
      <p style={{ margin: '0 0 28px', color: ds.textSecondary, fontSize: 16, lineHeight: 1.55, maxWidth: 520 }}>
        Enlaza tu propia app de Facebook Developer para ver métricas y gestionar anuncios con tus credenciales. Tú controlas el acceso; nosotros solo usamos lo que autorices en Meta.
      </p>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <button
          type="button"
          onClick={() => {
            setStep('guide');
          }}
          style={{
            padding: '14px 28px',
            borderRadius: 10,
            border: 'none',
            background: ds.brand,
            color: '#fff',
            fontWeight: 700,
            cursor: 'pointer',
            fontSize: 16,
            width: '100%',
          }}
        >
          Conectar con Meta
        </button>
      </div>
    </div>,
  );
}
