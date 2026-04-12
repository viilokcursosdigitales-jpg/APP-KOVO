import { useState } from 'react';
import { ds } from '../design-system/ds';
import { PageHeader } from '../design-system/PageHeader';
import { MetaConnectionPanel, TabCreativo, TabEmbudo } from '../meta/MetaDemoTabs';
import type { PeriodKey, ProductKey } from '../meta/demoMetrics';

export default function MetaAdsPage() {
  const [metaTab, setMetaTab] = useState<'creativo' | 'embudo' | 'conexion'>('creativo');
  const [p1, setP1] = useState<PeriodKey>('7d');
  const [pr1, setPr1] = useState<ProductKey>('all');
  const [p2, setP2] = useState<PeriodKey>('7d');
  const [pr2, setPr2] = useState<ProductKey>('all');

  return (
    <>
      <PageHeader
        title="Meta Ads"
        subtitle={
          metaTab === 'conexion'
            ? 'Vincula tu app de Facebook Developer y gestiona el acceso a tus anuncios'
            : 'Análisis de campañas y embudo de conversión'
        }
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
            { id: 'embudo' as const, label: 'Análisis embudo' },
            { id: 'conexion' as const, label: 'Conexión Meta ADS' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setMetaTab(t.id)}
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
      ) : metaTab === 'embudo' ? (
        <TabEmbudo period={p2} setPeriod={setP2} product={pr2} setProduct={setPr2} />
      ) : (
        <MetaConnectionPanel />
      )}
    </>
  );
}
