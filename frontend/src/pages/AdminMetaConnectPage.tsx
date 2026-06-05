import { useCallback, useEffect, useState } from 'react';
import {
  IconCheck,
  IconEye,
  IconEyeOff,
  IconPlugConnected,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react';
import { apiFetch } from '../auth/api';
import { ModalConfirmar } from '../components/planeacion/ModalConfirmar';
import { PageHeader } from '../design-system/PageHeader';
import { ds } from '../design-system/ds';
import { KOVO_META_CONNECTION_EVENT } from '../meta/useMetaInsightsReady';

type MetaConnectionRow = {
  id: number;
  label: string | null;
  account_name: string;
  status: string;
  selected_ad_account_ids: string[];
  token_type: string;
  token_expires_at: string | null;
  connected_at: string;
  insights_ready?: boolean;
};

type AdAccountRow = {
  id: string;
  name: string;
  account_status?: number;
  currency?: string;
};

const INSTRUCTION_STEPS = [
  'Ir a business.facebook.com → Configuración → Usuarios → Usuarios del sistema',
  'Crear un Usuario del sistema con rol "Empleado"',
  'Clic en "Agregar activos" → seleccionar Cuentas publicitarias → asignar permiso "Analista" (solo lectura)',
  'Clic en "Generar token" → seleccionar la app de Kovo → marcar permisos: ads_read, read_insights',
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

function notifyMetaConnectionChanged() {
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

function formatDateTime(iso: string | null): string {
  if (!iso) return 'Sin vencimiento';
  try {
    return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function connectionLabel(c: MetaConnectionRow): string {
  return (c.label && c.label.trim()) || c.account_name || `Conexión #${c.id}`;
}

export default function AdminMetaConnectPage() {
  const [adAccountIdsInput, setAdAccountIdsInput] = useState('');
  const [systemToken, setSystemToken] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState<{ connectionId: number; message: string } | null>(null);

  const [connections, setConnections] = useState<MetaConnectionRow[]>([]);
  const [listLoading, setListLoading] = useState(true);

  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    ok: boolean;
    accounts?: AdAccountRow[];
    error?: string;
  } | null>(null);

  const [disconnectTarget, setDisconnectTarget] = useState<MetaConnectionRow | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const [updateTarget, setUpdateTarget] = useState<MetaConnectionRow | null>(null);
  const [updateToken, setUpdateToken] = useState('');
  const [updateShowToken, setUpdateShowToken] = useState(false);
  const [updateSaving, setUpdateSaving] = useState(false);
  const [updateError, setUpdateError] = useState('');

  const loadConnections = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await apiFetch('/api/meta/connections');
      if (!res.ok) {
        setConnections([]);
        return;
      }
      const data = (await res.json()) as { connections?: MetaConnectionRow[] };
      const rows = Array.isArray(data.connections) ? data.connections : [];
      setConnections(rows.filter((c) => c.token_type === 'system_user'));
    } catch {
      setConnections([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSuccess(null);
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
        code?: string;
        connection?: { id: number };
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

      setSuccess({
        connectionId,
        message: 'Conexión guardada correctamente. Usa "Verificar conexión" para confirmar el acceso a Meta.',
      });
      setSystemToken('');
      setAdAccountIdsInput('');
      setLabelInput('');
      notifyMetaConnectionChanged();
      await loadConnections();
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
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        accounts?: AdAccountRow[];
      };
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

  const handleDisconnect = async () => {
    if (!disconnectTarget) return;
    setDisconnecting(true);
    try {
      await apiFetch(`/api/meta/connections/${disconnectTarget.id}`, { method: 'DELETE' });
      notifyMetaConnectionChanged();
      await loadConnections();
      if (success?.connectionId === disconnectTarget.id) setSuccess(null);
    } finally {
      setDisconnecting(false);
      setDisconnectTarget(null);
    }
  };

  const handleUpdateToken = async () => {
    if (!updateTarget) return;
    const token = updateToken.trim();
    if (!token) {
      setUpdateError('Pega el nuevo token.');
      return;
    }
    setUpdateSaving(true);
    setUpdateError('');
    try {
      const res = await apiFetch(`/api/meta/connections/${updateTarget.id}/system-token`, {
        method: 'PUT',
        body: JSON.stringify({ accessToken: token }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setUpdateError(body.error || `Error ${res.status}`);
        return;
      }
      setUpdateTarget(null);
      setUpdateToken('');
      notifyMetaConnectionChanged();
      await loadConnections();
    } catch {
      setUpdateError('Error de red.');
    } finally {
      setUpdateSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Meta — System User (integrador)"
        subtitle="Conexión interna por token de usuario del sistema. No uses esta pantalla para el flujo OAuth de clientes."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
          gap: 20,
          marginBottom: 28,
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
            {INSTRUCTION_STEPS.map((step, i) => (
              <li key={i} style={{ marginBottom: 10 }}>
                <strong style={{ color: ds.textPrimary }}>Paso {i + 1}:</strong> {step}
              </li>
            ))}
          </ol>
          <p style={{ margin: '16px 0 0', fontSize: 12, color: ds.textMuted, lineHeight: 1.45 }}>
            La app de Kovo y su App Secret deben estar configuradas en el servidor (
            <code style={{ fontSize: 11 }}>META_APP_ID</code>, <code style={{ fontSize: 11 }}>META_APP_SECRET</code>
            ). El token debe generarse para esa misma app.
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
            Nueva conexión
          </h2>
          <form onSubmit={(ev) => void handleSubmit(ev)}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: ds.textSecondary }}>
              Etiqueta de conexión
              <input
                type="text"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                placeholder="Nombre del cliente o identificador"
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
                Encuéntralo en Meta Ads Manager → selector de cuenta arriba a la izquierda
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

            {success ? (
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
                    <div style={{ fontWeight: 600 }}>{success.message}</div>
                    <div style={{ marginTop: 4, fontSize: 12 }}>ID de conexión: {success.connectionId}</div>
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
                      ? `${verifyResult.accounts.length} cuenta(s) accesible(s): ${verifyResult.accounts
                          .map((a) => a.name || a.id)
                          .join(', ')}`
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

      <section
        style={{
          background: ds.bgCard,
          border: `1px solid ${ds.borderCard}`,
          borderRadius: 14,
          padding: '20px 22px',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: ds.textPrimary }}>
            Conexiones System User
          </h2>
          <button
            type="button"
            onClick={() => void loadConnections()}
            disabled={listLoading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 12px',
              borderRadius: 8,
              border: `1px solid ${ds.borderCard}`,
              background: ds.bgSubtle,
              fontSize: 12,
              fontWeight: 600,
              color: ds.textSecondary,
              cursor: listLoading ? 'wait' : 'pointer',
            }}
          >
            <IconRefresh size={16} />
            Actualizar lista
          </button>
        </div>

        {listLoading ? (
          <p style={{ margin: 0, fontSize: 13, color: ds.textMuted }}>Cargando…</p>
        ) : connections.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: ds.textMuted }}>
            No hay conexiones con token de usuario del sistema en esta organización.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {connections.map((c) => (
              <div
                key={c.id}
                style={{
                  border: `1px solid ${ds.borderCard}`,
                  borderRadius: 12,
                  padding: '14px 16px',
                  background: ds.bgSubtle,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <div style={{ minWidth: 0, flex: '1 1 200px' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: ds.textPrimary }}>
                      {connectionLabel(c)}
                    </div>
                    <div style={{ fontSize: 12, color: ds.textMuted, marginTop: 4 }}>
                      ID conexión {c.id} · Estado:{' '}
                      <span style={{ color: c.status === 'connected' ? ds.successText : ds.textSecondary }}>
                        {c.status}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: ds.textSecondary, marginTop: 8, lineHeight: 1.5 }}>
                      <div>
                        <strong>Cuentas:</strong>{' '}
                        {c.selected_ad_account_ids.length
                          ? c.selected_ad_account_ids.join(', ')
                          : '(ninguna seleccionada)'}
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <strong>Token:</strong> {formatDateTime(c.token_expires_at)}
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <strong>Insights listos:</strong> {c.insights_ready ? 'Sí' : 'No'}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setUpdateTarget(c);
                        setUpdateToken('');
                        setUpdateError('');
                        setUpdateShowToken(false);
                      }}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: `1px solid ${ds.borderCard}`,
                        background: ds.bgCard,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        color: ds.textPrimary,
                      }}
                    >
                      Actualizar token
                    </button>
                    <button
                      type="button"
                      onClick={() => setDisconnectTarget(c)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: `1px solid ${ds.borderCard}`,
                        background: ds.dangerBg,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        color: ds.dangerText,
                      }}
                    >
                      <IconTrash size={14} />
                      Desconectar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <ModalConfirmar
        open={Boolean(disconnectTarget)}
        titulo="Desconectar Meta"
        mensaje={
          disconnectTarget
            ? `¿Eliminar la conexión "${connectionLabel(disconnectTarget)}"? Las métricas live dejarán de usar este token.`
            : ''
        }
        etiquetaConfirmar={disconnecting ? 'Eliminando…' : 'Desconectar'}
        peligro
        onConfirmar={() => void handleDisconnect()}
        onCancelar={() => setDisconnectTarget(null)}
      />

      {updateTarget ? (
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
          onClick={() => !updateSaving && setUpdateTarget(null)}
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
              Conexión: <strong>{connectionLabel(updateTarget)}</strong> (ID {updateTarget.id})
            </p>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: ds.textSecondary }}>
              Nuevo token de usuario del sistema
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
                onClick={() => setUpdateTarget(null)}
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
    </>
  );
}
