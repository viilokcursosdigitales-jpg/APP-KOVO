import { ds } from '../../design-system/ds';
import type { ProductoListItem } from '../types';
import { fmtCurrency, fmtRoasMult, relativeTimeShort } from '../utils/formatters';

type Props = {
  productos: ProductoListItem[];
  loading: boolean;
  busy: boolean;
  onVer: (productKey: string) => void;
  onNuevoCalculo: () => void;
};

function fmtVers(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n === 1 ? '1 versión' : `${Math.round(n)} versiones`;
}

export function ProductosGuardadosList(props: Props) {
  const sorted = [...props.productos].sort((a, b) => {
    const ta = a.last_updated ? new Date(a.last_updated).getTime() : 0;
    const tb = b.last_updated ? new Date(b.last_updated).getTime() : 0;
    return tb - ta;
  });

  return (
    <div
      style={{
        background: 'var(--color-bg-card)',
        border: `1px solid ${ds.borderCard}`,
        borderRadius: 14,
        padding: '16px 18px',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-text-primary)' }}>Productos guardados</div>
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-muted)', maxWidth: 560 }}>
            Cada fila muestra el último guardado (al guardar se actualiza el mismo registro, sin crear versiones nuevas). Pulsa{' '}
            <strong style={{ fontWeight: 700 }}>Ver</strong> para abrir la calculadora con esos datos.
          </div>
        </div>
        <button
          type="button"
          disabled={props.busy}
          onClick={props.onNuevoCalculo}
          style={{
            padding: '10px 18px',
            borderRadius: 10,
            border: 'none',
            background: 'var(--color-brand)',
            color: ds.textOnBrand,
            fontWeight: 700,
            fontSize: 13,
            cursor: props.busy ? 'wait' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Nuevo cálculo
        </button>
      </div>

      {props.loading && !sorted.length ? (
        <div style={{ marginTop: 18, fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 600 }}>Cargando…</div>
      ) : null}

      {!props.loading && sorted.length === 0 ? (
        <div
          style={{
            marginTop: 18,
            padding: '14px 16px',
            borderRadius: 12,
            background: 'var(--color-bg-subtle)',
            border: `1px dashed ${ds.borderCard}`,
            fontSize: 13,
            color: 'var(--color-text-secondary)',
            lineHeight: 1.45,
          }}
        >
          Aún no hay productos guardados. Usa <strong style={{ fontWeight: 700 }}>Nuevo cálculo</strong> para abrir la
          calculadora y, cuando termines, pulsa <strong style={{ fontWeight: 700 }}>Guardar cálculo</strong> (se crea el
          registro la primera vez; después se actualiza el mismo).
        </div>
      ) : null}

      {sorted.length > 0 ? (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sorted.map((p) => {
            const updated = p.last_updated ? relativeTimeShort(p.last_updated) : 'sin fecha';
            const abs = p.last_updated
              ? new Date(p.last_updated).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
              : '—';
            return (
              <div
                key={p.product_name}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: `1px solid ${ds.borderRow}`,
                  background: 'var(--color-bg-app)',
                  minWidth: 0,
                }}
              >
                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 800,
                      color: 'var(--color-text-primary)',
                      wordBreak: 'break-word',
                    }}
                    title={p.product_name}
                  >
                    {p.product_name}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-muted)' }}>
                    {fmtVers(p.versions_count)} · Último guardado {updated}
                    <span style={{ color: 'var(--color-text-hint)' }}> ({abs})</span>
                  </div>
                </div>
                <div
                  style={{
                    flex: '1 1 200px',
                    minWidth: 0,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 14,
                    alignItems: 'center',
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-hint)', textTransform: 'uppercase' }}>
                      ROAS objetivo ponderado
                    </div>
                    <div style={{ marginTop: 2, fontWeight: 800, color: 'var(--color-brand)', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtRoasMult(p.roas_objetivo_ponderado)}
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-hint)', textTransform: 'uppercase' }}>
                      CPA objetivo ponderado
                    </div>
                    <div style={{ marginTop: 2, fontWeight: 800, color: 'var(--color-brand)', fontVariantNumeric: 'tabular-nums' }}>
                      {p.cpa_objetivo_ponderado != null && p.cpa_objetivo_ponderado > 0
                        ? fmtCurrency(p.cpa_objetivo_ponderado, p.currency)
                        : '—'}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={props.busy}
                  onClick={() => props.onVer(p.product_name)}
                  style={{
                    flex: '0 0 auto',
                    padding: '8px 20px',
                    borderRadius: 8,
                    border: `1px solid var(--color-brand)`,
                    background: 'var(--color-brand-bg)',
                    color: 'var(--color-brand)',
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: props.busy ? 'wait' : 'pointer',
                  }}
                >
                  Ver
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
