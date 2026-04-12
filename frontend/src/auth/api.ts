const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/** URL absoluta o relativa al origen del front (same-origin si BASE está vacío). */
export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${BASE}${p}`;
}

export const TOKEN_KEY = 'kovo_token';
export const ORG_STORAGE_KEY = 'kovo_organization';
export const ROLE_STORAGE_KEY = 'kovo_role';
export const LIMITS_STORAGE_KEY = 'kovo_limits';
export const MODULE_ACCESS_STORAGE_KEY = 'kovo_module_access';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function clearAuthStorage() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem('kovo_user_id');
  localStorage.removeItem(ORG_STORAGE_KEY);
  localStorage.removeItem(ROLE_STORAGE_KEY);
  localStorage.removeItem(LIMITS_STORAGE_KEY);
  localStorage.removeItem(MODULE_ACCESS_STORAGE_KEY);
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getStoredToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const res = await fetch(apiUrl(path), { ...init, headers });
  if (res.status === 401 && getStoredToken()) {
    clearAuthStorage();
    window.dispatchEvent(new Event('kovo-auth-expired'));
  }
  return res;
}
