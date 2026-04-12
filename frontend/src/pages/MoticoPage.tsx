import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';
import { DataTable, Th, Td, tableBase } from '../design-system/DataTable';
import { IconTruck } from '../design-system/icons';
import { PageHeader } from '../design-system/PageHeader';
import { StatusBadge, type StatusBadgeVariant } from '../design-system/StatusBadge';
import { type DatePreset, DATE_PRESETS, buildDateRange } from '../utils/datePresets';

const POLL_MS = 25_000;

const MOTICO_STATUS_OPTIONS = [
  { value: 'confirmado', label: 'Confirmado' },
  { value: 'imprimir_guia', label: 'Imprimir guía' },
  { value: 'pagado', label: 'Pagado' },
  { value: 'cancelado', label: 'Cancelado' },
  { value: 'devolucion', label: 'Devolución' },
] as const;

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
  mensajero: string | null;
  motico_status: string;
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
  maxWidth: 200,
  padding: '6px 8px',
  borderRadius: 8,
  border: `1px solid ${ds.borderCard}`,
  background: ds.bgCard,
  color: ds.textPrimary,
  fontSize: 11,
  fontWeight: 600,
};

function moticoSelectAccent(status: string): CSSProperties {
  switch (status) {
    case 'confirmado':
      return { background: '#d8f5e4', color: '#0d5c36', borderColor: '#86efac' };
    case 'imprimir_guia':
      return { background: '#e0e7ff', color: '#3730a3', borderColor: '#a5b4fc' };
    case 'pagado':
      return { background: '#dbeafe', color: '#1e40af', borderColor: '#93c5fd' };
    case 'cancelado':
      return { background: '#fee2e2', color: '#991b1b', borderColor: '#fca5a5' };
    case 'devolucion':
      return { background: '#fef3c7', color: '#92400e', borderColor: '#fcd34d' };
    default:
      return {};
  }
}

function formatMoneyFromString(total: string, currency: string) {
  const n = Number.parseFloat(String(total));
  if (Number.isNaN(n)) return String(total);
  const cur = currency && currency.length === 3 ? currency : 'EUR';
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: cur }).format(n);
  } catch {
    return `${n} ${currency}`;
  }
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
  return {
    ...o,
    badgeVariant: safeBv,
    productIds: Array.isArray(o.productIds) ? o.productIds : [],
    mensajero: o.mensajero || null,
    motico_status: allowed.has(o.motico_status) ? o.motico_status : 'confirmado',
  };
}

export default function MoticoPage() {
  const [datePreset, setDatePreset] = useState<DatePreset>('hoy');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [productId, setProductId] = useState('');

  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopDomain, setShopDomain] = useState<string | null>(null);
  const [orders, setOrders] = useState<MoticoOrderRow[]>([]);
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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

  const patchMoticoStatus = useCallback(async (orderId: number, motico_status: string) => {
    const res = await apiFetch(`/api/shopify/orders/${orderId}/local-fields`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motico_status }),
    });
    if (!res.ok) return;
    const data = (await res.json().catch(() => ({}))) as { motico_status?: string };
    if (data.motico_status) {
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, motico_status: data.motico_status! } : o)),
      );
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
            ? `Pedidos con mensajero Motico · ${shopDomain}. Sincronización cada ${POLL_MS / 1000} s. Asigna Motico en Pedidos.`
            : 'Conecta Shopify en Canales. Aquí verás los pedidos cuyo mensajero sea Motico.'
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
          style={{ ...filterCtl, minWidth: 200, maxWidth: 320, fontWeight: 600 }}
        >
          <option value="">Todos los productos</option>
          {products.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.title}
            </option>
          ))}
        </select>
      </div>

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
          {' · '}Vincula Shopify y asigna el mensajero Motico en cada pedido para verlo aquí.
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
        title={useLive ? 'Pedidos Motico' : 'Pedidos Motico'}
        subtitle={
          useLive
            ? `${orders.length} pedido${orders.length === 1 ? '' : 's'} con mensajero Motico en el rango`
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
            <table style={{ ...tableBase, minWidth: 920 }}>
              <thead>
                <tr>
                  <Th>Pedido</Th>
                  <Th>Cliente</Th>
                  <Th>Fecha</Th>
                  <Th>Total</Th>
                  <Th>Pago (Shopify)</Th>
                  <Th>Productos</Th>
                  <Th>Estado</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {orders.map((o, i, arr) => (
                  <tr key={o.id}>
                    <Td isLast={i === arr.length - 1}>
                      <div style={{ fontWeight: 600, fontSize: 12, color: ds.textPrimary }}>{o.orderName}</div>
                      <div style={{ fontSize: 10.5, color: ds.textHint }}>{o.email}</div>
                    </Td>
                    <Td isLast={i === arr.length - 1}>{o.client}</Td>
                    <Td isLast={i === arr.length - 1}>{formatDate(o.createdAt)}</Td>
                    <Td isLast={i === arr.length - 1}>{formatMoneyFromString(o.total, o.currency)}</Td>
                    <Td isLast={i === arr.length - 1}>
                      <StatusBadge variant={o.badgeVariant}>{o.label}</StatusBadge>
                    </Td>
                    <Td isLast={i === arr.length - 1}>
                      <div style={{ fontSize: 11, color: ds.textSecondary, maxWidth: 240, lineHeight: 1.35 }}>
                        {summarizeProducts(o.productIds)}
                      </div>
                    </Td>
                    <Td isLast={i === arr.length - 1}>
                      <select
                        style={{ ...selectStyle, ...moticoSelectAccent(o.motico_status) }}
                        value={o.motico_status}
                        onChange={(e) => void patchMoticoStatus(o.id, e.target.value)}
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
                ))}
              </tbody>
            </table>
          </div>
        )}
        {useLive && !loading && orders.length === 0 ? (
          <div style={{ padding: 16, fontSize: 13, color: ds.textMuted, lineHeight: 1.5 }}>
            No hay pedidos con mensajero Motico en este rango
            {productId.trim() ? ' y producto seleccionado' : ''}. Revisa fechas o asigna Motico en{' '}
            <Link to="/pedidos" style={{ color: ds.brand, fontWeight: 600 }}>
              Pedidos
            </Link>
            .
          </div>
        ) : null}
      </DataTable>
    </>
  );
}
