import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';

export type ShopifyProductOption = { id: number; title: string };

export function MetaCampaignProductAssign({
  campaignId,
  productIds,
  products,
  shopifyOk,
  onUpdate,
}: {
  campaignId: string;
  productIds: number[];
  products: ShopifyProductOption[];
  shopifyOk: boolean;
  onUpdate: (campaignId: string, ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (open) {
      setDraft([...productIds]);
      setErr('');
    }
  }, [open, productIds]);

  const toggle = (id: number) => {
    setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
  };

  const save = useCallback(async () => {
    setSaving(true);
    setErr('');
    try {
      const res = await apiFetch('/api/meta/campaign-product-links', {
        method: 'PUT',
        body: JSON.stringify({ meta_campaign_id: campaignId, product_ids: draft }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErr(typeof j.error === 'string' ? j.error : 'No se pudo guardar');
        return;
      }
      onUpdate(campaignId, [...draft]);
      setOpen(false);
    } catch {
      setErr('Error de red');
    } finally {
      setSaving(false);
    }
  }, [campaignId, draft, onUpdate]);

  const labels = productIds
    .map((id) => products.find((p) => p.id === id)?.title)
    .filter(Boolean) as string[];
  const summary =
    productIds.length === 0
      ? 'Sin asignar'
      : labels.length <= 2
        ? labels.join(' · ')
        : `${productIds.length} productos`;

  return (
    <>
      <div style={{ maxWidth: 240 }}>
        <div
          style={{
            fontSize: 11,
            color: ds.textSecondary,
            lineHeight: 1.35,
            marginBottom: 6,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={labels.length ? labels.join(', ') : undefined}
        >
          {summary}
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            padding: '5px 10px',
            borderRadius: 8,
            border: `1px solid ${ds.borderCard}`,
            background: ds.bgApp,
            color: ds.brand,
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Editar productos
        </button>
      </div>

      {open ? (
        <div
          role="presentation"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => !saving && setOpen(false)}
          onKeyDown={(e) => e.key === 'Escape' && !saving && setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            style={{
              width: 'min(420px, 100%)',
              maxHeight: 'min(480px, 90vh)',
              background: ds.bgCard,
              borderRadius: 14,
              border: `1px solid ${ds.borderCard}`,
              boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '16px 18px', borderBottom: `1px solid ${ds.borderCard}` }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: ds.textPrimary }}>Productos relacionados</div>
              <div style={{ fontSize: 11, color: ds.textMuted, marginTop: 4 }}>
                Vincula el gasto de esta campaña con uno o varios productos de tu catálogo Shopify.
              </div>
            </div>
            <div style={{ padding: '12px 18px', overflowY: 'auto', flex: 1 }}>
              {!shopifyOk ? (
                <p style={{ margin: 0, fontSize: 12, color: ds.textSecondary, lineHeight: 1.5 }}>
                  Conecta Shopify en <strong style={{ color: ds.textPrimary }}>Canales</strong> para cargar el catálogo y
                  poder elegir productos.
                </p>
              ) : products.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12, color: ds.textMuted }}>No hay productos en la tienda (o la lista está vacía).</p>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {products.map((p) => (
                    <li key={p.id}>
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 10,
                          cursor: 'pointer',
                          fontSize: 12,
                          color: ds.textPrimary,
                          lineHeight: 1.35,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={draft.includes(p.id)}
                          onChange={() => toggle(p.id)}
                          style={{ marginTop: 2 }}
                        />
                        <span>{p.title}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {err ? (
              <div style={{ padding: '0 18px 8px', fontSize: 12, color: ds.dangerText }}>{err}</div>
            ) : null}
            <div
              style={{
                padding: '12px 18px',
                borderTop: `1px solid ${ds.borderCard}`,
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 10,
              }}
            >
              <button
                type="button"
                disabled={saving}
                onClick={() => setOpen(false)}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: `1px solid ${ds.borderCard}`,
                  background: ds.bgApp,
                  color: ds.textSecondary,
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: saving ? 'wait' : 'pointer',
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving || !shopifyOk}
                onClick={() => void save()}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: 'none',
                  background: ds.brand,
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: saving || !shopifyOk ? 'not-allowed' : 'pointer',
                  opacity: !shopifyOk ? 0.5 : 1,
                }}
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
