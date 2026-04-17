import { useCallback, useState } from 'react';
import type { CalculatorInputsState, CalculoVersion, CurrencyCode, ProductoListItem } from '../types';
import {
  deleteCalculadoraCalculo,
  fetchCalculadoraHistorico,
  fetchCalculadoraProductos,
  fetchCalculadoraUltimo,
  postCalculadoraCalculo,
} from '../api';
import { CALC_COD_INPUTS_SCHEMA_VERSION, parseSavedCalculadoraInputs } from '../utils/savedInputs';
import { normalizeName } from '../utils/formatters';

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
    const parsed = parseSavedCalculadoraInputs(c.inputs_json);
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
          inputs_json: {
            schemaVersion: CALC_COD_INPUTS_SCHEMA_VERSION,
            ...opts.inputs,
          } as unknown as Record<string, unknown>,
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
