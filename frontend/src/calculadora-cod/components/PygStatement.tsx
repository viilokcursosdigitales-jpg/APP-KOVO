import { useMemo, useState } from 'react';
import { ds } from '../../design-system/ds';
import type { CalculatorInputsState, FunnelMixLevel, PackId, PackKpis } from '../types';
import type { MixWeights } from '../utils/calculations';
import { calcMix, calcPyg, calcPygMix } from '../utils/calculations';
import { fmtCurrency, fmtPercent, fmtRoasMult } from '../utils/formatters';

const MIX_LEVEL_LABEL: Record<FunnelMixLevel, string> = {
  gen: 'Generado',
  desp: 'Despachado',
  entr: 'Entregado',
};

type Props = {
  inputs: CalculatorInputsState;
  packKpis: [PackKpis, PackKpis, PackKpis];
  mixFunnelLevel: FunnelMixLevel;
};

export function PygStatement(props: Props) {
  const [packId, setPackId] = useState<PackId>(1);
  const [pedA, setPedA] = useState(100);
  const [pedB, setPedB] = useState(1000);

  const pack = useMemo(() => props.inputs.packs.find((p) => p.id === packId)!, [props.inputs.packs, packId]);
  const kpi = useMemo(() => props.packKpis.find((k) => k.packId === packId)!, [props.packKpis, packId]);

  const pyg = useMemo(
    () => calcPyg(pedA, pedB, pack, props.inputs, kpi.cpaGenMeta),
    [pedA, pedB, pack, props.inputs, kpi.cpaGenMeta],
  );

  /** Misma operativa del pack; ads con CPA Objetivo ponderado de la mezcla al nivel de embudo seleccionado (Calculadora de mezcla). */
  const mixAtLevel = useMemo(
    () => calcMix(props.inputs.mixPct, props.inputs.packs, props.packKpis, props.mixFunnelLevel),
    [props.inputs.mixPct, props.inputs.packs, props.packKpis, props.mixFunnelLevel],
  );

  const mixWeights: MixWeights = useMemo(() => {
    if (mixAtLevel.sumaPct > 0) return mixAtLevel.weights;
    return [1 / 3, 1 / 3, 1 / 3];
  }, [mixAtLevel.sumaPct, mixAtLevel.weights]);

  const pygMix = useMemo(
    () => calcPygMix(pedA, pedB, props.inputs, props.inputs.packs, mixWeights, mixAtLevel.cpaPonderado),
    [pedA, pedB, props.inputs, mixWeights, mixAtLevel.cpaPonderado],
  );

  const cpaLabel = kpi.cpaGenMeta > 0 ? fmtCurrency(kpi.cpaGenMeta, props.inputs.currency) : '—';
  const cpaMixLabel = mixAtLevel.cpaPonderado > 0 ? fmtCurrency(mixAtLevel.cpaPonderado, props.inputs.currency) : '—';
  const mixHasPct = mixAtLevel.sumaPct > 0;
  const mixLevelName = MIX_LEVEL_LABEL[props.mixFunnelLevel];

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
              const padLeft = row.subSub ? 26 : row.sub ? 18 : 6;
              return (
                <tr key={`${row.concepto}-${idx}`}>
                  <td
                    style={{
                      padding: '8px 6px',
                      paddingLeft: padLeft,
                      fontSize: row.subSub ? 11 : row.sub ? 12 : 13,
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

      <div
        style={{
          marginTop: 16,
          padding: '14px 14px',
          borderRadius: 12,
          border: `1px solid ${ds.borderCard}`,
          background: 'var(--color-bg-subtle)',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-text-primary)', marginBottom: 6 }}>
          PyG con mezcla de packs
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 12, lineHeight: 1.45 }}>
          Mismos pedidos y embudo que arriba. <strong style={{ color: 'var(--color-text-secondary)' }}>Ventas y costo de producto</strong> usan{' '}
          <strong style={{ color: 'var(--color-text-secondary)' }}>ticket y costo unitario ponderados</strong> según tu mezcla; fletes y admin siguen el modelo global. Ads:{' '}
          <strong style={{ color: 'var(--color-text-secondary)' }}>CPA Objetivo ponderado</strong> ({mixLevelName.toLowerCase()}, ROAS mezcla {fmtRoasMult(mixAtLevel.roasPonderado)}).
        </div>
        {!mixHasPct ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            Indica porcentajes de mezcla mayores a 0. Mientras tanto se usa reparto ⅓ cada pack solo para ilustrar.
          </div>
        ) : null}
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
              {pygMix.rows.map((row, idx) => {
                const fmtCellMix = (v: number | string | null) => {
                  if (v == null) return '—';
                  if (typeof v === 'string') return v;
                  return fmtCurrency(v, props.inputs.currency);
                };
                const neg = row.negative;
                const bg = row.final ? 'var(--color-brand-bg)' : row.total ? 'var(--color-bg-subtle)' : 'transparent';
                const padLeft = row.subSub ? 26 : row.sub ? 18 : 6;
                return (
                  <tr key={`mix-${row.concepto}-${idx}`}>
                    <td
                      style={{
                        padding: '8px 6px',
                        paddingLeft: padLeft,
                        fontSize: row.subSub ? 11 : row.sub ? 12 : 13,
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
                      {fmtCellMix(row.a)}
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
                      {fmtCellMix(row.b)}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td style={{ padding: '10px 6px', fontSize: 12, color: 'var(--color-text-muted)' }}>Margen neto % (mezcla)</td>
                <td style={{ textAlign: 'right', padding: '10px 6px', fontSize: 12, color: 'var(--color-text-muted)' }}>
                  {fmtPercent(pygMix.margenNetoPctA, 1)}
                </td>
                <td style={{ textAlign: 'right', padding: '10px 6px', fontSize: 12, color: 'var(--color-text-muted)' }}>
                  {fmtPercent(pygMix.margenNetoPctB, 1)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--color-text-hint)' }}>
          CPA Objetivo mezcla ({mixLevelName}): {cpaMixLabel} · Ticket promedio mezcla{' '}
          {fmtCurrency(mixAtLevel.ticketPromedio, props.inputs.currency)}
        </div>
      </div>

      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--color-text-hint)' }}>CPA Objetivo generado aplicado: {cpaLabel}</div>
    </div>
  );
}
