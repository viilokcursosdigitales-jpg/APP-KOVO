export const THEME_STORAGE_KEY = 'kovo-theme';

export type ThemeMode = 'light' | 'dark';

export function getStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === 'dark' || v === 'light') return v;
  } catch {
    /* noop */
  }
  return 'light';
}

/** Aplica variables CSS (tokens). Modo claro = quitar data-theme del elemento html. */
export function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  if (mode === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

export function setTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* noop */
  }
  applyTheme(mode);
}

export function initThemeFromStorage(): void {
  applyTheme(getStoredTheme());
}
