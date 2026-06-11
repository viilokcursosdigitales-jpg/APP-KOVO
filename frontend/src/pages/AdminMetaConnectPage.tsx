import { Navigate } from 'react-router-dom';

/** Redirige al flujo unificado de conexión Meta (System User). */
export default function AdminMetaConnectPage() {
  return <Navigate to="/conexion-meta" replace />;
}
