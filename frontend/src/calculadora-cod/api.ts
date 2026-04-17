import { apiFetch } from '../auth/api';
import type { CalculoVersion, CurrencyCode, ProductoListItem } from './types';

function normalizeProductoListRow(raw: unknown): ProductoListItem {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const cur = String(o.currency || 'COP').trim().toUpperCase();
  const currency: CurrencyCode = cur === 'USD' || cur === 'MXN' || cur === 'COP' ? cur : 'COP';
  const cpaN = Number(o.cpa_objetivo_ponderado);
  const roasN = Number(o.roas_objetivo_ponderado);
  const cpa = Number.isFinite(cpaN) && cpaN > 0 ? cpaN : null;
  const roas = Number.isFinite(roasN) && roasN > 0 ? roasN : null;
  return {
    product_name: String(o.product_name ?? ''),
    last_updated: typeof o.last_updated === 'string' ? o.last_updated : null,
    versions_count: Number(o.versions_count) || 0,
    currency,
    cpa_objetivo_ponderado: cpa,
    roas_objetivo_ponderado: roas,
  };
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = {};
    }
  }
  if (!res.ok) {
    const err = (data as { error?: string })?.error;
    throw new Error(typeof err === 'string' ? err : `Error ${res.status}`);
  }
  return data as T;
}

export async function fetchCalculadoraProductos(): Promise<ProductoListItem[]> {
  const res = await apiFetch('/api/calculadora-cod/productos');
  const data = await readJson<{ productos?: ProductoListItem[] }>(res);
  const list = Array.isArray(data.productos) ? data.productos : [];
  return list.map((p) => normalizeProductoListRow(p));
}

export async function fetchCalculadoraHistorico(nombreNormalizado: string): Promise<CalculoVersion[]> {
  const enc = encodeURIComponent(nombreNormalizado);
  const res = await apiFetch(`/api/calculadora-cod/productos/${enc}/historico`);
  const data = await readJson<{ historico?: CalculoVersion[] }>(res);
  return Array.isArray(data.historico) ? data.historico : [];
}

export async function fetchCalculadoraUltimo(nombreNormalizado: string): Promise<CalculoVersion | null> {
  const enc = encodeURIComponent(nombreNormalizado);
  const res = await apiFetch(`/api/calculadora-cod/productos/${enc}/ultimo`);
  const data = await readJson<{ calculo?: CalculoVersion | null }>(res);
  return data.calculo ?? null;
}

export async function postCalculadoraCalculo(body: {
  product_name: string;
  inputs_json: Record<string, unknown>;
  kpis_json: Record<string, unknown>;
  currency: CurrencyCode;
  notes?: string | null;
}): Promise<CalculoVersion> {
  const res = await apiFetch('/api/calculadora-cod/calculos', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const data = await readJson<{ calculo?: CalculoVersion }>(res);
  if (!data.calculo) throw new Error('Respuesta inválida');
  return data.calculo;
}

export async function deleteCalculadoraCalculo(id: number): Promise<void> {
  const res = await apiFetch(`/api/calculadora-cod/calculos/${id}`, { method: 'DELETE' });
  await readJson<{ success?: boolean }>(res);
}
