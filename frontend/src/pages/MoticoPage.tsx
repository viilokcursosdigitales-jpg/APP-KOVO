import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';
import { DataTable, Th, Td, tableBase } from '../design-system/DataTable';
import { orderListTableScrollWrapperStyle, orderListTheadStickyCell } from '../design-system/orderListTableScroll';
import { IconPencil, IconTruck } from '../design-system/icons';
import { PageHeader } from '../design-system/PageHeader';
import { StatusBadge, type StatusBadgeVariant } from '../design-system/StatusBadge';
import { type DatePreset, DATE_PRESETS, buildDateRange } from '../utils/datePresets';
import { labelStyle } from './authStyles';
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

const POLL_MS = 25_000;
const MOTICO_TOTAL_APAGAR_DEBOUNCE_MS = 450;
const MAX_LOGO_BYTES = 400_000;
const MOTICO_STATUS_DEFAULT = 'sin_revisar';
const MOTICO_STATUS_OPTIONS = [
  {
    value: MOTICO_STATUS_DEFAULT,
    label: 'Sin revisar',
    rowColor: '#9ca3af',
    chipBg: '#f3f4f6',
    chipFg: '#374151',
    chipBorder: '#d1d5db',
  },
  {
    value: 'sin_confirmar',
    label: 'No confirmó',
    rowColor: '#fb923c',
    chipBg: '#ffedd5',
    chipFg: '#9a3412',
    chipBorder: '#fdba74',
  },
  {
    value: 'confirmado',
    label: 'Confirmado',
    rowColor: '#16a34a',
    chipBg: '#dcfce7',
    chipFg: '#14532d',
    chipBorder: '#86efac',
  },
  {
    value: 'imprimir_guia',
    label: 'Imprimir guía',
    rowColor: '#4f46e5',
    chipBg: '#e0e7ff',
    chipFg: '#312e81',
    chipBorder: '#a5b4fc',
  },
  {
    value: 'despachado',
    label: 'Despachado',
    rowColor: '#0d9488',
    chipBg: '#ccfbf1',
    chipFg: '#134e4a',
    chipBorder: '#5eead4',
  },
  { value: 'cancelado', label: 'Cancelado', rowColor: '#dc2626', chipBg: '#fee2e2', chipFg: '#7f1d1d', chipBorder: '#fca5a5' },
  {
    value: 'pagado',
    label: 'Pagado',
    rowColor: '#2563eb',
    chipBg: '#dbeafe',
    chipFg: '#1e3a8a',
    chipBorder: '#93c5fd',
  },
  {
    value: 'pendiente_pago',
    label: 'Pendiente de pago',
    rowColor: '#ca8a04',
    chipBg: '#fef9c3',
    chipFg: '#713f12',
    chipBorder: '#fde047',
  },
  {
    value: 'devolucion',
    label: 'Devolución',
    rowColor: '#d97706',
    chipBg: '#fef3c7',
    chipFg: '#78350f',
    chipBorder: '#fcd34d',
  },
] as const;

/** Caracteres del estado con texto más largo (ancho mínimo del &lt;select&gt; sin dejar hueco extra). */
const MOTICO_ESTADO_LONGEST_LABEL_LEN = Math.max(...MOTICO_STATUS_OPTIONS.map((o) => o.label.length));

/** Solo pedidos en este estado pueden generar guías (vista previa / impresión). */
const MOTICO_STATUS_FOR_GUIDE_PRINT = 'imprimir_guia';
const MOTICO_LOCKED_STATUSES = new Set(['despachado', 'cancelado']);

function isMoticoStatusLocked(status: string) {
  return MOTICO_LOCKED_STATUSES.has(String(status || '').toLowerCase());
}

const STATUS_META = Object.fromEntries(MOTICO_STATUS_OPTIONS.map((o) => [o.value, o])) as Record<
  string,
  (typeof MOTICO_STATUS_OPTIONS)[number]
>;

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

const MOTICO_RELACION_MAX_Q_PER_LINE = 50;

/** Una fila de relación por unidad vendida (como pedidos manuales con qty 1 por fila). */
function expandLineItemsByQuantityForShopifyRelacion(details: LineItemDetail[]): LineItemDetail[] {
  if (!details.length) return details;
  const out: LineItemDetail[] = [];
  let synthetic = 0;
  for (const li of details) {
    const q = Math.max(
      0,
      Math.min(MOTICO_RELACION_MAX_Q_PER_LINE, Math.floor(Number(li.quantity) || 0)),
    );
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

type MoticoOrderRow = {
  id: number;
  orderName: string;
  client: string;
  email: string;
  createdAt: string;
  total: string;
  currency: string;
  label: string;
  badgeVariant: StatusBadgeVariant;
  productIds: number[];
  lineItemsDetail: LineItemDetail[];
  shippingAddress: MoticoShippingAddress | null;
  mensajero: string | null;
  motico_status: string;
  price_override: number | null;
  quantity_override: number | null;
  shopifyTotal: string;
  shopifyQuantity: number;
  defaultQuantity: number;
  /** Solo dígitos, sin +57 (API Pedidos / Shopify). */
  phoneLocal?: string;
  financialStatus?: string;
  totalOutstanding?: string | null;
  /** Pendiente según Shopify (pagado → 0; si no, total_outstanding o total). */
  total_a_pagar_default: number;
  total_a_pagar_override: number | null;
  /** Valor mostrado: override ?? default. */
  total_a_pagar: number;
  /** Pedido creado en Motico (no existe en Shopify); id negativo en API. */
  is_motico_manual?: boolean;
};

type ShopifyProductVariant = {
  id: number;
  title: string;
  sku?: string;
  barcode?: string;
};

type ShopifyProduct = {
  id: number;
  title: string;
  variants?: ShopifyProductVariant[];
};

const filterCtl: CSSProperties = {
  padding: '7px 12px',
  borderRadius: 8,
  border: `1px solid ${ds.borderCard}`,
  background: ds.bgCard,
  color: ds.textPrimary,
  fontSize: 12,
  fontWeight: 500,
  minWidth: 0,
};

/** Separación entre celdas (alineado con padding 5px). */
const MOTICO_COL_GAP_PX = 5;

/** Padding horizontal 5px: celda = texto más largo + 5px a cada lado. */
const MOTICO_CELL_H_PAD = 5;
const moticoThPad: CSSProperties = { padding: `11px ${MOTICO_CELL_H_PAD}px` };
const moticoTdPad: CSSProperties = { padding: `12px ${MOTICO_CELL_H_PAD}px` };

/** Columna Estado: ancho mínimo al contenido. */
const moticoEstadoThTd: CSSProperties = {
  verticalAlign: 'middle',
  width: '0.01%',
};

const moticoEstadoActionsRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'nowrap',
  width: 'max-content',
  maxWidth: '100%',
};

/** Select acotado al texto más largo + flecha/padding internos. */
const moticoEstadoSelectShell: CSSProperties = {
  flex: '0 0 auto',
  minWidth: 0,
};

const moticoEstadoSelectStyle: CSSProperties = {
  padding: '6px 8px',
  borderRadius: 8,
  border: `1px solid ${ds.borderCard}`,
  color: ds.textPrimary,
  fontSize: 12,
  fontWeight: 600,
  boxSizing: 'border-box',
  width: 'auto',
  minWidth: `calc(${MOTICO_ESTADO_LONGEST_LABEL_LEN}ch + 36px)`,
  maxWidth: 'none',
};

/** Ancho de la columna checkbox; el sticky de Estado usa el mismo valor en `left`. */
const MOTICO_STICKY_CHECKBOX_COL_PX = 52;

/** Primera columna (checkbox): fija al hacer scroll horizontal. */
const moticoStickySelectCol: CSSProperties = {
  position: 'sticky',
  left: 0,
  width: MOTICO_STICKY_CHECKBOX_COL_PX,
  minWidth: MOTICO_STICKY_CHECKBOX_COL_PX,
  maxWidth: MOTICO_STICKY_CHECKBOX_COL_PX,
  boxSizing: 'border-box',
  boxShadow: '6px 0 12px -8px rgba(15, 23, 42, 0.25)',
};

/** Columna Estado junto al checkbox: fija al scroll horizontal. */
const moticoStickyEstadoTh: CSSProperties = {
  ...orderListTheadStickyCell,
  left: MOTICO_STICKY_CHECKBOX_COL_PX,
  zIndex: 9,
  background: ds.bgApp,
  boxShadow: '6px 0 12px -8px rgba(15, 23, 42, 0.22)',
};

const moticoStickyEstadoTdBase: CSSProperties = {
  position: 'sticky',
  left: MOTICO_STICKY_CHECKBOX_COL_PX,
  zIndex: 4,
  boxShadow: '6px 0 12px -8px rgba(15, 23, 42, 0.18)',
};

/** Columnas que encogen al texto (una sola línea). */
const moticoColFitNowrap: CSSProperties = {
  width: '1%',
  whiteSpace: 'nowrap',
};

const moticoPhoneColumnTh: CSSProperties = {
  ...moticoThPad,
  ...moticoColFitNowrap,
};

const moticoPhoneColumnTd: CSSProperties = {
  ...moticoTdPad,
  ...moticoColFitNowrap,
};

const moticoEditColTh: CSSProperties = {
  ...moticoThPad,
  ...moticoColFitNowrap,
};

const moticoTableStyle: CSSProperties = {
  ...tableBase,
  tableLayout: 'auto',
  width: 'max-content',
  borderCollapse: 'separate',
  borderSpacing: `${MOTICO_COL_GAP_PX}px 0`,
};

const moticoOrderEditIconBtn: CSSProperties = {
  flexShrink: 0,
  padding: 6,
  borderRadius: 8,
  border: `1px solid ${ds.borderCard}`,
  background: ds.bgCard,
  color: ds.brand,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 0,
};

const moticoTotalAPagarInputStyle: CSSProperties = {
  width: '100%',
  maxWidth: 128,
  padding: '6px 8px',
  borderRadius: 8,
  border: `1px solid ${ds.borderCard}`,
  background: ds.bgCard,
  color: ds.textPrimary,
  fontSize: 12,
  fontWeight: 600,
  boxSizing: 'border-box',
};

const modalFieldStyle: CSSProperties = {
  width: '100%',
  maxWidth: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  borderRadius: 8,
  border: `1px solid ${ds.borderCard}`,
  background: ds.bgCard,
  color: ds.textPrimary,
  fontSize: 13,
  marginTop: 8,
};

/** Borrador del modal (dirección sin CP en formulario; precio/cantidad sincronizan con Shopify). */
type MoticoEditorDraft = {
  province: string;
  city: string;
  address1: string;
  address2: string;
  country: string;
  phone: string;
  price: string;
  quantity: string;
  line_items: {
    product_id: string;
    variant_id: string;
    quantity: string;
  }[];
};

function emptyEditorDraft(): MoticoEditorDraft {
  return {
    province: '',
    city: '',
    address1: '',
    address2: '',
    country: '',
    phone: '',
    price: '',
    quantity: '',
    line_items: [emptyManualLine()],
  };
}

type ManualCreateDraft = {
  client_name: string;
  client_email: string;
  phone: string;
  /** Valor input type=date (YYYY-MM-DD); vacío = fecha/hora actual en el servidor. Si hay fecha, hora fija 8:00 local. */
  created_at: string;
  total: string;
  note: string;
  line_items: {
    product_id: string;
    variant_id: string;
    quantity: string;
  }[];
  financial_status: 'paid' | 'pending' | 'unpaid';
  province: string;
  city: string;
  address1: string;
  address2: string;
  country: string;
};

function emptyManualLine() {
  return {
    product_id: '',
    variant_id: '',
    quantity: '1',
  };
}

/** Fecha de creación manual: solo día; se envía como 8:00 a. m. hora local. */
function creationDateAt8amLocalToIso(ymd: string): string | null {
  const t = ymd.trim();
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  const dt = new Date(y, mo, day, 8, 0, 0, 0);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== day) return null;
  return dt.toISOString();
}

function emptyManualDraft(): ManualCreateDraft {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return {
    client_name: '',
    client_email: '',
    phone: '',
    created_at: `${yyyy}-${mm}-${dd}`,
    total: '',
    note: '',
    line_items: [emptyManualLine()],
    financial_status: 'pending',
    province: 'CUNDINAMARCA',
    city: 'BOGOTA',
    address1: '',
    address2: '',
    country: 'COLOMBIA',
  };
}

function getNextManualWhatsappOrderNumber(rows: MoticoOrderRow[]): number {
  let maxUsed = 0;
  for (const row of rows) {
    if (!(row.is_motico_manual || row.id < 0)) continue;
    const byName = String(row.orderName || '').match(/^whatsapp\s*#\s*(\d+)$/i);
    if (byName) {
      const n = parseInt(byName[1], 10);
      if (Number.isFinite(n) && n > maxUsed) maxUsed = n;
    }
    const byId = Math.abs(Number(row.id));
    if (Number.isFinite(byId) && byId > maxUsed) maxUsed = byId;
  }
  return maxUsed + 1;
}

function normalizeShopifyProducts(raw: unknown): ShopifyProduct[] {
  const list =
    raw && typeof raw === 'object' && Array.isArray((raw as { products?: unknown[] }).products)
      ? (raw as { products: unknown[] }).products
      : [];
  const out: ShopifyProduct[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const variants = Array.isArray(row.variants)
      ? row.variants
          .filter((v) => v && typeof v === 'object')
          .map((v) => {
            const vv = v as Record<string, unknown>;
            return {
              id: Number(vv.id) || 0,
              title: String(vv.title || ''),
              sku: String(vv.sku || ''),
              barcode: String(vv.barcode || ''),
            } satisfies ShopifyProductVariant;
          })
      : [];
    out.push({
      id: Number(row.id) || 0,
      title: String(row.title || ''),
      variants,
    });
  }
  return out;
}

function draftFromOrder(o: MoticoOrderRow): MoticoEditorDraft {
  const sa = o.shippingAddress;
  const line_items = Array.isArray(o.lineItemsDetail)
    ? o.lineItemsDetail
        .map((li) => {
          const pid = Number(li.product_id);
          const vid = Number(li.variant_id);
          const qty = Number(li.quantity);
          if (!Number.isFinite(pid) || pid <= 0) return null;
          return {
            product_id: String(pid),
            variant_id: Number.isFinite(vid) && vid > 0 ? String(vid) : '',
            quantity: Number.isFinite(qty) && qty > 0 ? String(qty) : '1',
          };
        })
        .filter(Boolean) as MoticoEditorDraft['line_items']
    : [];
  return {
    province: sa?.province || '',
    city: sa?.city || '',
    address1: sa?.address1 || '',
    address2: sa?.address2 || '',
    country: sa?.country || '',
    phone: sa?.phone || '',
    price: String(o.price_override ?? o.shopifyTotal ?? ''),
    quantity: String(o.quantity_override ?? o.defaultQuantity ?? o.shopifyQuantity ?? 0),
    line_items: line_items.length ? line_items : [emptyManualLine()],
  };
}

function formatMoneyAmount(n: number, currency: string) {
  const cur = currency && currency.length === 3 ? currency : 'EUR';
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: cur }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

function formatMoneyFromString(total: string, currency: string) {
  const n = Number.parseFloat(String(total));
  if (Number.isNaN(n)) return String(total);
  return formatMoneyAmount(n, currency);
}

/** Si el API aún no envía total_a_pagar_default (backend antiguo). */
function computedTotalAPagarDefaultFromRow(o: {
  financialStatus?: string;
  totalOutstanding?: string | null;
  total?: string;
}): number {
  const fin = String(o.financialStatus || '').toLowerCase();
  if (fin === 'paid') return 0;
  const outRaw = o.totalOutstanding;
  if (outRaw != null && String(outRaw).trim() !== '') {
    const out = Number.parseFloat(String(outRaw));
    if (Number.isFinite(out) && out >= 0) return out;
  }
  const t = Number.parseFloat(String(o.total || '0'));
  return Number.isFinite(t) && t >= 0 ? t : 0;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function normalizeRow(o: MoticoOrderRow): MoticoOrderRow {
  const bv = o.badgeVariant;
  const safeBv = (['success', 'paused', 'error', 'info', 'warning'].includes(bv) ? bv : 'info') as StatusBadgeVariant;
  const allowed = new Set(MOTICO_STATUS_OPTIONS.map((x) => x.value));
  const sa = o.shippingAddress;
  return {
    ...o,
    badgeVariant: safeBv,
    productIds: Array.isArray(o.productIds) ? o.productIds : [],
    lineItemsDetail: Array.isArray(o.lineItemsDetail) ? o.lineItemsDetail : [],
    shippingAddress:
      sa && typeof sa === 'object'
        ? {
            name: String(sa.name || ''),
            address1: String(sa.address1 || ''),
            address2: String(sa.address2 || ''),
            city: String(sa.city || ''),
            province: String(sa.province || ''),
            zip: String(sa.zip || ''),
            country: String(sa.country || ''),
            phone: String(sa.phone || ''),
          }
        : null,
    mensajero: o.mensajero || null,
    motico_status: allowed.has(o.motico_status) ? o.motico_status : MOTICO_STATUS_DEFAULT,
    price_override: o.price_override != null ? Number(o.price_override) : null,
    quantity_override: o.quantity_override != null ? Number(o.quantity_override) : null,
    shopifyQuantity: Number(o.shopifyQuantity ?? o.defaultQuantity) || 0,
    defaultQuantity: Number(o.defaultQuantity) || 0,
    phoneLocal: typeof o.phoneLocal === 'string' ? o.phoneLocal.trim() : '',
    financialStatus: String(o.financialStatus || ''),
    totalOutstanding: o.totalOutstanding != null ? String(o.totalOutstanding) : null,
    total_a_pagar_default:
      o.total_a_pagar_default != null && Number.isFinite(Number(o.total_a_pagar_default))
        ? Number(o.total_a_pagar_default)
        : computedTotalAPagarDefaultFromRow(o),
    total_a_pagar_override:
      o.total_a_pagar_override != null && Number.isFinite(Number(o.total_a_pagar_override))
        ? Number(o.total_a_pagar_override)
        : null,
    total_a_pagar:
      o.total_a_pagar != null && Number.isFinite(Number(o.total_a_pagar))
        ? Number(o.total_a_pagar)
        : o.total_a_pagar_override != null && Number.isFinite(Number(o.total_a_pagar_override))
          ? Number(o.total_a_pagar_override)
          : computedTotalAPagarDefaultFromRow(o),
    is_motico_manual: Boolean((o as { is_motico_manual?: boolean }).is_motico_manual),
  };
}

export default function MoticoPage() {
  const [datePreset, setDatePreset] = useState<DatePreset>('hoy');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [productId, setProductId] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopDomain, setShopDomain] = useState<string | null>(null);
  const [orders, setOrders] = useState<MoticoOrderRow[]>([]);
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [guideHint, setGuideHint] = useState('');
  const [guidesExcelPreview, setGuidesExcelPreview] = useState<{
    previewRows: MoticoGuidesExcelPreviewRow[];
    blob: Blob;
    filename: string;
  } | null>(null);
  const [guidesExcelPreviewLoading, setGuidesExcelPreviewLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const headerSelectRef = useRef<HTMLInputElement>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [templateCurrency, setTemplateCurrency] = useState('COP');
  const [logoSaving, setLogoSaving] = useState(false);
  const [logoMessage, setLogoMessage] = useState('');
  const [logoPanelOpen, setLogoPanelOpen] = useState(false);
  const logoFileInputRef = useRef<HTMLInputElement>(null);

  const [editorOrder, setEditorOrder] = useState<MoticoOrderRow | null>(null);
  const [editorDraft, setEditorDraft] = useState<MoticoEditorDraft>(() => emptyEditorDraft());
  const [editorSaving, setEditorSaving] = useState(false);

  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState<ManualCreateDraft>(() => emptyManualDraft());
  const [manualOrderNamePreview, setManualOrderNamePreview] = useState('Whatsapp #1');
  const [manualSaving, setManualSaving] = useState(false);
  const [manualError, setManualError] = useState('');

  const [phoneCopyToastVisible, setPhoneCopyToastVisible] = useState(false);
  const phoneCopyToastTimerRef = useRef<number | null>(null);

  const [totalAPagarDraft, setTotalAPagarDraft] = useState<Record<number, string>>({});
  const totalAPagarTimers = useRef<Map<number, number>>(new Map());

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
      for (const t of totalAPagarTimers.current.values()) window.clearTimeout(t);
      totalAPagarTimers.current.clear();
    };
  }, []);

  const dateQuery = useMemo(
    () => buildDateRange(datePreset, customFrom, customTo),
    [datePreset, customFrom, customTo],
  );

  const productTitleById = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of products) m.set(p.id, p.title);
    return m;
  }, [products]);

  const productById = useMemo(() => {
    const m = new Map<number, ShopifyProduct>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  const summarizeProducts = useCallback(
    (ids: number[]) => {
      if (!ids.length) return '—';
      const parts = ids.slice(0, 3).map((id) => productTitleById.get(id) || `#${id}`);
      const extra = ids.length > 3 ? ` +${ids.length - 3}` : '';
      return parts.join(', ') + extra;
    },
    [productTitleById],
  );

  const filteredOrders = useMemo(() => {
    if (!statusFilter) return orders;
    return orders.filter((o) => o.motico_status === statusFilter);
  }, [orders, statusFilter]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const printableSelectedCount = useMemo(() => {
    let n = 0;
    for (const o of orders) {
      if (selectedSet.has(o.id) && o.motico_status === MOTICO_STATUS_FOR_GUIDE_PRINT) n += 1;
    }
    return n;
  }, [orders, selectedSet]);

  useEffect(() => {
    setSelectedIds((ids) => ids.filter((id) => orders.some((o) => o.id === id)));
  }, [orders]);

  const allVisibleSelected =
    filteredOrders.length > 0 && filteredOrders.every((o) => selectedSet.has(o.id));

  useEffect(() => {
    const el = headerSelectRef.current;
    if (!el) return;
    const vis = filteredOrders;
    const nSel = vis.filter((o) => selectedSet.has(o.id)).length;
    el.indeterminate = nSel > 0 && nSel < vis.length;
  }, [filteredOrders, selectedSet]);

  const loadMoticoSettings = useCallback(async () => {
    try {
      const res = await apiFetch('/api/motico/settings');
      if (!res.ok) return;
      const data = (await res.json()) as {
        logo_data_url?: string | null;
        default_currency?: string | null;
      };
      setLogoDataUrl(typeof data.logo_data_url === 'string' ? data.logo_data_url : null);
      const cur = String(data.default_currency || 'COP')
        .trim()
        .toUpperCase();
      setTemplateCurrency(cur || 'COP');
    } catch {
      /* noop */
    }
  }, []);

  const loadData = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = Boolean(opts?.silent);
      if (!silent) setLoading(true);
      else setRefreshing(true);
      setError('');
      try {
        const qs = new URLSearchParams({ mensajero_filter: 'motico' });
        if (dateQuery.min) qs.set('created_at_min', dateQuery.min);
        if (dateQuery.max) qs.set('created_at_max', dateQuery.max);
        if (productId.trim()) qs.set('product_id', productId.trim());

        const [ordRes, prodRes] = await Promise.all([
          apiFetch(`/api/shopify/orders?${qs.toString()}`),
          apiFetch('/api/shopify/products?limit=250'),
        ]);

        if (prodRes.ok) {
          const pdata = (await prodRes.json().catch(() => ({}))) as { products?: unknown[] };
          setProducts(normalizeShopifyProducts(pdata));
        }

        const data = (await ordRes.json().catch(() => ({}))) as {
          source?: string;
          shop_domain?: string;
          fetchedAt?: string;
          orders?: MoticoOrderRow[];
          error?: string;
          code?: string;
        };

        if (!ordRes.ok) {
          if (data.code === 'not_connected') {
            setShopifyConnected(false);
            setShopDomain(null);
            setOrders([]);
            setFetchedAt(null);
            return;
          }
          setError(typeof data.error === 'string' ? data.error : 'No se pudieron cargar los pedidos');
          return;
        }

        if (data.source === 'shopify' && Array.isArray(data.orders)) {
          setShopifyConnected(true);
          setShopDomain(data.shop_domain || null);
          setFetchedAt(data.fetchedAt || null);
          setTotalAPagarDraft({});
          setOrders(data.orders.map((o) => normalizeRow(o as MoticoOrderRow)));
        }
      } catch {
        setError('Error de red al cargar datos');
      } finally {
        if (!silent) setLoading(false);
        setRefreshing(false);
      }
    },
    [dateQuery.min, dateQuery.max, productId],
  );

  const patchLocalFields = useCallback(async (orderId: number, body: Record<string, unknown>) => {
    const res = await apiFetch(`/api/shopify/orders/${orderId}/local-fields`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      motico_status?: string;
      price_override?: number | null;
      quantity_override?: number | null;
      total_a_pagar_override?: number | null;
    };
    if (!res.ok) {
      setSyncError(typeof data.error === 'string' ? data.error : 'Error al guardar');
      return false;
    }
    setSyncError('');
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== orderId) return o;
        const nextOverride =
          data.total_a_pagar_override !== undefined ? data.total_a_pagar_override : o.total_a_pagar_override;
        const nextTotalAPagar =
          data.total_a_pagar_override !== undefined
            ? data.total_a_pagar_override === null
              ? o.total_a_pagar_default
              : Number(data.total_a_pagar_override)
            : o.total_a_pagar;
        return {
          ...o,
          motico_status: data.motico_status !== undefined ? String(data.motico_status) : o.motico_status,
          price_override: data.price_override !== undefined ? data.price_override : o.price_override,
          quantity_override: data.quantity_override !== undefined ? data.quantity_override : o.quantity_override,
          total_a_pagar_override: nextOverride === undefined ? o.total_a_pagar_override : nextOverride,
          total_a_pagar: Number.isFinite(nextTotalAPagar) ? nextTotalAPagar : o.total_a_pagar,
        };
      }),
    );
    if (Object.prototype.hasOwnProperty.call(body, 'total_a_pagar_override')) {
      setTotalAPagarDraft((d) => {
        const n = { ...d };
        delete n[orderId];
        return n;
      });
    }
    return true;
  }, []);

  const scheduleTotalAPagarSave = useCallback(
    (orderId: number, raw: string) => {
      const prev = totalAPagarTimers.current.get(orderId);
      if (prev != null) window.clearTimeout(prev);
      const tid = window.setTimeout(() => {
        totalAPagarTimers.current.delete(orderId);
        const t = raw.trim();
        if (t === '') {
          void patchLocalFields(orderId, { total_a_pagar_override: null });
          return;
        }
        const normalized = t.replace(',', '.');
        const n = Number.parseFloat(normalized);
        if (!Number.isFinite(n) || n < 0) return;
        void patchLocalFields(orderId, { total_a_pagar_override: n });
      }, MOTICO_TOTAL_APAGAR_DEBOUNCE_MS);
      totalAPagarTimers.current.set(orderId, tid);
    },
    [patchLocalFields],
  );

  const buildLabelFromOrder = useCallback(
    (o: MoticoOrderRow): MoticoGuideLabelData => {
      const lineItems: MoticoLineItemRow[] = (o.lineItemsDetail || []).map((li, idx) => ({
        title: li.title,
        name: li.name,
        variant_title: li.variant_title,
        quantity: idx === 0 && o.quantity_override != null ? o.quantity_override : li.quantity,
        properties: li.properties,
      }));
      const totalStr = String(o.price_override != null ? o.price_override : o.total);
      const totalAmount = Number.parseFloat(totalStr);
      return buildMoticoGuideLabelData({
        orderName: o.orderName,
        client: o.client,
        shipping: o.shippingAddress,
        lineItems: lineItems.length
          ? lineItems
          : [{ title: summarizeProducts(o.productIds), quantity: o.defaultQuantity }],
        totalAmount: Number.isFinite(totalAmount) ? totalAmount : 0,
        currency: templateCurrency,
        fallbackProductSummary: summarizeProducts(o.productIds),
        defaultQuantity: o.quantity_override ?? o.defaultQuantity,
      });
    },
    [summarizeProducts, templateCurrency],
  );

  const toggleSelectOrder = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return [...s];
    });
  }, []);

  const toggleSelectAllVisible = useCallback(() => {
    const vis = filteredOrders;
    if (!vis.length) return;
    const allSelected = vis.every((o) => selectedSet.has(o.id));
    if (allSelected) {
      const visIds = new Set(vis.map((o) => o.id));
      setSelectedIds((prev) => prev.filter((id) => !visIds.has(id)));
    } else {
      setSelectedIds((prev) => {
        const s = new Set(prev);
        for (const o of vis) s.add(o.id);
        return [...s];
      });
    }
  }, [filteredOrders, selectedSet]);

  const clearSelection = useCallback(() => setSelectedIds([]), []);

  const handlePrintSelected = useCallback(() => {
    setGuideHint('');
    if (!logoDataUrl) {
      setGuideHint('Sube el logo (PNG o JPEG) arriba para imprimir las guías.');
      return;
    }
    const set = new Set(selectedIds);
    const list = orders.filter((o) => set.has(o.id));
    if (!list.length) {
      setGuideHint('Marca los pedidos a imprimir con la casilla de la primera columna.');
      return;
    }
    const eligible = list.filter((o) => o.motico_status === MOTICO_STATUS_FOR_GUIDE_PRINT);
    if (!eligible.length) {
      setGuideHint(
        'Solo se pueden imprimir guías de pedidos en estado «Imprimir guía». Cambia el estado o marca solo esos pedidos.',
      );
      return;
    }
    const skipped = list.length - eligible.length;
    if (skipped > 0) {
      setGuideHint(
        skipped === 1
          ? 'Se omitió 1 pedido que no está en «Imprimir guía». Se abre la vista previa con el resto.'
          : `Se omitieron ${skipped} pedidos que no están en «Imprimir guía». Vista previa con ${eligible.length}.`,
      );
    }
    const labels = eligible.map(buildLabelFromOrder);
    const ok = openMoticoGuidesBatchPrint(logoDataUrl, labels);
    if (!ok) {
      setGuideHint('Permite ventanas emergentes para abrir la vista previa de las guías.');
    }
  }, [logoDataUrl, orders, selectedIds, buildLabelFromOrder]);

  const handleOpenGuidesExcelPreview = useCallback(async () => {
    setGuideHint('');
    setGuidesExcelPreview(null);
    const set = new Set(selectedIds);
    const list = orders.filter((o) => set.has(o.id));
    if (!list.length) {
      setGuideHint('Marca los pedidos con la casilla de la primera columna.');
      return;
    }
    const eligible = list.filter((o) => o.motico_status === MOTICO_STATUS_FOR_GUIDE_PRINT);
    if (!eligible.length) {
      setGuideHint(
        'Solo se exportan pedidos en estado «Imprimir guía». Cambia el estado o marca solo esos pedidos.',
      );
      return;
    }
    const skipped = list.length - eligible.length;
    if (skipped > 0) {
      setGuideHint(
        skipped === 1
          ? 'Se omitió 1 pedido que no está en «Imprimir guía». La vista previa incluye el resto.'
          : `Se omitieron ${skipped} pedidos que no están en «Imprimir guía». Vista previa con ${eligible.length} pedidos.`,
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
        !o.is_motico_manual && o.id > 0
          ? expandLineItemsByQuantityForShopifyRelacion(rawDetails)
          : rawDetails;
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
          const numero =
            idx === 0 && o.quantity_override != null ? o.quantity_override : li.quantity;
          return { ...base, numero };
        });
      } else {
        const numero = o.quantity_override ?? o.defaultQuantity ?? o.shopifyQuantity ?? 0;
        lines = [
          {
            producto: summarizeProducts(o.productIds),
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
        cobro: o.total_a_pagar,
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
  }, [orders, selectedIds, summarizeProducts, templateCurrency]);

  const handleDownloadGuidesExcelFromPreview = useCallback(() => {
    if (!guidesExcelPreview) return;
    const url = URL.createObjectURL(guidesExcelPreview.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = guidesExcelPreview.filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [guidesExcelPreview]);

  const onMoticoStatusChange = useCallback(
    async (o: MoticoOrderRow, next: string) => {
      if (isMoticoStatusLocked(o.motico_status)) {
        setSyncError('El pedido está bloqueado (despachado/cancelado) y no se puede modificar.');
        return;
      }
      setGuideHint('');
      await patchLocalFields(o.id, { motico_status: next });
    },
    [patchLocalFields],
  );

  const openOrderEditor = useCallback((o: MoticoOrderRow) => {
    if (isMoticoStatusLocked(o.motico_status)) {
      setSyncError('El pedido está bloqueado (despachado/cancelado) y no se puede editar.');
      return;
    }
    setSyncError('');
    setEditorDraft(draftFromOrder(o));
    setEditorOrder(o);
  }, []);

  const saveOrderEditor = useCallback(async () => {
    if (!editorOrder) return;
    if (isMoticoStatusLocked(editorOrder.motico_status)) {
      setSyncError('El pedido está bloqueado (despachado/cancelado) y no se puede guardar.');
      return;
    }
    setEditorSaving(true);
    setSyncError('');
    try {
      const addrBody = {
        province: editorDraft.province,
        city: editorDraft.city,
        address1: editorDraft.address1,
        address2: editorDraft.address2,
        country: editorDraft.country,
        phone: editorDraft.phone,
      };
      const resAddr = await apiFetch(`/api/shopify/orders/${editorOrder.id}/shipping-address`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addrBody),
      });
      const dataAddr = (await resAddr.json().catch(() => ({}))) as {
        error?: string;
        shippingAddress?: MoticoShippingAddress | null;
      };
      if (!resAddr.ok) {
        setSyncError(typeof dataAddr.error === 'string' ? dataAddr.error : 'No se pudo guardar la dirección');
        return;
      }
      const nextSa = dataAddr.shippingAddress;
      setOrders((prev) =>
        prev.map((row) => {
          if (row.id !== editorOrder.id) return row;
          return normalizeRow({
            ...row,
            shippingAddress: nextSa
              ? {
                  name: nextSa.name || row.shippingAddress?.name || '',
                  address1: nextSa.address1 || '',
                  address2: nextSa.address2 || '',
                  city: nextSa.city || '',
                  province: nextSa.province || '',
                  zip: nextSa.zip || '',
                  country: nextSa.country || '',
                  phone: nextSa.phone || '',
                }
              : null,
          });
        }),
      );

      const pt = editorDraft.price.trim();
      const qt = editorDraft.quantity.trim();
      const patchBody: Record<string, unknown> = { sync_to_shopify: false };

      if (pt === '') {
        patchBody.price_override = null;
      } else {
        const priceNum = Number.parseFloat(pt.replace(',', '.'));
        if (!Number.isFinite(priceNum) || priceNum < 0) {
          setSyncError('Precio no válido');
          return;
        }
        patchBody.price_override = priceNum;
      }

      if (qt === '') {
        patchBody.quantity_override = null;
      } else {
        const qNum = parseInt(qt, 10);
        if (!Number.isFinite(qNum) || qNum < 1) {
          setSyncError('La cantidad debe ser al menos 1');
          return;
        }
        patchBody.quantity_override = qNum;
      }

      if (pt !== '' && qt !== '') {
        patchBody.sync_to_shopify = true;
      }
      if (editorOrder.id < 0 || editorOrder.is_motico_manual) {
        patchBody.sync_to_shopify = false;
        const normalizedItems = editorDraft.line_items
          .map((line) => {
            const pid = Number(line.product_id);
            if (!Number.isFinite(pid) || pid <= 0) return null;
            const product = productById.get(pid);
            if (!product) return null;
            const variants = Array.isArray(product.variants) ? product.variants : [];
            const selectedVariant =
              variants.find((v) => String(v.id) === String(line.variant_id)) || variants[0] || null;
            const qty = parseInt(String(line.quantity || '1'), 10);
            if (!Number.isFinite(qty) || qty < 1) return null;
            return {
              product_id: pid,
              variant_id: selectedVariant ? Number(selectedVariant.id) : null,
              title: String(product.title || 'Producto').trim() || 'Producto',
              variant_title: selectedVariant ? String(selectedVariant.title || '').trim() : '',
              sku: selectedVariant ? String(selectedVariant.sku || '').trim() : '',
              barcode: selectedVariant ? String(selectedVariant.barcode || '').trim() : '',
              quantity: qty,
            };
          })
          .filter(Boolean);
        if (!normalizedItems.length) {
          setSyncError('Selecciona al menos un producto del inventario.');
          return;
        }
        patchBody.line_items = normalizedItems;
        patchBody.quantity_override = null;
      }

      const okLocal = await patchLocalFields(editorOrder.id, patchBody);
      if (!okLocal) return;
      if (editorOrder.id < 0 || editorOrder.is_motico_manual) {
        await loadData(true);
      }

      setEditorOrder(null);
      setEditorDraft(emptyEditorDraft());
    } finally {
      setEditorSaving(false);
    }
  }, [editorOrder, editorDraft, patchLocalFields, productById, loadData]);

  const updateManualLine = useCallback(
    (idx: number, patch: Partial<ManualCreateDraft['line_items'][number]>) => {
      setManualDraft((d) => ({
        ...d,
        line_items: d.line_items.map((line, i) => (i === idx ? { ...line, ...patch } : line)),
      }));
    },
    [],
  );

  const updateManualLineProduct = useCallback(
    (idx: number, nextProductId: string) => {
      const pid = Number(nextProductId);
      const product = Number.isFinite(pid) ? productById.get(pid) : undefined;
      const firstVariantId = product?.variants?.[0]?.id ? String(product.variants[0].id) : '';
      updateManualLine(idx, { product_id: nextProductId, variant_id: firstVariantId });
    },
    [productById, updateManualLine],
  );

  const addManualLine = useCallback(() => {
    setManualDraft((d) => ({ ...d, line_items: [...d.line_items, emptyManualLine()] }));
  }, []);

  const removeManualLine = useCallback((idx: number) => {
    setManualDraft((d) => {
      const next = d.line_items.filter((_, i) => i !== idx);
      return { ...d, line_items: next.length ? next : [emptyManualLine()] };
    });
  }, []);

  const updateEditorLine = useCallback(
    (idx: number, patch: Partial<MoticoEditorDraft['line_items'][number]>) => {
      setEditorDraft((d) => ({
        ...d,
        line_items: d.line_items.map((line, i) => (i === idx ? { ...line, ...patch } : line)),
      }));
    },
    [],
  );

  const updateEditorLineProduct = useCallback(
    (idx: number, nextProductId: string) => {
      const pid = Number(nextProductId);
      const product = Number.isFinite(pid) ? productById.get(pid) : undefined;
      const firstVariantId = product?.variants?.[0]?.id ? String(product.variants[0].id) : '';
      updateEditorLine(idx, { product_id: nextProductId, variant_id: firstVariantId });
    },
    [productById, updateEditorLine],
  );

  const addEditorLine = useCallback(() => {
    setEditorDraft((d) => ({ ...d, line_items: [...d.line_items, emptyManualLine()] }));
  }, []);

  const removeEditorLine = useCallback((idx: number) => {
    setEditorDraft((d) => {
      const next = d.line_items.filter((_, i) => i !== idx);
      return { ...d, line_items: next.length ? next : [emptyManualLine()] };
    });
  }, []);

  const submitManualOrder = useCallback(async () => {
    setManualError('');
    setManualSaving(true);
    try {
      const normalizedItems = manualDraft.line_items
        .map((line) => {
          const pid = Number(line.product_id);
          if (!Number.isFinite(pid) || pid <= 0) return null;
          const product = productById.get(pid);
          if (!product) return null;
          const variants = Array.isArray(product.variants) ? product.variants : [];
          const selectedVariant =
            variants.find((v) => String(v.id) === String(line.variant_id)) || variants[0] || null;
          const qty = parseInt(String(line.quantity || '1'), 10);
          if (!Number.isFinite(qty) || qty < 1) return null;
          return {
            product_id: pid,
            variant_id: selectedVariant ? Number(selectedVariant.id) : null,
            title: String(product.title || 'Producto').trim() || 'Producto',
            variant_title: selectedVariant ? String(selectedVariant.title || '').trim() : '',
            sku: selectedVariant ? String(selectedVariant.sku || '').trim() : '',
            barcode: selectedVariant ? String(selectedVariant.barcode || '').trim() : '',
            quantity: qty,
          };
        })
        .filter(Boolean) as Array<{
        product_id: number;
        variant_id: number | null;
        title: string;
        variant_title: string;
        sku: string;
        barcode: string;
        quantity: number;
      }>;

      if (!normalizedItems.length) {
        setManualError('Selecciona al menos un producto del inventario.');
        return;
      }

      const payload: Record<string, unknown> = {
        client_name: manualDraft.client_name.trim(),
        client_email: manualDraft.client_email.trim(),
        order_name: manualOrderNamePreview,
        phone: manualDraft.phone.trim(),
        product_summary: normalizedItems
          .map((x) => (x.variant_title ? `${x.title} (${x.variant_title})` : x.title))
          .join(' + ')
          .slice(0, 600),
        line_items: normalizedItems,
        note: manualDraft.note.trim(),
        total: manualDraft.total.trim(),
        quantity: String(normalizedItems.reduce((sum, x) => sum + x.quantity, 0)),
        financial_status: manualDraft.financial_status,
        province: manualDraft.province.trim(),
        city: manualDraft.city.trim(),
        address1: manualDraft.address1.trim(),
        address2: manualDraft.address2.trim(),
        country: manualDraft.country.trim(),
      };
      const ca = manualDraft.created_at.trim();
      if (ca) {
        const iso = creationDateAt8amLocalToIso(ca);
        if (!iso) {
          setManualError('Revisa la fecha de creación.');
          return;
        }
        payload.created_at = iso;
      }
      const res = await apiFetch('/api/motico/manual-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setManualError(typeof data.error === 'string' ? data.error : 'No se pudo crear el pedido');
        return;
      }
      setManualModalOpen(false);
      setManualDraft(emptyManualDraft());
      void loadData();
    } catch {
      setManualError('Error de red');
    } finally {
      setManualSaving(false);
    }
  }, [manualDraft, manualOrderNamePreview, productById, loadData]);

  useEffect(() => {
    if (!editorOrder) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditorOrder(null);
        setEditorDraft(emptyEditorDraft());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editorOrder]);

  useEffect(() => {
    if (!manualModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [manualModalOpen]);

  useEffect(() => {
    if (!logoPanelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLogoPanelOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [logoPanelOpen]);

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
    void loadMoticoSettings();
  }, [loadMoticoSettings]);

  useEffect(() => {
    if (!shopifyConnected) return;
    void loadData();
  }, [shopifyConnected, loadData]);

  useEffect(() => {
    if (!shopifyConnected) return;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      void loadData({ silent: true });
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [shopifyConnected, loadData]);

  const useLive = shopifyConnected && shopDomain;

  return (
    <>
      <PageHeader
        title="Motico"
        subtitle={
          useLive
            ? `Pedidos con mensajero Motico · ${shopDomain}. Precio y cantidad se sincronizan con Shopify (primera línea del pedido).`
            : 'Conecta Shopify en Canales. Asigna Motico en Pedidos.'
        }
        right={
          useLive ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                disabled={refreshing || loading || manualSaving}
                onClick={() => {
                  setManualOrderNamePreview(`Whatsapp #${getNextManualWhatsappOrderNumber(orders)}`);
                  setManualError('');
                  setManualDraft(emptyManualDraft());
                  setManualModalOpen(true);
                }}
                style={{
                  padding: '7px 14px',
                  borderRadius: 8,
                  border: `1px solid ${ds.brand}`,
                  background: ds.brandBg,
                  color: ds.brand,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: refreshing || loading || manualSaving ? 'wait' : 'pointer',
                }}
              >
                Nuevo pedido manual
              </button>
              <button
                type="button"
                disabled={refreshing || loading}
                onClick={() => void loadData()}
                style={{
                  padding: '7px 14px',
                  borderRadius: 8,
                  border: `1px solid ${ds.borderCard}`,
                  background: ds.bgCard,
                  color: ds.textSecondary,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: refreshing || loading ? 'wait' : 'pointer',
                }}
              >
                {refreshing || loading ? 'Actualizando…' : 'Actualizar ahora'}
              </button>
            </div>
          ) : null
        }
      />

      {useLive ? (
        <div style={{ marginBottom: 18 }}>
          <button
            type="button"
            onClick={() => {
              setLogoMessage('');
              setLogoPanelOpen(true);
            }}
            style={{
              padding: 0,
              border: 'none',
              background: 'none',
              color: ds.brand,
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
            }}
          >
            Agregar logo
          </button>
        </div>
      ) : null}

      {useLive && logoPanelOpen ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.18)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            zIndex: 95,
          }}
          role="dialog"
          aria-modal
          aria-labelledby="motico-logo-panel-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setLogoPanelOpen(false);
          }}
        >
          <div
            style={{
              background: ds.bgCard,
              borderRadius: 16,
              padding: 24,
              width: '100%',
              maxWidth: 420,
              border: `1px solid ${ds.borderCard}`,
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 20px 50px rgba(15, 23, 42, 0.12)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="motico-logo-panel-title"
              style={{ margin: '0 0 12px', fontSize: 17, fontWeight: 700, color: ds.textPrimary }}
            >
              Agregar logo
            </h2>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: ds.textSecondary, lineHeight: 1.55 }}>
              Formato <strong>PNG</strong> o <strong>JPEG</strong>. Tamaño recomendado: imagen horizontal, ancho entre{' '}
              <strong>400 y 1200 px</strong>; que el diseño importante quede centrado. Peso máximo aprox.{' '}
              <strong>400 KB</strong>. El logo se verá en la parte superior de cada guía (carta / Letter); hasta{' '}
              {GUIAS_POR_HOJA} guías por hoja.
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
                  alt="Vista previa del logo para guías Motico"
                  style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center', display: 'block' }}
                />
              ) : (
                <span style={{ fontSize: 12, color: ds.textHint, padding: 16, textAlign: 'center' }}>
                  Aún no hay logo. Usa «Elegir archivo» para cargar uno.
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

            {logoSaving ? (
              <div style={{ fontSize: 12, color: ds.textMuted, marginBottom: 10 }}>Guardando…</div>
            ) : null}
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

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
          marginBottom: 18,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: ds.textMuted }}>Fecha</span>
        {DATE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={!useLive && loading}
            onClick={() => setDatePreset(p.id)}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              border: `1px solid ${ds.borderCard}`,
              background: datePreset === p.id ? ds.brandBg : ds.bgCard,
              color: datePreset === p.id ? ds.brand : ds.textSecondary,
              fontSize: 11,
              fontWeight: datePreset === p.id ? 600 : 500,
              cursor: useLive || !loading ? 'pointer' : 'not-allowed',
              opacity: useLive || !loading ? 1 : 0.6,
            }}
          >
            {p.id === 'este_ano' ? 'Este año (hasta hoy)' : p.label}
          </button>
        ))}
        {datePreset === 'personalizado' ? (
          <>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              disabled={!useLive}
              style={{ ...filterCtl, maxWidth: 150 }}
            />
            <span style={{ fontSize: 12, color: ds.textMuted }}>a</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              disabled={!useLive}
              style={{ ...filterCtl, maxWidth: 150 }}
            />
          </>
        ) : null}

        <span style={{ fontSize: 12, fontWeight: 600, color: ds.textMuted, marginLeft: 8 }}>Producto</span>
        <select
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          disabled={!useLive}
          style={{ ...filterCtl, minWidth: 200, maxWidth: 280, fontWeight: 600 }}
        >
          <option value="">Todos los productos</option>
          {products.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.title}
            </option>
          ))}
        </select>

        <span style={{ fontSize: 12, fontWeight: 600, color: ds.textMuted, marginLeft: 8 }}>Estado</span>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          disabled={!useLive}
          style={{ ...filterCtl, minWidth: 180, maxWidth: 240, fontWeight: 600 }}
        >
          <option value="">Todos</option>
          {MOTICO_STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        {useLive ? (
          <>
            <span style={{ width: 1, height: 24, background: ds.borderCard, margin: '0 4px' }} aria-hidden />
            <button
              type="button"
              disabled={!printableSelectedCount}
              title={
                !selectedIds.length
                  ? 'Marca pedidos con la casilla de la primera columna'
                  : !printableSelectedCount
                    ? 'Solo se imprimen pedidos en estado «Imprimir guía»'
                    : 'Abrir vista previa para imprimir guías'
              }
              onClick={handlePrintSelected}
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
                !selectedIds.length
                  ? 'Marca pedidos con la casilla de la primera columna'
                  : !printableSelectedCount
                    ? 'Solo se exportan pedidos en estado «Imprimir guía»'
                    : 'Abrir vista previa de la relación Excel; luego puedes descargar el archivo'
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
                cursor:
                  printableSelectedCount && !guidesExcelPreviewLoading ? 'pointer' : 'not-allowed',
                opacity: printableSelectedCount && !guidesExcelPreviewLoading ? 1 : 0.5,
              }}
            >
              {guidesExcelPreviewLoading
                ? 'Generando vista previa…'
                : `Excel guías (${printableSelectedCount})`}
            </button>
            <button
              type="button"
              disabled={!filteredOrders.length}
              onClick={toggleSelectAllVisible}
              style={{
                padding: '7px 12px',
                borderRadius: 8,
                border: `1px solid ${ds.borderCard}`,
                background: ds.bgCard,
                color: ds.textSecondary,
                fontSize: 11,
                fontWeight: 600,
                cursor: filteredOrders.length ? 'pointer' : 'not-allowed',
              }}
            >
              {filteredOrders.length && filteredOrders.every((o) => selectedSet.has(o.id))
                ? 'Desmarcar visibles'
                : 'Marcar visibles'}
            </button>
            <button
              type="button"
              disabled={!selectedIds.length}
              onClick={clearSelection}
              style={{
                padding: '7px 12px',
                borderRadius: 8,
                border: `1px solid ${ds.borderCard}`,
                background: ds.bgCard,
                color: ds.textSecondary,
                fontSize: 11,
                fontWeight: 600,
                cursor: selectedIds.length ? 'pointer' : 'not-allowed',
              }}
            >
              Quitar selección
            </button>
          </>
        ) : null}
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
          aria-labelledby="motico-excel-preview-title"
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
              <h2
                id="motico-excel-preview-title"
                style={{ margin: 0, fontSize: 17, fontWeight: 700, color: ds.textPrimary }}
              >
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
              Misma información que irá en{' '}
              <strong style={{ color: ds.textPrimary }}>{guidesExcelPreview.filename}</strong>. Puedes descargar el
              .xlsx o cerrar cuando termines.
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
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 12,
                  color: ds.textPrimary,
                }}
              >
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
                onClick={handleDownloadGuidesExcelFromPreview}
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
                Descargar Excel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {syncError ? (
        <div
          style={{
            marginBottom: 12,
            padding: '10px 14px',
            borderRadius: 10,
            background: ds.dangerBg,
            color: ds.dangerText,
            fontSize: 13,
          }}
        >
          {syncError}
        </div>
      ) : null}

      {!useLive && !loading ? (
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
          {' · '}
          <Link to="/pedidos" style={{ color: ds.brand, fontWeight: 600 }}>
            Pedidos
          </Link>
        </div>
      ) : null}

      {fetchedAt && useLive ? (
        <div style={{ marginBottom: 14, fontSize: 12, color: ds.textMuted }}>
          Última sincronización:{' '}
          <span style={{ color: ds.textSecondary, fontWeight: 600 }}>{formatDate(fetchedAt)}</span>
        </div>
      ) : null}

      {error ? (
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
          {error}
        </div>
      ) : null}

      <DataTable
        title="Pedidos Motico"
        subtitle={
          useLive
            ? `${filteredOrders.length} pedido${filteredOrders.length === 1 ? '' : 's'}${statusFilter ? ' (filtrados)' : ''} · ${orders.length} en el rango`
            : 'Sin conexión a Shopify'
        }
      >
        {useLive && loading && orders.length === 0 ? (
          <div style={{ padding: 24, color: ds.textMuted, fontSize: 13, display: 'flex', alignItems: 'center', gap: 10 }}>
            <IconTruck />
            Cargando…
          </div>
        ) : (
          <div style={orderListTableScrollWrapperStyle}>
            <table style={moticoTableStyle}>
              <thead>
                <tr>
                  <Th
                    style={{
                      ...moticoThPad,
                      ...moticoStickySelectCol,
                      ...orderListTheadStickyCell,
                      zIndex: 10,
                      background: ds.bgApp,
                      borderRight: `1px solid ${ds.borderCard}`,
                    }}
                  >
                    <input
                      ref={headerSelectRef}
                      type="checkbox"
                      title="Marcar o desmarcar pedidos visibles"
                      disabled={!filteredOrders.length}
                      checked={allVisibleSelected}
                      onChange={() => toggleSelectAllVisible()}
                      style={{ width: 16, height: 16, cursor: filteredOrders.length ? 'pointer' : 'not-allowed' }}
                    />
                  </Th>
                  <Th
                    style={{
                      ...moticoThPad,
                      ...moticoEstadoThTd,
                      ...moticoStickyEstadoTh,
                      borderRight: `1px solid ${ds.borderCard}`,
                    }}
                  >
                    Estado
                  </Th>
                  <Th style={{ ...moticoThPad, ...orderListTheadStickyCell }}>Pedido</Th>
                  <Th style={{ ...moticoThPad, ...orderListTheadStickyCell }}>Fecha</Th>
                  <Th style={{ ...moticoThPad, ...orderListTheadStickyCell }}>Cliente</Th>
                  <Th style={{ ...moticoPhoneColumnTh, ...orderListTheadStickyCell }}>Teléfono</Th>
                  <Th style={{ ...moticoThPad, ...orderListTheadStickyCell }}>Departamento</Th>
                  <Th style={{ ...moticoThPad, ...orderListTheadStickyCell }}>Ciudad</Th>
                  <Th style={{ ...moticoThPad, ...orderListTheadStickyCell }}>Dirección</Th>
                  <Th style={{ ...moticoThPad, ...orderListTheadStickyCell }}>Precio</Th>
                  <Th style={{ ...moticoThPad, ...orderListTheadStickyCell }}>
                    Cantidad
                    <br />
                    final
                  </Th>
                  <Th style={{ ...moticoThPad, ...orderListTheadStickyCell }}>Pago</Th>
                  <Th style={{ ...moticoThPad, ...orderListTheadStickyCell }}>Total a pagar</Th>
                  <Th style={{ ...moticoThPad, ...orderListTheadStickyCell }}>Productos</Th>
                  <Th style={{ ...moticoEditColTh, ...orderListTheadStickyCell }} title="Editar pedido">
                    <IconPencil size={14} style={{ opacity: 0.4, display: 'block' }} aria-hidden />
                  </Th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((o, i, arr) => {
                  const meta = STATUS_META[o.motico_status] || STATUS_META[MOTICO_STATUS_DEFAULT];
                  const sa = o.shippingAddress;
                  const dirLine = [sa?.address1, sa?.address2].filter(Boolean).join(' · ').trim();
                  const showPrice = formatMoneyFromString(
                    String(o.price_override ?? o.shopifyTotal ?? ''),
                    o.currency,
                  );
                  const qtyFromLines = Array.isArray(o.lineItemsDetail)
                    ? o.lineItemsDetail.reduce((sum, li) => {
                        const q = Number(li?.quantity ?? 0);
                        return sum + (Number.isFinite(q) && q > 0 ? q : 0);
                      }, 0)
                    : 0;
                  /** Con líneas: suma de cantidades (fuente de verdad tras editar productos). Sin líneas útiles: override KOVO, luego defaults. */
                  const finalQuantity =
                    qtyFromLines > 0
                      ? qtyFromLines
                      : (o.quantity_override ?? o.defaultQuantity ?? o.shopifyQuantity);
                  const finalQtyTitle = [
                    qtyFromLines > 0 ? `Suma líneas: ${qtyFromLines}` : null,
                    o.quantity_override != null ? `Override cabecera KOVO: ${o.quantity_override}` : null,
                    o.defaultQuantity != null ? `Predeterminado pedido: ${o.defaultQuantity}` : null,
                    `Cantidad Shopify (referencia): ${o.shopifyQuantity}`,
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <tr
                      key={o.id}
                      style={{
                        borderLeft: `4px solid ${meta.rowColor}`,
                        background: `${meta.chipBg}22`,
                      }}
                    >
                      <Td
                        isLast={i === arr.length - 1}
                        style={{
                          ...moticoTdPad,
                          ...moticoStickySelectCol,
                          zIndex: 5,
                          background: `${meta.chipBg}22`,
                          borderRight: `1px solid ${ds.borderRow}`,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedSet.has(o.id)}
                          onChange={() => toggleSelectOrder(o.id)}
                          aria-label={`Incluir ${o.orderName} en impresión de guías`}
                          style={{ width: 16, height: 16, cursor: 'pointer' }}
                        />
                      </Td>
                      <Td
                        isLast={i === arr.length - 1}
                        style={{
                          ...moticoTdPad,
                          ...moticoEstadoThTd,
                          ...moticoStickyEstadoTdBase,
                          background: `${meta.chipBg}22`,
                          borderRight: `1px solid ${ds.borderRow}`,
                        }}
                      >
                        <div style={moticoEstadoActionsRow}>
                          <div style={moticoEstadoSelectShell}>
                            <select
                              style={{
                                ...moticoEstadoSelectStyle,
                                background: meta.chipBg,
                                color: meta.chipFg,
                                borderColor: meta.chipBorder,
                                cursor: isMoticoStatusLocked(o.motico_status) ? 'not-allowed' : 'pointer',
                                opacity: isMoticoStatusLocked(o.motico_status) ? 0.72 : 1,
                              }}
                              value={o.motico_status}
                              onChange={(e) => void onMoticoStatusChange(o, e.target.value)}
                              aria-label="Estado Motico"
                              disabled={isMoticoStatusLocked(o.motico_status)}
                              title={
                                isMoticoStatusLocked(o.motico_status)
                                  ? 'Pedido despachado/cancelado: estado bloqueado'
                                  : 'Cambiar estado'
                              }
                            >
                              {MOTICO_STATUS_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          {shopDomain ? (
                            <a
                              href={`https://${shopDomain}/admin/orders/${o.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                flexShrink: 0,
                                fontSize: 11,
                                color: ds.brand,
                                fontWeight: 600,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              Shopify
                            </a>
                          ) : null}
                        </div>
                      </Td>
                      <Td isLast={i === arr.length - 1} style={moticoTdPad}>
                        <div style={{ fontWeight: 600, fontSize: 12, color: ds.textPrimary }}>{o.orderName}</div>
                        <div style={{ fontSize: 10.5, color: ds.textHint }}>{o.email}</div>
                      </Td>
                      <Td isLast={i === arr.length - 1} style={moticoTdPad}>
                        {formatDate(o.createdAt)}
                      </Td>
                      <Td isLast={i === arr.length - 1} style={moticoTdPad}>
                        {o.client}
                      </Td>
                      <Td isLast={i === arr.length - 1} style={moticoPhoneColumnTd}>
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
                            {o.phoneLocal}
                          </button>
                        ) : (
                          <span style={{ fontSize: 11, color: ds.textMuted }}>—</span>
                        )}
                      </Td>
                      <Td isLast={i === arr.length - 1} style={moticoTdPad}>
                        <span style={{ fontSize: 11 }}>{sa?.province?.trim() || '—'}</span>
                      </Td>
                      <Td isLast={i === arr.length - 1} style={moticoTdPad}>
                        <span style={{ fontSize: 11 }}>{sa?.city?.trim() || '—'}</span>
                      </Td>
                      <Td isLast={i === arr.length - 1} style={moticoTdPad}>
                        <div
                          style={{
                            fontSize: 11,
                            wordBreak: 'break-word',
                            lineHeight: 1.35,
                            color: ds.textSecondary,
                          }}
                        >
                          {dirLine || '—'}
                        </div>
                      </Td>
                      <Td isLast={i === arr.length - 1} style={moticoTdPad}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: ds.textPrimary }}>{showPrice}</div>
                        <div style={{ fontSize: 9.5, color: ds.textHint, marginTop: 4 }}>
                          Shopify: {formatMoneyFromString(o.shopifyTotal, o.currency)}
                        </div>
                      </Td>
                      <Td isLast={i === arr.length - 1} style={moticoTdPad} title={finalQtyTitle}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: ds.textPrimary }}>{finalQuantity}</div>
                      </Td>
                      <Td isLast={i === arr.length - 1} style={moticoTdPad}>
                        <StatusBadge variant={o.badgeVariant}>{o.label}</StatusBadge>
                      </Td>
                      <Td isLast={i === arr.length - 1} style={moticoTdPad}>
                        <input
                          type="text"
                          inputMode="decimal"
                          style={{
                            ...moticoTotalAPagarInputStyle,
                            cursor: isMoticoStatusLocked(o.motico_status) ? 'not-allowed' : 'text',
                            opacity: isMoticoStatusLocked(o.motico_status) ? 0.72 : 1,
                          }}
                          value={
                            totalAPagarDraft[o.id] !== undefined
                              ? totalAPagarDraft[o.id]!
                              : String(o.total_a_pagar)
                          }
                          onChange={(e) => {
                            const v = e.target.value;
                            setTotalAPagarDraft((d) => ({ ...d, [o.id]: v }));
                            scheduleTotalAPagarSave(o.id, v);
                          }}
                          aria-label={`Total a pagar pedido ${o.orderName}`}
                          disabled={isMoticoStatusLocked(o.motico_status)}
                          title={
                            isMoticoStatusLocked(o.motico_status)
                              ? 'Pedido despachado/cancelado: total a pagar bloqueado'
                              : 'Editar total a pagar'
                          }
                        />
                        <div style={{ fontSize: 9.5, color: ds.textHint, marginTop: 4, lineHeight: 1.3 }}>
                          Calculado Shopify: {formatMoneyAmount(o.total_a_pagar_default, o.currency)}
                        </div>
                      </Td>
                      <Td isLast={i === arr.length - 1} style={moticoTdPad}>
                        <div style={{ fontSize: 11, color: ds.textSecondary, lineHeight: 1.35 }}>
                          {summarizeProducts(o.productIds)}
                        </div>
                      </Td>
                      <Td isLast={i === arr.length - 1} style={{ ...moticoTdPad, ...moticoColFitNowrap }}>
                        <button
                          type="button"
                          aria-label={`Editar pedido ${o.orderName}: dirección, precio y cantidad`}
                          onClick={() => openOrderEditor(o)}
                          style={{
                            ...moticoOrderEditIconBtn,
                            cursor: isMoticoStatusLocked(o.motico_status) ? 'not-allowed' : 'pointer',
                            opacity: isMoticoStatusLocked(o.motico_status) ? 0.5 : 1,
                          }}
                          disabled={isMoticoStatusLocked(o.motico_status)}
                          title={
                            isMoticoStatusLocked(o.motico_status)
                              ? 'Pedido despachado/cancelado: edición bloqueada'
                              : 'Editar pedido'
                          }
                        >
                          <IconPencil size={16} />
                        </button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {useLive && !loading && filteredOrders.length === 0 ? (
          <div style={{ padding: 16, fontSize: 13, color: ds.textMuted, lineHeight: 1.5 }}>
            {orders.length === 0
              ? 'No hay pedidos Motico en este rango.'
              : 'Ningún pedido coincide con el filtro de estado.'}{' '}
            <Link to="/pedidos" style={{ color: ds.brand, fontWeight: 600 }}>
              Pedidos
            </Link>
          </div>
        ) : null}
      </DataTable>

      {editorOrder ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.18)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            zIndex: 100,
          }}
          role="dialog"
          aria-modal
          aria-labelledby="motico-editor-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setEditorOrder(null);
              setEditorDraft(emptyEditorDraft());
            }
          }}
        >
          <div
            style={{
              background: ds.bgCard,
              borderRadius: 16,
              padding: 28,
              width: '100%',
              maxWidth: 460,
              border: `1px solid ${ds.borderCard}`,
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="motico-editor-title"
              style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: ds.textPrimary }}
            >
              {editorOrder.is_motico_manual || editorOrder.id < 0 ? 'Editar pedido manual' : 'Editar pedido'}
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: ds.textMuted, lineHeight: 1.4 }}>
              {editorOrder.orderName} ·{' '}
              {editorOrder.is_motico_manual || editorOrder.id < 0
                ? 'Dirección, precio y cantidad se guardan solo en KOVO (no en Shopify).'
                : 'Dirección, precio y cantidad se guardan en Shopify.'}
            </p>
            <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: ds.textSecondary, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              Dirección de envío
            </p>
            <label style={{ ...labelStyle, display: 'block' }}>
              Departamento / provincia
              <input
                type="text"
                value={editorDraft.province}
                onChange={(e) => setEditorDraft((d) => ({ ...d, province: e.target.value }))}
                style={modalFieldStyle}
                autoComplete="address-level1"
              />
            </label>
            <label style={{ ...labelStyle, display: 'block', marginTop: 14 }}>
              Ciudad
              <input
                type="text"
                value={editorDraft.city}
                onChange={(e) => setEditorDraft((d) => ({ ...d, city: e.target.value }))}
                style={modalFieldStyle}
                autoComplete="address-level2"
              />
            </label>
            <label style={{ ...labelStyle, display: 'block', marginTop: 14 }}>
              Dirección (línea 1)
              <input
                type="text"
                value={editorDraft.address1}
                onChange={(e) => setEditorDraft((d) => ({ ...d, address1: e.target.value }))}
                style={modalFieldStyle}
                autoComplete="address-line1"
              />
            </label>
            <label style={{ ...labelStyle, display: 'block', marginTop: 14 }}>
              Dirección (línea 2, opcional)
              <input
                type="text"
                value={editorDraft.address2}
                onChange={(e) => setEditorDraft((d) => ({ ...d, address2: e.target.value }))}
                style={modalFieldStyle}
                autoComplete="address-line2"
              />
            </label>
            <label style={{ ...labelStyle, display: 'block', marginTop: 14 }}>
              País
              <input
                type="text"
                value={editorDraft.country}
                onChange={(e) => setEditorDraft((d) => ({ ...d, country: e.target.value }))}
                style={modalFieldStyle}
                autoComplete="country-name"
              />
            </label>
            <label style={{ ...labelStyle, display: 'block', marginTop: 14 }}>
              Teléfono
              <input
                type="text"
                value={editorDraft.phone}
                onChange={(e) => setEditorDraft((d) => ({ ...d, phone: e.target.value }))}
                style={modalFieldStyle}
                autoComplete="tel"
              />
            </label>
            <p style={{ margin: '20px 0 10px', fontSize: 11, fontWeight: 700, color: ds.textSecondary, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              Precio y cantidad
            </p>
            <p style={{ margin: '0 0 12px', fontSize: 11, color: ds.textMuted, lineHeight: 1.4 }}>
              {editorOrder.is_motico_manual || editorOrder.id < 0
                ? 'Se aplican al pedido manual en KOVO. Deja vacío precio o cantidad para quitar el valor local.'
                : 'Se aplican a la primera línea del pedido en Shopify. Deja vacío solo uno de los dos si quieres quitar el valor local (sin sincronizar).'}
            </p>
            <label style={{ ...labelStyle, display: 'block' }}>
              Precio total
              <input
                type="text"
                inputMode="decimal"
                value={editorDraft.price}
                onChange={(e) => setEditorDraft((d) => ({ ...d, price: e.target.value }))}
                style={modalFieldStyle}
              />
            </label>
            <label style={{ ...labelStyle, display: 'block', marginTop: 14 }}>
              Cantidad
              <input
                type="text"
                inputMode="numeric"
                value={editorDraft.quantity}
                onChange={(e) => setEditorDraft((d) => ({ ...d, quantity: e.target.value }))}
                style={modalFieldStyle}
              />
            </label>
            {editorOrder.is_motico_manual || editorOrder.id < 0 ? (
              <div style={{ marginTop: 14 }}>
                <p
                  style={{
                    margin: '0 0 8px',
                    fontSize: 11,
                    fontWeight: 700,
                    color: ds.textSecondary,
                    textTransform: 'uppercase',
                    letterSpacing: '0.4px',
                  }}
                >
                  Productos del inventario
                </p>
                {editorDraft.line_items.map((line, idx) => {
                  const selectedProduct = productById.get(Number(line.product_id));
                  const variants = selectedProduct?.variants || [];
                  const canRemove = editorDraft.line_items.length > 1;
                  return (
                    <div
                      key={`editor-line-${idx}`}
                      style={{
                        border: `1px solid ${ds.borderCard}`,
                        borderRadius: 10,
                        background: ds.bgSubtle,
                        padding: 10,
                        marginBottom: 10,
                      }}
                    >
                      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 92px', gap: 8 }}>
                        <label style={{ ...labelStyle, display: 'block' }}>
                          Producto
                          <select
                            value={line.product_id}
                            onChange={(e) => updateEditorLineProduct(idx, e.target.value)}
                            style={{ ...modalFieldStyle, marginTop: 6, cursor: 'pointer' }}
                          >
                            <option value="">Selecciona producto</option>
                            {products.map((p) => (
                              <option key={p.id} value={String(p.id)}>
                                {p.title}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label style={{ ...labelStyle, display: 'block' }}>
                          Variante
                          <select
                            value={line.variant_id}
                            onChange={(e) => updateEditorLine(idx, { variant_id: e.target.value })}
                            style={{ ...modalFieldStyle, marginTop: 6, cursor: 'pointer' }}
                            disabled={!line.product_id || variants.length === 0}
                          >
                            <option value="">{variants.length ? 'Selecciona variante' : 'Sin variantes'}</option>
                            {variants.map((v) => (
                              <option key={v.id} value={String(v.id)}>
                                {v.title || 'Variante'}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label style={{ ...labelStyle, display: 'block' }}>
                          Cant.
                          <input
                            type="text"
                            inputMode="numeric"
                            value={line.quantity}
                            onChange={(e) => updateEditorLine(idx, { quantity: e.target.value })}
                            style={{ ...modalFieldStyle, marginTop: 6 }}
                          />
                        </label>
                      </div>
                      {canRemove ? (
                        <button
                          type="button"
                          onClick={() => removeEditorLine(idx)}
                          style={{
                            marginTop: 8,
                            padding: '6px 10px',
                            borderRadius: 8,
                            border: `1px solid ${ds.borderCard}`,
                            background: ds.bgCard,
                            color: ds.textSecondary,
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Quitar producto
                        </button>
                      ) : null}
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={addEditorLine}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: `1px solid ${ds.brand}`,
                    background: ds.brandBg,
                    color: ds.brand,
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Agregar otro producto
                </button>
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 10, marginTop: 22, flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={editorSaving}
                onClick={() => {
                  setEditorOrder(null);
                  setEditorDraft(emptyEditorDraft());
                }}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: `1px solid ${ds.borderCard}`,
                  background: ds.bgCard,
                  color: ds.textSecondary,
                  fontWeight: 600,
                  cursor: editorSaving ? 'not-allowed' : 'pointer',
                  fontSize: 13,
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={editorSaving}
                onClick={() => void saveOrderEditor()}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: `1px solid ${ds.brand}`,
                  background: ds.brandBg,
                  color: ds.brand,
                  fontWeight: 600,
                  cursor: editorSaving ? 'wait' : 'pointer',
                  fontSize: 13,
                  opacity: editorSaving ? 0.85 : 1,
                }}
              >
                {editorSaving
                  ? 'Guardando…'
                  : editorOrder.is_motico_manual || editorOrder.id < 0
                    ? 'Guardar'
                    : 'Guardar en Shopify'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {manualModalOpen ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.18)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            zIndex: 100,
          }}
          role="dialog"
          aria-modal
          aria-labelledby="motico-manual-title"
        >
          <div
            style={{
              background: ds.bgCard,
              borderRadius: 16,
              padding: 28,
              width: '100%',
              maxWidth: 480,
              border: `1px solid ${ds.borderCard}`,
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="motico-manual-title"
              style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: ds.textPrimary }}
            >
              Nuevo pedido manual
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: ds.textMuted, lineHeight: 1.45 }}>
              El pedido queda solo en KOVO (Motico), no en Shopify.
            </p>
            <div
              style={{
                margin: '0 0 14px',
                padding: '10px 12px',
                borderRadius: 10,
                border: `1px solid ${ds.borderCard}`,
                background: ds.bgSubtle,
              }}
            >
              <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: ds.textSecondary, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                Número único
              </span>
              <span style={{ display: 'block', marginTop: 4, fontSize: 14, fontWeight: 700, color: ds.textPrimary }}>
                {manualOrderNamePreview}
              </span>
            </div>
            {manualError ? (
              <p style={{ margin: '0 0 12px', fontSize: 13, color: ds.dangerText }}>{manualError}</p>
            ) : null}
            <label style={{ ...labelStyle, display: 'block' }}>
              Fecha de creación (opcional)
              <input
                type="date"
                value={manualDraft.created_at}
                onChange={(e) => setManualDraft((d) => ({ ...d, created_at: e.target.value }))}
                style={modalFieldStyle}
              />
              <span style={{ display: 'block', marginTop: 6, fontSize: 11, color: ds.textHint, fontWeight: 500 }}>
                Solo eliges el día; se guarda a las 8:00 a. m. (hora de tu equipo). Vacío = fecha y hora actuales.
              </span>
            </label>
            <label style={{ ...labelStyle, display: 'block', marginTop: 14 }}>
              Nombre del cliente *
              <input
                type="text"
                value={manualDraft.client_name}
                onChange={(e) => setManualDraft((d) => ({ ...d, client_name: e.target.value }))}
                style={modalFieldStyle}
                autoComplete="name"
              />
            </label>
            <label style={{ ...labelStyle, display: 'block', marginTop: 14 }}>
              Teléfono
              <input
                type="text"
                value={manualDraft.phone}
                onChange={(e) => setManualDraft((d) => ({ ...d, phone: e.target.value }))}
                style={modalFieldStyle}
                autoComplete="tel"
              />
            </label>
            <label style={{ ...labelStyle, display: 'block', marginTop: 14 }}>
              Email
              <input
                type="email"
                value={manualDraft.client_email}
                onChange={(e) => setManualDraft((d) => ({ ...d, client_email: e.target.value }))}
                style={modalFieldStyle}
                autoComplete="email"
              />
            </label>
            <div style={{ marginTop: 14 }}>
              <p
                style={{
                  margin: '0 0 8px',
                  fontSize: 11,
                  fontWeight: 700,
                  color: ds.textSecondary,
                  textTransform: 'uppercase',
                  letterSpacing: '0.4px',
                }}
              >
                Productos del inventario *
              </p>
              {manualDraft.line_items.map((line, idx) => {
                const selectedProduct = productById.get(Number(line.product_id));
                const variants = selectedProduct?.variants || [];
                const canRemove = manualDraft.line_items.length > 1;
                return (
                  <div
                    key={`manual-line-${idx}`}
                    style={{
                      border: `1px solid ${ds.borderCard}`,
                      borderRadius: 10,
                      background: ds.bgSubtle,
                      padding: 10,
                      marginBottom: 10,
                    }}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 92px', gap: 8 }}>
                      <label style={{ ...labelStyle, display: 'block' }}>
                        Producto
                        <select
                          value={line.product_id}
                          onChange={(e) => updateManualLineProduct(idx, e.target.value)}
                          style={{ ...modalFieldStyle, marginTop: 6, cursor: 'pointer' }}
                        >
                          <option value="">Selecciona producto</option>
                          {products.map((p) => (
                            <option key={p.id} value={String(p.id)}>
                              {p.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label style={{ ...labelStyle, display: 'block' }}>
                        Variante
                        <select
                          value={line.variant_id}
                          onChange={(e) => updateManualLine(idx, { variant_id: e.target.value })}
                          style={{ ...modalFieldStyle, marginTop: 6, cursor: 'pointer' }}
                          disabled={!line.product_id || variants.length === 0}
                        >
                          <option value="">{variants.length ? 'Selecciona variante' : 'Sin variantes'}</option>
                          {variants.map((v) => (
                            <option key={v.id} value={String(v.id)}>
                              {v.title || 'Variante'}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label style={{ ...labelStyle, display: 'block' }}>
                        Cant.
                        <input
                          type="text"
                          inputMode="numeric"
                          value={line.quantity}
                          onChange={(e) => updateManualLine(idx, { quantity: e.target.value })}
                          style={{ ...modalFieldStyle, marginTop: 6 }}
                        />
                      </label>
                    </div>
                    {canRemove ? (
                      <button
                        type="button"
                        onClick={() => removeManualLine(idx)}
                        style={{
                          marginTop: 8,
                          padding: '6px 10px',
                          borderRadius: 8,
                          border: `1px solid ${ds.borderCard}`,
                          background: ds.bgCard,
                          color: ds.textSecondary,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Quitar producto
                      </button>
                    ) : null}
                  </div>
                );
              })}
              <button
                type="button"
                onClick={addManualLine}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: `1px solid ${ds.brand}`,
                  background: ds.brandBg,
                  color: ds.brand,
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Agregar otro producto
              </button>
            </div>
            <label style={{ ...labelStyle, display: 'block', marginTop: 14 }}>
              Observaciones
              <textarea
                value={manualDraft.note}
                onChange={(e) => setManualDraft((d) => ({ ...d, note: e.target.value }))}
                style={{ ...modalFieldStyle, minHeight: 84, resize: 'vertical' }}
                placeholder="Escribe una nota para observaciones"
              />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginTop: 14 }}>
              <label style={{ ...labelStyle, display: 'block' }}>
                Total *
                <input
                  type="text"
                  inputMode="decimal"
                  value={manualDraft.total}
                  onChange={(e) => setManualDraft((d) => ({ ...d, total: e.target.value }))}
                  style={modalFieldStyle}
                />
              </label>
            </div>
            <label style={{ ...labelStyle, display: 'block', marginTop: 14 }}>
              Estado de pago
              <select
                value={manualDraft.financial_status}
                onChange={(e) =>
                  setManualDraft((d) => ({
                    ...d,
                    financial_status: e.target.value as ManualCreateDraft['financial_status'],
                  }))
                }
                style={{ ...modalFieldStyle, cursor: 'pointer' }}
              >
                <option value="pending">Pendiente de pago</option>
                <option value="unpaid">Sin pagar</option>
                <option value="paid">Pagado</option>
              </select>
            </label>
            <p style={{ margin: '18px 0 8px', fontSize: 11, fontWeight: 700, color: ds.textSecondary, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              Envío (opcional)
            </p>
            <label style={{ ...labelStyle, display: 'block' }}>
              Departamento / provincia
              <input
                type="text"
                value={manualDraft.province}
                onChange={(e) => setManualDraft((d) => ({ ...d, province: e.target.value }))}
                style={modalFieldStyle}
              />
            </label>
            <label style={{ ...labelStyle, display: 'block', marginTop: 14 }}>
              Ciudad
              <select
                value={manualDraft.city}
                onChange={(e) => setManualDraft((d) => ({ ...d, city: e.target.value }))}
                style={{ ...modalFieldStyle, cursor: 'pointer' }}
              >
                <option value="BOGOTA">BOGOTA</option>
                <option value="SOACHA">SOACHA</option>
              </select>
            </label>
            <label style={{ ...labelStyle, display: 'block', marginTop: 14 }}>
              Dirección
              <input
                type="text"
                value={manualDraft.address1}
                onChange={(e) => setManualDraft((d) => ({ ...d, address1: e.target.value }))}
                style={modalFieldStyle}
              />
            </label>
            <label style={{ ...labelStyle, display: 'block', marginTop: 14 }}>
              Dirección línea 2
              <input
                type="text"
                value={manualDraft.address2}
                onChange={(e) => setManualDraft((d) => ({ ...d, address2: e.target.value }))}
                style={modalFieldStyle}
              />
            </label>
            <label style={{ ...labelStyle, display: 'block', marginTop: 14 }}>
              País
              <input
                type="text"
                value={manualDraft.country}
                onChange={(e) => setManualDraft((d) => ({ ...d, country: e.target.value }))}
                style={modalFieldStyle}
              />
            </label>
            <div style={{ display: 'flex', gap: 10, marginTop: 22, flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={manualSaving}
                onClick={() => {
                  setManualModalOpen(false);
                  setManualDraft(emptyManualDraft());
                  setManualError('');
                }}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: `1px solid ${ds.borderCard}`,
                  background: ds.bgCard,
                  color: ds.textSecondary,
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: manualSaving ? 'not-allowed' : 'pointer',
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={manualSaving}
                onClick={() => void submitManualOrder()}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: ds.brand,
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: manualSaving ? 'wait' : 'pointer',
                  opacity: manualSaving ? 0.85 : 1,
                }}
              >
                {manualSaving ? 'Creando…' : 'Crear pedido'}
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
