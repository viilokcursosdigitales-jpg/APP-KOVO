import { describe, expect, it } from 'vitest';
import {
  CALC_COD_INPUTS_SCHEMA_VERSION,
  coerceSavedPack,
  migrateSavedInputsRecord,
  parseSavedCalculadoraInputs,
} from './savedInputs';

const threePacks = [
  { id: 1, label: 'A', units: 1, precioVenta: 100 },
  { id: 2, label: 'B', units: 2, precioVenta: 200 },
  { id: 3, label: 'C', units: 3, precioVenta: 300 },
];

describe('migrateSavedInputsRecord', () => {
  it('maps legacy fleteEntrega and efectividad to fleteIda and devueltosPct', () => {
    const out = migrateSavedInputsRecord({
      packs: threePacks,
      fleteEntrega: 15000,
      fleteDevolucion: 8000,
      efectividadPct: 85,
      costoUnitario: 1000,
    } as Record<string, unknown>);
    expect(out.fleteIda).toBe(15000);
    expect(out.fleteDevolucion).toBe(8000);
    expect(out.cobraFleteDevolucion).toBe(true);
    expect(out.canceladosPct).toBe(0);
    expect(out.devueltosPct).toBe(15);
  });

  it('does not overwrite when schemaVersion is current', () => {
    const out = migrateSavedInputsRecord({
      schemaVersion: CALC_COD_INPUTS_SCHEMA_VERSION,
      fleteIda: 999,
      packs: threePacks,
      fleteEntrega: 1,
    } as Record<string, unknown>);
    expect(out.fleteIda).toBe(999);
  });

  it('does not migrate when fleteIda is already present', () => {
    const out = migrateSavedInputsRecord({
      fleteIda: 12000,
      fleteEntrega: 1,
      packs: threePacks,
    } as Record<string, unknown>);
    expect(out.fleteIda).toBe(12000);
  });
});

describe('parseSavedCalculadoraInputs', () => {
  it('returns null for non-object or wrong packs length', () => {
    expect(parseSavedCalculadoraInputs(null)).toBeNull();
    expect(parseSavedCalculadoraInputs([])).toBeNull();
    expect(parseSavedCalculadoraInputs({ packs: [] })).toBeNull();
  });

  it('clamps percentages and uses default mix when sum is zero', () => {
    const state = parseSavedCalculadoraInputs({
      schemaVersion: CALC_COD_INPUTS_SCHEMA_VERSION,
      packs: threePacks,
      fleteIda: 1,
      cobraFleteDevolucion: false,
      fleteDevolucion: 0,
      canceladosPct: 999,
      devueltosPct: -5,
      adminPct: 80,
      metaUtilidadPct: 200,
      costoUnitario: -10,
      mixPct: [0, 0, 0],
      currency: 'COP',
    });
    expect(state).not.toBeNull();
    expect(state!.canceladosPct).toBe(100);
    expect(state!.devueltosPct).toBe(0);
    expect(state!.adminPct).toBe(50);
    expect(state!.metaUtilidadPct).toBe(100);
    expect(state!.costoUnitario).toBe(0);
    expect(state!.mixPct).toEqual([34, 33, 33]);
  });

  it('normalizes mix when sum exceeds 100', () => {
    const state = parseSavedCalculadoraInputs({
      schemaVersion: 2,
      packs: [
        { label: 'P1', units: 1, precioVenta: 100 },
        { label: 'P2', units: 2, precioVenta: 100 },
        { label: 'P3', units: 3, precioVenta: 100 },
      ],
      mixPct: [80, 20, 10],
      fleteIda: 0,
      cobraFleteDevolucion: false,
      fleteDevolucion: 0,
      canceladosPct: 0,
      devueltosPct: 0,
      adminPct: 0,
      metaUtilidadPct: 0,
      costoUnitario: 0,
      currency: 'COP',
    });
    expect(state).not.toBeNull();
    expect(state!.mixPct[0] + state!.mixPct[1] + state!.mixPct[2]).toBe(100);
  });

  it('coerces packs with bad units to fallback id', () => {
    const state = parseSavedCalculadoraInputs({
      schemaVersion: 2,
      packs: [
        { label: 'P1', units: 'x', precioVenta: -50 },
        { label: 'P2', units: 0, precioVenta: 100 },
        { label: 'P3', units: 2, precioVenta: 100 },
      ],
    });
    expect(state).not.toBeNull();
    expect(state!.packs[0].units).toBe(1);
    expect(state!.packs[0].precioVenta).toBe(0);
    expect(state!.packs[1].units).toBe(2);
  });
});

describe('coerceSavedPack', () => {
  it('uses pack id when units are zero after parse', () => {
    const p = coerceSavedPack({ units: 0, precioVenta: 10, label: 'L' }, 1);
    expect(p.units).toBe(2);
  });
});
