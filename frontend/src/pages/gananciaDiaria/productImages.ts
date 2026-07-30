import { apiFetch } from '../../auth/api';

export type ProductImageMap = Record<string, string>;

export function productImageUrl(map: ProductImageMap, productId: number | null | undefined): string {
  if (productId == null || !Number.isFinite(Number(productId)) || Number(productId) <= 0) return '';
  return map[String(productId)] || '';
}

export async function fetchShopifyProductImageMap(): Promise<ProductImageMap> {
  try {
    const res = await apiFetch('/api/shopify/products?limit=250');
    if (!res.ok) return {};
    const body = (await res.json().catch(() => ({}))) as { products?: unknown[] };
    const products = Array.isArray(body.products) ? body.products : [];
    const map: ProductImageMap = {};
    for (const raw of products) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as { id?: unknown; images?: unknown[] };
      const id = Number(row.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      const images = Array.isArray(row.images) ? row.images : [];
      const src = images
        .map((img) =>
          img && typeof img === 'object' ? String((img as { src?: string }).src || '').trim() : '',
        )
        .find(Boolean);
      if (src) map[String(id)] = src;
    }
    return map;
  } catch {
    return {};
  }
}
