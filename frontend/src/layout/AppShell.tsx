import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiFetch, getStoredToken } from '../auth/api';
import { ds } from '../design-system/ds';
import {
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
    { to: '/analisis-producto', label: 'Analisis de productos', icon: <IconProduct />, moduleId: 'analisis_producto' },
    { to: '/pedidos', label: 'Pedidos', icon: <IconCart />, moduleId: 'pedidos' },
    { to: '/motico', label: 'Motico', icon: <IconTruck />, moduleId: 'motico' },
    { to: '/inventario', label: 'Inventario', icon: <IconPackage />, moduleId: 'inventario' },
  ];
  const marketing: NavItem[] = [
    { to: '/meta-ads', label: 'Meta Ads', icon: <IconMegaphone />, moduleId: 'meta_ads' },
    { to: '/ads-funnel', label: 'Ads Funnel', icon: <IconFunnel />, moduleId: 'ads_funnel' },
    { to: '/finanza', label: 'Finanza', icon: <IconTrendingUp />, moduleId: 'finanza' },
    {
      to: '/indicadores-marketing',
      label: 'Indicadores',
      icon: <IconTarget />,
      moduleId: 'indicadores_marketing',
    },
    { to: '/canales', label: 'Canales', icon: <IconShare />, moduleId: 'canales' },
    {
      to: '/ganancia-diaria',
      label: 'Ganancia Diaria',
      icon: <IconTrendingUp />,
      moduleId: 'ganancia_diaria',
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
    const mobileNav: NavItem[] = [
      mainVisible[0],
      mainVisible[1],
      mainVisible[3],
      marketingVisible[0],
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
    const warmupPaths = [
      '/api/meta/insights?period=hoy&level=campaigns',
      '/api/meta/ads-funnel-panel?period=7d',
      '/api/product-analytics/meta-spend?period=30d',
      '/api/ganancia-diaria/series?meta_period=3d',
    ];
    for (const path of warmupPaths) {
      void apiFetch(path).catch(() => {
        /* prefetch best-effort */
      });
    }
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
