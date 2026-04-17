import type { CSSProperties } from 'react';
import { ds } from '../../design-system/ds';
import type { CalculatorInputsState, CurrencyCode, PackId, PackKpis } from '../types';
import { fmtCurrency, fmtPercent, fmtRoasMult } from '../utils/formatters';

type Props = {
  currency: CurrencyCode;
  inputs: CalculatorInputsState;
  packKpis: [PackKpis, PackKpis, PackKpis];
  bestPackId: PackId;
};

function CpaRoasStack(props: {
  cpa: number;
  roas: number | null;
  currency: CurrencyCode;
  variant: 'eq' | 'meta';
}) {
  const { cpa, roas, currency, variant } = props;
  const isMeta = variant === 'meta';
  const cpaStr = cpa > 0 ? fmtCurrency(cpa, currency) : '—';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '10px 8px',
        minHeight: 72,
        boxSizing: 'border-box',
      }}
    >
      <span
        style={{
          fontSize: 16,
          fontWeight: 800,
          lineHeight: 1.2,
          color: isMeta ? 'var(--color-brand)' : 'var(--color-text-secondary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {cpaStr}
      </span>
      <span
        style={{
          fontSize: 14,
          fontWeight: 700,
          lineHeight: 1.2,
          color: isMeta ? 'var(--color-brand)' : 'var(--color-text-muted)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {fmtRoasMult(roas)}
      </span>
    </div>
  );
}

const thSub: CSSProperties = {
  textAlign: 'center',
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
  padding: '8px 6px',
  borderBottom: `1px solid ${ds.borderCard}`,
  background: 'var(--color-bg-subtle)',
};

export function PacksSummary(props: Props) {
  const { currency, inputs, packKpis, bestPackId } = props;
  const k0 = packKpis[0];
  const nGen = 100;
  const nDesp = Math.round(nGen * k0.efEnvios);
  const nEnt = Math.round(nGen * k0.efTotal);

  const groupTh = (bg: string, fg: string): CSSProperties => ({
    textAlign: 'center',
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.06em',
    color: fg,
    background: bg,
    padding: '10px 8px',
    borderBottom: `1px solid ${ds.borderCard}`,
  });

  return (
    <div
      style={{
        background: 'var(--color-bg-card)',
        border: `1px solid ${ds.borderCard}`,
        borderRadius: 14,
        padding: '14px 14px 16px',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-text-primary)' }}>Resumen por pack</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)' }}>
          Embudo: {fmtPercent(inputs.canceladosPct, 0)} cancelados · {fmtPercent(inputs.devueltosPct, 0)} devueltos del despachado
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            minWidth: 820,
            borderCollapse: 'collapse',
            fontFamily: ds.font,
          }}
        >
          <thead>
            <tr>
              <th
                rowSpan={2}
                style={{
                  textAlign: 'left',
                  verticalAlign: 'bottom',
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: '0.08em',
                  color: 'var(--color-text-hint)',
                  padding: '12px 12px 14px',
                  borderBottom: `1px solid ${ds.borderCard}`,
                  width: 140,
                }}
              >
                PACK
              </th>
              <th
                rowSpan={2}
                style={{
                  textAlign: 'center',
                  verticalAlign: 'bottom',
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: '0.08em',
                  color: 'var(--color-text-hint)',
                  padding: '12px 10px 14px',
                  borderBottom: `1px solid ${ds.borderCard}`,
                  minWidth: 130,
                }}
              >
                GANANCIA
                <br />
                BRUTA
              </th>
              <th colSpan={2} style={groupTh('var(--color-info-bg)', 'var(--color-info-text)')}>
                GENERADO - {nGen} PED.
              </th>
              <th colSpan={2} style={groupTh('var(--color-bg-subtle)', 'var(--color-text-secondary)')}>
                DESPACHADO - {nDesp} PED.
              </th>
              <th colSpan={2} style={groupTh('var(--color-success-bg)', 'var(--color-success-text)')}>
                ENTREGADO - {nEnt} VENTAS
              </th>
              <th
                rowSpan={2}
                style={{
                  textAlign: 'center',
                  verticalAlign: 'bottom',
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: '0.08em',
                  color: 'var(--color-text-hint)',
                  padding: '12px 12px 14px',
                  borderBottom: `1px solid ${ds.borderCard}`,
                  minWidth: 88,
                }}
              >
                MARGEN
              </th>
            </tr>
            <tr>
              <th style={thSub}>CPA EQ.</th>
              <th style={{ ...thSub, color: 'var(--color-brand)', background: 'var(--color-brand-bg)' }}>CPA META</th>
              <th style={thSub}>CPA EQ.</th>
              <th style={{ ...thSub, color: 'var(--color-brand)', background: 'var(--color-brand-bg)' }}>CPA META</th>
              <th style={thSub}>CPA EQ.</th>
              <th style={{ ...thSub, color: 'var(--color-brand)', background: 'var(--color-brand-bg)' }}>CPA META</th>
            </tr>
          </thead>
          <tbody>
            {packKpis.map((k) => {
              const isBest = k.packId === bestPackId;
              const rowBg = isBest ? 'var(--color-brand-bg)' : 'transparent';
              const gainColor = k.gananciaBruta >= 0 ? 'var(--color-success-text)' : 'var(--color-danger-text)';
              return (
                <tr key={k.packId} style={{ background: rowBg }}>
                  <td
                    style={{
                      padding: '14px 12px',
                      borderBottom: `1px solid ${ds.borderRow}`,
                      verticalAlign: 'middle',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 18, lineHeight: 1, color: 'var(--color-warning-text)' }} aria-hidden>
                        ●
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--color-text-primary)' }}>{k.label}</span>
                          {isBest ? (
                            <span style={{ fontSize: 12 }} aria-label="Mejor pack">
                              ⭐
                            </span>
                          ) : null}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginTop: 4 }}>
                          {fmtCurrency(k.precio, currency)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td
                    style={{
                      textAlign: 'center',
                      borderBottom: `1px solid ${ds.borderRow}`,
                      verticalAlign: 'middle',
                      padding: '12px 8px',
                    }}
                  >
                    <span style={{ fontSize: 17, fontWeight: 800, color: gainColor, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtCurrency(k.gananciaBruta, currency)}
                    </span>
                  </td>
                  <td style={{ borderBottom: `1px solid ${ds.borderRow}`, verticalAlign: 'middle', background: 'var(--color-info-bg)' }}>
                    <CpaRoasStack cpa={k.cpaGenEq} roas={k.roasGenEq} currency={currency} variant="eq" />
                  </td>
                  <td style={{ borderBottom: `1px solid ${ds.borderRow}`, verticalAlign: 'middle', background: 'var(--color-brand-bg)' }}>
                    <CpaRoasStack cpa={k.cpaGenMeta} roas={k.roasGenMeta} currency={currency} variant="meta" />
                  </td>
                  <td style={{ borderBottom: `1px solid ${ds.borderRow}`, verticalAlign: 'middle', background: 'var(--color-bg-subtle)' }}>
                    <CpaRoasStack cpa={k.cpaDespEq} roas={k.roasDespEq} currency={currency} variant="eq" />
                  </td>
                  <td style={{ borderBottom: `1px solid ${ds.borderRow}`, verticalAlign: 'middle', background: 'var(--color-brand-bg)' }}>
                    <CpaRoasStack cpa={k.cpaDespMeta} roas={k.roasDespMeta} currency={currency} variant="meta" />
                  </td>
                  <td style={{ borderBottom: `1px solid ${ds.borderRow}`, verticalAlign: 'middle', background: 'var(--color-success-bg)' }}>
                    <CpaRoasStack cpa={k.cpaEntrEq} roas={k.roasEntrEq} currency={currency} variant="eq" />
                  </td>
                  <td style={{ borderBottom: `1px solid ${ds.borderRow}`, verticalAlign: 'middle', background: 'var(--color-brand-bg)' }}>
                    <CpaRoasStack cpa={k.cpaEntrMeta} roas={k.roasEntrMeta} currency={currency} variant="meta" />
                  </td>
                  <td
                    style={{
                      textAlign: 'center',
                      borderBottom: `1px solid ${ds.borderRow}`,
                      verticalAlign: 'middle',
                      padding: '12px 10px',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 17,
                        fontWeight: 800,
                        color: 'var(--color-warning-text)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {fmtPercent(k.margen, 1)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
