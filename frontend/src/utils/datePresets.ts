export type DatePreset =
  | 'hoy'
  | 'ayer'
  | 'antier'
  | 'ultimos_3d'
  | 'ultimos_4d'
  | 'ultimos_5d'
  | 'ultimos_7d'
  | 'este_mes'
  | 'mes_anterior'
  | 'este_ano'
  | 'personalizado';

export const DATE_PRESETS: { id: DatePreset; label: string }[] = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'ayer', label: 'Ayer' },
  { id: 'este_mes', label: 'Este mes' },
  { id: 'mes_anterior', label: 'Mes anterior' },
  { id: 'este_ano', label: 'Este año' },
  { id: 'personalizado', label: 'Personalizado' },
];

/** Presets de fecha del módulo Pedidos (incluye ventanas móviles de N días). */
export const PEDIDOS_DATE_PRESETS: { id: DatePreset; label: string }[] = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'ayer', label: 'Ayer' },
  { id: 'antier', label: 'Antier' },
  { id: 'ultimos_3d', label: 'Hace 3 días' },
  { id: 'ultimos_4d', label: 'Hace 4 días' },
  { id: 'ultimos_5d', label: 'Hace 5 días' },
  { id: 'ultimos_7d', label: 'Último 7 días' },
  { id: 'este_mes', label: 'Este mes' },
  { id: 'mes_anterior', label: 'Mes anterior' },
  { id: 'este_ano', label: 'Este año' },
  { id: 'personalizado', label: 'Personalizado' },
];

export function buildDateRange(
  preset: DatePreset,
  customFrom: string,
  customTo: string,
): { min: string | null; max: string | null } {
  const now = new Date();
  const isoDay = (d: Date) => {
    const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const e = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    return { min: s.toISOString(), max: e.toISOString() };
  };
  if (preset === 'hoy') return isoDay(now);
  if (preset === 'ayer') {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    return isoDay(y);
  }
  if (preset === 'antier') {
    const d = new Date(now);
    d.setDate(d.getDate() - 2);
    return isoDay(d);
  }
  if (preset === 'ultimos_3d' || preset === 'ultimos_4d' || preset === 'ultimos_5d' || preset === 'ultimos_7d') {
    const days =
      preset === 'ultimos_3d' ? 3 : preset === 'ultimos_4d' ? 4 : preset === 'ultimos_5d' ? 5 : 7;
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1), 0, 0, 0, 0);
    return { min: start.toISOString(), max: end.toISOString() };
  }
  if (preset === 'este_mes') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { min: start.toISOString(), max: end.toISOString() };
  }
  if (preset === 'mes_anterior') {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const lastDay = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return { min: first.toISOString(), max: lastDay.toISOString() };
  }
  if (preset === 'este_ano') {
    const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { min: start.toISOString(), max: end.toISOString() };
  }
  if (preset === 'personalizado' && customFrom && customTo) {
    const [fy, fm, fd] = customFrom.split('-').map(Number);
    const [ty, tm, td] = customTo.split('-').map(Number);
    const start = new Date(fy, fm - 1, fd, 0, 0, 0, 0);
    const end = new Date(ty, tm - 1, td, 23, 59, 59, 999);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { min: null, max: null };
    if (start > end) return { min: end.toISOString(), max: start.toISOString() };
    return { min: start.toISOString(), max: end.toISOString() };
  }
  return { min: null, max: null };
}
