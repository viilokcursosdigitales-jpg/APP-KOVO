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

function normalizeActId(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const digits = s.replace(/^act_/i, '');
  if (!/^\d+$/.test(digits)) return '';
  return `act_${digits}`;
}

type MetaAdAccountRow = {
  id: string;
  name: string;
  account_status?: number;
  currency?: string;
};

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
  const [adAccounts, setAdAccounts] = useState<MetaAdAccountRow[]>([]);
  const [adAccountsStatus, setAdAccountsStatus] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle');
  const [adAccountsError, setAdAccountsError] = useState<string | null>(null);
  const [selectedActIds, setSelectedActIds] = useState<string[]>([]);
  const [saveAccountsLoading, setSaveAccountsLoading] = useState(false);
  const [saveAccountsError, setSaveAccountsError] = useState<string | null>(null);

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
    setAdAccounts([]);
    setAdAccountsStatus('idle');
    setAdAccountsError(null);
    setSelectedActIds([]);
    setSaveAccountsError(null);
    await refreshUser();
    notifyMetaDashboardRefresh();
  }, [saved, refreshUser]);

  const loadAdAccounts = useCallback(async (conn: SavedConnection) => {
    setAdAccountsStatus('loading');
    setAdAccountsError(null);
    try {
      const res = await apiFetch('/api/meta/ad-accounts');
      const body = (await res.json().catch(() => ({}))) as {
        accounts?: MetaAdAccountRow[];
        error?: string;
      };
      if (!res.ok) {
        setAdAccountsStatus('error');
        setAdAccountsError(typeof body.error === 'string' ? body.error : 'No se pudieron cargar las cuentas.');
        setAdAccounts([]);
        return;
      }
      const list = Array.isArray(body.accounts) ? body.accounts : [];
      setAdAccounts(list);
      setAdAccountsStatus('ready');
      const allowed = new Set(list.map((a) => normalizeActId(a.id)).filter(Boolean));
      const fromSaved = (conn.selectedAdAccountIds ?? [])
        .map((id) => normalizeActId(id))
        .filter((id) => allowed.has(id));
      setSelectedActIds(fromSaved);
    } catch {
      setAdAccountsStatus('error');
      setAdAccountsError('Error de red al cargar cuentas publicitarias.');
      setAdAccounts([]);
    }
  }, []);

  useEffect(() => {
    if (step !== 'success' || !saved) {
      setAdAccountsStatus('idle');
      setAdAccounts([]);
      setAdAccountsError(null);
      setSelectedActIds([]);
      setSaveAccountsError(null);
      return;
    }
    void loadAdAccounts(saved);
  // Solo al cambiar conexión o paso: evitar recargar al actualizar `saved` tras guardar cuentas.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `saved` del render donde cambió connectionId
  }, [step, saved?.connectionId, loadAdAccounts]);

  const toggleActSelection = useCallback((rawId: string) => {
    const id = normalizeActId(rawId);
    if (!id) return;
    setSelectedActIds((prev) => {
      const set = new Set(prev);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return Array.from(set);
    });
  }, []);

  const handleSaveAdAccounts = useCallback(async () => {
    if (!saved) return;
    setSaveAccountsLoading(true);
    setSaveAccountsError(null);
    try {
      const res = await apiFetch(`/api/meta/connections/${saved.connectionId}/ad-accounts`, {
        method: 'PUT',
        body: JSON.stringify({ adAccountIds: selectedActIds }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        selected_ad_account_ids?: string[];
        insights_ready?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setSaveAccountsError(typeof body.error === 'string' ? body.error : 'No se pudo guardar la selección.');
        return;
      }
      const nextSel = Array.isArray(body.selected_ad_account_ids)
        ? body.selected_ad_account_ids.map(String)
        : selectedActIds;
      setSaved((prev) =>
        prev
          ? {
              ...prev,
              selectedAdAccountIds: nextSel,
              insightsReady: Boolean(body.insights_ready),
            }
          : prev,
      );
      setSelectedActIds(nextSel.map((id) => normalizeActId(id)).filter(Boolean));
      notifyMetaDashboardRefresh();
      await refreshUser();
    } catch {
      setSaveAccountsError('Error de red al guardar.');
    } finally {
      setSaveAccountsLoading(false);
    }
  }, [saved, selectedActIds, refreshUser]);

  const badgeStatus: 'disconnected' | 'loading' | 'connected' | 'error' = bootstrapLoading || oauthConnectLoading
    ? 'loading'
    : step === 'success' && saved
      ? 'connected'
      : 'disconnected';

  const shell = (children: ReactNode, opts?: { maxWidth?: number }) => (
    <div style={{ maxWidth: opts?.maxWidth ?? 640, margin: '0 auto' }}>
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
    const actStatusNote = (st: number | undefined) => {
      if (st === 1) return null;
      if (st === 2) return 'Cuenta desactivada en Meta';
      if (st === 3) return 'Saldo pendiente';
      if (st === 7) return 'En revisión de riesgo';
      if (st === 8) return 'Periodo de gracia';
      if (st === 9) return 'Cierre pendiente';
      if (st === 100) return 'Cerrada';
      if (st == null) return null;
      return `Estado ${st} en Meta`;
    };

    return shell(
      <div
        style={{
          background: ds.bgCard,
          borderRadius: 16,
          padding: 'clamp(24px, 5vw, 40px)',
          border: `1px solid ${ds.borderCard}`,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <StatusBadge status="connected" />
          {saved.insightsReady ? (
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: 999,
                background: alpha.success15,
                color: ds.successText,
              }}
            >
              Métricas activas
            </span>
          ) : (
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: 999,
                background: ds.warningBg,
                color: ds.warningText,
              }}
            >
              Elige al menos una cuenta
            </span>
          )}
        </div>
        <p style={{ margin: '0 0 20px', fontSize: 14, color: ds.textSecondary, lineHeight: 1.55, maxWidth: 640 }}>
          Cuenta Meta: <strong style={{ color: ds.textPrimary }}>{saved.accountName}</strong>
          {saved.appIdHint ? (
            <>
              {' '}
              · App <span style={{ color: ds.textMuted }}>{saved.appIdHint}</span>
            </>
          ) : null}
        </p>

        <div
          style={{
            marginBottom: 24,
            paddingTop: 20,
            borderTop: `1px solid ${ds.borderCard}`,
          }}
        >
          <h2 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: ds.textPrimary }}>
            Cuentas publicitarias
          </h2>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: ds.textSecondary, lineHeight: 1.5, maxWidth: 640 }}>
            Marca las cuentas de las que quieres ver gasto, campañas y embudo en KOVO. Puedes cambiar esta lista cuando
            quieras.
          </p>

          {adAccountsStatus === 'loading' ? (
            <div style={{ padding: '20px 0', color: ds.textMuted, fontSize: 13 }}>Cargando cuentas desde Meta…</div>
          ) : null}

          {adAccountsStatus === 'error' && adAccountsError ? (
            <div
              style={{
                marginBottom: 14,
                padding: '12px 14px',
                borderRadius: 10,
                background: ds.dangerBg,
                color: ds.dangerText,
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              {adAccountsError}
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => void loadAdAccounts(saved)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: `1px solid ${ds.dangerText}`,
                    background: ds.bgCard,
                    color: ds.dangerText,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  Reintentar
                </button>
              </div>
            </div>
          ) : null}

          {adAccountsStatus === 'ready' && adAccounts.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: ds.textSecondary, lineHeight: 1.5 }}>
              Meta no devolvió cuentas publicitarias para este usuario. Comprueba en el Administrador de anuncios que
              existan cuentas y que el usuario de Facebook tenga acceso a ellas con los permisos que aceptaste al
              conectar.
            </p>
          ) : null}

          {adAccountsStatus === 'ready' && adAccounts.length > 0 ? (
            <>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 10,
                  marginBottom: 12,
                  alignItems: 'center',
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    const all = adAccounts.map((a) => normalizeActId(a.id)).filter(Boolean);
                    setSelectedActIds(all);
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: `1px solid ${ds.borderCard}`,
                    background: ds.bgSubtle,
                    color: ds.textSecondary,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  Seleccionar todas
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedActIds([])}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: `1px solid ${ds.borderCard}`,
                    background: ds.bgSubtle,
                    color: ds.textSecondary,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  Quitar selección
                </button>
                <button
                  type="button"
                  onClick={() => void loadAdAccounts(saved)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: `1px solid ${ds.borderCard}`,
                    background: ds.bgCard,
                    color: ds.brand,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  Actualizar lista
                </button>
              </div>
              <ul
                style={{
                  margin: 0,
                  padding: 0,
                  listStyle: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  maxHeight: 320,
                  overflowY: 'auto',
                }}
              >
                {adAccounts.map((a) => {
                  const id = normalizeActId(a.id);
                  const checked = id ? selectedActIds.includes(id) : false;
                  const stNote = actStatusNote(a.account_status);
                  return (
                    <li key={a.id}>
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 12,
                          padding: '12px 14px',
                          borderRadius: 10,
                          border: `1px solid ${checked ? ds.brandPale : ds.borderCard}`,
                          background: checked ? alpha.brand18 : ds.bgSubtle,
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleActSelection(a.id)}
                          style={{ marginTop: 3, width: 18, height: 18, cursor: 'pointer', flexShrink: 0 }}
                        />
                        <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                          <span style={{ display: 'block', fontWeight: 600, fontSize: 14, color: ds.textPrimary }}>
                            {a.name || id}
                          </span>
                          <span style={{ display: 'block', fontSize: 12, color: ds.textHint, marginTop: 2 }}>
                            {id}
                            {a.currency ? ` · ${a.currency}` : ''}
                          </span>
                          {stNote ? (
                            <span style={{ display: 'block', fontSize: 11, color: ds.warningText, marginTop: 4 }}>
                              {stNote}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}

          {saveAccountsError ? (
            <p style={{ margin: '14px 0 0', fontSize: 13, color: ds.dangerText }}>{saveAccountsError}</p>
          ) : null}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 20, alignItems: 'center' }}>
            <button
              type="button"
              disabled={saveAccountsLoading || adAccountsStatus !== 'ready'}
              onClick={() => void handleSaveAdAccounts()}
              style={{
                padding: '12px 22px',
                borderRadius: 10,
                border: 'none',
                background:
                  saveAccountsLoading || adAccountsStatus !== 'ready' ? alpha.brand45 : ds.brand,
                color: '#fff',
                fontWeight: 700,
                cursor: saveAccountsLoading || adAccountsStatus !== 'ready' ? 'wait' : 'pointer',
                fontSize: 14,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {saveAccountsLoading ? (
                <>
                  <Spinner />
                  Guardando…
                </>
              ) : (
                'Guardar cuentas'
              )}
            </button>
          </div>
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
      { maxWidth: 720 },
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
