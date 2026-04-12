import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiUrl } from '../auth/api';
import { ds } from '../design-system/ds';
import { CARD_BG, inputStyle, labelStyle, linkStyle, primaryButton } from './authStyles';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const tokenFromUrl = params.get('token') ?? '';

  const [token, setToken] = useState(tokenFromUrl);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Las contraseñas no coinciden');
      return;
    }
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    if (!token.trim()) {
      setError('Falta el token de recuperación');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(apiUrl('/api/auth/reset-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'No se pudo actualizar la contraseña');
        return;
      }
      setDone(true);
      window.setTimeout(() => navigate('/login', { replace: true }), 2000);
    } catch {
      setError('Error de red');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="kovo-auth-root">
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: CARD_BG,
          borderRadius: 14,
          padding: 'clamp(24px, 5vw, 40px)',
          border: `1px solid ${ds.borderCard}`,
        }}
      >
        <h1 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: ds.textPrimary }}>Nueva contraseña</h1>
        <p style={{ margin: '0 0 24px', color: ds.textSecondary, fontSize: 13 }}>
          Elige una contraseña segura para tu cuenta
        </p>

        {done && (
          <div
            style={{
              marginBottom: 20,
              padding: '12px 14px',
              borderRadius: 10,
              background: '#f0fdf4',
              color: '#166534',
              fontSize: 14,
            }}
          >
            Contraseña actualizada. Redirigiendo al login…
          </div>
        )}

        {error && (
          <div
            style={{
              marginBottom: 20,
              padding: '12px 14px',
              borderRadius: 10,
              background: 'rgba(220,80,80,0.1)',
              color: '#b91c1c',
              fontSize: 14,
            }}
          >
            {error}
          </div>
        )}

        {!done && (
          <form onSubmit={handleSubmit}>
            <label style={labelStyle}>
              Token de recuperación
              <input
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Pégalo desde el enlace del email"
                style={{ ...inputStyle, marginTop: 8 }}
              />
            </label>
            <label style={{ ...labelStyle, marginTop: 16 }}>
              Nueva contraseña
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ ...inputStyle, marginTop: 8 }}
              />
            </label>
            <label style={{ ...labelStyle, marginTop: 16 }}>
              Confirmar contraseña
              <input
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                style={{ ...inputStyle, marginTop: 8 }}
              />
            </label>
            <button
              type="submit"
              disabled={loading}
              style={{
                ...primaryButton,
                marginTop: 24,
                cursor: loading ? 'wait' : 'pointer',
                opacity: loading ? 0.85 : 1,
              }}
            >
              {loading ? 'Guardando…' : 'Guardar contraseña'}
            </button>
          </form>
        )}

        <p style={{ marginTop: 20, textAlign: 'center' }}>
          <Link to="/login" style={linkStyle}>
            Volver al login
          </Link>
        </p>
      </div>
    </div>
  );
}
