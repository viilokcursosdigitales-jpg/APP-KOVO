import type { CSSProperties } from 'react';
import { ds } from './ds';

/** Filas de cuerpo visibles aproximadas antes de activar scroll vertical. */
export const ORDER_LIST_VISIBLE_BODY_ROWS = 10;

/**
 * Alturas de referencia alineadas con DataTable (Th padding 11px vert., Td 12px vert., fs 10.5 / 12).
 * La fila real suele ser más alta si hay texto en varias líneas (dirección, productos): sube
 * APPROX_BODY_ROW_PX si ves menos de ~10 filas, o bájalo si caben claramente más de 10.
 */
const APPROX_THEAD_PX = 40;
const APPROX_BODY_ROW_PX = 62;

export const ORDER_LIST_TABLE_MAX_HEIGHT_PX = APPROX_THEAD_PX + ORDER_LIST_VISIBLE_BODY_ROWS * APPROX_BODY_ROW_PX;

/** Contenedor de la tabla: ~N filas visibles y scroll vertical para el resto. */
export const orderListTableScrollWrapperStyle: CSSProperties = {
  overflowX: 'auto',
  overflowY: 'auto',
  maxHeight: ORDER_LIST_TABLE_MAX_HEIGHT_PX,
  WebkitOverflowScrolling: 'touch',
};

/** Cabecera fija al desplazar verticalmente dentro del contenedor con scroll. */
export const orderListTheadStickyCell: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 3,
  background: ds.bgApp,
  boxShadow: `0 1px 0 ${ds.borderCard}`,
};

const STICKY_CHECKBOX_COL_SHADOW = '4px 0 14px -6px rgba(15, 23, 42, 0.14)';

/** Columna del checkbox: fija al scroll horizontal y al vertical (esquina superior izquierda). */
export const orderListStickyCheckboxTh: CSSProperties = {
  ...orderListTheadStickyCell,
  left: 0,
  zIndex: 6,
  background: ds.bgApp,
  boxShadow: `${STICKY_CHECKBOX_COL_SHADOW}, 0 1px 0 ${ds.borderCard}`,
};

/** Celda de checkbox en cuerpo: fija al scroll horizontal. */
export const orderListStickyCheckboxTd: CSSProperties = {
  position: 'sticky',
  left: 0,
  zIndex: 4,
  background: ds.bgCard,
  boxShadow: STICKY_CHECKBOX_COL_SHADOW,
};
