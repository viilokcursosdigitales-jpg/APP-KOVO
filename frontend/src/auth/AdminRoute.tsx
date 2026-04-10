import { Navigate, Outlet } from 'react-router-dom';
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
          background: '#f4f5f7',
          color: '#6b7280',
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
