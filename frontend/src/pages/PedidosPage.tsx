import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
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
import { type DatePreset, PEDIDOS_DATE_PRESETS, buildDateRange } from '../utils/datePresets';
import {
  ORDER_INTERNAL_ESTADO_OPTIONS as INTERNAL_OPTIONS,
  type OrderInternalEstadoValue as InternalStatusValue,
  ORDER_INTERNAL_LOCKED_STATUSES,
  ORDER_ESTADO_FOR_GUIA_PRINT,
  coerceOrderInternalEstadoForSelect,
} from '../constants/orderInternalEstado';
import {
  buildMoticoGuidesExcelPreviewRows,
  buildMoticoGuidesLayoutExcelBlob,
  mapLineItemToExportLine,
  MOTICO_GUIAS_EXCEL_COLUMN_HEADERS,
  type MoticoGuideExportLine,
  type MoticoGuidesExcelPreviewRow,
} from '../utils/moticoGuidesExcelExport';
import {
  buildMoticoGuideLabelData,
  GUIAS_POR_HOJA,
  openMoticoGuidesBatchPrint,
  type MoticoGuideLabelData,
  type MoticoLineItemRow,
  type MoticoShippingAddress,
} from '../utils/moticoPrintGuide';

const POLL_MS = 40_000;
const SAVE_DEBOUNCE_MS = 450;
const SEARCH_DEBOUNCE_MS = 240;
const MAX_LOGO_BYTES = 400_000;
const PEDIDOS_RELACION_MAX_Q = 50;

type LineItemDetail = {
  id: number;
  product_id?: number | null;
  variant_id?: number | null;
  title: string;
  quantity: number;
  price: string;
  name?: string;
  variant_title?: string;
  sku?: string;
  barcode?: string;
  properties?: { name: string; value: string }[];
};

function expandLineItemsByQuantityForShopifyRelacion(details: LineItemDetail[]): LineItemDetail[] {
  if (!details.length) return details;
  const out: LineItemDetail[] = [];
  let synthetic = 0;
  for (const li of details) {
    const q = Math.max(0, Math.min(PEDIDOS_RELACION_MAX_Q, Math.floor(Number(li.quantity) || 0)));
    if (q <= 0) continue;
    const baseId = typeof li.id === 'number' && Number.isFinite(li.id) ? li.id : 0;
    for (let k = 0; k < q; k += 1) {
      synthetic += 1;
      out.push({
        ...li,
        id: baseId * 1000 + synthetic,
        quantity: 1,
      });
    }
  }
  return out.length ? out : details;
}

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

function isOrderLockedInPedidos(row: Pick<ShopifyOrderRow, 'internal_status' | 'mensajero'>) {
  return isOrderLockedByInternalStatus(row.internal_status);
}

function isPedidosPruebaOrder(row: Pick<ShopifyOrderRow, 'internal_status' | 'motico_status'>) {
  const st = String(row.internal_status || row.motico_status || '').trim().toLowerCase();
  return st === 'prueba';
}

/** Tooltip cuando la fila no es editable desde Pedidos. */
function pedidosRowLockTitle(row: ShopifyOrderRow, kind: 'estado' | 'mensajero' | 'cantidad'): string {
  if (kind === 'cantidad') {
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
  lineItemsDetail?: LineItemDetail[];
  shippingAddress?: MoticoShippingAddress | null;
  total_a_pagar?: number;
  total_a_pagar_default?: number;
  total_a_pagar_override?: number | null;
  /** Saldo pendiente según Shopify (`total_outstanding`). */
  totalOutstanding?: string | null;
  pago_al_recibir_override?: number;
  /** True si el anticipo se guardó explícitamente desde KOVO (incluye 0). */
  anticipo_kovo_explicit?: boolean;
  is_motico_manual?: boolean;
  product_cost?: number | null;
  freight_cost?: number | null;
  product_cost_motico?: number | null;
  freight_cost_motico?: number | null;
};

type ShopifyOrdersPayload = {
  source: string;
  shop_domain: string;
  fetchedAt: string;
  orders: ShopifyOrderRow[];
};

type ShopifyProductRow = { id: number; title: string };

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

function pedidosPrecioTotalNum(o: Pick<ShopifyOrderRow, 'price_override' | 'shopifyTotal' | 'total'>): number {
  const raw =
    o.price_override != null && Number.isFinite(Number(o.price_override))
      ? Number(o.price_override)
      : Number.parseFloat(String(o.shopifyTotal ?? o.total ?? '0').replace(',', '.'));
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

/**
 * Pago anticipado en listado:
 * - Si `anticipo_kovo_explicit`: se usa el valor guardado en KOVO (0…total).
 * - Si no y Shopify está «paid»: por defecto el precio total; si hay override > 0 sin flag explícito, se usa ese tope.
 * - Si no está pagado y no hay flag: anticipo del editor solo si override > 0; si no, 0.
 */
function pedidosPagoAnticipadoNum(o: ShopifyOrderRow): number {
  const T = pedidosPrecioTotalNum(o);
  const fin = String(o.financialStatus || '').toLowerCase();
  const editorAnticipo = Number(o.pago_al_recibir_override);
  const editorOk = Number.isFinite(editorAnticipo) && editorAnticipo > 0;
  const explicit = Boolean(o.anticipo_kovo_explicit);
  if (explicit) {
    const v = Number.isFinite(editorAnticipo) ? editorAnticipo : 0;
    return Math.min(T, Math.max(0, v));
  }
  if (fin === 'paid') {
    if (editorOk) return Math.min(T, editorAnticipo);
    return T;
  }
  if (editorOk) return Math.min(T, editorAnticipo);
  return 0;
}

/** Pendiente de pago al recibir = precio total − pago anticipado. */
function pedidosPendienteAlRecibirNum(precioTotal: number, pagoAnticipado: number): number {
  return Math.max(0, precioTotal - pagoAnticipado);
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

function orderMatchesInternalStatusFilter(
  row: ShopifyOrderRow,
  statusFilter: 'all' | InternalStatusValue,
) {
  if (statusFilter === 'all') return true;
  return coerceOrderInternalEstadoForSelect(row.internal_status) === statusFilter;
}

function isDatePreset(value: string): value is DatePreset {
  return PEDIDOS_DATE_PRESETS.some((p) => p.id === value);
}

function readInitialPedidosFiltersFromSearch(search: string) {
  const qs = new URLSearchParams(search);
  const rawFilter = String(qs.get('fin') || 'all');
  const rawInternalStatus = String(qs.get('estado') || 'all');
  const rawDatePreset = String(qs.get('fecha') || 'hoy');
  const q = String(qs.get('q') || '');
  const from = String(qs.get('desde') || '');
  const to = String(qs.get('hasta') || '');
  const cityKeys = qs.getAll('ciudad').map((v) => String(v || '').trim()).filter(Boolean);

  const filter: 'all' | 'active' | 'done' =
    rawFilter === 'active' || rawFilter === 'done' ? rawFilter : 'all';
  const internalStatusFilter: 'all' | InternalStatusValue =
    rawInternalStatus === 'all' ? 'all' : coerceOrderInternalEstadoForSelect(rawInternalStatus);
  const datePreset: DatePreset = isDatePreset(rawDatePreset) ? rawDatePreset : 'hoy';

  return {
    filter,
    internalStatusFilter,
    searchInput: q,
    searchTerm: q,
    datePreset,
    customFrom: from,
    customTo: to,
    selectedCityKeys: cityKeys,
  };
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
    case 'no_llego_mensaje':
      return {
        background: '#fef3c7',
        color: '#92400e',
        borderColor: '#fcd34d',
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
  const location = useLocation();
  const initialFilters = useMemo(() => readInitialPedidosFiltersFromSearch(location.search), [location.search]);
  const [filter, setFilter] = useState<'all' | 'active' | 'done'>(initialFilters.filter);
  const [internalStatusFilter, setInternalStatusFilter] = useState<'all' | InternalStatusValue>(
    initialFilters.internalStatusFilter,
  );
  const [searchInput, setSearchInput] = useState(initialFilters.searchInput);
  const [searchTerm, setSearchTerm] = useState(initialFilters.searchTerm);
  const [datePreset, setDatePreset] = useState<DatePreset>(initialFilters.datePreset);
  const [customFrom, setCustomFrom] = useState(initialFilters.customFrom);
  const [customTo, setCustomTo] = useState(initialFilters.customTo);

  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopDomain, setShopDomain] = useState<string | null>(null);
  const [shopifyOrders, setShopifyOrders] = useState<ShopifyOrderRow[]>([]);
  const [shopifyLoading, setShopifyLoading] = useState(false);
  const [shopifyError, setShopifyError] = useState('');
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCityKeys, setSelectedCityKeys] = useState<string[]>(initialFilters.selectedCityKeys);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<number>>(() => new Set());
  const [bulkInternalStatus, setBulkInternalStatus] = useState<InternalStatusValue>('sin_revisar');
  const [bulkStatusApplying, setBulkStatusApplying] = useState(false);
  const [bulkStatusFeedback, setBulkStatusFeedback] = useState('');
  /** Valor del desplegable masivo: cadena vacía = Sin asignar (null en API). */
  const [bulkMensajero, setBulkMensajero] = useState<string>('');
  const [bulkMensajeroApplying, setBulkMensajeroApplying] = useState(false);
  const [bulkMensajeroFeedback, setBulkMensajeroFeedback] = useState('');
  const [cityMenuOpen, setCityMenuOpen] = useState(false);
  const cityFilterWrapRef = useRef<HTMLDivElement>(null);
  const selectAllCheckboxRef = useRef<HTMLInputElement>(null);
  const [phoneCopyToastVisible, setPhoneCopyToastVisible] = useState(false);
  const phoneCopyToastTimerRef = useRef<number | null>(null);

  const [guideProducts, setGuideProducts] = useState<ShopifyProductRow[]>([]);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [templateCurrency, setTemplateCurrency] = useState('COP');
  const [guideHint, setGuideHint] = useState('');
  const [guidesExcelPreview, setGuidesExcelPreview] = useState<{
    previewRows: MoticoGuidesExcelPreviewRow[];
    blob: Blob;
    filename: string;
  } | null>(null);
  const [guidesExcelPreviewLoading, setGuidesExcelPreviewLoading] = useState(false);
  const [logoPanelOpen, setLogoPanelOpen] = useState(false);
  const [logoSaving, setLogoSaving] = useState(false);
  const [logoMessage, setLogoMessage] = useState('');
  const logoFileInputRef = useRef<HTMLInputElement>(null);

  const bulkActionBusy = bulkStatusApplying || bulkMensajeroApplying;

  const [qtyDraft, setQtyDraft] = useState<Record<number, string>>({});
  const [unlockOrder, setUnlockOrder] = useState<ShopifyOrderRow | null>(null);
  const [unlockReason, setUnlockReason] = useState('');
  const [unlocking, setUnlocking] = useState(false);
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
    const ext = o as ShopifyOrderRow & {
      lineItemsDetail?: LineItemDetail[];
      shippingAddress?: MoticoShippingAddress | null;
      total_a_pagar?: number;
      total_a_pagar_default?: number;
      total_a_pagar_override?: number | null;
      totalOutstanding?: string | null;
      pago_al_recibir_override?: number;
      anticipo_kovo_explicit?: boolean;
      is_motico_manual?: boolean;
      product_cost?: number | null;
      freight_cost?: number | null;
      product_cost_motico?: number | null;
      freight_cost_motico?: number | null;
    };
    const totalDef = Number(ext.total_a_pagar_default);
    const totalOv = ext.total_a_pagar_override;
    const totalAPagar =
      ext.total_a_pagar != null && Number.isFinite(Number(ext.total_a_pagar))
        ? Number(ext.total_a_pagar)
        : totalOv != null && Number.isFinite(Number(totalOv))
          ? Number(totalOv)
          : Number.isFinite(totalDef)
            ? totalDef
            : 0;
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
      lineItemsDetail: Array.isArray(ext.lineItemsDetail) ? ext.lineItemsDetail : [],
      shippingAddress: ext.shippingAddress ?? null,
      total_a_pagar_default: Number.isFinite(totalDef) ? totalDef : totalAPagar,
      total_a_pagar_override: totalOv != null && Number.isFinite(Number(totalOv)) ? Number(totalOv) : null,
      total_a_pagar: totalAPagar,
      totalOutstanding:
        ext.totalOutstanding != null && String(ext.totalOutstanding).trim() !== ''
          ? String(ext.totalOutstanding)
          : null,
      pago_al_recibir_override:
        ext.pago_al_recibir_override != null && Number.isFinite(Number(ext.pago_al_recibir_override))
          ? Number(ext.pago_al_recibir_override)
          : 0,
      anticipo_kovo_explicit: Boolean(ext.anticipo_kovo_explicit),
      is_motico_manual: Boolean(ext.is_motico_manual),
      product_cost:
        ext.product_cost != null && Number.isFinite(Number(ext.product_cost)) ? Number(ext.product_cost) : null,
      freight_cost:
        ext.freight_cost != null && Number.isFinite(Number(ext.freight_cost)) ? Number(ext.freight_cost) : null,
      product_cost_motico:
        ext.product_cost_motico != null && Number.isFinite(Number(ext.product_cost_motico))
          ? Number(ext.product_cost_motico)
          : null,
      freight_cost_motico:
        ext.freight_cost_motico != null && Number.isFinite(Number(ext.freight_cost_motico))
          ? Number(ext.freight_cost_motico)
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
      pago_al_recibir_override?: number | null;
      anticipo_kovo_explicit?: boolean;
      total_a_pagar_override?: number | null;
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
        if (data.pago_al_recibir_override !== undefined) {
          const v = Number(data.pago_al_recibir_override);
          patch.pago_al_recibir_override = Number.isFinite(v) ? v : 0;
        }
        if (data.anticipo_kovo_explicit !== undefined) {
          patch.anticipo_kovo_explicit = Boolean(data.anticipo_kovo_explicit);
        }
        if (data.total_a_pagar_override !== undefined) {
          const v = data.total_a_pagar_override;
          patch.total_a_pagar_override =
            v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
          const def = o.total_a_pagar_default;
          patch.total_a_pagar =
            patch.total_a_pagar_override != null && Number.isFinite(Number(patch.total_a_pagar_override))
              ? Number(patch.total_a_pagar_override)
              : def != null && Number.isFinite(def)
                ? def
                : o.total_a_pagar;
        }
        return { ...o, ...patch };
      }),
    );
    setQtyDraft((d) => {
      const n = { ...d };
      delete n[orderId];
      return n;
    });
    return true;
  }, []);

  const applyBulkInternalStatus = useCallback(async () => {
    const editableIds = [...selectedOrderIds].filter((id) => {
      if (id <= 0) return false;
      const row = shopifyOrders.find((o) => o.id === id);
      return row ? !isOrderLockedInPedidos(row) : false;
    });
    if (editableIds.length === 0) return;
    const ids = editableIds;
    setBulkStatusApplying(true);
    setBulkStatusFeedback('');
    setBulkMensajeroFeedback('');
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

  const applyBulkMensajero = useCallback(async () => {
    const editableIds = [...selectedOrderIds].filter((id) => {
      if (id <= 0) return false;
      const row = shopifyOrders.find((o) => o.id === id);
      return row ? !isOrderLockedInPedidos(row) : false;
    });
    if (editableIds.length === 0) return;
    const ids = editableIds;
    const nextMensajero = bulkMensajero.trim() === '' ? null : bulkMensajero.trim().toLowerCase();
    setBulkMensajeroApplying(true);
    setBulkMensajeroFeedback('');
    setBulkStatusFeedback('');
    try {
      const results = await Promise.all(ids.map((id) => patchLocalFields(id, { mensajero: nextMensajero })));
      const ok = results.filter(Boolean).length;
      const fail = ids.length - ok;
      const label =
        nextMensajero == null
          ? 'Sin asignar'
          : MENSAJERO_OPTIONS.find((o) => o.value === nextMensajero)?.label ?? nextMensajero;
      if (fail > 0) {
        setBulkMensajeroFeedback(`${ok} actualizado(s), ${fail} error(es). Revisa la conexión o vuelve a intentar.`);
      } else {
        setBulkMensajeroFeedback(`${ok} pedido${ok === 1 ? '' : 's'} con mensajero «${label}».`);
      }
      window.setTimeout(() => setBulkMensajeroFeedback(''), 6000);
    } finally {
      setBulkMensajeroApplying(false);
    }
  }, [selectedOrderIds, shopifyOrders, bulkMensajero, patchLocalFields]);

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

  const pedidosFilterSearch = useMemo(() => {
    const qs = new URLSearchParams();
    if (filter !== 'all') qs.set('fin', filter);
    if (internalStatusFilter !== 'all') qs.set('estado', internalStatusFilter);
    const q = searchInput.trim();
    if (q) qs.set('q', q);
    if (datePreset !== 'hoy') qs.set('fecha', datePreset);
    if (datePreset === 'personalizado') {
      const from = customFrom.trim();
      const to = customTo.trim();
      if (from) qs.set('desde', from);
      if (to) qs.set('hasta', to);
    }
    selectedCityKeys.forEach((city) => {
      const c = String(city || '').trim();
      if (c) qs.append('ciudad', c);
    });
    return qs.toString();
  }, [filter, internalStatusFilter, searchInput, datePreset, customFrom, customTo, selectedCityKeys]);

  const handleOpenOrderEdit = useCallback((row: ShopifyOrderRow) => {
    const st = String(row.internal_status || '').toLowerCase() as InternalStatusValue;
    if (row.id < 0 && !row.is_motico_manual) {
      setShopifyError('Este pedido no se puede editar desde Pedidos.');
      return;
    }
    if (st === 'despachado' || st === 'cancelado') {
      setUnlockOrder(row);
      setUnlockReason('');
      setShopifyError('');
      return;
    }
    navigate(`/pedidos/editar/${row.id}${pedidosFilterSearch ? `?${pedidosFilterSearch}` : ''}`);
  }, [navigate, pedidosFilterSearch]);

  const submitUnlockDespachado = useCallback(async () => {
    if (!unlockOrder) return;
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
      navigate(`/pedidos/editar/${unlockOrder.id}${pedidosFilterSearch ? `?${pedidosFilterSearch}` : ''}`);
    } finally {
      setUnlocking(false);
    }
  }, [navigate, patchLocalFields, unlockOrder, unlockReason, pedidosFilterSearch]);

  useEffect(() => {
    return () => {
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
          orderMatchesInternalStatusFilter(r, internalStatusFilter) &&
          orderMatchesCityFilter(r, selectedCityKeySet) &&
          orderMatchesTextFilter(r, normalizedSearchTerm),
      ),
    [shopifyOrders, filter, internalStatusFilter, selectedCityKeySet, normalizedSearchTerm],
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

  const loadMoticoSettings = useCallback(async () => {
    try {
      const res = await apiFetch('/api/motico/settings');
      if (!res.ok) return;
      const data = (await res.json()) as { logo_data_url?: string | null; default_currency?: string | null };
      setLogoDataUrl(typeof data.logo_data_url === 'string' ? data.logo_data_url : null);
      const cur = String(data.default_currency || 'COP')
        .trim()
        .toUpperCase();
      setTemplateCurrency(cur || 'COP');
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    void loadMoticoSettings();
  }, [loadMoticoSettings]);

  useEffect(() => {
    if (!shopifyConnected || guideProducts.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const prodRes = await apiFetch('/api/shopify/products?limit=250');
        if (!prodRes.ok || cancelled) return;
        const pdata = (await prodRes.json().catch(() => ({}))) as { products?: unknown[] };
        const arr = Array.isArray(pdata.products) ? pdata.products : [];
        const rows: ShopifyProductRow[] = arr
          .map((x) => {
            const p = x as { id?: unknown; title?: unknown };
            const id = Number(p?.id);
            if (!Number.isFinite(id)) return null;
            return { id, title: String(p?.title || `Producto ${id}`) };
          })
          .filter((x): x is ShopifyProductRow => x != null);
        if (!cancelled) setGuideProducts(rows);
      } catch {
        /* noop */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shopifyConnected, guideProducts.length]);

  useEffect(() => {
    if (!logoPanelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLogoPanelOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [logoPanelOpen]);

  const productTitleById = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of guideProducts) m.set(p.id, p.title);
    return m;
  }, [guideProducts]);

  const summarizeProducts = useCallback(
    (ids: number[]) => {
      if (!ids.length) return '—';
      const parts = ids.slice(0, 3).map((id) => productTitleById.get(id) || `#${id}`);
      const extra = ids.length > 3 ? ` +${ids.length - 3}` : '';
      return parts.join(', ') + extra;
    },
    [productTitleById],
  );

  const printableSelectedCount = useMemo(() => {
    let n = 0;
    for (const o of shopifyOrders) {
      if (!selectedOrderIds.has(o.id)) continue;
      const st = coerceOrderInternalEstadoForSelect(String(o.internal_status || o.motico_status || ''));
      if (st === ORDER_ESTADO_FOR_GUIA_PRINT) n += 1;
    }
    return n;
  }, [shopifyOrders, selectedOrderIds]);

  const buildLabelFromOrder = useCallback(
    (o: ShopifyOrderRow): MoticoGuideLabelData => {
      const lineItems: MoticoLineItemRow[] = (o.lineItemsDetail || []).map((li, idx) => ({
        title: li.title,
        name: li.name,
        variant_title: li.variant_title,
        quantity: idx === 0 && o.quantity_override != null ? o.quantity_override : li.quantity,
        properties: li.properties,
      }));
      const precioT = pedidosPrecioTotalNum(o);
      const pagoAnticipado = pedidosPagoAnticipadoNum(o);
      const totalAmount = pedidosPendienteAlRecibirNum(precioT, pagoAnticipado);
      return buildMoticoGuideLabelData({
        orderName: o.orderName,
        client: o.client,
        shipping: o.shippingAddress ?? null,
        lineItems: lineItems.length
          ? lineItems
          : [{ title: summarizeProducts(o.productIds || []), quantity: o.defaultQuantity }],
        totalAmount,
        currency: templateCurrency,
        fallbackProductSummary: summarizeProducts(o.productIds || []),
        defaultQuantity: o.quantity_override ?? o.defaultQuantity,
      });
    },
    [summarizeProducts, templateCurrency],
  );

  const handlePrintSelectedGuides = useCallback(() => {
    setGuideHint('');
    if (!logoDataUrl) {
      setGuideHint('Configura el logo (PNG o JPEG) con «Logo guías» antes de imprimir.');
      return;
    }
    const set = new Set(selectedOrderIds);
    const list = shopifyOrders.filter((o) => set.has(o.id));
    if (!list.length) {
      setGuideHint('Marca los pedidos con la casilla de la primera columna.');
      return;
    }
    const eligible = list.filter(
      (o) =>
        coerceOrderInternalEstadoForSelect(String(o.internal_status || o.motico_status || '')) ===
        ORDER_ESTADO_FOR_GUIA_PRINT,
    );
    if (!eligible.length) {
      setGuideHint(
        'Solo se pueden imprimir guías de pedidos en estado «Confirmado». Cambia el estado o marca solo esos pedidos.',
      );
      return;
    }
    const skipped = list.length - eligible.length;
    if (skipped > 0) {
      setGuideHint(
        skipped === 1
          ? 'Se omitió 1 pedido que no está en «Confirmado». Se abre la vista previa con el resto.'
          : `Se omitieron ${skipped} pedidos que no están en «Confirmado». Vista previa con ${eligible.length}.`,
      );
    }
    const labels = eligible.map(buildLabelFromOrder);
    const ok = openMoticoGuidesBatchPrint(logoDataUrl, labels);
    if (!ok) {
      setGuideHint('Permite ventanas emergentes para abrir la vista previa de las guías.');
    }
  }, [logoDataUrl, shopifyOrders, selectedOrderIds, buildLabelFromOrder]);

  const handleOpenGuidesExcelPreview = useCallback(async () => {
    setGuideHint('');
    setGuidesExcelPreview(null);
    const set = new Set(selectedOrderIds);
    const list = shopifyOrders.filter((o) => set.has(o.id));
    if (!list.length) {
      setGuideHint('Marca los pedidos con la casilla de la primera columna.');
      return;
    }
    const eligible = list.filter(
      (o) =>
        coerceOrderInternalEstadoForSelect(String(o.internal_status || o.motico_status || '')) ===
        ORDER_ESTADO_FOR_GUIA_PRINT,
    );
    if (!eligible.length) {
      setGuideHint(
        'Solo se exportan pedidos en estado «Confirmado». Cambia el estado o marca solo esos pedidos.',
      );
      return;
    }
    const skipped = list.length - eligible.length;
    if (skipped > 0) {
      setGuideHint(
        skipped === 1
          ? 'Se omitió 1 pedido que no está en «Confirmado». La vista previa incluye el resto.'
          : `Se omitieron ${skipped} pedidos que no están en «Confirmado». Vista previa con ${eligible.length} pedidos.`,
      );
    }
    const payload = eligible.map((o, orderIdx) => {
      const sa = o.shippingAddress;
      const dirLine = [sa?.address1, sa?.address2].filter(Boolean).join(' · ').trim();
      const ciudad = (sa?.city?.trim() || '').toUpperCase();
      const observacion = (o.lineItemsDetail || [])
        .flatMap((li) => (Array.isArray(li.properties) ? li.properties : []))
        .find((p) => /^observ/i.test(String(p.name || '').trim()) && String(p.value || '').trim())
        ?.value;
      const rawDetails = o.lineItemsDetail || [];
      const details =
        !o.is_motico_manual && o.id > 0 ? expandLineItemsByQuantityForShopifyRelacion(rawDetails) : rawDetails;
      let lines: MoticoGuideExportLine[];
      if (details.length) {
        lines = details.map((li, idx) => {
          const base = mapLineItemToExportLine({
            title: li.title,
            name: li.name,
            variant_title: li.variant_title,
            quantity: li.quantity,
            properties: li.properties,
          });
          const numero = idx === 0 && o.quantity_override != null ? o.quantity_override : li.quantity;
          return { ...base, numero };
        });
      } else {
        const numero = o.quantity_override ?? o.defaultQuantity ?? o.shopifyQuantity ?? 0;
        lines = [
          {
            producto: summarizeProducts(o.productIds || []),
            diseño: '',
            color: '',
            numero,
            talla: '',
            nombre: '',
            variable: 'NO APLICA',
          },
        ];
      }
      return {
        orderIndex: orderIdx + 1,
        cliente: o.client,
        celular: o.phoneLocal || '',
        direccion: dirLine,
        ciudad,
        cobro: pedidosPendienteAlRecibirNum(pedidosPrecioTotalNum(o), pedidosPagoAnticipadoNum(o)),
        observacion: String(observacion || '').trim(),
        lines,
      };
    });
    setGuidesExcelPreviewLoading(true);
    try {
      const built = await buildMoticoGuidesLayoutExcelBlob(payload, undefined, templateCurrency);
      if (!built) {
        setGuideHint('No hay filas para exportar.');
        return;
      }
      const previewRows = buildMoticoGuidesExcelPreviewRows(payload, templateCurrency);
      setGuidesExcelPreview({
        previewRows,
        blob: built.blob,
        filename: built.filename,
      });
    } catch {
      setGuideHint('No se pudo generar el Excel. Intenta de nuevo.');
    } finally {
      setGuidesExcelPreviewLoading(false);
    }
  }, [shopifyOrders, selectedOrderIds, summarizeProducts, templateCurrency]);

  const handleDownloadGuidesExcelFromPreview = useCallback(() => {
    if (!guidesExcelPreview) return;
    const url = URL.createObjectURL(guidesExcelPreview.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = guidesExcelPreview.filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [guidesExcelPreview]);

  const onLogoFile = useCallback((file: File | null) => {
    setLogoMessage('');
    if (!file) return;
    if (!/^image\/(png|jpeg)$/i.test(file.type)) {
      setLogoMessage('Usa PNG o JPEG.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoMessage('Archivo demasiado grande (máx. ~400 KB).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r !== 'string') return;
      void (async () => {
        setLogoSaving(true);
        try {
          const res = await apiFetch('/api/motico/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ logo_data_url: r }),
          });
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          if (!res.ok) {
            setLogoMessage(typeof data.error === 'string' ? data.error : 'No se pudo guardar');
            return;
          }
          setLogoDataUrl(r);
          setLogoMessage(`Logo guardado. Se usará en las guías (hasta ${GUIAS_POR_HOJA} por hoja carta).`);
        } finally {
          setLogoSaving(false);
        }
      })();
    };
    reader.readAsDataURL(file);
  }, []);

  const removeLogo = useCallback(async () => {
    setLogoMessage('');
    setLogoSaving(true);
    try {
      const res = await apiFetch('/api/motico/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logo_data_url: null }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setLogoMessage(typeof data.error === 'string' ? data.error : 'No se pudo eliminar el logo');
        return;
      }
      setLogoDataUrl(null);
      setLogoMessage('Logo eliminado.');
    } finally {
      setLogoSaving(false);
    }
  }, []);

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
            ? `Tienda Shopify · ${shopDomain}. Sincronización cada ${POLL_MS / 1000} s. Los cambios en estado, mensajero y cantidad se guardan solos.`
            : 'Conecta Shopify en Canales para ver pedidos reales. Mientras tanto, datos de demostración.'
        }
        right={
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar pedido, cliente, correo, teléfono…"
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
                onClick={() => navigate('/pedidos/orden-manual?crear_manual=1')}
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
          {PEDIDOS_DATE_PRESETS.map((p) => (
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
          <select
            value={internalStatusFilter}
            onChange={(e) => setInternalStatusFilter(e.target.value as 'all' | InternalStatusValue)}
            style={{ ...inputStyle, maxWidth: 190 }}
            title="Filtrar por estado interno"
          >
            <option value="all">Estado: Todos</option>
            {INTERNAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                Estado: {opt.label}
              </option>
            ))}
          </select>
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

      {useLive ? (
        <>
          <div
            style={{
              marginBottom: 14,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 10,
              alignItems: 'center',
            }}
          >
            <button
              type="button"
              onClick={() => {
                setLogoMessage('');
                setLogoPanelOpen(true);
              }}
              style={{
                padding: '7px 14px',
                borderRadius: 8,
                border: `1px solid ${ds.borderCard}`,
                background: ds.bgCard,
                color: ds.textSecondary,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Logo guías{logoDataUrl ? ' ✓' : ''}
            </button>
            <button
              type="button"
              disabled={!printableSelectedCount}
              title={
                selectedOrderIds.size === 0
                  ? 'Marca pedidos con la casilla de la primera columna'
                  : !printableSelectedCount
                    ? 'Solo se imprimen pedidos en estado «Confirmado»'
                    : 'Abrir vista previa para imprimir guías'
              }
              onClick={() => void handlePrintSelectedGuides()}
              style={{
                padding: '7px 14px',
                borderRadius: 8,
                border: 'none',
                background: ds.brand,
                color: '#fff',
                fontSize: 12,
                fontWeight: 700,
                cursor: printableSelectedCount ? 'pointer' : 'not-allowed',
                opacity: printableSelectedCount ? 1 : 0.5,
              }}
            >
              Imprimir guías ({printableSelectedCount}) · {GUIAS_POR_HOJA}/hoja
            </button>
            <button
              type="button"
              disabled={!printableSelectedCount || guidesExcelPreviewLoading}
              title={
                selectedOrderIds.size === 0
                  ? 'Marca pedidos con la casilla de la primera columna'
                  : !printableSelectedCount
                    ? 'Solo se exportan pedidos en estado «Confirmado»'
                    : 'Vista previa Excel; luego descarga el archivo'
              }
              onClick={() => void handleOpenGuidesExcelPreview()}
              style={{
                padding: '7px 14px',
                borderRadius: 8,
                border: `1px solid ${ds.brand}`,
                background: ds.brandBg,
                color: ds.brand,
                fontSize: 12,
                fontWeight: 700,
                cursor: printableSelectedCount && !guidesExcelPreviewLoading ? 'pointer' : 'not-allowed',
                opacity: printableSelectedCount && !guidesExcelPreviewLoading ? 1 : 0.5,
              }}
            >
              {guidesExcelPreviewLoading
                ? 'Generando vista previa…'
                : `Excel guías (${printableSelectedCount})`}
            </button>
          </div>
          {guideHint ? (
            <div
              style={{
                marginBottom: 12,
                padding: '10px 14px',
                borderRadius: 10,
                background: '#fef3c7',
                color: '#92400e',
                fontSize: 13,
              }}
            >
              {guideHint}
            </div>
          ) : null}
        </>
      ) : null}

      {logoPanelOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Logo para guías de envío"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1200,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setLogoPanelOpen(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 420,
              background: ds.bgCard,
              borderRadius: 14,
              padding: 20,
              border: `1px solid ${ds.borderCard}`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 12px', fontSize: 17, fontWeight: 700, color: ds.textPrimary }}>Agregar logo</h2>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: ds.textSecondary, lineHeight: 1.55 }}>
              Formato <strong>PNG</strong> o <strong>JPEG</strong>. Peso máximo aprox. <strong>400 KB</strong>. Se usa en
              la parte superior de cada guía (hasta {GUIAS_POR_HOJA} por hoja).
            </p>
            <input
              ref={logoFileInputRef}
              type="file"
              accept="image/png,image/jpeg"
              disabled={logoSaving}
              style={{ display: 'none' }}
              onChange={(e) => {
                onLogoFile(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
            <div
              style={{
                width: '100%',
                maxWidth: 280,
                height: 180,
                margin: '0 auto 18px',
                borderRadius: 12,
                border: `1px solid ${ds.borderCard}`,
                overflow: 'hidden',
                background: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {logoDataUrl ? (
                <img
                  src={logoDataUrl}
                  alt="Vista previa del logo para guías"
                  style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center', display: 'block' }}
                />
              ) : (
                <span style={{ fontSize: 12, color: ds.textHint, padding: 16, textAlign: 'center' }}>
                  Aún no hay logo. Usa «Elegir archivo».
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
              <button
                type="button"
                disabled={logoSaving}
                onClick={() => logoFileInputRef.current?.click()}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: `1px solid ${ds.brand}`,
                  background: ds.brandBg,
                  color: ds.brand,
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: logoSaving ? 'wait' : 'pointer',
                }}
              >
                {logoDataUrl ? 'Cambiar logo' : 'Elegir archivo'}
              </button>
              {logoDataUrl ? (
                <button
                  type="button"
                  disabled={logoSaving}
                  onClick={() => void removeLogo()}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: `1px solid ${ds.borderCard}`,
                    background: ds.bgSubtle,
                    color: ds.dangerText,
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: logoSaving ? 'wait' : 'pointer',
                  }}
                >
                  Eliminar logo
                </button>
              ) : null}
            </div>
            {logoSaving ? <div style={{ fontSize: 12, color: ds.textMuted, marginBottom: 10 }}>Guardando…</div> : null}
            {logoMessage ? (
              <div
                style={{
                  fontSize: 12,
                  marginBottom: 14,
                  color:
                    logoMessage.includes('guardado') || logoMessage.includes('eliminado') ? ds.brand : ds.dangerText,
                }}
              >
                {logoMessage}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setLogoPanelOpen(false)}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: `1px solid ${ds.borderCard}`,
                background: ds.bgCard,
                color: ds.textSecondary,
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Cerrar
            </button>
          </div>
        </div>
      ) : null}

      {guidesExcelPreview ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.22)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 96,
          }}
          role="dialog"
          aria-modal
          aria-labelledby="pedidos-excel-preview-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setGuidesExcelPreview(null);
          }}
        >
          <div
            style={{
              background: ds.bgCard,
              borderRadius: 16,
              padding: 22,
              width: '100%',
              maxWidth: 980,
              border: `1px solid ${ds.borderCard}`,
              maxHeight: '92vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 24px 60px rgba(15, 23, 42, 0.14)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 12,
                marginBottom: 10,
              }}
            >
              <h2 id="pedidos-excel-preview-title" style={{ margin: 0, fontSize: 17, fontWeight: 700, color: ds.textPrimary }}>
                Relación Excel · vista previa
              </h2>
              <button
                type="button"
                aria-label="Cerrar vista previa"
                onClick={() => setGuidesExcelPreview(null)}
                style={{
                  flexShrink: 0,
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  border: `1px solid ${ds.borderCard}`,
                  background: ds.bgSubtle,
                  color: ds.textPrimary,
                  fontSize: 22,
                  lineHeight: 1,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                ×
              </button>
            </div>
            <p style={{ margin: '0 0 14px', fontSize: 12, color: ds.textSecondary, lineHeight: 1.45 }}>
              Misma información que irá en <strong style={{ color: ds.textPrimary }}>{guidesExcelPreview.filename}</strong>.
            </p>
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflow: 'auto',
                border: `1px solid ${ds.borderCard}`,
                borderRadius: 10,
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: ds.textPrimary }}>
                <thead>
                  <tr>
                    {MOTICO_GUIAS_EXCEL_COLUMN_HEADERS.map((h) => (
                      <th
                        key={h}
                        scope="col"
                        style={{
                          padding: '8px 6px',
                          textAlign: 'center',
                          fontWeight: 700,
                          background: '#6c47ff',
                          color: '#fff',
                          borderBottom: '1px solid #4f29d6',
                          whiteSpace: 'nowrap',
                          position: 'sticky',
                          top: 0,
                          zIndex: 1,
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {guidesExcelPreview.previewRows.map((row, idx) => {
                    const cell: CSSProperties = {
                      padding: '7px 6px',
                      borderBottom: `1px solid ${ds.borderCard}`,
                      verticalAlign: 'top',
                      wordBreak: 'break-word',
                    };
                    const rs = row.lineCount > 1 ? row.lineCount : 1;
                    return (
                      <tr
                        key={`${row.orderIndex}-${row.lineIndex}-${idx}`}
                        style={{ background: idx % 2 === 0 ? ds.bgCard : ds.bgSubtle }}
                      >
                        {row.lineIndex === 0 ? (
                          <>
                            <td rowSpan={rs} style={{ ...cell, textAlign: 'center', fontWeight: 600 }}>
                              {row.orderIndex}
                            </td>
                            <td rowSpan={rs} style={cell}>
                              {row.cliente}
                            </td>
                            <td rowSpan={rs} style={cell}>
                              {row.celular}
                            </td>
                            <td rowSpan={rs} style={cell}>
                              {row.direccion}
                            </td>
                            <td rowSpan={rs} style={{ ...cell, textAlign: 'center' }}>
                              {row.ciudad}
                            </td>
                          </>
                        ) : null}
                        <td style={cell}>{row.producto}</td>
                        <td style={cell}>{row.variable}</td>
                        <td style={{ ...cell, textAlign: 'center' }}>{row.talla}</td>
                        {row.lineIndex === 0 ? (
                          <>
                            <td rowSpan={rs} style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {row.cobro}
                            </td>
                            <td rowSpan={rs} style={cell}>
                              {row.observacion}
                            </td>
                          </>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 10,
                marginTop: 16,
                justifyContent: 'flex-end',
              }}
            >
              <button
                type="button"
                onClick={() => setGuidesExcelPreview(null)}
                style={{
                  padding: '9px 18px',
                  borderRadius: 10,
                  border: `1px solid ${ds.borderCard}`,
                  background: ds.bgSubtle,
                  color: ds.textPrimary,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => void handleDownloadGuidesExcelFromPreview()}
                style={{
                  padding: '9px 18px',
                  borderRadius: 10,
                  border: 'none',
                  background: ds.brand,
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Descargar .xlsx
              </button>
            </div>
          </div>
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
            : `Mostrando ${filteredDemo.length} resultados · demostración`
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
                  Mensajero
                  <select
                    value={bulkMensajero}
                    onChange={(e) => setBulkMensajero(e.target.value)}
                    disabled={bulkActionBusy}
                    style={{
                      ...selectStyle,
                      ...mensajeroSelectStyle(bulkMensajero || null),
                      minWidth: `${MENSAJERO_SELECT_MIN_WIDTH_CH}ch`,
                      maxWidth: 200,
                    }}
                    aria-label="Mensajero a aplicar en masa"
                  >
                    <option value="">Sin asignar</option>
                    {MENSAJERO_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value} style={mensajeroOptionStyle(opt.value)}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={bulkActionBusy}
                  onClick={() => void applyBulkMensajero()}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: `1px solid ${ds.brand}`,
                    background: ds.brandBg,
                    color: ds.brand,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: bulkMensajeroApplying ? 'wait' : 'pointer',
                    opacity: bulkActionBusy ? 0.75 : 1,
                  }}
                >
                  {bulkMensajeroApplying ? 'Aplicando…' : 'Aplicar mensajero'}
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
              {bulkStatusFeedback || bulkMensajeroFeedback ? (
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
                  {bulkMensajeroFeedback ? (
                    <div
                      style={{
                        color: bulkMensajeroFeedback.includes('error') ? ds.dangerText : ds.textSecondary,
                      }}
                    >
                      {bulkMensajeroFeedback}
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
            <table style={{ ...tableBase, tableLayout: 'auto', minWidth: useLive ? 2200 : 1180 }}>
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
                  {useLive ? <Th style={pedidosEditColTh}>Editar</Th> : null}
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
                  <Th style={{ ...orderListTheadStickyCell, textAlign: 'right' }}>Precio Total</Th>
                  <Th style={{ ...orderListTheadStickyCell, textAlign: 'right', whiteSpace: 'normal', maxWidth: 128 }}>
                    Pago anticipado
                  </Th>
                  <Th style={{ ...orderListTheadStickyCell, textAlign: 'right', whiteSpace: 'normal', maxWidth: 140 }}>
                    Pendiente de pago al recibir
                  </Th>
                  {useLive ? (
                    <Th
                      style={{ ...orderListTheadStickyCell, textAlign: 'right' }}
                      title="Si el mensajero es Motico: costo producto Motico del Inventario. Si no: suma del precio manual de producto del Inventario por cantidad en líneas."
                    >
                      COSTO PRODUCTO
                    </Th>
                  ) : null}
                  {useLive ? (
                    <Th
                      style={{ ...orderListTheadStickyCell, textAlign: 'right' }}
                      title="Si el mensajero es Motico: flete Motico del Inventario (promedio por productos del pedido). Si no: flete manual del Inventario (mismo promedio)."
                    >
                      COSTO FLETE
                    </Th>
                  ) : null}
                  <Th style={orderListTheadStickyCell}>Cant.</Th>
                  <Th style={orderListTheadStickyCell}>Productos</Th>
                  <Th style={orderListTheadStickyCell}>Pago (Shopify)</Th>
                  {useLive ? <Th style={orderListTheadStickyCell} /> : null}
                </tr>
              </thead>
              <tbody>
                {useLive
                  ? filteredShopify.map((o, i, arr) => {
                      const isLocked = isOrderLockedInPedidos(o);
                      const stLower = String(o.internal_status || '').toLowerCase();
                      const editDisabledFromPedidos = o.id < 0 && !o.is_motico_manual;
                      const precioTotal = pedidosPrecioTotalNum(o);
                      const pagoAnticipado = pedidosPagoAnticipadoNum(o);
                      const pendienteRecibir = pedidosPendienteAlRecibirNum(precioTotal, pagoAnticipado);
                      const mensajeroNorm = String(o.mensajero || '').trim().toLowerCase();
                      const useMoticoCosts = mensajeroNorm === 'motico';
                      const costoProductoBase =
                        o.product_cost != null && Number.isFinite(Number(o.product_cost)) ? Number(o.product_cost) : null;
                      const costoFleteBase =
                        o.freight_cost != null && Number.isFinite(Number(o.freight_cost)) ? Number(o.freight_cost) : null;
                      const costoProductoMotico =
                        o.product_cost_motico != null && Number.isFinite(Number(o.product_cost_motico))
                          ? Number(o.product_cost_motico)
                          : null;
                      const costoFleteMotico =
                        o.freight_cost_motico != null && Number.isFinite(Number(o.freight_cost_motico))
                          ? Number(o.freight_cost_motico)
                          : null;
                      const costoProducto = useMoticoCosts ? (costoProductoMotico ?? costoProductoBase) : costoProductoBase;
                      const costoFlete = useMoticoCosts ? (costoFleteMotico ?? costoFleteBase) : costoFleteBase;
                      const costoProductoTitle = useMoticoCosts
                        ? costoProductoMotico != null
                          ? 'Costo producto Motico (Inventario: precio Motico × cantidad por línea).'
                          : costoProductoBase != null
                            ? 'Mensajero Motico: no hay costo producto Motico en Inventario; se muestra el costo normal de Inventario.'
                            : 'Mensajero Motico: sin costo producto Motico ni costo normal configurado en Inventario para este pedido.'
                        : costoProductoBase != null
                          ? 'Costo producto según Inventario (precio manual × cantidad por línea).'
                          : 'Sin costo de producto en Inventario para las líneas de este pedido.';
                      const costoFleteTitle = useMoticoCosts
                        ? costoFleteMotico != null
                          ? 'Flete Motico (Inventario: promedio de fletes Motico de los productos del pedido).'
                          : costoFleteBase != null
                            ? 'Mensajero Motico: no hay flete Motico en Inventario; se muestra el flete manual de Inventario.'
                            : 'Mensajero Motico: sin flete Motico ni flete manual en Inventario para este pedido.'
                        : costoFleteBase != null
                          ? 'Flete según Inventario (promedio de fletes manuales de los productos del pedido).'
                          : 'Sin flete en Inventario para los productos de este pedido.';
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
                          <Td isLast={i === arr.length - 1} style={pedidosEditColTd}>
                            <button
                              type="button"
                              onClick={() => handleOpenOrderEdit(o)}
                              disabled={editDisabledFromPedidos}
                              aria-label={`Editar pedido ${o.orderName}`}
                              title={
                                o.id < 0 && !o.is_motico_manual
                                  ? 'Este pedido no se puede editar desde Pedidos.'
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
                          <Td
                            isLast={i === arr.length - 1}
                            style={{
                              textAlign: 'right',
                              fontSize: 12,
                              fontWeight: 600,
                              fontVariantNumeric: 'tabular-nums',
                              color: ds.textPrimary,
                            }}
                          >
                            {formatMoneyAmount(precioTotal, o.currency)}
                          </Td>
                          <Td
                            isLast={i === arr.length - 1}
                            style={{
                              textAlign: 'right',
                              fontSize: 12,
                              fontVariantNumeric: 'tabular-nums',
                              color: ds.textSecondary,
                            }}
                          >
                            {formatMoneyAmount(pagoAnticipado, o.currency)}
                          </Td>
                          <Td
                            isLast={i === arr.length - 1}
                            style={{
                              textAlign: 'right',
                              fontSize: 12,
                              fontWeight: 600,
                              fontVariantNumeric: 'tabular-nums',
                              color: ds.textPrimary,
                            }}
                            title="Precio total − pago anticipado (si Shopify está pagado: total o valor ajustado en KOVO; si no: valor del editor)."
                          >
                            {formatMoneyAmount(pendienteRecibir, o.currency)}
                          </Td>
                          <Td
                            isLast={i === arr.length - 1}
                            style={{
                              textAlign: 'right',
                              fontSize: 12,
                              fontVariantNumeric: 'tabular-nums',
                              color: ds.textSecondary,
                            }}
                            title={costoProductoTitle}
                          >
                            {costoProducto != null ? formatMoneyAmount(costoProducto, o.currency) : '—'}
                          </Td>
                          <Td
                            isLast={i === arr.length - 1}
                            style={{
                              textAlign: 'right',
                              fontSize: 12,
                              fontVariantNumeric: 'tabular-nums',
                              color: ds.textSecondary,
                            }}
                            title={costoFleteTitle}
                          >
                            {costoFlete != null ? formatMoneyAmount(costoFlete, o.currency) : '—'}
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
                        <Td isLast={i === arr.length - 1} style={{ textAlign: 'right', fontSize: 12 }}>
                          {o.total}
                        </Td>
                        <Td isLast={i === arr.length - 1} style={{ textAlign: 'right', fontSize: 12, color: ds.textMuted }}>
                          —
                        </Td>
                        <Td isLast={i === arr.length - 1} style={{ textAlign: 'right', fontSize: 12, color: ds.textMuted }}>
                          —
                        </Td>
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
                placeholder="Escribe el motivo del desbloqueo…"
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
