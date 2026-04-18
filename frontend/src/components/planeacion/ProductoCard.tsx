import type { CSSProperties } from 'react';
import { ds } from '../../design-system/ds';
import { IconChevronDown, IconTrash } from '../../design-system/icons';
import type { ProductoPlan } from '../../types/planVentas';

const fieldStyle: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: `1px solid ${ds.borderCard}`,
  background: ds.bgApp,
  color: ds.textPrimary,
  fontSize: 13,
  boxSizing: 'border-box',
};

const labelMini: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: ds.textMuted,
  marginBottom: 4,
  display: 'block',
};

type ProductoCardProps = {
  producto: ProductoPlan;
  colorBorde: string;
  expandido: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<ProductoPlan>) => void;
  onEliminar: () => void;
};

export function ProductoCard({
  producto,
  colorBorde,
  expandido,
  onToggle,
  onChange,
  onEliminar,
}: ProductoCardProps) {
  return (
    <div
      style={{
        borderRadius: 12,
        border: `1px solid ${ds.borderCard}`,
        borderLeft: `4px solid ${colorBorde}`,
        background: ds.bgCard,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '12px 14px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 14, color: ds.textPrimary }}>{producto.nombre || 'Sin nombre'}</span>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            color: ds.textMuted,
            transform: expandido ? 'rotate(180deg)' : 'rotate(0)',
            transition: 'transform 0.15s ease',
          }}
        >
          <IconChevronDown />
        </span>
      </button>
      {expandido ? (
        <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={labelMini}>
            Nombre
            <input
              type="text"
              value={producto.nombre}
              onChange={(e) => onChange({ nombre: e.target.value })}
              style={fieldStyle}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
            <label style={labelMini}>
              Precio venta (COP)
              <input
                type="number"
                min={0}
                value={producto.precioVenta || ''}
                onChange={(e) => onChange({ precioVenta: Number(e.target.value) || 0 })}
                style={fieldStyle}
              />
            </label>
            <label style={labelMini}>
              Margen bruto %
              <input
                type="number"
                min={0}
                value={producto.margenBrutoPct || ''}
                onChange={(e) => onChange({ margenBrutoPct: Number(e.target.value) || 0 })}
                style={fieldStyle}
              />
            </label>
            <label style={labelMini}>
              Tasa confirmación %
              <input
                type="number"
                min={0}
                max={100}
                value={producto.tasaConfirmacion || ''}
                onChange={(e) => onChange({ tasaConfirmacion: Number(e.target.value) || 0 })}
                style={fieldStyle}
              />
            </label>
            <label style={labelMini}>
              Tasa entrega %
              <input
                type="number"
                min={0}
                max={100}
                value={producto.tasaEntrega || ''}
                onChange={(e) => onChange({ tasaEntrega: Number(e.target.value) || 0 })}
                style={fieldStyle}
              />
            </label>
            <label style={labelMini}>
              Distribución ventas %
              <input
                type="number"
                min={0}
                max={100}
                value={producto.distribucionVentas || ''}
                onChange={(e) => onChange({ distribucionVentas: Number(e.target.value) || 0 })}
                style={fieldStyle}
              />
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onEliminar}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 12px',
                borderRadius: 8,
                border: `1px solid ${ds.borderCard}`,
                background: ds.dangerBg,
                color: ds.dangerText,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <IconTrash size={14} />
              Quitar producto
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
