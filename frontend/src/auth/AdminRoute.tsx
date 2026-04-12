import { Navigate, Outlet } from 'react-router-dom';
import { ds } from '../design-system/ds';
import { useAuth } from './AuthContext';

/** Solo owner y admin (Configuración /settings). */
export function AdminRoute() {
  const { canManageOrg, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: ds.bgApp,
          color: ds.textMuted,
          fontFamily: ds.font,
          fontSize: 13,
        }}
      >
        Cargando…
      </div>
    );
  }

  if (!canManageOrg) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
