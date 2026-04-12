import { ds } from '../design-system/ds';
import { PageHeader } from '../design-system/PageHeader';
import { StatusBadge } from '../design-system/StatusBadge';

const PRODUCTS = [
  { name: 'Crema hidratante', sku: 'SKU-102', stock: 8, price: '€ 24,90' },
  { name: 'Sérum vitamina C', sku: 'SKU-088', stock: 3, price: '€ 32,00' },
  { name: 'Kit rutina PM', sku: 'SKU-201', stock: 42, price: '€ 89,00' },
  { name: 'Protector solar SPF50', sku: 'SKU-310', stock: 0, price: '€ 19,50' },
];

function stockVariant(q: number): 'success' | 'warning' | 'error' {
  if (q === 0) return 'error';
  if (q < 10) return 'warning';
  return 'success';
}

function stockLabel(q: number) {
  if (q === 0) return 'Sin stock';
  if (q < 10) return `Bajo · ${q} uds`;
  return `OK · ${q} uds`;
}

export default function InventarioPage() {
  return (
    <>
      <PageHeader title="Inventario" subtitle="Productos y niveles de stock (demo)." />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 14,
        }}
      >
        {PRODUCTS.map((p) => (
          <div
            key={p.sku}
            style={{
              background: ds.bgCard,
              border: `1px solid ${ds.borderCard}`,
              borderRadius: 14,
              padding: '18px 20px',
            }}
          >
            <div
              style={{
                width: '100%',
                aspectRatio: '4/3',
                borderRadius: 8,
                background: ds.brandBg,
                marginBottom: 12,
              }}
            />
            <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary }}>{p.name}</div>
            <div style={{ fontSize: 11, color: ds.textMuted, marginTop: 4 }}>{p.sku}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: ds.textPrimary, marginTop: 10 }}>{p.price}</div>
            <div style={{ marginTop: 10 }}>
              <StatusBadge variant={stockVariant(p.stock)}>{stockLabel(p.stock)}</StatusBadge>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
