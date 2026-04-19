import { useMemo, useState } from 'react';
import { ds } from '../../design-system/ds';
import type { CalculatorInputsState, PackKpis } from '../types';
import { calcPack } from '../utils/calculations';
import { fmtCurrency } from '../utils/formatters';

type Tab = 'cancelados' | 'devueltos' | 'admin';

type Props = {
  inputs: CalculatorInputsState;
  packKpis: [PackKpis, PackKpis, PackKpis];
};

const CANC_COLS = [0, 10, 20, 30, 40, 50];
const DEV_COLS = [0, 10, 20, 30, 40, 50];
const AD_COLS = [2, 4, 6, 8, 10, 12];

function closestCol(cols: number[], value: number) {
  let best = cols[0];
  let bestD = Math.abs(value - best);
  for (const c of cols.slice(1)) {
    const d = Math.abs(value - c);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

export function SensitivitySection(props: Props) {
  const [tab, setTab] = useState<Tab>('cancelados');
  const { inputs } = props;

  const highlightCanc = useMemo(() => closestCol(CANC_COLS, inputs.canceladosPct), [inputs.canceladosPct]);
  const highlightDev = useMemo(() => closestCol(DEV_COLS, inputs.devueltosPct), [inputs.devueltosPct]);
  const highlightAd = useMemo(() => closestCol(AD_COLS, inputs.adminPct), [inputs.adminPct]);

  const matrix = useMemo(() => {
    const rows = props.packKpis.map((pk) => {
      const pack = inputs.packs.find((p) => p.id === pk.packId)!;
      return { label: pk.label, pack };
    });
    if (tab === 'cancelados') {
      return {
        cols: CANC_COLS,
        highlight: highlightCanc,
        colLabel: (c: number) => `${c}%`,
        cells: rows.map(({ pack }) =>
          CANC_COLS.map((canc) => calcPack(pack, { ...inputs, canceladosPct: canc }).gananciaBruta),
        ),
      };
    }
    if (tab === 'devueltos') {
      return {
        cols: DEV_COLS,
        highlight: highlightDev,
        colLabel: (c: number) => `${c}%`,
        cells: rows.map(({ pack }) =>
          DEV_COLS.map((dev) => calcPack(pack, { ...inputs, devueltosPct: dev }).gananciaBruta),
        ),
      };
    }
    return {
      cols: AD_COLS,
      highlight: highlightAd,
      colLabel: (c: number) => `${c}%`,
      cells: rows.map(({ pack }) =>
        AD_COLS.map((ad) => calcPack(pack, { ...inputs, adminPct: ad }).gananciaBruta),
      ),
    };
  }, [inputs, props.packKpis, tab, highlightCanc, highlightDev, highlightAd]);

  const tabBtns: { id: Tab; label: string }[] = [
    { id: 'cancelados', label: 'Por cancelados' },
    { id: 'devueltos', label: 'Por devueltos' },
    { id: 'admin', label: 'Por % administración' },
  ];

  return (
    <div
      style={{
        background: 'var(--color-bg-card)',
        border: `1px solid ${ds.borderCard}`,
        borderRadius: 14,
        padding: '16px 18px',
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-text-primary)', marginBottom: 12 }}>
        Simulador de sensibilidad
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {tabBtns.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{
                padding: '8px 14px',
                borderRadius: 999,
                border: active ? `1px solid var(--color-brand)` : `1px solid ${ds.borderCard}`,
                background: active ? 'var(--color-brand-bg)' : 'var(--color-bg-subtle)',
                color: active ? 'var(--color-brand)' : 'var(--color-text-muted)',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
          <thead>
            <tr>
              <th
                style={{
                  textAlign: 'left',
                  fontSize: 11,
                  color: 'var(--color-text-hint)',
                  padding: '8px 6px',
                  borderBottom: `1px solid ${ds.borderCard}`,
                }}
              >
                Pack
              </th>
              {matrix.cols.map((c) => (
                <th
                  key={c}
                  style={{
                    textAlign: 'right',
                    fontSize: 11,
                    color: c === matrix.highlight ? 'var(--color-brand)' : 'var(--color-text-hint)',
                    padding: '8px 6px',
                    borderBottom: `1px solid ${ds.borderCard}`,
                    background: c === matrix.highlight ? 'var(--color-brand-bg)' : 'transparent',
                  }}
                >
                  {matrix.colLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.packKpis.map((pk, ri) => (
              <tr key={pk.packId}>
                <td
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: 'var(--color-text-secondary)',
                    padding: '8px 6px',
                    borderBottom: `1px solid ${ds.borderRow}`,
                  }}
                >
                  {pk.label}
                </td>
                {matrix.cells[ri].map((val, ci) => {
                  const col = matrix.cols[ci];
                  const isHighlight = col === matrix.highlight;
                  const neg = val < 0;
                  return (
                    <td
                      key={col}
                      style={{
                        textAlign: 'right',
                        fontSize: 14,
                        fontWeight: 600,
                        padding: '8px 6px',
                        borderBottom: `1px solid ${ds.borderRow}`,
                        background: isHighlight ? 'var(--color-brand-bg)' : neg ? 'var(--color-danger-bg)' : 'transparent',
                        color: isHighlight ? 'var(--color-brand)' : neg ? 'var(--color-danger-text)' : 'var(--color-text-secondary)',
                      }}
                    >
                      {fmtCurrency(val, inputs.currency)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--color-text-hint)' }}>
        Celdas: ganancia bruta por pedido generado (mismos costos base; varía solo la columna mostrada).
      </div>
    </div>
  );
}
