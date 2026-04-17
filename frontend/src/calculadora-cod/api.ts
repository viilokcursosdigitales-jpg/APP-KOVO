import { apiFetch } from '../auth/api';
import type { CalculoVersion, CurrencyCode, ProductoListItem } from './types';

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
  return Array.isArray(data.productos) ? data.productos : [];
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
