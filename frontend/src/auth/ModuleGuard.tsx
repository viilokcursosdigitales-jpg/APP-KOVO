import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { canAccessPath, firstAllowedPath } from '../appModules';
import { ds } from '../design-system/ds';
import { useAuth } from './AuthContext';

/**
 * Restringe rutas de la app según module_access de la sesión.
 * Rutas sin módulo (p. ej. /profile) deben declararse fuera de este guard.
 */
export function ModuleGuard() {
  const { isLoading, moduleAccess } = useAuth();
  const { pathname } = useLocation();

  if (isLoading) {
    return (
      <div
        style={{
          minHeight: '40vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: ds.textMuted,
          fontSize: 13,
        }}
      >
        Cargando…
      </div>
    );
  }

  if (!canAccessPath(moduleAccess, pathname)) {
    return <Navigate to={firstAllowedPath(moduleAccess)} replace />;
  }

  return <Outlet />;
}
