export type CurrencyCode = 'COP' | 'USD' | 'MXN';

export type PackId = 1 | 2 | 3;

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
  fleteEntrega: number;
  fleteDevolucion: number;
  adminPct: number;
  efectividadPct: number;
  metaUtilidadPct: number;
  currency: CurrencyCode;
  mixPct: [number, number, number];
}

export interface PackKpis {
  packId: PackId;
  label: string;
  precioVenta: number;
  costoProducto: number;
  adminMonto: number;
  gananciaSiEntrega: number;
  perdidaSiDevuelve: number;
  efectividad: number;
  gananciaEsperada: number;
  cpaEquilibrio: number;
  roasEquilibrio: number | null;
  utilidadDeseada: number;
  cpaMeta: number;
  roasMeta: number | null;
  margenReal: number;
}

export interface PygRow {
  concepto: string;
  sub?: boolean;
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
