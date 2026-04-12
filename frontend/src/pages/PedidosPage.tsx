import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';
import { DataTable, Th, Td, tableBase } from '../design-system/DataTable';
import { PageHeader } from '../design-system/PageHeader';
import { StatusBadge, type StatusBadgeVariant } from '../design-system/StatusBadge';

const POLL_MS = 25_000;

const DEMO = [
  { id: '#4821', client: 'María G.', email: 'maria@mail.com', date: '11 abr 2026', total: '€ 124,90', st: 'success' as const, lb: 'Completado' },
  { id: '#4820', client: 'Pedro L.', email: 'pedro@mail.com', date: '11 abr 2026', total: '€ 89,00', st: 'info' as const, lb: 'En proceso' },
  { id: '#4819', client: 'Ana R.', email: 'ana@mail.com', date: '10 abr 2026', total: '€ 210,50', st: 'success' as const, lb: 'Completado' },
  { id: '#4818', client: 'Luis M.', email: 'luis@mail.com', date: '10 abr 2026', total: '€ 45,00', st: 'paused' as const, lb: 'Pendiente' },
  { id: '#4817', client: 'Elena S.', email: 'elena@mail.com', date: '09 abr 2026', total: '€ 312,00', st: 'error' as const, lb: 'Cancelado' },
];

type ShopifyOrderRow = {
  id: number;
  orderName: string;
  client: string;
  email: string;
  createdAt: string;
  total: string;
  currency: string;
  financialStatus: string;
  label: string;
  badgeVariant: StatusBadgeVariant;
};

type ShopifyOrdersPayload = {
  source: string;
  shop_domain: string;
  fetchedAt: string;
  orders: ShopifyOrderRow[];
};

function formatMoney(total: string, currency: string) {
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

function orderMatchesFilter(row: ShopifyOrderRow, filter: 'all' | 'active' | 'done') {
  const f = row.financialStatus.toLowerCase();
  if (filter === 'all') return true;
  if (filter === 'done') return f === 'paid';
  return f !== 'paid' && f !== 'refunded' && f !== 'voided';
}

export default function PedidosPage() {
  const [filter, setFilter] = useState<'all' | 'active' | 'done'>('all');
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopDomain, setShopDomain] = useState<string | null>(null);
  const [shopifyOrders, setShopifyOrders] = useState<ShopifyOrderRow[]>([]);
  const [shopifyLoading, setShopifyLoading] = useState(false);
  const [shopifyError, setShopifyError] = useState('');
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadShopifyOrders = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!silent) setShopifyLoading(true);
    else setRefreshing(true);
    setShopifyError('');
    try {
      const res = await apiFetch('/api/shopify/orders?limit=100');
      const data = (await res.json().catch(() => ({}))) as ShopifyOrdersPayload & { error?: string; code?: string };
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
        setShopifyConnected(true);
        setShopDomain(data.shop_domain || null);
        setFetchedAt(data.fetchedAt || null);
        setShopifyOrders(
          data.orders.map((o) => ({
            ...o,
            badgeVariant: (['success', 'paused', 'error', 'info', 'warning'].includes(o.badgeVariant)
              ? o.badgeVariant
              : 'info') as StatusBadgeVariant,
          })),
        );
      }
    } catch {
      setShopifyError('Error de red al cargar pedidos de Shopify');
    } finally {
      if (!silent) setShopifyLoading(false);
      setRefreshing(false);
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
        if (ok) await loadShopifyOrders();
      } catch {
        if (!cancelled) setShopifyConnected(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadShopifyOrders]);

  useEffect(() => {
    if (!shopifyConnected) return;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      void loadShopifyOrders({ silent: true });
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [shopifyConnected, loadShopifyOrders]);

  const filteredShopify = useMemo(
    () => shopifyOrders.filter((r) => orderMatchesFilter(r, filter)),
    [shopifyOrders, filter],
  );

  const filteredDemo = useMemo(
    () =>
      DEMO.filter((r) =>
        filter === 'all' ? true : filter === 'active' ? r.st === 'info' || r.st === 'paused' : r.st === 'success',
      ),
    [filter],
  );

  const useLive = shopifyConnected && shopDomain;

  return (
    <>
      <PageHeader
        title="Pedidos"
        subtitle={
          useLive
            ? `Tienda Shopify · ${shopDomain}. Se actualiza solo cada ${POLL_MS / 1000} s mientras esta página está abierta.`
            : 'Conecta Shopify en Canales para ver pedidos reales. Mientras tanto, datos de demostración.'
        }
        right={
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
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

      {useLive && fetchedAt ? (
        <div
          style={{
            marginBottom: 14,
            fontSize: 12,
            color: ds.textMuted,
          }}
        >
          Última sincronización con Shopify:{' '}
          <span style={{ color: ds.textSecondary, fontWeight: 600 }}>
            {formatDate(fetchedAt)}
          </span>
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

      <DataTable
        title={useLive ? 'Pedidos en Shopify' : 'Todos los pedidos'}
        subtitle={
          useLive
            ? `Mostrando ${filteredShopify.length} de ${shopifyOrders.length} pedidos recientes · sincronización periódica`
            : `Mostrando ${filteredDemo.length} resultados · demo`
        }
      >
        {useLive && shopifyLoading && shopifyOrders.length === 0 ? (
          <div style={{ padding: 24, color: ds.textMuted, fontSize: 13 }}>Cargando pedidos de Shopify…</div>
        ) : (
          <table style={{ ...tableBase, minWidth: 640 }}>
            <thead>
              <tr>
                <Th>Pedido</Th>
                <Th>Cliente</Th>
                <Th>Fecha</Th>
                <Th>Total</Th>
                <Th>Estado</Th>
                {useLive ? <Th /> : null}
              </tr>
            </thead>
            <tbody>
              {useLive
                ? filteredShopify.map((o, i, arr) => (
                    <tr key={o.id}>
                      <Td isLast={i === arr.length - 1}>
                        <div style={{ fontWeight: 600, fontSize: 12, color: ds.textPrimary }}>{o.orderName}</div>
                        <div style={{ fontSize: 10.5, color: ds.textHint }}>{o.email}</div>
                      </Td>
                      <Td isLast={i === arr.length - 1}>{o.client}</Td>
                      <Td isLast={i === arr.length - 1}>{formatDate(o.createdAt)}</Td>
                      <Td isLast={i === arr.length - 1}>{formatMoney(o.total, o.currency)}</Td>
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
                  ))
                : filteredDemo.map((o, i, arr) => (
                    <tr key={o.id}>
                      <Td isLast={i === arr.length - 1}>
                        <div style={{ fontWeight: 600, fontSize: 12, color: ds.textPrimary }}>{o.id}</div>
                        <div style={{ fontSize: 10.5, color: ds.textHint }}>{o.email}</div>
                      </Td>
                      <Td isLast={i === arr.length - 1}>{o.client}</Td>
                      <Td isLast={i === arr.length - 1}>{o.date}</Td>
                      <Td isLast={i === arr.length - 1}>{o.total}</Td>
                      <Td isLast={i === arr.length - 1}>
                        <StatusBadge variant={o.st}>{o.lb}</StatusBadge>
                      </Td>
                    </tr>
                  ))}
            </tbody>
          </table>
        )}
        {useLive && !shopifyLoading && filteredShopify.length === 0 ? (
          <div style={{ padding: 16, fontSize: 13, color: ds.textMuted }}>No hay pedidos en este filtro.</div>
        ) : null}
      </DataTable>
    </>
  );
}
