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
  buildMoticoGuideLabelData,
  GUIAS_POR_HOJA,
  openMoticoGuidesBatchPrint,
  type MoticoGuideLabelData,
  type MoticoLineItemRow,
  type MoticoShippingAddress,
} from '../utils/moticoPrintGuide';

const POLL_MS = 25_000;
const MAX_LOGO_BYTES = 400_000;
/** Vista previa ~proporción de la celda del logo en la guía (≈18% del ancho × altura de franja 1.88in). */
const MOTICO_GUIDE_LOGO_PREVIEW_W_PX = 118;
const MOTICO_GUIDE_LOGO_PREVIEW_H_PX = 152;

const MOTICO_STATUS_OPTIONS = [
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

/** Solo pedidos en este estado pueden generar guías (vista previa / impresión). */
const MOTICO_STATUS_FOR_GUIDE_PRINT = 'imprimir_guia';

const STATUS_META = Object.fromEntries(MOTICO_STATUS_OPTIONS.map((o) => [o.value, o])) as Record<
  string,
  (typeof MOTICO_STATUS_OPTIONS)[number]
>;

type LineItemDetail = { id: number; title: string; quantity: number; price: string };

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
};

type ShopifyProduct = { id: number; title: string };

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

const selectStyle: CSSProperties = {
  width: '100%',
  minWidth: 260,
  maxWidth: 340,
  padding: '6px 8px',
  borderRadius: 8,
  border: `1px solid ${ds.borderCard}`,
  color: ds.textPrimary,
  fontSize: 12,
  fontWeight: 600,
};

/** Separación horizontal entre columnas de la tabla Motico. */
const MOTICO_COL_GAP_PX = 10;

/** Padding horizontal 18px (rango 16–20px pedido) en la tabla Pedidos Motico. */
const MOTICO_CELL_H_PAD = 18;
const moticoThPad: CSSProperties = { padding: `11px ${MOTICO_CELL_H_PAD}px` };
const moticoTdPad: CSSProperties = { padding: `12px ${MOTICO_CELL_H_PAD}px` };

/** Columna Estado: select + lápiz + Shopify en fila; ancho mínimo para evitar solapes. */
const moticoEstadoThTd: CSSProperties = {
  minWidth: 460,
  width: 460,
  verticalAlign: 'middle',
};

const moticoEstadoActionsRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'nowrap',
  minWidth: 0,
};

/** Área del desplegable de estado: ancho mínimo fijo tipo “badge” y tope para no comer el lápiz. */
const moticoEstadoSelectShell: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 240,
  maxWidth: 300,
};

const moticoEstadoSelectStyle: CSSProperties = {
  ...selectStyle,
  width: '100%',
  minWidth: 0,
  maxWidth: '100%',
  boxSizing: 'border-box',
};

/** Primera columna (checkbox): fija al hacer scroll horizontal. */
const moticoStickySelectCol: CSSProperties = {
  position: 'sticky',
  left: 0,
  width: 52,
  minWidth: 52,
  maxWidth: 52,
  boxSizing: 'border-box',
  boxShadow: '6px 0 12px -8px rgba(15, 23, 42, 0.25)',
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
  };
}

function draftFromOrder(o: MoticoOrderRow): MoticoEditorDraft {
  const sa = o.shippingAddress;
  return {
    province: sa?.province || '',
    city: sa?.city || '',
    address1: sa?.address1 || '',
    address2: sa?.address2 || '',
    country: sa?.country || '',
    phone: sa?.phone || '',
    price: String(o.price_override ?? o.shopifyTotal ?? ''),
    quantity: String(o.quantity_override ?? o.defaultQuantity ?? o.shopifyQuantity ?? 0),
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
    motico_status: allowed.has(o.motico_status) ? o.motico_status : 'confirmado',
    price_override: o.price_override != null ? Number(o.price_override) : null,
    quantity_override: o.quantity_override != null ? Number(o.quantity_override) : null,
    shopifyQuantity: Number(o.shopifyQuantity ?? o.defaultQuantity) || 0,
    defaultQuantity: Number(o.defaultQuantity) || 0,
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
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const headerSelectRef = useRef<HTMLInputElement>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoSaving, setLogoSaving] = useState(false);
  const [logoMessage, setLogoMessage] = useState('');

  const [editorOrder, setEditorOrder] = useState<MoticoOrderRow | null>(null);
  const [editorDraft, setEditorDraft] = useState<MoticoEditorDraft>(() => emptyEditorDraft());
  const [editorSaving, setEditorSaving] = useState(false);

  const dateQuery = useMemo(
    () => buildDateRange(datePreset, customFrom, customTo),
    [datePreset, customFrom, customTo],
  );

  const productTitleById = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of products) m.set(p.id, p.title);
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
      const data = (await res.json()) as { logo_data_url?: string | null };
      setLogoDataUrl(typeof data.logo_data_url === 'string' ? data.logo_data_url : null);
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
        const qs = new URLSearchParams({ limit: '250', mensajero_filter: 'motico' });
        if (dateQuery.min) qs.set('created_at_min', dateQuery.min);
        if (dateQuery.max) qs.set('created_at_max', dateQuery.max);
        if (productId.trim()) qs.set('product_id', productId.trim());

        const [ordRes, prodRes] = await Promise.all([
          apiFetch(`/api/shopify/orders?${qs.toString()}`),
          apiFetch('/api/shopify/products?limit=250'),
        ]);

        if (prodRes.ok) {
          const pdata = (await prodRes.json()) as { products?: ShopifyProduct[] };
          setProducts(Array.isArray(pdata.products) ? pdata.products : []);
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
    };
    if (!res.ok) {
      setSyncError(typeof data.error === 'string' ? data.error : 'Error al guardar');
      return false;
    }
    setSyncError('');
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId
          ? {
              ...o,
              motico_status: data.motico_status !== undefined ? String(data.motico_status) : o.motico_status,
              price_override: data.price_override !== undefined ? data.price_override : o.price_override,
              quantity_override: data.quantity_override !== undefined ? data.quantity_override : o.quantity_override,
            }
          : o,
      ),
    );
    const touchedPriceQty =
      Object.prototype.hasOwnProperty.call(body, 'price_override') ||
      Object.prototype.hasOwnProperty.call(body, 'quantity_override');
    if (touchedPriceQty) {
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
    }
    return true;
  }, []);

  const buildLabelFromOrder = useCallback(
    (o: MoticoOrderRow): MoticoGuideLabelData => {
      const lineItems: MoticoLineItemRow[] = (o.lineItemsDetail || []).map((li, idx) => {
        if (idx === 0 && o.quantity_override != null) {
          return { ...li, quantity: o.quantity_override };
        }
        return li;
      });
      const totalStr = String(o.price_override != null ? o.price_override : o.total);
      const totalAmount = Number.parseFloat(totalStr);
      return buildMoticoGuideLabelData({
        orderName: o.orderName,
        client: o.client,
        shipping: o.shippingAddress,
        lineItems: lineItems.length
          ? lineItems
          : [{ title: summarizeProducts(o.productIds), quantity: o.defaultQuantity, price: '' }],
        totalAmount: Number.isFinite(totalAmount) ? totalAmount : 0,
        currency: o.currency,
        fallbackProductSummary: summarizeProducts(o.productIds),
        defaultQuantity: o.quantity_override ?? o.defaultQuantity,
      });
    },
    [summarizeProducts],
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

  const onMoticoStatusChange = useCallback(
    async (o: MoticoOrderRow, next: string) => {
      setGuideHint('');
      await patchLocalFields(o.id, { motico_status: next });
    },
    [patchLocalFields],
  );

  const openOrderEditor = useCallback((o: MoticoOrderRow) => {
    setSyncError('');
    setEditorDraft(draftFromOrder(o));
    setEditorOrder(o);
  }, []);

  const saveOrderEditor = useCallback(async () => {
    if (!editorOrder) return;
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

      const okLocal = await patchLocalFields(editorOrder.id, patchBody);
      if (!okLocal) return;

      setEditorOrder(null);
      setEditorDraft(emptyEditorDraft());
    } finally {
      setEditorSaving(false);
    }
  }, [editorOrder, editorDraft, patchLocalFields]);

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

  const onLogoFile = useCallback(
    (file: File | null) => {
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
            setLogoMessage(`Logo guardado. Se usará en las guías impresas (hasta ${GUIAS_POR_HOJA} por hoja).`);
          } finally {
            setLogoSaving(false);
          }
        })();
      };
      reader.readAsDataURL(file);
    },
    [],
  );

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
          ) : null
        }
      />

      {useLive ? (
        <div
          style={{
            marginBottom: 18,
            padding: '14px 16px',
            borderRadius: 12,
            border: `1px solid ${ds.borderCard}`,
            background: ds.bgCard,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 14,
            alignItems: 'center',
          }}
        >
          <div style={{ flex: '1 1 220px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: ds.textMuted, marginBottom: 6, textTransform: 'uppercase' }}>
              Logo para guías (carta)
            </div>
            <div style={{ fontSize: 12, color: ds.textSecondary, marginBottom: 8, lineHeight: 1.4 }}>
              Sube PNG o JPEG. Marca pedidos en estado «Imprimir guía» e imprime: hasta {GUIAS_POR_HOJA} guías por hoja
              carta
              (Letter), diseño con logo y datos de envío.
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: logoSaving ? 'wait' : 'pointer' }}>
              <input
                type="file"
                accept="image/png,image/jpeg"
                disabled={logoSaving}
                style={{ fontSize: 12 }}
                onChange={(e) => onLogoFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {logoSaving ? <span style={{ fontSize: 12, color: ds.textMuted }}>Guardando…</span> : null}
            {logoMessage ? (
              <div style={{ fontSize: 12, color: logoMessage.includes('guardado') ? ds.brand : ds.dangerText, marginTop: 6 }}>
                {logoMessage}
              </div>
            ) : null}
          </div>
          {logoDataUrl ? (
            <div
              style={{
                width: MOTICO_GUIDE_LOGO_PREVIEW_W_PX,
                height: MOTICO_GUIDE_LOGO_PREVIEW_H_PX,
                flexShrink: 0,
                borderRadius: 8,
                border: `1px solid ${ds.borderCard}`,
                overflow: 'hidden',
                background: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <img
                src={logoDataUrl}
                alt="Logo Motico"
                style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center', display: 'block' }}
              />
            </div>
          ) : (
            <div
              style={{
                width: MOTICO_GUIDE_LOGO_PREVIEW_W_PX,
                height: MOTICO_GUIDE_LOGO_PREVIEW_H_PX,
                flexShrink: 0,
                borderRadius: 8,
                border: `2px dashed ${ds.borderCard}`,
                fontSize: 11,
                color: ds.textHint,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                padding: 6,
                boxSizing: 'border-box',
              }}
            >
              Sin logo
            </div>
          )}
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
            <table
              style={{
                ...tableBase,
                borderCollapse: 'separate',
                borderSpacing: `${MOTICO_COL_GAP_PX}px 0`,
                minWidth: 1760 + 11 * MOTICO_COL_GAP_PX,
              }}
            >
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
                  <Th style={{ ...moticoThPad, ...orderListTheadStickyCell }}>Pedido</Th>
                  <Th style={{ ...moticoThPad, ...orderListTheadStickyCell }}>Fecha</Th>
                  <Th style={{ ...moticoThPad, ...orderListTheadStickyCell }}>Cliente</Th>
                  <Th style={{ ...moticoThPad, ...orderListTheadStickyCell }}>Departamento</Th>
                  <Th style={{ ...moticoThPad, ...orderListTheadStickyCell }}>Ciudad</Th>
                  <Th style={{ ...moticoThPad, ...orderListTheadStickyCell }}>Dirección</Th>
                  <Th style={{ ...moticoThPad, ...orderListTheadStickyCell }}>Precio</Th>
                  <Th style={{ ...moticoThPad, ...orderListTheadStickyCell }}>Cant.</Th>
                  <Th style={{ ...moticoThPad, ...orderListTheadStickyCell }}>Pago</Th>
                  <Th style={{ ...moticoThPad, ...orderListTheadStickyCell }}>Productos</Th>
                  <Th style={{ ...moticoThPad, ...moticoEstadoThTd, ...orderListTheadStickyCell }}>Estado</Th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((o, i, arr) => {
                  const meta = STATUS_META[o.motico_status] || STATUS_META.confirmado;
                  const sa = o.shippingAddress;
                  const dirLine = [sa?.address1, sa?.address2].filter(Boolean).join(' · ').trim();
                  const showPrice = formatMoneyFromString(
                    String(o.price_override ?? o.shopifyTotal ?? ''),
                    o.currency,
                  );
                  const showQty = o.quantity_override ?? o.defaultQuantity ?? o.shopifyQuantity;
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
                            maxWidth: 220,
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
                      <Td isLast={i === arr.length - 1} style={moticoTdPad}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: ds.textPrimary }}>{showQty}</div>
                        <div style={{ fontSize: 9.5, color: ds.textHint, marginTop: 4 }}>Shopify: {o.shopifyQuantity}</div>
                      </Td>
                      <Td isLast={i === arr.length - 1} style={moticoTdPad}>
                        <StatusBadge variant={o.badgeVariant}>{o.label}</StatusBadge>
                      </Td>
                      <Td isLast={i === arr.length - 1} style={moticoTdPad}>
                        <div style={{ fontSize: 11, color: ds.textSecondary, maxWidth: 200, lineHeight: 1.35 }}>
                          {summarizeProducts(o.productIds)}
                        </div>
                      </Td>
                      <Td isLast={i === arr.length - 1} style={{ ...moticoTdPad, ...moticoEstadoThTd }}>
                        <div style={moticoEstadoActionsRow}>
                          <div style={moticoEstadoSelectShell}>
                            <select
                              style={{
                                ...moticoEstadoSelectStyle,
                                background: meta.chipBg,
                                color: meta.chipFg,
                                borderColor: meta.chipBorder,
                              }}
                              value={o.motico_status}
                              onChange={(e) => void onMoticoStatusChange(o, e.target.value)}
                              aria-label="Estado Motico"
                            >
                              {MOTICO_STATUS_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <button
                            type="button"
                            aria-label={`Editar pedido ${o.orderName}: dirección, precio y cantidad`}
                            onClick={() => openOrderEditor(o)}
                            style={{
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
                            }}
                          >
                            <IconPencil size={16} />
                          </button>
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
              Editar pedido
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: ds.textMuted, lineHeight: 1.4 }}>
              {editorOrder.orderName} · Dirección, precio y cantidad se guardan en Shopify.
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
              Se aplican a la primera línea del pedido en Shopify. Deja vacío solo uno de los dos si quieres quitar el
              valor local (sin sincronizar).
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
                {editorSaving ? 'Guardando…' : 'Guardar en Shopify'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
