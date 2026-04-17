import type { CalculatorInputsState, CurrencyCode, Pack } from '../types';

/** Versión del JSON de inputs; subir solo si cambia el contrato de migración. */
export const CALC_COD_INPUTS_SCHEMA_VERSION = 2 as const;

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function numOr(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function clampMixTriplet(raw: unknown): [number, number, number] {
  const fallback: [number, number, number] = [34, 33, 33];
  if (!Array.isArray(raw) || raw.length !== 3) return fallback;
  const a = Math.max(0, Number(raw[0]));
  const b = Math.max(0, Number(raw[1]));
  const c = Math.max(0, Number(raw[2]));
  if (![a, b, c].every(Number.isFinite)) return fallback;
  const sum = a + b + c;
  if (sum <= 0) return fallback;
  if (sum > 100) {
    const k = 100 / sum;
    const ra = Math.max(0, Math.round(a * k));
    const rb = Math.max(0, Math.round(b * k));
    const rc = Math.max(0, 100 - ra - rb);
    return [ra, rb, rc];
  }
  return [a, b, c];
}

/**
 * Convierte registros legacy (flete entrega + “efectividad”) al modelo de embudo dual.
 * No pisa datos ya migrados ni snapshots con `schemaVersion` actual.
 */
export function migrateSavedInputsRecord(raw: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...raw };
  const sv = Number(copy.schemaVersion);
  if (Number.isFinite(sv) && sv >= CALC_COD_INPUTS_SCHEMA_VERSION) {
    return copy;
  }
  const fleteIdaVal = copy.fleteIda;
  const hasFleteIda =
    fleteIdaVal !== undefined && fleteIdaVal !== null && Number.isFinite(Number(fleteIdaVal));
  if (hasFleteIda) {
    return copy;
  }
  return {
    ...copy,
    fleteIda: copy.fleteEntrega ?? 0,
    cobraFleteDevolucion: (copy.fleteDevolucion ?? 0) > 0,
    fleteDevolucion: copy.fleteDevolucion ?? 0,
    canceladosPct: 0,
    devueltosPct: copy.efectividadPct != null ? clamp(100 - Number(copy.efectividadPct), 0, 100) : 20,
  };
}

export function coerceSavedPack(p: unknown, idx: 0 | 1 | 2): Pack {
  const o = p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  const id = ([1, 2, 3] as const)[idx];
  let units = Number.isFinite(Number(o.units)) ? Math.max(0, Math.round(Number(o.units))) : id;
  if (units <= 0) units = id;
  const precioRaw = Number(o.precioVenta);
  const precioVenta = Number.isFinite(precioRaw) ? Math.max(0, precioRaw) : 0;
  return {
    id,
    label: typeof o.label === 'string' ? o.label.slice(0, 200) : `Pack ${id}u`,
    units,
    precioVenta,
  };
}

/**
 * Parsea y sanea `inputs_json` de la API hacia `CalculatorInputsState`.
 * Devuelve `null` si falta estructura mínima (p. ej. packs).
 */
export function parseSavedCalculadoraInputs(raw: unknown): CalculatorInputsState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const migrated = migrateSavedInputsRecord(raw as Record<string, unknown>);
  const o = migrated as Record<string, unknown>;

  if (!Array.isArray(o.packs) || o.packs.length !== 3) return null;

  const packs = [coerceSavedPack(o.packs[0], 0), coerceSavedPack(o.packs[1], 1), coerceSavedPack(o.packs[2], 2)] as [
    Pack,
    Pack,
    Pack,
  ];

  const cur: CurrencyCode =
    o.currency === 'USD' || o.currency === 'MXN' || o.currency === 'COP' ? o.currency : 'COP';

  const costoUnitario = Math.max(0, numOr(o.costoUnitario, 0));
  const fleteIda = Math.max(0, numOr(o.fleteIda, 0));
  const fleteDevolucion = Math.max(0, numOr(o.fleteDevolucion, 0));

  const productDisplayName =
    typeof o.productDisplayName === 'string' ? o.productDisplayName.trim().slice(0, 500) : '';

  return {
    productDisplayName,
    costoUnitario,
    packs,
    fleteIda,
    cobraFleteDevolucion: Boolean(o.cobraFleteDevolucion),
    fleteDevolucion,
    canceladosPct: clamp(numOr(o.canceladosPct, 20), 0, 100),
    devueltosPct: clamp(numOr(o.devueltosPct, 20), 0, 100),
    adminPct: clamp(numOr(o.adminPct, 0), 0, 50),
    metaUtilidadPct: clamp(numOr(o.metaUtilidadPct, 0), 0, 100),
    currency: cur,
    mixPct: clampMixTriplet(o.mixPct),
  };
}
