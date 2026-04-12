import { ds } from '../design-system/ds';
import { IconMegaphone, IconShare } from '../design-system/icons';
import { PageHeader } from '../design-system/PageHeader';
import { StatusBadge } from '../design-system/StatusBadge';

const CHANNELS = [
  {
    name: 'Meta Ads',
    desc: 'Campañas y embudo conectados desde el módulo Meta.',
    icon: <IconMegaphone />,
    status: 'success' as const,
    label: 'Conectado',
    kpi: 'ROAS 2,8×',
  },
  {
    name: 'Shopify (ejemplo)',
    desc: 'Sincronización de pedidos e inventario.',
    icon: <IconShare />,
    status: 'paused' as const,
    label: 'No conectado',
    kpi: '—',
  },
];

export default function CanalesPage() {
  return (
    <>
      <PageHeader title="Canales" subtitle="Estado de integraciones y métricas clave (demo)." />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        {CHANNELS.map((c) => (
          <div
            key={c.name}
            style={{
              background: ds.bgCard,
              border: `1px solid ${ds.borderCard}`,
              borderRadius: 14,
              padding: '18px 20px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 9,
                  background: ds.brandBg,
                  color: ds.brand,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {c.icon}
              </div>
              <StatusBadge variant={c.status}>{c.label}</StatusBadge>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary }}>{c.name}</div>
            <div style={{ fontSize: 11, color: ds.textMuted, marginTop: 6, lineHeight: 1.45 }}>{c.desc}</div>
            <div style={{ marginTop: 14, fontSize: 12, fontWeight: 600, color: ds.brand }}>{c.kpi}</div>
          </div>
        ))}
      </div>
    </>
  );
}
