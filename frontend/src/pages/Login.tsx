import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, type SessionPayload } from '../auth/AuthContext';
import { apiUrl } from '../auth/api';
import { CARD_BG, META_BLUE, PAGE_BG, SIDEBAR, inputStyle, labelStyle, linkStyle, primaryButton } from './authStyles';

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

export default function Login() {
  const { login, isAuthenticated, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const state = location.state as { from?: string } | undefined;
  const redirectTo =
    typeof state?.from === 'string' && state.from.startsWith('/') ? state.from : '/dashboard';
  const registered = params.get('registered') === '1';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!authLoading && isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'No se pudo iniciar sesión');
        return;
      }
      const session: SessionPayload = {
        user: data.user,
        organization: data.organization,
        role: data.role,
        limits: data.limits,
      };
      login(data.token, session);
      navigate(redirectTo, { replace: true });
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
          maxWidth: 420,
          background: CARD_BG,
          borderRadius: 16,
          padding: 'clamp(24px, 5vw, 40px)',
          boxShadow: '0 8px 32px rgba(26,26,46,0.08)',
          border: '1px solid #e8eaef',
        }}
      >
        <h1 style={{ margin: '0 0 8px', fontSize: 24, color: SIDEBAR }}>Iniciar sesión</h1>
        <p style={{ margin: '0 0 24px', color: '#6b7280', fontSize: 15 }}>
          Accede a tu panel de KOVO
        </p>

        {registered && (
          <div
            style={{
              marginBottom: 20,
              padding: '12px 14px',
              borderRadius: 10,
              background: `${META_BLUE}12`,
              color: '#1e40af',
              fontSize: 14,
            }}
          >
            Cuenta creada. Ya puedes entrar con tu email y contraseña.
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
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ ...inputStyle, marginTop: 8 }}
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            style={{
              ...primaryButton,
              marginTop: 24,
              opacity: loading ? 0.85 : 1,
              cursor: loading ? 'wait' : 'pointer',
            }}
          >
            {loading ? (
              <>
                <Spinner />
                Iniciando sesión…
              </>
            ) : (
              'Iniciar sesión'
            )}
          </button>
        </form>

        <div
          style={{
            marginTop: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            alignItems: 'center',
          }}
        >
          <Link to="/forgot-password" style={linkStyle}>
            ¿Olvidaste tu contraseña?
          </Link>
          <Link to="/register" style={linkStyle}>
            Crear cuenta
          </Link>
          <Link to="/" style={{ ...linkStyle, color: '#6b7280', fontWeight: 500 }}>
            ← Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
