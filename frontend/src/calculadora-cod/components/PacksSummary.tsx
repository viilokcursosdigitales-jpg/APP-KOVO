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

const META_COLS: {
  key: string;
  title: string;
  cpa: (k: PackKpis) => number;
  roas: (k: PackKpis) => number | null;
}[] = [
  { key: 'gen', title: 'Generado', cpa: (k) => k.cpaGenMeta, roas: (k) => k.roasGenMeta },
  { key: 'desp', title: 'Despachado', cpa: (k) => k.cpaDespMeta, roas: (k) => k.roasDespMeta },
  { key: 'entr', title: 'Entregado', cpa: (k) => k.cpaEntrMeta, roas: (k) => k.roasEntrMeta },
];

function PackCard(props: {
  k: PackKpis;
  currency: CurrencyCode;
  isBest: boolean;
}) {
  const { k, currency, isBest } = props;
  const h = packHealth(k.margen);
  const gainColor = k.gananciaBruta >= 0 ? 'var(--color-success-text)' : 'var(--color-danger-text)';

  return (
    <div
      style={{
        background: 'var(--color-bg-card)',
        border: isBest ? '2px solid var(--color-brand)' : `1px solid ${ds.borderCard}`,
        borderRadius: 16,
        padding: '14px 14px 16px',
        boxShadow: isBest ? '0 0 0 6px var(--color-brand-bg)' : undefined,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
        <div
          style={{
            fontSize: 16,
            fontWeight: 800,
            color: 'var(--color-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {k.label}
        </div>
        {isBest ? badge('⭐ Mejor', 'brand') : badge(healthLabel(h), h)}
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          gap: '10px 16px',
          rowGap: 8,
          marginBottom: 12,
          paddingBottom: 12,
          borderBottom: `1px solid ${ds.borderRow}`,
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          <span style={{ color: 'var(--color-text-hint)', fontWeight: 600 }}>Precio </span>
          <strong style={{ color: 'var(--color-text-primary)' }}>{fmtCurrency(k.precio, currency)}</strong>
        </span>
        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          <span style={{ color: 'var(--color-text-hint)', fontWeight: 600 }}>Uds. </span>
          <strong style={{ color: 'var(--color-text-primary)' }}>{k.unidades}</strong>
        </span>
        <span style={{ fontSize: 12 }}>
          <span style={{ color: 'var(--color-text-hint)', fontWeight: 600 }}>Ganancia bruta </span>
          <strong style={{ color: gainColor }}>{fmtCurrency(k.gananciaBruta, currency)}</strong>
        </span>
        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          <span style={{ color: 'var(--color-text-hint)', fontWeight: 600 }}>Margen </span>
          <strong
            style={{
              color: h === 'success' ? 'var(--color-success-text)' : h === 'warning' ? 'var(--color-warning-text)' : 'var(--color-danger-text)',
            }}
          >
            {fmtPercent(k.margen, 1)}
          </strong>
        </span>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          <span style={{ color: 'var(--color-text-hint)', fontWeight: 600 }}>Ef. env·ent·tot </span>
          {fmtPercent(k.efEnvios * 100, 0)} · {fmtPercent(k.efEntrega * 100, 0)} · {fmtPercent(k.efTotal * 100, 0)}
        </span>
      </div>

      <div style={{ fontSize: 10, color: 'var(--color-text-hint)', marginBottom: 10, lineHeight: 1.4 }}>
        ROAS equilibrio · <span style={{ color: 'var(--color-text-muted)' }}>gen</span> {fmtRoasMult(k.roasGenEq)} ·{' '}
        <span style={{ color: 'var(--color-text-muted)' }}>desp</span> {fmtRoasMult(k.roasDespEq)} ·{' '}
        <span style={{ color: 'var(--color-text-muted)' }}>entr</span> {fmtRoasMult(k.roasEntrEq)}
      </div>

      <div
        style={{
          borderRadius: 14,
          border: '2px solid var(--color-brand)',
          background: 'var(--color-brand-bg)',
          padding: '12px 10px 14px',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 900,
            letterSpacing: '0.08em',
            color: 'var(--color-brand)',
            textAlign: 'center',
            marginBottom: 10,
          }}
        >
          CPA META · ROAS META
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 8,
            alignItems: 'stretch',
          }}
        >
          {META_COLS.map((col) => {
            const cpa = col.cpa(k);
            const roas = col.roas(k);
            return (
              <div
                key={col.key}
                style={{
                  textAlign: 'center',
                  padding: '8px 6px',
                  borderRadius: 10,
                  background: 'var(--color-bg-card)',
                  border: `1px solid ${ds.brandPale}`,
                  minWidth: 0,
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--color-brand)', marginBottom: 6 }}>{col.title}</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-hint)', marginBottom: 2 }}>CPA</div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 900,
                    color: 'var(--color-brand)',
                    lineHeight: 1.15,
                    wordBreak: 'break-word',
                  }}
                >
                  {cpa > 0 ? fmtCurrency(cpa, currency) : '—'}
                </div>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-hint)', marginTop: 6, marginBottom: 2 }}>ROAS</div>
                <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--color-brand)' }}>{fmtRoasMult(roas)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function PacksSummary(props: Props) {
  const { currency, inputs, packKpis, bestPackId } = props;
  const k0 = packKpis[0];
  const nGen = 100;
  const nDesp = Math.round(nGen * k0.efEnvios);
  const nEnt = Math.round(nGen * k0.efTotal);

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
          100 generados → {nDesp} despachados → {nEnt} entregados
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-hint)', marginBottom: 14 }}>
        Embudo actual: {fmtPercent(inputs.canceladosPct, 0)} cancelados · {fmtPercent(inputs.devueltosPct, 0)} devueltos del despachado
      </div>

      <div
        className="calc-cod-pack-cards"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 'var(--grid-gap)',
          alignItems: 'stretch',
        }}
      >
        {packKpis.map((k) => (
          <PackCard key={k.packId} k={k} currency={currency} isBest={k.packId === bestPackId} />
        ))}
      </div>

      <style>{`
        @media (max-width: 900px) {
          .calc-cod-pack-cards {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
