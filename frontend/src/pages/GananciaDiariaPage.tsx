import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';
import { PageHeader } from '../design-system/PageHeader';

type GananciaPayload = {
  date?: string;
  shop_calendar_timezone?: string;
  ventas_despachadas_total?: number;
  ventas_despachadas_pedidos?: number;
  ventas_currency?: string | null;
  gasto_publicitario_total?: number;
  meta_currency?: string | null;
  ganancia?: number | null;
  ganancia_comparable?: boolean;
  warning?: string | null;
  meta_partial_errors?: { adAccountId: string; error: string }[];
  error?: string;
  code?: string;
};

function todayInputYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatMoney(n: number, currency: string | null | undefined): string {
  if (!Number.isFinite(n)) return '—';
  const c = (currency || 'USD').trim().toUpperCase();
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: c.length === 3 ? c : 'USD',
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${n.toLocaleString('es-CO', { maximumFractionDigits: 0 })} ${c}`;
  }
}

const cardBase: CSSProperties = {
  background: ds.bgCard,
  borderRadius: 14,
  padding: '20px 22px',
  border: `1px solid ${ds.borderCard}`,
};

export default function GananciaDiariaPage() {
  const [date, setDate] = useState(todayInputYmd);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<GananciaPayload | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams();
      if (date.trim()) qs.set('date', date.trim());
      const res = await apiFetch(`/api/ganancia-diaria?${qs.toString()}`);
      const body = (await res.json().catch(() => ({}))) as GananciaPayload;
      if (!res.ok) {
        setData(null);
        setError(typeof body.error === 'string' ? body.error : 'No se pudo cargar');
        return;
      }
      setData(body);
    } catch {
      setData(null);
      setError('Error de red');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  const ventasCur = data?.ventas_currency;
  const metaCur = data?.meta_currency;

  const metaNote = useMemo(() => {
    if (!data?.meta_partial_errors?.length) return null;
    return data.meta_partial_errors.map((e) => `${e.adAccountId}: ${e.error}`).join(' · ');
  }, [data]);

  return (
    <div style={{ maxWidth: 960 }}>
      <PageHeader
        title="Ganancia Diaria"
        subtitle="Ventas despachadas (Shopify + estado KOVO) menos gasto publicitario (Meta). Solo se puede consultar hasta 60 días atrás (calendario de la tienda)."
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 20 }}>
        <label style={{ fontSize: 13, color: ds.textSecondary, display: 'flex', alignItems: 'center', gap: 8 }}>
          Día (calendario tienda)
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              border: `1px solid ${ds.borderCard}`,
              background: ds.bgCard,
              color: ds.textPrimary,
              fontSize: 13,
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: `1px solid ${ds.borderCard}`,
            background: ds.brand,
            color: '#fff',
            fontWeight: 600,
            fontSize: 13,
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? 'Calculando…' : 'Actualizar'}
        </button>
      </div>

      {error ? (
        <p style={{ color: ds.dangerText, fontSize: 14 }}>{error}</p>
      ) : null}

      {data && !error ? (
        <>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: ds.textMuted }}>
            Fecha contable: <strong style={{ color: ds.textSecondary }}>{data.date}</strong>
            {data.shop_calendar_timezone ? (
              <>
                {' '}
                · Zona tienda: <code style={{ fontSize: 11 }}>{data.shop_calendar_timezone}</code>
              </>
            ) : null}
            . Los pedidos se filtran por <strong>fecha de creación</strong> en Shopify en ese día; solo cuentan con
            estado interno <strong>Despachado</strong> en Pedidos KOVO (excluye anulados/cancelados).
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 14,
              marginBottom: 16,
            }}
          >
            <div style={cardBase}>
              <div style={{ fontSize: 11, fontWeight: 600, color: ds.textMuted, marginBottom: 8 }}>
                Ventas despachadas
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: ds.textPrimary }}>
                {formatMoney(Number(data.ventas_despachadas_total) || 0, ventasCur)}
              </div>
              <div style={{ fontSize: 12, color: ds.textHint, marginTop: 6 }}>
                {data.ventas_despachadas_pedidos ?? 0} pedidos
              </div>
            </div>
            <div style={cardBase}>
              <div style={{ fontSize: 11, fontWeight: 600, color: ds.textMuted, marginBottom: 8 }}>
                Gasto publicitario (Meta)
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: ds.textPrimary }}>
                {formatMoney(Number(data.gasto_publicitario_total) || 0, metaCur || ventasCur)}
              </div>
              <div style={{ fontSize: 12, color: ds.textHint, marginTop: 6 }}>
                Cuentas vinculadas · {data.meta_currency || '—'}
              </div>
            </div>
            <div style={{ ...cardBase, borderColor: ds.brand, background: ds.brandBg }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: ds.brand, marginBottom: 8 }}>Ganancia</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: ds.textPrimary }}>
                {data.ganancia != null && Number.isFinite(data.ganancia)
                  ? formatMoney(data.ganancia, ventasCur)
                  : '—'}
              </div>
              <div style={{ fontSize: 12, color: ds.textSecondary, marginTop: 6 }}>
                Ventas − gasto (misma divisa)
              </div>
            </div>
          </div>

          {data.warning ? (
            <p
              style={{
                margin: '0 0 12px',
                padding: '10px 12px',
                borderRadius: 10,
                background: ds.warningBg,
                color: ds.warningText,
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              {data.warning}
            </p>
          ) : null}

          {metaNote ? (
            <p style={{ margin: 0, fontSize: 12, color: ds.textHint }}>Meta: {metaNote}</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
