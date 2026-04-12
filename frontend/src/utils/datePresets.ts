export type DatePreset = 'hoy' | 'ayer' | 'este_mes' | 'mes_anterior' | 'este_ano' | 'personalizado';

export const DATE_PRESETS: { id: DatePreset; label: string }[] = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'ayer', label: 'Ayer' },
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
