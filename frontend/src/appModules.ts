/** Ids alineados con el backend (CONFIGURABLE_MODULE_IDS). */
export const APP_MODULE_IDS = [
  'dashboard',
  'pedidos',
  'motico',
  'inventario',
  'meta_ads',
  'ads_funnel',
  'indicadores_marketing',
  'canales',
  'ganancia_diaria',
] as const;

export type AppModuleId = (typeof APP_MODULE_IDS)[number];

export const APP_MODULE_CATALOG: { id: AppModuleId; label: string; group: string }[] = [
  { id: 'dashboard', label: 'Dashboard', group: 'Principal' },
  { id: 'pedidos', label: 'Pedidos', group: 'Principal' },
  { id: 'motico', label: 'Motico', group: 'Principal' },
  { id: 'inventario', label: 'Inventario', group: 'Principal' },
  { id: 'meta_ads', label: 'Meta Ads', group: 'Marketing' },
  { id: 'ads_funnel', label: 'Ads Funnel', group: 'Marketing' },
  { id: 'indicadores_marketing', label: 'Indicadores', group: 'Marketing' },
  { id: 'canales', label: 'Canales', group: 'Marketing' },
  { id: 'ganancia_diaria', label: 'Ganancia Diaria', group: 'Marketing' },
];

const PATH_TO_MODULE: Record<string, AppModuleId> = {
  '/dashboard': 'dashboard',
  '/pedidos': 'pedidos',
  '/motico': 'motico',
  '/inventario': 'inventario',
  '/meta-ads': 'meta_ads',
  '/ads-funnel': 'ads_funnel',
  '/indicadores-marketing': 'indicadores_marketing',
  '/canales': 'canales',
  '/ganancia-diaria': 'ganancia_diaria',
};

const MODULE_TO_PATH: Record<AppModuleId, string> = {
  dashboard: '/dashboard',
  pedidos: '/pedidos',
  motico: '/motico',
  inventario: '/inventario',
  meta_ads: '/meta-ads',
  ads_funnel: '/ads-funnel',
  indicadores_marketing: '/indicadores-marketing',
  canales: '/canales',
  ganancia_diaria: '/ganancia-diaria',
};

/** Orden para “primera pantalla” tras login o al bloquear una ruta. */
export const APP_MODULE_PATH_ORDER = APP_MODULE_IDS.map((id) => MODULE_TO_PATH[id]);

export function pathToModuleId(pathname: string): AppModuleId | null {
  const p = pathname.replace(/\/$/, '') || '/';
  return PATH_TO_MODULE[p] ?? null;
}

export function firstAllowedPath(moduleAccess: string[] | null): string {
  if (moduleAccess === null) return '/dashboard';
  for (const path of APP_MODULE_PATH_ORDER) {
    const id = pathToModuleId(path);
    if (id && moduleAccess.includes(id)) return path;
  }
  return '/profile';
}

export function canAccessPath(moduleAccess: string[] | null, pathname: string): boolean {
  const id = pathToModuleId(pathname);
  if (!id) return true;
  if (moduleAccess === null) return true;
  return moduleAccess.includes(id);
}

export function postLoginPath(
  moduleAccess: string[] | null,
  fromPath: string | undefined,
): string {
  if (fromPath && fromPath.startsWith('/') && fromPath !== '/login') {
    if (canAccessPath(moduleAccess, fromPath)) return fromPath;
  }
  return firstAllowedPath(moduleAccess);
}
