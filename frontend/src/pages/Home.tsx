import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import AuthLandingPage from './AuthLandingPage';

/** Ruta `/`: landing pública o redirección al panel. */
export default function Home() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="kovo-auth-landing" style={{ padding: 24, fontFamily: 'system-ui, sans-serif', color: '#26215C' }}>
        Cargando…
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/inicio" replace />;
  }

  return <AuthLandingPage />;
}
