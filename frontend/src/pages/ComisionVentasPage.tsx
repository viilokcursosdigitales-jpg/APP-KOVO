import { useMemo, useState } from 'react';
import { ds } from '../design-system/ds';
import { PageHeader } from '../design-system/PageHeader';

type CommissionRole = {
  id: string;
  roleName: string;
  percentInput: string;
};

function parseAmount(raw: string): number {
  const normalized = String(raw || '')
    .replace(/\s+/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const n = Number.parseFloat(normalized);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function parsePercent(raw: string): number {
  const normalized = String(raw || '').replace(',', '.');
  const n = Number.parseFloat(normalized);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function formatMoney(amount: number): string {
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(Number.isFinite(amount) ? amount : 0);
  } catch {
    return `${Math.round(Number.isFinite(amount) ? amount : 0).toLocaleString('es-CO')} COP`;
  }
}

function fmtPercent(value: number): string {
  if (!Number.isFinite(value)) return '0.00%';
  return `${value.toFixed(2)}%`;
}

export default function ComisionVentasPage() {
  const [totalDespachadoInput, setTotalDespachadoInput] = useState('');
  const [roles, setRoles] = useState<CommissionRole[]>([
    { id: 'asesor', roleName: 'Asesor de ventas', percentInput: '5' },
    { id: 'lider', roleName: 'Lider comercial', percentInput: '2' },
  ]);

  const totalDespachado = useMemo(() => parseAmount(totalDespachadoInput), [totalDespachadoInput]);

  const rolesCalculated = useMemo(() => {
    return roles.map((row) => {
      const percent = parsePercent(row.percentInput);
      const gain = totalDespachado * (percent / 100);
      return { ...row, percent, gain };
    });
  }, [roles, totalDespachado]);

  const totalPercent = rolesCalculated.reduce((acc, row) => acc + row.percent, 0);
  const totalComision = rolesCalculated.reduce((acc, row) => acc + row.gain, 0);
  const restante = Math.max(0, totalDespachado - totalComision);
  const overAssigned = totalPercent > 100;

  return (
    <div style={{ width: '100%', maxWidth: 1080, margin: '0 auto' }}>
      <PageHeader
        title="Comisión por Ventas"
        subtitle="Asigna manualmente un porcentaje por rol y calcula la ganancia estimada a partir del total despachado."
      />

      <div
        style={{
          background: ds.bgCard,
          border: `1px solid ${ds.borderCard}`,
          borderRadius: 14,
          padding: 16,
          marginBottom: 14,
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 260 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: ds.textSecondary }}>Total despachado (COP)</span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="Ej: 25000000"
            value={totalDespachadoInput}
            onChange={(e) => setTotalDespachadoInput(e.target.value)}
            style={{
              border: `1px solid ${ds.borderCard}`,
              background: ds.bgApp,
              borderRadius: 8,
              padding: '9px 10px',
              fontSize: 14,
              color: ds.textPrimary,
            }}
          />
        </label>

        <button
          type="button"
          onClick={() => {
            const nextId = `rol_${Date.now()}`;
            setRoles((prev) => [...prev, { id: nextId, roleName: '', percentInput: '0' }]);
          }}
          style={{
            marginTop: 24,
            border: 'none',
            background: ds.brand,
            color: '#fff',
            borderRadius: 8,
            padding: '9px 12px',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          + Agregar rol
        </button>
      </div>

      {overAssigned ? (
        <div
          style={{
            marginBottom: 10,
            padding: '10px 12px',
            borderRadius: 10,
            background: ds.warningBg,
            color: ds.warningText,
            border: `1px solid ${ds.borderCard}`,
            fontSize: 12,
          }}
        >
          El porcentaje total supera el 100%. Ajusta los porcentajes para mantener una distribución valida.
        </div>
      ) : null}

      <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 14, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: ds.bgSubtle }}>
              <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, color: ds.textSecondary }}>Rol</th>
              <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, color: ds.textSecondary }}>% comisión</th>
              <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, color: ds.textSecondary }}>Ganancia</th>
              <th style={{ textAlign: 'center', padding: '10px 12px', fontSize: 12, color: ds.textSecondary }}>Acción</th>
            </tr>
          </thead>
          <tbody>
            {rolesCalculated.map((row) => (
              <tr key={row.id}>
                <td style={{ borderTop: `1px solid ${ds.borderRow}`, padding: '8px 12px' }}>
                  <input
                    type="text"
                    placeholder="Nombre del rol"
                    value={row.roleName}
                    onChange={(e) => {
                      const value = e.target.value;
                      setRoles((prev) => prev.map((it) => (it.id === row.id ? { ...it, roleName: value } : it)));
                    }}
                    style={{ width: '100%', border: `1px solid ${ds.borderCard}`, borderRadius: 8, padding: '8px 10px' }}
                  />
                </td>
                <td style={{ borderTop: `1px solid ${ds.borderRow}`, padding: '8px 12px', textAlign: 'right' }}>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={row.percentInput}
                    onChange={(e) => {
                      const value = e.target.value;
                      setRoles((prev) => prev.map((it) => (it.id === row.id ? { ...it, percentInput: value } : it)));
                    }}
                    style={{ width: 92, border: `1px solid ${ds.borderCard}`, borderRadius: 8, padding: '8px 10px' }}
                  />
                </td>
                <td
                  style={{
                    borderTop: `1px solid ${ds.borderRow}`,
                    padding: '8px 12px',
                    textAlign: 'right',
                    fontWeight: 700,
                    color: ds.textPrimary,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatMoney(row.gain)}
                </td>
                <td style={{ borderTop: `1px solid ${ds.borderRow}`, padding: '8px 12px', textAlign: 'center' }}>
                  <button
                    type="button"
                    onClick={() => setRoles((prev) => prev.filter((it) => it.id !== row.id))}
                    disabled={roles.length <= 1}
                    style={{
                      border: `1px solid ${ds.borderCard}`,
                      background: ds.bgCard,
                      borderRadius: 8,
                      padding: '7px 10px',
                      fontSize: 12,
                      cursor: roles.length <= 1 ? 'not-allowed' : 'pointer',
                      opacity: roles.length <= 1 ? 0.55 : 1,
                    }}
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        style={{
          marginTop: 14,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(180px, 1fr))',
          gap: 10,
        }}
      >
        <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12, color: ds.textMuted, marginBottom: 6 }}>Total % asignado</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: overAssigned ? ds.warningText : ds.textPrimary }}>
            {fmtPercent(totalPercent)}
          </div>
        </div>
        <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12, color: ds.textMuted, marginBottom: 6 }}>Comisión total</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: ds.textPrimary }}>{formatMoney(totalComision)}</div>
        </div>
        <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12, color: ds.textMuted, marginBottom: 6 }}>Restante estimado</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: ds.textPrimary }}>{formatMoney(restante)}</div>
        </div>
      </div>
    </div>
  );
}
