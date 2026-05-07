import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../auth/api';
import { PageHeader } from '../design-system/PageHeader';
import { ds } from '../design-system/ds';

type DashboardType = 'banner' | 'alert' | 'news';
type AlertColor = 'green' | 'yellow' | 'red' | 'blue';

type DashboardContentItem = {
  id: number;
  type: DashboardType;
  title: string;
  description: string;
  image_url: string | null;
  link_url: string | null;
  link_text: string | null;
  color: AlertColor;
  active: boolean;
  order_index: number;
};

const ADMIN_EMAIL = 'cavimo25@gmail.com';
const TABS: Array<{ id: DashboardType; label: string }> = [
  { id: 'banner', label: 'Banners' },
  { id: 'alert', label: 'Alertas' },
  { id: 'news', label: 'Novedades' },
];

function previewAlertColors(color: AlertColor) {
  if (color === 'green') return { bg: '#dcfce7', fg: '#166534', dot: '#16a34a' };
  if (color === 'yellow') return { bg: '#fef3c7', fg: '#92400e', dot: '#d97706' };
  if (color === 'red') return { bg: '#fee2e2', fg: '#991b1b', dot: '#dc2626' };
  return { bg: '#dbeafe', fg: '#1e3a8a', dot: '#2563eb' };
}

function defaultForm(type: DashboardType) {
  return { type, title: '', description: '', image_url: '', link_url: '', link_text: '', color: 'blue' as AlertColor, active: true };
}

export default function AdminDashboardContentPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<DashboardType>('banner');
  const [items, setItems] = useState<DashboardContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(defaultForm('banner'));
  const isAdmin = String(user?.email || '').trim().toLowerCase() === ADMIN_EMAIL;

  const filtered = useMemo(
    () =>
      items
        .filter((x) => x.type === tab)
        .sort((a, b) => a.order_index - b.order_index || a.id - b.id),
    [items, tab],
  );

  async function loadAll() {
    setLoading(true);
    setError('');
    setMsg('');
    try {
      const [pubRes, adminRes] = await Promise.all([
        apiFetch('/api/dashboard-content'),
        apiFetch('/api/admin/dashboard-content?all=1'),
      ]);
      const pubData = (await pubRes.json().catch(() => ({}))) as { banners?: DashboardContentItem[]; alerts?: DashboardContentItem[]; news?: DashboardContentItem[]; };
      const adminData = (await adminRes.json().catch(() => ({}))) as { items?: DashboardContentItem[]; error?: string };
      if (!adminRes.ok) {
        setError(typeof adminData.error === 'string' ? adminData.error : 'No se pudo cargar contenido');
        return;
      }
      if (Array.isArray(adminData.items)) {
        setItems(adminData.items);
        return;
      }
      const merged = [
        ...(Array.isArray(pubData.banners) ? pubData.banners : []),
        ...(Array.isArray(pubData.alerts) ? pubData.alerts : []),
        ...(Array.isArray(pubData.news) ? pubData.news : []),
      ];
      setItems(merged);
    } catch {
      setError('Error de red cargando contenido');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) return;
    void loadAll();
  }, [isAdmin]);

  function resetForm(nextType = tab) {
    setEditingId(null);
    setForm(defaultForm(nextType));
  }

  async function saveForm() {
    setError('');
    setMsg('');
    const payload = {
      ...form,
      title: form.title.trim(),
      description: form.description.trim(),
      image_url: form.image_url.trim(),
      link_url: form.link_url.trim(),
      link_text: form.link_text.trim(),
    };
    if (payload.title.length < 2 || payload.description.length < 2) {
      setError('Título y descripción deben tener al menos 2 caracteres');
      return;
    }
    const url = editingId ? `/api/admin/dashboard-content/${editingId}` : '/api/admin/dashboard-content';
    const method = editingId ? 'PUT' : 'POST';
    const res = await apiFetch(url, { method, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof data.error === 'string' ? data.error : 'No se pudo guardar');
      return;
    }
    await loadAll();
    setMsg(editingId ? 'Contenido actualizado' : 'Contenido creado');
    resetForm(tab);
  }

  async function toggleItem(item: DashboardContentItem) {
    const res = await apiFetch(`/api/admin/dashboard-content/${item.id}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !item.active }),
    });
    if (!res.ok) return;
    await loadAll();
  }

  async function deleteItem(item: DashboardContentItem) {
    if (!window.confirm(`¿Eliminar "${item.title}"?`)) return;
    const res = await apiFetch(`/api/admin/dashboard-content/${item.id}`, { method: 'DELETE' });
    if (!res.ok) return;
    await loadAll();
  }

  async function duplicateItem(item: DashboardContentItem) {
    setError('');
    setMsg('');
    const payload = {
      type: item.type,
      title: `${item.title} (copia)`,
      description: item.description,
      image_url: item.image_url || '',
      link_url: item.link_url || '',
      link_text: item.link_text || '',
      color: item.color || 'blue',
      active: false,
      order_index: item.order_index + 1,
    };
    const res = await apiFetch('/api/admin/dashboard-content', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof data.error === 'string' ? data.error : 'No se pudo duplicar el contenido');
      return;
    }
    setMsg('Contenido duplicado en borrador (inactivo)');
    await loadAll();
  }

  async function moveItem(itemId: number, delta: -1 | 1) {
    const list = [...filtered];
    const idx = list.findIndex((x) => x.id === itemId);
    if (idx < 0) return;
    const nextIdx = idx + delta;
    if (nextIdx < 0 || nextIdx >= list.length) return;
    const tmp = list[idx];
    list[idx] = list[nextIdx];
    list[nextIdx] = tmp;
    const byId = new Map<number, number>();
    list.forEach((x, i) => byId.set(x.id, i + 1));
    const payload = items.map((x) => ({ id: x.id, order_index: x.type === tab ? byId.get(x.id) || x.order_index : x.order_index }));
    const res = await apiFetch('/api/admin/dashboard-content/reorder', {
      method: 'PATCH',
      body: JSON.stringify({ items: payload }),
    });
    if (!res.ok) return;
    await loadAll();
  }

  function editItem(item: DashboardContentItem) {
    setEditingId(item.id);
    setForm({
      type: item.type,
      title: item.title,
      description: item.description,
      image_url: item.image_url || '',
      link_url: item.link_url || '',
      link_text: item.link_text || '',
      color: item.color || 'blue',
      active: item.active,
    });
  }

  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div style={{ maxWidth: 1100 }}>
      <PageHeader title="Contenido Inicio" subtitle="Administra banners, alertas y novedades del dashboard de bienvenida." />

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <a
          href="/dashboard"
          target="_blank"
          rel="noreferrer noopener"
          style={{
            border: `1px solid ${ds.borderCard}`,
            background: ds.bgCard,
            color: ds.textSecondary,
            borderRadius: 8,
            padding: '7px 12px',
            fontSize: 13,
            fontWeight: 600,
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          Previsualizar Inicio
        </a>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              resetForm(t.id);
            }}
            style={{
              border: `1px solid ${ds.borderCard}`,
              background: tab === t.id ? ds.brand : ds.bgCard,
              color: tab === t.id ? ds.textOnBrand : ds.textSecondary,
              borderRadius: 8,
              padding: '7px 12px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error ? <div style={{ marginBottom: 10, color: ds.dangerText, background: ds.dangerBg, borderRadius: 8, padding: '10px 12px' }}>{error}</div> : null}
      {msg ? <div style={{ marginBottom: 10, color: ds.successText, background: ds.successBg, borderRadius: 8, padding: '10px 12px' }}>{msg}</div> : null}

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1.2fr 1fr' }}>
        <div style={{ border: `1px solid ${ds.borderCard}`, borderRadius: 12, background: ds.bgCard, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <strong style={{ color: ds.textPrimary }}>{TABS.find((x) => x.id === tab)?.label}</strong>
            <button type="button" onClick={() => resetForm(tab)} style={{ border: `1px solid ${ds.borderCard}`, background: ds.bgApp, borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>
              Crear nuevo
            </button>
          </div>
          {loading ? <div style={{ color: ds.textMuted, fontSize: 13 }}>Cargando…</div> : null}
          {!loading && filtered.length === 0 ? <div style={{ color: ds.textMuted, fontSize: 13 }}>No hay elementos en esta pestaña.</div> : null}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map((item, idx) => (
              <div key={item.id} style={{ border: `1px solid ${ds.borderCard}`, borderRadius: 10, padding: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, color: ds.textPrimary, fontSize: 13 }}>{item.title}</div>
                    <div style={{ color: ds.textSecondary, fontSize: 12, marginTop: 4 }}>{item.description}</div>
                    <div style={{ color: ds.textHint, fontSize: 11, marginTop: 6 }}>
                      #{item.order_index} · {item.active ? 'Activo' : 'Inactivo'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <button type="button" onClick={() => moveItem(item.id, -1)} disabled={idx === 0} style={{ border: `1px solid ${ds.borderCard}`, background: ds.bgApp, borderRadius: 6, padding: '3px 8px', cursor: idx === 0 ? 'not-allowed' : 'pointer' }}>
                      ↑
                    </button>
                    <button type="button" onClick={() => moveItem(item.id, 1)} disabled={idx === filtered.length - 1} style={{ border: `1px solid ${ds.borderCard}`, background: ds.bgApp, borderRadius: 6, padding: '3px 8px', cursor: idx === filtered.length - 1 ? 'not-allowed' : 'pointer' }}>
                      ↓
                    </button>
                  </div>
                </div>
                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => toggleItem(item)} style={{ border: `1px solid ${ds.borderCard}`, background: ds.bgApp, borderRadius: 6, padding: '5px 8px', cursor: 'pointer', fontSize: 12 }}>
                    {item.active ? 'Desactivar' : 'Activar'}
                  </button>
                  <button type="button" onClick={() => editItem(item)} style={{ border: `1px solid ${ds.borderCard}`, background: ds.bgApp, borderRadius: 6, padding: '5px 8px', cursor: 'pointer', fontSize: 12 }}>
                    Editar
                  </button>
                  <button type="button" onClick={() => void duplicateItem(item)} style={{ border: `1px solid ${ds.borderCard}`, background: ds.bgApp, borderRadius: 6, padding: '5px 8px', cursor: 'pointer', fontSize: 12 }}>
                    Duplicar
                  </button>
                  <button type="button" onClick={() => void deleteItem(item)} style={{ border: `1px solid ${ds.borderCard}`, background: ds.bgApp, color: ds.dangerText, borderRadius: 6, padding: '5px 8px', cursor: 'pointer', fontSize: 12 }}>
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ border: `1px solid ${ds.borderCard}`, borderRadius: 12, background: ds.bgCard, padding: 12 }}>
          <strong style={{ color: ds.textPrimary }}>{editingId ? 'Editar contenido' : 'Crear contenido'}</strong>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            <label style={{ fontSize: 12, color: ds.textSecondary }}>
              Tipo
              <select value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as DashboardType }))} style={{ width: '100%', marginTop: 4, border: `1px solid ${ds.borderCard}`, borderRadius: 8, padding: '7px 9px', background: ds.bgApp }}>
                {TABS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 12, color: ds.textSecondary }}>
              Título
              <input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} style={{ width: '100%', marginTop: 4, border: `1px solid ${ds.borderCard}`, borderRadius: 8, padding: '7px 9px', background: ds.bgApp }} />
            </label>
            <label style={{ fontSize: 12, color: ds.textSecondary }}>
              Descripción
              <textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} rows={4} style={{ width: '100%', marginTop: 4, border: `1px solid ${ds.borderCard}`, borderRadius: 8, padding: '7px 9px', background: ds.bgApp }} />
            </label>
            <label style={{ fontSize: 12, color: ds.textSecondary }}>
              URL de imagen
              <input value={form.image_url} onChange={(e) => setForm((p) => ({ ...p, image_url: e.target.value }))} style={{ width: '100%', marginTop: 4, border: `1px solid ${ds.borderCard}`, borderRadius: 8, padding: '7px 9px', background: ds.bgApp }} />
            </label>
            <label style={{ fontSize: 12, color: ds.textSecondary }}>
              URL de enlace
              <input value={form.link_url} onChange={(e) => setForm((p) => ({ ...p, link_url: e.target.value }))} style={{ width: '100%', marginTop: 4, border: `1px solid ${ds.borderCard}`, borderRadius: 8, padding: '7px 9px', background: ds.bgApp }} />
            </label>
            <label style={{ fontSize: 12, color: ds.textSecondary }}>
              Texto del botón/enlace
              <input value={form.link_text} onChange={(e) => setForm((p) => ({ ...p, link_text: e.target.value }))} style={{ width: '100%', marginTop: 4, border: `1px solid ${ds.borderCard}`, borderRadius: 8, padding: '7px 9px', background: ds.bgApp }} />
            </label>
            <label style={{ fontSize: 12, color: ds.textSecondary }}>
              Color (alertas)
              <select value={form.color} onChange={(e) => setForm((p) => ({ ...p, color: e.target.value as AlertColor }))} style={{ width: '100%', marginTop: 4, border: `1px solid ${ds.borderCard}`, borderRadius: 8, padding: '7px 9px', background: ds.bgApp }}>
                <option value="green">Verde</option>
                <option value="yellow">Amarillo</option>
                <option value="red">Rojo</option>
                <option value="blue">Azul</option>
              </select>
            </label>
            <label style={{ fontSize: 12, color: ds.textSecondary, display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={form.active} onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))} />
              Activo
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => void saveForm()} style={{ border: 'none', background: ds.brand, color: ds.textOnBrand, borderRadius: 8, padding: '8px 12px', fontWeight: 700, cursor: 'pointer' }}>
                {editingId ? 'Guardar cambios' : 'Crear'}
              </button>
              {editingId ? (
                <button type="button" onClick={() => resetForm(tab)} style={{ border: `1px solid ${ds.borderCard}`, background: ds.bgApp, borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}>
                  Cancelar
                </button>
              ) : null}
            </div>

            <div style={{ marginTop: 14, borderTop: `1px solid ${ds.borderCard}`, paddingTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: ds.textMuted, marginBottom: 8 }}>Vista previa borrador</div>
              {form.type === 'banner' ? (
                <div
                  style={{
                    borderRadius: 12,
                    overflow: 'hidden',
                    border: `1px solid ${ds.borderCard}`,
                    background: form.image_url.trim()
                      ? `linear-gradient(rgba(15,23,42,0.45), rgba(15,23,42,0.65)), url(${form.image_url.trim()}) center/cover no-repeat`
                      : 'linear-gradient(135deg, #1e293b, #334155)',
                    color: '#fff',
                    minHeight: 150,
                    display: 'flex',
                    alignItems: 'flex-end',
                  }}
                >
                  <div style={{ padding: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{form.title || 'Título del banner'}</div>
                    <div style={{ fontSize: 12, marginTop: 4, opacity: 0.95 }}>{form.description || 'Descripción del banner'}</div>
                    {form.link_text.trim() ? (
                      <span style={{ marginTop: 8, display: 'inline-block', background: '#fff', color: '#0f172a', borderRadius: 8, padding: '5px 9px', fontSize: 11, fontWeight: 700 }}>
                        {form.link_text.trim()}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {form.type === 'alert' ? (
                <div
                  style={{
                    borderRadius: 10,
                    padding: '10px 12px',
                    background: previewAlertColors(form.color).bg,
                    color: previewAlertColors(form.color).fg,
                    border: `1px solid ${ds.borderCard}`,
                  }}
                >
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: previewAlertColors(form.color).dot }} />
                    <strong style={{ fontSize: 13 }}>{form.title || 'Título de alerta'}</strong>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12 }}>{form.description || 'Descripción de alerta'}</div>
                </div>
              ) : null}
              {form.type === 'news' ? (
                <div style={{ border: `1px solid ${ds.borderCard}`, borderRadius: 10, padding: 10, background: ds.bgApp }}>
                  <div style={{ fontWeight: 700, color: ds.textPrimary, fontSize: 14 }}>{form.title || 'Título de novedad'}</div>
                  <div style={{ marginTop: 5, fontSize: 12, color: ds.textSecondary }}>
                    {form.description || 'Descripción de novedad'}
                  </div>
                  {form.link_text.trim() ? (
                    <div style={{ marginTop: 8, fontSize: 12, color: ds.brand, fontWeight: 700 }}>{form.link_text.trim()}</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
