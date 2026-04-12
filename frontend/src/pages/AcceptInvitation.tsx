import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { postLoginPath } from '../appModules';
import { useAuth, type SessionPayload } from '../auth/AuthContext';
import { apiUrl } from '../auth/api';
import { ds } from '../design-system/ds';
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

type AcceptInfo = {
  email: string;
  organization_name: string;
  role_label: string;
};

function parseModuleAccess(data: Record<string, unknown>): string[] | null {
  const m = data.module_access;
  if (m === undefined) return null;
  if (m === null) return null;
  if (Array.isArray(m)) return m.filter((x): x is string => typeof x === 'string');
  return null;
}

export default function AcceptInvitation() {
  const [params] = useSearchParams();
  const token = params.get('token')?.trim() || '';
  const { login, isAuthenticated, isLoading: authLoading, moduleAccess } = useAuth();
  const navigate = useNavigate();

  const [info, setInfo] = useState<AcceptInfo | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [loadingInfo, setLoadingInfo] = useState(true);

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const pwdMismatch = useMemo(() => {
    if (!confirm) return false;
    return password !== confirm;
  }, [password, confirm]);

  useEffect(() => {
    if (!token) {
      setLoadErr('Falta el enlace de invitación (token). Pide a quien te invitó que te reenvíe el correo o el enlace.');
      setLoadingInfo(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiUrl('/api/invitations/accept-info')}?token=${encodeURIComponent(token)}`);
        const data = (await res.json().catch(() => ({}))) as AcceptInfo & { error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setLoadErr(typeof data.error === 'string' ? data.error : 'Invitación no válida');
          return;
        }
        setInfo({
          email: data.email,
          organization_name: data.organization_name,
          role_label: data.role_label,
        });
      } catch {
        if (!cancelled) setLoadErr('No se pudo comprobar la invitación. Revisa tu conexión.');
      } finally {
        if (!cancelled) setLoadingInfo(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(postLoginPath(moduleAccess, undefined), { replace: true });
    }
  }, [authLoading, isAuthenticated, moduleAccess, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (pwdMismatch) {
      setError('Las contraseñas no coinciden');
      return;
    }
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(apiUrl('/api/auth/accept-invitation'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          name: name.trim(),
          email: info?.email,
          password,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'No se pudo completar el registro');
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
      const session: SessionPayload = {
        user: data.user as SessionPayload['user'],
        organization: data.organization as SessionPayload['organization'],
        role: r,
        role_tier,
        limits: data.limits as SessionPayload['limits'],
        module_access: parseModuleAccess(data),
      };
      login(data.token as string, session);
      navigate(postLoginPath(session.module_access, undefined), { replace: true });
    } catch {
      setError('Error de red');
    } finally {
      setSubmitting(false);
    }
  }

  if (!authLoading && isAuthenticated) {
    return null;
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
        <h1 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: ds.textPrimary }}>
          Aceptar invitación
        </h1>
        <p style={{ margin: '0 0 24px', color: ds.textSecondary, fontSize: 13, lineHeight: 1.5 }}>
          {loadingInfo
            ? 'Comprobando invitación…'
            : info
              ? (
                  <>
                    Te han invitado a <strong>{info.organization_name}</strong> como{' '}
                    <strong>{info.role_label}</strong>. Crea tu contraseña para entrar.
                  </>
                )
              : 'No pudimos cargar los datos de la invitación.'}
        </p>

        {loadErr ? (
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
            {loadErr}
          </div>
        ) : null}

        {error ? (
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
        ) : null}

        {info && !loadErr ? (
          <form onSubmit={handleSubmit}>
            <label style={labelStyle}>
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
              Email (de la invitación)
              <input
                type="email"
                autoComplete="email"
                readOnly
                value={info.email}
                style={{
                  ...inputStyle,
                  marginTop: 8,
                  opacity: 0.85,
                  cursor: 'not-allowed',
                  background: ds.bgSubtle,
                }}
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
            {pwdMismatch ? (
              <p style={{ margin: '8px 0 0', fontSize: 13, color: '#dc2626' }}>
                Las contraseñas deben coincidir
              </p>
            ) : null}

            <button
              type="submit"
              disabled={submitting || pwdMismatch || loadingInfo}
              style={{
                ...primaryButton,
                marginTop: 24,
                opacity: submitting ? 0.85 : 1,
                cursor: submitting ? 'wait' : 'pointer',
              }}
            >
              {submitting ? (
                <>
                  <Spinner />
                  Creando cuenta…
                </>
              ) : (
                'Unirme al workspace'
              )}
            </button>
          </form>
        ) : null}

        <p style={{ marginTop: 20, textAlign: 'center' }}>
          <Link to="/login" style={linkStyle}>
            Ir a iniciar sesión
          </Link>
        </p>
      </div>
    </div>
  );
}
