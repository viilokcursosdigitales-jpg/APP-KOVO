import { useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  IconBrandMeta,
  IconCalculator,
  IconChartBar,
  IconCheck,
  IconQuote,
  IconTruck,
} from '@tabler/icons-react';
import { postLoginPath } from '../appModules';
import { useAuth, type SessionPayload } from '../auth/AuthContext';
import { apiUrl } from '../auth/api';
import { alpha, ds } from '../design-system/ds';
import { labelStyle } from './authStyles';

/** Paleta landing auth KOVO */
const AL = {
  kovoDark: '#26215C',
  purpleMid: '#534AB7',
  purpleLight: '#7F77DD',
  purpleText: '#AFA9EC',
  purpleCard: '#3C3489',
  green: '#1D9E75',
  greenDark: '#0F6E56',
  coral: '#D85A30',
  coralDark: '#993C1D',
  amber: '#BA7517',
  amberDark: '#854F0B',
  blue: '#185FA5',
  pink: '#993556',
  grayBg: '#F1EFE8',
  grayBorder: '#D3D1C7',
} as const;

function Spinner() {
  return (
    <span
      style={{
        width: 18,
        height: 18,
        border: '2px solid #fff6',
        borderTopColor: '#fff',
        borderRadius: '50%',
        animation: 'kovoAuthSpin 0.65s linear infinite',
      }}
    />
  );
}

function parseModuleAccessFromLoginBody(data: Record<string, unknown>): string[] | null {
  const m = data.module_access;
  if (m === undefined || m === null) return null;
  if (Array.isArray(m)) return m.filter((x): x is string => typeof x === 'string');
  return null;
}

const inputBase: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 12px',
  borderRadius: 10,
  border: `1px solid ${AL.grayBorder}`,
  fontSize: 14,
  color: AL.kovoDark,
  background: '#fff',
};

const primaryCta: CSSProperties = {
  width: '100%',
  padding: '14px 18px',
  borderRadius: 10,
  border: 'none',
  background: AL.purpleLight,
  color: '#fff',
  fontWeight: 700,
  fontSize: 15,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
};

type TabMode = 'register' | 'login';

export default function AuthLandingPage() {
  const { login, isAuthenticated, isLoading: authLoading, moduleAccess } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const state = location.state as { from?: string } | undefined;

  const registered = params.get('registered') === '1';
  const pathname = location.pathname;
  const mode: TabMode = pathname === '/login' ? 'login' : 'register';

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [organizationName, setOrganizationName] = useState('');
  const [name, setName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regError, setRegError] = useState('');
  const [regSuccess, setRegSuccess] = useState(false);
  const [regLoading, setRegLoading] = useState(false);

  if (!authLoading && isAuthenticated) {
    return <Navigate to={postLoginPath(moduleAccess, undefined)} replace />;
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoginError(typeof data.error === 'string' ? data.error : 'No se pudo iniciar sesión');
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
      const modAccess = parseModuleAccessFromLoginBody(data as Record<string, unknown>);
      const session: SessionPayload = {
        user: data.user,
        organization: data.organization,
        role: r,
        role_tier,
        limits: data.limits,
        module_access: modAccess,
      };
      login(data.token, session);
      navigate(
        postLoginPath(modAccess, typeof state?.from === 'string' ? state.from : undefined),
        { replace: true },
      );
    } catch {
      setLoginError('Error de red. Comprueba que el servidor esté en marcha.');
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setRegError('');
    if (regPassword.length < 8) {
      setRegError('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    if (!organizationName.trim() || organizationName.trim().length < 2) {
      setRegError('Indica el nombre de tu tienda');
      return;
    }
    if (!name.trim() || name.trim().length < 2) {
      setRegError('Indica tu nombre completo');
      return;
    }
    setRegLoading(true);
    try {
      const res = await fetch(apiUrl('/api/auth/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationName: organizationName.trim(),
          name: name.trim(),
          email: regEmail.trim(),
          password: regPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRegError(typeof data.error === 'string' ? data.error : 'No se pudo crear la cuenta');
        return;
      }
      setRegSuccess(true);
      window.setTimeout(() => {
        navigate('/login?registered=1', { replace: true });
      }, 1800);
    } catch {
      setRegError('Error de red. Comprueba que el servidor esté en marcha.');
    } finally {
      setRegLoading(false);
    }
  }

  function scrollToForm() {
    const runScroll = () =>
      document.getElementById('kovo-auth-form-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (pathname !== '/register') {
      navigate('/register');
      window.setTimeout(runScroll, 80);
    } else {
      runScroll();
    }
  }

  const pillStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '6px 12px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    background: `${AL.grayBg}`,
    color: AL.kovoDark,
    border: `1px solid ${AL.grayBorder}`,
  };

  const features = useMemo(
    () => [
      {
        icon: <IconBrandMeta size={22} stroke={1.6} />,
        title: 'Meta Ads + Shopify conectados',
        desc: 'Une tu inversión publicitaria con las ventas reales de tu tienda.',
      },
      {
        icon: <IconChartBar size={22} stroke={1.6} />,
        title: 'ROAS real por producto',
        desc: 'Ve qué SKU paga el anuncio y cuál solo gasta presupuesto.',
      },
      {
        icon: <IconTruck size={22} stroke={1.6} />,
        title: 'Logística Dropi en segundos',
        desc: 'Sube tu export y obtén efectividad y resultados sin Excel.',
      },
      {
        icon: <IconCalculator size={22} stroke={1.6} />,
        title: 'Calculadora COD inteligente',
        desc: 'Simula ganancia neta antes de lanzar precio o campaña.',
      },
    ],
    [],
  );

  return (
    <div className="kovo-auth-landing">
      <style>{`
        @keyframes kovoAuthSpin { to { transform: rotate(360deg); } }
        .auth-hero-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          min-height: min(920px, auto);
        }
        @media (max-width: 960px) {
          .auth-hero-grid { grid-template-columns: 1fr; }
          .auth-hero-form-col {
            border-left: none !important;
            border-top: 1px solid ${AL.grayBorder};
          }
        }
        .auth-modules-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 20px 64px;
        }
        @media (max-width: 1024px) {
          .auth-modules-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      {/* —— Hero —— */}
      <section className="auth-hero-grid" style={{ width: '100%' }}>
        {/* Izquierda */}
        <div
          style={{
            background: AL.kovoDark,
            color: '#fff',
            padding: 'clamp(32px, 5vw, 56px)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 24,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: AL.purpleLight,
                display: 'grid',
                placeItems: 'center',
                color: '#fff',
                fontWeight: 800,
                fontSize: 18,
              }}
            >
              K
            </div>
            <span style={{ fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em' }}>KOVO</span>
          </div>

          <div
            style={{
              alignSelf: 'flex-start',
              padding: '6px 14px',
              borderRadius: 999,
              background: AL.purpleCard,
              color: AL.purpleText,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Panel todo en uno para ecommerce
          </div>

          <h1 style={{ margin: 0, fontSize: 'clamp(26px, 4vw, 38px)', fontWeight: 800, lineHeight: 1.15, maxWidth: 520 }}>
            Deja de adivinar. Empieza a ganar con datos.
          </h1>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.55, color: AL.purpleText, maxWidth: 480 }}>
            Centraliza Meta, Shopify y tu operación en un solo lugar. Menos planillas, más decisiones que facturan.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {features.map((f) => (
              <div key={f.title} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div
                  style={{
                    flexShrink: 0,
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: AL.purpleCard,
                    display: 'grid',
                    placeItems: 'center',
                    color: AL.purpleLight,
                  }}
                >
                  {f.icon}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{f.title}</div>
                  <div style={{ fontSize: 13, color: AL.purpleText, lineHeight: 1.5 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 8,
              padding: '20px 22px',
              borderRadius: 14,
              background: AL.purpleCard,
              border: `1px solid ${AL.purpleMid}55`,
            }}
          >
            <IconQuote size={22} color={AL.purpleLight} style={{ marginBottom: 10, opacity: 0.9 }} />
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: '#fff' }}>
              &ldquo;Antes tardaba 2 horas exportando datos. Ahora entro a KOVO y en 30 segundos sé qué campaña está
              funcionando.&rdquo;
            </p>
            <p style={{ margin: '14px 0 0', fontSize: 13, color: AL.purpleText }}>
              — Luis Viloria, Kindiu · Tienda de ropa infantil
            </p>
          </div>
        </div>

        {/* Derecha — formulario */}
        <div
          id="kovo-auth-form-anchor"
          className="auth-hero-form-col"
          style={{
            background: '#fff',
            padding: 'clamp(28px, 4vw, 48px)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            borderLeft: `1px solid ${AL.grayBorder}`,
          }}
        >
          <h2 style={{ margin: '0 0 8px', fontSize: 26, fontWeight: 800, color: AL.kovoDark }}>Empieza gratis hoy</h2>
          <p style={{ margin: '0 0 20px', fontSize: 15, color: '#5c5a72' }}>
            5 días de acceso completo sin tarjeta de crédito
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 22 }}>
            {['5 días gratis', 'Sin tarjeta', 'Cancela cuando quieras', 'Soporte incluido'].map((t) => (
              <span key={t} style={pillStyle}>
                <IconCheck size={14} stroke={2.5} style={{ marginRight: 6, color: AL.green }} />
                {t}
              </span>
            ))}
          </div>

          <div
            style={{
              display: 'flex',
              marginBottom: 20,
              borderRadius: 12,
              padding: 4,
              background: AL.grayBg,
              border: `1px solid ${AL.grayBorder}`,
            }}
          >
            <Link
              to="/register"
              style={{
                flex: 1,
                textAlign: 'center',
                padding: '12px 16px',
                borderRadius: 10,
                fontWeight: 700,
                fontSize: 14,
                textDecoration: 'none',
                color: mode === 'register' ? AL.kovoDark : '#6b6980',
                background: mode === 'register' ? '#fff' : 'transparent',
                boxShadow: mode === 'register' ? '0 1px 4px rgba(38,33,92,0.08)' : 'none',
              }}
            >
              Crear cuenta
            </Link>
            <Link
              to="/login"
              style={{
                flex: 1,
                textAlign: 'center',
                padding: '12px 16px',
                borderRadius: 10,
                fontWeight: 700,
                fontSize: 14,
                textDecoration: 'none',
                color: mode === 'login' ? AL.kovoDark : '#6b6980',
                background: mode === 'login' ? '#fff' : 'transparent',
                boxShadow: mode === 'login' ? '0 1px 4px rgba(38,33,92,0.08)' : 'none',
              }}
            >
              Iniciar sesión
            </Link>
          </div>

          {registered && mode === 'login' && (
            <div
              style={{
                marginBottom: 16,
                padding: '12px 14px',
                borderRadius: 10,
                background: alpha.brand12,
                color: ds.brand,
                fontSize: 13,
                border: `1px solid ${AL.grayBorder}`,
              }}
            >
              Cuenta creada. Ya puedes entrar con tu email y contraseña.
            </div>
          )}

          {mode === 'register' ? (
            <>
              {regSuccess && (
                <div
                  style={{
                    marginBottom: 16,
                    padding: '12px 14px',
                    borderRadius: 10,
                    background: `${AL.green}18`,
                    color: AL.greenDark,
                    fontSize: 13,
                    border: `1px solid ${AL.grayBorder}`,
                  }}
                >
                  ¡Cuenta creada! Redirigiendo al inicio de sesión…
                </div>
              )}
              {regError && (
                <div
                  style={{
                    marginBottom: 16,
                    padding: '12px 14px',
                    borderRadius: 10,
                    background: ds.dangerBg,
                    color: ds.dangerText,
                    fontSize: 13,
                    border: `1px solid ${AL.grayBorder}`,
                  }}
                >
                  {regError}
                </div>
              )}
              <form onSubmit={handleRegister}>
                <label style={{ ...labelStyle, color: AL.kovoDark }}>
                  Nombre completo
                  <input
                    type="text"
                    autoComplete="name"
                    required
                    minLength={2}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    style={{ ...inputBase, marginTop: 8 }}
                  />
                </label>
                <label style={{ ...labelStyle, color: AL.kovoDark, marginTop: 14 }}>
                  Correo electrónico
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    style={{ ...inputBase, marginTop: 8 }}
                  />
                </label>
                <label style={{ ...labelStyle, color: AL.kovoDark, marginTop: 14 }}>
                  Nombre de tu tienda
                  <input
                    type="text"
                    autoComplete="organization"
                    required
                    minLength={2}
                    value={organizationName}
                    onChange={(e) => setOrganizationName(e.target.value)}
                    placeholder="Ej. Mi tienda online"
                    style={{ ...inputBase, marginTop: 8 }}
                  />
                </label>
                <label style={{ ...labelStyle, color: AL.kovoDark, marginTop: 14 }}>
                  Contraseña
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    style={{ ...inputBase, marginTop: 8 }}
                  />
                </label>
                <button
                  type="submit"
                  disabled={regLoading || regSuccess}
                  style={{
                    ...primaryCta,
                    marginTop: 22,
                    opacity: regLoading || regSuccess ? 0.88 : 1,
                    cursor: regLoading || regSuccess ? 'wait' : 'pointer',
                  }}
                >
                  {regLoading ? (
                    <>
                      <Spinner />
                      Creando cuenta…
                    </>
                  ) : (
                    <>Crear cuenta gratis — 5 días sin costo →</>
                  )}
                </button>
              </form>
            </>
          ) : (
            <>
              {loginError && (
                <div
                  style={{
                    marginBottom: 16,
                    padding: '12px 14px',
                    borderRadius: 10,
                    background: ds.dangerBg,
                    color: ds.dangerText,
                    fontSize: 13,
                    border: `1px solid ${AL.grayBorder}`,
                  }}
                >
                  {loginError}
                </div>
              )}
              <form onSubmit={handleLogin}>
                <label style={{ ...labelStyle, color: AL.kovoDark }}>
                  Correo electrónico
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    style={{ ...inputBase, marginTop: 8 }}
                  />
                </label>
                <label style={{ ...labelStyle, color: AL.kovoDark, marginTop: 14 }}>
                  Contraseña
                  <div style={{ position: 'relative', marginTop: 8 }}>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      style={{ ...inputBase, marginTop: 0, paddingRight: 44 }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      style={{
                        position: 'absolute',
                        right: 10,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        fontSize: 16,
                        color: '#6b6980',
                      }}
                    >
                      👁
                    </button>
                  </div>
                </label>
                <div style={{ marginTop: 8, textAlign: 'right' }}>
                  <Link
                    to="/forgot-password"
                    style={{ fontSize: 13, fontWeight: 600, color: AL.purpleMid, textDecoration: 'none' }}
                  >
                    ¿Olvidaste tu contraseña?
                  </Link>
                </div>
                <button
                  type="submit"
                  disabled={loginLoading}
                  style={{
                    ...primaryCta,
                    marginTop: 18,
                    opacity: loginLoading ? 0.88 : 1,
                    cursor: loginLoading ? 'wait' : 'pointer',
                  }}
                >
                  {loginLoading ? (
                    <>
                      <Spinner />
                      Iniciando sesión…
                    </>
                  ) : (
                    <>Iniciar sesión →</>
                  )}
                </button>
              </form>
            </>
          )}

          <div
            style={{
              marginTop: 22,
              padding: '14px 16px',
              borderRadius: 12,
              background: `${AL.green}15`,
              border: `1px solid ${AL.green}44`,
              fontSize: 13,
              lineHeight: 1.5,
              color: AL.greenDark,
            }}
          >
            <strong style={{ display: 'block', marginBottom: 6 }}>Garantía total</strong>
            Si KOVO no te ahorra tiempo en la primera semana, te ayudamos sin costo adicional.
          </div>

          <p style={{ margin: '20px 0 0', fontSize: 12, lineHeight: 1.55, color: '#6b6980' }}>
            Al continuar aceptas nuestros{' '}
            <Link to="/privacy" style={{ color: AL.purpleMid, fontWeight: 600 }}>
              términos de uso
            </Link>{' '}
            y la{' '}
            <Link to="/privacy" style={{ color: AL.purpleMid, fontWeight: 600 }}>
              política de privacidad
            </Link>
            .
          </p>
          <p style={{ margin: '12px 0 0', fontSize: 12 }}>
            <Link to="/" style={{ color: '#6b6980', fontWeight: 500, textDecoration: 'none' }}>
              ← Volver al inicio
            </Link>
          </p>
        </div>
      </section>

      {/* —— Módulos —— */}
      <section style={{ background: AL.grayBg, padding: '56px 0 16px' }}>
        <h2
          style={{
            textAlign: 'center',
            margin: '0 auto 40px',
            fontSize: 'clamp(22px, 3vw, 30px)',
            fontWeight: 800,
            color: AL.kovoDark,
            maxWidth: 720,
            padding: '0 20px',
            lineHeight: 1.25,
          }}
        >
          Cada módulo resuelve un dolor real de tu negocio
        </h2>

        <div className="auth-modules-grid">
          <ModuleCardMeta />
          <ModuleCardProduct />
          <ModuleCardCod />
          <ModuleCardDropi />
          <ModuleCardGanancia />
          <ModuleCardEstrategia />
        </div>
      </section>

      {/* —— CTA final —— */}
      <section
        style={{
          background: AL.kovoDark,
          color: '#fff',
          padding: 'clamp(48px, 8vw, 80px) 24px',
          textAlign: 'center',
        }}
      >
        <h2 style={{ margin: '0 auto 16px', fontSize: 'clamp(24px, 3.5vw, 34px)', fontWeight: 800, maxWidth: 640 }}>
          Tu competencia ya está tomando mejores decisiones
        </h2>
        <p
          style={{
            margin: '0 auto 28px',
            fontSize: 16,
            lineHeight: 1.6,
            color: AL.purpleText,
            maxWidth: 560,
          }}
        >
          Cada día sin datos claros es dinero que se va. Únete a los dueños de tienda que usan KOVO para crecer con
          intención — no con suerte.
        </p>
        <button
          type="button"
          onClick={scrollToForm}
          style={{
            padding: '16px 36px',
            borderRadius: 12,
            border: 'none',
            background: AL.purpleLight,
            color: '#fff',
            fontWeight: 800,
            fontSize: 16,
            cursor: 'pointer',
            marginBottom: 22,
          }}
        >
          Empezar gratis ahora →
        </button>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
          {['5 días gratis', 'Sin tarjeta', 'Configuración 5 min', 'Soporte en español'].map((t) => (
            <span key={t} style={{ ...pillStyle, background: AL.purpleCard, color: AL.purpleText, border: 'none' }}>
              {t}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

/* —— Module cards —— */

function ModuleCardMeta() {
  return (
    <div style={moduleShell(AL.purpleMid)}>
      <div style={moduleTitle}>Deja de gastar en anuncios que no venden</div>
      <p style={moduleCopy}>
        ¿Cuánto llevas invertido este mes en Meta? ¿Y cuánto ganaste de verdad? KOVO conecta tu cuenta publicitaria con
        tus ventas reales y te muestra el ROAS honesto — no el que Meta quiere que veas.
      </p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 12, height: 72 }}>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ height: 52, borderRadius: 8, background: AL.green, marginBottom: 6 }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: AL.greenDark }}>9.6×</span>
        </div>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ height: 22, borderRadius: 8, background: AL.coral, marginBottom: 6 }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: AL.coralDark }}>1.2×</span>
        </div>
      </div>
      <p style={moduleTech}>
        Conecta vía OAuth con Meta Ads API. Sincroniza campañas con datos de conversión de Shopify en tiempo real.
      </p>
    </div>
  );
}

function ModuleCardProduct() {
  return (
    <div style={moduleShell(AL.greenDark)}>
      <div style={moduleTitle}>Sabe cuál producto te hace rico y cuál te hunde</div>
      <p style={moduleCopy}>
        Tienes 10 productos. ¿Cuáles 3 generan el 80% de tu ganancia? Con KOVO lo sabes en segundos, no en horas de
        Excel.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 64, marginBottom: 12 }}>
        <div style={{ flex: 1, height: '45%', background: AL.green, borderRadius: 6 }} />
        <div style={{ flex: 1, height: '85%', background: AL.green, borderRadius: 6 }} />
        <div style={{ flex: 1, height: '30%', background: `${AL.green}55`, borderRadius: 6 }} />
      </div>
      <p style={moduleTech}>
        Cruza datos de Shopify + Meta por SKU. Calcula CPA, ROAS y margen neto por producto.
      </p>
    </div>
  );
}

function ModuleCardCod() {
  return (
    <div style={moduleShell(AL.amberDark)}>
      <div style={moduleTitle}>¿Cuánto ganás por pedido, de verdad?</div>
      <p style={moduleCopy}>
        El precio de venta no es tu ganancia. Le descontás el flete, la devolución, el costo... ¿cuánto queda? KOVO lo
        calcula en tiempo real antes de que lances.
      </p>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          padding: '10px 12px',
          borderRadius: 10,
          background: '#fff',
          color: AL.kovoDark,
          marginBottom: 12,
          border: `1px solid ${AL.grayBorder}`,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span>Precio</span>
          <span>$120.000</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, color: AL.coralDark }}>
          <span>Costos</span>
          <span>−$78.000</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: AL.greenDark }}>
          <span>Ganancia neta</span>
          <span>$42.000</span>
        </div>
      </div>
      <p style={moduleTech}>Simulador de rentabilidad por unidad con precio, costos, flete y comisión.</p>
    </div>
  );
}

function ModuleCardDropi() {
  return (
    <div style={moduleShell(AL.coralDark)}>
      <div style={moduleTitle}>Tu logística en un vistazo, no en una hoja de cálculo</div>
      <p style={moduleCopy}>
        ¿Qué producto tiene más devoluciones? ¿Qué transportadora te falla más? Sube tu reporte de Dropi y KOVO hace el
        análisis completo al instante.
      </p>
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
          <span>Efectividad</span>
          <span style={{ color: AL.greenDark, fontWeight: 800 }}>86.6%</span>
        </div>
        <div style={{ height: 10, borderRadius: 999, background: `${AL.green}33`, overflow: 'hidden' }}>
          <div style={{ width: '86.6%', height: '100%', background: AL.green, borderRadius: 999 }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 10, marginBottom: 4 }}>
          <span>Devoluciones</span>
          <span style={{ color: AL.coralDark, fontWeight: 800 }}>9.6%</span>
        </div>
        <div style={{ height: 10, borderRadius: 999, background: `${AL.coral}22`, overflow: 'hidden' }}>
          <div style={{ width: '9.6%', height: '100%', background: AL.coral, borderRadius: 999 }} />
        </div>
      </div>
      <p style={moduleTech}>
        Carga archivos .xlsx de Dropi. Procesa localmente. KPIs de efectividad y estado de resultados.
      </p>
    </div>
  );
}

function ModuleCardGanancia() {
  return (
    <div style={moduleShell(AL.blue)}>
      <div style={moduleTitle}>¿Hoy ganaste o perdiste? Saberlo en 10 segundos</div>
      <p style={moduleCopy}>
        Muchos dueños de tienda cierran el día sin saber si fueron rentables. Con KOVO lo ves en segundos — ventas, gasto
        en ads y utilidad real.
      </p>
      <div
        style={{
          fontSize: 11,
          borderRadius: 10,
          overflow: 'hidden',
          border: `1px solid ${AL.grayBorder}`,
          marginBottom: 12,
        }}
      >
        {[
          ['Ventas', '$604K'],
          ['Gasto', '$62K'],
          ['ROAS', '9.64×'],
          ['Utilidad', '$90K'],
        ].map(([k, v], i) => (
          <div
            key={k}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '8px 10px',
              background: i % 2 === 0 ? '#fff' : AL.grayBg,
              fontWeight: 600,
            }}
          >
            <span>{k}</span>
            <span style={{ color: k === 'Utilidad' ? AL.greenDark : AL.kovoDark }}>{v}</span>
          </div>
        ))}
      </div>
      <p style={moduleTech}>Dashboard en tiempo real Shopify + Meta. Filtros por período y alertas de ROAS.</p>
    </div>
  );
}

function ModuleCardEstrategia() {
  return (
    <div style={moduleShell(AL.pink)}>
      <div style={moduleTitle}>Crea anuncios que venden, no que se ven bonitos</div>
      <p style={moduleCopy}>
        ¿Qué ángulo de copy convierte más en tu nicho? KOVO te da frameworks probados para crear creativos que generan
        ventas reales.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {['Pain→Solución', 'Testimonio', 'Urgencia', 'Comparación'].map((t) => (
          <span
            key={t}
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '6px 10px',
              borderRadius: 999,
              background: '#fff',
              color: AL.pink,
              border: `1px solid ${AL.grayBorder}`,
            }}
          >
            {t}
          </span>
        ))}
      </div>
      <p style={moduleTech}>
        Biblioteca de frameworks de copy organizados por objetivo, audiencia y etapa del funnel.
      </p>
    </div>
  );
}

const moduleTitle: CSSProperties = {
  fontSize: 17,
  fontWeight: 800,
  marginBottom: 10,
  lineHeight: 1.35,
};

const moduleCopy: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.55,
  margin: '0 0 14px',
  opacity: 0.95,
};

const moduleTech: CSSProperties = {
  fontSize: 11,
  lineHeight: 1.45,
  margin: 0,
  opacity: 0.85,
  fontStyle: 'italic' as const,
};

function moduleShell(accent: string): CSSProperties {
  return {
    background: '#fff',
    borderRadius: 16,
    padding: '22px 20px',
    border: `1px solid ${AL.grayBorder}`,
    boxShadow: '0 8px 32px rgba(38,33,92,0.06)',
    borderTop: `4px solid ${accent}`,
  };
}
