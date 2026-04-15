import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';
import { PageHeader } from '../design-system/PageHeader';
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
  total: string;
  shopifyTotal: string;
  defaultQuantity: number;
  shopifyQuantity: number;
  price_override: number | null;
  quantity_override: number | null;
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
  quantity: string;
  product_id: string;
  variant_id: string;
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
    quantity: '1',
    product_id: '',
    variant_id: '',
  };
}

export default function PedidosOrderEditPage() {
  const params = useParams();
  const orderId = Number(params.orderId);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [order, setOrder] = useState<EditableOrder | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [draft, setDraft] = useState<EditDraft>(() => emptyDraft());

  const selectedProduct = useMemo(() => {
    const pid = Number(draft.product_id);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    return products.find((p) => p.id === pid) || null;
  }, [draft.product_id, products]);

  const locked = useMemo(() => {
    const st = String(order?.internal_status || '').trim().toLowerCase();
    return LOCKED_STATUSES.has(st);
  }, [order?.internal_status]);

  useEffect(() => {
    if (!selectedProduct) return;
    const currentVariant = Number(draft.variant_id);
    const hasCurrent = selectedProduct.variants.some((v) => v.id === currentVariant);
    if (!hasCurrent) {
      const fallback = selectedProduct.variants[0];
      setDraft((prev) => ({ ...prev, variant_id: fallback ? String(fallback.id) : '' }));
    }
  }, [selectedProduct, draft.variant_id]);

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
      const [orderRes, productsRes] = await Promise.all([
        apiFetch(`/api/shopify/orders/${orderId}`),
        apiFetch('/api/shopify/products?limit=250'),
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
      const loadedOrder = orderData.order;
      setOrder(loadedOrder);
      setProducts(list);

      const firstLine = Array.isArray(loadedOrder.lineItemsDetail) && loadedOrder.lineItemsDetail.length
        ? loadedOrder.lineItemsDetail[0]
        : null;
      const firstProductId =
        firstLine?.product_id != null && Number.isFinite(Number(firstLine.product_id))
          ? Number(firstLine.product_id)
          : list[0]?.id || 0;
      const product = list.find((p) => p.id === firstProductId) || list[0] || null;
      const firstVariantId =
        firstLine?.variant_id != null && Number.isFinite(Number(firstLine.variant_id))
          ? Number(firstLine.variant_id)
          : product?.variants[0]?.id || 0;
      const sa = loadedOrder.shippingAddress || {};
      setDraft({
        province: String(sa.province || ''),
        city: String(sa.city || ''),
        address1: String(sa.address1 || ''),
        address2: String(sa.address2 || ''),
        country: String(sa.country || ''),
        phone: String(sa.phone || ''),
        price: String(loadedOrder.price_override ?? loadedOrder.shopifyTotal ?? loadedOrder.total ?? ''),
        quantity: String(
          loadedOrder.quantity_override ??
            firstLine?.quantity ??
            loadedOrder.shopifyQuantity ??
            loadedOrder.defaultQuantity ??
            1,
        ),
        product_id: firstProductId > 0 ? String(firstProductId) : '',
        variant_id: firstVariantId > 0 ? String(firstVariantId) : '',
      });
    } catch {
      setError('Error de red al cargar el pedido');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const save = useCallback(async () => {
    if (!order || locked) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const qty = parseInt(draft.quantity, 10);
      if (!Number.isFinite(qty) || qty < 1) {
        setError('La cantidad debe ser al menos 1');
        return;
      }
      const price = Number.parseFloat(String(draft.price).replace(',', '.'));
      if (!Number.isFinite(price) || price < 0) {
        setError('Precio no válido');
        return;
      }
      const variantId = Number(draft.variant_id);
      if (!Number.isFinite(variantId) || variantId <= 0) {
        setError('Selecciona una variante válida');
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
          variant_id: variantId,
          sync_to_shopify: true,
        }),
      });
      const dataLocal = (await resLocal.json().catch(() => ({}))) as { error?: string };
      if (!resLocal.ok) {
        setError(typeof dataLocal.error === 'string' ? dataLocal.error : 'No se pudo guardar el pedido');
        return;
      }
      setSuccess('Pedido actualizado correctamente.');
      await loadData();
    } finally {
      setSaving(false);
    }
  }, [order, locked, draft, loadData]);

  return (
    <>
      <PageHeader
        title="Editar pedido Shopify"
        subtitle="Solo se puede editar dirección, precio, producto y cantidad."
        right={
          <Link
            to="/pedidos"
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: `1px solid ${ds.borderCard}`,
              background: ds.bgCard,
              color: ds.textSecondary,
              fontSize: 12,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Volver a Pedidos
          </Link>
        }
      />
      {loading ? (
        <div style={{ color: ds.textMuted, fontSize: 13 }}>Cargando pedido…</div>
      ) : null}
      {error ? (
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
          {error}
        </div>
      ) : null}
      {success ? (
        <div
          style={{
            marginBottom: 12,
            padding: '10px 14px',
            borderRadius: 10,
            border: `1px solid ${ds.borderCard}`,
            background: ds.successBg,
            color: ds.successText,
            fontSize: 13,
          }}
        >
          {success}
        </div>
      ) : null}
      {order ? (
        <div
          style={{
            background: ds.bgCard,
            borderRadius: 14,
            border: `1px solid ${ds.borderCard}`,
            padding: 18,
            maxWidth: 680,
          }}
        >
          <p style={{ margin: '0 0 12px', fontSize: 12, color: ds.textSecondary }}>
            Pedido: <strong>{order.orderName}</strong>{' '}
            {locked ? <span style={{ color: ds.dangerText }}>· Bloqueado por estado {order.internal_status}</span> : null}
          </p>

          <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: ds.textSecondary, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
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
          <label style={{ ...labelStyle, display: 'block', marginTop: 12 }}>
            Ciudad
            <input
              type="text"
              value={draft.city}
              onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))}
              style={fieldStyle}
              disabled={locked || saving}
            />
          </label>
          <label style={{ ...labelStyle, display: 'block', marginTop: 12 }}>
            Dirección (línea 1)
            <input
              type="text"
              value={draft.address1}
              onChange={(e) => setDraft((d) => ({ ...d, address1: e.target.value }))}
              style={fieldStyle}
              disabled={locked || saving}
            />
          </label>
          <label style={{ ...labelStyle, display: 'block', marginTop: 12 }}>
            Dirección (línea 2)
            <input
              type="text"
              value={draft.address2}
              onChange={(e) => setDraft((d) => ({ ...d, address2: e.target.value }))}
              style={fieldStyle}
              disabled={locked || saving}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
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

          <p style={{ margin: '18px 0 10px', fontSize: 11, fontWeight: 700, color: ds.textSecondary, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
            Producto y precio
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 12 }}>
            <label style={{ ...labelStyle, display: 'block' }}>
              Producto
              <select
                value={draft.product_id}
                onChange={(e) => setDraft((d) => ({ ...d, product_id: e.target.value }))}
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
                value={draft.variant_id}
                onChange={(e) => setDraft((d) => ({ ...d, variant_id: e.target.value }))}
                style={fieldStyle}
                disabled={locked || saving || !selectedProduct}
              >
                <option value="">{selectedProduct ? 'Selecciona variante' : 'Sin variantes'}</option>
                {(selectedProduct?.variants || []).map((v) => (
                  <option key={v.id} value={String(v.id)}>
                    {v.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <label style={{ ...labelStyle, display: 'block' }}>
              Cantidad
              <input
                type="text"
                inputMode="numeric"
                value={draft.quantity}
                onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))}
                style={fieldStyle}
                disabled={locked || saving}
              />
            </label>
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
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button
              type="button"
              onClick={() => void save()}
              disabled={locked || saving}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: `1px solid ${ds.brand}`,
                background: ds.brandBg,
                color: ds.brand,
                fontWeight: 600,
                cursor: locked || saving ? 'not-allowed' : 'pointer',
                opacity: locked || saving ? 0.8 : 1,
              }}
            >
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

const fieldStyle: CSSProperties = {
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
