import type { ReactNode } from 'react';
import { ds } from '../../design-system/ds';
import type { CalculatorInputsState, CurrencyCode, PackId, PackKpis } from '../types';
import { packHealth } from '../utils/calculations';
import { fmtCurrency, fmtPercent, fmtRoasMult } from '../utils/formatters';

type Props = {
  currency: CurrencyCode;
  inputs: CalculatorInputsState;
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

function th(text: string, align: 'left' | 'right' = 'left') {
  return (
    <th
      style={{
        textAlign: align,
        fontSize: 11,
        fontWeight: 800,
        color: 'var(--color-text-hint)',
        padding: '10px 8px',
        borderBottom: `1px solid ${ds.borderCard}`,
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </th>
  );
}

export function PacksSummary(props: Props) {
  const { currency, inputs, packKpis, bestPackId } = props;
  const k0 = packKpis[0];
  const nGen = 100;
  const nDesp = Math.round(nGen * k0.efEnvios);
  const nEnt = Math.round(nGen * k0.efTotal);

  const rows: { label: string; sub?: boolean; cells: (k: PackKpis) => ReactNode; bold?: boolean; accent?: boolean }[] = [
    {
      label: 'Precio venta',
      cells: (k) => fmtCurrency(k.precio, currency),
    },
    {
      label: 'Unidades',
      cells: (k) => k.unidades,
    },
    {
      label: 'Ganancia bruta / pedido gen.',
      bold: true,
      cells: (k) => (
        <span style={{ color: k.gananciaBruta >= 0 ? 'var(--color-success-text)' : 'var(--color-danger-text)' }}>
          {fmtCurrency(k.gananciaBruta, currency)}
        </span>
      ),
    },
    {
      label: 'Margen % (s/ ventas efectivas)',
      cells: (k) => fmtPercent(k.margen, 1),
    },
    {
      label: 'CPA equilibrio · generado',
      sub: true,
      cells: (k) => fmtCurrency(k.cpaGenEq, currency),
    },
    {
      label: 'ROAS equilibrio · generado',
      sub: true,
      cells: (k) => fmtRoasMult(k.roasGenEq),
    },
    {
      label: 'CPA equilibrio · despachado',
      sub: true,
      cells: (k) => fmtCurrency(k.cpaDespEq, currency),
    },
    {
      label: 'ROAS equilibrio · despachado',
      sub: true,
      cells: (k) => fmtRoasMult(k.roasDespEq),
    },
    {
      label: 'CPA equilibrio · entregado',
      sub: true,
      cells: (k) => fmtCurrency(k.cpaEntrEq, currency),
    },
    {
      label: 'ROAS equilibrio · entregado',
      sub: true,
      cells: (k) => fmtRoasMult(k.roasEntrEq),
    },
    {
      label: 'CPA meta · generado',
      accent: true,
      cells: (k) => fmtCurrency(k.cpaGenMeta, currency),
    },
    {
      label: 'ROAS meta · generado',
      accent: true,
      cells: (k) => fmtRoasMult(k.roasGenMeta),
    },
    {
      label: 'CPA meta · despachado',
      accent: true,
      cells: (k) => fmtCurrency(k.cpaDespMeta, currency),
    },
    {
      label: 'ROAS meta · despachado',
      accent: true,
      cells: (k) => fmtRoasMult(k.roasDespMeta),
    },
    {
      label: 'CPA meta · entregado',
      accent: true,
      cells: (k) => fmtCurrency(k.cpaEntrMeta, currency),
    },
    {
      label: 'ROAS meta · entregado',
      accent: true,
      cells: (k) => fmtRoasMult(k.roasEntrMeta),
    },
  ];

  return (
    <div
      style={{
        background: 'var(--color-bg-card)',
        border: `1px solid ${ds.borderCard}`,
        borderRadius: 14,
        padding: '14px 14px 12px',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-text-primary)' }}>Resumen por pack</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)' }}>
          100 generados → {nDesp} despachados → {nEnt} entregados
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-hint)', marginBottom: 10 }}>
        Embudo actual: {fmtPercent(inputs.canceladosPct, 0)} cancelados · {fmtPercent(inputs.devueltosPct, 0)} devueltos del despachado
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
          <thead>
            <tr>
              {th('Métrica')}
              {packKpis.map((k) => {
                const h = packHealth(k.margen);
                const isBest = k.packId === bestPackId;
                return (
                  <th
                    key={k.packId}
                    style={{
                      textAlign: 'center',
                      fontSize: 12,
                      fontWeight: 800,
                      color: 'var(--color-text-primary)',
                      padding: '10px 8px',
                      borderBottom: `1px solid ${ds.borderCard}`,
                      background: isBest ? 'var(--color-brand-bg)' : 'transparent',
                      borderLeft: isBest ? '2px solid var(--color-brand)' : `1px solid ${ds.borderRow}`,
                      borderRight: isBest ? '2px solid var(--color-brand)' : undefined,
                      borderTop: isBest ? '2px solid var(--color-brand)' : undefined,
                      borderTopLeftRadius: isBest ? 10 : 0,
                      borderTopRightRadius: isBest ? 10 : 0,
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      <span>{k.label}</span>
                      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                        {isBest ? badge('⭐ Mejor', 'brand') : badge(healthLabel(h), h)}
                      </span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--color-text-hint)',
                  padding: '8px 8px',
                  borderBottom: `1px solid ${ds.borderRow}`,
                }}
              >
                Ef. envíos / entrega / total
              </td>
              {packKpis.map((k) => (
                <td
                  key={k.packId}
                  style={{
                    textAlign: 'center',
                    fontSize: 12,
                    fontWeight: 700,
                    color: 'var(--color-text-secondary)',
                    padding: '8px 8px',
                    borderBottom: `1px solid ${ds.borderRow}`,
                  }}
                >
                  {fmtPercent(k.efEnvios * 100, 0)} · {fmtPercent(k.efEntrega * 100, 0)} · {fmtPercent(k.efTotal * 100, 0)}
                </td>
              ))}
            </tr>
            {rows.map((r) => (
              <tr key={r.label}>
                <td
                  style={{
                    padding: '8px 8px',
                    paddingLeft: r.sub ? 16 : 8,
                    fontSize: r.sub ? 11 : 12,
                    fontWeight: r.bold ? 800 : 600,
                    color: r.accent ? 'var(--color-brand)' : 'var(--color-text-muted)',
                    borderBottom: `1px solid ${ds.borderRow}`,
                    maxWidth: 200,
                  }}
                >
                  {r.label}
                </td>
                {packKpis.map((k) => {
                  const isBest = k.packId === bestPackId;
                  return (
                    <td
                      key={k.packId}
                      style={{
                        textAlign: 'right',
                        fontSize: r.bold ? 14 : 13,
                        fontWeight: r.bold ? 900 : 600,
                        padding: '8px 8px',
                        borderBottom: `1px solid ${ds.borderRow}`,
                        background: isBest && (r.accent || r.bold) ? 'var(--color-brand-bg)' : isBest ? 'var(--color-brand-bg)' : 'transparent',
                        color: r.accent ? 'var(--color-brand)' : 'var(--color-text-secondary)',
                      }}
                    >
                      {r.cells(k)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
