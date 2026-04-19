import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiFetch, getStoredToken } from '../auth/api';
import { ds } from '../design-system/ds';
import {
  IconCalculadora,
  IconCart,
  IconFunnel,
  IconLayout,
  IconMegaphone,
  IconPackage,
  IconProduct,
  IconSettings,
  IconShare,
  IconTarget,
  IconTruck,
  IconTrendingUp,
  IconUser,
} from '../design-system/icons';

type NavItem = { to: string; label: string; icon: React.ReactNode; moduleId: string | null };

function NavGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div
        style={{
          padding: '0 14px 8px',
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '1px',
          color: ds.textHint,
          fontWeight: 500,
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</div>
    </div>
  );
}

function SidebarNav({ mobile }: { mobile: boolean }) {
  const { canManageOrg, canAccessModule } = useAuth();

  const main: NavItem[] = [
    { to: '/inicio', label: 'Inicio', icon: <IconLayout />, moduleId: 'dashboard' },
    { to: '/analisis-producto', label: 'Análisis de productos', icon: <IconProduct />, moduleId: 'analisis_producto' },
    { to: '/pedidos', label: 'Pedidos', icon: <IconCart />, moduleId: 'pedidos' },
    {
      to: '/relacion-pagos-motico',
      label: 'Relación Pagos Motico',
      icon: <IconTruck />,
      moduleId: 'relacion_pagos_motico',
    },
    { to: '/inventario', label: 'Inventario', icon: <IconPackage />, moduleId: 'inventario' },
  ];
  const marketing: NavItem[] = [
    { to: '/meta-ads', label: 'Anuncios Meta', icon: <IconMegaphone />, moduleId: 'meta_ads' },
    { to: '/calculadora-cod', label: 'Calculadora COD', icon: <IconCalculadora />, moduleId: 'calculadora_cod' },
    { to: '/ads-funnel', label: 'Embudo de anuncios', icon: <IconFunnel />, moduleId: 'ads_funnel' },
    { to: '/finanza', label: 'Finanzas', icon: <IconTrendingUp />, moduleId: 'finanza' },
    {
      to: '/indicadores-marketing',
      label: 'Indicadores',
      icon: <IconTarget />,
      moduleId: 'indicadores_marketing',
    },
    { to: '/canales', label: 'Canales', icon: <IconShare />, moduleId: 'canales' },
    {
      to: '/ganancia-diaria',
      label: 'Ganancia diaria',
      icon: <IconTrendingUp />,
      moduleId: 'ganancia_diaria',
    },
    {
      to: '/planeacion-ventas',
      label: 'Planeación de Ventas',
      icon: <IconTarget />,
      moduleId: 'planeacion_ventas',
    },
    {
      to: '/comision-ventas',
      label: 'Comisión por venta',
      icon: <IconTrendingUp />,
      moduleId: 'comision_ventas',
    },
  ];
  const account: NavItem[] = [];
  if (canManageOrg) {
    account.push({
      to: '/settings',
      label: 'Configuración',
      icon: <IconSettings />,
      moduleId: null,
    });
  }
  account.push({ to: '/profile', label: 'Cuenta', icon: <IconUser />, moduleId: null });

  const mainVisible = main.filter((it) => it.moduleId === null || canAccessModule(it.moduleId));
  const marketingVisible = marketing.filter((it) => it.moduleId === null || canAccessModule(it.moduleId));

  const linkStyle = (isActive: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    margin: '0 10px',
    padding: '8px 10px',
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
    fontSize: 13,
    textDecoration: 'none',
    fontWeight: isActive ? 600 : 500,
    background: isActive ? ds.brandBg : 'transparent',
    color: isActive ? ds.brand : ds.textMuted,
  });

  const renderItem = (item: NavItem) => (
    <NavLink
      key={item.to}
      to={item.to}
      className="kovo-sidebar-link"
      end={item.to === '/inicio'}
      style={({ isActive }) => linkStyle(isActive)}
    >
      <span style={{ color: 'inherit', display: 'flex' }}>{item.icon}</span>
      {item.label}
    </NavLink>
  );

  if (mobile) {
    const mktMobile = [marketingVisible[0], marketingVisible[1]].filter(Boolean) as NavItem[];
    const mobileNav: NavItem[] = [
      mainVisible[0],
      mainVisible[1],
      mainVisible[2],
      ...mktMobile,
      account[account.length - 1],
    ].filter((it): it is NavItem => Boolean(it));
    return (
      <nav
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          background: ds.bgCard,
          borderTop: `1px solid ${ds.borderSide}`,
          display: 'flex',
          justifyContent: 'space-around',
          padding: '8px 4px calc(8px + env(safe-area-inset-bottom))',
        }}
      >
        {mobileNav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/inicio'}
            style={({ isActive }) => ({
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              fontSize: 10,
              fontWeight: isActive ? 600 : 500,
              color: isActive ? ds.brand : ds.textMuted,
              textDecoration: 'none',
              padding: '4px 8px',
            })}
          >
            <span style={{ display: 'flex' }}>{item.icon}</span>
            <span style={{ maxWidth: 56, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.label}
            </span>
          </NavLink>
        ))}
      </nav>
    );
  }

  return (
    <aside
      style={{
        width: 'var(--sidebar-width)',
        flexShrink: 0,
        background: ds.bgCard,
        borderRight: `1px solid ${ds.borderSide}`,
        padding: '20px 0 32px',
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
      }}
    >
      <NavLink
        to="/inicio"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 16px 24px',
          textDecoration: 'none',
        }}
      >
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            background: ds.brand,
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 14, fontWeight: 600, color: ds.textPrimary }}>KOVO</span>
      </NavLink>

      {mainVisible.length > 0 ? <NavGroup label="Principal">{mainVisible.map(renderItem)}</NavGroup> : null}
      {marketingVisible.length > 0 ? (
        <NavGroup label="Marketing">{marketingVisible.map(renderItem)}</NavGroup>
      ) : null}
      <NavGroup label="Cuenta">{account.map(renderItem)}</NavGroup>
    </aside>
  );
}

export function AppShell() {
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const fn = () => setMobile(mq.matches);
    fn();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  useEffect(() => {
    if (!getStoredToken()) return;
    // Priorizar dato crítico para Inicio (utilidad / KPIs) desde el arranque.
    void apiFetch('/api/ganancia-diaria/series?meta_period=3d').catch(() => {
      /* warmup best-effort */
    });
    const runWarmup = () => {
      const warmupPaths = [
        '/api/meta/ctr-compare?period=ayer',
        '/api/meta/insights?period=ayer&level=campaigns',
        '/api/meta/selected-ad-accounts',
      ];
      for (const path of warmupPaths) {
        void apiFetch(path).catch(() => {
          /* prefetch best-effort */
        });
      }
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(runWarmup, { timeout: 1800 });
      return () => window.cancelIdleCallback(id);
    }
    const t = window.setTimeout(runWarmup, 900);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="kovo-app" style={{ display: 'flex', minHeight: '100vh', width: '100%' }}>
      {!mobile ? <SidebarNav mobile={false} /> : null}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          paddingBottom: mobile ? 72 : 0,
        }}
      >
        <main
          style={{
            flex: 1,
            background: ds.bgApp,
            padding: mobile ? '24px 16px 24px' : 'var(--main-padding-y) var(--main-padding-x)',
            overflow: 'auto',
          }}
        >
          <Outlet />
        </main>
      </div>
      {mobile ? <SidebarNav mobile /> : null}
    </div>
  );
}
