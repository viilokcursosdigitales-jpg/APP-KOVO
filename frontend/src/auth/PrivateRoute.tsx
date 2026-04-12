import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ds } from '../design-system/ds';
import { useAuth } from './AuthContext';

export function PrivateRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: ds.bgApp,
          fontFamily: ds.font,
          color: ds.textMuted,
          fontSize: 13,
        }}
      >
        Cargando sesión…
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
