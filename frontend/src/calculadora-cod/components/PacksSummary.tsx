import { ds } from '../../design-system/ds';
import type { CurrencyCode, PackId, PackKpis } from '../types';
import { packHealth } from '../utils/calculations';
import { fmtCurrency, fmtPercent, fmtRoasMult } from '../utils/formatters';

type Props = {
  currency: CurrencyCode;
  packKpis: [PackKpis, PackKpis, PackKpis];
  bestPackId: PackId;
};

function badge(label: string, tone: 'success' | 'warning' | 'danger' | 'brand') {
  const bg =
    tone === 'success'
      ? 'var(--color-success-bg)'
      : tone === 'warning'
        ? 'var(--color-warning-bg)'
        : tone === 'danger'
          ? 'var(--color-danger-bg)'
          : 'var(--color-brand-bg)';
  const fg =
    tone === 'success'
      ? 'var(--color-success-text)'
      : tone === 'warning'
        ? 'var(--color-warning-text)'
        : tone === 'danger'
          ? 'var(--color-danger-text)'
          : 'var(--color-brand)';
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: '3px 8px',
        borderRadius: 999,
        background: bg,
        color: fg,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

function healthLabel(h: ReturnType<typeof packHealth>) {
  if (h === 'success') return 'Saludable';
  if (h === 'warning') return 'Atención';
  return 'Crítico';
}

export function PacksSummary(props: Props) {
  const { currency, packKpis, bestPackId } = props;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 'var(--grid-gap)',
      }}
      className="calc-cod-pack-grid"
    >
      {packKpis.map((k) => {
        const h = packHealth(k.margenReal);
        const isBest = k.packId === bestPackId;
        const gainColor = k.gananciaEsperada >= 0 ? 'var(--color-success-text)' : 'var(--color-danger-text)';
        return (
          <div
            key={k.packId}
            style={{
              background: 'var(--color-bg-card)',
              borderRadius: 16,
              border: isBest ? `2px solid var(--color-brand)` : `1px solid ${ds.borderCard}`,
              padding: '14px 14px 12px',
              boxShadow: isBest ? `0 0 0 6px var(--color-brand-bg)` : undefined,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 99,
                    background:
                      h === 'success'
                        ? 'var(--color-success-text)'
                        : h === 'warning'
                          ? 'var(--color-warning-text)'
                          : 'var(--color-danger-text)',
                    flexShrink: 0,
                  }}
                />
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 800,
                    color: 'var(--color-text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {k.label}
                </div>
              </div>
              {isBest ? badge('⭐ Mejor', 'brand') : badge(healthLabel(h), h)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 10 }}>
              Precio · venta · {fmtCurrency(k.precioVenta, currency)}
            </div>
            <div style={{ borderTop: `1px solid ${ds.borderRow}`, paddingTop: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--color-text-hint)' }}>
                GANANCIA ESPERADA
              </div>
              <div style={{ fontSize: 22, fontWeight: 900, color: gainColor, marginTop: 4 }}>{fmtCurrency(k.gananciaEsperada, currency)}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>por cada pedido</div>
            </div>
            <div
              style={{
                marginTop: 10,
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 8,
                borderTop: `1px solid ${ds.borderRow}`,
                paddingTop: 10,
              }}
            >
              <div>
                <div style={{ fontSize: 10, color: 'var(--color-text-hint)' }}>CPA equilibrio</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-secondary)' }}>
                  {fmtCurrency(k.cpaEquilibrio, currency)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--color-text-hint)' }}>ROAS equilibrio</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-secondary)' }}>{fmtRoasMult(k.roasEquilibrio)}</div>
              </div>
              <div style={{ background: 'var(--color-brand-bg)', borderRadius: 10, padding: 8 }}>
                <div style={{ fontSize: 10, color: 'var(--color-brand)', fontWeight: 700 }}>CPA meta</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-brand)' }}>{fmtCurrency(k.cpaMeta, currency)}</div>
              </div>
              <div style={{ background: 'var(--color-brand-bg)', borderRadius: 10, padding: 8 }}>
                <div style={{ fontSize: 10, color: 'var(--color-brand)', fontWeight: 700 }}>ROAS meta</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-brand)' }}>{fmtRoasMult(k.roasMeta)}</div>
              </div>
            </div>
            <div style={{ marginTop: 10, borderTop: `1px solid ${ds.borderRow}`, paddingTop: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                Margen real{' '}
                <strong style={{ color: h === 'success' ? 'var(--color-success-text)' : h === 'warning' ? 'var(--color-warning-text)' : 'var(--color-danger-text)' }}>
                  {fmtPercent(k.margenReal, 1)}
                </strong>
              </div>
            </div>
          </div>
        );
      })}
      <style>{`
        @media (max-width: 900px) {
          .calc-cod-pack-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
