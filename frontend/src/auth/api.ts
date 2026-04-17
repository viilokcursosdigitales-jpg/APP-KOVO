const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const API_GET_CACHE_TTL_MS = 45_000;
type CachedFetchPayload = {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body: string;
};
const apiGetCache = new Map<string, { expiresAt: number; payload: CachedFetchPayload }>();
const apiGetInFlight = new Map<string, Promise<CachedFetchPayload>>();

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

function apiCacheCleanup() {
  const now = Date.now();
  for (const [key, entry] of apiGetCache) {
    if (!entry || entry.expiresAt <= now) apiGetCache.delete(key);
  }
}

function responseFromPayload(payload: CachedFetchPayload): Response {
  return new Response(payload.body, {
    status: payload.status,
    statusText: payload.statusText,
    headers: new Headers(payload.headers),
  });
}

function requestMethod(init: RequestInit): string {
  return String(init.method || 'GET').trim().toUpperCase() || 'GET';
}

function isGetCacheableRequest(method: string, init: RequestInit): boolean {
  return method === 'GET' && init.body === undefined;
}

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
  const method = requestMethod(init);
  const url = apiUrl(path);
  const canCache = isGetCacheableRequest(method, init);
  if (!canCache) {
    const res = await fetch(url, { ...init, method, headers });
    if (res.status === 401 && getStoredToken()) {
      clearAuthStorage();
      window.dispatchEvent(new Event('kovo-auth-expired'));
    }
    if (method !== 'GET') {
      apiGetCache.clear();
      apiGetInFlight.clear();
    }
    return res;
  }

  apiCacheCleanup();
  const cacheKey = `${token || 'anon'}|${url}`;
  const cached = apiGetCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return responseFromPayload(cached.payload);
  }

  let inFlight = apiGetInFlight.get(cacheKey);
  if (!inFlight) {
    inFlight = (async () => {
      const res = await fetch(url, { ...init, method, headers });
      const body = await res.text();
      const payload: CachedFetchPayload = {
        status: res.status,
        statusText: res.statusText,
        headers: [...res.headers.entries()],
        body,
      };
      if (res.status === 401 && getStoredToken()) {
        clearAuthStorage();
        window.dispatchEvent(new Event('kovo-auth-expired'));
      } else if (res.ok) {
        apiGetCache.set(cacheKey, { payload, expiresAt: Date.now() + API_GET_CACHE_TTL_MS });
      }
      return payload;
    })()
      .finally(() => {
        apiGetInFlight.delete(cacheKey);
      });
    apiGetInFlight.set(cacheKey, inFlight);
  }

  const payload = await inFlight;
  return responseFromPayload(payload);
}
