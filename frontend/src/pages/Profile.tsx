import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';
import { PageHeader } from '../design-system/PageHeader';
import { inputStyle, labelStyle, primaryButton } from './authStyles';

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat('es-ES', { dateStyle: 'long' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function Profile() {
  const { user, organization, logout, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(user?.name ?? '');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) setName(user.name);
  }, [user]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    setErr('');
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setErr('El nombre debe tener al menos 2 caracteres');
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof data.error === 'string' ? data.error : 'No se pudo guardar');
        return;
      }
      await refreshUser();
      setMsg('Cambios guardados');
    } catch {
      setErr('Error de red');
    } finally {
      setSaving(false);
    }
  }

  function handleLogout() {
    if (!window.confirm('¿Cerrar sesión en este dispositivo?')) return;
    logout();
    navigate('/login', { replace: true });
  }

  if (!user) {
    return null;
  }

  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div style={{ maxWidth: 560 }}>
      <PageHeader title="Cuenta" subtitle="Perfil y sesión." />

      <div
        style={{
          background: ds.bgCard,
          borderRadius: 14,
          padding: '18px 20px',
          border: `1px solid ${ds.borderCard}`,
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: ds.brandBg,
            color: ds.brand,
            fontWeight: 700,
            fontSize: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {initials}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary }}>{user.name}</div>
          <div style={{ fontSize: 12, color: ds.textMuted, marginTop: 4 }}>{user.email}</div>
          {organization ? (
            <div style={{ fontSize: 12, color: ds.brand, fontWeight: 600, marginTop: 6 }}>
              {organization.name} · {organization.plan}
            </div>
          ) : null}
          <div style={{ fontSize: 11, color: ds.textHint, marginTop: 8 }}>Miembro desde {formatDate(user.created_at)}</div>
        </div>
      </div>

      <div
        style={{
          background: ds.bgCard,
          borderRadius: 14,
          padding: '18px 20px',
          border: `1px solid ${ds.borderCard}`,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary, marginBottom: 16 }}>Datos personales</div>
        <form onSubmit={handleSave}>
          <label style={labelStyle}>
            Nombre
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ ...inputStyle, marginTop: 8 }}
              minLength={2}
              required
            />
          </label>

          {msg ? (
            <p style={{ margin: '12px 0 0', color: ds.successText, fontWeight: 600, fontSize: 13 }}>{msg}</p>
          ) : null}
          {err ? <p style={{ margin: '12px 0 0', color: ds.dangerText, fontSize: 13 }}>{err}</p> : null}

          <button
            type="submit"
            disabled={saving}
            style={{
              ...primaryButton,
              marginTop: 20,
              width: 'auto',
              minWidth: 160,
              cursor: saving ? 'wait' : 'pointer',
              opacity: saving ? 0.85 : 1,
            }}
          >
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </form>

        <div style={{ borderTop: `1px solid ${ds.borderSide}`, marginTop: 24, paddingTop: 20 }}>
          <button
            type="button"
            onClick={handleLogout}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: `1px solid ${ds.borderCard}`,
              background: ds.bgCard,
              color: ds.dangerText,
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}
