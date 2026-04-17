import { useMemo, useState } from 'react';
import { ds } from '../../design-system/ds';
import type { CalculatorInputsState, PackId, PackKpis } from '../types';
import { calcPyg } from '../utils/calculations';
import { fmtCurrency, fmtPercent } from '../utils/formatters';

type Props = {
  inputs: CalculatorInputsState;
  packKpis: [PackKpis, PackKpis, PackKpis];
};

export function PygStatement(props: Props) {
  const [packId, setPackId] = useState<PackId>(1);
  const [pedA, setPedA] = useState(100);
  const [pedB, setPedB] = useState(1000);

  const pack = useMemo(() => props.inputs.packs.find((p) => p.id === packId)!, [props.inputs.packs, packId]);
  const kpi = useMemo(() => props.packKpis.find((k) => k.packId === packId)!, [props.packKpis, packId]);

  const pyg = useMemo(
    () =>
      calcPyg(
        pedA,
        pedB,
        pack,
        props.inputs.costoUnitario,
        props.inputs.fleteEntrega,
        props.inputs.fleteDevolucion,
        props.inputs.adminPct,
        props.inputs.efectividadPct,
        kpi.cpaMeta,
      ),
    [pedA, pedB, pack, props.inputs, kpi.cpaMeta],
  );

  const cpaLabel = kpi.cpaMeta > 0 ? fmtCurrency(kpi.cpaMeta, props.inputs.currency) : '—';

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
        Estado de PyG proyectado
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div>
          <label style={{ fontSize: 10, color: 'var(--color-text-hint)', fontWeight: 700 }}>PACK</label>
          <select
            value={packId}
            onChange={(e) => setPackId(Number(e.target.value) as PackId)}
            style={{
              marginTop: 4,
              display: 'block',
              padding: '8px 10px',
              borderRadius: 8,
              border: `1px solid ${ds.borderCard}`,
              background: 'var(--color-bg-app)',
              color: 'var(--color-text-primary)',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {props.inputs.packs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 10, color: 'var(--color-text-hint)', fontWeight: 700 }}>ESCENARIO A</label>
          <input
            type="number"
            value={pedA}
            onChange={(e) => setPedA(Math.max(0, Math.round(Number.parseFloat(e.target.value) || 0)))}
            style={{
              marginTop: 4,
              display: 'block',
              width: 120,
              padding: '8px 10px',
              borderRadius: 8,
              border: `1px solid ${ds.borderCard}`,
              background: 'var(--color-bg-app)',
              color: 'var(--color-text-primary)',
              fontSize: 12,
            }}
          />
        </div>
        <div>
          <label style={{ fontSize: 10, color: 'var(--color-text-hint)', fontWeight: 700 }}>ESCENARIO B</label>
          <input
            type="number"
            value={pedB}
            onChange={(e) => setPedB(Math.max(0, Math.round(Number.parseFloat(e.target.value) || 0)))}
            style={{
              marginTop: 4,
              display: 'block',
              width: 120,
              padding: '8px 10px',
              borderRadius: 8,
              border: `1px solid ${ds.borderCard}`,
              background: 'var(--color-bg-app)',
              color: 'var(--color-text-primary)',
              fontSize: 12,
            }}
          />
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', fontSize: 11, color: 'var(--color-text-hint)', padding: '8px 6px' }}>Concepto</th>
              <th style={{ textAlign: 'right', fontSize: 11, color: 'var(--color-text-hint)', padding: '8px 6px' }}>Escenario A</th>
              <th style={{ textAlign: 'right', fontSize: 11, color: 'var(--color-text-hint)', padding: '8px 6px' }}>Escenario B</th>
            </tr>
          </thead>
          <tbody>
            {pyg.rows.map((row, idx) => {
              const fmtCell = (v: number | string | null) => {
                if (v == null) return '—';
                if (typeof v === 'string') return v;
                return fmtCurrency(v, props.inputs.currency);
              };
              const neg = row.negative;
              const bg = row.final ? 'var(--color-brand-bg)' : row.total ? 'var(--color-bg-subtle)' : 'transparent';
              const padLeft = row.sub ? 18 : 6;
              return (
                <tr key={`${row.concepto}-${idx}`}>
                  <td
                    style={{
                      padding: '8px 6px',
                      paddingLeft: padLeft,
                      fontSize: row.sub ? 12 : 13,
                      fontWeight: row.final ? 800 : row.total ? 700 : 500,
                      color: row.muted ? 'var(--color-text-muted)' : row.final ? 'var(--color-brand)' : 'var(--color-text-secondary)',
                      background: bg,
                    }}
                  >
                    {row.concepto}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      padding: '8px 6px',
                      fontSize: 13,
                      fontWeight: row.final ? 800 : 600,
                      color: neg ? 'var(--color-danger-text)' : row.final ? 'var(--color-brand)' : 'var(--color-text-secondary)',
                      background: bg,
                    }}
                  >
                    {fmtCell(row.a)}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      padding: '8px 6px',
                      fontSize: 13,
                      fontWeight: row.final ? 800 : 600,
                      color: neg ? 'var(--color-danger-text)' : row.final ? 'var(--color-brand)' : 'var(--color-text-secondary)',
                      background: bg,
                    }}
                  >
                    {fmtCell(row.b)}
                  </td>
                </tr>
              );
            })}
            <tr>
              <td style={{ padding: '10px 6px', fontSize: 12, color: 'var(--color-text-muted)' }}>Margen neto %</td>
              <td style={{ textAlign: 'right', padding: '10px 6px', fontSize: 12, color: 'var(--color-text-muted)' }}>
                {fmtPercent(pyg.margenNetoPctA, 1)}
              </td>
              <td style={{ textAlign: 'right', padding: '10px 6px', fontSize: 12, color: 'var(--color-text-muted)' }}>
                {fmtPercent(pyg.margenNetoPctB, 1)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--color-text-hint)' }}>CPA meta aplicado: {cpaLabel}</div>
    </div>
  );
}
