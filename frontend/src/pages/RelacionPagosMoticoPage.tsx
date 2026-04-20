import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../auth/api';
import { coerceOrderInternalEstadoForSelect } from '../constants/orderInternalEstado';
import { ds } from '../design-system/ds';
import { IconCart, IconPackage, IconProduct, IconTruck, IconTrendingUp } from '../design-system/icons';
import { KpiCard } from '../design-system/KpiCard';
import { PageHeader } from '../design-system/PageHeader';
import { type DatePreset, DATE_PRESETS, buildDateRange } from '../utils/datePresets';

type MoticoRelacionPagoEstado = 'pendiente_pago' | 'pagado' | 'cancelado' | 'devolucion';

/** Anchos fijos (px) para columnas sticky al scroll horizontal. */
const REL_STICKY_CHK_W = 48;
const REL_STICKY_FECHA_W = 128;
const REL_STICKY_NOMBRE_W = 248;
const REL_STICKY_FECHA_LEFT = REL_STICKY_CHK_W;
const REL_STICKY_NOMBRE_LEFT = REL_STICKY_CHK_W + REL_STICKY_FECHA_W;
const REL_STICKY_SHADOW = '4px 0 14px -6px rgba(15, 23, 42, 0.14)';

function relacionStickyCheckbox(bg: string, z: number): CSSProperties {
  return {
    position: 'sticky',
    left: 0,
    zIndex: z,
    width: REL_STICKY_CHK_W,
    minWidth: REL_STICKY_CHK_W,
    maxWidth: REL_STICKY_CHK_W,
    textAlign: 'center',
    verticalAlign: 'middle',
    background: bg,
    boxShadow: REL_STICKY_SHADOW,
  };
}

function relacionStickyFecha(bg: string, z: number): CSSProperties {
  return {
    position: 'sticky',
    left: REL_STICKY_FECHA_LEFT,
    zIndex: z,
    width: REL_STICKY_FECHA_W,
    minWidth: REL_STICKY_FECHA_W,
    maxWidth: REL_STICKY_FECHA_W,
    background: bg,
    boxShadow: REL_STICKY_SHADOW,
  };
}

function relacionStickyNombre(bg: string, z: number): CSSProperties {
  return {
    position: 'sticky',
    left: REL_STICKY_NOMBRE_LEFT,
    zIndex: z,
    width: REL_STICKY_NOMBRE_W,
    minWidth: REL_STICKY_NOMBRE_W,
    maxWidth: REL_STICKY_NOMBRE_W,
    background: bg,
    boxShadow: REL_STICKY_SHADOW,
  };
}

const SEARCH_DEBOUNCE_MS = 240;

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
  shippingAddress?: { name?: string; phone?: string } | null;
  email?: string;
  phoneLocal?: string;
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

function normalizeSearchText(v: string) {
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function buildNormalizedIndexMap(source: string) {
  const normalizedChars: string[] = [];
  const indexMap: number[] = [];
  for (let i = 0; i < source.length; i += 1) {
    const chunk = source[i]!.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    for (let j = 0; j < chunk.length; j += 1) {
      normalizedChars.push(chunk[j]!);
      indexMap.push(i);
    }
  }
  return { normalized: normalizedChars.join(''), indexMap };
}

/** Mismo criterio visual que Pedidos: coincide ignorando mayúsculas y tildes. */
function highlightText(text: string, rawTerm: string): ReactNode {
  const source = String(text || '');
  const q = String(rawTerm || '').trim();
  if (!source || !q) return source || '—';
  const needle = normalizeSearchText(q);
  if (!needle) return source;
  const { normalized, indexMap } = buildNormalizedIndexMap(source);
  const matchRanges: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (from < normalized.length) {
    const at = normalized.indexOf(needle, from);
    if (at < 0) break;
    const start = indexMap[at];
    const lastNormPos = at + needle.length - 1;
    const end = (indexMap[lastNormPos] ?? source.length - 1) + 1;
    if (start != null && end > start) {
      const prev = matchRanges[matchRanges.length - 1];
      if (prev && start <= prev.end) prev.end = Math.max(prev.end, end);
      else matchRanges.push({ start, end });
    }
    from = at + Math.max(needle.length, 1);
  }
  if (!matchRanges.length) return source;
  const out: ReactNode[] = [];
  let cursor = 0;
  matchRanges.forEach((r, idx) => {
    if (r.start > cursor) {
      out.push(<span key={`t-${idx}`}>{source.slice(cursor, r.start)}</span>);
    }
    out.push(
      <mark
        key={`m-${idx}`}
        style={{ background: '#fff3b0', color: 'inherit', padding: '0 1px', borderRadius: 2 }}
      >
        {source.slice(r.start, r.end)}
      </mark>,
    );
    cursor = r.end;
  });
  if (cursor < source.length) {
    out.push(<span key="t-end">{source.slice(cursor)}</span>);
  }
  return out;
}

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

function relacionRowMatchesSearch(
  o: OrderRow,
  normalizedTerm: string,
  estadoPago: MoticoRelacionPagoEstado,
): boolean {
  if (!normalizedTerm) return true;
  const estadoLabel = PAGO_ESTADO_OPTIONS.find((x) => x.value === estadoPago)?.label || '';
  const shipPhone = String(o.shippingAddress?.phone || '').trim();
  const haystack = normalizeSearchText(
    [
      o.orderName,
      o.client,
      o.email,
      o.shippingAddress?.name,
      o.phoneLocal,
      shipPhone,
      String(o.financialStatus || ''),
      estadoLabel,
      String(relacionPrecioTotal(o)),
      String(numOrZero(o.product_cost_motico)),
      String(numOrZero(o.freight_cost_motico)),
    ]
      .filter(Boolean)
      .join(' '),
  );
  if (haystack.includes(normalizedTerm)) return true;
  const idLike = String(o.id ?? '');
  return normalizeSearchText(idLike).includes(normalizedTerm) || idLike.includes(normalizedTerm);
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
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(() => new Set());
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const nequiTimersRef = useRef<Record<string, ReturnType<typeof setTimeout> | undefined>>({});
  const headerSelectAllRef = useRef<HTMLInputElement>(null);

  const dateQuery = useMemo(
    () => buildDateRange(datePreset, customFrom, customTo),
    [datePreset, customFrom, customTo],
  );

  const baseRows = useMemo(() => {
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

  useEffect(() => {
    const id = window.setTimeout(() => {
      setSearchTerm(searchInput);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  const normalizedSearchTerm = useMemo(() => normalizeSearchText(searchTerm), [searchTerm]);

  const rows = useMemo(
    () =>
      baseRows.filter((o) => {
        const ref = orderRef(o);
        const est = estadoByRef[ref] || 'pendiente_pago';
        return relacionRowMatchesSearch(o, normalizedSearchTerm, est);
      }),
    [baseRows, normalizedSearchTerm, estadoByRef],
  );

  useEffect(() => {
    const allowed = new Set(rows.map((o) => orderRef(o)));
    setSelectedRefs((prev) => {
      const next = new Set<string>();
      for (const r of prev) {
        if (allowed.has(r)) next.add(r);
      }
      if (next.size === prev.size && [...prev].every((x) => next.has(x))) return prev;
      return next;
    });
  }, [rows]);

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

  const defaultCurrency = useMemo(
    () => rows[0]?.currency || baseRows[0]?.currency || 'COP',
    [rows, baseRows],
  );

  const relacionPagosKpis = useMemo(() => {
    let totalVentasDespachado = 0;
    let totalGananciaMotico = 0;
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
      totalGananciaMotico += gananciaMotico(o);
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
      totalGananciaMotico,
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

  const allRowsSelected = rows.length > 0 && rows.every((o) => selectedRefs.has(orderRef(o)));
  const someRowsSelected = rows.some((o) => selectedRefs.has(orderRef(o)));

  useLayoutEffect(() => {
    const el = headerSelectAllRef.current;
    if (el) el.indeterminate = someRowsSelected && !allRowsSelected;
  }, [someRowsSelected, allRowsSelected, rows.length]);

  const toggleRowSelected = useCallback((ref: string, checked: boolean) => {
    setSelectedRefs((prev) => {
      const next = new Set(prev);
      if (checked) next.add(ref);
      else next.delete(ref);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedRefs((prev) => {
      const ids = rows.map(orderRef);
      const all = ids.length > 0 && ids.every((id) => prev.has(id));
      if (all) return new Set();
      return new Set(ids);
    });
  }, [rows]);

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
            ? `Pedidos con mensajero Motico y estado Despachado · ${shopDomain}. El estado de la última columna es el seguimiento de cobro a Motico.${
                normalizeSearchText(searchInput) ? ' · Búsqueda activa' : ''
              }`
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
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Buscar pedido, cliente, correo, teléfono, estado cobro…"
          style={{
            marginLeft: 'auto',
            minWidth: 220,
            maxWidth: 340,
            flex: '1 1 200px',
            padding: '7px 10px',
            borderRadius: 8,
            border: `1px solid ${ds.borderCard}`,
            background: ds.bgCard,
            color: ds.textPrimary,
            fontSize: 12,
          }}
        />
        <Link to="/pedidos" style={{ fontSize: 12, color: ds.brand, fontWeight: 600, whiteSpace: 'nowrap' }}>
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
              variant="stock"
              label="Total ganancia Motico"
              value={
                <span
                  style={{
                    color:
                      relacionPagosKpis.totalGananciaMotico > 0
                        ? ds.successText
                        : relacionPagosKpis.totalGananciaMotico < 0
                          ? ds.dangerText
                          : ds.textPrimary,
                  }}
                >
                  {formatMoneyAmount(relacionPagosKpis.totalGananciaMotico, defaultCurrency)}
                </span>
              }
              icon={<IconProduct />}
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
      ) : shopifyConnected && baseRows.length === 0 ? (
        <div style={{ color: ds.textSecondary, fontSize: 14 }}>
          No hay pedidos Despachado con mensajero Motico en el rango seleccionado.
        </div>
      ) : shopifyConnected && rows.length === 0 ? (
        <div style={{ color: ds.textSecondary, fontSize: 14 }}>
          Ningún pedido coincide con la búsqueda. Prueba con otro texto o borra el filtro.
        </div>
      ) : shopifyConnected ? (
        <div>
          {rows.length > 0 ? (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 10,
                marginBottom: 10,
                fontSize: 13,
                color: ds.textSecondary,
              }}
            >
              <span>
                {selectedRefs.size > 0 ? (
                  <>
                    <strong style={{ color: ds.textPrimary }}>{selectedRefs.size}</strong> pedido
                    {selectedRefs.size === 1 ? '' : 's'} seleccionado
                    {selectedRefs.size === 1 ? '' : 's'}
                  </>
                ) : (
                  <>Selecciona pedidos con la casilla de la izquierda.</>
                )}
              </span>
              {selectedRefs.size > 0 ? (
                <button
                  type="button"
                  onClick={() => setSelectedRefs(new Set())}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: `1px solid ${ds.borderCard}`,
                    background: ds.bgCard,
                    color: ds.brand,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Quitar selección
                </button>
              ) : null}
            </div>
          ) : null}
          <div style={{ overflowX: 'auto', borderRadius: 12, border: `1px solid ${ds.borderCard}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 1448 }}>
            <thead>
              <tr style={{ background: ds.bgSubtle }}>
                <th style={{ ...relacionStickyCheckbox(ds.bgSubtle, 12), padding: '10px 4px' }}>
                  <input
                    ref={headerSelectAllRef}
                    type="checkbox"
                    checked={allRowsSelected}
                    onChange={() => toggleSelectAll()}
                    disabled={rows.length === 0}
                    aria-label="Seleccionar o anular todos los pedidos visibles"
                    style={{ width: 16, height: 16, cursor: rows.length === 0 ? 'default' : 'pointer' }}
                  />
                </th>
                <th
                  title="Momento en que el pedido pasó por última vez a estado operativo Despachado"
                  style={{
                    ...relacionStickyFecha(ds.bgSubtle, 11),
                    textAlign: 'left',
                    padding: '12px 10px',
                    fontWeight: 700,
                    color: ds.textPrimary,
                    whiteSpace: 'nowrap',
                  }}
                >
                  Fecha
                </th>
                <th
                  style={{
                    ...relacionStickyNombre(ds.bgSubtle, 10),
                    textAlign: 'left',
                    padding: '12px 12px',
                    fontWeight: 700,
                    color: ds.textPrimary,
                  }}
                >
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
                const rowBg = idx % 2 === 0 ? ds.bgCard : ds.bgSubtle;
                const isSelected = selectedRefs.has(ref);
                const fechaDisplay = formatFechaUltimoDespachado(o.last_despachado_at);
                const orderSub = `${o.orderName || `#${o.id}`}${o.is_motico_manual ? ' · Manual' : ''}`;
                return (
                  <tr
                    key={ref}
                    style={{
                      borderTop: `1px solid ${ds.borderCard}`,
                      background: rowBg,
                      outline: isSelected ? `2px solid ${ds.brand}` : undefined,
                      outlineOffset: -2,
                    }}
                  >
                    <td style={{ ...relacionStickyCheckbox(rowBg, 6), padding: '10px 4px' }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => toggleRowSelected(ref, e.target.checked)}
                        aria-label={`Seleccionar pedido ${o.orderName || ref}`}
                        style={{ width: 16, height: 16, cursor: 'pointer' }}
                      />
                    </td>
                    <td
                      title="Último estado Despachado"
                      style={{
                        ...relacionStickyFecha(rowBg, 5),
                        padding: '12px 10px',
                        color: ds.textSecondary,
                        fontSize: 12,
                        whiteSpace: 'nowrap',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {highlightText(fechaDisplay, searchTerm)}
                    </td>
                    <td
                      style={{
                        ...relacionStickyNombre(rowBg, 4),
                        padding: '10px 12px',
                        color: ds.textPrimary,
                        fontWeight: 500,
                        verticalAlign: 'top',
                      }}
                    >
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {highlightText(nombre, searchTerm)}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: ds.textMuted,
                          marginTop: 4,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {highlightText(orderSub, searchTerm)}
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
        </div>
      ) : null}
    </div>
  );
}
