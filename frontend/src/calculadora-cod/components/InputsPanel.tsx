import type { ReactNode } from 'react';
import { ds } from '../../design-system/ds';
import type { CalculatorInputsState, PackId } from '../types';
import { fmtPercent } from '../utils/formatters';

type Props = {
  inputs: CalculatorInputsState;
  onProductName: (v: string) => void;
  onCostoUnitario: (n: number) => void;
  onPackField: (id: PackId, field: 'units' | 'precioVenta' | 'label', value: number | string) => void;
  onFleteEntrega: (n: number) => void;
  onFleteDevolucion: (n: number) => void;
  onAdmin: (n: number) => void;
  onEfectividad: (n: number) => void;
  onMetaUtilidad: (n: number) => void;
};

function card(children: ReactNode) {
  return (
    <div
      style={{
        background: 'var(--color-bg-card)',
        border: `1px solid ${ds.borderCard}`,
        borderRadius: 14,
        padding: '14px 16px',
        marginBottom: 12,
      }}
    >
      {children}
    </div>
  );
}

function numInput(value: number, onChange: (n: number) => void) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(Number.parseFloat(e.target.value) || 0)}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        padding: '8px 10px',
        borderRadius: 8,
        border: `1px solid ${ds.borderCard}`,
        background: 'var(--color-bg-app)',
        color: 'var(--color-text-primary)',
        fontSize: 13,
      }}
    />
  );
}

function slider(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  fmt: (n: number) => string,
  onChange: (n: number) => void,
) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-brand)' }}>{fmt(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number.parseFloat(e.target.value) || 0)}
        style={{ width: '100%' }}
      />
    </div>
  );
}

export function InputsPanel(props: Props) {
  const { inputs } = props;
  return (
    <div>
      {card(
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 10 }}>Producto</div>
          <label style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Nombre</label>
          <input
            value={inputs.productDisplayName}
            onChange={(e) => props.onProductName(e.target.value)}
            style={{
              marginTop: 4,
              marginBottom: 10,
              width: '100%',
              boxSizing: 'border-box',
              padding: '8px 10px',
              borderRadius: 8,
              border: `1px solid ${ds.borderCard}`,
              background: 'var(--color-bg-app)',
              color: 'var(--color-text-primary)',
              fontSize: 13,
            }}
          />
          <label style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Costo unitario</label>
          {numInput(inputs.costoUnitario, props.onCostoUnitario)}
        </>,
      )}

      {card(
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 10 }}>
            Packs · precio
          </div>
          {inputs.packs.map((p) => (
            <div
              key={p.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 10,
                marginBottom: 10,
                paddingBottom: 10,
                borderBottom: `1px solid ${ds.borderRow}`,
              }}
            >
              <div>
                <label style={{ fontSize: 10, color: 'var(--color-text-hint)' }}>Etiqueta</label>
                <input
                  value={p.label}
                  onChange={(e) => props.onPackField(p.id, 'label', e.target.value)}
                  style={{
                    marginTop: 4,
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: `1px solid ${ds.borderCard}`,
                    background: 'var(--color-bg-app)',
                    color: 'var(--color-text-primary)',
                    fontSize: 12,
                  }}
                />
              </div>
              <div />
              <div>
                <label style={{ fontSize: 10, color: 'var(--color-text-hint)' }}>Unidades</label>
                {numInput(p.units, (n) => props.onPackField(p.id, 'units', Math.max(0, Math.round(n))))}
              </div>
              <div>
                <label style={{ fontSize: 10, color: 'var(--color-text-hint)' }}>Precio venta</label>
                {numInput(p.precioVenta, (n) => props.onPackField(p.id, 'precioVenta', Math.max(0, n)))}
              </div>
            </div>
          ))}
        </>,
      )}

      {card(
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 8 }}>
            Costos operativos
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Flete entrega</label>
              {numInput(inputs.fleteEntrega, props.onFleteEntrega)}
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Flete devolución</label>
              {numInput(inputs.fleteDevolucion, props.onFleteDevolucion)}
            </div>
          </div>
          {slider('% Admin', inputs.adminPct, 0, 25, 0.5, (n) => fmtPercent(n, 1), props.onAdmin)}
          {slider('Efectividad entrega', inputs.efectividadPct, 0, 100, 1, (n) => fmtPercent(n, 0), props.onEfectividad)}
        </>,
      )}

      <div
        style={{
          background: 'var(--color-brand-bg)',
          border: `1px solid ${ds.brandPale}`,
          borderRadius: 14,
          padding: '14px 16px',
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-brand)', marginBottom: 8 }}>Meta de utilidad</div>
        {slider('Meta utilidad / ticket', inputs.metaUtilidadPct, 0, 40, 0.5, (n) => fmtPercent(n, 1), props.onMetaUtilidad)}
        <div style={{ marginTop: 10, fontSize: 22, fontWeight: 800, color: 'var(--color-brand)' }}>
          {fmtPercent(inputs.metaUtilidadPct, 1)}
        </div>
      </div>
    </div>
  );
}
