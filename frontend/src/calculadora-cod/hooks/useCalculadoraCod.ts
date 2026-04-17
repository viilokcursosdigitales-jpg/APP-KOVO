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
  fleteEntrega: 20_000,
  fleteDevolucion: 20_000,
  adminPct: 4,
  efectividadPct: 80,
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

  const setFleteEntrega = useCallback((n: number) => {
    setInputs((s) => ({ ...s, fleteEntrega: n }));
  }, []);

  const setFleteDevolucion = useCallback((n: number) => {
    setInputs((s) => ({ ...s, fleteDevolucion: n }));
  }, []);

  const setAdminPct = useCallback((n: number) => {
    setInputs((s) => ({ ...s, adminPct: n }));
  }, []);

  const setEfectividadPct = useCallback((n: number) => {
    setInputs((s) => ({ ...s, efectividadPct: n }));
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
    const { costoUnitario, packs, fleteEntrega, fleteDevolucion, adminPct, efectividadPct, metaUtilidadPct } = inputs;
    return [
      calcPack(costoUnitario, packs[0], fleteEntrega, fleteDevolucion, adminPct, efectividadPct, metaUtilidadPct),
      calcPack(costoUnitario, packs[1], fleteEntrega, fleteDevolucion, adminPct, efectividadPct, metaUtilidadPct),
      calcPack(costoUnitario, packs[2], fleteEntrega, fleteDevolucion, adminPct, efectividadPct, metaUtilidadPct),
    ];
  }, [inputs]);

  const bestId = useMemo(() => bestPackId([...packKpis]), [packKpis]);

  const mixResult = useMemo(
    () => calcMix(inputs.mixPct, [inputs.packs[0], inputs.packs[1], inputs.packs[2]], packKpis),
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
    setFleteEntrega,
    setFleteDevolucion,
    setAdminPct,
    setEfectividadPct,
    setMetaUtilidadPct,
    setMixPct,
    replaceInputs,
    resetToDefaults,
  };
}
