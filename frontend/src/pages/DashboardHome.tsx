import { Link } from 'react-router-dom';
import { ds } from '../design-system/ds';
import { DataTable, Th, Td, tableBase } from '../design-system/DataTable';
import { IconCart } from '../design-system/icons';
import { KpiCard } from '../design-system/KpiCard';
import { PageHeader } from '../design-system/PageHeader';
import { StatusBadge } from '../design-system/StatusBadge';

const DEMO_ORDERS = [
  { id: '#4821', name: 'María G.', sub: 'Hace 2 h', total: '€ 124,90', status: 'success' as const, label: 'Completado' },
  { id: '#4820', name: 'Pedro L.', sub: 'Hace 5 h', total: '€ 89,00', status: 'info' as const, label: 'En proceso' },
  { id: '#4819', name: 'Ana R.', sub: 'Ayer', total: '€ 210,50', status: 'success' as const, label: 'Completado' },
  { id: '#4818', name: 'Luis M.', sub: 'Ayer', total: '€ 45,00', status: 'paused' as const, label: 'Pendiente' },
];

const DEMO_STOCK = [
  { name: 'Crema hidratante', sku: 'SKU-102', qty: 8, variant: 'warning' as const },
  { name: 'Sérum vitamina C', sku: 'SKU-088', qty: 3, variant: 'error' as const },
  { name: 'Kit rutina PM', sku: 'SKU-201', qty: 14, variant: 'success' as const },
];

const CHART_WEEKS = [
  { w: 'S1', a: 62, b: 44 },
  { w: 'S2', a: 55, b: 48 },
  { w: 'S3', a: 70, b: 52 },
  { w: 'S4', a: 58, b: 60 },
];

export default function DashboardHome() {
  const maxBar = Math.max(...CHART_WEEKS.flatMap((x) => [x.a, x.b]), 1);

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Resumen de ventas, pedidos e inventario." />

      <div className="kovo-kpi-grid-dash">
        <KpiCard variant="sales" label="Ingresos (30 días)" value="€ 18.420,00" icon={<IconCart />} />
        <KpiCard variant="traffic" label="Pedidos" value="326" icon={<IconCart />} />
        <KpiCard variant="spend" label="Ticket medio" value="€ 56,50" icon={<IconCart />} />
        <KpiCard variant="conversion" label="Tasa conversión" value="3,2 %" icon={<IconCart />} />
      </div>

      <div
        style={{
          marginTop: 24,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
          gap: 14,
          alignItems: 'stretch',
        }}
        className="kovo-dash-grid"
      >
        <div
          style={{
            background: ds.bgCard,
            border: `1px solid ${ds.borderCard}`,
            borderRadius: 14,
            padding: '18px 20px',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary, marginBottom: 4 }}>Ventas semanales</div>
          <div style={{ fontSize: 11, color: ds.textMuted, marginBottom: 16 }}>Serie principal vs. anterior (demo)</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 160, paddingTop: 8 }}>
            {CHART_WEEKS.map((row) => (
              <div key={row.w} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 120 }}>
                  <div
                    style={{
                      width: '42%',
                      height: `${(row.a / maxBar) * 100}%`,
                      minHeight: 4,
                      background: ds.brand,
                      borderRadius: 6,
                    }}
                  />
                  <div
                    style={{
                      width: '42%',
                      height: `${(row.b / maxBar) * 100}%`,
                      minHeight: 4,
                      background: ds.brandPale,
                      borderRadius: 6,
                    }}
                  />
                </div>
                <span style={{ fontSize: 10, color: ds.textHint }}>{row.w}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 11, color: ds.textMuted }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: ds.brand }} /> Actual
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: ds.brandPale }} /> Anterior
            </span>
          </div>
        </div>

        <div
          style={{
            background: ds.bgCard,
            border: `1px solid ${ds.borderCard}`,
            borderRadius: 14,
            padding: '18px 20px',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary }}>Inventario bajo stock</div>
          <div style={{ fontSize: 11, color: ds.textMuted, marginBottom: 14 }}>Umbrales de ejemplo</div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {DEMO_STOCK.map((p) => (
              <li
                key={p.sku}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 0',
                  borderBottom: `1px solid ${ds.borderRow}`,
                }}
              >
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: ds.textPrimary }}>{p.name}</div>
                  <div style={{ fontSize: 10.5, color: ds.textHint }}>{p.sku}</div>
                </div>
                <StatusBadge variant={p.variant === 'success' ? 'success' : p.variant === 'warning' ? 'warning' : 'error'}>
                  {p.qty} uds
                </StatusBadge>
              </li>
            ))}
          </ul>
          <Link
            to="/inventario"
            style={{
              display: 'inline-block',
              marginTop: 14,
              fontSize: 13,
              fontWeight: 600,
              color: ds.brand,
              textDecoration: 'none',
            }}
          >
            Ver inventario →
          </Link>
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <DataTable
          title="Pedidos recientes"
          subtitle="Últimas transacciones (demo)"
          action={
            <Link to="/pedidos" style={{ fontSize: 13, fontWeight: 600, color: ds.brand, textDecoration: 'none' }}>
              Ver todos →
            </Link>
          }
        >
          <table style={{ ...tableBase, minWidth: 520 }}>
            <thead>
              <tr>
                <Th>Pedido</Th>
                <Th>Cliente</Th>
                <Th>Total</Th>
                <Th>Estado</Th>
              </tr>
            </thead>
            <tbody>
              {DEMO_ORDERS.map((o, i) => (
                <tr key={o.id}>
                  <Td isLast={i === DEMO_ORDERS.length - 1}>
                    <div style={{ fontWeight: 600, fontSize: 12, color: ds.textPrimary }}>{o.id}</div>
                    <div style={{ fontSize: 10.5, color: ds.textHint }}>{o.sub}</div>
                  </Td>
                  <Td isLast={i === DEMO_ORDERS.length - 1}>{o.name}</Td>
                  <Td isLast={i === DEMO_ORDERS.length - 1}>{o.total}</Td>
                  <Td isLast={i === DEMO_ORDERS.length - 1}>
                    <StatusBadge variant={o.status}>{o.label}</StatusBadge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .kovo-dash-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </>
  );
}
