/**
 * Estados operativos del pedido (columna «Estado» en Pedidos y Motico).
 * Debe coincidir con SHOPIFY_INTERNAL_STATUSES en el backend.
 */
export const ORDER_INTERNAL_ESTADO_OPTIONS = [
  { value: 'sin_revisar', label: 'Sin revisar' },
  { value: 'sin_confirmar', label: 'No confirmó' },
  { value: 'confirmado', label: 'Confirmado' },
  { value: 'despachado', label: 'Despachado' },
  { value: 'prueba', label: 'Prueba' },
  { value: 'cancelado', label: 'Cancelado' },
] as const;

export type OrderInternalEstadoValue = (typeof ORDER_INTERNAL_ESTADO_OPTIONS)[number]['value'];

export const ORDER_INTERNAL_ESTADO_VALUES = new Set<string>(
  ORDER_INTERNAL_ESTADO_OPTIONS.map((o) => o.value),
);

/** Estados que bloquean edición de fila (Pedidos / Motico). */
export const ORDER_INTERNAL_LOCKED_STATUSES = new Set<OrderInternalEstadoValue>(['despachado', 'cancelado']);

/** Motico: pedidos en este estado pueden imprimir / exportar guías (antes «Imprimir guía»). */
export const ORDER_ESTADO_FOR_GUIA_PRINT: OrderInternalEstadoValue = 'confirmado';

/** Meta visual fila Motico (borde / chip del select). */
export const ORDER_INTERNAL_ESTADO_ROW_META: Record<
  OrderInternalEstadoValue,
  { rowColor: string; chipBg: string; chipFg: string; chipBorder: string }
> = {
  sin_revisar: {
    rowColor: '#9ca3af',
    chipBg: '#f3f4f6',
    chipFg: '#374151',
    chipBorder: '#d1d5db',
  },
  sin_confirmar: {
    rowColor: '#fb923c',
    chipBg: '#ffedd5',
    chipFg: '#9a3412',
    chipBorder: '#fdba74',
  },
  confirmado: {
    rowColor: '#16a34a',
    chipBg: '#dcfce7',
    chipFg: '#14532d',
    chipBorder: '#86efac',
  },
  despachado: {
    rowColor: '#0d9488',
    chipBg: '#ccfbf1',
    chipFg: '#134e4a',
    chipBorder: '#5eead4',
  },
  prueba: {
    rowColor: '#78716c',
    chipBg: '#f5f5f4',
    chipFg: '#44403c',
    chipBorder: '#d6d3d1',
  },
  cancelado: {
    rowColor: '#dc2626',
    chipBg: '#fee2e2',
    chipFg: '#7f1d1d',
    chipBorder: '#fca5a5',
  },
};

/** Valor válido para <select> cuando el API devuelve un estado antiguo (p. ej. motico). */
export function coerceOrderInternalEstadoForSelect(raw: string | undefined | null): OrderInternalEstadoValue {
  const s = String(raw || 'sin_revisar').toLowerCase();
  if (ORDER_INTERNAL_ESTADO_VALUES.has(s)) return s as OrderInternalEstadoValue;
  if (s === 'motico') return 'confirmado';
  return 'sin_revisar';
}
