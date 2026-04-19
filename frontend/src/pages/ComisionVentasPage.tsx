import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch, apiUrl, getStoredToken } from '../auth/api';
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

type CommissionCutRow = {
  id: number;
  cut_number?: number;
  period_start: string;
  period_end: string;
  cut_kind: string;
  period_label: string;
  commission_total: number;
  ventas_despachadas_total: number;
  payment_status: string;
  paid_at: string | null;
  updated_at: string | null;
  has_payment_proof?: boolean;
};

type CommissionCutsPayload = {
  as_of?: string;
  cuts?: CommissionCutRow[];
  can_edit_payment?: boolean;
  accumulated?: {
    commission_total: number;
    paid_total: number;
    pending_total: number;
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

function localTodayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  const [cuts, setCuts] = useState<CommissionCutRow[]>([]);
  const [accumulated, setAccumulated] = useState<CommissionCutsPayload['accumulated'] | null>(null);
  const [cutsLoading, setCutsLoading] = useState(false);
  const [cutsError, setCutsError] = useState('');
  const [patchingCutId, setPatchingCutId] = useState<number | null>(null);
  const [canEditCutPayment, setCanEditCutPayment] = useState(false);
  const [cutsAsOf, setCutsAsOf] = useState(localTodayYmd);
  const [cutsAsOfApplied, setCutsAsOfApplied] = useState(localTodayYmd);
  const [payModalCut, setPayModalCut] = useState<CommissionCutRow | null>(null);
  const [payProofDataUrl, setPayProofDataUrl] = useState<string | null>(null);
  const [payProofErr, setPayProofErr] = useState('');
  const [proofView, setProofView] = useState<{ title: string; url: string } | null>(null);

  const loadCuts = useCallback(async (asOfOverride?: string) => {
    const asOf = String(asOfOverride ?? cutsAsOf).trim() || localTodayYmd();
    setCutsLoading(true);
    setCutsError('');
    try {
      const res = await apiFetch(`/api/comision-ventas/cuts?as_of=${encodeURIComponent(asOf)}`);
      const data = (await res.json().catch(() => ({}))) as CommissionCutsPayload;
      if (!res.ok) {
        setCutsError(typeof data.error === 'string' ? data.error : 'No se pudieron cargar los cortes de pago');
        setCuts([]);
        setAccumulated(null);
        setCanEditCutPayment(false);
        return;
      }
      setCuts(Array.isArray(data.cuts) ? data.cuts : []);
      setCanEditCutPayment(Boolean(data.can_edit_payment));
      setCutsAsOfApplied(typeof data.as_of === 'string' && data.as_of ? data.as_of : asOf);
      setAccumulated(
        data.accumulated && typeof data.accumulated === 'object'
          ? {
              commission_total: Number(data.accumulated.commission_total) || 0,
              paid_total: Number(data.accumulated.paid_total) || 0,
              pending_total: Number(data.accumulated.pending_total) || 0,
            }
          : { commission_total: 0, paid_total: 0, pending_total: 0 },
      );
    } catch {
      setCutsError('Error de red al cargar cortes de pago');
      setCuts([]);
      setAccumulated(null);
      setCanEditCutPayment(false);
    } finally {
      setCutsLoading(false);
    }
  }, [cutsAsOf]);

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
        setCuts([]);
        setAccumulated(null);
        setCanEditCutPayment(false);
        return;
      }
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setMemberRows(Array.isArray(data.member_rows) ? data.member_rows : []);
      setCanEditPercent(Boolean(data.can_edit_percent));
      setLastUpdatedAt(new Date());
      await loadCuts();
    } catch {
      setError('Error de red al cargar comisión por ventas');
      setRows([]);
      setMemberRows([]);
      setCanEditPercent(false);
      setCuts([]);
      setAccumulated(null);
      setCanEditCutPayment(false);
    } finally {
      setLoading(false);
    }
  }, [period, loadCuts]);

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

  const setCutPaymentStatus = useCallback(
    async (cutId: number, payment_status: 'pending') => {
      setPatchingCutId(cutId);
      setCutsError('');
      try {
        const res = await apiFetch(`/api/comision-ventas/cuts/${cutId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payment_status }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setCutsError(typeof data.error === 'string' ? data.error : 'No se pudo actualizar el estado');
          return;
        }
        await loadCuts();
      } catch {
        setCutsError('Error de red al actualizar el estado de pago');
      } finally {
        setPatchingCutId(null);
      }
    },
    [loadCuts],
  );

  const markCutPaidWithProof = useCallback(
    async (cutId: number, proofImageBase64: string) => {
      setPatchingCutId(cutId);
      setCutsError('');
      try {
        const res = await apiFetch(`/api/comision-ventas/cuts/${cutId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payment_status: 'paid', proof_image_base64: proofImageBase64 }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setCutsError(typeof data.error === 'string' ? data.error : 'No se pudo marcar como pagado');
          return false;
        }
        setPayModalCut(null);
        setPayProofDataUrl(null);
        setPayProofErr('');
        await loadCuts();
        return true;
      } catch {
        setCutsError('Error de red al marcar como pagado');
        return false;
      } finally {
        setPatchingCutId(null);
      }
    },
    [loadCuts],
  );

  const openPaymentProof = useCallback(async (cut: CommissionCutRow) => {
    setCutsError('');
    try {
      setProofView((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return null;
      });
      const token = getStoredToken();
      const res = await fetch(apiUrl(`/api/comision-ventas/cuts/${cut.id}/payment-proof`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setCutsError(typeof j.error === 'string' ? j.error : 'No se pudo cargar el comprobante');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setProofView({ title: `Corte #${cut.cut_number || cut.id} — ${cut.period_label}`, url });
    } catch {
      setCutsError('Error de red al cargar el comprobante');
    }
  }, []);

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
          Período
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
              {saving ? 'Guardando…' : 'Guardar porcentajes'}
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

      <section style={{ marginTop: 28 }}>
          <h2 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: ds.textPrimary }}>
            Cortes de pago
          </h2>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: ds.textSecondary, maxWidth: 720 }}>
            El primer corte va desde la primera fecha con pedidos despachados hasta el último día de ese mes. Después,
            cada mes se divide en 1–15 y 16–último día (según la fecha de actualización del pedido a despachado). Por
            defecto solo ves cortes con fin de período hasta el día elegido. Para marcar pagado, el propietario debe
            adjuntar una imagen de soporte; todos los que tienen acceso al módulo pueden verla.
          </p>

          <div
            style={{
              marginBottom: 12,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: ds.textSecondary }}>
              Cortes hasta el día
              <input
                type="date"
                value={cutsAsOf}
                max={localTodayYmd()}
                onChange={(e) => {
                  const v = e.target.value;
                  const next = v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : localTodayYmd();
                  setCutsAsOf(next);
                  void loadCuts(next);
                }}
                style={{
                  border: `1px solid ${ds.borderCard}`,
                  background: ds.bgCard,
                  borderRadius: 8,
                  padding: '6px 8px',
                  fontSize: 13,
                  color: ds.textPrimary,
                }}
              />
            </label>
            <span style={{ fontSize: 12, color: ds.textMuted }}>
              Aplicado en servidor: <strong style={{ color: ds.textPrimary }}>{cutsAsOfApplied}</strong>
            </span>
          </div>

          {accumulated ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: 10,
                marginBottom: 14,
              }}
            >
              <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 11, color: ds.textMuted, marginBottom: 4 }}>Comisión acumulada (hasta el día)</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: ds.textPrimary }}>
                  {formatMoney(accumulated.commission_total)}
                </div>
              </div>
              <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 11, color: ds.textMuted, marginBottom: 4 }}>Pagado (hasta el día)</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: ds.textPrimary }}>{formatMoney(accumulated.paid_total)}</div>
              </div>
              <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 11, color: ds.textMuted, marginBottom: 4 }}>Pendiente (hasta el día)</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: ds.warningText }}>
                  {formatMoney(accumulated.pending_total)}
                </div>
              </div>
            </div>
          ) : null}

          {cutsError ? (
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
              {cutsError}
            </div>
          ) : null}

          <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 14, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: ds.bgSubtle }}>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, color: ds.textSecondary }}>Período</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, color: ds.textSecondary }}>Tipo</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, color: ds.textSecondary }}>
                    Ventas del período
                  </th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, color: ds.textSecondary }}>
                    Comisión del período
                  </th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, color: ds.textSecondary }}>Estado</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, color: ds.textSecondary }}>Comprobante</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, color: ds.textSecondary }}>Fecha de pago</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, color: ds.textSecondary }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {cutsLoading ? (
                  <tr>
                    <td colSpan={8} style={{ padding: '12px', color: ds.textMuted, fontSize: 12 }}>
                      Cargando cortes…
                    </td>
                  </tr>
                ) : cuts.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: '12px', color: ds.textMuted, fontSize: 12 }}>
                      Aún no hay cortes. Aparecen cuando exista al menos un despacho y se cierre el primer período (hasta
                      fin de mes o la quincena correspondiente).
                    </td>
                  </tr>
                ) : (
                  cuts.map((c) => {
                    const tipo =
                      c.cut_kind === 'first_partial'
                        ? 'Primer corte (desde el primer despacho)'
                        : c.cut_kind === 'first_half'
                          ? '1 al 15 del mes'
                          : '16 al último día del mes';
                    const isPaid = c.payment_status === 'paid';
                    const busy = patchingCutId === c.id;
                    const num = Number(c.cut_number) || 0;
                    return (
                      <tr key={c.id}>
                        <td style={{ borderTop: `1px solid ${ds.borderRow}`, padding: '8px 12px', color: ds.textPrimary }}>
                          <div style={{ fontWeight: 700, color: ds.brand }}>Corte #{num}</div>
                          <div style={{ fontWeight: 600 }}>{c.period_label}</div>
                          <div style={{ fontSize: 11, color: ds.textMuted }}>
                            {c.period_start} al {c.period_end}
                          </div>
                        </td>
                        <td style={{ borderTop: `1px solid ${ds.borderRow}`, padding: '8px 12px', fontSize: 12, color: ds.textSecondary }}>
                          {tipo}
                        </td>
                        <td style={{ borderTop: `1px solid ${ds.borderRow}`, padding: '8px 12px', textAlign: 'right' }}>
                          <strong style={{ color: ds.textPrimary }}>{formatMoney(c.ventas_despachadas_total)}</strong>
                        </td>
                        <td style={{ borderTop: `1px solid ${ds.borderRow}`, padding: '8px 12px', textAlign: 'right' }}>
                          <strong style={{ color: ds.textPrimary }}>{formatMoney(c.commission_total)}</strong>
                        </td>
                        <td style={{ borderTop: `1px solid ${ds.borderRow}`, padding: '8px 12px' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 600,
                              background: isPaid ? ds.bgSubtle : ds.warningBg,
                              color: isPaid ? ds.textSecondary : ds.warningText,
                            }}
                          >
                            {isPaid ? 'Pagado' : 'Pendiente de pago'}
                          </span>
                        </td>
                        <td style={{ borderTop: `1px solid ${ds.borderRow}`, padding: '8px 12px', fontSize: 12 }}>
                          {c.has_payment_proof ? (
                            <button
                              type="button"
                              onClick={() => void openPaymentProof(c)}
                              style={{
                                border: `1px solid ${ds.borderCard}`,
                                background: ds.bgSubtle,
                                borderRadius: 8,
                                padding: '6px 10px',
                                fontSize: 11,
                                fontWeight: 600,
                                cursor: 'pointer',
                                color: ds.textPrimary,
                              }}
                            >
                              Ver comprobante
                            </button>
                          ) : (
                            <span style={{ color: ds.textMuted }}>—</span>
                          )}
                        </td>
                        <td style={{ borderTop: `1px solid ${ds.borderRow}`, padding: '8px 12px', fontSize: 12, color: ds.textMuted }}>
                          {c.paid_at ? formatUpdatedAt(new Date(c.paid_at)) : '—'}
                        </td>
                        <td style={{ borderTop: `1px solid ${ds.borderRow}`, padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {canEditCutPayment ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void setCutPaymentStatus(c.id, 'pending')}
                                disabled={busy || cutsLoading || !isPaid}
                                style={{
                                  marginRight: 6,
                                  border: `1px solid ${ds.borderCard}`,
                                  background: ds.bgCard,
                                  borderRadius: 8,
                                  padding: '6px 10px',
                                  fontSize: 11,
                                  fontWeight: 600,
                                  cursor: busy || !isPaid ? 'not-allowed' : 'pointer',
                                  opacity: !isPaid ? 0.5 : 1,
                                }}
                              >
                                Pendiente
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setPayProofErr('');
                                  setPayProofDataUrl(null);
                                  setPayModalCut(c);
                                }}
                                disabled={busy || cutsLoading || isPaid}
                                style={{
                                  border: 'none',
                                  background: ds.brand,
                                  color: '#fff',
                                  borderRadius: 8,
                                  padding: '6px 10px',
                                  fontSize: 11,
                                  fontWeight: 700,
                                  cursor: busy || isPaid ? 'not-allowed' : 'pointer',
                                  opacity: isPaid ? 0.55 : 1,
                                }}
                              >
                                Pagado
                              </button>
                            </>
                          ) : (
                            <span style={{ fontSize: 11, color: ds.textMuted }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

      {proofView ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Comprobante de pago"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => {
            setProofView((p) => {
              if (p?.url) URL.revokeObjectURL(p.url);
              return null;
            });
          }}
        >
          <div
            style={{
              maxWidth: 'min(920px, 96vw)',
              maxHeight: '90vh',
              overflow: 'auto',
              background: ds.bgCard,
              borderRadius: 14,
              padding: 16,
              border: `1px solid ${ds.borderCard}`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <strong style={{ color: ds.textPrimary }}>{proofView.title}</strong>
              <button
                type="button"
                onClick={() => {
                  setProofView((p) => {
                    if (p?.url) URL.revokeObjectURL(p.url);
                    return null;
                  });
                }}
                style={{
                  border: `1px solid ${ds.borderCard}`,
                  background: ds.bgSubtle,
                  borderRadius: 8,
                  padding: '6px 12px',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Cerrar
              </button>
            </div>
            <img src={proofView.url} alt="Comprobante de pago" style={{ maxWidth: '100%', height: 'auto', display: 'block' }} />
          </div>
        </div>
      ) : null}

      {payModalCut ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Marcar corte como pagado"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => {
            setPayModalCut(null);
            setPayProofDataUrl(null);
            setPayProofErr('');
          }}
        >
          <div
            style={{
              width: 'min(440px, 100%)',
              background: ds.bgCard,
              borderRadius: 14,
              padding: 18,
              border: `1px solid ${ds.borderCard}`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 8px', fontSize: 15, color: ds.textPrimary }}>Marcar corte como pagado</h3>
            <p style={{ margin: '0 0 12px', fontSize: 12, color: ds.textSecondary }}>
              {payModalCut.period_label}. Debes adjuntar una imagen del soporte de pago (máx. 4 MB, JPG, PNG o WebP).
            </p>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                setPayProofErr('');
                const f = e.target.files?.[0];
                if (!f) {
                  setPayProofDataUrl(null);
                  return;
                }
                if (f.size > 4 * 1024 * 1024) {
                  setPayProofErr('El archivo supera 4 MB.');
                  setPayProofDataUrl(null);
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  const r = String(reader.result || '');
                  setPayProofDataUrl(r);
                };
                reader.readAsDataURL(f);
              }}
              style={{ marginBottom: 10, fontSize: 12 }}
            />
            {payProofErr ? (
              <div style={{ fontSize: 12, color: ds.dangerText, marginBottom: 8 }}>{payProofErr}</div>
            ) : null}
            {payProofDataUrl ? (
              <div style={{ marginBottom: 12 }}>
                <img src={payProofDataUrl} alt="Vista previa" style={{ maxWidth: '100%', maxHeight: 180, borderRadius: 8 }} />
              </div>
            ) : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  setPayModalCut(null);
                  setPayProofDataUrl(null);
                  setPayProofErr('');
                }}
                style={{
                  border: `1px solid ${ds.borderCard}`,
                  background: ds.bgCard,
                  borderRadius: 8,
                  padding: '8px 12px',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!payProofDataUrl || patchingCutId != null}
                onClick={() => {
                  if (!payModalCut || !payProofDataUrl) {
                    setPayProofErr('Selecciona una imagen de soporte.');
                    return;
                  }
                  void markCutPaidWithProof(payModalCut.id, payProofDataUrl);
                }}
                style={{
                  border: 'none',
                  background: ds.brand,
                  color: '#fff',
                  borderRadius: 8,
                  padding: '8px 14px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: !payProofDataUrl || patchingCutId != null ? 'not-allowed' : 'pointer',
                  opacity: !payProofDataUrl || patchingCutId != null ? 0.55 : 1,
                }}
              >
                Confirmar pagado
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
