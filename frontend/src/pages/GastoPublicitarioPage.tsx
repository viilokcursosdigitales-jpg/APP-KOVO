import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../auth/api';
import { ModalConfirmar } from '../components/planeacion/ModalConfirmar';
import { DataTable, Td, Th, tableBase } from '../design-system/DataTable';
import { PageHeader } from '../design-system/PageHeader';
import { ds } from '../design-system/ds';

type PlatformKey = 'meta' | 'tiktok' | 'google' | 'otros';

type AdSpendEntry = {
  id: number;
  spend_date: string;
  platform: PlatformKey;
  platform_label: string;
  shopify_product_id: number;
  product_title: string;
  amount: number;
  currency: string;
  notes: string;
};

type ProductRow = { id: number; title: string };

const PLATFORMS: { value: PlatformKey; label: string }[] = [
  { value: 'meta', label: 'Meta' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'google', label: 'Google' },
  { value: 'otros', label: 'Otros' },
];

const fieldStyle: React.CSSProperties = {
  width: '100%',
  marginTop: 6,
  padding: '10px 11px',
  borderRadius: 10,
  border: `1px solid ${ds.borderCard}`,
  background: ds.bgSubtle,
  color: ds.textPrimary,
  fontSize: 13,
};

function todayYmdLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatSpendDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-CO', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(`${iso.slice(0, 10)}T12:00:00`));
  } catch {
    return iso;
  }
}

function formatMoney(amount: number, currency: string): string {
  const cur = String(currency || 'COP').toUpperCase();
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: cur,
      maximumFractionDigits: cur === 'COP' ? 0 : 2,
    }).format(Number.isFinite(amount) ? amount : 0);
  } catch {
    return `${amount} ${cur}`;
  }
}

function emptyForm(currency = 'COP') {
  return {
    spend_date: todayYmdLocal(),
    platform: 'meta' as PlatformKey,
    shopify_product_id: '',
    amount: '',
    notes: '',
    currency,
  };
}

export default function GastoPublicitarioPage() {
  const [entries, setEntries] = useState<AdSpendEntry[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [shopifyOk, setShopifyOk] = useState(false);
  const [currency, setCurrency] = useState('COP');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdSpendEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  const productMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of products) m.set(p.id, p.title);
    return m;
  }, [products]);

  const selectProducts = useMemo(() => {
    const list = [...products];
    if (editingId != null && form.shopify_product_id) {
      const pid = Number.parseInt(form.shopify_product_id, 10);
      if (Number.isFinite(pid) && !list.some((p) => p.id === pid)) {
        const entry = entries.find((e) => e.id === editingId);
        if (entry) list.unshift({ id: pid, title: entry.product_title });
      }
    }
    return list;
  }, [products, editingId, form.shopify_product_id, entries]);

  const loadProducts = useCallback(async () => {
    try {
      const res = await apiFetch('/api/shopify/products?limit=250');
      if (!res.ok) {
        setProducts([]);
        setShopifyOk(false);
        return;
      }
      const data = (await res.json()) as {
        products?: { id: number | string; title?: string; variants?: { price?: string }[] }[];
      };
      const list = Array.isArray(data.products)
        ? data.products
            .map((p) => ({
              id: Number.parseInt(String(p.id), 10),
              title: String(p.title || '(sin título)'),
            }))
            .filter((p) => Number.isFinite(p.id))
        : [];
      list.sort((a, b) => a.title.localeCompare(b.title, 'es'));
      setProducts(list);
      setShopifyOk(true);
    } catch {
      setProducts([]);
      setShopifyOk(false);
    }
  }, []);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/marketing/ad-spend');
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setEntries([]);
        setError(typeof j.error === 'string' ? j.error : 'No se pudieron cargar los registros');
        return;
      }
      const data = (await res.json()) as { entries?: AdSpendEntry[] };
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch {
      setEntries([]);
      setError('Error de red al cargar registros');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProducts();
    void loadEntries();
  }, [loadProducts, loadEntries]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm(currency));
    setModalOpen(true);
  };

  const openEdit = (entry: AdSpendEntry) => {
    setEditingId(entry.id);
    setForm({
      spend_date: entry.spend_date.slice(0, 10),
      platform: entry.platform,
      shopify_product_id: String(entry.shopify_product_id),
      amount: String(entry.amount),
      notes: entry.notes || '',
      currency: entry.currency || currency,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditingId(null);
  };

  const submitForm = async () => {
    const productId = Number.parseInt(form.shopify_product_id, 10);
    if (!Number.isFinite(productId) || productId <= 0) {
      setError('Selecciona un producto');
      return;
    }
    const amount = Number.parseFloat(form.amount.replace(',', '.'));
    if (!Number.isFinite(amount) || amount < 0) {
      setError('Ingresa un gasto válido');
      return;
    }
    const product_title = productMap.get(productId) || '';
    if (!product_title) {
      setError('Producto no encontrado en el catálogo');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const body = {
        spend_date: form.spend_date,
        platform: form.platform,
        shopify_product_id: productId,
        product_title,
        amount,
        currency: form.currency || currency,
        notes: form.notes.trim() || null,
      };
      const url =
        editingId != null ? `/api/marketing/ad-spend/${editingId}` : '/api/marketing/ad-spend';
      const res = await apiFetch(url, {
        method: editingId != null ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(typeof j.error === 'string' ? j.error : 'No se pudo guardar');
        return;
      }
      setModalOpen(false);
      setEditingId(null);
      await loadEntries();
    } catch {
      setError('Error de red al guardar');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError('');
    try {
      const res = await apiFetch(`/api/marketing/ad-spend/${deleteTarget.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(typeof j.error === 'string' ? j.error : 'No se pudo eliminar');
        return;
      }
      setDeleteTarget(null);
      await loadEntries();
    } catch {
      setError('Error de red al eliminar');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Gasto publicitario"
        subtitle="Registra el gasto diario por producto y plataforma publicitaria (Meta, TikTok, Google u otras)."
        right={
          <button
            type="button"
            onClick={openCreate}
            style={{
              padding: '9px 18px',
              borderRadius: 10,
              border: 'none',
              background: ds.brand,
              color: '#fff',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Agregar gasto
          </button>
        }
      />

      {!shopifyOk && !loading ? (
        <div
          style={{
            marginBottom: 18,
            padding: '14px 16px',
            borderRadius: 12,
            background: ds.infoBg,
            color: ds.infoText,
            fontSize: 13,
          }}
        >
          Conecta tu tienda en{' '}
          <Link to="/canales" style={{ fontWeight: 600, color: ds.brand }}>
            Canales
          </Link>{' '}
          para cargar el catálogo de productos Shopify al crear o editar un registro.
        </div>
      ) : null}

      {error ? (
        <div
          style={{
            marginBottom: 16,
            padding: '12px 16px',
            borderRadius: 12,
            background: ds.dangerBg,
            color: ds.dangerText,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      <DataTable
        title="Registros de gasto"
        subtitle={loading ? 'Cargando…' : `${entries.length} registro${entries.length === 1 ? '' : 's'}`}
      >
        <table style={{ ...tableBase, minWidth: 900 }}>
          <thead>
            <tr>
              <Th>Fecha</Th>
              <Th>Plataforma</Th>
              <Th>Producto</Th>
              <Th>Gasto</Th>
              <Th>Notas</Th>
              <Th>Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    padding: '16px 20px',
                    fontSize: 12,
                    color: ds.textMuted,
                    borderBottom: 'none',
                  }}
                >
                  Cargando registros…
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    padding: '16px 20px',
                    fontSize: 12,
                    color: ds.textMuted,
                    borderBottom: 'none',
                  }}
                >
                  No hay registros. Pulsa «Agregar gasto» para crear el primero.
                </td>
              </tr>
            ) : (
              entries.map((row, i) => (
                <tr key={row.id}>
                  <Td isLast={false}>{formatSpendDate(row.spend_date)}</Td>
                  <Td isLast={false}>{row.platform_label || row.platform}</Td>
                  <Td isLast={false}>
                    <div style={{ fontWeight: 600, fontSize: 12, color: ds.textPrimary, maxWidth: 280 }}>
                      {row.product_title}
                    </div>
                  </Td>
                  <Td isLast={false}>
                    <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      {formatMoney(row.amount, row.currency)}
                    </span>
                  </Td>
                  <Td isLast={false}>
                    <span style={{ fontSize: 12, color: ds.textSecondary, whiteSpace: 'pre-wrap' }}>
                      {row.notes?.trim() ? row.notes : '—'}
                    </span>
                  </Td>
                  <Td isLast={i === entries.length - 1}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 8,
                          border: `1px solid ${ds.borderCard}`,
                          background: ds.bgSubtle,
                          color: ds.textPrimary,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(row)}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 8,
                          border: `1px solid ${ds.borderCard}`,
                          background: ds.dangerBg,
                          color: ds.dangerText,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Eliminar
                      </button>
                    </div>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </DataTable>

      {modalOpen ? (
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
          onClick={closeModal}
        >
          <div
            style={{
              width: 'min(480px, calc(100vw - 28px))',
              maxHeight: 'calc(100vh - 36px)',
              overflowY: 'auto',
              background: ds.bgCard,
              border: `1px solid ${ds.borderCard}`,
              borderRadius: 14,
              boxShadow: '0 16px 44px rgba(15,23,42,0.16)',
              padding: 22,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700, color: ds.textPrimary }}>
              {editingId != null ? 'Editar gasto' : 'Agregar gasto'}
            </h3>

            <label style={{ display: 'block', fontSize: 12, color: ds.textSecondary, fontWeight: 600 }}>
              Fecha
              <input
                type="date"
                value={form.spend_date}
                onChange={(e) => setForm((f) => ({ ...f, spend_date: e.target.value }))}
                style={fieldStyle}
              />
            </label>

            <label
              style={{
                display: 'block',
                fontSize: 12,
                color: ds.textSecondary,
                fontWeight: 600,
                marginTop: 14,
              }}
            >
              Plataforma
              <select
                value={form.platform}
                onChange={(e) =>
                  setForm((f) => ({ ...f, platform: e.target.value as PlatformKey }))
                }
                style={fieldStyle}
              >
                {PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            <label
              style={{
                display: 'block',
                fontSize: 12,
                color: ds.textSecondary,
                fontWeight: 600,
                marginTop: 14,
              }}
            >
              Producto
              <select
                value={form.shopify_product_id}
                onChange={(e) => setForm((f) => ({ ...f, shopify_product_id: e.target.value }))}
                style={fieldStyle}
                disabled={!shopifyOk || selectProducts.length === 0}
              >
                <option value="">Selecciona un producto</option>
                {selectProducts.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>

            <label
              style={{
                display: 'block',
                fontSize: 12,
                color: ds.textSecondary,
                fontWeight: 600,
                marginTop: 14,
              }}
            >
              Gasto ({form.currency || currency})
              <input
                type="text"
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0"
                style={fieldStyle}
              />
            </label>

            <label
              style={{
                display: 'block',
                fontSize: 12,
                color: ds.textSecondary,
                fontWeight: 600,
                marginTop: 14,
              }}
            >
              Notas (opcional)
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={3}
                style={{ ...fieldStyle, resize: 'vertical', minHeight: 72 }}
              />
            </label>

            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                style={{
                  padding: '9px 16px',
                  borderRadius: 10,
                  border: `1px solid ${ds.borderCard}`,
                  background: ds.bgSubtle,
                  color: ds.textSecondary,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: saving ? 'not-allowed' : 'pointer',
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void submitForm()}
                disabled={saving || !form.shopify_product_id}
                style={{
                  padding: '9px 18px',
                  borderRadius: 10,
                  border: 'none',
                  background: ds.brand,
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: saving || !form.shopify_product_id ? 'not-allowed' : 'pointer',
                  opacity: saving || !form.shopify_product_id ? 0.7 : 1,
                }}
              >
                {saving ? 'Guardando…' : editingId != null ? 'Guardar cambios' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ModalConfirmar
        open={deleteTarget != null}
        titulo="Eliminar registro"
        mensaje={
          deleteTarget
            ? `¿Eliminar el gasto de ${formatMoney(deleteTarget.amount, deleteTarget.currency)} del ${formatSpendDate(deleteTarget.spend_date)} (${deleteTarget.platform_label})?`
            : ''
        }
        etiquetaConfirmar={deleting ? 'Eliminando…' : 'Eliminar'}
        peligro
        onCancelar={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        onConfirmar={() => void confirmDelete()}
      />
    </>
  );
}
