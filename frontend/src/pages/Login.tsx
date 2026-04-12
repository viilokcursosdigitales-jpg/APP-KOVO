import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { postLoginPath } from '../appModules';
import { useAuth, type SessionPayload } from '../auth/AuthContext';
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

function parseModuleAccessFromLoginBody(data: Record<string, unknown>): string[] | null {
  const m = data.module_access;
  if (m === undefined) return null;
  if (m === null) return null;
  if (Array.isArray(m)) return m.filter((x): x is string => typeof x === 'string');
  return null;
}

export default function Login() {
  const { login, isAuthenticated, isLoading: authLoading, moduleAccess } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const state = location.state as { from?: string } | undefined;
  const registered = params.get('registered') === '1';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!authLoading && isAuthenticated) {
    return <Navigate to={postLoginPath(moduleAccess, undefined)} replace />;
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
      const r = data.role as string;
      const rt = data.role_tier as string | undefined;
      const role_tier: SessionPayload['role_tier'] =
        rt === 'owner' || rt === 'admin' || rt === 'member'
          ? rt
          : r === 'owner' || r === 'admin' || r === 'member'
            ? r
            : 'member';
      const module_access = parseModuleAccessFromLoginBody(data as Record<string, unknown>);
      const session: SessionPayload = {
        user: data.user,
        organization: data.organization,
        role: r,
        role_tier,
        limits: data.limits,
        module_access,
      };
      login(data.token, session);
      navigate(
        postLoginPath(
          module_access,
          typeof state?.from === 'string' ? state.from : undefined,
        ),
        { replace: true },
      );
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
          maxWidth: 420,
          background: CARD_BG,
          borderRadius: 14,
          padding: 'clamp(24px, 5vw, 40px)',
          border: `1px solid ${ds.borderCard}`,
        }}
      >
        <h1 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: ds.textPrimary }}>Iniciar sesión</h1>
        <p style={{ margin: '0 0 24px', color: ds.textSecondary, fontSize: 13 }}>
          Accede a tu panel de KOVO
        </p>

        {registered && (
          <div
            style={{
              marginBottom: 20,
              padding: '12px 14px',
              borderRadius: 8,
              background: alpha.brand12,
              color: ds.brand,
              fontSize: 13,
              border: `1px solid ${ds.borderCard}`,
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
          <Link to="/" style={{ ...linkStyle, color: ds.textSecondary, fontWeight: 500 }}>
            ← Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
