import { Component, Suspense, lazy, type ErrorInfo, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminRoute } from './auth/AdminRoute';
import { useAuth } from './auth/AuthContext';
import { ModuleGuard } from './auth/ModuleGuard';
import { PrivateRoute } from './auth/PrivateRoute';
import { AppShell } from './layout/AppShell';
import PedidosOrderEditPage from './pages/PedidosOrderEditPage';

const CanalesPage = lazy(() => import('./pages/CanalesPage'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const InicioPage = lazy(() => import('./pages/InicioEditorialPage'));
const InventarioPage = lazy(() => import('./pages/InventarioPage'));
const AuthLandingPage = lazy(() => import('./pages/AuthLandingPage'));
const MarketingIndicatorsPage = lazy(() => import('./pages/MarketingIndicatorsPage'));
const GananciaDiariaPage = lazy(() => import('./pages/GananciaDiariaPage'));
const CalculadoraCodPage = lazy(() => import('./calculadora-cod/CalculadoraCodPage'));
const PlaneacionVentasLayout = lazy(() => import('./pages/PlaneacionVentas/PlaneacionVentasLayout'));
const ListaMensualPlaneacion = lazy(() => import('./pages/PlaneacionVentas/ListaMensual'));
const DetallePlanPlaneacion = lazy(() => import('./pages/PlaneacionVentas/DetallePlan'));
const ComisionVentasPage = lazy(() => import('./pages/ComisionVentasPage'));
const EstadoResultadoMoticoPage = lazy(() => import('./pages/EstadoResultadoMoticoPage'));
const MetaAdsPage = lazy(() => import('./pages/MetaAdsPage'));
const ConexionMetaPage = lazy(() => import('./pages/ConexionMetaPage'));
const MoticoPage = lazy(() => import('./pages/MoticoPage'));
const PedidosPage = lazy(() => import('./pages/PedidosPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));
const RelacionPagosMoticoPage = lazy(() => import('./pages/RelacionPagosMoticoPage'));
const Profile = lazy(() => import('./pages/Profile'));
const AcceptInvitation = lazy(() => import('./pages/AcceptInvitation'));
const AnalisisProductoPage = lazy(() => import('./pages/AnalisisProductoPage'));
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage'));
const AdminDashboardContentPage = lazy(() => import('./pages/AdminDashboardContentPage'));
const ReporteDropiPage = lazy(() => import('./pages/ReporteDropiPage'));
const AdsFunnelPage = lazy(() => import('./pages/AdsFunnelPage'));
const EstrategiaCreativaPage = lazy(() => import('./pages/EstrategiaCreativaPage'));
const FinanzaPage = lazy(() => import('./pages/FinanzaPage'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Settings = lazy(() => import('./pages/Settings'));

function RootLandingRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <div style={{ padding: 20 }}>Cargando…</div>;
  if (isAuthenticated) return <Navigate to="/inicio" replace />;
  return <AuthLandingPage />;
}

class RouteErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error('[route-error-boundary]', error, errorInfo);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{ maxWidth: 640, margin: '40px auto', padding: 16 }}>
        <h2 style={{ margin: '0 0 8px' }}>No se pudo abrir el editor del pedido</h2>
        <p style={{ margin: '0 0 12px', color: '#475569' }}>
          Ocurrió un error inesperado en esta vista. Puedes volver a Pedidos e intentar de nuevo.
        </p>
        <a href="/pedidos" style={{ color: '#2563eb', fontWeight: 600 }}>
          Volver a Pedidos
        </a>
      </div>
    );
  }
}

export default function App() {
  return (
    <Suspense fallback={<div style={{ padding: 20 }}>Cargando…</div>}>
      <Routes>
        <Route path="/" element={<RootLandingRoute />} />
        <Route path="/login" element={<AuthLandingPage />} />
        <Route path="/register" element={<AuthLandingPage />} />
        <Route path="/aceptar-invitacion" element={<AcceptInvitation />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/privacy" element={<PrivacyPage />} />

        <Route element={<PrivateRoute />}>
          <Route element={<AppShell />}>
            <Route element={<ModuleGuard />}>
              <Route path="/inicio" element={<InicioPage />} />
              <Route path="/dashboard" element={<InicioPage />} />
              <Route path="/analisis-producto" element={<AnalisisProductoPage />} />
              <Route path="/pedidos" element={<PedidosPage />} />
              <Route path="/relacion-pagos-motico" element={<RelacionPagosMoticoPage />} />
              <Route
                path="/pedidos/editar/:orderId"
                element={
                  <RouteErrorBoundary>
                    <PedidosOrderEditPage />
                  </RouteErrorBoundary>
                }
              />
              <Route path="/pedidos/orden-manual" element={<MoticoPage />} />
              <Route path="/inventario" element={<InventarioPage />} />
              <Route path="/meta-ads" element={<MetaAdsPage />} />
              <Route path="/conexion-meta" element={<ConexionMetaPage />} />
              <Route path="/ads-funnel" element={<AdsFunnelPage />} />
              <Route path="/estrategia-creativa" element={<EstrategiaCreativaPage />} />
              <Route path="/finanza" element={<FinanzaPage />} />
              <Route path="/indicadores-marketing" element={<MarketingIndicatorsPage />} />
              <Route path="/canales" element={<CanalesPage />} />
              <Route path="/ganancia-diaria" element={<GananciaDiariaPage />} />
              <Route path="/calculadora-cod" element={<CalculadoraCodPage />} />
              <Route path="/comision-ventas" element={<ComisionVentasPage />} />
              <Route path="/estado-resultado-motico" element={<EstadoResultadoMoticoPage />} />
              <Route path="/planeacion-ventas" element={<PlaneacionVentasLayout />}>
                <Route index element={<ListaMensualPlaneacion />} />
                <Route path=":id" element={<DetallePlanPlaneacion />} />
              </Route>
            </Route>
            <Route path="/profile" element={<Profile />} />
            <Route path="/reporte-dropi" element={<ReporteDropiPage />} />
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/admin/dashboard-content" element={<AdminDashboardContentPage />} />
            <Route element={<AdminRoute />}>
              <Route path="/settings" element={<Settings />} />
              <Route path="/configuracion" element={<Settings />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
