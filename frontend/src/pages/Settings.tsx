import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../auth/api';
import { useAuth } from '../auth/AuthContext';
import { ds } from '../design-system/ds';
import { PageHeader } from '../design-system/PageHeader';
import { inputStyle, labelStyle, primaryButton } from './authStyles';

type MemberRow = {
  id: number;
  name: string;
  email: string;
  role: string;
  is_active: number;
  created_at: string;
};

type CustomRoleRow = {
  id: number;
  slug: string;
  label: string;
  base_role: 'admin' | 'member';
  created_at?: string;
};

function formatRoleLabel(slug: string, custom: CustomRoleRow[]) {
  const c = custom.find((x) => x.slug === slug);
  if (c) return `${c.label} (${c.base_role === 'admin' ? 'como admin' : 'como miembro'})`;
  if (slug === 'owner') return 'Propietario';
  if (slug === 'admin') return 'Administrador';
  if (slug === 'member') return 'Miembro';
  return slug;
}

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
        background: ds.borderCard,
        overflow: 'hidden',
        marginTop: 8,
      }}
    >
      <div
        style={{
          width: max == null ? '8%' : `${pct}%`,
          height: '100%',
          background: max != null && used >= max ? ds.warningText : ds.brand,
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
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteErr, setInviteErr] = useState('');

  const [customRoles, setCustomRoles] = useState<CustomRoleRow[]>([]);
  const [newRoleLabel, setNewRoleLabel] = useState('');
  const [newRoleBase, setNewRoleBase] = useState<'admin' | 'member'>('member');
  const [roleSaving, setRoleSaving] = useState(false);
  const [roleMsg, setRoleMsg] = useState('');

  const loadTeam = useCallback(async () => {
    const res = await apiFetch('/api/organization/members');
    if (!res.ok) return;
    const data = (await res.json()) as {
      members: MemberRow[];
      invitations: InviteRow[];
      custom_roles?: CustomRoleRow[];
      limits: Limits;
    };
    setMembers(data.members);
    setInvitations(data.invitations);
    setCustomRoles(Array.isArray(data.custom_roles) ? data.custom_roles : []);
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
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole.trim() }),
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

  async function changeRole(memberId: number, newRole: string) {
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

  async function addCustomRole(e: FormEvent) {
    e.preventDefault();
    setRoleMsg('');
    const trimmed = newRoleLabel.trim();
    if (trimmed.length < 2) return;
    setRoleSaving(true);
    try {
      const res = await apiFetch('/api/organization/custom-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: trimmed, base_role: newRoleBase }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRoleMsg(typeof d.error === 'string' ? d.error : 'No se pudo crear el rol');
        return;
      }
      setNewRoleLabel('');
      setRoleMsg('Rol agregado.');
      await loadTeam();
    } finally {
      setRoleSaving(false);
    }
  }

  async function deleteCustomRole(id: number) {
    if (!window.confirm('¿Eliminar este nombre de rol?')) return;
    setRoleMsg('');
    const res = await apiFetch(`/api/organization/custom-roles/${id}`, { method: 'DELETE' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setRoleMsg(typeof d.error === 'string' ? d.error : 'No se pudo eliminar');
      return;
    }
    await loadTeam();
  }

  if (!organization || !canManageOrg) {
    return null;
  }

  const planLabel =
    organization.plan === 'free' ? 'Gratuito' : organization.plan === 'pro' ? 'Pro' : 'Enterprise';

  return (
    <div style={{ maxWidth: 720 }}>
      <PageHeader title="Configuración" subtitle={`Workspace: ${organization.slug}`} />

        {/* Mi organización */}
        <section
          style={{
            background: ds.bgCard,
            borderRadius: 14,
            padding: '18px 20px',
            marginBottom: 20,
            border: `1px solid ${ds.borderCard}`,
          }}
        >
          <h2 style={{ margin: '0 0 16px', fontSize: 13, fontWeight: 600, color: ds.textPrimary }}>Mi organización</h2>
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
              <p
                style={{
                  margin: '8px 0 0',
                  fontSize: 13,
                  color: orgMsg === 'Guardado' ? ds.successText : ds.dangerText,
                }}
              >
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

        {role === 'owner' ? (
          <section
            style={{
              background: ds.bgCard,
              borderRadius: 14,
              padding: '18px 20px',
              marginBottom: 20,
              border: `1px solid ${ds.borderCard}`,
            }}
          >
            <h2 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: ds.textPrimary }}>
              Nombres de roles
            </h2>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: ds.textSecondary, lineHeight: 1.45 }}>
              Crea etiquetas para tu equipo (por ejemplo «Ventas», «Logística»). Cada una hereda permisos de{' '}
              <strong>administrador</strong> o <strong>miembro</strong>; luego podrás asignarlas al invitar o al
              cambiar el rol de alguien.
            </p>
            <form onSubmit={addCustomRole} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 16 }}>
              <label style={{ ...labelStyle, flex: '1 1 200px', margin: 0 }}>
                Nombre del rol
                <input
                  value={newRoleLabel}
                  onChange={(e) => setNewRoleLabel(e.target.value)}
                  placeholder="Ej. Coordinador de envíos"
                  style={{ ...inputStyle, marginTop: 8 }}
                  minLength={2}
                  maxLength={120}
                />
              </label>
              <label style={{ ...labelStyle, flex: '0 0 160px', margin: 0 }}>
                Permisos como
                <select
                  value={newRoleBase}
                  onChange={(e) => setNewRoleBase(e.target.value as 'admin' | 'member')}
                  style={{ ...inputStyle, marginTop: 8 }}
                >
                  <option value="member">Miembro</option>
                  <option value="admin">Administrador</option>
                </select>
              </label>
              <button
                type="submit"
                disabled={roleSaving || newRoleLabel.trim().length < 2}
                style={{
                  ...primaryButton,
                  margin: 0,
                  width: 'auto',
                  minWidth: 120,
                  opacity: roleSaving || newRoleLabel.trim().length < 2 ? 0.7 : 1,
                  cursor: roleSaving ? 'wait' : 'pointer',
                }}
              >
                {roleSaving ? 'Guardando…' : 'Agregar rol'}
              </button>
            </form>
            {roleMsg ? (
              <p style={{ margin: '0 0 12px', fontSize: 12, color: roleMsg.includes('agregado') ? ds.successText : ds.dangerText }}>
                {roleMsg}
              </p>
            ) : null}
            {customRoles.length ? (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {customRoles.map((cr) => (
                  <li
                    key={cr.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '10px 0',
                      borderTop: `1px solid ${ds.borderRow}`,
                      fontSize: 13,
                    }}
                  >
                    <span>
                      <strong style={{ color: ds.textPrimary }}>{cr.label}</strong>
                      <span style={{ color: ds.textMuted, marginLeft: 8 }}>
                        · {cr.base_role === 'admin' ? 'permisos de administrador' : 'permisos de miembro'}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void deleteCustomRole(cr.id)}
                      style={{
                        border: 'none',
                        background: 'none',
                        color: ds.dangerText,
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: 12,
                      }}
                    >
                      Eliminar
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: 0, fontSize: 12, color: ds.textMuted }}>Aún no hay roles personalizados.</p>
            )}
          </section>
        ) : null}

        {/* Equipo */}
        <section
          style={{
            background: ds.bgCard,
            borderRadius: 14,
            padding: '18px 20px',
            marginBottom: 20,
            border: `1px solid ${ds.borderCard}`,
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: ds.textPrimary }}>Equipo</h2>
            <button
              type="button"
              onClick={() => {
                setInviteErr('');
                setInviteOpen(true);
              }}
              style={{
                ...primaryButton,
                width: 'auto',
                padding: '8px 18px',
              }}
            >
              Invitar miembro
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
              <thead style={{ background: ds.bgApp }}>
                <tr style={{ textAlign: 'left' }}>
                  <th
                    style={{
                      padding: '11px 16px',
                      borderBottom: `1px solid ${ds.borderRow}`,
                      fontSize: 10.5,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.4px',
                      color: ds.textHint,
                    }}
                  >
                    Miembro
                  </th>
                  <th
                    style={{
                      padding: '11px 16px',
                      borderBottom: `1px solid ${ds.borderRow}`,
                      fontSize: 10.5,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.4px',
                      color: ds.textHint,
                    }}
                  >
                    Rol
                  </th>
                  <th
                    style={{
                      padding: '11px 16px',
                      borderBottom: `1px solid ${ds.borderRow}`,
                      fontSize: 10.5,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.4px',
                      color: ds.textHint,
                    }}
                  >
                    Estado
                  </th>
                  {role === 'owner' ? (
                    <th
                      style={{
                        padding: '11px 16px',
                        borderBottom: `1px solid ${ds.borderRow}`,
                        fontSize: 10.5,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.4px',
                        color: ds.textHint,
                      }}
                    >
                      Acciones
                    </th>
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
                    <tr key={m.id} style={{ borderBottom: `1px solid ${ds.borderRow}` }}>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontWeight: 600, fontSize: 12, color: ds.textPrimary }}>{m.name}</div>
                        <div style={{ fontSize: 10.5, color: ds.textHint }}>{m.email}</div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {role === 'owner' ? (
                          <select
                            value={m.role}
                            onChange={(e) => void changeRole(m.id, e.target.value)}
                            style={{
                              padding: '8px 12px',
                              borderRadius: 8,
                              border: `1px solid ${ds.borderCard}`,
                              fontSize: 13,
                              color: ds.textPrimary,
                              background: ds.bgCard,
                            }}
                          >
                            <option value="owner">Propietario</option>
                            <option value="admin">Administrador</option>
                            <option value="member">Miembro</option>
                            {customRoles.map((cr) => (
                              <option key={cr.id} value={cr.slug}>
                                {cr.label} ({cr.base_role === 'admin' ? 'admin' : 'miembro'})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span>{formatRoleLabel(m.role, customRoles)}</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '3px 9px',
                            borderRadius: 20,
                            fontSize: 12,
                            fontWeight: 500,
                            background: m.is_active ? ds.successBg : ds.dangerBg,
                            color: m.is_active ? ds.successText : ds.dangerText,
                          }}
                        >
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: m.is_active ? ds.successText : ds.dangerText,
                            }}
                          />
                          {m.is_active ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      {role === 'owner' ? (
                        <td style={{ padding: '12px 16px' }}>
                          {canRemove ? (
                            <button
                              type="button"
                              onClick={() => void removeMember(m.id)}
                              style={{
                                border: 'none',
                                background: 'none',
                                color: ds.dangerText,
                                cursor: 'pointer',
                                fontWeight: 600,
                                fontSize: 13,
                              }}
                            >
                              Eliminar
                            </button>
                          ) : (
                            <span style={{ color: ds.textMuted, fontSize: 13 }}>—</span>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
                {invitations.map((inv) => (
                  <tr
                    key={`inv-${inv.id}`}
                    style={{ borderBottom: `1px solid ${ds.borderRow}`, background: ds.bgSubtle }}
                  >
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: 600, fontSize: 12, color: ds.textPrimary }}>{inv.email}</div>
                      <div style={{ fontSize: 10.5, color: ds.textHint }}>Invitación pendiente</div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>{formatRoleLabel(inv.role, customRoles)}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '3px 9px',
                          borderRadius: 20,
                          fontSize: 12,
                          fontWeight: 500,
                          background: ds.infoBg,
                          color: ds.infoText,
                        }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: ds.infoText,
                          }}
                        />
                        Pendiente
                      </span>
                    </td>
                    {role === 'owner' ? <td style={{ padding: '12px 16px' }} /> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Plan */}
        <section
          style={{
            background: ds.bgCard,
            borderRadius: 14,
            padding: '18px 20px',
            border: `1px solid ${ds.borderCard}`,
          }}
        >
          <h2 style={{ margin: '0 0 16px', fontSize: 13, fontWeight: 600, color: ds.textPrimary }}>Plan actual</h2>
          <p style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700, color: ds.brand }}>{planLabel}</p>
          <p style={{ margin: '0 0 20px', fontSize: 11, color: ds.textMuted }}>
            Uso dentro de los límites de tu suscripción.
          </p>

          {localLimits && (
            <>
              <div
                style={{
                  marginBottom: 20,
                  paddingBottom: 20,
                  borderBottom: `1px solid ${ds.borderSide}`,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary }}>
                  Usuarios (activos + invitaciones pendientes)
                </div>
                <div style={{ fontSize: 11, color: ds.textMuted, marginTop: 4 }}>
                  {localLimits.users.used}{' '}
                  {localLimits.users.max != null ? `de ${localLimits.users.max}` : '(sin límite)'}
                </div>
                <ProgressBar used={localLimits.users.used} max={localLimits.users.max} />
              </div>
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary }}>Conexiones Meta</div>
                <div style={{ fontSize: 11, color: ds.textMuted, marginTop: 4 }}>
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
              padding: '8px 16px',
              borderRadius: 8,
              border: `1px solid ${ds.borderCard}`,
              background: ds.bgCard,
              color: ds.textSecondary,
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Mejorar plan
          </button>
        </section>

      {inviteOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.18)',
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
              background: ds.bgCard,
              borderRadius: 16,
              padding: 28,
              width: '100%',
              maxWidth: 400,
              border: `1px solid ${ds.borderCard}`,
            }}
          >
            <h3 id="invite-title" style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700, color: ds.textPrimary }}>
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
                  onChange={(e) => setInviteRole(e.target.value)}
                  style={{ ...inputStyle, marginTop: 8 }}
                >
                  <option value="member">Miembro</option>
                  <option value="admin">Administrador</option>
                  {customRoles.map((cr) => (
                    <option key={cr.id} value={cr.slug}>
                      {cr.label} ({cr.base_role === 'admin' ? 'como admin' : 'como miembro'})
                    </option>
                  ))}
                </select>
              </label>
              {inviteErr && (
                <p style={{ color: ds.dangerText, fontSize: 13, marginTop: 12 }}>{inviteErr}</p>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button
                  type="button"
                  onClick={() => setInviteOpen(false)}
                  style={{
                    flex: 1,
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: `1px solid ${ds.borderCard}`,
                    background: ds.bgCard,
                    color: ds.textSecondary,
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: 13,
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
