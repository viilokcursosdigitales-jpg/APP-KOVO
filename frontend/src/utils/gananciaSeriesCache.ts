export const GANANCIA_SERIES_CACHE_KEY = 'kovo_ganancia_series_cache_v1';
export const GANANCIA_SERIES_STALE_KEY = 'kovo_ganancia_series_stale_v1';
export const GANANCIA_SERIES_CACHE_TTL_MS = 1000 * 60 * 10;

/** Marca el informe de ganancia diaria como desactualizado (p. ej. tras editar un pedido). */
export function markGananciaSeriesStale(): void {
  try {
    localStorage.removeItem(GANANCIA_SERIES_CACHE_KEY);
    localStorage.setItem(GANANCIA_SERIES_STALE_KEY, String(Date.now()));
  } catch {
    /* noop */
  }
}

export function isGananciaSeriesStale(): boolean {
  try {
    return Boolean(localStorage.getItem(GANANCIA_SERIES_STALE_KEY));
  } catch {
    return false;
  }
}

/** Lee y limpia la marca de desactualizado. */
export function consumeGananciaSeriesStale(): boolean {
  try {
    const v = localStorage.getItem(GANANCIA_SERIES_STALE_KEY);
    if (!v) return false;
    localStorage.removeItem(GANANCIA_SERIES_STALE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function clearGananciaSeriesCache(): void {
  try {
    localStorage.removeItem(GANANCIA_SERIES_CACHE_KEY);
  } catch {
    /* noop */
  }
}
