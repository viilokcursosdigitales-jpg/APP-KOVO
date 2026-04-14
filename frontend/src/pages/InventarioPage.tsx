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
    });
  }
  return out;
}

export default function InventarioPage() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

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
      };
    });
  }, [products]);

  const subtitle = useMemo(() => {
    if (error) return 'Sincronización con Shopify con incidencias';
    if (loading && !viewRows.length) return 'Sincronizando productos de Shopify...';
    return `Sincronización automática con Shopify · ${viewRows.length} producto${viewRows.length === 1 ? '' : 's'}`;
  }, [error, loading, viewRows.length]);

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
          </div>
        ))}
      </div>

      {!loading && !viewRows.length && !error ? (
        <div style={{ marginTop: 16, fontSize: 13, color: ds.textMuted }}>No hay productos en Shopify para mostrar.</div>
      ) : null}
    </>
  );
}
