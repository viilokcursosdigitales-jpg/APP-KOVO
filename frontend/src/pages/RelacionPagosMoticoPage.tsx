import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../auth/api';
import { coerceOrderInternalEstadoForSelect } from '../constants/orderInternalEstado';
import { ds } from '../design-system/ds';
import { IconCart, IconPackage, IconTruck, IconTrendingUp } from '../design-system/icons';
import { KpiCard } from '../design-system/KpiCard';
import { PageHeader } from '../design-system/PageHeader';
import { type DatePreset, DATE_PRESETS, buildDateRange } from '../utils/datePresets';

type MoticoRelacionPagoEstado = 'pendiente_pago' | 'pagado' | 'cancelado' | 'devolucion';

const PAGO_ESTADO_OPTIONS: { value: MoticoRelacionPagoEstado; label: string }[] = [
  { value: 'pendiente_pago', label: 'Pendiente de pago' },
  { value: 'pagado', label: 'Pagado' },
  { value: 'cancelado', label: 'Cancelado' },
  { value: 'devolucion', label: 'Devolución' },
];

type OrderRow = {
  id: number;
  createdAt?: string;
  orderName?: string;
  client?: string;
  shippingAddress?: { name?: string } | null;
  mensajero?: string | null;
  internal_status?: string;
  motico_status?: string;
  is_motico_manual?: boolean;
  currency?: string;
  financialStatus?: string;
  total?: string;
  shopifyTotal?: string;
  price_override?: number | null;
  totalOutstanding?: string | null;
  pago_al_recibir_override?: number;
  total_a_pagar?: number | null;
  product_cost_motico?: number | null;
  freight_cost_motico?: number | null;
  /** ISO: última vez que el pedido pasó a estado operativo Despachado (servidor). */
  last_despachado_at?: string | null;
};

function formatMoneyAmount(n: number, currency: string) {
  const c = (currency || 'COP').trim() || 'COP';
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: c,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${n.toFixed(0)} ${c}`;
  }
}

function orderRef(o: OrderRow): string {
  if (o.is_motico_manual || o.id < 0) return `motico_manual:${Math.abs(o.id)}`;
  return `shopify:${o.id}`;
}

function isPruebaRow(o: OrderRow) {
  const st = String(o.motico_status || o.internal_status || '')
    .trim()
    .toLowerCase();
  return st === 'prueba';
}

function isMoticoMensajeroScope(o: OrderRow) {
  const mensajero = String(o.mensajero || '')
    .trim()
    .toLowerCase();
  const internalStatus = String(o.internal_status || '')
    .trim()
    .toLowerCase();
  return (
    mensajero === 'motico' ||
    internalStatus === 'motico' ||
    Boolean(o.is_motico_manual) ||
    Number(o.id) < 0
  );
}

function relacionPrecioTotal(o: OrderRow): number {
  const raw =
    o.price_override != null && Number.isFinite(Number(o.price_override))
      ? Number(o.price_override)
      : Number.parseFloat(String(o.shopifyTotal ?? o.total ?? '0').replace(',', '.'));
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

/** Misma lógica que Pedidos: pago anticipado si Shopify «paid» o valor del editor (`pago_al_recibir_override`). */
function relacionPagoAnticipado(o: OrderRow): number {
  const T = relacionPrecioTotal(o);
  const fin = String(o.financialStatus || '').toLowerCase();
  if (fin === 'paid') return T;
  const editor = Number(o.pago_al_recibir_override);
  if (Number.isFinite(editor) && editor > 0) return Math.min(T, editor);
  return 0;
}

/** Pendiente pago al recibir = precio total − pago anticipado. */
function pendientePagoAlRecibir(o: OrderRow): number {
  return Math.max(0, relacionPrecioTotal(o) - relacionPagoAnticipado(o));
}

function parseNequiDraftInput(s: string): number {
  const raw = s.trim().replace(/\s/g, '');
  if (raw === '') return 0;
  const normalized = raw.replace(/\./g, '').replace(',', '.');
  const n = Number.parseFloat(normalized);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function numOrZero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Ganancia Motico = precio total − costo producto − costo flete. */
function gananciaMotico(o: OrderRow): number {
  return relacionPrecioTotal(o) - numOrZero(o.product_cost_motico) - numOrZero(o.freight_cost_motico);
}

/** Fecha/hora del último pase a Despachado; vacío si no hay registro (p. ej. pedidos anteriores a la columna). */
function formatFechaUltimoDespachado(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  try {
    return new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(t));
  } catch {
    return '—';
  }
}

export default function RelacionPagosMoticoPage() {
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopDomain, setShopDomain] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<DatePreset>('este_ano');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [estadoByRef, setEstadoByRef] = useState<Record<string, MoticoRelacionPagoEstado>>({});
  const [pagosNequiByRef, setPagosNequiByRef] = useState<Record<string, number>>({});
  const [pagosNequiDraft, setPagosNequiDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingRef, setSavingRef] = useState<string | null>(null);
  const [savingNequiRef, setSavingNequiRef] = useState<string | null>(null);
  const nequiTimersRef = useRef<Record<string, ReturnType<typeof setTimeout> | undefined>>({});

  const dateQuery = useMemo(
    () => buildDateRange(datePreset, customFrom, customTo),
    [datePreset, customFrom, customTo],
  );

  const rows = useMemo(() => {
    const out: OrderRow[] = [];
    for (const o of orders) {
      if (isPruebaRow(o)) continue;
      if (!isMoticoMensajeroScope(o)) continue;
      const st = coerceOrderInternalEstadoForSelect(o.motico_status || o.internal_status);
      if (st !== 'despachado') continue;
      out.push(o);
    }
    out.sort((a, b) => {
      const ta = Date.parse(String(a.createdAt || '')) || 0;
      const tb = Date.parse(String(b.createdAt || '')) || 0;
      return tb - ta;
    });
    return out;
  }, [orders]);

  const loadEstados = useCallback(async () => {
    const res = await apiFetch('/api/motico/relacion-pagos/estados');
    if (!res.ok) return;
    const data = (await res.json().catch(() => ({}))) as {
      rows?: { order_ref?: string; estado_pago?: string; pagos_por_nequi?: number | string | null }[];
    };
    const next: Record<string, MoticoRelacionPagoEstado> = {};
    const nextNequi: Record<string, number> = {};
    for (const r of data.rows || []) {
      const ref = String(r.order_ref || '');
      if (!ref) continue;
      const neq = Number(r.pagos_por_nequi);
      nextNequi[ref] = Number.isFinite(neq) && neq >= 0 ? neq : 0;
      const es = String(r.estado_pago || '') as MoticoRelacionPagoEstado;
      if (PAGO_ESTADO_OPTIONS.some((o) => o.value === es)) next[ref] = es;
    }
    setEstadoByRef(next);
    setPagosNequiByRef(nextNequi);
  }, []);

  const loadOrders = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const conn = await apiFetch('/api/shopify/connection');
      const cj = (await conn.json().catch(() => ({}))) as { status?: string; shop_domain?: string | null };
      if (!conn.ok || cj.status !== 'connected' || !cj.shop_domain) {
        setShopifyConnected(false);
        setShopDomain(null);
        setOrders([]);
        return;
      }
      setShopifyConnected(true);
      setShopDomain(cj.shop_domain);

      const qs = new URLSearchParams({ mensajero_filter: 'motico' });
      if (dateQuery.min) qs.set('created_at_min', dateQuery.min);
      if (dateQuery.max) qs.set('created_at_max', dateQuery.max);
      const ordRes = await apiFetch(`/api/shopify/orders?${qs.toString()}`);
      const data = (await ordRes.json().catch(() => ({}))) as {
        orders?: OrderRow[];
        error?: string;
        code?: string;
      };
      if (!ordRes.ok) {
        if (data.code === 'not_connected') {
          setShopifyConnected(false);
          setOrders([]);
          return;
        }
        setError(typeof data.error === 'string' ? data.error : 'No se pudieron cargar los pedidos');
        setOrders([]);
        return;
      }
      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } catch {
      setError('Error de red al cargar datos');
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [dateQuery.min, dateQuery.max]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    return () => {
      for (const k of Object.keys(nequiTimersRef.current)) {
        const t = nequiTimersRef.current[k];
        if (t) clearTimeout(t);
      }
    };
  }, []);

  useEffect(() => {
    if (!shopifyConnected) return;
    void loadEstados();
  }, [shopifyConnected, loadEstados, orders.length]);

  const defaultCurrency = useMemo(() => rows[0]?.currency || 'COP', [rows]);

  const relacionPagosKpis = useMemo(() => {
    let totalVentasDespachado = 0;
    let totalPendienteRecibir = 0;
    let totalNequi = 0;
    let totalSaldo = 0;
    let pagado = 0;
    let pendientePago = 0;
    let devolucion = 0;
    let cancelado = 0;
    const n = rows.length;
    for (const o of rows) {
      const ref = orderRef(o);
      totalVentasDespachado += relacionPrecioTotal(o);
      const pendiente = pendientePagoAlRecibir(o);
      totalPendienteRecibir += pendiente;
      const cProd = numOrZero(o.product_cost_motico);
      const cFlete = numOrZero(o.freight_cost_motico);
      const debeProveedor = pendiente - cProd - cFlete;
      const nequiCommitted = pagosNequiByRef[ref] ?? 0;
      const nequiAgg =
        Object.prototype.hasOwnProperty.call(pagosNequiDraft, ref) && pagosNequiDraft[ref] !== undefined
          ? parseNequiDraftInput(String(pagosNequiDraft[ref]))
          : nequiCommitted;
      totalNequi += nequiAgg;
      totalSaldo += debeProveedor - nequiAgg;
      const cur = estadoByRef[ref] || 'pendiente_pago';
      if (cur === 'pagado') pagado += 1;
      else if (cur === 'pendiente_pago') pendientePago += 1;
      else if (cur === 'devolucion') devolucion += 1;
      else if (cur === 'cancelado') cancelado += 1;
    }
    const pct = (c: number) => (n > 0 ? (c / n) * 100 : 0);
    return {
      n,
      totalVentasDespachado,
      totalPendienteRecibir,
      totalNequi,
      totalSaldo,
      pagado,
      pendientePago,
      devolucion,
      cancelado,
      pctPagado: pct(pagado),
      pctPendiente: pct(pendientePago),
      pctDevolucion: pct(devolucion),
      pctCancelado: pct(cancelado),
    };
  }, [rows, estadoByRef, pagosNequiByRef, pagosNequiDraft]);

  const onEstadoChange = useCallback(
    async (ref: string, next: MoticoRelacionPagoEstado) => {
      const prev = estadoByRef[ref] || 'pendiente_pago';
      setEstadoByRef((m) => ({ ...m, [ref]: next }));
      setSavingRef(ref);
      setError('');
      try {
        const res = await apiFetch('/api/motico/relacion-pagos/estado', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_ref: ref, estado_pago: next }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setEstadoByRef((m) => ({ ...m, [ref]: prev }));
          setError(typeof data.error === 'string' ? data.error : 'No se pudo guardar el estado');
          return;
        }
      } catch {
        setEstadoByRef((m) => ({ ...m, [ref]: prev }));
        setError('Error de red al guardar');
      } finally {
        setSavingRef(null);
      }
    },
    [estadoByRef],
  );

  const savePagosNequi = useCallback(async (ref: string, amount: number) => {
    setSavingNequiRef(ref);
    setError('');
    try {
      const res = await apiFetch('/api/motico/relacion-pagos/pagos-nequi', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_ref: ref, pagos_por_nequi: amount }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(typeof data.error === 'string' ? data.error : 'No se pudo guardar Pagos por Nequi');
        return;
      }
      const row = (await res.json().catch(() => ({}))) as { pagos_por_nequi?: number };
      const saved = Number(row.pagos_por_nequi);
      const v = Number.isFinite(saved) ? saved : amount;
      setPagosNequiByRef((m) => ({ ...m, [ref]: v }));
      setPagosNequiDraft((d) => {
        if (!Object.prototype.hasOwnProperty.call(d, ref)) return d;
        const { [ref]: _r, ...rest } = d;
        return rest;
      });
    } catch {
      setError('Error de red al guardar');
    } finally {
      setSavingNequiRef(null);
    }
  }, []);

  const schedulePagosNequiSave = useCallback(
    (ref: string, draft: string) => {
      const prevT = nequiTimersRef.current[ref];
      if (prevT) clearTimeout(prevT);
      nequiTimersRef.current[ref] = setTimeout(() => {
        nequiTimersRef.current[ref] = undefined;
        const amount = parseNequiDraftInput(draft);
        void savePagosNequi(ref, amount);
      }, 550);
    },
    [savePagosNequi],
  );

  const fmtPct = (p0to100: number) =>
    new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 1, minimumFractionDigits: 0 }).format(
      p0to100 / 100,
    );

  return (
    <div style={{ padding: '20px 22px 40px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader
        title="Relación de Pagos Motico"
        subtitle={
          shopifyConnected && shopDomain
            ? `Pedidos con mensajero Motico y estado Despachado · ${shopDomain}. El estado de la última columna es el seguimiento de cobro a Motico.`
            : 'Pedidos con mensajero Motico y estado Despachado. Conecta Shopify para ver datos.'
        }
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: ds.textMuted, fontWeight: 600 }}>Rango</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {DATE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setDatePreset(p.id)}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: `1px solid ${datePreset === p.id ? ds.brand : ds.borderCard}`,
                background: datePreset === p.id ? ds.brandBg : ds.bgCard,
                color: datePreset === p.id ? ds.brand : ds.textSecondary,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        {datePreset === 'personalizado' ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              style={{ padding: 6, borderRadius: 8, border: `1px solid ${ds.borderCard}` }}
            />
            <span style={{ color: ds.textMuted }}>a</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              style={{ padding: 6, borderRadius: 8, border: `1px solid ${ds.borderCard}` }}
            />
          </div>
        ) : null}
        <Link
          to="/pedidos"
          style={{ marginLeft: 'auto', fontSize: 12, color: ds.brand, fontWeight: 600 }}
        >
          Ir a Pedidos
        </Link>
      </div>

      {shopifyConnected && !loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
              gap: 12,
            }}
          >
            <KpiCard
              variant="sales"
              label="Total ventas despachado"
              value={formatMoneyAmount(relacionPagosKpis.totalVentasDespachado, defaultCurrency)}
              icon={<IconCart />}
            />
            <KpiCard
              variant="traffic"
              label="Total pendiente pago al recibir"
              value={formatMoneyAmount(relacionPagosKpis.totalPendienteRecibir, defaultCurrency)}
              icon={<IconPackage />}
            />
            <KpiCard
              variant="conversion"
              label="Total pagos por Nequi"
              value={formatMoneyAmount(relacionPagosKpis.totalNequi, defaultCurrency)}
              icon={<IconTruck />}
            />
            <KpiCard
              variant="spend"
              label="Total saldo"
              value={
                <span
                  style={{
                    color:
                      relacionPagosKpis.totalSaldo > 0
                        ? ds.successText
                        : relacionPagosKpis.totalSaldo < 0
                          ? ds.dangerText
                          : ds.textPrimary,
                  }}
                >
                  {formatMoneyAmount(relacionPagosKpis.totalSaldo, defaultCurrency)}
                </span>
              }
              icon={<IconTrendingUp />}
            />
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 12,
            }}
          >
            <KpiCard
              variant="sales"
              label="Pedidos pagados (cobro Motico)"
              value={relacionPagosKpis.pagado}
              icon={<IconCart />}
              badge={
                <span style={{ fontSize: 12, fontWeight: 600, color: ds.textMuted }}>
                  {fmtPct(relacionPagosKpis.pctPagado)}
                </span>
              }
            />
            <KpiCard
              variant="traffic"
              label="Pendientes de pago"
              value={relacionPagosKpis.pendientePago}
              icon={<IconCart />}
              badge={
                <span style={{ fontSize: 12, fontWeight: 600, color: ds.textMuted }}>
                  {fmtPct(relacionPagosKpis.pctPendiente)}
                </span>
              }
            />
            <KpiCard
              variant="alert"
              label="Devolución"
              value={relacionPagosKpis.devolucion}
              icon={<IconPackage />}
              badge={
                <span style={{ fontSize: 12, fontWeight: 600, color: ds.textMuted }}>
                  {fmtPct(relacionPagosKpis.pctDevolucion)}
                </span>
              }
            />
            <KpiCard
              variant="conversion"
              label="Cancelado"
              value={relacionPagosKpis.cancelado}
              icon={<IconTruck />}
              badge={
                <span style={{ fontSize: 12, fontWeight: 600, color: ds.textMuted }}>
                  {fmtPct(relacionPagosKpis.pctCancelado)}
                </span>
              }
            />
          </div>
          {relacionPagosKpis.n > 0 ? (
            <div style={{ fontSize: 12, color: ds.textMuted, fontWeight: 500 }}>
              Total pedidos en relación:{' '}
              <strong style={{ color: ds.textSecondary }}>{relacionPagosKpis.n}</strong>
              {' · '}
              Los porcentajes son sobre esta cantidad (columna Estado).
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            borderRadius: 10,
            background: ds.dangerBg,
            color: ds.dangerText,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      {!shopifyConnected && !loading ? (
        <div
          style={{
            padding: '16px 18px',
            borderRadius: 12,
            border: `1px solid ${ds.borderCard}`,
            background: ds.bgSubtle,
            fontSize: 14,
            color: ds.textSecondary,
          }}
        >
          No hay tienda Shopify conectada. Conecta la tienda desde Configuración o Pedidos para usar esta relación.
        </div>
      ) : null}

      {loading ? (
        <div style={{ color: ds.textMuted, fontSize: 14 }}>Cargando…</div>
      ) : shopifyConnected && rows.length === 0 ? (
        <div style={{ color: ds.textSecondary, fontSize: 14 }}>
          No hay pedidos Despachado con mensajero Motico en el rango seleccionado.
        </div>
      ) : shopifyConnected ? (
        <div style={{ overflowX: 'auto', borderRadius: 12, border: `1px solid ${ds.borderCard}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 1400 }}>
            <thead>
              <tr style={{ background: ds.bgSubtle }}>
                <th
                  title="Momento en que el pedido pasó por última vez a estado operativo Despachado"
                  style={{ textAlign: 'left', padding: '12px 12px', fontWeight: 700, color: ds.textPrimary, whiteSpace: 'nowrap' }}
                >
                  Fecha
                </th>
                <th style={{ textAlign: 'left', padding: '12px 14px', fontWeight: 700, color: ds.textPrimary }}>
                  Nombre del cliente
                </th>
                <th style={{ textAlign: 'right', padding: '12px 10px', fontWeight: 700, color: ds.textPrimary }}>
                  Precio total
                </th>
                <th style={{ textAlign: 'right', padding: '12px 10px', fontWeight: 700, color: ds.textPrimary }}>
                  Pendiente pago al recibir
                </th>
                <th style={{ textAlign: 'right', padding: '12px 10px', fontWeight: 700, color: ds.textPrimary }}>
                  Costo producto Motico
                </th>
                <th style={{ textAlign: 'right', padding: '12px 10px', fontWeight: 700, color: ds.textPrimary }}>
                  Costo flete Motico
                </th>
                <th
                  title="Precio total − costo producto Motico − costo flete Motico"
                  style={{ textAlign: 'right', padding: '12px 10px', fontWeight: 700, color: ds.textPrimary }}
                >
                  Ganancia Motico
                </th>
                <th style={{ textAlign: 'right', padding: '12px 10px', fontWeight: 700, color: ds.textPrimary }}>
                  Debe proveedor
                </th>
                <th style={{ textAlign: 'right', padding: '12px 10px', fontWeight: 700, color: ds.textPrimary }}>
                  Pagos por Nequi
                </th>
                <th style={{ textAlign: 'right', padding: '12px 10px', fontWeight: 700, color: ds.textPrimary }}>
                  Saldo
                </th>
                <th style={{ textAlign: 'left', padding: '12px 14px', fontWeight: 700, color: ds.textPrimary, minWidth: 200 }}>
                  Estado
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o, idx) => {
                const ref = orderRef(o);
                const nombre =
                  String(o.shippingAddress?.name || '').trim() ||
                  String(o.client || '').trim() ||
                  '—';
                const cur = estadoByRef[ref] || 'pendiente_pago';
                const precioTotal = relacionPrecioTotal(o);
                const pendiente = pendientePagoAlRecibir(o);
                const cProd = numOrZero(o.product_cost_motico);
                const cFlete = numOrZero(o.freight_cost_motico);
                const gMotico = gananciaMotico(o);
                const debeProveedor = pendiente - cProd - cFlete;
                const nequiCommitted = pagosNequiByRef[ref] ?? 0;
                const nequiForSaldo =
                  Object.prototype.hasOwnProperty.call(pagosNequiDraft, ref) && pagosNequiDraft[ref] !== undefined
                    ? parseNequiDraftInput(String(pagosNequiDraft[ref]))
                    : nequiCommitted;
                const saldo = debeProveedor - nequiForSaldo;
                const saldoColor =
                  saldo > 0 ? ds.successText : saldo < 0 ? ds.dangerText : ds.textPrimary;
                const curcy = o.currency || defaultCurrency;
                const busy = savingRef === ref;
                const nequiBusy = savingNequiRef === ref;
                const nequiInputVal = pagosNequiDraft[ref] ?? String(nequiCommitted);
                return (
                  <tr
                    key={ref}
                    style={{
                      borderTop: `1px solid ${ds.borderCard}`,
                      background: idx % 2 === 0 ? ds.bgCard : ds.bgSubtle,
                    }}
                  >
                    <td
                      title="Último estado Despachado"
                      style={{
                        padding: '12px 12px',
                        color: ds.textSecondary,
                        fontSize: 12,
                        whiteSpace: 'nowrap',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {formatFechaUltimoDespachado(o.last_despachado_at)}
                    </td>
                    <td style={{ padding: '12px 14px', color: ds.textPrimary, fontWeight: 500 }}>
                      <div>{nombre}</div>
                      <div style={{ fontSize: 11, color: ds.textMuted, marginTop: 4 }}>
                        {o.orderName || `#${o.id}`}
                        {o.is_motico_manual ? ' · Manual' : ''}
                      </div>
                    </td>
                    <td style={{ padding: '12px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatMoneyAmount(precioTotal, curcy)}
                    </td>
                    <td style={{ padding: '12px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatMoneyAmount(pendiente, curcy)}
                    </td>
                    <td style={{ padding: '12px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatMoneyAmount(cProd, curcy)}
                    </td>
                    <td style={{ padding: '12px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatMoneyAmount(cFlete, curcy)}
                    </td>
                    <td style={{ padding: '12px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatMoneyAmount(gMotico, curcy)}
                    </td>
                    <td style={{ padding: '12px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatMoneyAmount(debeProveedor, curcy)}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={nequiInputVal}
                        disabled={nequiBusy}
                        onChange={(e) => {
                          const v = e.target.value;
                          setPagosNequiDraft((d) => ({ ...d, [ref]: v }));
                          schedulePagosNequiSave(ref, v);
                        }}
                        style={{
                          width: 'min(132px, 22vw)',
                          padding: '7px 9px',
                          borderRadius: 8,
                          border: `1px solid ${ds.borderCard}`,
                          background: ds.bgCard,
                          color: ds.textPrimary,
                          fontSize: 13,
                          textAlign: 'right',
                          fontVariantNumeric: 'tabular-nums',
                          cursor: nequiBusy ? 'wait' : 'text',
                        }}
                      />
                    </td>
                    <td
                      style={{
                        padding: '12px 10px',
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: 600,
                        color: saldoColor,
                      }}
                    >
                      {formatMoneyAmount(saldo, curcy)}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <select
                        value={cur}
                        disabled={busy}
                        onChange={(e) => void onEstadoChange(ref, e.target.value as MoticoRelacionPagoEstado)}
                        style={{
                          width: '100%',
                          maxWidth: 220,
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: `1px solid ${ds.borderCard}`,
                          background: ds.bgCard,
                          color: ds.textPrimary,
                          fontSize: 13,
                          fontWeight: 500,
                          cursor: busy ? 'wait' : 'pointer',
                        }}
                      >
                        {PAGO_ESTADO_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
