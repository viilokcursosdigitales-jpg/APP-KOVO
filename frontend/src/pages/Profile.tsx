import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../auth/api';
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

  return (
    <div
      style={{
        minHeight: '100vh',
        background: PAGE_BG,
        padding: 'clamp(20px, 4vw, 40px)',
        fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <Link to="/dashboard" style={{ ...linkStyle, display: 'inline-block', marginBottom: 20 }}>
          ← Volver al panel
        </Link>

        <div
          style={{
            background: CARD_BG,
            borderRadius: 16,
            padding: 'clamp(24px, 5vw, 36px)',
            border: '1px solid #e8eaef',
            boxShadow: '0 4px 24px rgba(26,26,46,0.06)',
          }}
        >
          <h1 style={{ margin: '0 0 8px', fontSize: 26, color: SIDEBAR }}>Tu perfil</h1>
          <p style={{ margin: '0 0 8px', color: '#6b7280', fontSize: 15 }}>{user.email}</p>
          {organization && (
            <p style={{ margin: '0 0 8px', color: META_BLUE, fontSize: 14, fontWeight: 600 }}>
              {organization.name} · {organization.plan}
            </p>
          )}

          <span
            style={{
              display: 'inline-block',
              marginBottom: 24,
              padding: '6px 12px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              background: `${META_BLUE}18`,
              color: '#1e40af',
            }}
          >
            Miembro desde {formatDate(user.created_at)}
          </span>

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

            {msg && (
              <p style={{ margin: '12px 0 0', color: SHOPIFY_GREEN, fontWeight: 600, fontSize: 14 }}>{msg}</p>
            )}
            {err && (
              <p style={{ margin: '12px 0 0', color: '#dc2626', fontSize: 14 }}>{err}</p>
            )}

            <button
              type="submit"
              disabled={saving}
              style={{
                ...primaryButton,
                marginTop: 20,
                maxWidth: 280,
                cursor: saving ? 'wait' : 'pointer',
                opacity: saving ? 0.85 : 1,
              }}
            >
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </form>

          <hr style={{ margin: '32px 0', border: 'none', borderTop: '1px solid #e8eaef' }} />

          <button
            type="button"
            onClick={handleLogout}
            style={{
              padding: '12px 22px',
              borderRadius: 10,
              border: '1px solid #fecaca',
              background: '#fff',
              color: '#b91c1c',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}
