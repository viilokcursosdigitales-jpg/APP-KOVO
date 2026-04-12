import { useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiUrl } from '../auth/api';
import { alpha, ds } from '../design-system/ds';
import { CARD_BG, inputStyle, labelStyle, linkStyle, primaryButton } from './authStyles';

function Spinner() {
  return (
    <span
      style={{
        width: 18,
        height: 18,
        border: '2px solid #fff6',
        borderTopColor: '#fff',
        borderRadius: '50%',
        animation: 'kovoSpin 0.65s linear infinite',
      }}
    />
  );
}

export default function Register() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [organizationName, setOrganizationName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const pwdMismatch = useMemo(() => {
    if (!confirm) return false;
    return password !== confirm;
  }, [password, confirm]);

  if (!authLoading && isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

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
    if (!organizationName.trim() || organizationName.trim().length < 2) {
      setError('Indica el nombre de tu empresa');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(apiUrl('/api/auth/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationName: organizationName.trim(),
          name: name.trim(),
          email: email.trim(),
          password,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'No se pudo crear la cuenta');
        return;
      }
      setSuccess(true);
      window.setTimeout(() => {
        navigate('/login?registered=1', { replace: true });
      }, 1800);
    } catch {
      setError('Error de red. Comprueba que el servidor esté en marcha.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="kovo-auth-root">
      <style>{`@keyframes kovoSpin { to { transform: rotate(360deg); } }`}</style>
      <div
        style={{
          width: '100%',
          maxWidth: 460,
          background: CARD_BG,
          borderRadius: 14,
          padding: 'clamp(24px, 5vw, 40px)',
          border: `1px solid ${ds.borderCard}`,
        }}
      >
        <h1 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: ds.textPrimary }}>Crear cuenta</h1>
        <p style={{ margin: '0 0 24px', color: ds.textSecondary, fontSize: 13 }}>
          Regístrate para usar el panel KOVO
        </p>

        {success && (
          <div
            style={{
              marginBottom: 20,
              padding: '12px 14px',
              borderRadius: 8,
              background: alpha.success15,
              color: ds.successText,
              fontSize: 13,
              border: `1px solid ${ds.borderCard}`,
            }}
          >
            ¡Cuenta creada! Redirigiendo al inicio de sesión…
          </div>
        )}

        {error && (
          <div
            style={{
              marginBottom: 20,
              padding: '12px 14px',
              borderRadius: 8,
              background: ds.dangerBg,
              color: ds.dangerText,
              fontSize: 13,
              border: `1px solid ${ds.borderCard}`,
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>
            Nombre de tu empresa
            <input
              type="text"
              autoComplete="organization"
              required
              minLength={2}
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              placeholder="Ej. Mi tienda online"
              style={{ ...inputStyle, marginTop: 8 }}
            />
          </label>
          <label style={{ ...labelStyle, marginTop: 16 }}>
            Tu nombre
            <input
              type="text"
              autoComplete="name"
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ ...inputStyle, marginTop: 8 }}
            />
          </label>
          <label style={{ ...labelStyle, marginTop: 16 }}>
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ ...inputStyle, marginTop: 8 }}
            />
          </label>
          <label style={{ ...labelStyle, marginTop: 16 }}>
            Contraseña
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                ...inputStyle,
                marginTop: 8,
                borderColor: pwdMismatch ? '#dc2626' : '#d1d5db',
              }}
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
              style={{
                ...inputStyle,
                marginTop: 8,
                borderColor: pwdMismatch ? '#dc2626' : '#d1d5db',
              }}
            />
          </label>
          {pwdMismatch && (
            <p style={{ margin: '8px 0 0', fontSize: 13, color: '#dc2626' }}>
              Las contraseñas deben coincidir
            </p>
          )}

          <button
            type="submit"
            disabled={loading || success || pwdMismatch}
            style={{
              ...primaryButton,
              marginTop: 24,
              opacity: loading || success ? 0.85 : 1,
              cursor: loading || success ? 'wait' : 'pointer',
            }}
          >
            {loading ? (
              <>
                <Spinner />
                Creando cuenta…
              </>
            ) : (
              'Crear cuenta'
            )}
          </button>
        </form>

        <p style={{ marginTop: 20, textAlign: 'center' }}>
          <Link to="/login" style={linkStyle}>
            Ya tengo cuenta
          </Link>
        </p>
      </div>
    </div>
  );
}
