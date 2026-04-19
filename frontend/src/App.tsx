import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminRoute } from './auth/AdminRoute';
import { ModuleGuard } from './auth/ModuleGuard';
import { PrivateRoute } from './auth/PrivateRoute';
import { AppShell } from './layout/AppShell';

const CanalesPage = lazy(() => import('./pages/CanalesPage'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const Home = lazy(() => import('./pages/Home'));
const InicioPage = lazy(() => import('./pages/InicioPage'));
const InventarioPage = lazy(() => import('./pages/InventarioPage'));
const Login = lazy(() => import('./pages/Login'));
const MarketingIndicatorsPage = lazy(() => import('./pages/MarketingIndicatorsPage'));
const GananciaDiariaPage = lazy(() => import('./pages/GananciaDiariaPage'));
const CalculadoraCodPage = lazy(() => import('./calculadora-cod/CalculadoraCodPage'));
const PlaneacionVentasLayout = lazy(() => import('./pages/PlaneacionVentas/PlaneacionVentasLayout'));
const ListaMensualPlaneacion = lazy(() => import('./pages/PlaneacionVentas/ListaMensual'));
const DetallePlanPlaneacion = lazy(() => import('./pages/PlaneacionVentas/DetallePlan'));
const ComisionVentasPage = lazy(() => import('./pages/ComisionVentasPage'));
const MetaAdsPage = lazy(() => import('./pages/MetaAdsPage'));
const MoticoPage = lazy(() => import('./pages/MoticoPage'));
const PedidosPage = lazy(() => import('./pages/PedidosPage'));
const RelacionPagosMoticoPage = lazy(() => import('./pages/RelacionPagosMoticoPage'));
const PedidosOrderEditPage = lazy(() => import('./pages/PedidosOrderEditPage'));
const Profile = lazy(() => import('./pages/Profile'));
const AcceptInvitation = lazy(() => import('./pages/AcceptInvitation'));
const AnalisisProductoPage = lazy(() => import('./pages/AnalisisProductoPage'));
const AdsFunnelPage = lazy(() => import('./pages/AdsFunnelPage'));
const FinanzaPage = lazy(() => import('./pages/FinanzaPage'));
const Register = lazy(() => import('./pages/Register'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Settings = lazy(() => import('./pages/Settings'));

export default function App() {
  return (
    <Suspense fallback={<div style={{ padding: 20 }}>Cargando…</div>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/aceptar-invitacion" element={<AcceptInvitation />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route element={<PrivateRoute />}>
          <Route element={<AppShell />}>
            <Route element={<ModuleGuard />}>
              <Route path="/inicio" element={<InicioPage />} />
              <Route path="/dashboard" element={<InicioPage />} />
              <Route path="/analisis-producto" element={<AnalisisProductoPage />} />
              <Route path="/pedidos" element={<PedidosPage />} />
              <Route path="/relacion-pagos-motico" element={<RelacionPagosMoticoPage />} />
              <Route path="/pedidos/editar/:orderId" element={<PedidosOrderEditPage />} />
              <Route path="/pedidos/orden-manual" element={<MoticoPage />} />
              <Route path="/inventario" element={<InventarioPage />} />
              <Route path="/meta-ads" element={<MetaAdsPage />} />
              <Route path="/ads-funnel" element={<AdsFunnelPage />} />
              <Route path="/finanza" element={<FinanzaPage />} />
              <Route path="/indicadores-marketing" element={<MarketingIndicatorsPage />} />
              <Route path="/canales" element={<CanalesPage />} />
              <Route path="/ganancia-diaria" element={<GananciaDiariaPage />} />
              <Route path="/calculadora-cod" element={<CalculadoraCodPage />} />
              <Route path="/comision-ventas" element={<ComisionVentasPage />} />
              <Route path="/planeacion-ventas" element={<PlaneacionVentasLayout />}>
                <Route index element={<ListaMensualPlaneacion />} />
                <Route path=":id" element={<DetallePlanPlaneacion />} />
              </Route>
            </Route>
            <Route path="/profile" element={<Profile />} />
            <Route element={<AdminRoute />}>
              <Route path="/settings" element={<Settings />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
