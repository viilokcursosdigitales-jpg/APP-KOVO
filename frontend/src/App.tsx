import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminRoute } from './auth/AdminRoute';
import { PrivateRoute } from './auth/PrivateRoute';
import { AppShell } from './layout/AppShell';
import CanalesPage from './pages/CanalesPage';
import DashboardHome from './pages/DashboardHome';
import ForgotPassword from './pages/ForgotPassword';
import Home from './pages/Home';
import InventarioPage from './pages/InventarioPage';
import Login from './pages/Login';
import MarketingIndicatorsPage from './pages/MarketingIndicatorsPage';
import MetaAdsPage from './pages/MetaAdsPage';
import MoticoPage from './pages/MoticoPage';
import PedidosPage from './pages/PedidosPage';
import Profile from './pages/Profile';
import Register from './pages/Register';
import ResetPassword from './pages/ResetPassword';
import Settings from './pages/Settings';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route element={<PrivateRoute />}>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<DashboardHome />} />
          <Route path="/pedidos" element={<PedidosPage />} />
          <Route path="/motico" element={<MoticoPage />} />
          <Route path="/inventario" element={<InventarioPage />} />
          <Route path="/meta-ads" element={<MetaAdsPage />} />
          <Route path="/indicadores-marketing" element={<MarketingIndicatorsPage />} />
          <Route path="/canales" element={<CanalesPage />} />
          <Route path="/profile" element={<Profile />} />
          <Route element={<AdminRoute />}>
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
