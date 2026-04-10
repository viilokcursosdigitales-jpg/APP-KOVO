import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { META_BLUE, PAGE_BG, SHOPIFY_GREEN, SIDEBAR } from './authStyles';

export default function Home() {
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <div
      style={{
        minHeight: '100vh',
        background: `linear-gradient(160deg, ${SIDEBAR} 0%, #252542 50%, ${PAGE_BG} 50%)`,
        fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          maxWidth: 520,
          background: 'rgba(255,255,255,0.98)',
          borderRadius: 20,
          padding: 'clamp(32px, 6vw, 48px)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.15)',
        }}
      >
        <div
          style={{
            fontSize: 28,
            fontWeight: 800,
            color: SIDEBAR,
            letterSpacing: '-0.03em',
            marginBottom: 12,
          }}
        >
          KOVO
        </div>
        <h1 style={{ margin: '0 0 16px', fontSize: 'clamp(22px, 4vw, 28px)', color: '#111827' }}>
          Panel de anuncios y tienda
        </h1>
        <p style={{ margin: '0 0 28px', color: '#6b7280', fontSize: 16, lineHeight: 1.55 }}>
          Gestiona Meta Ads, pedidos e inventario desde un solo lugar. Inicia sesión para entrar al panel.
        </p>

        {!isLoading && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
            {isAuthenticated ? (
              <Link
                to="/dashboard"
                style={{
                  padding: '14px 28px',
                  borderRadius: 10,
                  background: META_BLUE,
                  color: '#fff',
                  fontWeight: 700,
                  textDecoration: 'none',
                  fontSize: 16,
                }}
              >
                Ir al panel
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  style={{
                    padding: '14px 28px',
                    borderRadius: 10,
                    background: META_BLUE,
                    color: '#fff',
                    fontWeight: 700,
                    textDecoration: 'none',
                    fontSize: 16,
                  }}
                >
                  Iniciar sesión
                </Link>
                <Link
                  to="/register"
                  style={{
                    padding: '14px 28px',
                    borderRadius: 10,
                    border: `2px solid ${SHOPIFY_GREEN}`,
                    color: '#3d5c1f',
                    fontWeight: 700,
                    textDecoration: 'none',
                    fontSize: 16,
                    background: '#fff',
                  }}
                >
                  Crear cuenta
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
