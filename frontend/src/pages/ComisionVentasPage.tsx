import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';
import { PageHeader } from '../design-system/PageHeader';

type CommissionRoleRow = {
  role_slug: string;
  role_label: string;
  ventas_despachadas_total: number;
  commission_percent: number;
  gain: number;
  editable: boolean;
};

type CommissionMemberRow = {
  member_id: number | null;
  member_name: string;
  member_email: string;
  role_slug: string;
  role_label: string;
  pedidos_despachados: number;
  ventas_despachadas_total: number;
};

type CommissionPayload = {
  can_edit_percent?: boolean;
  period_applied?: string;
  rows?: CommissionRoleRow[];
  member_rows?: CommissionMemberRow[];
  totals?: {
    ventas_despachadas_total?: number;
    commission_percent_total?: number;
    gain_total?: number;
  };
  error?: string;
};

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

function parsePercentInput(value: string): number {
  const n = Number.parseFloat(String(value || '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0.00%';
  return `${value.toFixed(2)}%`;
}

export default function ComisionVentasPage() {
  const [period, setPeriod] = useState<'hoy' | '7d' | '30d' | 'mes'>('30d');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [canEditPercent, setCanEditPercent] = useState(false);
  const [rows, setRows] = useState<CommissionRoleRow[]>([]);
  const [memberRows, setMemberRows] = useState<CommissionMemberRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`/api/comision-ventas/roles?period=${encodeURIComponent(period)}`);
      const data = (await res.json().catch(() => ({}))) as CommissionPayload;
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'No se pudo cargar la comisión por ventas');
        setRows([]);
        setMemberRows([]);
        setCanEditPercent(false);
        return;
      }
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setMemberRows(Array.isArray(data.member_rows) ? data.member_rows : []);
      setCanEditPercent(Boolean(data.can_edit_percent));
    } catch {
      setError('Error de red al cargar comisión por ventas');
      setRows([]);
      setMemberRows([]);
      setCanEditPercent(false);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load, period]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.ventas += Number(row.ventas_despachadas_total || 0);
        acc.percent += Number(row.commission_percent || 0);
        acc.gain += Number(row.gain || 0);
        return acc;
      },
      { ventas: 0, percent: 0, gain: 0 },
    );
  }, [rows]);

  const remaining = Math.max(0, totals.ventas - totals.gain);
  const overAssigned = totals.percent > 100;

  const onPercentChange = (roleSlug: string, value: string) => {
    if (!canEditPercent) return;
    setRows((prev) =>
      prev.map((row) => {
        if (row.role_slug !== roleSlug || !row.editable) return row;
        const pct = parsePercentInput(value);
        const gain = Number(row.ventas_despachadas_total || 0) * (pct / 100);
        return { ...row, commission_percent: pct, gain };
      }),
    );
  };

  const save = useCallback(async () => {
    if (!canEditPercent) return;
    setSaving(true);
    setError('');
    try {
      const entries = rows
        .filter((r) => r.editable)
        .map((r) => ({
          role_slug: r.role_slug,
          commission_percent: parsePercentInput(String(r.commission_percent)),
        }));
      const res = await apiFetch('/api/comision-ventas/roles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'No se pudieron guardar los porcentajes');
        return;
      }
      await load();
    } catch {
      setError('Error de red al guardar porcentajes');
    } finally {
      setSaving(false);
    }
  }, [canEditPercent, rows, load]);

  return (
    <div style={{ width: '100%', maxWidth: 1080, margin: '0 auto' }}>
      <PageHeader
        title="Comisión por Ventas"
        subtitle="El total de ventas despachadas se toma automáticamente desde Pedidos (estado despachado), con filtro por fecha."
      />

      <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'flex-end' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: ds.textSecondary }}>
          Periodo
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as 'hoy' | '7d' | '30d' | 'mes')}
            style={{
              border: `1px solid ${ds.borderCard}`,
              background: ds.bgCard,
              borderRadius: 8,
              padding: '6px 9px',
              fontSize: 12,
              color: ds.textPrimary,
            }}
          >
            <option value="hoy">Hoy</option>
            <option value="7d">Ultimos 7 dias</option>
            <option value="30d">Ultimos 30 dias</option>
            <option value="mes">Mes actual</option>
          </select>
        </label>
      </div>

      {!canEditPercent ? (
        <div
          style={{
            marginBottom: 10,
            padding: '10px 12px',
            borderRadius: 10,
            background: ds.bgSubtle,
            color: ds.textSecondary,
            border: `1px solid ${ds.borderCard}`,
            fontSize: 12,
          }}
        >
          Solo el propietario puede modificar el porcentaje de ventas asignado.
        </div>
      ) : null}

      {error ? (
        <div
          style={{
            marginBottom: 10,
            padding: '10px 12px',
            borderRadius: 10,
            background: ds.dangerBg,
            color: ds.dangerText,
            border: `1px solid ${ds.borderCard}`,
            fontSize: 12,
          }}
        >
          {error}
        </div>
      ) : null}

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
              <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, color: ds.textSecondary }}>
                Ventas despachadas
              </th>
              <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, color: ds.textSecondary }}>
                % ventas asignadas
              </th>
              <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, color: ds.textSecondary }}>Ganancia</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} style={{ padding: '12px', color: ds.textMuted, fontSize: 12 }}>
                  Cargando...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: '12px', color: ds.textMuted, fontSize: 12 }}>
                  No hay datos de roles.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
              <tr key={row.role_slug}>
                <td style={{ borderTop: `1px solid ${ds.borderRow}`, padding: '8px 12px', color: ds.textPrimary }}>
                  {row.role_label}
                </td>
                <td style={{ borderTop: `1px solid ${ds.borderRow}`, padding: '8px 12px', textAlign: 'right' }}>
                  <strong style={{ color: ds.textPrimary }}>{formatMoney(row.ventas_despachadas_total)}</strong>
                </td>
                <td style={{ borderTop: `1px solid ${ds.borderRow}`, padding: '8px 12px', textAlign: 'right' }}>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={String(Number(row.commission_percent || 0))}
                    onChange={(e) => onPercentChange(row.role_slug, e.target.value)}
                    disabled={!canEditPercent || !row.editable || saving}
                    style={{
                      width: 92,
                      border: `1px solid ${ds.borderCard}`,
                      borderRadius: 8,
                      padding: '8px 10px',
                      opacity: !canEditPercent || !row.editable ? 0.65 : 1,
                    }}
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
              </tr>
            ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || saving}
          style={{
            border: `1px solid ${ds.borderCard}`,
            background: ds.bgCard,
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 12,
            fontWeight: 600,
            cursor: loading || saving ? 'not-allowed' : 'pointer',
          }}
        >
          Actualizar
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canEditPercent || saving || loading}
          style={{
            border: 'none',
            background: ds.brand,
            color: '#fff',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 12,
            fontWeight: 700,
            cursor: !canEditPercent || saving || loading ? 'not-allowed' : 'pointer',
            opacity: !canEditPercent || saving || loading ? 0.6 : 1,
          }}
        >
          {saving ? 'Guardando...' : 'Guardar porcentajes'}
        </button>
      </div>

      <div
        style={{
          marginTop: 14,
          background: ds.bgCard,
          border: `1px solid ${ds.borderCard}`,
          borderRadius: 14,
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '10px 12px', borderBottom: `1px solid ${ds.borderRow}` }}>
          <strong style={{ color: ds.textPrimary, fontSize: 13 }}>Detalle por miembro</strong>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: ds.bgSubtle }}>
              <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, color: ds.textSecondary }}>Miembro</th>
              <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, color: ds.textSecondary }}>Rol</th>
              <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, color: ds.textSecondary }}>Pedidos despachados</th>
              <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, color: ds.textSecondary }}>Ventas despachadas</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} style={{ padding: '12px', color: ds.textMuted, fontSize: 12 }}>
                  Cargando...
                </td>
              </tr>
            ) : memberRows.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: '12px', color: ds.textMuted, fontSize: 12 }}>
                  No hay miembros para mostrar.
                </td>
              </tr>
            ) : (
              memberRows.map((m) => (
                <tr key={m.member_id != null ? String(m.member_id) : `${m.member_name}-${m.role_slug}`}>
                  <td style={{ borderTop: `1px solid ${ds.borderRow}`, padding: '8px 12px' }}>
                    <div style={{ color: ds.textPrimary, fontWeight: 600 }}>{m.member_name || 'Miembro'}</div>
                    {m.member_email ? <div style={{ color: ds.textMuted, fontSize: 11 }}>{m.member_email}</div> : null}
                  </td>
                  <td style={{ borderTop: `1px solid ${ds.borderRow}`, padding: '8px 12px', color: ds.textPrimary }}>
                    {m.role_label || m.role_slug}
                  </td>
                  <td style={{ borderTop: `1px solid ${ds.borderRow}`, padding: '8px 12px', textAlign: 'right', color: ds.textPrimary }}>
                    {Number(m.pedidos_despachados || 0).toLocaleString('es-CO')}
                  </td>
                  <td style={{ borderTop: `1px solid ${ds.borderRow}`, padding: '8px 12px', textAlign: 'right' }}>
                    <strong style={{ color: ds.textPrimary }}>{formatMoney(m.ventas_despachadas_total)}</strong>
                  </td>
                </tr>
              ))
            )}
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
          <div style={{ fontSize: 12, color: ds.textMuted, marginBottom: 6 }}>Total ventas despachadas</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: ds.textPrimary }}>{formatMoney(totals.ventas)}</div>
        </div>
        <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12, color: ds.textMuted, marginBottom: 6 }}>Total % asignado</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: overAssigned ? ds.warningText : ds.textPrimary }}>
            {formatPercent(totals.percent)}
          </div>
        </div>
        <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12, color: ds.textMuted, marginBottom: 6 }}>Comisión total</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: ds.textPrimary }}>{formatMoney(totals.gain)}</div>
        </div>
      </div>
      <p style={{ marginTop: 10, fontSize: 12, color: ds.textMuted }}>
        Restante estimado después de comisión: <strong style={{ color: ds.textPrimary }}>{formatMoney(remaining)}</strong>
      </p>
    </div>
  );
}
