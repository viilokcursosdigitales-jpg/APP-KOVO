import { useCallback, useState } from 'react';
import type { CalculatorInputsState, CalculoVersion, CurrencyCode, Pack, ProductoListItem } from '../types';
import {
  deleteCalculadoraCalculo,
  fetchCalculadoraHistorico,
  fetchCalculadoraProductos,
  fetchCalculadoraUltimo,
  postCalculadoraCalculo,
} from '../api';
import { normalizeName } from '../utils/formatters';

type SavedInputsV1 = {
  v?: number;
  productDisplayName?: string;
  costoUnitario?: number;
  packs?: CalculatorInputsState['packs'];
  /** Schema nuevo */
  fleteIda?: number;
  cobraFleteDevolucion?: boolean;
  fleteDevolucion?: number;
  canceladosPct?: number;
  devueltosPct?: number;
  /** Schema viejo (migración) */
  fleteEntrega?: number;
  efectividadPct?: number;
  adminPct?: number;
  metaUtilidadPct?: number;
  currency?: CurrencyCode;
  mixPct?: [number, number, number];
};

function migrateInputs(raw: Record<string, unknown>): Record<string, unknown> {
  if ('fleteIda' in raw) return { ...raw };
  return {
    ...raw,
    fleteIda: raw.fleteEntrega ?? 0,
    cobraFleteDevolucion: (raw.fleteDevolucion ?? 0) > 0,
    fleteDevolucion: raw.fleteDevolucion ?? 0,
    canceladosPct: 0,
    devueltosPct: raw.efectividadPct != null ? Math.max(0, 100 - Number(raw.efectividadPct)) : 20,
  };
}

function coercePack(p: unknown, idx: 0 | 1 | 2): Pack {
  const o = p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  const id = ([1, 2, 3] as const)[idx];
  return {
    id,
    label: typeof o.label === 'string' ? o.label : `Pack ${id}u`,
    units: Number.isFinite(Number(o.units)) ? Number(o.units) : id,
    precioVenta: Number.isFinite(Number(o.precioVenta)) ? Number(o.precioVenta) : 0,
  };
}

function parseInputsJson(raw: unknown): CalculatorInputsState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = migrateInputs(raw as Record<string, unknown>) as SavedInputsV1;
  if (!Array.isArray(o.packs) || o.packs.length !== 3) return null;
  const packs = [coercePack(o.packs[0], 0), coercePack(o.packs[1], 1), coercePack(o.packs[2], 2)] as [
    Pack,
    Pack,
    Pack,
  ];
  const cur = o.currency === 'USD' || o.currency === 'MXN' || o.currency === 'COP' ? o.currency : 'COP';
  const mix =
    Array.isArray(o.mixPct) && o.mixPct.length === 3
      ? ([Number(o.mixPct[0]), Number(o.mixPct[1]), Number(o.mixPct[2])] as [number, number, number])
      : ([34, 33, 33] as [number, number, number]);

  return {
    productDisplayName: typeof o.productDisplayName === 'string' ? o.productDisplayName : '',
    costoUnitario: Number.isFinite(Number(o.costoUnitario)) ? Number(o.costoUnitario) : 0,
    packs,
    fleteIda: Number.isFinite(Number(o.fleteIda)) ? Number(o.fleteIda) : 0,
    cobraFleteDevolucion: Boolean(o.cobraFleteDevolucion),
    fleteDevolucion: Number.isFinite(Number(o.fleteDevolucion)) ? Number(o.fleteDevolucion) : 0,
    canceladosPct: Number.isFinite(Number(o.canceladosPct)) ? Number(o.canceladosPct) : 20,
    devueltosPct: Number.isFinite(Number(o.devueltosPct)) ? Number(o.devueltosPct) : 20,
    adminPct: Number.isFinite(Number(o.adminPct)) ? Number(o.adminPct) : 0,
    metaUtilidadPct: Number.isFinite(Number(o.metaUtilidadPct)) ? Number(o.metaUtilidadPct) : 0,
    currency: cur,
    mixPct: mix,
  };
}

export function useCalculosGuardados() {
  const [productos, setProductos] = useState<ProductoListItem[]>([]);
  const [historico, setHistorico] = useState<CalculoVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const refreshProductos = useCallback(async () => {
    setError(null);
    try {
      const list = await fetchCalculadoraProductos();
      setProductos(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar productos');
    }
  }, []);

  const loadHistorico = useCallback(async (nombreNormalizado: string) => {
    setError(null);
    if (!nombreNormalizado) {
      setHistorico([]);
      return [];
    }
    setLoading(true);
    try {
      const h = await fetchCalculadoraHistorico(nombreNormalizado);
      setHistorico(h);
      return h;
    } catch (e) {
      setHistorico([]);
      setError(e instanceof Error ? e.message : 'Error al cargar histórico');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUltimo = useCallback(async (nombreNormalizado: string) => {
    setError(null);
    if (!nombreNormalizado) return null;
    setLoading(true);
    try {
      return await fetchCalculadoraUltimo(nombreNormalizado);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar último');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const applyCalculoToInputs = useCallback((c: CalculoVersion): CalculatorInputsState | null => {
    const parsed = parseInputsJson(c.inputs_json);
    if (!parsed) return null;
    if (c.currency === 'USD' || c.currency === 'MXN' || c.currency === 'COP') {
      parsed.currency = c.currency;
    }
    return parsed;
  }, []);

  const saveCalculo = useCallback(
    async (opts: {
      productNameForKey: string;
      inputs: CalculatorInputsState;
      kpisPayload: Record<string, unknown>;
    }) => {
      setError(null);
      const key = normalizeName(opts.productNameForKey);
      if (!key) {
        setError('Indica un nombre de producto para guardar');
        return null;
      }
      setLoading(true);
      try {
        const row = await postCalculadoraCalculo({
          product_name: key,
          inputs_json: { v: 1, ...opts.inputs } as unknown as Record<string, unknown>,
          kpis_json: { v: 1, ...opts.kpisPayload },
          currency: opts.inputs.currency,
        });
        setLastSavedAt(row.created_at || new Date().toISOString());
        await refreshProductos();
        await loadHistorico(key);
        return row;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al guardar');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [loadHistorico, refreshProductos],
  );

  const removeCalculo = useCallback(
    async (id: number, nombreNormalizado: string) => {
      setError(null);
      setLoading(true);
      try {
        await deleteCalculadoraCalculo(id);
        await refreshProductos();
        await loadHistorico(nombreNormalizado);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al eliminar');
      } finally {
        setLoading(false);
      }
    },
    [loadHistorico, refreshProductos],
  );

  return {
    productos,
    historico,
    loading,
    error,
    lastSavedAt,
    setError,
    refreshProductos,
    loadHistorico,
    loadUltimo,
    applyCalculoToInputs,
    saveCalculo,
    removeCalculo,
  };
}
