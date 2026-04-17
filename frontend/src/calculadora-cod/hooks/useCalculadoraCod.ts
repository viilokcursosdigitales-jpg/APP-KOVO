import { useCallback, useMemo, useState } from 'react';
import type { CalculatorInputsState, CurrencyCode, Pack, PackId, PackKpis } from '../types';
import { bestPackId, calcMix, calcPack } from '../utils/calculations';

const defaultPacks: [Pack, Pack, Pack] = [
  { id: 1, label: 'Pack 1u', units: 1, precioVenta: 69_900 },
  { id: 2, label: 'Pack 2u', units: 2, precioVenta: 109_000 },
  { id: 3, label: 'Pack 3u', units: 3, precioVenta: 145_000 },
];

const initialInputs: CalculatorInputsState = {
  productDisplayName: '',
  costoUnitario: 23_000,
  packs: defaultPacks,
  fleteIda: 20_000,
  cobraFleteDevolucion: true,
  fleteDevolucion: 20_000,
  canceladosPct: 20,
  devueltosPct: 20,
  adminPct: 4,
  metaUtilidadPct: 10,
  currency: 'COP',
  mixPct: [34, 33, 33],
};

function cloneInputs(src: CalculatorInputsState): CalculatorInputsState {
  return {
    ...src,
    packs: src.packs.map((p) => ({ ...p })) as [Pack, Pack, Pack],
    mixPct: [...src.mixPct] as [number, number, number],
  };
}

export function useCalculadoraCod() {
  const [inputs, setInputs] = useState<CalculatorInputsState>(() => cloneInputs(initialInputs));

  const setCurrency = useCallback((c: CurrencyCode) => {
    setInputs((s) => ({ ...s, currency: c }));
  }, []);

  const setProductDisplayName = useCallback((v: string) => {
    setInputs((s) => ({ ...s, productDisplayName: v }));
  }, []);

  const setCostoUnitario = useCallback((n: number) => {
    setInputs((s) => ({ ...s, costoUnitario: n }));
  }, []);

  const setPackField = useCallback((packId: PackId, field: 'units' | 'precioVenta' | 'label', value: number | string) => {
    setInputs((s) => ({
      ...s,
      packs: s.packs.map((p) => (p.id === packId ? { ...p, [field]: value } : p)) as [Pack, Pack, Pack],
    }));
  }, []);

  const setFleteIda = useCallback((n: number) => {
    setInputs((s) => ({ ...s, fleteIda: n }));
  }, []);

  const setCobraFleteDevolucion = useCallback((v: boolean) => {
    setInputs((s) => ({ ...s, cobraFleteDevolucion: v }));
  }, []);

  const setFleteDevolucion = useCallback((n: number) => {
    setInputs((s) => ({ ...s, fleteDevolucion: n }));
  }, []);

  const setCanceladosPct = useCallback((n: number) => {
    setInputs((s) => ({ ...s, canceladosPct: n }));
  }, []);

  const setDevueltosPct = useCallback((n: number) => {
    setInputs((s) => ({ ...s, devueltosPct: n }));
  }, []);

  const setAdminPct = useCallback((n: number) => {
    setInputs((s) => ({ ...s, adminPct: n }));
  }, []);

  const setMetaUtilidadPct = useCallback((n: number) => {
    setInputs((s) => ({ ...s, metaUtilidadPct: n }));
  }, []);

  const setMixPct = useCallback((idx: 0 | 1 | 2, v: number) => {
    setInputs((s) => {
      const next = [...s.mixPct] as [number, number, number];
      next[idx] = v;
      return { ...s, mixPct: next };
    });
  }, []);

  const replaceInputs = useCallback((next: CalculatorInputsState) => {
    setInputs(cloneInputs(next));
  }, []);

  const resetToDefaults = useCallback(() => {
    setInputs(cloneInputs(initialInputs));
  }, []);

  const packKpis: [PackKpis, PackKpis, PackKpis] = useMemo(() => {
    const { packs } = inputs;
    return [calcPack(packs[0], inputs), calcPack(packs[1], inputs), calcPack(packs[2], inputs)];
  }, [inputs]);

  const bestId = useMemo(() => bestPackId([...packKpis]), [packKpis]);

  const mixResult = useMemo(
    () => calcMix(inputs.mixPct, inputs.packs, packKpis, 'gen'),
    [inputs.mixPct, inputs.packs, packKpis],
  );

  const kpisPayload = useMemo(
    () => ({
      packs: packKpis,
      mix: mixResult,
      updatedAt: new Date().toISOString(),
    }),
    [packKpis, mixResult],
  );

  return {
    inputs,
    packKpis,
    bestId,
    mixResult,
    kpisPayload,
    setCurrency,
    setProductDisplayName,
    setCostoUnitario,
    setPackField,
    setFleteIda,
    setCobraFleteDevolucion,
    setFleteDevolucion,
    setCanceladosPct,
    setDevueltosPct,
    setAdminPct,
    setMetaUtilidadPct,
    setMixPct,
    replaceInputs,
    resetToDefaults,
  };
}
