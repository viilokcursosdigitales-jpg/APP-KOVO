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
  ORG_STORAGE_KEY,
  ROLE_STORAGE_KEY,
  TOKEN_KEY,
} from './api';

export type OrgPlan = 'free' | 'pro' | 'enterprise';
export type OrgRole = 'owner' | 'admin' | 'member';

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
  limits: PlanLimits;
};

type AuthContextValue = {
  user: AuthUser | null;
  organization: Organization | null;
  role: OrgRole | null;
  limits: PlanLimits | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  canManageOrg: boolean;
  login: (token: string, session: SessionPayload) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
  setSessionFromPayload: (session: SessionPayload) => void;
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

function readStoredRole(): OrgRole | null {
  const r = localStorage.getItem(ROLE_STORAGE_KEY);
  if (r === 'owner' || r === 'admin' || r === 'member') return r;
  return null;
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

function persistSession(session: SessionPayload | null) {
  if (!session) {
    localStorage.removeItem('kovo_user_id');
    localStorage.removeItem(ORG_STORAGE_KEY);
    localStorage.removeItem(ROLE_STORAGE_KEY);
    localStorage.removeItem(LIMITS_STORAGE_KEY);
    return;
  }
  localStorage.setItem('kovo_user_id', String(session.user.id));
  localStorage.setItem(ORG_STORAGE_KEY, JSON.stringify(session.organization));
  localStorage.setItem(ROLE_STORAGE_KEY, session.role);
  localStorage.setItem(LIMITS_STORAGE_KEY, JSON.stringify(session.limits));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [user, setUser] = useState<AuthUser | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(() =>
    typeof localStorage !== 'undefined' ? readStoredOrg() : null,
  );
  const [role, setRole] = useState<OrgRole | null>(() =>
    typeof localStorage !== 'undefined' ? readStoredRole() : null,
  );
  const [limits, setLimits] = useState<PlanLimits | null>(() =>
    typeof localStorage !== 'undefined' ? readStoredLimits() : null,
  );
  const [isLoading, setIsLoading] = useState(true);

  const setSessionFromPayload = useCallback((session: SessionPayload) => {
    setUser(session.user);
    setOrganization(session.organization);
    setRole(session.role);
    setLimits(session.limits);
    persistSession(session);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    persistSession(null);
    setToken(null);
    setUser(null);
    setOrganization(null);
    setRole(null);
    setLimits(null);
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
          setLimits(null);
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

  const canManageOrg = role === 'owner' || role === 'admin';

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      organization,
      role,
      limits,
      token,
      isLoading,
      isAuthenticated: Boolean(user && token && organization),
      canManageOrg,
      login,
      logout,
      refreshUser,
      setSessionFromPayload,
    }),
    [
      user,
      organization,
      role,
      limits,
      token,
      isLoading,
      canManageOrg,
      login,
      logout,
      refreshUser,
      setSessionFromPayload,
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
