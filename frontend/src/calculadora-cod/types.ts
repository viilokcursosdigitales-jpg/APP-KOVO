export type CurrencyCode = 'COP' | 'USD' | 'MXN';

export type PackId = 1 | 2 | 3;

/** Nivel de embudo para mezcla / tarjetas (CPA·ROAS meta). */
export type FunnelMixLevel = 'gen' | 'desp' | 'entr';

export interface Pack {
  id: PackId;
  label: string;
  units: number;
  precioVenta: number;
}

export interface CalculatorInputsState {
  productDisplayName: string;
  costoUnitario: number;
  packs: [Pack, Pack, Pack];
  fleteIda: number;
  cobraFleteDevolucion: boolean;
  fleteDevolucion: number;
  canceladosPct: number;
  devueltosPct: number;
  adminPct: number;
  metaUtilidadPct: number;
  currency: CurrencyCode;
  mixPct: [number, number, number];
}

export interface PackKpis {
  packId: PackId;
  label: string;
  precio: number;
  unidades: number;
  gananciaBruta: number;
  margen: number;
  efEnvios: number;
  efEntrega: number;
  efTotal: number;
  cpaGenEq: number;
  roasGenEq: number | null;
  cpaDespEq: number;
  roasDespEq: number | null;
  cpaEntrEq: number;
  roasEntrEq: number | null;
  cpaGenMeta: number;
  roasGenMeta: number | null;
  cpaDespMeta: number;
  roasDespMeta: number | null;
  cpaEntrMeta: number;
  roasEntrMeta: number | null;
}

export interface PygRow {
  concepto: string;
  sub?: boolean;
  subSub?: boolean;
  muted?: boolean;
  negative?: boolean;
  total?: boolean;
  final?: boolean;
  a: number | string | null;
  b: number | string | null;
}

export interface PygResult {
  rows: PygRow[];
  margenNetoPctA: number;
  margenNetoPctB: number;
}

export interface MixResult {
  sumaPct: number;
  weights: [number, number, number];
  cpaPonderado: number;
  ticketPromedio: number;
  roasPonderado: number | null;
  cpaConservador: number;
  cpaAgresivo: number;
  roasConservador: number | null;
  roasAgresivo: number | null;
}

export interface ProductoListItem {
  product_name: string;
  last_updated: string | null;
  versions_count: number;
}

export interface CalculoVersion {
  id: number;
  created_at: string | null;
  inputs_json: unknown;
  kpis_json: unknown;
  currency: string;
  notes: string | null;
}

export type PackHealth = 'success' | 'warning' | 'danger';
