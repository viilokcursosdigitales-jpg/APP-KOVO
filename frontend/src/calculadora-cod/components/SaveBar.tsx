import { useMemo } from 'react';
import { ds } from '../../design-system/ds';
import type { CalculoVersion, ProductoListItem } from '../types';
import { relativeTimeShort } from '../utils/formatters';

type Props = {
  searchValue: string;
  onSearchChange: (v: string) => void;
  productos: ProductoListItem[];
  historico: CalculoVersion[];
  selectedVersionId: number | null;
  onSelectVersion: (id: number | null) => void;
  onLoad: () => void;
  onSave: () => void;
  busy: boolean;
  lastSavedAt: string | null;
};

export function SaveBar(props: Props) {
  const filtered = useMemo(() => {
    const q = props.searchValue.trim().toLowerCase();
    if (!q) return props.productos;
    return props.productos.filter((p) => p.product_name.toLowerCase().includes(q));
  }, [props.productos, props.searchValue]);

  return (
    <div
      style={{
        background: 'var(--color-brand-bg)',
        border: `1px solid ${ds.brandPale}`,
        borderRadius: 14,
        padding: '14px 16px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        alignItems: 'center',
      }}
    >
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-hint)', textTransform: 'uppercase' }}>
          Buscar producto guardado
        </label>
        <input
          list="calc-cod-productos-dl"
          value={props.searchValue}
          onChange={(e) => props.onSearchChange(e.target.value)}
          placeholder="Nombre del producto…"
          style={{
            marginTop: 4,
            width: '100%',
            boxSizing: 'border-box',
            padding: '8px 10px',
            borderRadius: 8,
            border: `1px solid ${ds.borderCard}`,
            background: 'var(--color-bg-card)',
            color: 'var(--color-text-primary)',
            fontSize: 13,
          }}
        />
        <datalist id="calc-cod-productos-dl">
          {filtered.slice(0, 40).map((p) => (
            <option key={p.product_name} value={p.product_name} />
          ))}
        </datalist>
      </div>

      <div style={{ flex: '0 1 220px', minWidth: 0 }}>
        <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-hint)', textTransform: 'uppercase' }}>
          Versión
        </label>
        <select
          value={props.selectedVersionId ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            props.onSelectVersion(v ? Number.parseInt(v, 10) : null);
          }}
          style={{
            marginTop: 4,
            width: '100%',
            padding: '8px 10px',
            borderRadius: 8,
            border: `1px solid ${ds.borderCard}`,
            background: 'var(--color-bg-card)',
            color: 'var(--color-text-primary)',
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          <option value="">—</option>
          {[...props.historico]
            .sort((a, b) => Number(b.id) - Number(a.id))
            .map((h, idx) => {
              const n = props.historico.length - idx;
              const d = h.created_at ? new Date(h.created_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—';
              return (
                <option key={h.id} value={h.id}>
                  v{n} · {d}
                </option>
              );
            })}
        </select>
      </div>

      <button
        type="button"
        disabled={props.busy}
        onClick={props.onLoad}
        style={{
          marginTop: 18,
          padding: '8px 14px',
          borderRadius: 8,
          border: `1px solid ${ds.borderCard}`,
          background: 'var(--color-bg-subtle)',
          color: 'var(--color-text-secondary)',
          fontWeight: 600,
          fontSize: 12,
          cursor: props.busy ? 'wait' : 'pointer',
        }}
      >
        Cargar
      </button>

      <button
        type="button"
        disabled={props.busy}
        onClick={props.onSave}
        style={{
          marginTop: 18,
          padding: '8px 16px',
          borderRadius: 8,
          border: 'none',
          background: 'var(--color-brand)',
          color: ds.textOnBrand,
          fontWeight: 700,
          fontSize: 12,
          cursor: props.busy ? 'wait' : 'pointer',
        }}
      >
        Guardar cálculo
      </button>

      <div
        style={{
          marginTop: 18,
          padding: '6px 12px',
          borderRadius: 999,
          background: 'var(--color-success-bg)',
          color: 'var(--color-success-text)',
          fontSize: 11,
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        Sincronizado · última versión {props.lastSavedAt ? relativeTimeShort(props.lastSavedAt) : 'sin guardar aún'}
      </div>
    </div>
  );
}
