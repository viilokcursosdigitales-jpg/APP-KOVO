import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';
import { DataTable, Th, Td, tableBase } from '../design-system/DataTable';
import { PageHeader } from '../design-system/PageHeader';
import type { ProductMarketingTargets } from '../meta/marketingTargetEval';

type ProductRow = { id: number; title: string };

const inputStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 100,
  padding: '6px 8px',
  borderRadius: 8,
  border: `1px solid ${ds.borderCard}`,
  background: ds.bgApp,
  color: ds.textPrimary,
  fontSize: 12,
};

function emptyTargets(): ProductMarketingTargets {
  return {
    cpm_target: null,
    ctr_target: null,
    cpc_target: null,
    roas_target: null,
    cpa_target: null,
  };
}

export default function MarketingIndicatorsPage() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [shopifyOk, setShopifyOk] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Record<number, ProductMarketingTargets>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [prodRes, tgtRes] = await Promise.all([
        apiFetch('/api/shopify/products?limit=250'),
        apiFetch('/api/shopify/product-marketing-targets'),
      ]);

      let productList: ProductRow[] = [];
      if (prodRes.ok) {
        const pdata = (await prodRes.json()) as { products?: { id: number | string; title?: string }[] };
        productList = Array.isArray(pdata.products)
          ? pdata.products.map((p) => ({
              id: Number.parseInt(String(p.id), 10),
              title: String(p.title || '(sin título)'),
            }))
          : [];
        productList = productList.filter((p) => Number.isFinite(p.id));
        setProducts(productList);
        setShopifyOk(true);
      } else {
        setProducts([]);
        setShopifyOk(false);
      }

      const map: Record<number, ProductMarketingTargets> = {};
      if (tgtRes.ok) {
        const tdata = (await tgtRes.json()) as {
          targets?: {
            product_id: number;
            cpm_target: number | null;
            ctr_target: number | null;
            cpc_target: number | null;
            roas_target: number | null;
            cpa_target: number | null;
          }[];
        };
        for (const t of Array.isArray(tdata.targets) ? tdata.targets : []) {
          map[t.product_id] = {
            cpm_target: t.cpm_target != null ? Math.round(Number(t.cpm_target)) : null,
            ctr_target: t.ctr_target != null ? Math.round(Number(t.ctr_target)) : null,
            cpc_target: t.cpc_target != null ? Math.round(Number(t.cpc_target)) : null,
            roas_target: t.roas_target != null ? Math.round(Number(t.roas_target)) : null,
            cpa_target: t.cpa_target != null ? Math.round(Number(t.cpa_target)) : null,
          };
        }
      }
      const nextDraft: Record<number, ProductMarketingTargets> = {};
      for (const p of productList) {
        nextDraft[p.id] = map[p.id] ? { ...map[p.id] } : emptyTargets();
      }
      setDraft(nextDraft);
    } catch {
      setError('Error de red');
      setShopifyOk(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setField = (productId: number, field: keyof ProductMarketingTargets, raw: string) => {
    const t = raw.trim();
    if (t === '') {
      setDraft((d) => ({
        ...d,
        [productId]: { ...(d[productId] || emptyTargets()), [field]: null },
      }));
      return;
    }
    const num = Number.parseFloat(t.replace(',', '.'));
    if (!Number.isFinite(num)) return;
    const val = Math.round(num);
    setDraft((d) => ({
      ...d,
      [productId]: { ...(d[productId] || emptyTargets()), [field]: val },
    }));
  };

  const saveRow = async (productId: number) => {
    const t = draft[productId] || emptyTargets();
    setSavingId(productId);
    setSavedId(null);
    try {
      const res = await apiFetch('/api/shopify/product-marketing-targets', {
        method: 'PUT',
        body: JSON.stringify({
          product_id: productId,
          cpm_target: t.cpm_target != null ? Math.round(t.cpm_target) : null,
          ctr_target: t.ctr_target != null ? Math.round(t.ctr_target) : null,
          cpc_target: t.cpc_target != null ? Math.round(t.cpc_target) : null,
          roas_target: t.roas_target != null ? Math.round(t.roas_target) : null,
          cpa_target: t.cpa_target != null ? Math.round(t.cpa_target) : null,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(typeof j.error === 'string' ? j.error : 'No se pudo guardar');
        return;
      }
      setError('');
      setSavedId(productId);
      setTimeout(() => setSavedId((id) => (id === productId ? null : id)), 2000);
    } catch {
      setError('Error de red al guardar');
    } finally {
      setSavingId(null);
    }
  };

  const fieldVal = (productId: number, field: keyof ProductMarketingTargets) => {
    const v = draft[productId]?.[field];
    return v == null ? '' : String(v);
  };

  return (
    <>
      <PageHeader
        title="Indicadores de marketing"
        subtitle="Define objetivos por producto Shopify. En Análisis de creativo (Meta Ads) se comparan con el rendimiento de cada campaña vinculada."
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
          para listar productos. Los objetivos guardados siguen disponibles para Meta aunque falle la carga del catálogo.
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

      <p style={{ margin: '0 0 16px', fontSize: 13, color: ds.textSecondary, maxWidth: 720, lineHeight: 1.5 }}>
        CPM y CPC en COP (peso colombiano); CTR en % (igual que en Meta); ROAS en veces (enteros, p. ej. 3); CPA en COP.
        Valores sin decimales. Deja vacío lo que no quieras
        usar.{' '}
        <Link to="/meta-ads" style={{ color: ds.brand, fontWeight: 600 }}>
          Ir a Meta Ads
        </Link>
      </p>

      <DataTable
        title="Objetivos por producto"
        subtitle={loading ? 'Cargando…' : `${products.length} productos · guarda fila a fila`}
      >
        <table style={{ ...tableBase, minWidth: 880 }}>
          <thead>
            <tr>
              <Th>Producto</Th>
              <Th>CPM objetivo (COP)</Th>
              <Th>CTR objetivo (%)</Th>
              <Th>CPC objetivo (COP)</Th>
              <Th>ROAS objetivo (×)</Th>
              <Th>CPA objetivo (COP)</Th>
              <Th>Acción</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    padding: '16px 20px',
                    fontSize: 12,
                    color: ds.textMuted,
                    borderBottom: 'none',
                  }}
                >
                  Cargando catálogo e indicadores…
                </td>
              </tr>
            ) : products.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    padding: '16px 20px',
                    fontSize: 12,
                    color: ds.textMuted,
                    borderBottom: 'none',
                  }}
                >
                  No hay productos. Conecta Shopify en Canales.
                </td>
              </tr>
            ) : (
              products.map((p, i) => (
                <tr key={p.id}>
                  <Td isLast={false}>
                    <div style={{ fontWeight: 600, fontSize: 12, color: ds.textPrimary, maxWidth: 260 }}>{p.title}</div>
                    <div style={{ fontSize: 10.5, color: ds.textHint }}>id {p.id}</div>
                  </Td>
                  <Td isLast={false}>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={fieldVal(p.id, 'cpm_target')}
                      onChange={(e) => setField(p.id, 'cpm_target', e.target.value)}
                      style={inputStyle}
                      placeholder="—"
                    />
                  </Td>
                  <Td isLast={false}>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={fieldVal(p.id, 'ctr_target')}
                      onChange={(e) => setField(p.id, 'ctr_target', e.target.value)}
                      style={inputStyle}
                      placeholder="—"
                    />
                  </Td>
                  <Td isLast={false}>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={fieldVal(p.id, 'cpc_target')}
                      onChange={(e) => setField(p.id, 'cpc_target', e.target.value)}
                      style={inputStyle}
                      placeholder="—"
                    />
                  </Td>
                  <Td isLast={false}>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={fieldVal(p.id, 'roas_target')}
                      onChange={(e) => setField(p.id, 'roas_target', e.target.value)}
                      style={inputStyle}
                      placeholder="—"
                    />
                  </Td>
                  <Td isLast={false}>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={fieldVal(p.id, 'cpa_target')}
                      onChange={(e) => setField(p.id, 'cpa_target', e.target.value)}
                      style={inputStyle}
                      placeholder="—"
                    />
                  </Td>
                  <Td isLast={i === products.length - 1}>
                    <button
                      type="button"
                      disabled={savingId === p.id}
                      onClick={() => void saveRow(p.id)}
                      style={{
                        padding: '8px 14px',
                        borderRadius: 8,
                        border: 'none',
                        background: ds.brand,
                        color: '#fff',
                        fontWeight: 600,
                        fontSize: 12,
                        cursor: savingId === p.id ? 'wait' : 'pointer',
                      }}
                    >
                      {savingId === p.id ? 'Guardando…' : savedId === p.id ? 'Guardado' : 'Guardar'}
                    </button>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </DataTable>
    </>
  );
}
