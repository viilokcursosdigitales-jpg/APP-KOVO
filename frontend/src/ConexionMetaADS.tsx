import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  IconAdjustmentsHorizontal,
  IconChartLine,
  IconReportMoney,
  IconSparkles,
} from '@tabler/icons-react';
import { apiFetch, apiUrl, getStoredToken } from './auth/api';
import { useAuth } from './auth/AuthContext';
import { alpha, ds } from './design-system/ds';
import { KOVO_META_CONNECTION_EVENT } from './meta/useMetaInsightsReady';

function notifyMetaDashboardRefresh() {
  window.dispatchEvent(new Event(KOVO_META_CONNECTION_EVENT));
}

type FlowStep = 'home' | 'success';

type SavedConnection = {
  connectionId: number;
  accountName: string;
  connectedAt: string;
  appIdHint: string;
  selectedAdAccountIds: string[];
  insightsReady: boolean;
};

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
          ...(status === 'loading' ? { animation: 'conexionMetaPulse 1s ease-in-out infinite' } : {}),
        }}
      />
      {map.label}
    </span>
  );
}

function metaOAuthErrorHint(reason: string): string {
  const m: Record<string, string> = {
    plan_limit: 'Tu plan no permite más conexiones Meta para esta organización.',
    access_denied: 'No se otorgaron permisos en Meta. Inténtalo de nuevo y acepta los permisos.',
    invalid_state: 'La sesión de enlace expiró o no es válida. Vuelve a pulsar Conectar con Meta.',
    user_mismatch: 'El usuario de KOVO no coincide con la sesión de OAuth. Cierra sesión y vuelve a entrar.',
    token_exchange: 'Meta no aceptó el código de autorización (revisa META_REDIRECT_URI y App Secret).',
    long_lived_exchange: 'No se pudo obtener el token de larga duración. Revisa la configuración de la app.',
    missing_params: 'Faltan parámetros en la respuesta de Meta.',
    server_config: 'OAuth Meta no está configurado en el servidor (META_APP_ID / META_REDIRECT_URI).',
    server: 'Error interno al completar la conexión. Inténtalo más tarde.',
  };
  return m[reason] || `No se pudo completar la conexión (${reason || 'desconocido'}).`;
}

const META_BENEFITS: { label: string; Icon: typeof IconChartLine }[] = [
  { label: 'Ver métricas de campañas en tiempo real', Icon: IconChartLine },
  { label: 'Analizar gasto vs ventas y ROAS', Icon: IconReportMoney },
  { label: 'Optimizar presupuesto desde un solo lugar', Icon: IconAdjustmentsHorizontal },
  { label: 'Acceder a campañas Meta y audiencias', Icon: IconSparkles },
];

export default function ConexionMetaADS() {
  const { refreshUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [saved, setSaved] = useState<SavedConnection | null>(null);
  const [step, setStep] = useState<FlowStep>('home');
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [oauthConnectLoading, setOauthConnectLoading] = useState(false);

  useEffect(() => {
    const oauth = searchParams.get('meta_oauth');
    if (!oauth) return;
    const reason = searchParams.get('reason') || '';
    const next = new URLSearchParams(searchParams);
    next.delete('meta_oauth');
    next.delete('reason');
    setSearchParams(next, { replace: true });

    if (oauth === 'success') {
      let cancelled = false;
      (async () => {
        setBootstrapLoading(true);
        try {
          const res = await apiFetch(`/api/meta/connections?_=${Date.now()}`);
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
            }>;
          };
          const c = data.connections.find((x) => x.status === 'connected');
          if (c) {
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
          await refreshUser();
          notifyMetaDashboardRefresh();
        } finally {
          if (!cancelled) setBootstrapLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    if (oauth === 'error') {
      window.alert(metaOAuthErrorHint(reason));
      setStep('home');
    }
    return undefined;
  }, [searchParams, setSearchParams, refreshUser]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/meta/connections?_=${Date.now()}`);
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
        const c = data.connections.find((x) => x.status === 'connected');
        if (c) {
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
        } else if (!hasConnected) {
          setSaved(null);
          setStep('home');
        }
      } finally {
        if (!cancelled) setBootstrapLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleConnectWithMetaOAuth = useCallback(async () => {
    const jwt = getStoredToken();
    if (!jwt) {
      window.alert('Inicia sesión en KOVO para conectar Meta.');
      return;
    }
    setOauthConnectLoading(true);
    try {
      const res = await fetch(apiUrl('/api/meta/auth-url'), {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && typeof body.url === 'string' && body.url.startsWith('https://')) {
        window.location.assign(body.url);
        return;
      }
      window.alert(typeof body.error === 'string' ? body.error : 'No se pudo iniciar la conexión con Meta.');
    } catch {
      window.alert('Error de red al contactar el servidor.');
    } finally {
      setOauthConnectLoading(false);
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    if (!window.confirm('¿Desconectar?')) return;
    if (!saved) return;
    try {
      await apiFetch(`/api/meta/connections/${saved.connectionId}`, { method: 'DELETE' });
    } catch {
      /* ignore */
    }
    setSaved(null);
    setStep('home');
    await refreshUser();
    notifyMetaDashboardRefresh();
  }, [saved, refreshUser]);

  const badgeStatus: 'disconnected' | 'loading' | 'connected' | 'error' = bootstrapLoading || oauthConnectLoading
    ? 'loading'
    : step === 'success' && saved
      ? 'connected'
      : 'disconnected';

  const shell = (children: ReactNode) => (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <style>{`
        @keyframes conexionMetaSpin { to { transform: rotate(360deg); } }
        @keyframes conexionMetaPulse { 50% { opacity: 0.45; } }
      `}</style>
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
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          border: `1px solid ${ds.borderCard}`,
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 28,
            height: 28,
            border: `3px solid ${alpha.brand35}`,
            borderTopColor: ds.brand,
            borderRadius: '50%',
            animation: 'conexionMetaSpin 0.7s linear infinite',
          }}
        />
      </div>,
    );
  }

  if (step === 'success' && saved) {
    return shell(
      <div
        style={{
          background: ds.bgCard,
          borderRadius: 16,
          padding: 'clamp(24px, 5vw, 40px)',
          border: `1px solid ${ds.borderCard}`,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <StatusBadge status="connected" />
        </div>
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
      </div>,
    );
  }

  return shell(
    <div
      style={{
        background: ds.bgCard,
        borderRadius: 16,
        padding: 'clamp(24px, 5vw, 40px)',
        border: `1px solid ${ds.borderCard}`,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <StatusBadge status={badgeStatus} />
      </div>
      <p
        style={{
          margin: '0 0 20px',
          fontSize: 14,
          color: ds.textSecondary,
          lineHeight: 1.55,
          maxWidth: 520,
        }}
      >
        Conecta tu cuenta de Meta Ads para ver el rendimiento de tus campañas, gasto publicitario y ROAS directamente en
        KOVO.
      </p>
      <ul
        style={{
          margin: '0 0 28px',
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          maxWidth: 520,
        }}
      >
        {META_BENEFITS.map(({ label, Icon }) => (
          <li
            key={label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <span
              style={{
                flexShrink: 0,
                width: 38,
                height: 38,
                borderRadius: 10,
                background: alpha.brand18,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: ds.brand,
              }}
              aria-hidden
            >
              <Icon size={20} stroke={1.5} color="currentColor" />
            </span>
            <span
              style={{
                fontSize: 14,
                color: ds.textPrimary,
                lineHeight: 1.45,
                fontWeight: 500,
              }}
            >
              {label}
            </span>
          </li>
        ))}
      </ul>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <button
          type="button"
          disabled={oauthConnectLoading}
          onClick={() => void handleConnectWithMetaOAuth()}
          style={{
            padding: '14px 28px',
            borderRadius: 10,
            border: 'none',
            background: oauthConnectLoading ? alpha.brand45 : ds.brand,
            color: '#fff',
            fontWeight: 700,
            cursor: oauthConnectLoading ? 'wait' : 'pointer',
            fontSize: 16,
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          {oauthConnectLoading ? (
            <>
              <Spinner />
            </>
          ) : (
            'Conectar con Meta'
          )}
        </button>
      </div>
    </div>,
  );
}
