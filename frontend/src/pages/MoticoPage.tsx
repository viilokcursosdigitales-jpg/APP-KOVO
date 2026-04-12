import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';
import { DataTable, Th, Td, tableBase } from '../design-system/DataTable';
import { IconTruck } from '../design-system/icons';
import { PageHeader } from '../design-system/PageHeader';
import { StatusBadge, type StatusBadgeVariant } from '../design-system/StatusBadge';
import { type DatePreset, DATE_PRESETS, buildDateRange } from '../utils/datePresets';
import { openMoticoGuidePrint, type MoticoLineItemRow, type MoticoShippingAddress } from '../utils/moticoPrintGuide';

const POLL_MS = 25_000;
const SAVE_DEBOUNCE_MS = 500;
const MAX_LOGO_BYTES = 400_000;

const MOTICO_STATUS_OPTIONS = [
  { value: 'confirmado', label: 'Confirmado', rowColor: '#16a34a', chipBg: '#dcfce7', chipFg: '#14532d', chipBorder: '#86efac' },
  { value: 'imprimir_guia', label: 'Imprimir guía', rowColor: '#4f46e5', chipBg: '#e0e7ff', chipFg: '#312e81', chipBorder: '#a5b4fc' },
  { value: 'pagado', label: 'Pagado', rowColor: '#2563eb', chipBg: '#dbeafe', chipFg: '#1e3a8a', chipBorder: '#93c5fd' },
  { value: 'cancelado', label: 'Cancelado', rowColor: '#dc2626', chipBg: '#fee2e2', chipFg: '#7f1d1d', chipBorder: '#fca5a5' },
  { value: 'devolucion', label: 'Devolución', rowColor: '#d97706', chipBg: '#fef3c7', chipFg: '#78350f', chipBorder: '#fcd34d' },
] as const;

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
  maxWidth: 210,
  padding: '6px 8px',
  borderRadius: 8,
  border: `1px solid ${ds.borderCard}`,
  color: ds.textPrimary,
  fontSize: 11,
  fontWeight: 600,
};

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
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoSaving, setLogoSaving] = useState(false);
  const [logoMessage, setLogoMessage] = useState('');

  const [priceDraft, setPriceDraft] = useState<Record<number, string>>({});
  const [qtyDraft, setQtyDraft] = useState<Record<number, string>>({});
  const priceDraftRef = useRef(priceDraft);
  const qtyDraftRef = useRef(qtyDraft);
  priceDraftRef.current = priceDraft;
  qtyDraftRef.current = qtyDraft;
  const saveTimers = useRef<Map<number, number>>(new Map());
  const ordersRef = useRef<MoticoOrderRow[]>([]);
  ordersRef.current = orders;

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
          setPriceDraft({});
          setQtyDraft({});
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

  const flushPriceQtyToShopify = useCallback(async (orderId: number) => {
      const o = ordersRef.current.find((x) => x.id === orderId);
      if (!o) return;
      const pd = priceDraftRef.current;
      const qd = qtyDraftRef.current;
      const pRaw =
        pd[orderId] !== undefined ? pd[orderId]! : String(o.price_override ?? o.shopifyTotal ?? '');
      const qRaw =
        qd[orderId] !== undefined
          ? qd[orderId]!
          : String(o.quantity_override ?? o.defaultQuantity ?? o.shopifyQuantity ?? 0);
      const pt = pRaw.trim();
      const qt = qRaw.trim();
      if (pt === '') {
        await patchLocalFields(orderId, { price_override: null, sync_to_shopify: false });
        return;
      }
      if (qt === '') {
        await patchLocalFields(orderId, { quantity_override: null, sync_to_shopify: false });
        return;
      }
      const priceNum = Number.parseFloat(pt.replace(',', '.'));
      const qNum = parseInt(qt, 10);
      if (!Number.isFinite(priceNum) || priceNum < 0) return;
      if (!Number.isFinite(qNum) || qNum < 1) {
        setSyncError('La cantidad debe ser al menos 1 para sincronizar con Shopify');
        return;
      }
      await patchLocalFields(orderId, {
        price_override: priceNum,
        quantity_override: qNum,
        sync_to_shopify: true,
      });
  }, [patchLocalFields]);

  const scheduleSaveOrder = useCallback(
    (orderId: number) => {
      const prev = saveTimers.current.get(orderId);
      if (prev) window.clearTimeout(prev);
      const t = window.setTimeout(() => {
        saveTimers.current.delete(orderId);
        void flushPriceQtyToShopify(orderId);
      }, SAVE_DEBOUNCE_MS);
      saveTimers.current.set(orderId, t);
    },
    [flushPriceQtyToShopify],
  );

  useEffect(() => {
    return () => {
      saveTimers.current.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  const displayPrice = (o: MoticoOrderRow) =>
    priceDraft[o.id] !== undefined ? priceDraft[o.id]! : String(o.price_override ?? o.shopifyTotal ?? '');
  const displayQty = (o: MoticoOrderRow) =>
    qtyDraft[o.id] !== undefined
      ? qtyDraft[o.id]!
      : String(o.quantity_override ?? o.defaultQuantity ?? o.shopifyQuantity ?? 0);

  const runGuidePrint = useCallback(
    (o: MoticoOrderRow) => {
      const totalStr = String(o.price_override != null ? o.price_override : o.total);
      const displayTotal = formatMoneyFromString(totalStr, o.currency);
      const lineItems: MoticoLineItemRow[] = (o.lineItemsDetail || []).map((li, idx) => {
        if (idx === 0 && o.quantity_override != null) {
          return { ...li, quantity: o.quantity_override };
        }
        return li;
      });
      openMoticoGuidePrint({
        logoDataUrl,
        orderName: o.orderName,
        client: o.client,
        email: o.email,
        createdAt: formatDate(o.createdAt),
        displayTotal,
        currency: o.currency || '',
        shipping: o.shippingAddress,
        lineItems: lineItems.length ? lineItems : [{ title: summarizeProducts(o.productIds), quantity: o.defaultQuantity, price: '—' }],
        shopDomain,
        shopifyOrderId: o.id,
      });
    },
    [logoDataUrl, shopDomain, summarizeProducts],
  );

  const onMoticoStatusChange = useCallback(
    async (o: MoticoOrderRow, next: string) => {
      setGuideHint('');
      if (next === 'imprimir_guia' && !logoDataUrl) {
        setGuideHint('Sube un logo (PNG o JPEG) arriba antes de usar «Imprimir guía».');
        return;
      }
      const ok = await patchLocalFields(o.id, { motico_status: next });
      if (ok && next === 'imprimir_guia') {
        const fresh = ordersRef.current.find((x) => x.id === o.id) || { ...o, motico_status: next };
        runGuidePrint({ ...fresh, motico_status: next });
      }
    },
    [logoDataUrl, patchLocalFields, runGuidePrint],
  );

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
            setLogoMessage('Logo guardado. Se usará en todas las guías.');
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
              Sube PNG o JPEG; se reutiliza al imprimir cada guía al elegir «Imprimir guía».
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
                width: 140,
                height: 56,
                borderRadius: 8,
                border: `1px solid ${ds.borderCard}`,
                overflow: 'hidden',
                background: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <img src={logoDataUrl} alt="Logo Motico" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            </div>
          ) : (
            <div
              style={{
                width: 140,
                height: 56,
                borderRadius: 8,
                border: `2px dashed ${ds.borderCard}`,
                fontSize: 11,
                color: ds.textHint,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
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
          <div style={{ overflowX: 'auto' }}>
            <table style={{ ...tableBase, minWidth: 1120 }}>
              <thead>
                <tr>
                  <Th>Pedido</Th>
                  <Th>Cliente</Th>
                  <Th>Fecha</Th>
                  <Th>Precio</Th>
                  <Th>Cant.</Th>
                  <Th>Pago</Th>
                  <Th>Productos</Th>
                  <Th>Estado</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((o, i, arr) => {
                  const meta = STATUS_META[o.motico_status] || STATUS_META.confirmado;
                  return (
                    <tr
                      key={o.id}
                      style={{
                        borderLeft: `4px solid ${meta.rowColor}`,
                        background: `${meta.chipBg}22`,
                      }}
                    >
                      <Td isLast={i === arr.length - 1}>
                        <div style={{ fontWeight: 600, fontSize: 12, color: ds.textPrimary }}>{o.orderName}</div>
                        <div style={{ fontSize: 10.5, color: ds.textHint }}>{o.email}</div>
                      </Td>
                      <Td isLast={i === arr.length - 1}>{o.client}</Td>
                      <Td isLast={i === arr.length - 1}>{formatDate(o.createdAt)}</Td>
                      <Td isLast={i === arr.length - 1}>
                        <input
                          type="text"
                          inputMode="decimal"
                          style={inputStyle}
                          value={displayPrice(o)}
                          onChange={(e) => {
                            const v = e.target.value;
                            setPriceDraft((d) => ({ ...d, [o.id]: v }));
                            scheduleSaveOrder(o.id);
                          }}
                          aria-label="Precio"
                        />
                        <div style={{ fontSize: 9.5, color: ds.textHint, marginTop: 4 }}>
                          Shopify: {formatMoneyFromString(o.shopifyTotal, o.currency)}
                        </div>
                      </Td>
                      <Td isLast={i === arr.length - 1}>
                        <input
                          type="text"
                          inputMode="numeric"
                          style={inputStyle}
                          value={displayQty(o)}
                          onChange={(e) => {
                            const v = e.target.value;
                            setQtyDraft((d) => ({ ...d, [o.id]: v }));
                            scheduleSaveOrder(o.id);
                          }}
                          aria-label="Cantidad"
                        />
                        <div style={{ fontSize: 9.5, color: ds.textHint, marginTop: 4 }}>
                          Shopify: {o.shopifyQuantity}
                        </div>
                      </Td>
                      <Td isLast={i === arr.length - 1}>
                        <StatusBadge variant={o.badgeVariant}>{o.label}</StatusBadge>
                      </Td>
                      <Td isLast={i === arr.length - 1}>
                        <div style={{ fontSize: 11, color: ds.textSecondary, maxWidth: 200, lineHeight: 1.35 }}>
                          {summarizeProducts(o.productIds)}
                        </div>
                      </Td>
                      <Td isLast={i === arr.length - 1}>
                        <select
                          style={{
                            ...selectStyle,
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
                      </Td>
                      <Td isLast={i === arr.length - 1}>
                        {shopDomain ? (
                          <a
                            href={`https://${shopDomain}/admin/orders/${o.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: 11, color: ds.brand, fontWeight: 600 }}
                          >
                            Shopify
                          </a>
                        ) : null}
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
    </>
  );
}
