import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';
import {
  type CampaignProductLinkDetail,
  EMPTY_CAMPAIGN_LINK,
  campaignLinkHasAnyProduct,
} from './campaignProductLinks';

export type ShopifyProductOption = { id: number; title: string };

export function MetaCampaignProductAssign({
  campaignId,
  linkDetail,
  products,
  shopifyOk,
  onUpdate,
}: {
  campaignId: string;
  linkDetail: CampaignProductLinkDetail;
  products: ShopifyProductOption[];
  shopifyOk: boolean;
  onUpdate: (campaignId: string, detail: CampaignProductLinkDetail) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftPrimary, setDraftPrimary] = useState<number[]>([]);
  const [draftComplementary, setDraftComplementary] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (open) {
      setDraftPrimary([...(linkDetail.product_ids || [])]);
      setDraftComplementary([...(linkDetail.complementary_product_ids || [])]);
      setErr('');
    }
  }, [open, linkDetail]);

  const togglePrimary = (id: number) => {
    setDraftPrimary((d) => {
      const next = d.includes(id) ? d.filter((x) => x !== id) : [...d, id];
      if (next.includes(id)) {
        setDraftComplementary((c) => c.filter((x) => x !== id));
      }
      return next;
    });
  };

  const toggleComplementary = (id: number) => {
    if (draftPrimary.includes(id)) return;
    setDraftComplementary((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
  };

  const save = useCallback(async () => {
    setSaving(true);
    setErr('');
    try {
      const res = await apiFetch('/api/meta/campaign-product-links', {
        method: 'PUT',
        body: JSON.stringify({
          meta_campaign_id: campaignId,
          product_ids: draftPrimary,
          complementary_product_ids: draftComplementary,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        product_ids?: number[];
        complementary_product_ids?: number[];
      };
      if (!res.ok) {
        setErr(typeof j.error === 'string' ? j.error : 'No se pudo guardar');
        return;
      }
      onUpdate(campaignId, {
        product_ids: Array.isArray(j.product_ids) ? j.product_ids : [...draftPrimary],
        complementary_product_ids: Array.isArray(j.complementary_product_ids)
          ? j.complementary_product_ids
          : [...draftComplementary],
      });
      setOpen(false);
    } catch {
      setErr('Error de red');
    } finally {
      setSaving(false);
    }
  }, [campaignId, draftPrimary, draftComplementary, onUpdate]);

  const primaryLabels = (linkDetail.product_ids || [])
    .map((id) => products.find((p) => p.id === id)?.title)
    .filter(Boolean) as string[];
  const compLabels = (linkDetail.complementary_product_ids || [])
    .map((id) => products.find((p) => p.id === id)?.title)
    .filter(Boolean) as string[];

  let summary = 'Sin asignar';
  if (campaignLinkHasAnyProduct(linkDetail)) {
    const parts: string[] = [];
    if (primaryLabels.length) {
      parts.push(
        primaryLabels.length <= 1
          ? `Principal: ${primaryLabels[0]}`
          : `${primaryLabels.length} principales`,
      );
    }
    if (compLabels.length) {
      parts.push(
        compLabels.length <= 1 ? `+ ${compLabels[0]}` : `+ ${compLabels.length} complementarios`,
      );
    }
    summary = parts.join(' · ');
  }

  const renderProductList = (
    selected: number[],
    onToggle: (id: number) => void,
    disabledIds: Set<number>,
  ) => (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {products.map((p) => {
        const disabled = disabledIds.has(p.id);
        return (
          <li key={p.id}>
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontSize: 12,
                color: disabled ? ds.textMuted : ds.textPrimary,
                lineHeight: 1.35,
                opacity: disabled ? 0.55 : 1,
              }}
            >
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                disabled={disabled}
                onChange={() => onToggle(p.id)}
                style={{ marginTop: 2 }}
              />
              <span>{p.title}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      <div style={{ maxWidth: 260 }}>
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
          title={[...primaryLabels, ...compLabels].join(', ') || undefined}
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
              width: 'min(480px, 100%)',
              maxHeight: 'min(560px, 90vh)',
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
              <div style={{ fontSize: 14, fontWeight: 700, color: ds.textPrimary }}>Productos de la campaña</div>
              <div style={{ fontSize: 11, color: ds.textMuted, marginTop: 4, lineHeight: 1.45 }}>
                El <strong>producto principal</strong> recibe el gasto publicitario y agrupa las ventas en Ganancia
                diaria. Los <strong>complementarios</strong> (upsells) se suman al principal en el informe.
              </div>
            </div>
            <div style={{ padding: '12px 18px', overflowY: 'auto', flex: 1 }}>
              {!shopifyOk ? (
                <p style={{ margin: 0, fontSize: 12, color: ds.textSecondary, lineHeight: 1.5 }}>
                  Conecta Shopify en <strong style={{ color: ds.textPrimary }}>Canales</strong> para cargar el
                  catálogo.
                </p>
              ) : products.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12, color: ds.textMuted }}>No hay productos en la tienda.</p>
              ) : (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: ds.textPrimary, marginBottom: 8 }}>
                      Producto(s) principal(es)
                    </div>
                    {renderProductList(draftPrimary, togglePrimary, new Set())}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: ds.textPrimary, marginBottom: 8 }}>
                      Productos complementarios
                    </div>
                    <p style={{ margin: '0 0 8px', fontSize: 11, color: ds.textMuted, lineHeight: 1.4 }}>
                      No aparecen como fila aparte en Ganancia diaria; sus ventas se agrupan en el principal.
                    </p>
                    {renderProductList(
                      draftComplementary,
                      toggleComplementary,
                      new Set(draftPrimary),
                    )}
                  </div>
                </>
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