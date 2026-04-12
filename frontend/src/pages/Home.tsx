import { Link } from 'react-router-dom';
import { postLoginPath } from '../appModules';
import { useAuth } from '../auth/AuthContext';
import { ds } from '../design-system/ds';
import { META_BLUE } from './authStyles';

export default function Home() {
  const { isAuthenticated, isLoading, moduleAccess } = useAuth();

  return (
    <div className="kovo-auth-root">
      <div
        style={{
          maxWidth: 520,
          width: '100%',
          background: ds.bgCard,
          borderRadius: 14,
          padding: 'clamp(28px, 6vw, 40px)',
          border: `1px solid ${ds.borderCard}`,
          textAlign: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: ds.brand }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: ds.textPrimary }}>KOVO</span>
        </div>
        <h1 style={{ margin: '0 0 12px', fontSize: 20, fontWeight: 700, color: ds.textPrimary }}>
          Panel de anuncios y tienda
        </h1>
        <p style={{ margin: '0 0 24px', color: ds.textSecondary, fontSize: 13, lineHeight: 1.55 }}>
          Gestiona Meta Ads, pedidos e inventario desde un solo lugar. Inicia sesión para entrar al panel.
        </p>

        {!isLoading && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
            {isAuthenticated ? (
              <Link
                to={postLoginPath(moduleAccess, undefined)}
                style={{
                  padding: '8px 18px',
                  borderRadius: 8,
                  background: META_BLUE,
                  color: '#fff',
                  fontWeight: 600,
                  textDecoration: 'none',
                  fontSize: 13,
                }}
              >
                Ir al panel
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  style={{
                    padding: '8px 18px',
                    borderRadius: 8,
                    background: META_BLUE,
                    color: '#fff',
                    fontWeight: 600,
                    textDecoration: 'none',
                    fontSize: 13,
                  }}
                >
                  Iniciar sesión
                </Link>
                <Link
                  to="/register"
                  style={{
                    padding: '8px 18px',
                    borderRadius: 8,
                    border: `1px solid ${ds.borderCard}`,
                    color: ds.textSecondary,
                    fontWeight: 600,
                    textDecoration: 'none',
                    fontSize: 13,
                    background: ds.bgCard,
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
