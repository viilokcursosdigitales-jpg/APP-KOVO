import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';
import { labelStyle } from './authStyles';

type ShippingAddress = {
  name?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  zip?: string;
  country?: string;
  phone?: string;
};

type LineItemDetail = {
  product_id?: number | null;
  variant_id?: number | null;
  quantity: number;
};

type EditableOrder = {
  id: number;
  orderName: string;
  internal_status: string;
  financialStatus?: string;
  total: string;
  shopifyTotal: string;
  defaultQuantity: number;
  shopifyQuantity: number;
  price_override: number | null;
  quantity_override: number | null;
  pago_al_recibir_override?: number;
  anticipo_kovo_explicit?: boolean;
  total_a_pagar_default?: number | null;
  total_a_pagar_override?: number | null;
  total_a_pagar?: number | null;
  shippingAddress: ShippingAddress | null;
  lineItemsDetail?: LineItemDetail[];
};

type ProductVariant = {
  id: number;
  title: string;
};

type Product = {
  id: number;
  title: string;
  variants: ProductVariant[];
};

type EditDraft = {
  province: string;
  city: string;
  address1: string;
  address2: string;
  country: string;
  phone: string;
  price: string;
  anticipo: string;
  line_items: Array<{
    product_id: string;
    variant_id: string;
    quantity: string;
  }>;
};

type OrderAuditLog = {
  id: number;
  action: string;
  user_name: string;
  user_email: string;
  user_role: string;
  created_at: string | null;
};

const LOCKED_STATUSES = new Set(['despachado', 'cancelado']);

function normalizeProducts(raw: unknown): Product[] {
  const rows = raw && typeof raw === 'object' && Array.isArray((raw as { products?: unknown[] }).products)
    ? ((raw as { products?: unknown[] }).products as unknown[])
    : [];
  return rows
    .map((p) => {
      if (!p || typeof p !== 'object') return null;
      const src = p as { id?: unknown; title?: unknown; variants?: unknown[] };
      const id = Number(src.id);
      if (!Number.isFinite(id) || id <= 0) return null;
      const variantsRaw = Array.isArray(src.variants) ? src.variants : [];
      const variants = variantsRaw
        .map((v) => {
          if (!v || typeof v !== 'object') return null;
          const vv = v as { id?: unknown; title?: unknown };
          const vid = Number(vv.id);
          if (!Number.isFinite(vid) || vid <= 0) return null;
          return {
            id: vid,
            title: String(vv.title || '').trim() || 'Variante',
          };
        })
        .filter((v): v is ProductVariant => Boolean(v));
      return {
        id,
        title: String(src.title || '').trim() || `Producto ${id}`,
        variants,
      };
    })
    .filter((p): p is Product => Boolean(p));
}

function emptyDraft(): EditDraft {
  return {
    province: '',
    city: '',
    address1: '',
    address2: '',
    country: '',
    phone: '',
    price: '',
    anticipo: '0',
    line_items: [{ product_id: '', variant_id: '', quantity: '1' }],
  };
}

function effectiveOrderTotalAmount(o: Pick<EditableOrder, 'price_override' | 'shopifyTotal' | 'total'>): number {
  const n =
    o.price_override != null
      ? Number(o.price_override)
      : Number.parseFloat(String(o.shopifyTotal ?? o.total ?? '0'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Anticipo inicial en el editor alineado con el listado de Pedidos (incl. Shopify «paid» + override KOVO). */
function initialAnticipoDraftAmount(o: EditableOrder): number {
  const T = effectiveOrderTotalAmount(o);
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
  return computeAnticipoAmountFromOrder(o);
}

function computeAnticipoAmountFromOrder(
  o: Pick<EditableOrder, 'price_override' | 'shopifyTotal' | 'total' | 'total_a_pagar_override' | 'total_a_pagar' | 'total_a_pagar_default'>,
): number {
  const total = effectiveOrderTotalAmount(o);
  const pendingEdited =
    o.total_a_pagar_override != null && Number.isFinite(Number(o.total_a_pagar_override))
      ? Math.max(0, Number(o.total_a_pagar_override))
      : null;
  const pendingCurrent =
    o.total_a_pagar != null && Number.isFinite(Number(o.total_a_pagar))
      ? Math.max(0, Number(o.total_a_pagar))
      : null;
  const pendingDefault =
    o.total_a_pagar_default != null && Number.isFinite(Number(o.total_a_pagar_default))
      ? Math.max(0, Number(o.total_a_pagar_default))
      : total;
  const pending = pendingEdited ?? pendingCurrent ?? pendingDefault;
  return Math.max(0, total - pending);
}

function parseNonNegativeDecimalInput(value: string): number | null {
  const n = Number.parseFloat(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function formatMoneyAmount(n: number, currency: string): string {
  const cur = String(currency || '').trim().toUpperCase() || 'COP';
  try {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: cur }).format(n);
  } catch {
    return `${n.toFixed(2)} ${cur}`;
  }
}

function formatAuditAction(action: string): string {
  const a = String(action || '').trim().toLowerCase();
  if (a === 'update_local_fields') return 'Edición de datos del pedido';
  if (a === 'update_shipping_address') return 'Edición de dirección';
  if (a === 'create_manual_order') return 'Creación de pedido manual';
  return a || 'Cambio';
}

function formatAuditDate(iso: string | null): string {
  if (!iso) return 'Fecha no disponible';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(t));
}

export default function PedidosOrderEditPage() {
  const navigate = useNavigate();
  const params = useParams();
  const orderId = Number(params.orderId);
  const closeToPedidos = useCallback(() => {
    navigate('/pedidos', { replace: true });
  }, [navigate]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [order, setOrder] = useState<EditableOrder | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const variantsLoadedRef = useRef<Set<number>>(new Set());
  const [auditLogs, setAuditLogs] = useState<OrderAuditLog[]>([]);
  const [draft, setDraft] = useState<EditDraft>(() => emptyDraft());
  const [configuredCurrency, setConfiguredCurrency] = useState('COP');

  const locked = useMemo(() => {
    const st = String(order?.internal_status || '').trim().toLowerCase();
    return LOCKED_STATUSES.has(st);
  }, [order?.internal_status]);

  const buildFallbackLine = useCallback(() => {
    const p = products[0] || null;
    return {
      product_id: p ? String(p.id) : '',
      variant_id: p?.variants?.[0] ? String(p.variants[0].id) : '',
      quantity: '1',
    };
  }, [products]);

  const draftLines = useMemo(
    () =>
      Array.isArray(draft.line_items) && draft.line_items.length > 0
        ? draft.line_items
        : [buildFallbackLine()],
    [draft.line_items, buildFallbackLine],
  );

  useEffect(() => {
    setDraft((prev) => {
      const prevLines =
        Array.isArray(prev.line_items) && prev.line_items.length > 0 ? prev.line_items : [buildFallbackLine()];
      const nextLines = prevLines.map((line) => {
        const pid = Number(line.product_id);
        if (!Number.isFinite(pid) || pid <= 0) return line;
        const p = products.find((x) => x.id === pid);
        if (!p) return line;
        const hasVariant = p.variants.some((v) => String(v.id) === String(line.variant_id));
        if (hasVariant || String(line.variant_id || '').trim() !== '') return line;
        const first = p.variants[0];
        return { ...line, variant_id: first ? String(first.id) : '' };
      });
      if (nextLines.length === 0) nextLines.push(buildFallbackLine());
      const changed =
        nextLines.length !== prevLines.length ||
        nextLines.some((li, i) => li !== prevLines[i]);
      return changed ? { ...prev, line_items: nextLines } : prev;
    });
  }, [products, buildFallbackLine]);

  const updateLine = useCallback(
    (idx: number, patch: Partial<EditDraft['line_items'][number]>) => {
      setDraft((prev) => ({
        ...prev,
        line_items: prev.line_items.map((li, i) => (i === idx ? { ...li, ...patch } : li)),
      }));
    },
    [],
  );

  const ensureProductVariantsLoaded = useCallback(
    async (productId: number) => {
      if (!Number.isFinite(productId) || productId <= 0) return;
      if (variantsLoadedRef.current.has(productId)) return;
      const res = await apiFetch(`/api/shopify/products/${productId}/variants?limit=250`);
      if (!res.ok) return;
      const data = (await res.json().catch(() => ({}))) as { variants?: unknown[] };
      const variantsRaw = Array.isArray(data.variants) ? data.variants : [];
      const variants = variantsRaw
        .map((v) => {
          if (!v || typeof v !== 'object') return null;
          const vv = v as { id?: unknown; title?: unknown };
          const id = Number(vv.id);
          if (!Number.isFinite(id) || id <= 0) return null;
          return { id, title: String(vv.title || '').trim() || 'Variante' };
        })
        .filter((v): v is ProductVariant => Boolean(v));
      if (!variants.length) return;
      variantsLoadedRef.current.add(productId);
      setProducts((prev) =>
        prev.map((p) => (p.id === productId ? { ...p, variants } : p)),
      );
    },
    [],
  );

  const onLineProductChange = useCallback(
    (idx: number, productId: string) => {
      const pid = Number(productId);
      const p = Number.isFinite(pid) && pid > 0 ? products.find((x) => x.id === pid) : null;
      updateLine(idx, {
        product_id: productId,
        variant_id: p?.variants?.[0] ? String(p.variants[0].id) : '',
      });
      if (Number.isFinite(pid) && pid > 0) {
        void ensureProductVariantsLoaded(pid);
      }
    },
    [products, updateLine, ensureProductVariantsLoaded],
  );

  const addLine = useCallback(() => {
    setDraft((prev) => ({ ...prev, line_items: [...prev.line_items, buildFallbackLine()] }));
  }, [buildFallbackLine]);

  const removeLine = useCallback(
    (idx: number) => {
      setDraft((prev) => {
        const next = prev.line_items.filter((_, i) => i !== idx);
        return { ...prev, line_items: next.length ? next : [buildFallbackLine()] };
      });
    },
    [buildFallbackLine],
  );

  const loadData = useCallback(async () => {
    if (!Number.isFinite(orderId) || orderId <= 0) {
      setError('ID de pedido inválido');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const [orderRes, productsRes, settingsRes, auditRes] = await Promise.all([
        apiFetch(`/api/shopify/orders/${orderId}`),
        apiFetch('/api/shopify/products?limit=250&all_variants=1'),
        apiFetch('/api/motico/settings'),
        apiFetch(`/api/shopify/orders/${orderId}/audit-log`),
      ]);
      const orderData = (await orderRes.json().catch(() => ({}))) as {
        error?: string;
        order?: EditableOrder;
      };
      if (!orderRes.ok || !orderData.order) {
        setError(typeof orderData.error === 'string' ? orderData.error : 'No se pudo cargar el pedido');
        return;
      }
      const prodData = await productsRes.json().catch(() => ({}));
      const list = productsRes.ok ? normalizeProducts(prodData) : [];
      if (settingsRes.ok) {
        const settingsData = (await settingsRes.json().catch(() => ({}))) as { default_currency?: string | null };
        const cur = String(settingsData.default_currency || 'COP')
          .trim()
          .toUpperCase();
        if (cur) setConfiguredCurrency(cur);
      }
      const auditPayload = (await auditRes.json().catch(() => ({}))) as {
        logs?: OrderAuditLog[];
      };
      if (auditRes.ok && Array.isArray(auditPayload.logs)) {
        setAuditLogs(auditPayload.logs);
      } else {
        setAuditLogs([]);
      }
      const loadedOrder = orderData.order;
      setOrder(loadedOrder);
      setProducts(list);
      variantsLoadedRef.current = new Set(
        list
          .filter((p) => Array.isArray(p.variants) && p.variants.length > 0)
          .map((p) => Number(p.id))
          .filter((id) => Number.isFinite(id) && id > 0),
      );
      const orderProductIds =
        Array.isArray(loadedOrder.lineItemsDetail) && loadedOrder.lineItemsDetail.length
          ? [
              ...new Set(
                loadedOrder.lineItemsDetail
                  .map((li) => Number(li?.product_id))
                  .filter((n) => Number.isFinite(n) && n > 0),
              ),
            ]
          : [];
      if (orderProductIds.length > 0) {
        await Promise.all(orderProductIds.map((pid) => ensureProductVariantsLoaded(pid)));
      }

      const linesFromOrder =
        Array.isArray(loadedOrder.lineItemsDetail) && loadedOrder.lineItemsDetail.length
          ? loadedOrder.lineItemsDetail
              .map((li) => {
                const pid = li?.product_id != null ? Number(li.product_id) : NaN;
                if (!Number.isFinite(pid) || pid <= 0) return null;
                const p = list.find((x) => x.id === pid);
                if (!p) return null;
                const rawVid = li?.variant_id != null ? Number(li.variant_id) : NaN;
                const vid =
                  Number.isFinite(rawVid) && rawVid > 0
                    ? rawVid
                    : p.variants?.[0]?.id;
                const q = Number(li?.quantity);
                return {
                  product_id: String(pid),
                  variant_id: vid ? String(vid) : '',
                  quantity: Number.isFinite(q) && q > 0 ? String(q) : '1',
                };
              })
              .filter(Boolean)
          : [];
      const fallbackProduct = list[0] || null;
      const fallbackLine = {
        product_id: fallbackProduct ? String(fallbackProduct.id) : '',
        variant_id: fallbackProduct?.variants?.[0] ? String(fallbackProduct.variants[0].id) : '',
        quantity: String(
          loadedOrder.quantity_override ??
            loadedOrder.shopifyQuantity ??
            loadedOrder.defaultQuantity ??
            1,
        ),
      };
      const sa = loadedOrder.shippingAddress || {};
      setDraft({
        province: String(sa.province || ''),
        city: String(sa.city || ''),
        address1: String(sa.address1 || ''),
        address2: String(sa.address2 || ''),
        country: String(sa.country || ''),
        phone: String(sa.phone || ''),
        price: String(loadedOrder.price_override ?? loadedOrder.shopifyTotal ?? loadedOrder.total ?? ''),
        anticipo: String(initialAnticipoDraftAmount(loadedOrder)),
        line_items: linesFromOrder.length ? linesFromOrder : [fallbackLine],
      });
    } catch {
      setError('Error de red al cargar el pedido');
    } finally {
      setLoading(false);
    }
  }, [orderId, ensureProductVariantsLoaded]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeToPedidos();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [closeToPedidos]);

  const save = useCallback(async () => {
    if (!order || locked) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const price = Number.parseFloat(String(draft.price).replace(',', '.'));
      if (!Number.isFinite(price) || price < 0) {
        setError('Precio no válido');
        return;
      }
      const anticipo = Number.parseFloat(String(draft.anticipo).replace(',', '.'));
      if (!Number.isFinite(anticipo) || anticipo < 0) {
        setError('Pago anticipado no válido');
        return;
      }
      if (anticipo > price) {
        setError('El pago anticipado no puede ser mayor al precio total');
        return;
      }
      if (!draftLines.length) {
        setError('Agrega al menos un producto');
        return;
      }
      const parsedLines = draftLines
        .map((line) => {
          const productId = Number(line.product_id);
          if (!Number.isFinite(productId) || productId <= 0) return null;
          const product = products.find((p) => p.id === productId);
          if (!product) return null;
          const variant = product.variants.find((v) => String(v.id) === String(line.variant_id));
          if (!variant) return null;
          const qty = parseInt(String(line.quantity), 10);
          if (!Number.isFinite(qty) || qty < 1) return null;
          return {
            product_id: productId,
            variant_id: Number(variant.id),
            title: product.title.trim() || 'Producto',
            variant_title: String(variant.title || '').trim(),
            sku: '',
            barcode: '',
            quantity: qty,
          };
        })
        .filter(Boolean) as Array<{
        product_id: number;
        variant_id: number;
        title: string;
        variant_title: string;
        sku: string;
        barcode: string;
        quantity: number;
      }>;
      if (parsedLines.length !== draftLines.length) {
        setError('Revisa producto, variante y cantidad en todas las líneas');
        return;
      }
      const qty = parsedLines.reduce((sum, li) => sum + li.quantity, 0);
      if (!Number.isFinite(qty) || qty < 1) {
        setError('La cantidad total debe ser al menos 1');
        return;
      }
      const resAddr = await apiFetch(`/api/shopify/orders/${order.id}/shipping-address`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          province: draft.province,
          city: draft.city,
          address1: draft.address1,
          address2: draft.address2,
          country: draft.country,
          phone: draft.phone,
        }),
      });
      const dataAddr = (await resAddr.json().catch(() => ({}))) as { error?: string };
      if (!resAddr.ok) {
        setError(typeof dataAddr.error === 'string' ? dataAddr.error : 'No se pudo guardar la dirección');
        return;
      }
      const resLocal = await apiFetch(`/api/shopify/orders/${order.id}/local-fields`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          price_override: price,
          quantity_override: qty,
          pago_al_recibir_override: anticipo,
          total_a_pagar_override: Math.max(0, price - anticipo),
          sync_to_shopify: false,
          line_items: parsedLines,
        }),
      });
      const dataLocal = (await resLocal.json().catch(() => ({}))) as { error?: string };
      if (!resLocal.ok) {
        setError(typeof dataLocal.error === 'string' ? dataLocal.error : 'No se pudo guardar el pedido');
        return;
      }
      navigate('/pedidos', { replace: true });
    } finally {
      setSaving(false);
    }
  }, [order, locked, draft, draftLines, navigate, products]);

  const livePrice = parseNonNegativeDecimalInput(draft.price);
  const liveAnticipo = parseNonNegativeDecimalInput(draft.anticipo);
  const livePending = livePrice != null ? Math.max(0, livePrice - (liveAnticipo ?? 0)) : null;
  const anticipoExceedsPrice = livePrice != null && liveAnticipo != null && liveAnticipo > livePrice;

  return (
    <div
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        boxSizing: 'border-box',
      }}
    >
      <button
        type="button"
        aria-label="Cerrar edición y volver a Pedidos"
        onClick={closeToPedidos}
        style={{
          position: 'absolute',
          inset: 0,
          border: 'none',
          margin: 0,
          padding: 0,
          background: 'rgba(0,0,0,0.42)',
          cursor: 'pointer',
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pedidos-order-edit-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          maxWidth: 440,
          maxHeight: 'min(88vh, 680px)',
          display: 'flex',
          flexDirection: 'column',
          background: ds.bgCard,
          borderRadius: 12,
          border: `1px solid ${ds.borderCard}`,
          boxShadow: '0 16px 48px rgba(0,0,0,0.22)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 10,
            padding: '12px 14px',
            borderBottom: `1px solid ${ds.borderCard}`,
            background: ds.bgSubtle,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h1
              id="pedidos-order-edit-title"
              style={{
                margin: 0,
                fontSize: 15,
                fontWeight: 700,
                color: ds.textPrimary,
                lineHeight: 1.25,
              }}
            >
              Editar pedido
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: ds.textSecondary, lineHeight: 1.35 }}>
              Cambios solo en KOVO; no se modifica Shopify.
            </p>
          </div>
          <button
            type="button"
            onClick={closeToPedidos}
            style={{
              flexShrink: 0,
              width: 32,
              height: 32,
              borderRadius: 8,
              border: `1px solid ${ds.borderCard}`,
              background: ds.bgCard,
              color: ds.textSecondary,
              fontSize: 18,
              lineHeight: 1,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            padding: '12px 14px 14px',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {loading ? (
            <div style={{ color: ds.textMuted, fontSize: 12, padding: '8px 0' }}>Cargando pedido…</div>
          ) : null}
          {error ? (
            <div
              style={{
                marginBottom: 10,
                padding: '8px 10px',
                borderRadius: 8,
                background: ds.dangerBg,
                color: ds.dangerText,
                fontSize: 12,
              }}
            >
              {error}
            </div>
          ) : null}
          {success ? (
            <div
              style={{
                marginBottom: 10,
                padding: '8px 10px',
                borderRadius: 8,
                border: `1px solid ${ds.borderCard}`,
                background: ds.successBg,
                color: ds.successText,
                fontSize: 12,
              }}
            >
              {success}
            </div>
          ) : null}
          {order ? (
            <div>
          <p style={{ margin: '0 0 10px', fontSize: 11, color: ds.textSecondary }}>
            <strong style={{ color: ds.textPrimary }}>{order.orderName}</strong>
            {locked ? (
              <span style={{ color: ds.dangerText }}> · Bloqueado ({order.internal_status})</span>
            ) : null}
          </p>

          <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 700, color: ds.textSecondary, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
            Dirección de envío
          </p>
          <label style={{ ...labelStyle, display: 'block' }}>
            Departamento / provincia
            <input
              type="text"
              value={draft.province}
              onChange={(e) => setDraft((d) => ({ ...d, province: e.target.value }))}
              style={fieldStyle}
              disabled={locked || saving}
            />
          </label>
          <label style={{ ...labelStyle, display: 'block', marginTop: 8 }}>
            Ciudad
            <input
              type="text"
              value={draft.city}
              onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))}
              style={fieldStyle}
              disabled={locked || saving}
            />
          </label>
          <label style={{ ...labelStyle, display: 'block', marginTop: 8 }}>
            Dirección (línea 1)
            <input
              type="text"
              value={draft.address1}
              onChange={(e) => setDraft((d) => ({ ...d, address1: e.target.value }))}
              style={fieldStyle}
              disabled={locked || saving}
            />
          </label>
          <label style={{ ...labelStyle, display: 'block', marginTop: 8 }}>
            Dirección (línea 2)
            <input
              type="text"
              value={draft.address2}
              onChange={(e) => setDraft((d) => ({ ...d, address2: e.target.value }))}
              style={fieldStyle}
              disabled={locked || saving}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
            <label style={{ ...labelStyle, display: 'block' }}>
              País
              <input
                type="text"
                value={draft.country}
                onChange={(e) => setDraft((d) => ({ ...d, country: e.target.value }))}
                style={fieldStyle}
                disabled={locked || saving}
              />
            </label>
            <label style={{ ...labelStyle, display: 'block' }}>
              Teléfono
              <input
                type="text"
                value={draft.phone}
                onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                style={fieldStyle}
                disabled={locked || saving}
              />
            </label>
          </div>

          <p
            style={{
              margin: '12px 0 6px',
              fontSize: 10,
              fontWeight: 700,
              color: ds.textSecondary,
              textTransform: 'uppercase',
              letterSpacing: '0.4px',
            }}
          >
            Productos y variantes
          </p>
          <div style={{ display: 'grid', gap: 8 }}>
            {draftLines.map((line, idx) => {
              const pid = Number(line.product_id);
              const selected = Number.isFinite(pid) && pid > 0 ? products.find((p) => p.id === pid) || null : null;
              return (
                <div
                  key={`line-${idx}`}
                  style={{
                    border: `1px solid ${ds.borderCard}`,
                    borderRadius: 8,
                    padding: 8,
                    background: ds.bgSubtle,
                  }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 8 }}>
                    <label style={{ ...labelStyle, display: 'block' }}>
                      Producto
                      <select
                        value={line.product_id}
                        onChange={(e) => onLineProductChange(idx, e.target.value)}
                        style={fieldStyle}
                        disabled={locked || saving}
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
                        onChange={(e) => updateLine(idx, { variant_id: e.target.value })}
                        style={fieldStyle}
                        disabled={locked || saving || !selected}
                      >
                        <option value="">{selected ? 'Selecciona variante' : 'Sin variantes'}</option>
                        {(selected?.variants || []).map((v) => (
                          <option key={v.id} value={String(v.id)}>
                            {v.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'end' }}>
                    <label style={{ ...labelStyle, display: 'block', flex: '0 0 120px' }}>
                      Cantidad
                      <input
                        type="text"
                        inputMode="numeric"
                        value={line.quantity}
                        onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                        style={fieldStyle}
                        disabled={locked || saving}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeLine(idx)}
                      disabled={locked || saving || draftLines.length <= 1}
                      style={{
                        padding: '7px 10px',
                        borderRadius: 8,
                        border: `1px solid ${ds.borderCard}`,
                        background: ds.bgCard,
                        color: ds.textSecondary,
                        fontSize: 12,
                        cursor: locked || saving || draftLines.length <= 1 ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Quitar
                    </button>
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              onClick={addLine}
              disabled={locked || saving}
              style={{
                padding: '7px 10px',
                borderRadius: 8,
                border: `1px dashed ${ds.borderCard}`,
                background: ds.bgCard,
                color: ds.textSecondary,
                fontSize: 12,
                fontWeight: 600,
                cursor: locked || saving ? 'not-allowed' : 'pointer',
              }}
            >
              + Agregar producto
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
            <label style={{ ...labelStyle, display: 'block' }}>
              Precio total
              <input
                type="text"
                inputMode="decimal"
                value={draft.price}
                onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
                style={fieldStyle}
                disabled={locked || saving}
              />
            </label>
            <label style={{ ...labelStyle, display: 'block' }}>
              Pago anticipado
              <input
                type="text"
                inputMode="decimal"
                value={draft.anticipo}
                onChange={(e) => setDraft((d) => ({ ...d, anticipo: e.target.value }))}
                style={fieldStyle}
                disabled={locked || saving}
              />
            </label>
          </div>
          {order && String(order.financialStatus || '').toLowerCase() === 'paid' ? (
            <p style={{ margin: '6px 0 0', fontSize: 11, color: ds.textMuted, lineHeight: 1.4 }}>
              Shopify indica pagado. Puedes ajustar el anticipo en KOVO si el cobro registrado difiere (afecta pendiente
              al recibir en el listado).
            </p>
          ) : null}
          <div style={{ marginTop: 6 }}>
            <p style={{ margin: 0, fontSize: 11, color: ds.textSecondary }}>
              Pendiente por cobrar:{' '}
              <strong style={{ color: ds.textPrimary }}>
                {livePending != null ? formatMoneyAmount(livePending, configuredCurrency) : '—'}
              </strong>
            </p>
            {anticipoExceedsPrice ? (
              <p style={{ margin: '4px 0 0', fontSize: 12, color: ds.dangerText }}>
                El pago anticipado no puede ser mayor al precio total.
              </p>
            ) : null}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={closeToPedidos}
              disabled={saving}
              style={{
                padding: '7px 12px',
                borderRadius: 8,
                border: `1px solid ${ds.borderCard}`,
                background: ds.bgCard,
                color: ds.textSecondary,
                fontSize: 12,
                fontWeight: 600,
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.8 : 1,
              }}
            >
              Cerrar
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={locked || saving}
              style={{
                padding: '7px 12px',
                borderRadius: 8,
                border: `1px solid ${ds.brand}`,
                background: ds.brandBg,
                color: ds.brand,
                fontSize: 12,
                fontWeight: 600,
                cursor: locked || saving ? 'not-allowed' : 'pointer',
                opacity: locked || saving ? 0.8 : 1,
              }}
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>

          <div style={{ marginTop: 14 }}>
            <p
              style={{
                margin: '0 0 6px',
                fontSize: 10,
                fontWeight: 700,
                color: ds.textSecondary,
                textTransform: 'uppercase',
                letterSpacing: '0.4px',
              }}
            >
              Historial de cambios
            </p>
            <div
              style={{
                border: `1px solid ${ds.borderCard}`,
                borderRadius: 8,
                background: ds.bgSubtle,
                maxHeight: 140,
                overflow: 'auto',
              }}
            >
              {auditLogs.length === 0 ? (
                <p style={{ margin: 0, padding: '8px 10px', fontSize: 11, color: ds.textMuted }}>
                  Aún no hay registros para este pedido.
                </p>
              ) : (
                auditLogs.slice(0, 12).map((log, idx) => (
                  <div
                    key={log.id}
                    style={{
                      padding: '7px 10px',
                      borderTop: idx === 0 ? undefined : `1px solid ${ds.borderCard}`,
                    }}
                  >
                    <div style={{ fontSize: 11, color: ds.textPrimary, fontWeight: 600 }}>
                      {formatAuditAction(log.action)}
                    </div>
                    <div style={{ marginTop: 2, fontSize: 10, color: ds.textSecondary }}>
                      {formatAuditDate(log.created_at)} · {log.user_name || log.user_email || 'Usuario'}
                      {log.user_role ? ` (${log.user_role})` : ''}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const fieldStyle: CSSProperties = {
  width: '100%',
  maxWidth: '100%',
  boxSizing: 'border-box',
  padding: '6px 8px',
  borderRadius: 7,
  border: `1px solid ${ds.borderCard}`,
  background: ds.bgCard,
  color: ds.textPrimary,
  fontSize: 12,
  marginTop: 6,
};

