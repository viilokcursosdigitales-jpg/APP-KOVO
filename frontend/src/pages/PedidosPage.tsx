import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';
import { KpiCard } from '../design-system/KpiCard';
import { DataTable, Th, Td, tableBase } from '../design-system/DataTable';
import { IconCart, IconPencil, IconTruck } from '../design-system/icons';
import {
  orderListStickyCheckboxTd,
  orderListStickyCheckboxTh,
  orderListStickyEstadoTd,
  orderListStickyEstadoTh,
  orderListTableScrollWrapperStyle,
  orderListTheadStickyCell,
} from '../design-system/orderListTableScroll';
import { PageHeader } from '../design-system/PageHeader';
import { StatusBadge, type StatusBadgeVariant } from '../design-system/StatusBadge';
import { type DatePreset, DATE_PRESETS, buildDateRange } from '../utils/datePresets';
import {
  ORDER_INTERNAL_ESTADO_OPTIONS as INTERNAL_OPTIONS,
  type OrderInternalEstadoValue as InternalStatusValue,
  ORDER_INTERNAL_LOCKED_STATUSES,
  coerceOrderInternalEstadoForSelect,
} from '../constants/orderInternalEstado';

const POLL_MS = 40_000;
const SAVE_DEBOUNCE_MS = 450;
const SEARCH_DEBOUNCE_MS = 240;

const DEMO = [
  { id: '#4821', client: 'María G.', email: 'maria@mail.com', date: '11 abr 2026', total: '€ 124,90', st: 'success' as const, lb: 'Completado' },
  { id: '#4820', client: 'Pedro L.', email: 'pedro@mail.com', date: '11 abr 2026', total: '€ 89,00', st: 'info' as const, lb: 'En proceso' },
  { id: '#4819', client: 'Ana R.', email: 'ana@mail.com', date: '10 abr 2026', total: '€ 210,50', st: 'success' as const, lb: 'Completado' },
  { id: '#4818', client: 'Luis M.', email: 'luis@mail.com', date: '10 abr 2026', total: '€ 45,00', st: 'paused' as const, lb: 'Pendiente' },
  { id: '#4817', client: 'Elena S.', email: 'elena@mail.com', date: '09 abr 2026', total: '€ 312,00', st: 'error' as const, lb: 'Cancelado' },
];

const MENSAJERO_OPTIONS = [
  { value: 'motico', label: 'Motico' },
  { value: 'effix', label: 'Effix' },
  { value: 'dropi', label: 'Dropi' },
] as const;

/** Ancho mínimo del desplegable Estado según la etiqueta más larga (+ flecha). */
const ESTADO_SELECT_MIN_WIDTH_CH = Math.max(...INTERNAL_OPTIONS.map((o) => o.label.length), 1) + 3;
/** Ancho mínimo del desplegable Mensajero según la etiqueta más larga (+ flecha). */
const MENSAJERO_SELECT_MIN_WIDTH_CH =
  Math.max('Sin asignar'.length, ...MENSAJERO_OPTIONS.map((o) => o.label.length), 1) + 3;

const LOCKED_INTERNAL_STATUSES = ORDER_INTERNAL_LOCKED_STATUSES;

function isOrderLockedByInternalStatus(internalStatus: string) {
  const s = String(internalStatus || '').toLowerCase() as InternalStatusValue;
  return LOCKED_INTERNAL_STATUSES.has(s);
}

function isOrderManagedByMotico(row: Pick<ShopifyOrderRow, 'internal_status' | 'mensajero'>) {
  const st = String(row.internal_status || '').toLowerCase();
  const mensajero = String(row.mensajero || '').toLowerCase();
  return st === 'motico' || mensajero === 'motico';
}

function isOrderLockedInPedidos(row: Pick<ShopifyOrderRow, 'internal_status' | 'mensajero'>) {
  return isOrderLockedByInternalStatus(row.internal_status) || isOrderManagedByMotico(row);
}

function isPedidosPruebaOrder(row: Pick<ShopifyOrderRow, 'internal_status' | 'motico_status'>) {
  const st = String(row.internal_status || row.motico_status || '').trim().toLowerCase();
  return st === 'prueba';
}

/** Tooltip cuando la fila no es editable desde Pedidos (incluye gestión Motico por mensajero). */
function pedidosRowLockTitle(row: ShopifyOrderRow, kind: 'estado' | 'mensajero' | 'precio' | 'cantidad'): string {
  if (isOrderManagedByMotico(row)) {
    return 'Gestionado por Motico: no editable desde Pedidos';
  }
  if (kind === 'precio' || kind === 'cantidad') {
    return 'Pedido despachado/cancelado: edición bloqueada';
  }
  return kind === 'estado' ? 'Pedido bloqueado: estado no editable' : 'Pedido bloqueado: mensajero no editable';
}

type ShopifyOrderRow = {
  id: number;
  orderName: string;
  client: string;
  email: string;
  createdAt: string;
  total: string;
  currency: string;
  financialStatus: string;
  /** Override KOVO/Motico en `shopify_order_local_fields`; null si no aplica. */
  payment_status_override?: string | null;
  label: string;
  badgeVariant: StatusBadgeVariant;
  defaultQuantity: number;
  productIds?: number[];
  internal_status: string;
  price_override: number | null;
  quantity_override: number | null;
  mensajero: string | null;
  motico_status?: string;
  shopifyTotal: string;
  shopifyQuantity: number;
  shippingCity?: string;
  shippingProvince?: string;
  shippingAddressLine?: string;
  /** Solo dígitos, sin +57 (viene del backend). */
  phoneLocal?: string;
};

type ShopifyOrdersPayload = {
  source: string;
  shop_domain: string;
  fetchedAt: string;
  orders: ShopifyOrderRow[];
};

function formatMoneyAmount(n: number, currency: string) {
  const cur = currency && currency.length === 3 ? currency : 'EUR';
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: cur }).format(n);
  } catch {
    return `${n} ${currency}`;
  }
}

function formatMoneyFromString(total: string, currency: string) {
  const n = Number.parseFloat(String(total));
  if (Number.isNaN(n)) return String(total);
  return formatMoneyAmount(n, currency);
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function orderMatchesFilter(row: ShopifyOrderRow, filter: 'all' | 'active' | 'done') {
  const f = row.financialStatus.toLowerCase();
  if (filter === 'all') return true;
  if (filter === 'done') return f === 'paid';
  return f !== 'paid' && f !== 'refunded' && f !== 'voided';
}

function cityKeyFromRow(row: ShopifyOrderRow) {
  return String(row.shippingCity || '')
    .trim()
    .toLowerCase();
}

function orderMatchesCityFilter(row: ShopifyOrderRow, selectedKeys: ReadonlySet<string>) {
  if (!selectedKeys.size) return true;
  const k = cityKeyFromRow(row);
  if (!k) return false;
  return selectedKeys.has(k);
}

function normalizeSearchText(v: string) {
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function orderMatchesTextFilter(row: ShopifyOrderRow, normalizedTerm: string) {
  if (!normalizedTerm) return true;
  const haystack = normalizeSearchText(
    [
      row.orderName,
      row.client,
      row.email,
      row.phoneLocal,
      row.shippingCity,
      row.shippingProvince,
      row.shippingAddressLine,
      row.financialStatus,
      row.internal_status,
    ]
      .filter(Boolean)
      .join(' '),
  );
  if (haystack.includes(normalizedTerm)) return true;
  const idLike = String(row.id || '');
  return idLike.includes(normalizedTerm);
}

function escapeRegExp(v: string) {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function highlightText(text: string, rawTerm: string) {
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
  const out: JSX.Element[] = [];
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

const selectStyle: CSSProperties = {
  width: '100%',
  maxWidth: 160,
  padding: '6px 8px',
  borderRadius: 8,
  border: `1px solid ${ds.borderCard}`,
  background: ds.bgCard,
  color: ds.textPrimary,
  fontSize: 11,
  fontWeight: 600,
};

/** Columna teléfono: solo el ancho del número (+ padding 5px a cada lado en la celda). */
const phoneColumnThStyle: CSSProperties = {
  ...orderListTheadStickyCell,
  width: '1%',
  whiteSpace: 'nowrap',
  padding: '11px 5px',
};

const phoneColumnTdStyle: CSSProperties = {
  width: '1%',
  whiteSpace: 'nowrap',
  padding: '12px 5px',
  verticalAlign: 'middle',
};

/** Select Estado en tabla: ancho según texto, sin tope artificial. */
const estadoSelectInTableStyle: CSSProperties = {
  ...selectStyle,
  width: 'auto',
  maxWidth: 'none',
  minWidth: `${ESTADO_SELECT_MIN_WIDTH_CH}ch`,
  boxSizing: 'border-box',
};

/** Columna Mensajero: ancho según texto más largo + padding L/R 10px. */
const mensajeroColumnThStyle: CSSProperties = {
  ...orderListTheadStickyCell,
  width: '1%',
  whiteSpace: 'nowrap',
  padding: '8px 10px',
};
const mensajeroColumnTdStyle: CSSProperties = {
  width: '1%',
  whiteSpace: 'nowrap',
  padding: '8px 10px',
  verticalAlign: 'middle',
};
/** Select Mensajero en tabla: ancho según texto, sin tope artificial. */
const mensajeroSelectInTableStyle: CSSProperties = {
  ...selectStyle,
  width: 'auto',
  maxWidth: 'none',
  minWidth: `${MENSAJERO_SELECT_MIN_WIDTH_CH}ch`,
  boxSizing: 'border-box',
};

const PEDIDOS_ESTADO_COL_PX = 172;
const pedidosEditColTh: CSSProperties = {
  ...orderListTheadStickyCell,
  width: '1%',
  whiteSpace: 'nowrap',
  padding: '8px 10px',
  textAlign: 'center',
};
const pedidosEditColTd: CSSProperties = {
  width: '1%',
  whiteSpace: 'nowrap',
  padding: '8px 10px',
  textAlign: 'center',
  verticalAlign: 'middle',
};

/** Colores del desplegable Estado (valor seleccionado). */
function estadoSelectStyle(internalStatus: string): CSSProperties {
  switch (internalStatus) {
    case 'sin_revisar':
      return {
        background: '#f3f4f6',
        color: '#4b5563',
        borderColor: '#d1d5db',
      };
    case 'sin_confirmar':
      return {
        background: '#ffedd5',
        color: '#9a3412',
        borderColor: '#fdba74',
      };
    case 'motico':
      return {
        background: '#ede9fe',
        color: '#5b21b6',
        borderColor: '#c4b5fd',
      };
    case 'confirmado':
      return {
        background: '#d8f5e4',
        color: '#0d5c36',
        borderColor: '#86efac',
      };
    case 'despachado':
      return {
        background: '#6CC832',
        color: '#0f2907',
        borderColor: '#58a628',
      };
    case 'prueba':
      return {
        background: '#f3f4f6',
        color: '#6b7280',
        borderColor: '#e5e7eb',
      };
    case 'cancelado':
      return {
        background: '#fecaca',
        color: '#991b1b',
        borderColor: '#f87171',
      };
    default:
      return {};
  }
}

function estadoOptionStyle(value: string): CSSProperties {
  const s = estadoSelectStyle(value);
  return { backgroundColor: s.background as string, color: s.color as string };
}

function mensajeroSelectStyle(mensajero: string | null | undefined): CSSProperties {
  const v = String(mensajero || '').toLowerCase();
  if (v === 'motico') return { background: '#ede9fe', color: '#5b21b6', borderColor: '#c4b5fd' };
  if (v === 'effix') return { background: '#e0f2fe', color: '#075985', borderColor: '#7dd3fc' };
  if (v === 'dropi') return { background: '#dcfce7', color: '#166534', borderColor: '#86efac' };
  return {};
}

function mensajeroOptionStyle(value: string): CSSProperties {
  const s = mensajeroSelectStyle(value);
  return { backgroundColor: s.background as string, color: s.color as string };
}

const inputStyle: CSSProperties = {
  width: '100%',
  maxWidth: 96,
  padding: '6px 8px',
  borderRadius: 8,
  border: `1px solid ${ds.borderCard}`,
  background: ds.bgCard,
  color: ds.textPrimary,
  fontSize: 12,
};

export default function PedidosPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'all' | 'active' | 'done'>('all');
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('hoy');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopDomain, setShopDomain] = useState<string | null>(null);
  const [shopifyOrders, setShopifyOrders] = useState<ShopifyOrderRow[]>([]);
  const [shopifyLoading, setShopifyLoading] = useState(false);
  const [shopifyError, setShopifyError] = useState('');
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCityKeys, setSelectedCityKeys] = useState<string[]>([]);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<number>>(() => new Set());
  const [bulkInternalStatus, setBulkInternalStatus] = useState<InternalStatusValue>('sin_revisar');
  const [bulkStatusApplying, setBulkStatusApplying] = useState(false);
  const [bulkStatusFeedback, setBulkStatusFeedback] = useState('');
  const [cityMenuOpen, setCityMenuOpen] = useState(false);
  const cityFilterWrapRef = useRef<HTMLDivElement>(null);
  const selectAllCheckboxRef = useRef<HTMLInputElement>(null);
  const [phoneCopyToastVisible, setPhoneCopyToastVisible] = useState(false);
  const phoneCopyToastTimerRef = useRef<number | null>(null);

  const bulkActionBusy = bulkStatusApplying;

  const [priceDraft, setPriceDraft] = useState<Record<number, string>>({});
  const [qtyDraft, setQtyDraft] = useState<Record<number, string>>({});
  const [unlockOrder, setUnlockOrder] = useState<ShopifyOrderRow | null>(null);
  const [unlockReason, setUnlockReason] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const priceTimers = useRef<Map<number, number>>(new Map());
  const qtyTimers = useRef<Map<number, number>>(new Map());
  const ordersRequestAbortRef = useRef<AbortController | null>(null);
  const ordersRequestSeqRef = useRef(0);
  const ordersCacheRef = useRef<
    Map<string, { shopDomain: string | null; fetchedAt: string | null; orders: ShopifyOrderRow[] }>
  >(new Map());

  const dateQuery = useMemo(
    () => buildDateRange(datePreset, customFrom, customTo),
    [datePreset, customFrom, customTo],
  );

  const normalizeRow = useCallback((o: ShopifyOrderRow): ShopifyOrderRow => {
    const bv = o.badgeVariant;
    const safeBv = (['success', 'paused', 'error', 'info', 'warning'].includes(bv) ? bv : 'info') as StatusBadgeVariant;
    return {
      ...o,
      badgeVariant: safeBv,
      defaultQuantity: Number(o.defaultQuantity) || 0,
      shopifyQuantity: Number(o.shopifyQuantity ?? o.defaultQuantity) || 0,
      internal_status: coerceOrderInternalEstadoForSelect(o.internal_status),
      price_override: o.price_override != null ? Number(o.price_override) : null,
      quantity_override: o.quantity_override != null ? Number(o.quantity_override) : null,
      mensajero: o.mensajero || null,
      motico_status: coerceOrderInternalEstadoForSelect(o.motico_status ?? o.internal_status),
      productIds: Array.isArray(o.productIds) ? o.productIds : [],
      shippingCity: o.shippingCity || '',
      shippingProvince: o.shippingProvince || '',
      shippingAddressLine: o.shippingAddressLine || '',
      phoneLocal: typeof o.phoneLocal === 'string' ? o.phoneLocal.trim() : '',
      payment_status_override:
        o.payment_status_override != null && String(o.payment_status_override).trim() !== ''
          ? String(o.payment_status_override).toLowerCase().trim()
          : null,
    };
  }, []);

  const copyPhoneToClipboard = useCallback((digits: string) => {
    const t = digits.trim();
    if (!t) return;
    if (phoneCopyToastTimerRef.current != null) {
      window.clearTimeout(phoneCopyToastTimerRef.current);
      phoneCopyToastTimerRef.current = null;
    }
    void navigator.clipboard.writeText(t).then(
      () => {
        setPhoneCopyToastVisible(true);
        phoneCopyToastTimerRef.current = window.setTimeout(() => {
          setPhoneCopyToastVisible(false);
          phoneCopyToastTimerRef.current = null;
        }, 2600);
      },
      () => {
        window.alert('No se pudo copiar. Comprueba los permisos del navegador.');
      },
    );
  }, []);

  useEffect(() => {
    return () => {
      if (phoneCopyToastTimerRef.current != null) window.clearTimeout(phoneCopyToastTimerRef.current);
    };
  }, []);

  const loadShopifyOrders = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = Boolean(opts?.silent);
      const cacheKey = `${dateQuery.min || ''}|${dateQuery.max || ''}`;
      const cached = ordersCacheRef.current.get(cacheKey);
      if (cached && !silent) {
        setShopifyConnected(true);
        setShopDomain(cached.shopDomain);
        setFetchedAt(cached.fetchedAt);
        setShopifyOrders(cached.orders);
        setShopifyLoading(false);
        setRefreshing(true);
      } else if (!silent) {
        setShopifyLoading(true);
      } else {
        setRefreshing(true);
      }
      setShopifyError('');
      ordersRequestAbortRef.current?.abort();
      const abortController = new AbortController();
      ordersRequestAbortRef.current = abortController;
      const requestSeq = ordersRequestSeqRef.current + 1;
      ordersRequestSeqRef.current = requestSeq;
      try {
        const qs = new URLSearchParams();
        if (dateQuery.min) qs.set('created_at_min', dateQuery.min);
        if (dateQuery.max) qs.set('created_at_max', dateQuery.max);
        const res = await apiFetch(`/api/shopify/orders?${qs.toString()}`, { signal: abortController.signal });
        if (ordersRequestSeqRef.current !== requestSeq) return;
        const data = (await res.json().catch(() => ({}))) as ShopifyOrdersPayload & {
          error?: string;
          code?: string;
        };
        if (!res.ok) {
          if (data.code === 'not_connected') {
            setShopifyConnected(false);
            setShopDomain(null);
            setShopifyOrders([]);
            setFetchedAt(null);
            return;
          }
          setShopifyError(typeof data.error === 'string' ? data.error : 'No se pudieron cargar los pedidos');
          return;
        }
        if (data.source === 'shopify' && Array.isArray(data.orders)) {
          const normalized = data.orders.map(normalizeRow);
          setShopifyConnected(true);
          setShopDomain(data.shop_domain || null);
          setFetchedAt(data.fetchedAt || null);
          setShopifyOrders(normalized);
          ordersCacheRef.current.set(cacheKey, {
            shopDomain: data.shop_domain || null,
            fetchedAt: data.fetchedAt || null,
            orders: normalized,
          });
          setPriceDraft({});
          setQtyDraft({});
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setShopifyError('Error de red al cargar pedidos de Shopify');
      } finally {
        if (ordersRequestSeqRef.current === requestSeq) {
          if (!silent) setShopifyLoading(false);
          setRefreshing(false);
          if (ordersRequestAbortRef.current === abortController) {
            ordersRequestAbortRef.current = null;
          }
        }
      }
    },
    [dateQuery.min, dateQuery.max, normalizeRow],
  );

  const patchLocalFields = useCallback(async (orderId: number, body: Record<string, unknown>) => {
    const res = await apiFetch(`/api/shopify/orders/${orderId}/local-fields`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setShopifyError(typeof err.error === 'string' ? err.error : 'No se pudo guardar el pedido');
      return false;
    }
    const data = (await res.json().catch(() => ({}))) as {
      internal_status?: string;
      price_override?: number | null;
      quantity_override?: number | null;
      mensajero?: string | null;
      motico_status?: string;
      financial_status?: string | null;
      payment_status_override?: string | null;
      label?: string | null;
      badgeVariant?: StatusBadgeVariant | null;
    };
    setShopifyError('');
    setShopifyOrders((prev) =>
      prev.map((o) => {
        if (o.id !== orderId) return o;
        const hasEstadoSync = data.internal_status !== undefined || data.motico_status !== undefined;
        const nextEstado = hasEstadoSync
          ? coerceOrderInternalEstadoForSelect(
              String(data.internal_status ?? data.motico_status ?? o.internal_status),
            )
          : null;
        const patch: Partial<ShopifyOrderRow> = {};
        if (nextEstado !== null) {
          patch.internal_status = nextEstado;
          patch.motico_status = nextEstado;
        }
        if (data.price_override !== undefined) patch.price_override = data.price_override;
        if (data.quantity_override !== undefined) patch.quantity_override = data.quantity_override;
        if (data.mensajero !== undefined) patch.mensajero = data.mensajero;
        if (data.financial_status !== undefined) {
          const fs = String(data.financial_status || '').toLowerCase().trim() || 'pending';
          patch.financialStatus = ['pending', 'paid', 'refunded', 'double_freight', 'cancelado'].includes(fs)
            ? fs
            : o.financialStatus;
        }
        if (data.label !== undefined && data.label != null && String(data.label).trim() !== '') {
          patch.label = String(data.label);
        }
        if (data.badgeVariant !== undefined && data.badgeVariant != null) {
          const bv = String(data.badgeVariant);
          if (['success', 'paused', 'error', 'info', 'warning'].includes(bv)) {
            patch.badgeVariant = bv as StatusBadgeVariant;
          }
        }
        if (data.payment_status_override !== undefined) {
          patch.payment_status_override =
            data.payment_status_override != null && String(data.payment_status_override).trim() !== ''
              ? String(data.payment_status_override).toLowerCase().trim()
              : null;
        }
        return { ...o, ...patch };
      }),
    );
    setPriceDraft((d) => {
      const n = { ...d };
      delete n[orderId];
      return n;
    });
    setQtyDraft((d) => {
      const n = { ...d };
      delete n[orderId];
      return n;
    });
    return true;
  }, []);

  const applyBulkInternalStatus = useCallback(async () => {
    const editableIds = [...selectedOrderIds].filter((id) => {
      const row = shopifyOrders.find((o) => o.id === id);
      return row ? !isOrderLockedInPedidos(row) : false;
    });
    if (editableIds.length === 0) return;
    const ids = editableIds;
    setBulkStatusApplying(true);
    setBulkStatusFeedback('');
    try {
      const results = await Promise.all(ids.map((id) => patchLocalFields(id, { internal_status: bulkInternalStatus })));
      const ok = results.filter(Boolean).length;
      const fail = ids.length - ok;
      if (fail > 0) {
        setBulkStatusFeedback(`${ok} actualizado(s), ${fail} error(es). Revisa la conexión o vuelve a intentar.`);
      } else {
        setBulkStatusFeedback(`${ok} pedido${ok === 1 ? '' : 's'} con estado ${INTERNAL_OPTIONS.find((o) => o.value === bulkInternalStatus)?.label ?? bulkInternalStatus}.`);
      }
      window.setTimeout(() => setBulkStatusFeedback(''), 6000);
    } finally {
      setBulkStatusApplying(false);
    }
  }, [selectedOrderIds, shopifyOrders, bulkInternalStatus, patchLocalFields]);

  const schedulePriceSave = useCallback(
    (orderId: number, raw: string) => {
      const prevT = priceTimers.current.get(orderId);
      if (prevT) window.clearTimeout(prevT);
      const t = window.setTimeout(() => {
        priceTimers.current.delete(orderId);
        const trimmed = raw.trim();
        if (trimmed === '') {
          void patchLocalFields(orderId, { price_override: null });
          return;
        }
        const n = Number.parseFloat(trimmed.replace(',', '.'));
        if (!Number.isFinite(n) || n < 0) return;
        void patchLocalFields(orderId, { price_override: n });
      }, SAVE_DEBOUNCE_MS);
      priceTimers.current.set(orderId, t);
    },
    [patchLocalFields],
  );

  const scheduleQtySave = useCallback(
    (orderId: number, raw: string) => {
      const prevT = qtyTimers.current.get(orderId);
      if (prevT) window.clearTimeout(prevT);
      const t = window.setTimeout(() => {
        qtyTimers.current.delete(orderId);
        const trimmed = raw.trim();
        if (trimmed === '') {
          void patchLocalFields(orderId, { quantity_override: null });
          return;
        }
        const q = parseInt(trimmed, 10);
        if (!Number.isFinite(q) || q < 0) return;
        void patchLocalFields(orderId, { quantity_override: q });
      }, SAVE_DEBOUNCE_MS);
      qtyTimers.current.set(orderId, t);
    },
    [patchLocalFields],
  );

  const handleInternalStatusChange = useCallback(
    async (row: ShopifyOrderRow, nextStatus: string) => {
      if (isOrderLockedInPedidos(row)) {
        setShopifyError('Este pedido no se puede editar desde Pedidos.');
        return;
      }
      await patchLocalFields(row.id, { internal_status: nextStatus });
    },
    [patchLocalFields],
  );

  const handleMensajeroChange = useCallback(
    async (row: ShopifyOrderRow, nextMensajero: string) => {
      if (isOrderLockedInPedidos(row)) {
        setShopifyError('Este pedido no se puede editar desde Pedidos.');
        return;
      }
      await patchLocalFields(row.id, { mensajero: nextMensajero || null });
    },
    [patchLocalFields],
  );

  const handleOpenOrderEdit = useCallback((row: ShopifyOrderRow) => {
    const st = String(row.internal_status || '').toLowerCase() as InternalStatusValue;
    if (row.id < 0) {
      setShopifyError('Edita desde el módulo Motico.');
      return;
    }
    if (isOrderManagedByMotico(row)) {
      setShopifyError('Edita desde el módulo Motico.');
      return;
    }
    if (st === 'despachado' || st === 'cancelado') {
      setUnlockOrder(row);
      setUnlockReason('');
      setShopifyError('');
      return;
    }
    navigate(`/pedidos/editar/${row.id}`);
  }, [navigate]);

  const submitUnlockDespachado = useCallback(async () => {
    if (!unlockOrder) return;
    if (isOrderManagedByMotico(unlockOrder)) {
      setShopifyError('Este pedido está gestionado por Motico; desbloquea o edita desde el módulo Motico.');
      return;
    }
    const reason = unlockReason.trim();
    if (reason.length < 5) {
      setShopifyError('Escribe un motivo de desbloqueo (mínimo 5 caracteres).');
      return;
    }
    setUnlocking(true);
    try {
      const ok = await patchLocalFields(unlockOrder.id, {
        internal_status: 'sin_revisar',
        unlock_reason: reason,
      });
      if (!ok) return;
      setUnlockOrder(null);
      setUnlockReason('');
      navigate(`/pedidos/editar/${unlockOrder.id}`);
    } finally {
      setUnlocking(false);
    }
  }, [navigate, patchLocalFields, unlockOrder, unlockReason]);

  useEffect(() => {
    return () => {
      priceTimers.current.forEach((id) => window.clearTimeout(id));
      qtyTimers.current.forEach((id) => window.clearTimeout(id));
      ordersRequestAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setSearchTerm(searchInput);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/shopify/connection');
        if (cancelled) return;
        if (!res.ok) {
          setShopifyConnected(false);
          return;
        }
        const row = (await res.json()) as { status?: string; shop_domain?: string | null };
        const ok = row.status === 'connected' && Boolean(row.shop_domain);
        setShopifyConnected(ok);
        setShopDomain(ok ? row.shop_domain || null : null);
      } catch {
        if (!cancelled) setShopifyConnected(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!shopifyConnected) return;
    void loadShopifyOrders();
  }, [dateQuery.min, dateQuery.max, shopifyConnected, loadShopifyOrders]);

  useEffect(() => {
    if (!shopifyConnected) return;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      void loadShopifyOrders({ silent: true });
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [shopifyConnected, loadShopifyOrders]);

  const cityOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of shopifyOrders) {
      const label = String(r.shippingCity || '').trim();
      if (!label) continue;
      const k = label.toLowerCase();
      if (!m.has(k)) m.set(k, label);
    }
    return [...m.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], 'es'))
      .map(([value, label]) => ({ value, label }));
  }, [shopifyOrders]);

  useEffect(() => {
    const valid = new Set(cityOptions.map((c) => c.value));
    setSelectedCityKeys((prev) => prev.filter((k) => valid.has(k)));
  }, [cityOptions]);

  const selectedCityKeySet = useMemo(() => new Set(selectedCityKeys), [selectedCityKeys]);
  const normalizedSearchTerm = useMemo(() => normalizeSearchText(searchTerm), [searchTerm]);

  useEffect(() => {
    if (!cityMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const el = cityFilterWrapRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) setCityMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [cityMenuOpen]);

  const filteredShopify = useMemo(
    () =>
      shopifyOrders.filter(
        (r) =>
          orderMatchesFilter(r, filter) &&
          orderMatchesCityFilter(r, selectedCityKeySet) &&
          orderMatchesTextFilter(r, normalizedSearchTerm),
      ),
    [shopifyOrders, filter, selectedCityKeySet, normalizedSearchTerm],
  );

  const pedidosKpis = useMemo(() => {
    const calculable = filteredShopify.filter((o) => !isPedidosPruebaOrder(o));
    const despachados = calculable.filter((o) => String(o.internal_status || '') === 'despachado');
    const pedidosWhatsapp = filteredShopify.filter((o) => o.id < 0).length;
    const totalPedidos = calculable.length;
    const pedidosMotico = calculable.filter((o) => o.mensajero === 'motico').length;
    const pedidosNoConfirmados = calculable.filter(
      (o) => coerceOrderInternalEstadoForSelect(o.internal_status) === 'sin_confirmar',
    ).length;
    const pedidosDespachados = despachados.length;
    const totalVentasDespachado = despachados.reduce((sum, o) => {
      const raw = o.price_override != null ? Number(o.price_override) : Number.parseFloat(String(o.shopifyTotal ?? o.total ?? '0'));
      const val = Number.isFinite(raw) ? raw : 0;
      return sum + val;
    }, 0);
    const totalVentasDespachadoCurrency =
      String(despachados[0]?.currency || calculable[0]?.currency || 'COP')
        .trim()
        .toUpperCase() || 'COP';
    const pedidosCancelados = calculable.filter((o) => String(o.internal_status || '') === 'cancelado').length;
    const pedidosSinDespachar = calculable.filter((o) => {
      const st = String(o.internal_status || '');
      return st === 'sin_revisar' || st === 'confirmado';
    }).length;
    const efectividadPct = totalPedidos > 0 ? (pedidosDespachados / totalPedidos) * 100 : 0;
    return {
      pedidosWhatsapp,
      totalPedidos,
      pedidosMotico,
      pedidosNoConfirmados,
      pedidosDespachados,
      totalVentasDespachado,
      totalVentasDespachadoCurrency,
      pedidosCancelados,
      pedidosSinDespachar,
      efectividadPct,
    };
  }, [filteredShopify]);

  const filteredShopifyIds = useMemo(
    () => filteredShopify.filter((r) => !isOrderLockedInPedidos(r)).map((r) => r.id),
    [filteredShopify],
  );

  useEffect(() => {
    const valid = new Set(shopifyOrders.map((o) => o.id));
    setSelectedOrderIds((prev) => {
      const next = new Set([...prev].filter((id) => valid.has(id)));
      if (next.size === prev.size && [...prev].every((id) => next.has(id))) return prev;
      return next;
    });
  }, [shopifyOrders]);

  useEffect(() => {
    const selectable = new Set(
      shopifyOrders.filter((o) => !isOrderLockedInPedidos(o)).map((o) => o.id),
    );
    setSelectedOrderIds((prev) => {
      const next = new Set([...prev].filter((id) => selectable.has(id)));
      if (next.size === prev.size && [...prev].every((id) => next.has(id))) return prev;
      return next;
    });
  }, [shopifyOrders]);

  useEffect(() => {
    const el = selectAllCheckboxRef.current;
    if (!el) return;
    const n = filteredShopifyIds.filter((id) => selectedOrderIds.has(id)).length;
    el.indeterminate = filteredShopifyIds.length > 0 && n > 0 && n < filteredShopifyIds.length;
  }, [filteredShopifyIds, selectedOrderIds]);

  const allFilteredSelected =
    filteredShopifyIds.length > 0 && filteredShopifyIds.every((id) => selectedOrderIds.has(id));

  const toggleOrderSelected = useCallback((id: number) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAllFiltered = useCallback(() => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      const allOn =
        filteredShopifyIds.length > 0 && filteredShopifyIds.every((id) => next.has(id));
      if (allOn) {
        for (const id of filteredShopifyIds) next.delete(id);
      } else {
        for (const id of filteredShopifyIds) next.add(id);
      }
      return next;
    });
  }, [filteredShopifyIds]);

  const clearOrderSelection = useCallback(() => {
    setSelectedOrderIds(new Set());
  }, []);

  const filteredDemo = useMemo(
    () =>
      DEMO.filter((r) => {
        const byStatus =
          filter === 'all' ? true : filter === 'active' ? r.st === 'info' || r.st === 'paused' : r.st === 'success';
        if (!byStatus) return false;
        const hay = normalizeSearchText(`${r.id} ${r.client} ${r.email}`);
        return !normalizedSearchTerm || hay.includes(normalizedSearchTerm);
      }),
    [filter, normalizedSearchTerm],
  );

  const useLive = shopifyConnected && shopDomain;

  const displayPrice = (o: ShopifyOrderRow) =>
    priceDraft[o.id] !== undefined ? priceDraft[o.id]! : String(o.price_override ?? o.shopifyTotal ?? '');

  const displayQty = (o: ShopifyOrderRow) =>
    qtyDraft[o.id] !== undefined
      ? qtyDraft[o.id]!
      : String(o.quantity_override ?? o.shopifyQuantity ?? o.defaultQuantity ?? 0);

  return (
    <>
      <PageHeader
        title="Pedidos"
        subtitle={
          useLive
            ? `Tienda Shopify · ${shopDomain}. Sincronización cada ${POLL_MS / 1000} s. Los cambios en estado, precio y cantidad se guardan solos.`
            : 'Conecta Shopify en Canales para ver pedidos reales. Mientras tanto, datos de demostración.'
        }
        right={
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar pedido, cliente, email, teléfono..."
              style={{
                minWidth: 260,
                maxWidth: 360,
                padding: '7px 10px',
                borderRadius: 8,
                border: `1px solid ${ds.borderCard}`,
                background: ds.bgCard,
                color: ds.textPrimary,
                fontSize: 12,
              }}
            />
            {useLive ? (
              <button
                type="button"
                disabled={refreshing || shopifyLoading}
                onClick={() => navigate('/motico?crear_manual=1')}
                style={{
                  padding: '7px 14px',
                  borderRadius: 8,
                  border: `1px solid ${ds.brand}`,
                  background: ds.brandBg,
                  color: ds.brand,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: refreshing || shopifyLoading ? 'wait' : 'pointer',
                }}
              >
                Nuevo pedido manual
              </button>
            ) : null}
            {useLive ? (
              <button
                type="button"
                disabled={refreshing || shopifyLoading}
                onClick={() => void loadShopifyOrders()}
                style={{
                  padding: '7px 14px',
                  borderRadius: 8,
                  border: `1px solid ${ds.borderCard}`,
                  background: ds.bgCard,
                  color: ds.textSecondary,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: refreshing || shopifyLoading ? 'wait' : 'pointer',
                }}
              >
                {refreshing || shopifyLoading ? 'Actualizando…' : 'Actualizar ahora'}
              </button>
            ) : null}
            {(
              [
                { id: 'all' as const, label: 'Todos' },
                { id: 'active' as const, label: 'Activos' },
                { id: 'done' as const, label: 'Completados' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilter(t.id)}
                style={{
                  padding: '7px 14px',
                  borderRadius: 8,
                  border: `1px solid ${ds.borderCard}`,
                  background: filter === t.id ? ds.brandBg : ds.bgCard,
                  color: filter === t.id ? ds.brand : ds.textSecondary,
                  fontSize: 12,
                  fontWeight: filter === t.id ? 600 : 500,
                  cursor: 'pointer',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      />

      {useLive ? (
        <div
          style={{
            marginBottom: 14,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'center',
          }}
        >
          {DATE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setDatePreset(p.id)}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: `1px solid ${ds.borderCard}`,
                background: datePreset === p.id ? ds.brandBg : ds.bgCard,
                color: datePreset === p.id ? ds.brand : ds.textSecondary,
                fontSize: 11,
                fontWeight: datePreset === p.id ? 600 : 500,
                cursor: 'pointer',
              }}
            >
              {p.label}
            </button>
          ))}
          {datePreset === 'personalizado' ? (
            <>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                style={{ ...inputStyle, maxWidth: 140 }}
              />
              <span style={{ fontSize: 12, color: ds.textMuted }}>a</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                style={{ ...inputStyle, maxWidth: 140 }}
              />
            </>
          ) : null}
          {cityOptions.length > 0 ? (
            <div
              style={{
                width: '100%',
                flexBasis: '100%',
                marginTop: 4,
                paddingTop: 10,
                borderTop: `1px solid ${ds.borderCard}`,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 10,
                alignItems: 'flex-start',
              }}
            >
              <div
                ref={cityFilterWrapRef}
                className="kovo-city-filter"
                style={{ position: 'relative', flex: '1 1 240px', maxWidth: 380 }}
                onMouseEnter={() => setCityMenuOpen(true)}
                onMouseLeave={() => setCityMenuOpen(false)}
              >
                <button
                  type="button"
                  aria-expanded={cityMenuOpen}
                  aria-haspopup="listbox"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCityMenuOpen((o) => !o);
                  }}
                  style={{
                    width: '100%',
                    padding: '7px 14px',
                    borderRadius: 8,
                    border: `1px solid ${selectedCityKeys.length ? ds.brand : ds.borderCard}`,
                    background: selectedCityKeys.length ? ds.brandBg : ds.bgCard,
                    color: selectedCityKeys.length ? ds.brand : ds.textSecondary,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    userSelect: 'none',
                    textAlign: 'left',
                  }}
                >
                  Ciudad
                  {selectedCityKeys.length > 0
                    ? ` · ${selectedCityKeys.length} seleccionada(s)`
                    : ' · todas'}{' '}
                  ▾
                </button>
                {cityMenuOpen ? (
                  <div
                    style={{
                      position: 'absolute',
                      zIndex: 30,
                      left: 0,
                      right: 0,
                      top: '100%',
                      marginTop: 8,
                      padding: 12,
                      borderRadius: 10,
                      border: `1px solid ${ds.borderCard}`,
                      background: ds.bgCard,
                      boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <p style={{ margin: 0, fontSize: 10, color: ds.textMuted, lineHeight: 1.4 }}>
                      Marca una o varias ciudades; la tabla solo muestra pedidos de las elegidas. Sin ninguna
                      marcada se muestran todas.
                    </p>
                    <div
                      role="listbox"
                      aria-label="Ciudades del filtro"
                      style={{
                        maxHeight: 220,
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        padding: 4,
                        borderRadius: 8,
                        border: `1px solid ${ds.borderCard}`,
                        background: ds.bgSubtle,
                      }}
                    >
                      {cityOptions.map((c) => {
                        const on = selectedCityKeys.includes(c.value);
                        return (
                          <label
                            key={c.value}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              padding: '6px 8px',
                              borderRadius: 6,
                              cursor: 'pointer',
                              background: on ? ds.brandBg : 'transparent',
                              fontSize: 12,
                              color: on ? ds.brand : ds.textPrimary,
                              fontWeight: on ? 600 : 500,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => {
                                setSelectedCityKeys((prev) =>
                                  prev.includes(c.value) ? prev.filter((x) => x !== c.value) : [...prev, c.value],
                                );
                                setCityMenuOpen(false);
                              }}
                              style={{ accentColor: ds.brand, flexShrink: 0, width: 16, height: 16 }}
                            />
                            {c.label}
                          </label>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCityKeys([]);
                        setCityMenuOpen(false);
                      }}
                      style={{
                        alignSelf: 'flex-start',
                        padding: '6px 12px',
                        borderRadius: 8,
                        border: `1px solid ${ds.borderCard}`,
                        background: ds.bgSubtle,
                        color: ds.brand,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Mostrar todas las ciudades
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : useLive && shopifyOrders.length > 0 && !shopifyLoading ? (
            <div style={{ width: '100%', flexBasis: '100%', marginTop: 6, fontSize: 11, color: ds.textMuted }}>
              Ningún pedido en el rango tiene ciudad en la dirección de envío.
            </div>
          ) : null}
        </div>
      ) : null}

      {useLive && fetchedAt ? (
        <div style={{ marginBottom: 14, fontSize: 12, color: ds.textMuted }}>
          Última sincronización con Shopify:{' '}
          <span style={{ color: ds.textSecondary, fontWeight: 600 }}>{formatDate(fetchedAt)}</span>
        </div>
      ) : null}

      {shopifyError ? (
        <div
          style={{
            marginBottom: 16,
            padding: '12px 16px',
            borderRadius: 12,
            border: `1px solid ${ds.borderCard}`,
            background: ds.dangerBg,
            color: ds.dangerText,
            fontSize: 13,
          }}
        >
          {shopifyError}
        </div>
      ) : null}

      {!useLive && !shopifyLoading ? (
        <div
          style={{
            marginBottom: 16,
            padding: '12px 16px',
            borderRadius: 12,
            border: `1px solid ${ds.borderCard}`,
            background: ds.bgSubtle,
            fontSize: 13,
            color: ds.textSecondary,
          }}
        >
          <Link to="/canales" style={{ color: ds.brand, fontWeight: 600 }}>
            Canales
          </Link>
          {' · '}Vincula tu tienda Shopify para listar pedidos aquí en vivo.
        </div>
      ) : null}

      {useLive ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <KpiCard variant="traffic" label="Total pedidos (todos los estados)" value={pedidosKpis.totalPedidos} icon={<IconCart />} />
          <KpiCard variant="conversion" label="Pedidos WhatsApp" value={pedidosKpis.pedidosWhatsapp} icon={<IconCart />} />
          <KpiCard variant="conversion" label="Pedidos Motico" value={pedidosKpis.pedidosMotico} icon={<IconTruck />} />
          <KpiCard variant="alert" label="Pedidos No confirmó" value={pedidosKpis.pedidosNoConfirmados} icon={<IconTruck />} />
          <KpiCard variant="sales" label="Ventas despachado" value={pedidosKpis.pedidosDespachados} icon={<IconTruck />} />
          <KpiCard
            variant="sales"
            label="Total ventas despachado"
            value={formatMoneyAmount(pedidosKpis.totalVentasDespachado, pedidosKpis.totalVentasDespachadoCurrency)}
            icon={<IconCart />}
          />
          <KpiCard
            variant={pedidosKpis.efectividadPct < 80 ? 'alert' : 'stock'}
            label="% Efectividad"
            value={
              <span style={{ color: pedidosKpis.efectividadPct < 80 ? ds.dangerText : ds.successText }}>
                {`${pedidosKpis.efectividadPct.toFixed(2)}%`}
              </span>
            }
            icon={<IconTruck />}
          />
          <KpiCard variant="alert" label="Pedidos cancelados" value={pedidosKpis.pedidosCancelados} icon={<IconTruck />} />
          <KpiCard variant="stock" label="Pedidos sin despachar" value={pedidosKpis.pedidosSinDespachar} icon={<IconTruck />} />
        </div>
      ) : null}

      <DataTable
        title={useLive ? 'Pedidos en Shopify' : 'Todos los pedidos'}
        subtitle={
          useLive
            ? `Mostrando ${filteredShopify.length} de ${shopifyOrders.length} pedidos · rango de fechas${
                selectedCityKeys.length
                  ? ` · ${selectedCityKeys.length} ciudad(es) en el filtro`
                  : ''
              }${normalizedSearchTerm ? ' · búsqueda activa' : ''}`
            : `Mostrando ${filteredDemo.length} resultados · demo`
        }
        action={
          useLive && selectedOrderIds.size > 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: 8,
                maxWidth: '100%',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: 10,
                  fontSize: 12,
                  color: ds.textSecondary,
                }}
              >
                <span style={{ fontWeight: 600, color: ds.textPrimary }}>
                  {selectedOrderIds.size} pedido{selectedOrderIds.size === 1 ? '' : 's'} seleccionado
                  {selectedOrderIds.size === 1 ? '' : 's'}
                </span>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 11,
                    fontWeight: 600,
                    color: ds.textMuted,
                  }}
                >
                  Estado
                  <select
                    value={bulkInternalStatus}
                    onChange={(e) => setBulkInternalStatus(e.target.value as InternalStatusValue)}
                    disabled={bulkActionBusy}
                    style={{
                      ...selectStyle,
                      ...estadoSelectStyle(bulkInternalStatus),
                      maxWidth: 200,
                    }}
                    aria-label="Estado a aplicar en masa"
                  >
                    {INTERNAL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value} style={estadoOptionStyle(opt.value)}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={bulkActionBusy}
                  onClick={() => void applyBulkInternalStatus()}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: `1px solid ${ds.brand}`,
                    background: ds.brandBg,
                    color: ds.brand,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: bulkStatusApplying ? 'wait' : 'pointer',
                    opacity: bulkActionBusy ? 0.75 : 1,
                  }}
                >
                  {bulkStatusApplying ? 'Aplicando…' : 'Aplicar estado'}
                </button>
                <button
                  type="button"
                  onClick={clearOrderSelection}
                  disabled={bulkActionBusy}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: `1px solid ${ds.borderCard}`,
                    background: ds.bgSubtle,
                    color: ds.brand,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: bulkActionBusy ? 'not-allowed' : 'pointer',
                  }}
                >
                  Quitar selección
                </button>
              </div>
              {bulkStatusFeedback ? (
                <div
                  style={{
                    fontSize: 11,
                    textAlign: 'right',
                    lineHeight: 1.35,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    alignItems: 'flex-end',
                  }}
                >
                  {bulkStatusFeedback ? (
                    <div
                      style={{
                        color: bulkStatusFeedback.includes('error') ? ds.dangerText : ds.textSecondary,
                      }}
                    >
                      {bulkStatusFeedback}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : undefined
        }
      >
        {useLive && shopifyLoading && shopifyOrders.length === 0 ? (
          <div style={{ padding: 24, color: ds.textMuted, fontSize: 13 }}>Cargando pedidos de Shopify…</div>
        ) : (
          <div style={orderListTableScrollWrapperStyle}>
            <table style={{ ...tableBase, tableLayout: 'auto', minWidth: useLive ? 1760 : 1080 }}>
              <thead>
                <tr>
                  {useLive ? (
                    <Th
                      style={{
                        ...orderListStickyCheckboxTh,
                        width: 44,
                        textAlign: 'center',
                        paddingLeft: 12,
                        paddingRight: 8,
                      }}
                    >
                      <input
                        ref={selectAllCheckboxRef}
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleSelectAllFiltered}
                        disabled={filteredShopifyIds.length === 0}
                        aria-label="Seleccionar todos los pedidos visibles en la tabla"
                        style={{ accentColor: ds.brand, width: 16, height: 16, cursor: 'pointer' }}
                      />
                    </Th>
                  ) : null}
                  <Th
                    style={{
                      ...(useLive ? orderListStickyEstadoTh : orderListTheadStickyCell),
                      padding: 8,
                      borderRadius: 8,
                      whiteSpace: 'nowrap',
                      width: PEDIDOS_ESTADO_COL_PX,
                      minWidth: PEDIDOS_ESTADO_COL_PX,
                      maxWidth: PEDIDOS_ESTADO_COL_PX,
                    }}
                  >
                    Estado
                  </Th>
                  {useLive ? <Th style={mensajeroColumnThStyle}>Mensajero</Th> : null}
                  <Th style={orderListTheadStickyCell}>Pedido</Th>
                  <Th style={orderListTheadStickyCell}>Fecha</Th>
                  <Th style={orderListTheadStickyCell}>Cliente</Th>
                  {useLive ? (
                    <>
                      <Th style={phoneColumnThStyle}>Teléfono</Th>
                      <Th style={orderListTheadStickyCell}>Ciudad</Th>
                      <Th style={orderListTheadStickyCell}>Departamento</Th>
                      <Th style={orderListTheadStickyCell}>Dirección</Th>
                    </>
                  ) : null}
                  <Th style={orderListTheadStickyCell}>Precio</Th>
                  <Th style={orderListTheadStickyCell}>Cant.</Th>
                  <Th style={orderListTheadStickyCell}>Productos</Th>
                  <Th style={orderListTheadStickyCell}>Pago (Shopify)</Th>
                  {useLive ? <Th style={pedidosEditColTh}>Editar</Th> : null}
                  {useLive ? <Th style={orderListTheadStickyCell} /> : null}
                </tr>
              </thead>
              <tbody>
                {useLive
                  ? filteredShopify.map((o, i, arr) => {
                      const isLocked = isOrderLockedInPedidos(o);
                      const stLower = String(o.internal_status || '').toLowerCase();
                      const editDisabledFromPedidos = o.id < 0 || isOrderManagedByMotico(o);
                      return (
                        <tr key={o.id}>
                          <Td
                            isLast={i === arr.length - 1}
                            style={{
                              ...orderListStickyCheckboxTd,
                              textAlign: 'center',
                              verticalAlign: 'middle',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selectedOrderIds.has(o.id)}
                              onChange={() => toggleOrderSelected(o.id)}
                              aria-label={`Seleccionar pedido ${o.orderName}`}
                              disabled={isLocked}
                              style={{
                                accentColor: ds.brand,
                                width: 16,
                                height: 16,
                                cursor: isLocked ? 'not-allowed' : 'pointer',
                                opacity: isLocked ? 0.5 : 1,
                              }}
                            />
                          </Td>
                          <Td
                            isLast={i === arr.length - 1}
                            style={{
                              ...orderListStickyEstadoTd,
                              padding: 8,
                              verticalAlign: 'middle',
                              borderRadius: 8,
                              width: PEDIDOS_ESTADO_COL_PX,
                              minWidth: PEDIDOS_ESTADO_COL_PX,
                              maxWidth: PEDIDOS_ESTADO_COL_PX,
                            }}
                          >
                            <select
                              style={{
                                ...estadoSelectInTableStyle,
                                ...estadoSelectStyle(o.internal_status),
                                cursor: isLocked ? 'not-allowed' : 'pointer',
                                opacity: isLocked ? 0.72 : 1,
                              }}
                              value={o.internal_status}
                              onChange={(e) => void handleInternalStatusChange(o, e.target.value)}
                              disabled={isLocked}
                              title={isLocked ? pedidosRowLockTitle(o, 'estado') : 'Cambiar estado'}
                            >
                              {INTERNAL_OPTIONS.map((opt) => (
                                <option
                                  key={opt.value}
                                  value={opt.value}
                                  style={estadoOptionStyle(opt.value)}
                                >
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </Td>
                          <Td isLast={i === arr.length - 1} style={mensajeroColumnTdStyle}>
                            <select
                              style={{
                                ...mensajeroSelectInTableStyle,
                                ...mensajeroSelectStyle(o.mensajero),
                                cursor: isLocked ? 'not-allowed' : 'pointer',
                                opacity: isLocked ? 0.72 : 1,
                              }}
                              value={String(o.mensajero || '')}
                              onChange={(e) => void handleMensajeroChange(o, e.target.value)}
                              disabled={isLocked}
                              title={isLocked ? pedidosRowLockTitle(o, 'mensajero') : 'Cambiar mensajero'}
                            >
                              <option value="">Sin asignar</option>
                              {MENSAJERO_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value} style={mensajeroOptionStyle(opt.value)}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </Td>
                          <Td isLast={i === arr.length - 1}>
                            <div style={{ fontWeight: 600, fontSize: 12, color: ds.textPrimary }}>
                              {highlightText(o.orderName, searchTerm)}
                            </div>
                            {o.id < 0 ? (
                              <div
                                style={{
                                  display: 'inline-flex',
                                  marginTop: 4,
                                  padding: '2px 7px',
                                  borderRadius: 999,
                                  background: '#ede9fe',
                                  color: '#5b21b6',
                                  border: '1px solid #c4b5fd',
                                  fontSize: 10,
                                  fontWeight: 700,
                                  letterSpacing: '0.02em',
                                }}
                              >
                                Manual
                              </div>
                            ) : null}
                          </Td>
                          <Td isLast={i === arr.length - 1}>{formatDate(o.createdAt)}</Td>
                          <Td isLast={i === arr.length - 1}>{highlightText(o.client, searchTerm)}</Td>
                          <Td isLast={i === arr.length - 1} style={phoneColumnTdStyle}>
                            {o.phoneLocal ? (
                              <button
                                type="button"
                                onClick={() => copyPhoneToClipboard(o.phoneLocal || '')}
                                aria-label={`Copiar teléfono ${o.phoneLocal} al portapapeles`}
                                title="Clic para copiar"
                                style={{
                                  margin: 0,
                                  padding: '4px 0',
                                  borderRadius: 8,
                                  border: 'none',
                                  background: 'transparent',
                                  font: 'inherit',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  fontVariantNumeric: 'tabular-nums',
                                  letterSpacing: '0.02em',
                                  color: ds.brand,
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  whiteSpace: 'nowrap',
                                  lineHeight: 1.35,
                                  textDecoration: 'underline',
                                  textDecorationStyle: 'dotted',
                                  textUnderlineOffset: 3,
                                  width: 'max-content',
                                  maxWidth: 'none',
                                }}
                              >
                                {highlightText(o.phoneLocal, searchTerm)}
                              </button>
                            ) : (
                              <span style={{ fontSize: 11, color: ds.textMuted }}>—</span>
                            )}
                          </Td>
                          <Td isLast={i === arr.length - 1}>
                            <span style={{ fontSize: 11 }}>
                              {highlightText(o.shippingCity?.trim() || '—', searchTerm)}
                            </span>
                          </Td>
                          <Td isLast={i === arr.length - 1}>
                            <span style={{ fontSize: 11 }}>
                              {highlightText(o.shippingProvince?.trim() || '—', searchTerm)}
                            </span>
                          </Td>
                          <Td isLast={i === arr.length - 1}>
                            <div
                              style={{
                                fontSize: 11,
                                maxWidth: 240,
                                wordBreak: 'break-word',
                                lineHeight: 1.35,
                              }}
                            >
                              {highlightText(o.shippingAddressLine?.trim() || '—', searchTerm)}
                            </div>
                          </Td>
                          <Td isLast={i === arr.length - 1}>
                            <input
                              type="text"
                              inputMode="decimal"
                              style={{
                                ...inputStyle,
                                cursor: isLocked ? 'not-allowed' : 'text',
                                opacity: isLocked ? 0.72 : 1,
                              }}
                              value={displayPrice(o)}
                              onChange={(e) => {
                                const v = e.target.value;
                                setPriceDraft((d) => ({ ...d, [o.id]: v }));
                                schedulePriceSave(o.id, v);
                              }}
                              aria-label="Precio manual"
                              disabled={isLocked}
                              title={isLocked ? pedidosRowLockTitle(o, 'precio') : 'Editar precio'}
                            />
                            <div style={{ fontSize: 9.5, color: ds.textHint, marginTop: 4 }}>
                              Shopify: {formatMoneyFromString(o.shopifyTotal, o.currency)}
                            </div>
                          </Td>
                          <Td isLast={i === arr.length - 1}>
                            <input
                              type="text"
                              inputMode="numeric"
                              style={{
                                ...inputStyle,
                                cursor: isLocked ? 'not-allowed' : 'text',
                                opacity: isLocked ? 0.72 : 1,
                              }}
                              value={displayQty(o)}
                              onChange={(e) => {
                                const v = e.target.value;
                                setQtyDraft((d) => ({ ...d, [o.id]: v }));
                                scheduleQtySave(o.id, v);
                              }}
                              aria-label="Cantidad manual"
                              disabled={isLocked}
                              title={isLocked ? pedidosRowLockTitle(o, 'cantidad') : 'Editar cantidad'}
                            />
                            <div style={{ fontSize: 9.5, color: ds.textHint, marginTop: 4 }}>
                              Shopify: {o.shopifyQuantity}
                            </div>
                          </Td>
                          <Td isLast={i === arr.length - 1}>
                            <div style={{ fontSize: 11, lineHeight: 1.35, color: ds.textSecondary }}>
                              {Array.isArray(o.productIds) && o.productIds.length
                                ? o.productIds.slice(0, 4).map((pid) => `#${pid}`).join(', ') +
                                  (o.productIds.length > 4 ? ` +${o.productIds.length - 4}` : '')
                                : '—'}
                            </div>
                          </Td>
                          <Td isLast={i === arr.length - 1}>
                            <StatusBadge variant={o.badgeVariant}>{o.label}</StatusBadge>
                          </Td>
                          <Td isLast={i === arr.length - 1} style={pedidosEditColTd}>
                            <button
                              type="button"
                              onClick={() => handleOpenOrderEdit(o)}
                              disabled={editDisabledFromPedidos}
                              aria-label={`Editar pedido ${o.orderName}`}
                              title={
                                o.id < 0 || isOrderManagedByMotico(o)
                                  ? 'Edita desde el módulo Motico.'
                                  : stLower === 'despachado' || stLower === 'cancelado'
                                    ? 'Responde motivo y desbloquea para editar'
                                    : 'Abrir editor'
                              }
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: 8,
                                border: `1px solid ${ds.borderCard}`,
                                background: ds.bgCard,
                                color: ds.brand,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: editDisabledFromPedidos ? 'not-allowed' : 'pointer',
                                opacity: editDisabledFromPedidos ? 0.72 : 1,
                              }}
                            >
                              <IconPencil size={14} />
                            </button>
                          </Td>
                          <Td isLast={i === arr.length - 1}>
                            {shopDomain ? (
                              <a
                                href={`https://${shopDomain}/admin/orders/${o.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ fontSize: 11, color: ds.brand, fontWeight: 600 }}
                              >
                                Ver en Shopify
                              </a>
                            ) : null}
                          </Td>
                        </tr>
                      );
                    })
                  : filteredDemo.map((o, i, arr) => (
                      <tr key={o.id}>
                        <Td isLast={i === arr.length - 1} style={{ padding: 8, borderRadius: 8 }}>
                          —
                        </Td>
                        <Td isLast={i === arr.length - 1}>
                          <div style={{ fontWeight: 600, fontSize: 12, color: ds.textPrimary }}>
                            {highlightText(o.id, searchTerm)}
                          </div>
                        </Td>
                        <Td isLast={i === arr.length - 1}>{o.date}</Td>
                        <Td isLast={i === arr.length - 1}>{highlightText(o.client, searchTerm)}</Td>
                        <Td isLast={i === arr.length - 1}>{o.total}</Td>
                        <Td isLast={i === arr.length - 1}>—</Td>
                        <Td isLast={i === arr.length - 1}>—</Td>
                        <Td isLast={i === arr.length - 1}>
                          <StatusBadge variant={o.st}>{o.lb}</StatusBadge>
                        </Td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        )}
        {useLive && !shopifyLoading && filteredShopify.length === 0 ? (
          <div style={{ padding: 16, fontSize: 13, color: ds.textMuted }}>No hay pedidos en este filtro.</div>
        ) : null}
      </DataTable>
      {unlockOrder ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.18)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              width: 'min(560px, calc(100vw - 28px))',
              maxHeight: 'calc(100vh - 36px)',
              overflowY: 'auto',
              background: ds.bgCard,
              border: `1px solid ${ds.borderCard}`,
              borderRadius: 14,
              boxShadow: '0 16px 44px rgba(15,23,42,0.16)',
              padding: 18,
            }}
          >
            <h3 style={{ margin: '0 0 8px', fontSize: 16, color: ds.textPrimary }}>
              {String(unlockOrder.internal_status || '').toLowerCase() === 'cancelado'
                ? 'Desbloquear pedido cancelado'
                : 'Desbloquear pedido despachado'}
            </h3>
            <p style={{ margin: '0 0 12px', fontSize: 12, color: ds.textSecondary, lineHeight: 1.4 }}>
              Pedido <strong>{unlockOrder.orderName}</strong>. Para editarlo debes responder el motivo de desbloqueo
              (mínimo 5 caracteres).
            </p>
            <label style={{ display: 'block', fontSize: 12, color: ds.textSecondary, fontWeight: 600 }}>
              Motivo de desbloqueo *
              <textarea
                value={unlockReason}
                onChange={(e) => setUnlockReason(e.target.value)}
                placeholder="Escribe el motivo del desbloqueo..."
                style={{
                  marginTop: 6,
                  width: '100%',
                  minHeight: 94,
                  borderRadius: 10,
                  border: `1px solid ${ds.borderCard}`,
                  background: ds.bgSubtle,
                  color: ds.textPrimary,
                  padding: '10px 11px',
                  fontSize: 13,
                  resize: 'vertical',
                }}
              />
            </label>
            <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => {
                  if (unlocking) return;
                  setUnlockOrder(null);
                  setUnlockReason('');
                }}
                disabled={unlocking}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: `1px solid ${ds.borderCard}`,
                  background: ds.bgCard,
                  color: ds.textSecondary,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: unlocking ? 'not-allowed' : 'pointer',
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void submitUnlockDespachado()}
                disabled={unlocking}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: 'none',
                  background: ds.brand,
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: unlocking ? 'wait' : 'pointer',
                  opacity: unlocking ? 0.85 : 1,
                }}
              >
                {unlocking ? 'Desbloqueando…' : 'Desbloquear'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {phoneCopyToastVisible ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            bottom: 28,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10000,
            padding: '11px 20px',
            borderRadius: 12,
            background: '#dcfce7',
            border: '1px solid #86efac',
            color: '#14532d',
            fontSize: 13,
            fontWeight: 600,
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.14)',
            pointerEvents: 'none',
          }}
        >
          Copiado en portapapeles
        </div>
      ) : null}
    </>
  );
}
