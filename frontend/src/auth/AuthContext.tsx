import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  apiFetch,
  getStoredToken,
  LIMITS_STORAGE_KEY,
  MODULE_ACCESS_STORAGE_KEY,
  ORG_STORAGE_KEY,
  ROLE_STORAGE_KEY,
  TOKEN_KEY,
} from './api';

export type OrgPlan = 'free' | 'pro' | 'enterprise';
/** Rol interno guardado en servidor (owner, admin, member o slug de rol personalizado). */
export type OrgRole = string;
export type RoleTier = 'owner' | 'admin' | 'member';

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  created_at: string;
};

export type Organization = {
  id: number;
  name: string;
  slug: string;
  plan: OrgPlan;
};

export type PlanLimits = {
  users: { used: number; max: number | null };
  meta: { used: number; max: number | null };
};

export type SessionPayload = {
  user: AuthUser;
  organization: Organization;
  role: OrgRole;
  role_tier: RoleTier;
  limits: PlanLimits;
  /** null = acceso a todos los módulos de la barra lateral. */
  module_access: string[] | null;
};

type AuthContextValue = {
  user: AuthUser | null;
  organization: Organization | null;
  role: OrgRole | null;
  roleTier: RoleTier | null;
  limits: PlanLimits | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  canManageOrg: boolean;
  login: (token: string, session: SessionPayload) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
  setSessionFromPayload: (session: SessionPayload) => void;
  moduleAccess: string[] | null;
  canAccessModule: (moduleId: string) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredOrg(): Organization | null {
  try {
    const raw = localStorage.getItem(ORG_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Organization;
  } catch {
    return null;
  }
}

function readStoredRolePayload(): { role: OrgRole | null; role_tier: RoleTier | null } {
  const r = localStorage.getItem(ROLE_STORAGE_KEY);
  if (!r) return { role: null, role_tier: null };
  try {
    const j = JSON.parse(r) as { role?: string; role_tier?: string };
    if (j && typeof j.role === 'string') {
      const rt =
        j.role_tier === 'owner' || j.role_tier === 'admin' || j.role_tier === 'member'
          ? j.role_tier
          : j.role === 'owner' || j.role === 'admin' || j.role === 'member'
            ? j.role
            : 'member';
      return { role: j.role, role_tier: rt };
    }
  } catch {
    /* formato legado: solo texto */
  }
  if (r === 'owner' || r === 'admin' || r === 'member') {
    return { role: r, role_tier: r };
  }
  return { role: r, role_tier: 'member' };
}

function readStoredLimits(): PlanLimits | null {
  try {
    const raw = localStorage.getItem(LIMITS_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PlanLimits;
  } catch {
    return null;
  }
}

function readStoredModuleAccess(): string[] | null {
  try {
    const raw = localStorage.getItem(MODULE_ACCESS_STORAGE_KEY);
    if (raw == null) return null;
    const j = JSON.parse(raw) as unknown;
    if (j === null) return null;
    if (Array.isArray(j)) return j.filter((x): x is string => typeof x === 'string');
  } catch {
    /* ignore */
  }
  return null;
}

function persistSession(session: SessionPayload | null) {
  if (!session) {
    localStorage.removeItem('kovo_user_id');
    localStorage.removeItem(ORG_STORAGE_KEY);
    localStorage.removeItem(ROLE_STORAGE_KEY);
    localStorage.removeItem(LIMITS_STORAGE_KEY);
    localStorage.removeItem(MODULE_ACCESS_STORAGE_KEY);
    return;
  }
  localStorage.setItem('kovo_user_id', String(session.user.id));
  localStorage.setItem(ORG_STORAGE_KEY, JSON.stringify(session.organization));
  localStorage.setItem(
    ROLE_STORAGE_KEY,
    JSON.stringify({ role: session.role, role_tier: session.role_tier }),
  );
  localStorage.setItem(LIMITS_STORAGE_KEY, JSON.stringify(session.limits));
  localStorage.setItem(MODULE_ACCESS_STORAGE_KEY, JSON.stringify(session.module_access ?? null));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [user, setUser] = useState<AuthUser | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(() =>
    typeof localStorage !== 'undefined' ? readStoredOrg() : null,
  );
  const [role, setRole] = useState<OrgRole | null>(() =>
    typeof localStorage !== 'undefined' ? readStoredRolePayload().role : null,
  );
  const [roleTier, setRoleTier] = useState<RoleTier | null>(() =>
    typeof localStorage !== 'undefined' ? readStoredRolePayload().role_tier : null,
  );
  const [limits, setLimits] = useState<PlanLimits | null>(() =>
    typeof localStorage !== 'undefined' ? readStoredLimits() : null,
  );
  const [moduleAccess, setModuleAccess] = useState<string[] | null>(() =>
    typeof localStorage !== 'undefined' ? readStoredModuleAccess() : null,
  );
  const [isLoading, setIsLoading] = useState(true);

  const setSessionFromPayload = useCallback((session: SessionPayload) => {
    const role_tier: RoleTier =
      session.role_tier === 'owner' || session.role_tier === 'admin' || session.role_tier === 'member'
        ? session.role_tier
        : session.role === 'owner' || session.role === 'admin' || session.role === 'member'
          ? session.role
          : 'member';
    const module_access =
      session.module_access === undefined
        ? null
        : session.module_access === null
          ? null
          : Array.isArray(session.module_access)
            ? session.module_access.filter((x) => typeof x === 'string')
            : null;
    const next: SessionPayload = { ...session, role_tier, module_access };
    setUser(next.user);
    setOrganization(next.organization);
    setRole(next.role);
    setRoleTier(next.role_tier);
    setLimits(next.limits);
    setModuleAccess(next.module_access);
    persistSession(next);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    persistSession(null);
    setToken(null);
    setUser(null);
    setOrganization(null);
    setRole(null);
    setRoleTier(null);
    setLimits(null);
    setModuleAccess(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const t = getStoredToken();
    if (!t) {
      logout();
      return;
    }
    const res = await apiFetch('/api/auth/me');
    if (!res.ok) {
      logout();
      return;
    }
    const data = (await res.json()) as SessionPayload;
    setSessionFromPayload(data);
  }, [logout, setSessionFromPayload]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const t = getStoredToken();
      if (!t) {
        if (!cancelled) {
          setIsLoading(false);
          setToken(null);
          setUser(null);
          setOrganization(null);
          setRole(null);
          setRoleTier(null);
          setLimits(null);
          setModuleAccess(null);
        }
        return;
      }
      setToken(t);
      const res = await apiFetch('/api/auth/me');
      if (cancelled) return;
      if (res.ok) {
        const data = (await res.json()) as SessionPayload;
        setSessionFromPayload(data);
      } else {
        logout();
      }
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [logout, setSessionFromPayload]);

  useEffect(() => {
    const onExpired = () => logout();
    window.addEventListener('kovo-auth-expired', onExpired);
    return () => window.removeEventListener('kovo-auth-expired', onExpired);
  }, [logout]);

  const login = useCallback(
    (newToken: string, session: SessionPayload) => {
      localStorage.setItem(TOKEN_KEY, newToken);
      setToken(newToken);
      setSessionFromPayload(session);
    },
    [setSessionFromPayload],
  );

  const canManageOrg = roleTier === 'owner' || roleTier === 'admin';

  const canAccessModule = useCallback(
    (moduleId: string) => {
      if (moduleAccess === null) return true;
      return moduleAccess.includes(moduleId);
    },
    [moduleAccess],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      organization,
      role,
      roleTier,
      limits,
      token,
      isLoading,
      isAuthenticated: Boolean(user && token && organization),
      canManageOrg,
      login,
      logout,
      refreshUser,
      setSessionFromPayload,
      moduleAccess,
      canAccessModule,
    }),
    [
      user,
      organization,
      role,
      roleTier,
      limits,
      token,
      isLoading,
      canManageOrg,
      login,
      logout,
      refreshUser,
      setSessionFromPayload,
      moduleAccess,
      canAccessModule,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth debe usarse dentro de AuthProvider');
  }
  return ctx;
}
