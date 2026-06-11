import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  IconAdjustmentsHorizontal,
  IconChartLine,
  IconCheck,
  IconEye,
  IconEyeOff,
  IconPlugConnected,
  IconReportMoney,
  IconSparkles,
} from '@tabler/icons-react';
import { apiFetch } from './auth/api';
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

function parseAdAccountIdsInput(raw: string): string[] {
  const parts = raw.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const n = normalizeActId(p);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
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
  tokenType: string;
};

const INSTRUCTION_STEPS = [
  'Ir a business.facebook.com → Configuración → Usuarios → Usuarios del sistema',
  'Crear un Usuario del sistema con rol "Empleado"',
  'Clic en "Agregar activos" → seleccionar Cuentas publicitarias → asignar permiso "Analista" (solo lectura)',
  'Clic en "Generar token" → seleccionar la app de KOVO → marcar permisos: ads_read, read_insights',
  'Copiar el token generado y pegarlo abajo',
];

const fieldStyle: React.CSSProperties = {
  width: '100%',
  marginTop: 6,
  padding: '10px 11px',
  borderRadius: 10,
  border: `1px solid ${ds.borderCard}`,
  background: ds.bgSubtle,
  color: ds.textPrimary,
  fontSize: 13,
  boxSizing: 'border-box',
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
    invalid_state: 'La sesión de enlace expiró o no es válida. Vuelve a conectar.',
    user_mismatch: 'El usuario de KOVO no coincide con la sesión. Cierra sesión y vuelve a entrar.',
    token_exchange: 'Meta no aceptó el código de autorización.',
    long_lived_exchange: 'No se pudo obtener el token de larga duración.',
    missing_params: 'Faltan parámetros en la respuesta de Meta.',
    server_config: 'OAuth Meta no está configurado en el servidor.',
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

function mapConnectionRow(c: {
  id: number;
  account_name: string;
  connected_at: string;
  app_id_hint: string;
  selected_ad_account_ids?: string[];
  insights_ready?: boolean;
  token_type?: string;
}): SavedConnection {
  const sel = Array.isArray(c.selected_ad_account_ids) ? c.selected_ad_account_ids.map(String) : [];
  return {
    connectionId: c.id,
    accountName: c.account_name,
    connectedAt: c.connected_at,
    appIdHint: c.app_id_hint,
    selectedAdAccountIds: sel,
    insightsReady: Boolean(c.insights_ready),
    tokenType: c.token_type || 'system_user',
  };
}

export default function ConexionMetaADS() {
  const { refreshUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [saved, setSaved] = useState<SavedConnection | null>(null);
  const [step, setStep] = useState<FlowStep>('home');
  const [bootstrapLoading, setBootstrapLoading] = useState(true);

  const [adAccountIdsInput, setAdAccountIdsInput] = useState('');
  const [systemToken, setSystemToken] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [connectSuccess, setConnectSuccess] = useState<string | null>(null);

  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; accounts?: MetaAdAccountRow[]; error?: string } | null>(
    null,
  );

  const [adAccounts, setAdAccounts] = useState<MetaAdAccountRow[]>([]);
  const [adAccountsStatus, setAdAccountsStatus] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle');
  const [adAccountsError, setAdAccountsError] = useState<string | null>(null);
  const [selectedActIds, setSelectedActIds] = useState<string[]>([]);
  const [saveAccountsLoading, setSaveAccountsLoading] = useState(false);
  const [saveAccountsError, setSaveAccountsError] = useState<string | null>(null);

  const [updateTokenOpen, setUpdateTokenOpen] = useState(false);
  const [updateToken, setUpdateToken] = useState('');
  const [updateShowToken, setUpdateShowToken] = useState(false);
  const [updateSaving, setUpdateSaving] = useState(false);
  const [updateError, setUpdateError] = useState('');

  const loadExistingConnection = useCallback(async () => {
    const res = await apiFetch(`/api/meta/connections?_=${Date.now()}`);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      connections: Array<{
        id: number;
        status: string;
        account_name: string;
        connected_at: string;
        app_id_hint: string;
        selected_ad_account_ids?: string[];
        insights_ready?: boolean;
        token_type?: string;
      }>;
    };
    const c = data.connections.find((x) => x.status === 'connected');
    if (!c) return null;
    return mapConnectionRow(c);
  }, []);

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
          const conn = await loadExistingConnection();
          if (cancelled || !conn) return;
          setSaved(conn);
          setStep('success');
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
  }, [searchParams, setSearchParams, refreshUser, loadExistingConnection]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const conn = await loadExistingConnection();
        if (cancelled) return;
        if (conn) {
          setSaved(conn);
          setStep('success');
        } else {
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
  }, [loadExistingConnection]);

  const handleSystemUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setConnectSuccess(null);
    setVerifyResult(null);

    const token = systemToken.trim();
    if (!token) {
      setFormError('Pega el token de usuario del sistema.');
      return;
    }

    const adAccountIds = parseAdAccountIdsInput(adAccountIdsInput);
    if (adAccountIds.length === 0) {
      setFormError('Indica al menos un ID de cuenta publicitaria (ej. act_123456789).');
      return;
    }

    setSubmitting(true);
    try {
      const postRes = await apiFetch('/api/meta/connections', {
        method: 'POST',
        body: JSON.stringify({
          tokenType: 'system_user',
          accessToken: token,
          adAccountIds,
          label: labelInput.trim() || undefined,
        }),
      });
      const postBody = (await postRes.json().catch(() => ({}))) as {
        error?: string;
        connection?: { id: number; account_name?: string; insights_ready?: boolean };
      };

      if (!postRes.ok) {
        setFormError(postBody.error || `Error ${postRes.status} al guardar la conexión`);
        return;
      }

      const connectionId = postBody.connection?.id;
      if (!connectionId) {
        setFormError('La API no devolvió el ID de conexión.');
        return;
      }

      const putRes = await apiFetch(`/api/meta/connections/${connectionId}/ad-accounts`, {
        method: 'PUT',
        body: JSON.stringify({ adAccountIds }),
      });
      const putBody = (await putRes.json().catch(() => ({}))) as { error?: string };
      if (!putRes.ok) {
        setFormError(
          putBody.error ||
            'Conexión creada pero no se pudieron guardar las cuentas publicitarias. Revisa los IDs.',
        );
        return;
      }

      const conn = await loadExistingConnection();
      if (conn) {
        setSaved(conn);
        setStep('success');
      }

      setConnectSuccess('Conexión guardada correctamente.');
      setSystemToken('');
      setAdAccountIdsInput('');
      setLabelInput('');
      notifyMetaDashboardRefresh();
      await refreshUser();
    } catch {
      setFormError('Error de red al contactar el servidor.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async () => {
    setVerifyLoading(true);
    setVerifyResult(null);
    try {
      const res = await apiFetch('/api/meta/ad-accounts');
      const body = (await res.json().catch(() => ({}))) as { error?: string; accounts?: MetaAdAccountRow[] };
      if (!res.ok) {
        setVerifyResult({ ok: false, error: body.error || `Error ${res.status}` });
        return;
      }
      setVerifyResult({ ok: true, accounts: Array.isArray(body.accounts) ? body.accounts : [] });
    } catch {
      setVerifyResult({ ok: false, error: 'Error de red al verificar.' });
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleUpdateToken = async () => {
    if (!saved) return;
    const token = updateToken.trim();
    if (!token) {
      setUpdateError('Pega el nuevo token.');
      return;
    }
    setUpdateSaving(true);
    setUpdateError('');
    try {
      const res = await apiFetch(`/api/meta/connections/${saved.connectionId}/system-token`, {
        method: 'PUT',
        body: JSON.stringify({ accessToken: token }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setUpdateError(body.error || `Error ${res.status}`);
        return;
      }
      setUpdateTokenOpen(false);
      setUpdateToken('');
      notifyMetaDashboardRefresh();
      await refreshUser();
    } catch {
      setUpdateError('Error de red.');
    } finally {
      setUpdateSaving(false);
    }
  };

  const handleDisconnect = useCallback(async () => {
    if (!window.confirm('¿Desconectar Meta de KOVO?')) return;
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
    setConnectSuccess(null);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recargar solo al cambiar conexión
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

  const badgeStatus: 'disconnected' | 'loading' | 'connected' | 'error' = bootstrapLoading || submitting
    ? 'loading'
    : step === 'success' && saved
      ? 'connected'
      : 'disconnected';

  const shell = (children: ReactNode, opts?: { maxWidth?: number }) => (
    <div style={{ maxWidth: opts?.maxWidth ?? 960, margin: '0 auto' }}>
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
      <>
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

          <div style={{ marginBottom: 24, paddingTop: 20, borderTop: `1px solid ${ds.borderCard}` }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: ds.textPrimary }}>
              Cuentas publicitarias
            </h2>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: ds.textSecondary, lineHeight: 1.5, maxWidth: 640 }}>
              Marca las cuentas de las que quieres ver gasto, campañas y embudo en KOVO.
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
                Meta no devolvió cuentas publicitarias. Revisa que el usuario del sistema tenga acceso analista a las
                cuentas y que el token incluya ads_read y read_insights.
              </p>
            ) : null}

            {adAccountsStatus === 'ready' && adAccounts.length > 0 ? (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12, alignItems: 'center' }}>
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
                  background: saveAccountsLoading || adAccountsStatus !== 'ready' ? alpha.brand45 : ds.brand,
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

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {saved.tokenType === 'system_user' ? (
              <button
                type="button"
                onClick={() => {
                  setUpdateTokenOpen(true);
                  setUpdateToken('');
                  setUpdateError('');
                  setUpdateShowToken(false);
                }}
                style={{
                  padding: '12px 22px',
                  borderRadius: 10,
                  border: `1px solid ${ds.borderCard}`,
                  background: ds.bgSubtle,
                  color: ds.textPrimary,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                Actualizar token
              </button>
            ) : null}
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
        </div>

        {updateTokenOpen ? (
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1000,
              background: 'rgba(15, 23, 42, 0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
            }}
            onClick={() => !updateSaving && setUpdateTokenOpen(false)}
          >
            <div
              style={{
                width: '100%',
                maxWidth: 440,
                background: ds.bgCard,
                borderRadius: 14,
                border: `1px solid ${ds.borderCard}`,
                padding: '22px 24px',
                boxShadow: '0 12px 40px rgba(0,0,0,0.12)',
              }}
              onClick={(ev) => ev.stopPropagation()}
            >
              <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700 }}>Actualizar token</h3>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: ds.textSecondary }}>
                Pega el nuevo token de usuario del sistema generado en Business Manager.
              </p>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: ds.textSecondary }}>
                Nuevo token
                <div style={{ position: 'relative', marginTop: 6 }}>
                  <textarea
                    value={updateToken}
                    onChange={(e) => setUpdateToken(e.target.value)}
                    rows={4}
                    autoComplete="off"
                    spellCheck={false}
                    style={{
                      ...fieldStyle,
                      marginTop: 0,
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: 12,
                      paddingRight: 44,
                      WebkitTextSecurity: updateShowToken ? 'none' : 'disc',
                    } as React.CSSProperties}
                  />
                  <button
                    type="button"
                    onClick={() => setUpdateShowToken((v) => !v)}
                    style={{
                      position: 'absolute',
                      top: 10,
                      right: 8,
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      color: ds.textMuted,
                    }}
                  >
                    {updateShowToken ? <IconEyeOff size={18} /> : <IconEye size={18} />}
                  </button>
                </div>
              </label>
              {updateError ? (
                <p style={{ margin: '12px 0 0', fontSize: 13, color: ds.dangerText }}>{updateError}</p>
              ) : null}
              <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  disabled={updateSaving}
                  onClick={() => setUpdateTokenOpen(false)}
                  style={{
                    padding: '10px 16px',
                    borderRadius: 8,
                    border: `1px solid ${ds.borderCard}`,
                    background: 'transparent',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={updateSaving}
                  onClick={() => void handleUpdateToken()}
                  style={{
                    padding: '10px 16px',
                    borderRadius: 8,
                    border: 'none',
                    background: ds.brand,
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: updateSaving ? 'wait' : 'pointer',
                  }}
                >
                  {updateSaving ? 'Guardando…' : 'Guardar token'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </>,
      { maxWidth: 720 },
    );
  }

  return shell(
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <StatusBadge status={badgeStatus} />
      </div>

      <ul
        style={{
          margin: '0 0 24px',
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {META_BENEFITS.map(({ label, Icon }) => (
          <li key={label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
            <span style={{ fontSize: 14, color: ds.textPrimary, lineHeight: 1.45, fontWeight: 500 }}>{label}</span>
          </li>
        ))}
      </ul>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
          gap: 20,
        }}
      >
        <section
          style={{
            background: ds.bgCard,
            border: `1px solid ${ds.borderCard}`,
            borderRadius: 14,
            padding: '20px 22px',
          }}
        >
          <h2 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700, color: ds.textPrimary }}>
            Instrucciones en Business Manager
          </h2>
          <ol style={{ margin: 0, paddingLeft: 20, color: ds.textSecondary, fontSize: 13, lineHeight: 1.55 }}>
            {INSTRUCTION_STEPS.map((stepText, i) => (
              <li key={i} style={{ marginBottom: 10 }}>
                <strong style={{ color: ds.textPrimary }}>Paso {i + 1}:</strong> {stepText}
              </li>
            ))}
          </ol>
          <p style={{ margin: '16px 0 0', fontSize: 12, color: ds.textMuted, lineHeight: 1.45 }}>
            El token debe generarse para la app de KOVO en tu Business Manager, con permisos de solo lectura.
          </p>
        </section>

        <section
          style={{
            background: ds.bgCard,
            border: `1px solid ${ds.borderCard}`,
            borderRadius: 14,
            padding: '20px 22px',
          }}
        >
          <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: ds.textPrimary }}>
            Conectar Meta
          </h2>
          <form onSubmit={(ev) => void handleSystemUserSubmit(ev)}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: ds.textSecondary }}>
              Nombre de la conexión (opcional)
              <input
                type="text"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                placeholder="Ej. Mi tienda"
                maxLength={255}
                style={fieldStyle}
              />
            </label>

            <label style={{ display: 'block', marginTop: 14, fontSize: 12, fontWeight: 600, color: ds.textSecondary }}>
              IDs de cuenta publicitaria
              <input
                type="text"
                value={adAccountIdsInput}
                onChange={(e) => setAdAccountIdsInput(e.target.value)}
                placeholder="act_123456789, act_987654321"
                style={fieldStyle}
                autoComplete="off"
                spellCheck={false}
              />
              <span style={{ display: 'block', marginTop: 6, fontSize: 11, color: ds.textMuted, fontWeight: 400 }}>
                Lo encuentras en Meta Ads Manager → selector de cuenta arriba a la izquierda
              </span>
            </label>

            <label style={{ display: 'block', marginTop: 14, fontSize: 12, fontWeight: 600, color: ds.textSecondary }}>
              Token de usuario del sistema
              <div style={{ position: 'relative', marginTop: 6 }}>
                <textarea
                  value={systemToken}
                  onChange={(e) => setSystemToken(e.target.value)}
                  rows={4}
                  autoComplete="off"
                  spellCheck={false}
                  style={{
                    ...fieldStyle,
                    marginTop: 0,
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 12,
                    paddingRight: 44,
                    resize: 'vertical',
                    WebkitTextSecurity: showToken ? 'none' : 'disc',
                  } as React.CSSProperties}
                />
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  aria-label={showToken ? 'Ocultar token' : 'Mostrar token'}
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 8,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    color: ds.textMuted,
                    padding: 4,
                  }}
                >
                  {showToken ? <IconEyeOff size={18} /> : <IconEye size={18} />}
                </button>
              </div>
            </label>

            {formError ? (
              <p
                role="alert"
                style={{
                  margin: '14px 0 0',
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: ds.dangerBg,
                  color: ds.dangerText,
                  fontSize: 13,
                }}
              >
                {formError}
              </p>
            ) : null}

            {connectSuccess ? (
              <div
                style={{
                  marginTop: 14,
                  padding: '12px 14px',
                  borderRadius: 10,
                  background: '#ecfdf5',
                  border: '1px solid #86efac',
                  color: '#166534',
                  fontSize: 13,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <IconCheck size={18} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <div style={{ fontWeight: 600 }}>{connectSuccess}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleVerify()}
                  disabled={verifyLoading}
                  style={{
                    marginTop: 12,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: '1px solid #86efac',
                    background: '#fff',
                    color: '#166534',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: verifyLoading ? 'wait' : 'pointer',
                  }}
                >
                  <IconPlugConnected size={16} />
                  {verifyLoading ? 'Verificando…' : 'Verificar conexión'}
                </button>
              </div>
            ) : null}

            {verifyResult ? (
              <div
                style={{
                  marginTop: 12,
                  padding: '10px 12px',
                  borderRadius: 10,
                  fontSize: 13,
                  background: verifyResult.ok ? ds.bgSubtle : ds.dangerBg,
                  color: verifyResult.ok ? ds.textPrimary : ds.dangerText,
                  border: `1px solid ${verifyResult.ok ? ds.borderCard : 'transparent'}`,
                }}
              >
                {verifyResult.ok ? (
                  <>
                    <strong>Token válido.</strong>{' '}
                    {verifyResult.accounts?.length
                      ? `${verifyResult.accounts.length} cuenta(s) accesible(s).`
                      : 'Meta respondió sin cuentas (revisa permisos del system user).'}
                  </>
                ) : (
                  verifyResult.error
                )}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              style={{
                marginTop: 18,
                width: '100%',
                padding: '12px 16px',
                borderRadius: 10,
                border: 'none',
                background: ds.brand,
                color: '#fff',
                fontSize: 14,
                fontWeight: 600,
                cursor: submitting ? 'wait' : 'pointer',
                opacity: submitting ? 0.85 : 1,
              }}
            >
              {submitting ? 'Guardando…' : 'Guardar conexión'}
            </button>
          </form>
        </section>
      </div>
    </>,
  );
}
