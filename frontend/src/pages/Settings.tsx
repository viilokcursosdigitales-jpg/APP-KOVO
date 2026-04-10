import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../auth/api';
import { useAuth, type OrgRole } from '../auth/AuthContext';
import {
  CARD_BG,
  META_BLUE,
  PAGE_BG,
  SHOPIFY_GREEN,
  SIDEBAR,
  inputStyle,
  labelStyle,
  linkStyle,
  primaryButton,
} from './authStyles';

type MemberRow = {
  id: number;
  name: string;
  email: string;
  role: OrgRole;
  is_active: number;
  created_at: string;
};

type InviteRow = {
  id: number;
  email: string;
  role: string;
  expires_at: string;
  created_at: string;
};

type Limits = {
  users: { used: number; max: number | null };
  meta: { used: number; max: number | null };
};

function ProgressBar({ used, max }: { used: number; max: number | null }) {
  const pct = max == null ? 0 : Math.min(100, (used / max) * 100);
  return (
    <div
      style={{
        height: 10,
        borderRadius: 5,
        background: '#e8eaef',
        overflow: 'hidden',
        marginTop: 8,
      }}
    >
      <div
        style={{
          width: max == null ? '8%' : `${pct}%`,
          height: '100%',
          background: max != null && used >= max ? '#f59e0b' : META_BLUE,
          transition: 'width 0.25s ease',
        }}
      />
    </div>
  );
}

export default function Settings() {
  const { user, organization, role, limits, refreshUser, canManageOrg } = useAuth();
  const [orgName, setOrgName] = useState(organization?.name ?? '');
  const [savingOrg, setSavingOrg] = useState(false);
  const [orgMsg, setOrgMsg] = useState('');

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invitations, setInvitations] = useState<InviteRow[]>([]);
  const [localLimits, setLocalLimits] = useState<Limits | null>(limits);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteErr, setInviteErr] = useState('');

  const loadTeam = useCallback(async () => {
    const res = await apiFetch('/api/organization/members');
    if (!res.ok) return;
    const data = (await res.json()) as {
      members: MemberRow[];
      invitations: InviteRow[];
      limits: Limits;
    };
    setMembers(data.members);
    setInvitations(data.invitations);
    setLocalLimits(data.limits);
  }, []);

  useEffect(() => {
    if (organization) setOrgName(organization.name);
  }, [organization]);

  useEffect(() => {
    setLocalLimits(limits);
  }, [limits]);

  useEffect(() => {
    if (canManageOrg) void loadTeam();
  }, [canManageOrg, loadTeam]);

  async function saveOrganization(e: FormEvent) {
    e.preventDefault();
    setOrgMsg('');
    const trimmed = orgName.trim();
    if (trimmed.length < 2) return;
    setSavingOrg(true);
    try {
      const res = await apiFetch('/api/organization', {
        method: 'PUT',
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setOrgMsg(typeof d.error === 'string' ? d.error : 'Error al guardar');
        return;
      }
      await refreshUser();
      setOrgMsg('Guardado');
    } finally {
      setSavingOrg(false);
    }
  }

  async function sendInvite(e: FormEvent) {
    e.preventDefault();
    setInviteErr('');
    setInviteLoading(true);
    try {
      const res = await apiFetch('/api/organization/invite', {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInviteErr(typeof d.error === 'string' ? d.error : 'No se pudo enviar');
        return;
      }
      setInviteEmail('');
      setInviteOpen(false);
      await loadTeam();
      await refreshUser();
    } finally {
      setInviteLoading(false);
    }
  }

  async function changeRole(memberId: number, newRole: OrgRole) {
    const res = await apiFetch(`/api/organization/members/${memberId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role: newRole }),
    });
    if (res.ok) {
      await loadTeam();
      await refreshUser();
    }
  }

  async function removeMember(memberId: number) {
    if (!window.confirm('¿Eliminar a este miembro del workspace?')) return;
    const res = await apiFetch(`/api/organization/members/${memberId}`, { method: 'DELETE' });
    if (res.ok) {
      await loadTeam();
      await refreshUser();
    }
  }

  if (!organization || !canManageOrg) {
    return null;
  }

  const planLabel =
    organization.plan === 'free' ? 'Gratuito' : organization.plan === 'pro' ? 'Pro' : 'Enterprise';

  return (
    <div
      style={{
        minHeight: '100vh',
        background: PAGE_BG,
        padding: 'clamp(20px, 4vw, 40px)',
        fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <Link to="/dashboard" style={{ ...linkStyle, display: 'inline-block', marginBottom: 20 }}>
          ← Volver al panel
        </Link>

        <h1 style={{ margin: '0 0 8px', fontSize: 28, color: SIDEBAR }}>Configuración</h1>
        <p style={{ margin: '0 0 28px', color: '#6b7280' }}>Workspace: {organization.slug}</p>

        {/* Mi organización */}
        <section
          style={{
            background: CARD_BG,
            borderRadius: 16,
            padding: 24,
            marginBottom: 20,
            border: '1px solid #e8eaef',
          }}
        >
          <h2 style={{ margin: '0 0 16px', fontSize: 18, color: SIDEBAR }}>Mi organización</h2>
          <form onSubmit={saveOrganization}>
            <label style={labelStyle}>
              Nombre de la empresa
              <input
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                style={{ ...inputStyle, marginTop: 8 }}
                minLength={2}
                required
              />
            </label>
            {orgMsg && (
              <p style={{ margin: '8px 0 0', fontSize: 14, color: orgMsg === 'Guardado' ? SHOPIFY_GREEN : '#dc2626' }}>
                {orgMsg}
              </p>
            )}
            <button
              type="submit"
              disabled={savingOrg}
              style={{
                ...primaryButton,
                marginTop: 16,
                width: 'auto',
                minWidth: 160,
                cursor: savingOrg ? 'wait' : 'pointer',
              }}
            >
              {savingOrg ? 'Guardando…' : 'Guardar nombre'}
            </button>
          </form>
        </section>

        {/* Equipo */}
        <section
          style={{
            background: CARD_BG,
            borderRadius: 16,
            padding: 24,
            marginBottom: 20,
            border: '1px solid #e8eaef',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 18, color: SIDEBAR }}>Equipo</h2>
            <button
              type="button"
              onClick={() => {
                setInviteErr('');
                setInviteOpen(true);
              }}
              style={{
                padding: '10px 18px',
                borderRadius: 10,
                border: 'none',
                background: META_BLUE,
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Invitar miembro
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#6b7280' }}>
                  <th style={{ padding: '10px 8px', borderBottom: '1px solid #e8eaef' }}>Miembro</th>
                  <th style={{ padding: '10px 8px', borderBottom: '1px solid #e8eaef' }}>Rol</th>
                  <th style={{ padding: '10px 8px', borderBottom: '1px solid #e8eaef' }}>Estado</th>
                  {role === 'owner' ? (
                    <th style={{ padding: '10px 8px', borderBottom: '1px solid #e8eaef' }}>Acciones</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const activeOwners = members.filter((x) => x.role === 'owner' && x.is_active);
                  const canRemove =
                    role === 'owner' &&
                    user != null &&
                    m.id !== user.id &&
                    (m.role !== 'owner' || activeOwners.length > 1);
                  return (
                    <tr key={m.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '12px 8px' }}>
                        <div style={{ fontWeight: 600, color: '#1a1a2e' }}>{m.name}</div>
                        <div style={{ fontSize: 13, color: '#6b7280' }}>{m.email}</div>
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        {role === 'owner' ? (
                          <select
                            value={m.role}
                            onChange={(e) => void changeRole(m.id, e.target.value as OrgRole)}
                            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #d1d5db' }}
                          >
                            <option value="owner">owner</option>
                            <option value="admin">admin</option>
                            <option value="member">member</option>
                          </select>
                        ) : (
                          <span style={{ textTransform: 'capitalize' }}>{m.role}</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '4px 10px',
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 600,
                            background: m.is_active ? `${SHOPIFY_GREEN}22` : '#fee2e2',
                            color: m.is_active ? '#3d5c1f' : '#b91c1c',
                          }}
                        >
                          {m.is_active ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      {role === 'owner' ? (
                        <td style={{ padding: '12px 8px' }}>
                          {canRemove ? (
                            <button
                              type="button"
                              onClick={() => void removeMember(m.id)}
                              style={{
                                border: 'none',
                                background: 'none',
                                color: '#dc2626',
                                cursor: 'pointer',
                                fontWeight: 600,
                                fontSize: 13,
                              }}
                            >
                              Eliminar
                            </button>
                          ) : (
                            <span style={{ color: '#9ca3af', fontSize: 13 }}>—</span>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
                {invitations.map((inv) => (
                  <tr key={`inv-${inv.id}`} style={{ borderBottom: '1px solid #f3f4f6', background: '#fafafa' }}>
                    <td style={{ padding: '12px 8px' }}>
                      <div style={{ fontWeight: 600, color: '#6b7280' }}>{inv.email}</div>
                      <div style={{ fontSize: 12, color: '#9ca3af' }}>Invitación pendiente</div>
                    </td>
                    <td style={{ padding: '12px 8px', textTransform: 'capitalize' }}>{inv.role}</td>
                    <td style={{ padding: '12px 8px' }}>
                      <span
                        style={{
                          padding: '4px 10px',
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 600,
                          background: `${META_BLUE}18`,
                          color: META_BLUE,
                        }}
                      >
                        Pendiente
                      </span>
                    </td>
                    {role === 'owner' ? <td style={{ padding: '12px 8px' }} /> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Plan */}
        <section
          style={{
            background: CARD_BG,
            borderRadius: 16,
            padding: 24,
            border: '1px solid #e8eaef',
          }}
        >
          <h2 style={{ margin: '0 0 16px', fontSize: 18, color: SIDEBAR }}>Plan actual</h2>
          <p style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700, color: META_BLUE }}>{planLabel}</p>
          <p style={{ margin: '0 0 20px', fontSize: 14, color: '#6b7280' }}>
            Uso dentro de los límites de tu suscripción.
          </p>

          {localLimits && (
            <>
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>
                  Usuarios (activos + invitaciones pendientes)
                </div>
                <div style={{ fontSize: 13, color: '#6b7280' }}>
                  {localLimits.users.used}{' '}
                  {localLimits.users.max != null ? `de ${localLimits.users.max}` : '(sin límite)'}
                </div>
                <ProgressBar used={localLimits.users.used} max={localLimits.users.max} />
              </div>
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Conexiones Meta</div>
                <div style={{ fontSize: 13, color: '#6b7280' }}>
                  {localLimits.meta.used}{' '}
                  {localLimits.meta.max != null ? `de ${localLimits.meta.max}` : '(sin límite)'}
                </div>
                <ProgressBar used={localLimits.meta.used} max={localLimits.meta.max} />
              </div>
            </>
          )}

          <button
            type="button"
            onClick={() => window.alert('Próximamente: checkout para mejorar tu plan.')}
            style={{
              padding: '12px 22px',
              borderRadius: 10,
              border: `2px solid ${SHOPIFY_GREEN}`,
              background: '#fff',
              color: '#3d5c1f',
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: 15,
            }}
          >
            Mejorar plan
          </button>
        </section>
      </div>

      {inviteOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(26,26,46,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            zIndex: 100,
          }}
          role="dialog"
          aria-modal
          aria-labelledby="invite-title"
        >
          <div
            style={{
              background: CARD_BG,
              borderRadius: 16,
              padding: 24,
              width: '100%',
              maxWidth: 400,
              boxShadow: '0 20px 50px rgba(0,0,0,0.2)',
            }}
          >
            <h3 id="invite-title" style={{ margin: '0 0 16px', color: SIDEBAR }}>
              Invitar miembro
            </h3>
            <form onSubmit={sendInvite}>
              <label style={labelStyle}>
                Email
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  style={{ ...inputStyle, marginTop: 8 }}
                />
              </label>
              <label style={{ ...labelStyle, marginTop: 16 }}>
                Rol
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
                  style={{ ...inputStyle, marginTop: 8 }}
                >
                  <option value="member">Miembro</option>
                  <option value="admin">Administrador</option>
                </select>
              </label>
              {inviteErr && (
                <p style={{ color: '#dc2626', fontSize: 14, marginTop: 12 }}>{inviteErr}</p>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button
                  type="button"
                  onClick={() => setInviteOpen(false)}
                  style={{
                    flex: 1,
                    padding: '12px 16px',
                    borderRadius: 10,
                    border: '1px solid #d1d5db',
                    background: '#fff',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={inviteLoading}
                  style={{
                    flex: 1,
                    ...primaryButton,
                    margin: 0,
                    opacity: inviteLoading ? 0.85 : 1,
                  }}
                >
                  {inviteLoading ? 'Enviando…' : 'Enviar invitación'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
