import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';
import { PageHeader } from '../design-system/PageHeader';
import { StatusBadge, type StatusBadgeVariant } from '../design-system/StatusBadge';

const INVENTORY_POLL_MS = 25_000;

type ShopifyVariant = {
  id: number;
  title?: string;
  sku?: string;
  barcode?: string;
  inventory_quantity?: number | null;
};

type ShopifyImage = {
  id: number;
  src?: string;
};

type ShopifyProduct = {
  id: number;
  title?: string;
  status?: string;
  vendor?: string;
  product_type?: string;
  images?: ShopifyImage[];
  variants?: ShopifyVariant[];
  manual_product_price?: number | null;
  manual_avg_freight_price?: number | null;
  delivery_effectiveness_pct?: number | null;
};

function stockVariant(q: number): StatusBadgeVariant {
  if (q === 0) return 'error';
  if (q < 10) return 'warning';
  return 'success';
}

function stockLabel(q: number) {
  if (q === 0) return 'Sin stock';
  if (q < 10) return `Bajo · ${q} uds`;
  return `OK · ${q} uds`;
}

function normalizeProducts(raw: unknown): ShopifyProduct[] {
  const list =
    raw && typeof raw === 'object' && Array.isArray((raw as { products?: unknown[] }).products)
      ? (raw as { products: unknown[] }).products
      : [];
  const out: ShopifyProduct[] = [];
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const row = p as Record<string, unknown>;
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
              inventory_quantity:
                vv.inventory_quantity == null ? null : Number.isFinite(Number(vv.inventory_quantity)) ? Number(vv.inventory_quantity) : null,
            } satisfies ShopifyVariant;
          })
      : [];
    const images = Array.isArray(row.images)
      ? row.images
          .filter((img) => img && typeof img === 'object')
          .map((img) => {
            const ii = img as Record<string, unknown>;
            return {
              id: Number(ii.id) || 0,
              src: String(ii.src || ''),
            } satisfies ShopifyImage;
          })
      : [];
    out.push({
      id: Number(row.id) || 0,
      title: String(row.title || ''),
      status: String(row.status || ''),
      vendor: String(row.vendor || ''),
      product_type: String(row.product_type || ''),
      variants,
      images,
      manual_product_price:
        row.manual_product_price == null ? null : Number.isFinite(Number(row.manual_product_price)) ? Number(row.manual_product_price) : null,
      manual_avg_freight_price:
        row.manual_avg_freight_price == null
          ? null
          : Number.isFinite(Number(row.manual_avg_freight_price))
            ? Number(row.manual_avg_freight_price)
            : null,
      delivery_effectiveness_pct:
        row.delivery_effectiveness_pct == null
          ? null
          : Number.isFinite(Number(row.delivery_effectiveness_pct))
            ? Number(row.delivery_effectiveness_pct)
            : null,
    });
  }
  return out;
}

type PricingDraft = {
  productPrice: string;
  avgFreightPrice: string;
  deliveryEffectiveness: string;
  dirty: boolean;
};

function toDraftAmount(value: number | null | undefined) {
  return value == null ? '' : String(value);
}

function currencySymbol(currencyCode: string) {
  const c = String(currencyCode || '').trim().toUpperCase();
  switch (c) {
    case 'COP':
    case 'USD':
    case 'MXN':
    case 'ARS':
    case 'CLP':
      return '$';
    case 'EUR':
      return 'EUR';
    case 'PEN':
      return 'S/';
    default:
      return '$';
  }
}

export default function InventarioPage() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [pricingDrafts, setPricingDrafts] = useState<Record<number, PricingDraft>>({});
  const [savingPricing, setSavingPricing] = useState<Record<number, boolean>>({});
  const [pricingErrors, setPricingErrors] = useState<Record<number, string>>({});
  const [pricingSaved, setPricingSaved] = useState<Record<number, boolean>>({});
  const [templateCurrency, setTemplateCurrency] = useState('COP');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/motico/settings');
        if (!res.ok || cancelled) return;
        const data = (await res.json().catch(() => ({}))) as { default_currency?: string | null };
        const cur = String(data.default_currency || 'COP')
          .trim()
          .toUpperCase();
        if (!cancelled) setTemplateCurrency(cur || 'COP');
      } catch {
        /* noop */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadInventory = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/shopify/products?limit=250');
      const data = (await res.json().catch(() => ({}))) as { code?: string; error?: string; products?: unknown[] };
      if (!res.ok) {
        if (data.code === 'not_connected') {
          setProducts([]);
          setError('No hay una tienda Shopify conectada. Conéctala en Canales.');
          setFetchedAt(null);
          return;
        }
        setError(typeof data.error === 'string' ? data.error : 'No se pudieron sincronizar productos de Shopify.');
        return;
      }
      setProducts(normalizeProducts(data));
      setFetchedAt(new Date().toISOString());
    } catch {
      setError('Error de red al sincronizar inventario.');
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.hidden) return;
      void loadInventory({ silent: true });
    }, INVENTORY_POLL_MS);
    return () => window.clearInterval(id);
  }, [loadInventory]);

  const viewRows = useMemo(() => {
    return products.map((p) => {
      const variants = p.variants || [];
      const stock = variants.reduce((acc, v) => acc + (Number.isFinite(Number(v.inventory_quantity)) ? Number(v.inventory_quantity) : 0), 0);
      const firstSku = variants.find((v) => (v.sku || '').trim())?.sku?.trim() || '—';
      const firstBarcode = variants.find((v) => (v.barcode || '').trim())?.barcode?.trim() || '—';
      const imageUrl = (p.images || []).find((img) => (img.src || '').trim())?.src || '';
      return {
        id: p.id,
        name: (p.title || '').trim() || `Producto #${p.id}`,
        vendor: (p.vendor || '').trim(),
        productType: (p.product_type || '').trim(),
        status: (p.status || '').trim(),
        variants,
        stock,
        sku: firstSku,
        barcode: firstBarcode,
        imageUrl,
        imageCount: (p.images || []).filter((img) => (img.src || '').trim()).length,
        manualProductPrice: p.manual_product_price ?? null,
        manualAvgFreightPrice: p.manual_avg_freight_price ?? null,
        deliveryEffectivenessPct: p.delivery_effectiveness_pct ?? null,
      };
    });
  }, [products]);

  useEffect(() => {
    setPricingDrafts((prev) => {
      const next: Record<number, PricingDraft> = {};
      for (const row of viewRows) {
        const prevDraft = prev[row.id];
        if (prevDraft?.dirty) {
          next[row.id] = prevDraft;
          continue;
        }
        next[row.id] = {
          productPrice: toDraftAmount(row.manualProductPrice),
          avgFreightPrice: toDraftAmount(row.manualAvgFreightPrice),
          deliveryEffectiveness: toDraftAmount(row.deliveryEffectivenessPct),
          dirty: false,
        };
      }
      return next;
    });
  }, [viewRows]);

  const setPricingDraftField = useCallback((productId: number, field: 'productPrice' | 'avgFreightPrice' | 'deliveryEffectiveness', value: string) => {
    setPricingDrafts((prev) => {
      const current = prev[productId] || { productPrice: '', avgFreightPrice: '', deliveryEffectiveness: '', dirty: false };
      return {
        ...prev,
        [productId]: {
          ...current,
          [field]: value,
          dirty: true,
        },
      };
    });
    setPricingErrors((prev) => {
      if (!prev[productId]) return prev;
      const next = { ...prev };
      delete next[productId];
      return next;
    });
    setPricingSaved((prev) => {
      if (!prev[productId]) return prev;
      const next = { ...prev };
      delete next[productId];
      return next;
    });
  }, []);

  const saveManualPricing = useCallback(
    async (productId: number) => {
      const draft = pricingDrafts[productId];
      const rawProductPrice = (draft?.productPrice || '').trim();
      const rawAvgFreightPrice = (draft?.avgFreightPrice || '').trim();
      const rawDeliveryEffectiveness = (draft?.deliveryEffectiveness || '').trim();
      const productPrice = rawProductPrice === '' ? null : Number.parseFloat(rawProductPrice.replace(',', '.'));
      const avgFreightPrice = rawAvgFreightPrice === '' ? null : Number.parseFloat(rawAvgFreightPrice.replace(',', '.'));
      const deliveryEffectiveness =
        rawDeliveryEffectiveness === '' ? null : Number.parseFloat(rawDeliveryEffectiveness.replace(',', '.'));
      if (
        (rawProductPrice !== '' && (!Number.isFinite(productPrice) || productPrice < 0)) ||
        (rawAvgFreightPrice !== '' && (!Number.isFinite(avgFreightPrice) || avgFreightPrice < 0)) ||
        (rawDeliveryEffectiveness !== '' &&
          (!Number.isFinite(deliveryEffectiveness) || deliveryEffectiveness < 0 || deliveryEffectiveness > 100))
      ) {
        setPricingErrors((prev) => ({
          ...prev,
          [productId]: 'Precios >= 0 y Efectividad entre 0 y 100.',
        }));
        return;
      }
      setSavingPricing((prev) => ({ ...prev, [productId]: true }));
      setPricingErrors((prev) => {
        if (!prev[productId]) return prev;
        const next = { ...prev };
        delete next[productId];
        return next;
      });
      try {
        const res = await apiFetch('/api/shopify/product-manual-pricing', {
          method: 'PUT',
          body: JSON.stringify({
            product_id: productId,
            manual_product_price: productPrice,
            manual_avg_freight_price: avgFreightPrice,
            delivery_effectiveness_pct: deliveryEffectiveness,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          manual_product_price?: number | null;
          manual_avg_freight_price?: number | null;
          delivery_effectiveness_pct?: number | null;
        };
        if (!res.ok) {
          setPricingErrors((prev) => ({
            ...prev,
            [productId]: typeof data.error === 'string' ? data.error : 'No se pudo guardar la configuración manual.',
          }));
          return;
        }
        const savedProductPrice = data.manual_product_price == null ? null : Number(data.manual_product_price);
        const savedAvgFreightPrice = data.manual_avg_freight_price == null ? null : Number(data.manual_avg_freight_price);
        const savedDeliveryEffectiveness =
          data.delivery_effectiveness_pct == null ? null : Number(data.delivery_effectiveness_pct);
        setProducts((prev) =>
          prev.map((p) =>
            p.id === productId
              ? {
                  ...p,
                  manual_product_price: savedProductPrice,
                  manual_avg_freight_price: savedAvgFreightPrice,
                  delivery_effectiveness_pct: savedDeliveryEffectiveness,
                }
              : p,
          ),
        );
        setPricingDrafts((prev) => ({
          ...prev,
          [productId]: {
            productPrice: toDraftAmount(savedProductPrice),
            avgFreightPrice: toDraftAmount(savedAvgFreightPrice),
            deliveryEffectiveness: toDraftAmount(savedDeliveryEffectiveness),
            dirty: false,
          },
        }));
        setPricingSaved((prev) => ({ ...prev, [productId]: true }));
      } catch {
        setPricingErrors((prev) => ({
          ...prev,
          [productId]: 'Error de red al guardar la configuración manual.',
        }));
      } finally {
        setSavingPricing((prev) => ({ ...prev, [productId]: false }));
      }
    },
    [pricingDrafts],
  );

  const subtitle = useMemo(() => {
    if (error) return 'Sincronización con Shopify con incidencias';
    if (loading && !viewRows.length) return 'Sincronizando productos de Shopify...';
    return `Sincronización automática con Shopify · ${viewRows.length} producto${viewRows.length === 1 ? '' : 's'}`;
  }, [error, loading, viewRows.length]);
  const currencyPrefix = currencySymbol(templateCurrency);

  return (
    <>
      <PageHeader
        title="Inventario"
        subtitle={subtitle}
        right={
          <button
            type="button"
            disabled={loading || refreshing}
            onClick={() => void loadInventory()}
            style={{
              padding: '7px 14px',
              borderRadius: 8,
              border: `1px solid ${ds.borderCard}`,
              background: ds.bgCard,
              color: ds.textSecondary,
              fontSize: 12,
              fontWeight: 600,
              cursor: loading || refreshing ? 'wait' : 'pointer',
            }}
          >
            {loading || refreshing ? 'Sincronizando...' : 'Sincronizar ahora'}
          </button>
        }
      />

      {fetchedAt ? (
        <div style={{ marginBottom: 12, fontSize: 12, color: ds.textMuted }}>
          Última sincronización: <span style={{ color: ds.textSecondary, fontWeight: 600 }}>{new Date(fetchedAt).toLocaleString('es-ES')}</span>
        </div>
      ) : null}

      {error ? (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 12px',
            borderRadius: 10,
            border: `1px solid ${ds.borderCard}`,
            background: ds.dangerBg,
            color: ds.dangerText,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 14,
        }}
      >
        {viewRows.map((p) => (
          <div
            key={p.id}
            style={{
              background: ds.bgCard,
              border: `1px solid ${ds.borderCard}`,
              borderRadius: 14,
              padding: '18px 20px',
            }}
          >
            <div
              style={{
                width: '100%',
                aspectRatio: '4/3',
                borderRadius: 8,
                background: ds.brandBg,
                marginBottom: 12,
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {p.imageUrl ? (
                <img
                  src={p.imageUrl}
                  alt={`Imagen de ${p.name}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <span style={{ fontSize: 11, color: ds.textHint }}>Sin imagen</span>
              )}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary }}>{p.name}</div>
            <div style={{ fontSize: 11, color: ds.textMuted, marginTop: 4 }}>SKU: {p.sku}</div>
            <div style={{ fontSize: 11, color: ds.textMuted, marginTop: 4 }}>Código de barras: {p.barcode}</div>
            <div style={{ fontSize: 11, color: ds.textMuted, marginTop: 4 }}>
              Variantes: {p.variants.length} · Imágenes: {p.imageCount}
            </div>
            {p.vendor || p.productType || p.status ? (
              <div style={{ fontSize: 10.5, color: ds.textHint, marginTop: 6, lineHeight: 1.35 }}>
                {[p.vendor, p.productType, p.status].filter(Boolean).join(' · ')}
              </div>
            ) : null}
            <div style={{ marginTop: 10 }}>
              <StatusBadge variant={stockVariant(p.stock)}>{stockLabel(p.stock)}</StatusBadge>
            </div>
            {p.variants.length ? (
              <div
                style={{
                  marginTop: 10,
                  borderRadius: 8,
                  border: `1px solid ${ds.borderCard}`,
                  background: ds.bgSubtle,
                  padding: '8px 9px',
                  maxHeight: 150,
                  overflowY: 'auto',
                }}
              >
                {p.variants.slice(0, 8).map((v) => (
                  <div key={v.id} style={{ fontSize: 10.5, color: ds.textSecondary, lineHeight: 1.35, marginBottom: 5 }}>
                    {(v.title || 'Variante').trim() || 'Variante'} · SKU {(v.sku || '—').trim() || '—'} · CB{' '}
                    {(v.barcode || '—').trim() || '—'} · Stock{' '}
                    {Number.isFinite(Number(v.inventory_quantity)) ? Number(v.inventory_quantity) : 0}
                  </div>
                ))}
                {p.variants.length > 8 ? (
                  <div style={{ fontSize: 10, color: ds.textHint }}>+{p.variants.length - 8} variantes más...</div>
                ) : null}
              </div>
            ) : null}
            <div
              style={{
                marginTop: 12,
                borderRadius: 10,
                border: `1px solid ${ds.borderCard}`,
                background: ds.bgSubtle,
                padding: '10px 10px 9px',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: ds.textPrimary, marginBottom: 8 }}>
                Configuración manual de costos Motico
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                <label style={{ fontSize: 10.5, color: ds.textMuted }}>
                  Precio del producto
                  <div
                    style={{
                      marginTop: 4,
                      width: '100%',
                      borderRadius: 8,
                      border: `1px solid ${ds.borderCard}`,
                      background: ds.bgCard,
                      color: ds.textPrimary,
                      fontSize: 12,
                      padding: '0 9px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span style={{ color: ds.textMuted, fontWeight: 600 }}>{currencyPrefix}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={pricingDrafts[p.id]?.productPrice ?? ''}
                      onChange={(e) => setPricingDraftField(p.id, 'productPrice', e.target.value)}
                      placeholder="Ej: 49.90"
                      style={{
                        width: '100%',
                        border: 'none',
                        outline: 'none',
                        background: 'transparent',
                        color: ds.textPrimary,
                        fontSize: 12,
                        padding: '7px 0',
                      }}
                    />
                  </div>
                </label>
                <label style={{ fontSize: 10.5, color: ds.textMuted }}>
                  Precio del flete promedio
                  <div
                    style={{
                      marginTop: 4,
                      width: '100%',
                      borderRadius: 8,
                      border: `1px solid ${ds.borderCard}`,
                      background: ds.bgCard,
                      color: ds.textPrimary,
                      fontSize: 12,
                      padding: '0 9px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span style={{ color: ds.textMuted, fontWeight: 600 }}>{currencyPrefix}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={pricingDrafts[p.id]?.avgFreightPrice ?? ''}
                      onChange={(e) => setPricingDraftField(p.id, 'avgFreightPrice', e.target.value)}
                      placeholder="Ej: 8.50"
                      style={{
                        width: '100%',
                        border: 'none',
                        outline: 'none',
                        background: 'transparent',
                        color: ds.textPrimary,
                        fontSize: 12,
                        padding: '7px 0',
                      }}
                    />
                  </div>
                </label>
                <label style={{ fontSize: 10.5, color: ds.textMuted }}>
                  % Efectividad de entregas
                  <div
                    style={{
                      marginTop: 4,
                      width: '100%',
                      borderRadius: 8,
                      border: `1px solid ${ds.borderCard}`,
                      background: ds.bgCard,
                      color: ds.textPrimary,
                      fontSize: 12,
                      padding: '0 9px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <input
                      type="text"
                      inputMode="decimal"
                      value={pricingDrafts[p.id]?.deliveryEffectiveness ?? ''}
                      onChange={(e) => setPricingDraftField(p.id, 'deliveryEffectiveness', e.target.value)}
                      placeholder="Ej: 92"
                      style={{
                        width: '100%',
                        border: 'none',
                        outline: 'none',
                        background: 'transparent',
                        color: ds.textPrimary,
                        fontSize: 12,
                        padding: '7px 0',
                      }}
                    />
                    <span style={{ color: ds.textMuted, fontWeight: 600 }}>%</span>
                  </div>
                </label>
              </div>
              {pricingErrors[p.id] ? (
                <div style={{ marginTop: 8, fontSize: 11, color: ds.dangerText }}>{pricingErrors[p.id]}</div>
              ) : null}
              {pricingSaved[p.id] ? (
                <div style={{ marginTop: 8, fontSize: 11, color: ds.successText }}>Guardado correctamente.</div>
              ) : null}
              <button
                type="button"
                onClick={() => void saveManualPricing(p.id)}
                disabled={Boolean(savingPricing[p.id])}
                style={{
                  marginTop: 9,
                  padding: '7px 12px',
                  borderRadius: 8,
                  border: `1px solid ${ds.borderCard}`,
                  background: ds.bgCard,
                  color: ds.textSecondary,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: savingPricing[p.id] ? 'wait' : 'pointer',
                }}
              >
                {savingPricing[p.id] ? 'Guardando...' : 'Guardar costos Motico'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {!loading && !viewRows.length && !error ? (
        <div style={{ marginTop: 16, fontSize: 13, color: ds.textMuted }}>No hay productos en Shopify para mostrar.</div>
      ) : null}
    </>
  );
}
