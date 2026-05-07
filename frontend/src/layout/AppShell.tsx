import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiFetch, getStoredToken } from '../auth/api';
import SubscriptionBanner, { type SubscriptionStatusPayload } from '../components/SubscriptionBanner';
import { ds } from '../design-system/ds';
import {
  IconCalculadora,
  IconCart,
  IconChevronDown,
  IconLayout,
  IconMegaphone,
  IconPackage,
  IconProduct,
  IconShield,
  IconSettings,
  IconShare,
  IconTarget,
  IconTruck,
  IconTrendingUp,
  IconUser,
  IconUsers,
} from '../design-system/icons';

type NavItem = { to: string; label: string; icon: React.ReactNode; moduleId: string | null };
type CollapsibleGroupId = 'marketing' | 'logistica' | 'finanzas' | 'integraciones' | 'configuracion' | 'kovo';
type CollapseState = Record<CollapsibleGroupId, boolean>;
const SIDEBAR_COLLAPSE_KEY = 'kovo_sidebar_collapsed_v1';
const defaultExpandedState: CollapseState = {
  marketing: true,
  logistica: true,
  finanzas: true,
  integraciones: true,
  configuracion: true,
  kovo: true,
};

function readCollapseState(): CollapseState {
  try {
    const raw = localStorage.getItem(SIDEBAR_COLLAPSE_KEY);
    if (!raw) return { ...defaultExpandedState };
    const parsed = JSON.parse(raw) as Partial<CollapseState>;
    return { ...defaultExpandedState, ...parsed };
  } catch {
    return { ...defaultExpandedState };
  }
}

function SidebarNav({ mobile }: { mobile: boolean }) {
  const { canManageOrg, canAccessModule, user } = useAuth();
  const location = useLocation();
  const canViewRegisteredUsers = String(user?.email || '').trim().toLowerCase() === 'cavimo25@gmail.com';
  const canManageHomeContent = canViewRegisteredUsers;
  const [expanded, setExpanded] = useState<CollapseState>(() =>
    typeof localStorage !== 'undefined' ? readCollapseState() : { ...defaultExpandedState },
  );

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSE_KEY, JSON.stringify(expanded));
    } catch {
      /* ignore */
    }
  }, [expanded]);

  const group1: NavItem[] = [
    { to: '/inicio', label: 'Inicio', icon: <IconLayout />, moduleId: 'dashboard' },
    { to: '/pedidos', label: 'Pedidos', icon: <IconCart />, moduleId: 'pedidos' },
    { to: '/inventario', label: 'Inventario', icon: <IconPackage />, moduleId: 'inventario' },
  ];

  const marketing: NavItem[] = [
    { to: '/meta-ads', label: 'Análisis de creativos', icon: <IconMegaphone />, moduleId: 'meta_ads' },
    { to: '/analisis-producto', label: 'Análisis de productos', icon: <IconProduct />, moduleId: 'analisis_producto' },
  ];
  const logistica: NavItem[] = [{ to: '/reporte-dropi', label: 'Reporte Dropi', icon: <IconTruck />, moduleId: null }];
  const finanzas: NavItem[] = [
    { to: '/ganancia-diaria', label: 'Ganancia diaria', icon: <IconTrendingUp />, moduleId: 'ganancia_diaria' },
    { to: '/calculadora-cod', label: 'Calculadora COD', icon: <IconCalculadora />, moduleId: 'calculadora_cod' },
    { to: '/estado-resultado-dropi', label: 'Estado de resultado Dropi', icon: <IconTarget />, moduleId: null },
  ];
  const integraciones: NavItem[] = [
    { to: '/canales?tab=shopify', label: 'Conexión Shopify', icon: <IconShare />, moduleId: 'canales' },
  ];
  const configuracion: NavItem[] = [
    { to: '/profile', label: 'Cuenta', icon: <IconUser />, moduleId: null },
    { to: '/settings', label: 'Configuración', icon: <IconSettings />, moduleId: canManageOrg ? null : null },
  ];
  const kovoItems: NavItem[] = [
    { to: '/admin/users', label: 'Usuarios registrados', icon: <IconUsers />, moduleId: null },
    { to: '/admin/dashboard-content', label: 'Contenido inicio', icon: <IconLayout />, moduleId: null },
  ];

  const visibleByAccess = (items: NavItem[]) => items.filter((it) => it.moduleId === null || canAccessModule(it.moduleId));
  const group1Visible = visibleByAccess(group1);
  const marketingVisible = visibleByAccess(marketing);
  const finanzasVisible = visibleByAccess(finanzas);
  const integracionesVisible = visibleByAccess(integraciones);
  const configuracionVisible = visibleByAccess(configuracion);

  if (!canManageOrg) {
    const idx = configuracionVisible.findIndex((x) => x.to === '/settings');
    if (idx >= 0) configuracionVisible.splice(idx, 1);
  }

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

  const divider = (
    <hr
      style={{
        border: 'none',
        borderTop: `0.5px solid ${ds.borderSide}`,
        margin: '12px 12px 10px',
        opacity: 0.75,
      }}
    />
  );

  const toggleGroup = (id: CollapsibleGroupId) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const renderItem = (item: NavItem) => {
    const [targetPath, targetSearch = ''] = item.to.split('?');
    const currentSearch = String(location.search || '').replace(/^\?/, '');
    const isPathActive = location.pathname === targetPath;
    const isActive = targetSearch ? isPathActive && currentSearch === targetSearch : isPathActive;
    return (
      <NavLink
        key={item.to}
        to={item.to}
        className="kovo-sidebar-link"
        end
        style={linkStyle(isActive)}
      >
        <span style={{ color: 'inherit', display: 'flex' }}>{item.icon}</span>
        {item.label}
      </NavLink>
    );
  };

  const renderCollapsibleGroup = (
    id: CollapsibleGroupId,
    label: string,
    icon: React.ReactNode,
    items: NavItem[],
    opts?: { adminBadge?: boolean },
  ) => {
    if (!items.length) return null;
    return (
      <div key={id} style={{ marginTop: 2 }}>
        <button
          type="button"
          onClick={() => toggleGroup(id)}
          style={{
            width: 'calc(100% - 20px)',
            margin: '0 10px',
            border: 'none',
            borderRadius: 8,
            background: 'transparent',
            color: ds.textSecondary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '9px 10px',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'inline-flex' }}>{icon}</span>
            {label}
            {opts?.adminBadge ? (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: ds.brand,
                  background: ds.brandBg,
                  borderRadius: 999,
                  padding: '2px 7px',
                  letterSpacing: 0.2,
                  textTransform: 'lowercase',
                }}
              >
                admin
              </span>
            ) : null}
          </span>
          <span
            style={{
              display: 'inline-flex',
              transform: expanded[id] ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 160ms ease',
            }}
          >
            <IconChevronDown size={14} />
          </span>
        </button>
        <div
          style={{
            display: 'grid',
            gridTemplateRows: expanded[id] ? '1fr' : '0fr',
            opacity: expanded[id] ? 1 : 0,
            transform: expanded[id] ? 'translateY(0)' : 'translateY(-4px)',
            transition: 'grid-template-rows 180ms ease, opacity 160ms ease, transform 180ms ease',
          }}
        >
          <div style={{ overflow: 'hidden' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{items.map(renderItem)}</div>
          </div>
        </div>
      </div>
    );
  };

  if (mobile) {
    const mobileNav: NavItem[] = [
      group1Visible[0],
      group1Visible[1],
      marketingVisible[0],
      finanzasVisible[0],
      { to: '/profile', label: 'Cuenta', icon: <IconUser />, moduleId: null },
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {group1Visible.map(renderItem)}
        {divider}
        {renderCollapsibleGroup('marketing', 'Marketing', <IconMegaphone />, marketingVisible)}
        {divider}
        {renderCollapsibleGroup('logistica', 'Logística', <IconTruck />, logistica)}
        {divider}
        {renderCollapsibleGroup('finanzas', 'Finanzas', <IconTrendingUp />, finanzasVisible)}
        {divider}
        {renderCollapsibleGroup('integraciones', 'Integraciones', <IconShare />, integracionesVisible)}
        {divider}
        {renderCollapsibleGroup('configuracion', 'Configuración', <IconSettings />, configuracionVisible)}
        {canManageHomeContent ? (
          <>
            {divider}
            {renderCollapsibleGroup('kovo', 'KOVO', <IconShield />, kovoItems, { adminBadge: true })}
          </>
        ) : null}
      </div>
    </aside>
  );
}

export function AppShell() {
  const [mobile, setMobile] = useState(false);
  const [subscription, setSubscription] = useState<SubscriptionStatusPayload | null>(null);
  const location = useLocation();
  const { user } = useAuth();
  const isBypassUser = String(user?.email || '').trim().toLowerCase() === 'cavimo25@gmail.com';

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

  useEffect(() => {
    if (!getStoredToken()) return;
    let cancelled = false;
    const refreshSubscription = async () => {
      try {
        const nonce = Date.now();
        const res = await apiFetch(`/api/subscription/status?path=${encodeURIComponent(location.pathname)}&t=${nonce}`);
        if (!res.ok) return;
        const data = (await res.json()) as SubscriptionStatusPayload;
        if (!cancelled) setSubscription(data);
      } catch {
        /* ignore subscription transient errors */
      }
    };
    void refreshSubscription();
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  const isExpired =
    !isBypassUser && subscription != null && (!subscription.canAccess || subscription.status === 'expired');

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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: '100%' }}>
            <SubscriptionBanner subscription={subscription} userEmail={user?.email} />
            {isExpired ? (
              <div
                style={{
                  flex: 1,
                  border: `1px solid ${ds.borderCard}`,
                  borderRadius: 12,
                  background: ds.bgCard,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 20,
                  color: ds.textSecondary,
                  fontSize: 14,
                  textAlign: 'center',
                }}
              >
                Tu acceso esta bloqueado hasta activar tu plan Pro.
              </div>
            ) : (
              <Outlet />
            )}
          </div>
        </main>
      </div>
      {mobile ? <SidebarNav mobile /> : null}
    </div>
  );
}
