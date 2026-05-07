import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ds } from '../design-system/ds';
import { PageHeader } from '../design-system/PageHeader';
import { TabCreativo, TabEmbudo } from '../meta/MetaDemoTabs';
import type { PeriodKey, ProductKey } from '../meta/demoMetrics';

type MetaTabId = 'creativo' | 'embudo';

function tabFromSearch(tab: string | null): MetaTabId {
  if (tab === 'creativo' || tab === 'embudo') return tab;
  return 'creativo';
}

export default function MetaAdsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const tabParam = searchParams.get('tab');
  const [metaTab, setMetaTab] = useState<MetaTabId>(() => tabFromSearch(tabParam));

  useEffect(() => {
    if (tabParam === 'conexion') {
      const q = searchParams.toString();
      navigate(q ? `/conexion-meta?${q}` : '/conexion-meta', { replace: true });
      return;
    }
    setMetaTab(tabFromSearch(tabParam));
  }, [tabParam, searchParams, navigate]);

  const setMetaTabInUrl = useCallback(
    (id: MetaTabId) => {
      setMetaTab(id);
      setSearchParams({ tab: id }, { replace: true });
    },
    [setSearchParams],
  );
  const [p1, setP1] = useState<PeriodKey>('hoy');
  const [pr1, setPr1] = useState<ProductKey>('all');
  const [p2, setP2] = useState<PeriodKey>('hoy');
  const [pr2, setPr2] = useState<ProductKey>('all');

  if (tabParam === 'conexion') {
    return null;
  }

  return (
    <>
      <PageHeader
        title="Análisis de creativos"
        subtitle="Análisis de campañas y embudo de conversión"
      />

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 0,
          marginBottom: 22,
          borderBottom: `1px solid ${ds.borderCard}`,
        }}
      >
        {(
          [
            { id: 'creativo' as const, label: 'Análisis de creativo' },
            { id: 'embudo' as const, label: 'Análisis de embudo' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setMetaTabInUrl(t.id)}
            style={{
              padding: '12px 20px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: metaTab === t.id ? 600 : 500,
              color: metaTab === t.id ? ds.brand : ds.textMuted,
              borderBottom: metaTab === t.id ? `2px solid ${ds.brand}` : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {metaTab === 'creativo' ? (
        <TabCreativo period={p1} setPeriod={setP1} product={pr1} setProduct={setPr1} />
      ) : (
        <TabEmbudo period={p2} setPeriod={setP2} product={pr2} setProduct={setPr2} />
      )}
    </>
  );
}
