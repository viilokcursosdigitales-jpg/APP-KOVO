import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';
import { PageHeader } from '../design-system/PageHeader';

type AdminUserRow = {
  id: number;
  name: string;
  email: string;
  organization_id: number | null;
  organization_name: string | null;
  created_at: string;
  subscription_status: 'trial' | 'active' | 'expired';
  subscription_expires_at: string | null;
  trial_started_at: string | null;
  days_left: number;
  plan: 'free' | 'pro';
};

type AdminUsersResponse = {
  users: AdminUserRow[];
  kpis: {
    total_users: number;
    total_trial: number;
    total_active: number;
    total_expired: number;
    total_pro: number;
  };
};

const ADMIN_EMAIL = 'cavimo25@gmail.com';
const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
type SortKey =
  | 'name'
  | 'email'
  | 'organization_name'
  | 'created_at'
  | 'subscription_status'
  | 'days_left'
  | 'subscription_expires_at'
  | 'plan';

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function statusBadgeStyle(status: AdminUserRow['subscription_status']): CSSProperties {
  if (status === 'active') return { background: '#dcfce7', color: '#166534', border: '1px solid #86efac' };
  if (status === 'trial') return { background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' };
  return { background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' };
}

function kpiCard(label: string, value: number) {
  return (
    <div
      style={{
        background: ds.bgCard,
        border: `1px solid ${ds.borderCard}`,
        borderRadius: 12,
        padding: '14px 16px',
        minWidth: 160,
      }}
    >
      <div style={{ fontSize: 12, color: ds.textMuted, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: ds.textPrimary }}>{value}</div>
    </div>
  );
}

export default function AdminUsersPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = String(searchParams.get('q') || '');
  const initialSort = String(searchParams.get('sort') || 'created_at');
  const initialDir = String(searchParams.get('dir') || 'desc');
  const initialPage = Number.parseInt(String(searchParams.get('page') || '1'), 10);
  const initialPageSize = Number.parseInt(String(searchParams.get('size') || String(DEFAULT_PAGE_SIZE)), 10);

  const [search, setSearch] = useState(initialQuery);
  const [data, setData] = useState<AdminUsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(Number.isFinite(initialPage) && initialPage > 0 ? initialPage : 1);
  const [sortKey, setSortKey] = useState<SortKey>(
    initialSort === 'name' ||
      initialSort === 'email' ||
      initialSort === 'organization_name' ||
      initialSort === 'created_at' ||
      initialSort === 'subscription_status' ||
      initialSort === 'days_left' ||
      initialSort === 'subscription_expires_at' ||
      initialSort === 'plan'
      ? initialSort
      : 'created_at',
  );
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialDir === 'asc' ? 'asc' : 'desc');
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(
    PAGE_SIZE_OPTIONS.includes(initialPageSize as (typeof PAGE_SIZE_OPTIONS)[number])
      ? (initialPageSize as (typeof PAGE_SIZE_OPTIONS)[number])
      : DEFAULT_PAGE_SIZE,
  );

  const isAdminViewer = String(user?.email || '')
    .trim()
    .toLowerCase() === ADMIN_EMAIL;

  useEffect(() => {
    if (!isAdminViewer) return;
    let mounted = true;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const res = await apiFetch('/api/admin/users');
        const body = await res.json().catch(() => ({}));
        if (!mounted) return;
        if (!res.ok) {
          setData(null);
          setLoading(false);
          setError(typeof body.error === 'string' ? body.error : 'No se pudo cargar el módulo');
          return;
        }
        setData(body as AdminUsersResponse);
        setLoading(false);
      } catch {
        if (!mounted) return;
        setData(null);
        setLoading(false);
        setError('Error de red al cargar usuarios registrados');
      }
    })();
    return () => {
      mounted = false;
    };
  }, [isAdminViewer]);

  const rows = data?.users ?? [];
  const query = search.trim().toLowerCase();
  const filteredRows = useMemo(() => {
    if (!query) return rows;
    return rows.filter((row) => {
      const name = String(row.name || '').toLowerCase();
      const email = String(row.email || '').toLowerCase();
      return name.includes(query) || email.includes(query);
    });
  }, [rows, query]);

  const sortedRows = useMemo(() => {
    const statusRank: Record<AdminUserRow['subscription_status'], number> = { active: 0, trial: 1, expired: 2 };
    const planRank: Record<AdminUserRow['plan'], number> = { pro: 0, free: 1 };
    const copy = [...filteredRows];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
          break;
        case 'email':
          cmp = a.email.localeCompare(b.email, 'es', { sensitivity: 'base' });
          break;
        case 'organization_name':
          cmp = String(a.organization_name || '').localeCompare(String(b.organization_name || ''), 'es', { sensitivity: 'base' });
          break;
        case 'created_at':
          cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
        case 'subscription_status':
          cmp = statusRank[a.subscription_status] - statusRank[b.subscription_status];
          break;
        case 'days_left':
          cmp = a.days_left - b.days_left;
          break;
        case 'subscription_expires_at':
          cmp = new Date(a.subscription_expires_at || 0).getTime() - new Date(b.subscription_expires_at || 0).getTime();
          break;
        case 'plan':
          cmp = planRank[a.plan] - planRank[b.plan];
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filteredRows, sortDir, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const pageRows = useMemo(() => {
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [page, pageSize, sortedRows, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [query, sortDir, sortKey, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (search.trim()) next.set('q', search.trim());
    next.set('sort', sortKey);
    next.set('dir', sortDir);
    next.set('page', String(page));
    next.set('size', String(pageSize));
    setSearchParams(next, { replace: true });
  }, [page, pageSize, search, setSearchParams, sortDir, sortKey]);

  function onSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(nextKey);
    setSortDir('asc');
  }

  function sortIndicator(key: SortKey): string {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  }

  if (!isAdminViewer) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div>
      <PageHeader title="Usuarios Registrados" subtitle="Visión global de usuarios, estados y vencimientos." />

      {loading ? <div style={{ color: ds.textMuted, fontSize: 13 }}>Cargando usuarios…</div> : null}
      {error ? (
        <div style={{ color: ds.dangerText, background: ds.dangerBg, borderRadius: 8, padding: '10px 12px', fontSize: 13 }}>
          {error}
        </div>
      ) : null}

      {data ? (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            {kpiCard('Total usuarios registrados', data.kpis.total_users)}
            {kpiCard('En trial', data.kpis.total_trial)}
            {kpiCard('Activos (pagados)', data.kpis.total_active)}
            {kpiCard('Expirados', data.kpis.total_expired)}
            {kpiCard('Plan Pro', data.kpis.total_pro)}
          </div>

          <div
            style={{
              background: ds.bgCard,
              border: `1px solid ${ds.borderCard}`,
              borderRadius: 12,
              padding: 14,
            }}
          >
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  type="search"
                  placeholder="Buscar por nombre o email..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{
                    width: '100%',
                    maxWidth: 420,
                    height: 36,
                    borderRadius: 8,
                    border: `1px solid ${ds.borderCard}`,
                    padding: '0 12px',
                    fontSize: 13,
                    color: ds.textPrimary,
                    background: ds.bgApp,
                  }}
                />
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value) as (typeof PAGE_SIZE_OPTIONS)[number])}
                  style={{
                    height: 36,
                    borderRadius: 8,
                    border: `1px solid ${ds.borderCard}`,
                    padding: '0 10px',
                    fontSize: 13,
                    color: ds.textPrimary,
                    background: ds.bgApp,
                  }}
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size} por página
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${ds.borderRow}` }}>
                    <th style={{ textAlign: 'left', padding: '10px 8px', fontSize: 12, color: ds.textMuted, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      <button type="button" onClick={() => onSort('name')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', font: 'inherit', padding: 0 }}>
                        Nombre{sortIndicator('name')}
                      </button>
                    </th>
                    <th style={{ textAlign: 'left', padding: '10px 8px', fontSize: 12, color: ds.textMuted, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      <button type="button" onClick={() => onSort('email')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', font: 'inherit', padding: 0 }}>
                        Email{sortIndicator('email')}
                      </button>
                    </th>
                    <th style={{ textAlign: 'left', padding: '10px 8px', fontSize: 12, color: ds.textMuted, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      <button type="button" onClick={() => onSort('organization_name')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', font: 'inherit', padding: 0 }}>
                        Organización{sortIndicator('organization_name')}
                      </button>
                    </th>
                    <th style={{ textAlign: 'left', padding: '10px 8px', fontSize: 12, color: ds.textMuted, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      <button type="button" onClick={() => onSort('created_at')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', font: 'inherit', padding: 0 }}>
                        Fecha de registro{sortIndicator('created_at')}
                      </button>
                    </th>
                    <th style={{ textAlign: 'left', padding: '10px 8px', fontSize: 12, color: ds.textMuted, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      <button type="button" onClick={() => onSort('subscription_status')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', font: 'inherit', padding: 0 }}>
                        Estado{sortIndicator('subscription_status')}
                      </button>
                    </th>
                    <th style={{ textAlign: 'left', padding: '10px 8px', fontSize: 12, color: ds.textMuted, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      <button type="button" onClick={() => onSort('days_left')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', font: 'inherit', padding: 0 }}>
                        Días restantes{sortIndicator('days_left')}
                      </button>
                    </th>
                    <th style={{ textAlign: 'left', padding: '10px 8px', fontSize: 12, color: ds.textMuted, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      <button type="button" onClick={() => onSort('subscription_expires_at')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', font: 'inherit', padding: 0 }}>
                        Vencimiento{sortIndicator('subscription_expires_at')}
                      </button>
                    </th>
                    <th style={{ textAlign: 'left', padding: '10px 8px', fontSize: 12, color: ds.textMuted, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      <button type="button" onClick={() => onSort('plan')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', font: 'inherit', padding: 0 }}>
                        Plan{sortIndicator('plan')}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => (
                    <tr key={row.id} style={{ borderBottom: `1px solid ${ds.borderRow}` }}>
                      <td style={{ padding: '10px 8px', color: ds.textPrimary, fontSize: 13, fontWeight: 600 }}>{row.name}</td>
                      <td style={{ padding: '10px 8px', color: ds.textSecondary, fontSize: 13 }}>{row.email}</td>
                      <td style={{ padding: '10px 8px', color: ds.textSecondary, fontSize: 13 }}>
                        {row.organization_name || '-'}
                      </td>
                      <td style={{ padding: '10px 8px', color: ds.textSecondary, fontSize: 13 }}>{formatDateTime(row.created_at)}</td>
                      <td style={{ padding: '10px 8px' }}>
                        <span
                          style={{
                            ...statusBadgeStyle(row.subscription_status),
                            display: 'inline-flex',
                            alignItems: 'center',
                            borderRadius: 999,
                            padding: '3px 10px',
                            fontSize: 12,
                            fontWeight: 700,
                            textTransform: 'capitalize',
                          }}
                        >
                          {row.subscription_status}
                        </span>
                      </td>
                      <td style={{ padding: '10px 8px', color: ds.textSecondary, fontSize: 13 }}>{row.days_left}</td>
                      <td style={{ padding: '10px 8px', color: ds.textSecondary, fontSize: 13 }}>
                        {formatDateTime(row.subscription_expires_at)}
                      </td>
                      <td style={{ padding: '10px 8px', color: ds.textSecondary, fontSize: 13, textTransform: 'uppercase' }}>
                        {row.plan}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12, color: ds.textMuted }}>
                Mostrando {pageRows.length} de {sortedRows.length} usuarios (página {Math.min(page, totalPages)} de {totalPages})
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  style={{ border: `1px solid ${ds.borderCard}`, background: ds.bgApp, color: ds.textPrimary, borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.6 : 1 }}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  style={{ border: `1px solid ${ds.borderCard}`, background: ds.bgApp, color: ds.textPrimary, borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: page >= totalPages ? 'not-allowed' : 'pointer', opacity: page >= totalPages ? 0.6 : 1 }}
                >
                  Siguiente
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
