import { useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiUrl } from '../auth/api';
import { CARD_BG, PAGE_BG, SIDEBAR, inputStyle, labelStyle, linkStyle, primaryButton } from './authStyles';

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
    <div
      style={{
        minHeight: '100vh',
        background: PAGE_BG,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <style>{`@keyframes kovoSpin { to { transform: rotate(360deg); } }`}</style>
      <div
        style={{
          width: '100%',
          maxWidth: 460,
          background: CARD_BG,
          borderRadius: 16,
          padding: 'clamp(24px, 5vw, 40px)',
          boxShadow: '0 8px 32px rgba(26,26,46,0.08)',
          border: '1px solid #e8eaef',
        }}
      >
        <h1 style={{ margin: '0 0 8px', fontSize: 24, color: SIDEBAR }}>Crear cuenta</h1>
        <p style={{ margin: '0 0 24px', color: '#6b7280', fontSize: 15 }}>
          Regístrate para usar el panel KOVO
        </p>

        {success && (
          <div
            style={{
              marginBottom: 20,
              padding: '12px 14px',
              borderRadius: 10,
              background: 'rgba(150,191,72,0.15)',
              color: '#3d5c1f',
              fontSize: 14,
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
              borderRadius: 10,
              background: 'rgba(220,80,80,0.1)',
              color: '#b91c1c',
              fontSize: 14,
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
