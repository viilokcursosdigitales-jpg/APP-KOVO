import { useMemo, useState } from 'react';
import { ds } from '../../design-system/ds';
import type { CalculatorInputsState, FunnelMixLevel, PackKpis } from '../types';
import { calcMix } from '../utils/calculations';
import { fmtCurrency, fmtPercent, fmtRoasMult } from '../utils/formatters';

type Props = {
  inputs: CalculatorInputsState;
  packKpis: [PackKpis, PackKpis, PackKpis];
  onMixChange: (idx: 0 | 1 | 2, v: number) => void;
};

const LEVELS: { id: FunnelMixLevel; label: string }[] = [
  { id: 'gen', label: 'Generado' },
  { id: 'desp', label: 'Despachado' },
  { id: 'entr', label: 'Entregado' },
];

export function MixCalculator(props: Props) {
  const { inputs, packKpis } = props;
  const [level, setLevel] = useState<FunnelMixLevel>('gen');

  const mixResult = useMemo(
    () => calcMix(inputs.mixPct, inputs.packs, packKpis, level),
    [inputs.mixPct, inputs.packs, packKpis, level],
  );

  const sumOk = Math.abs(mixResult.sumaPct - 100) < 0.5;

  const projection = useMemo(() => {
    const efTot = packKpis[0].efTotal;
    const targetEnt = 100;
    const nGen = efTot > 0 ? targetEnt / efTot : 0;
    const w =
      mixResult.sumaPct > 0
        ? mixResult.weights
        : ([1 / 3, 1 / 3, 1 / 3] as [number, number, number]);
    const rows = packKpis.map((k, i) => {
      const pedidosGen = nGen * w[i];
      const entregados = pedidosGen * efTot;
      const ventas = entregados * k.precio;
      const ganancia = pedidosGen * k.gananciaBruta;
      return {
        label: k.label,
        pct: inputs.mixPct[i],
        pedidosGen,
        entregados,
        ventas,
        ganancia,
      };
    });
    const totPedGen = rows.reduce((a, r) => a + r.pedidosGen, 0);
    const totEnt = rows.reduce((a, r) => a + r.entregados, 0);
    const totVentas = rows.reduce((a, r) => a + r.ventas, 0);
    const totGan = rows.reduce((a, r) => a + r.ganancia, 0);
    return { rows, totPedGen, totEnt, totVentas, totGan };
  }, [inputs.mixPct, mixResult, packKpis]);

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
        Calculadora de mezcla
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-hint)', marginBottom: 6 }}>Nivel embudo (CPA·ROAS meta)</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {LEVELS.map((lv) => {
            const active = level === lv.id;
            return (
              <button
                key={lv.id}
                type="button"
                onClick={() => setLevel(lv.id)}
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
                {lv.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        style={{
          background: 'var(--color-bg-subtle)',
          border: `1px solid ${ds.borderCard}`,
          borderRadius: 12,
          padding: '14px 14px 10px',
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-secondary)' }}>Mezcla de packs</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '4px 10px',
              borderRadius: 999,
              background: sumOk ? 'var(--color-success-bg)' : 'var(--color-warning-bg)',
              color: sumOk ? 'var(--color-success-text)' : 'var(--color-warning-text)',
            }}
          >
            Suma {fmtPercent(mixResult.sumaPct, 1)} {sumOk ? '· OK' : '· Ajusta a 100%'}
          </span>
        </div>
        {inputs.packs.map((p, idx) => {
          const i = idx as 0 | 1 | 2;
          return (
            <div key={p.id} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-text-primary)' }}>{p.label}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-secondary)' }}>{fmtPercent(inputs.mixPct[i], 1)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={inputs.mixPct[i]}
                onChange={(e) => props.onMixChange(i, Number.parseFloat(e.target.value) || 0)}
                style={{ width: '100%' }}
              />
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 'var(--grid-gap)',
          marginBottom: 16,
        }}
        className="calc-cod-mix-strat"
      >
        <div
          style={{
            background: 'var(--color-bg-subtle)',
            border: `1px solid ${ds.borderCard}`,
            borderRadius: 14,
            padding: '14px 14px',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--color-text-secondary)', marginBottom: 8 }}>Conservador</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--color-text-primary)' }}>
            {fmtCurrency(mixResult.cpaConservador, inputs.currency)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>CPA meta ({LEVELS.find((l) => l.id === level)?.label})</div>
          <div style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: 'var(--color-text-secondary)' }}>
            ROAS {fmtRoasMult(mixResult.roasConservador)}
          </div>
        </div>

        <div
          style={{
            background: 'var(--color-brand-bg)',
            border: '2px solid var(--color-brand)',
            borderRadius: 14,
            padding: '14px 14px',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--color-brand)', marginBottom: 8 }}>Ponderado · ⭐ Recomendado</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--color-brand)' }}>{fmtCurrency(mixResult.cpaPonderado, inputs.currency)}</div>
          <div style={{ fontSize: 11, color: 'var(--color-brand)', marginTop: 4, opacity: 0.85 }}>CPA meta</div>
          <div style={{ marginTop: 8, fontSize: 13, fontWeight: 800, color: 'var(--color-brand)' }}>ROAS {fmtRoasMult(mixResult.roasPonderado)}</div>
          <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: 'var(--color-brand)' }}>
            Ticket promedio {fmtCurrency(mixResult.ticketPromedio, inputs.currency)}
          </div>
        </div>

        <div
          style={{
            background: 'var(--color-bg-subtle)',
            border: `1px solid ${ds.borderCard}`,
            borderRadius: 14,
            padding: '14px 14px',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--color-text-secondary)', marginBottom: 8 }}>Agresivo</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--color-text-primary)' }}>
            {fmtCurrency(mixResult.cpaAgresivo, inputs.currency)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>CPA meta ({LEVELS.find((l) => l.id === level)?.label})</div>
          <div style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: 'var(--color-text-secondary)' }}>
            ROAS {fmtRoasMult(mixResult.roasAgresivo)}
          </div>
        </div>
      </div>

      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
        Proyección con mezcla actual · 100 entregados (ef. total {fmtPercent(packKpis[0].efTotal * 100, 0)})
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
          <thead>
            <tr>
              {['Pack', '% mezcla', 'Pedidos gen.', 'Entregados', 'Ventas', 'Ganancia bruta'].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: h === 'Pack' ? 'left' : 'right',
                    fontSize: 11,
                    color: 'var(--color-text-hint)',
                    padding: '8px 6px',
                    borderBottom: `1px solid ${ds.borderCard}`,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {projection.rows.map((r) => (
              <tr key={r.label}>
                <td style={{ padding: '8px 6px', fontSize: 12, fontWeight: 700, color: 'var(--color-text-secondary)' }}>{r.label}</td>
                <td style={{ textAlign: 'right', padding: '8px 6px', fontSize: 13, color: 'var(--color-text-secondary)' }}>
                  {fmtPercent(r.pct, 1)}
                </td>
                <td style={{ textAlign: 'right', padding: '8px 6px', fontSize: 13, color: 'var(--color-text-secondary)' }}>
                  {Math.round(r.pedidosGen)}
                </td>
                <td style={{ textAlign: 'right', padding: '8px 6px', fontSize: 13, color: 'var(--color-text-secondary)' }}>
                  {Math.round(r.entregados)}
                </td>
                <td style={{ textAlign: 'right', padding: '8px 6px', fontSize: 13, color: 'var(--color-text-secondary)' }}>
                  {fmtCurrency(r.ventas, inputs.currency)}
                </td>
                <td style={{ textAlign: 'right', padding: '8px 6px', fontSize: 13, fontWeight: 700, color: 'var(--color-text-secondary)' }}>
                  {fmtCurrency(r.ganancia, inputs.currency)}
                </td>
              </tr>
            ))}
            <tr>
              <td
                colSpan={2}
                style={{
                  padding: '10px 6px',
                  fontSize: 12,
                  fontWeight: 800,
                  color: 'var(--color-brand)',
                  background: 'var(--color-brand-bg)',
                }}
              >
                Total
              </td>
              <td
                style={{
                  textAlign: 'right',
                  padding: '10px 6px',
                  fontSize: 13,
                  fontWeight: 800,
                  color: 'var(--color-brand)',
                  background: 'var(--color-brand-bg)',
                }}
              >
                {Math.round(projection.totPedGen)}
              </td>
              <td
                style={{
                  textAlign: 'right',
                  padding: '10px 6px',
                  fontSize: 13,
                  fontWeight: 800,
                  color: 'var(--color-brand)',
                  background: 'var(--color-brand-bg)',
                }}
              >
                {Math.round(projection.totEnt)}
              </td>
              <td
                style={{
                  textAlign: 'right',
                  padding: '10px 6px',
                  fontSize: 13,
                  fontWeight: 800,
                  color: 'var(--color-brand)',
                  background: 'var(--color-brand-bg)',
                }}
              >
                {fmtCurrency(projection.totVentas, inputs.currency)}
              </td>
              <td
                style={{
                  textAlign: 'right',
                  padding: '10px 6px',
                  fontSize: 13,
                  fontWeight: 800,
                  color: 'var(--color-brand)',
                  background: 'var(--color-brand-bg)',
                }}
              >
                {fmtCurrency(projection.totGan, inputs.currency)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <style>{`
        @media (max-width: 900px) {
          .calc-cod-mix-strat {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
