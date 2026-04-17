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
        gap: 4,
        padding: '10px 8px',
        minHeight: 68,
        boxSizing: 'border-box',
      }}
    >
      <span
        style={{
          fontSize: 15,
          fontWeight: 400,
          lineHeight: 1.25,
          color: isMeta ? 'var(--color-brand)' : 'var(--color-text-secondary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {cpaStr}
      </span>
      <span
        style={{
          fontSize: 13,
          fontWeight: 400,
          lineHeight: 1.25,
          color: isMeta ? 'var(--color-brand-soft)' : 'var(--color-text-muted)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {fmtRoasMult(roas)}
      </span>
    </div>
  );
}

const thBase: CSSProperties = {
  textAlign: 'center',
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  padding: '10px 8px',
  borderBottom: `1px solid ${ds.borderCard}`,
  background: 'transparent',
};

export function PacksSummary(props: Props) {
  const { currency, inputs, packKpis, bestPackId } = props;
  const k0 = packKpis[0];
  const nGen = 100;
  const nDesp = Math.round(nGen * k0.efEnvios);
  const nEnt = Math.round(nGen * k0.efTotal);

  const groupTh = (fg: string): CSSProperties => ({
    ...thBase,
    color: fg,
  });

  const thSubNeutral: CSSProperties = {
    ...thBase,
    color: 'var(--color-text-muted)',
  };

  const thSubMeta: CSSProperties = {
    ...thBase,
    color: 'var(--color-brand)',
  };

  return (
    <div
      style={{
        background: 'var(--color-bg-card)',
        border: `1px solid ${ds.borderCard}`,
        borderRadius: 14,
        padding: '14px 14px 16px',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)' }}>Resumen por pack</div>
        <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-text-muted)' }}>
          Embudo: {fmtPercent(inputs.canceladosPct, 0)} cancelados · {fmtPercent(inputs.devueltosPct, 0)} devueltos del despachado
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            minWidth: 780,
            borderCollapse: 'collapse',
            fontFamily: ds.font,
          }}
        >
          <thead>
            <tr>
              <th
                rowSpan={2}
                style={{
                  ...thBase,
                  textAlign: 'left',
                  verticalAlign: 'bottom',
                  color: 'var(--color-text-hint)',
                  width: 140,
                }}
              >
                PACK
              </th>
              <th
                rowSpan={2}
                style={{
                  ...thBase,
                  verticalAlign: 'bottom',
                  color: 'var(--color-text-hint)',
                  minWidth: 124,
                }}
              >
                GANANCIA
                <br />
                BRUTA
              </th>
              <th colSpan={2} style={groupTh('var(--color-info-text)')}>
                GENERADO - {nGen} PED.
              </th>
              <th colSpan={2} style={groupTh('var(--color-text-secondary)')}>
                DESPACHADO - {nDesp} PED.
              </th>
              <th colSpan={2} style={groupTh('var(--color-success-text)')}>
                ENTREGADO - {nEnt} VENTAS
              </th>
              <th
                rowSpan={2}
                style={{
                  ...thBase,
                  verticalAlign: 'bottom',
                  color: 'var(--color-text-hint)',
                  minWidth: 84,
                }}
              >
                MARGEN
              </th>
            </tr>
            <tr>
              <th style={thSubNeutral}>CPA EQ.</th>
              <th style={thSubMeta}>CPA Objetivo</th>
              <th style={thSubNeutral}>CPA EQ.</th>
              <th style={thSubMeta}>CPA Objetivo</th>
              <th style={thSubNeutral}>CPA EQ.</th>
              <th style={thSubMeta}>CPA Objetivo</th>
            </tr>
          </thead>
          <tbody>
            {packKpis.map((k) => {
              const isBest = k.packId === bestPackId;
              const gainColor = k.gananciaBruta >= 0 ? 'var(--color-success-text)' : 'var(--color-danger-text)';
              return (
                <tr key={k.packId}>
                  <td
                    style={{
                      padding: '12px 12px',
                      borderBottom: `1px solid ${ds.borderRow}`,
                      verticalAlign: 'middle',
                      borderLeft: isBest ? '2px solid var(--color-brand)' : '2px solid transparent',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--color-text-primary)' }}>{k.label}</span>
                          {isBest ? (
                            <span style={{ fontSize: 11, color: 'var(--color-brand)' }} aria-label="Mejor pack">
                              ★
                            </span>
                          ) : null}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 400, color: 'var(--color-text-muted)', marginTop: 3 }}>
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
                      padding: '10px 8px',
                    }}
                  >
                    <span style={{ fontSize: 15, fontWeight: 400, color: gainColor, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtCurrency(k.gananciaBruta, currency)}
                    </span>
                  </td>
                  <td style={{ borderBottom: `1px solid ${ds.borderRow}`, verticalAlign: 'middle' }}>
                    <CpaRoasStack cpa={k.cpaGenEq} roas={k.roasGenEq} currency={currency} variant="eq" />
                  </td>
                  <td style={{ borderBottom: `1px solid ${ds.borderRow}`, verticalAlign: 'middle' }}>
                    <CpaRoasStack cpa={k.cpaGenMeta} roas={k.roasGenMeta} currency={currency} variant="meta" />
                  </td>
                  <td style={{ borderBottom: `1px solid ${ds.borderRow}`, verticalAlign: 'middle' }}>
                    <CpaRoasStack cpa={k.cpaDespEq} roas={k.roasDespEq} currency={currency} variant="eq" />
                  </td>
                  <td style={{ borderBottom: `1px solid ${ds.borderRow}`, verticalAlign: 'middle' }}>
                    <CpaRoasStack cpa={k.cpaDespMeta} roas={k.roasDespMeta} currency={currency} variant="meta" />
                  </td>
                  <td style={{ borderBottom: `1px solid ${ds.borderRow}`, verticalAlign: 'middle' }}>
                    <CpaRoasStack cpa={k.cpaEntrEq} roas={k.roasEntrEq} currency={currency} variant="eq" />
                  </td>
                  <td style={{ borderBottom: `1px solid ${ds.borderRow}`, verticalAlign: 'middle' }}>
                    <CpaRoasStack cpa={k.cpaEntrMeta} roas={k.roasEntrMeta} currency={currency} variant="meta" />
                  </td>
                  <td
                    style={{
                      textAlign: 'center',
                      borderBottom: `1px solid ${ds.borderRow}`,
                      verticalAlign: 'middle',
                      padding: '10px 10px',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 15,
                        fontWeight: 400,
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
