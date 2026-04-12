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

type ModuleCatalogEntry = { id: string; label: string; group: string };

type RoleModuleRow = {
  slug: string;
  label: string;
  full_access: boolean;
  modules: string[];
  locked?: boolean;
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
  const [inviteOkMsg, setInviteOkMsg] = useState('');
  /** Si el correo no se envió por SMTP, el invitador puede copiar el enlace. */
  const [inviteManualLink, setInviteManualLink] = useState('');
  const [resendingInvitationId, setResendingInvitationId] = useState<number | null>(null);
  const [mailTransport, setMailTransport] = useState<{ configured: boolean; transport: string } | null>(null);

  const [customRoles, setCustomRoles] = useState<CustomRoleRow[]>([]);
  const [newRoleLabel, setNewRoleLabel] = useState('');
  const [newRoleBase, setNewRoleBase] = useState<'admin' | 'member'>('member');
  const [roleSaving, setRoleSaving] = useState(false);
  const [roleMsg, setRoleMsg] = useState('');

  const [moduleCatalog, setModuleCatalog] = useState<ModuleCatalogEntry[]>([]);
  const [roleModuleRows, setRoleModuleRows] = useState<RoleModuleRow[]>([]);
  const [roleModSaving, setRoleModSaving] = useState(false);
  const [roleModErr, setRoleModErr] = useState('');

  const loadRoleModules = useCallback(async () => {
    setRoleModErr('');
    const res = await apiFetch('/api/organization/role-modules');
    const data = (await res.json().catch(() => ({}))) as {
      module_catalog?: ModuleCatalogEntry[];
      roles?: RoleModuleRow[];
      error?: string;
    };
    if (!res.ok) {
      setRoleModErr(typeof data.error === 'string' ? data.error : 'No se pudieron cargar los permisos por módulo');
      return;
    }
    setModuleCatalog(Array.isArray(data.module_catalog) ? data.module_catalog : []);
    setRoleModuleRows(
      (Array.isArray(data.roles) ? data.roles : []).map((r) => ({
        ...r,
        modules: Array.isArray(r.modules) ? [...r.modules] : [],
      })),
    );
  }, []);

  const loadTeam = useCallback(async () => {
    const res = await apiFetch('/api/organization/members');
    if (!res.ok) return;
    const data = (await res.json()) as {
      members: MemberRow[];
      invitations: InviteRow[];
      custom_roles?: CustomRoleRow[];
      limits: Limits;
      mail?: { configured?: boolean; transport?: string };
    };
    setMembers(data.members);
    setInvitations(data.invitations);
    setCustomRoles(Array.isArray(data.custom_roles) ? data.custom_roles : []);
    setLocalLimits(data.limits);
    if (data.mail && typeof data.mail.configured === 'boolean') {
      setMailTransport({
        configured: data.mail.configured,
        transport: typeof data.mail.transport === 'string' ? data.mail.transport : 'none',
      });
    } else {
      setMailTransport(null);
    }
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

  useEffect(() => {
    if (canManageOrg) void loadRoleModules();
  }, [canManageOrg, loadRoleModules]);

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
    setInviteOkMsg('');
    setInviteManualLink('');
    setInviteLoading(true);
    let inviteSucceeded = false;
    try {
      const invitedEmail = inviteEmail.trim();
      const res = await apiFetch('/api/organization/invite', {
        method: 'POST',
        body: JSON.stringify({ email: invitedEmail, role: inviteRole.trim() }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        email_sent?: boolean;
        invite_link?: string;
      };
      if (!res.ok) {
        setInviteErr(typeof d.error === 'string' ? d.error : 'No se pudo enviar');
        return;
      }
      inviteSucceeded = true;
      const serverMsg = typeof d.message === 'string' ? d.message : '';
      setInviteOkMsg(
        serverMsg ||
          `Se envió un correo a ${invitedEmail} para que apruebe la invitación y se una al workspace.`,
      );
      const emailSent = d.email_sent !== false;
      if (!emailSent && typeof d.invite_link === 'string' && d.invite_link.length > 0) {
        setInviteManualLink(d.invite_link);
      }
      setInviteEmail('');
      setInviteOpen(false);
    } catch {
      setInviteErr('No se pudo conectar. Comprueba tu red o inténtalo en unos segundos.');
    } finally {
      setInviteLoading(false);
    }
    if (inviteSucceeded) {
      void Promise.all([loadTeam(), refreshUser()]).catch(() => {
        /* La invitación ya se creó; el listado se actualizará al recargar o al volver a abrir ajustes. */
      });
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

  async function cancelInvitation(invitationId: number) {
    if (!window.confirm('¿Cancelar esta invitación? Podrás volver a invitar al mismo correo.')) return;
    const res = await apiFetch(`/api/organization/invitations/${invitationId}`, { method: 'DELETE' });
    if (res.ok) {
      await loadTeam();
      await refreshUser();
    }
  }

  async function resendInvitation(invitationId: number) {
    setInviteErr('');
    setInviteOkMsg('');
    setInviteManualLink('');
    setResendingInvitationId(invitationId);
    try {
      const res = await apiFetch(`/api/organization/invitations/${invitationId}/resend`, {
        method: 'POST',
      });
      const d = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        email_sent?: boolean;
        invite_link?: string;
      };
      if (!res.ok) {
        setInviteErr(typeof d.error === 'string' ? d.error : 'No se pudo reenviar');
        return;
      }
      const serverMsg = typeof d.message === 'string' ? d.message : '';
      setInviteOkMsg(serverMsg || 'Invitación reenviada.');
      const emailSent = d.email_sent !== false;
      if (!emailSent && typeof d.invite_link === 'string' && d.invite_link.length > 0) {
        setInviteManualLink(d.invite_link);
      }
    } finally {
      setResendingInvitationId(null);
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
      await loadRoleModules();
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
    await loadRoleModules();
  }

  async function saveRoleModules() {
    setRoleModErr('');
    setRoleModSaving(true);
    try {
      const entries = roleModuleRows
        .filter((r) => !r.locked)
        .map((r) => ({
          role_slug: r.slug,
          full_access: r.full_access,
          modules: r.full_access ? [] : r.modules,
        }));
      const res = await apiFetch('/api/organization/role-modules', {
        method: 'PUT',
        body: JSON.stringify({ entries }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRoleModErr(typeof d.error === 'string' ? d.error : 'No se pudo guardar');
        return;
      }
      await loadRoleModules();
      await refreshUser();
    } finally {
      setRoleModSaving(false);
    }
  }

  function setRowFullAccess(slug: string, full: boolean) {
    setRoleModuleRows((rows) =>
      rows.map((r) => (r.slug === slug ? { ...r, full_access: full, modules: full ? [] : r.modules } : r)),
    );
  }

  function toggleRowModule(slug: string, moduleId: string) {
    setRoleModuleRows((rows) =>
      rows.map((r) => {
        if (r.slug !== slug || r.locked || r.full_access) return r;
        const has = r.modules.includes(moduleId);
        const modules = has ? r.modules.filter((m) => m !== moduleId) : [...r.modules, moduleId];
        return { ...r, modules };
      }),
    );
  }

  const catalogByGroup = moduleCatalog.reduce<Record<string, ModuleCatalogEntry[]>>((acc, m) => {
    const g = m.group || 'Otros';
    if (!acc[g]) acc[g] = [];
    acc[g].push(m);
    return acc;
  }, {});

  if (!organization || !canManageOrg) {
    return null;
  }

  const planLabel =
    organization.plan === 'free' ? 'Gratuito' : organization.plan === 'pro' ? 'Pro' : 'Enterprise';

  return (
    <div style={{ maxWidth: 960 }}>
      <PageHeader title="Configuración" subtitle={`Workspace: ${organization.slug}`} />

      {inviteOkMsg ? (
        <div
          style={{
            marginBottom: 20,
            padding: '12px 16px',
            borderRadius: 12,
            border: `1px solid ${ds.borderCard}`,
            background: inviteManualLink ? ds.infoBg : ds.successBg,
            color: inviteManualLink ? ds.infoText : ds.successText,
            fontSize: 13,
            lineHeight: 1.45,
          }}
          role="status"
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <span style={{ flex: '1 1 220px' }}>{inviteOkMsg}</span>
            <button
              type="button"
              onClick={() => {
                setInviteOkMsg('');
                setInviteManualLink('');
              }}
              style={{
                border: 'none',
                background: 'transparent',
                color: inviteManualLink ? ds.infoText : ds.successText,
                fontWeight: 600,
                fontSize: 12,
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Cerrar
            </button>
          </div>
          {inviteManualLink ? (
            <div style={{ marginTop: 12, width: '100%' }}>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, opacity: 0.9 }}>
                Enlace para el invitado (mientras no haya SMTP en el servidor)
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <input
                  readOnly
                  value={inviteManualLink}
                  style={{
                    flex: '1 1 200px',
                    minWidth: 0,
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: `1px solid ${ds.borderCard}`,
                    fontSize: 11,
                    background: ds.bgCard,
                    color: ds.textPrimary,
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(inviteManualLink).catch(() => {
                      window.alert('No se pudo copiar. Selecciona el enlace manualmente.');
                    });
                  }}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: `1px solid ${ds.borderCard}`,
                    background: ds.bgCard,
                    color: ds.brand,
                    fontWeight: 600,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Copiar enlace
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

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

        {/* Acceso por módulo */}
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
            Acceso a módulos por rol
          </h2>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: ds.textSecondary, lineHeight: 1.45 }}>
            Define si cada rol tiene <strong>acceso total</strong> a la barra lateral o solo a los módulos que marques.
            Cuenta y Configuración siguen las reglas de administrador/miembro (no se restringen aquí).
          </p>
          {roleModErr ? (
            <p style={{ margin: '0 0 12px', fontSize: 12, color: ds.dangerText }}>{roleModErr}</p>
          ) : null}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {roleModuleRows.map((row) => (
              <div
                key={row.slug}
                style={{
                  paddingTop: row.slug === roleModuleRows[0]?.slug ? 0 : 16,
                  borderTop: row.slug === roleModuleRows[0]?.slug ? 'none' : `1px solid ${ds.borderRow}`,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13, color: ds.textPrimary, marginBottom: 8 }}>{row.label}</div>
                {row.locked ? (
                  <p style={{ margin: 0, fontSize: 12, color: ds.textMuted }}>
                    El propietario siempre tiene acceso total a todos los módulos.
                  </p>
                ) : (
                  <>
                    <label
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 12,
                        color: ds.textSecondary,
                        cursor: 'pointer',
                        marginBottom: 10,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={row.full_access}
                        onChange={(e) => setRowFullAccess(row.slug, e.target.checked)}
                        style={{ accentColor: ds.brand }}
                      />
                      Acceso total (todos los módulos)
                    </label>
                    {!row.full_access ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {Object.entries(catalogByGroup).map(([gName, items]) => (
                          <div key={gName}>
                            <div
                              style={{
                                fontSize: 10,
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px',
                                color: ds.textHint,
                                marginBottom: 6,
                              }}
                            >
                              {gName}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                              {items.map((m) => {
                                const on = row.modules.includes(m.id);
                                return (
                                  <label
                                    key={m.id}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 6,
                                      padding: '4px 10px',
                                      borderRadius: 8,
                                      border: `1px solid ${on ? ds.brand : ds.borderCard}`,
                                      background: on ? ds.brandBg : ds.bgSubtle,
                                      fontSize: 11,
                                      fontWeight: on ? 600 : 500,
                                      color: on ? ds.brand : ds.textSecondary,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={on}
                                      onChange={() => toggleRowModule(row.slug, m.id)}
                                      style={{ accentColor: ds.brand }}
                                    />
                                    {m.label}
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={roleModSaving || roleModuleRows.length === 0}
            onClick={() => void saveRoleModules()}
            style={{
              ...primaryButton,
              marginTop: 20,
              width: 'auto',
              minWidth: 180,
              opacity: roleModSaving || roleModuleRows.length === 0 ? 0.75 : 1,
              cursor: roleModSaving ? 'wait' : 'pointer',
            }}
          >
            {roleModSaving ? 'Guardando…' : 'Guardar permisos de módulos'}
          </button>
        </section>

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
                setInviteOkMsg('');
                setInviteManualLink('');
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

          {canManageOrg && mailTransport && !mailTransport.configured ? (
            <div
              style={{
                marginBottom: 14,
                padding: '12px 14px',
                borderRadius: 10,
                border: `1px solid ${ds.borderCard}`,
                background: ds.warningBg,
                color: ds.warningText,
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              <strong>Correo no configurado en el servidor.</strong> Las invitaciones se guardan, pero el invitado no
              recibirá el email hasta que añadas <code style={{ fontSize: 11 }}>RESEND_API_KEY</code> (Resend) o{' '}
              <code style={{ fontSize: 11 }}>SMTP_HOST</code>, <code style={{ fontSize: 11 }}>SMTP_USER</code> y{' '}
              <code style={{ fontSize: 11 }}>SMTP_PASS</code> en el <code style={{ fontSize: 11 }}>.env</code> del
              backend y reinicies el proceso. Con Resend y <code style={{ fontSize: 11 }}>onboarding@resend.dev</code>{' '}
              solo llega correo a tu propio email hasta que verifiques un dominio en Resend. Consulta{' '}
              <code style={{ fontSize: 11 }}>backend/.env.example</code> y{' '}
              <code style={{ fontSize: 11 }}>PUBLIC_APP_URL</code>.
            </div>
          ) : null}

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
                  {canManageOrg ? (
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
                      {canManageOrg ? (
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
                    {canManageOrg ? (
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                          <button
                            type="button"
                            disabled={resendingInvitationId === inv.id}
                            onClick={() => void resendInvitation(inv.id)}
                            style={{
                              border: 'none',
                              background: 'none',
                              color: ds.brand,
                              cursor: resendingInvitationId === inv.id ? 'wait' : 'pointer',
                              fontWeight: 600,
                              fontSize: 13,
                              opacity: resendingInvitationId === inv.id ? 0.7 : 1,
                            }}
                          >
                            {resendingInvitationId === inv.id ? 'Reenviando…' : 'Reenviar correo'}
                          </button>
                          <button
                            type="button"
                            disabled={resendingInvitationId != null}
                            onClick={() => void cancelInvitation(inv.id)}
                            style={{
                              border: 'none',
                              background: 'none',
                              color: ds.dangerText,
                              cursor: resendingInvitationId != null ? 'not-allowed' : 'pointer',
                              fontWeight: 600,
                              fontSize: 13,
                              opacity: resendingInvitationId != null ? 0.5 : 1,
                            }}
                          >
                            Cancelar invitación
                          </button>
                        </div>
                      </td>
                    ) : null}
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
