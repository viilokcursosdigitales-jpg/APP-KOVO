import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';

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
  view_scope?: 'full' | 'self';
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

function formatUpdatedAt(d: Date | null): string {
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d);
  } catch {
    return d.toLocaleString('es-CO');
  }
}

export default function ComisionVentasPage() {
  const [period, setPeriod] = useState<'hoy' | '7d' | '30d' | 'mes'>('30d');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [canEditPercent, setCanEditPercent] = useState(false);
  const [rows, setRows] = useState<CommissionRoleRow[]>([]);
  const [memberRows, setMemberRows] = useState<CommissionMemberRow[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

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
      setLastUpdatedAt(new Date());
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

  const roleRowBySlug = useMemo(() => {
    const m = new Map<string, CommissionRoleRow>();
    for (const r of rows) m.set(String(r.role_slug), r);
    return m;
  }, [rows]);

  const onPercentChange = (roleSlug: string, value: string) => {
    if (!canEditPercent) return;
    const pct = parsePercentInput(value);
    setRows((prev) =>
      prev.map((row) => {
        if (row.role_slug !== roleSlug || !row.editable) return row;
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
      <header style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: 12,
            color: ds.textMuted,
            marginBottom: 8,
          }}
        >
          Actualizado: {loading ? '…' : formatUpdatedAt(lastUpdatedAt)}
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 700,
            color: ds.textPrimary,
            lineHeight: 1.2,
          }}
        >
          Comisión por venta
        </h1>
      </header>

      <div
        style={{
          marginBottom: 14,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: ds.textSecondary }}>
          Periodo
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as 'hoy' | '7d' | '30d' | 'mes')}
            style={{
              border: `1px solid ${ds.borderCard}`,
              background: ds.bgCard,
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 13,
              color: ds.textPrimary,
            }}
          >
            <option value="hoy">Hoy</option>
            <option value="7d">Últimos 7 días</option>
            <option value="30d">Últimos 30 días</option>
            <option value="mes">Mes actual</option>
          </select>
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
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
              color: ds.textPrimary,
            }}
          >
            Actualizar
          </button>
          {canEditPercent ? (
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || loading}
              style={{
                border: 'none',
                background: ds.brand,
                color: '#fff',
                borderRadius: 8,
                padding: '8px 12px',
                fontSize: 12,
                fontWeight: 700,
                cursor: saving || loading ? 'not-allowed' : 'pointer',
                opacity: saving || loading ? 0.6 : 1,
              }}
            >
              {saving ? 'Guardando…' : 'Guardar %'}
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div
          style={{
            marginBottom: 12,
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

      <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 14, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: ds.bgSubtle }}>
              <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, color: ds.textSecondary }}>
                Nombre del miembro
              </th>
              <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, color: ds.textSecondary }}>Rol</th>
              <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, color: ds.textSecondary }}>
                Pedidos despachados
              </th>
              <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, color: ds.textSecondary }}>
                Ventas despachadas
              </th>
              <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, color: ds.textSecondary }}>
                % de comisión
              </th>
              <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, color: ds.textSecondary }}>
                Comisión total
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ padding: '12px', color: ds.textMuted, fontSize: 12 }}>
                  Cargando…
                </td>
              </tr>
            ) : memberRows.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '12px', color: ds.textMuted, fontSize: 12 }}>
                  No hay datos para mostrar.
                </td>
              </tr>
            ) : (
              memberRows.map((m) => {
                const slug = String(m.role_slug || 'sin_asignar');
                const roleMeta = roleRowBySlug.get(slug);
                const pct = Number(roleMeta?.commission_percent ?? 0);
                const ventas = Number(m.ventas_despachadas_total || 0);
                const comisionTotal = ventas * (pct / 100);
                const editable = Boolean(canEditPercent && roleMeta?.editable);
                return (
                  <tr key={m.member_id != null ? String(m.member_id) : `${m.member_name}-${m.role_slug}`}>
                    <td style={{ borderTop: `1px solid ${ds.borderRow}`, padding: '8px 12px' }}>
                      <div style={{ color: ds.textPrimary, fontWeight: 600 }}>{m.member_name || 'Miembro'}</div>
                    </td>
                    <td style={{ borderTop: `1px solid ${ds.borderRow}`, padding: '8px 12px', color: ds.textPrimary }}>
                      {m.role_label || m.role_slug}
                    </td>
                    <td
                      style={{
                        borderTop: `1px solid ${ds.borderRow}`,
                        padding: '8px 12px',
                        textAlign: 'right',
                        color: ds.textPrimary,
                      }}
                    >
                      {Number(m.pedidos_despachados || 0).toLocaleString('es-CO')}
                    </td>
                    <td style={{ borderTop: `1px solid ${ds.borderRow}`, padding: '8px 12px', textAlign: 'right' }}>
                      <strong style={{ color: ds.textPrimary }}>{formatMoney(ventas)}</strong>
                    </td>
                    <td style={{ borderTop: `1px solid ${ds.borderRow}`, padding: '8px 12px', textAlign: 'right' }}>
                      {editable ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          value={String(pct)}
                          onChange={(e) => onPercentChange(slug, e.target.value)}
                          disabled={saving}
                          style={{
                            width: 88,
                            border: `1px solid ${ds.borderCard}`,
                            borderRadius: 8,
                            padding: '6px 8px',
                            fontSize: 12,
                            textAlign: 'right',
                          }}
                        />
                      ) : (
                        <span style={{ color: ds.textPrimary }}>{formatPercent(pct)}</span>
                      )}
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
                      {formatMoney(comisionTotal)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
