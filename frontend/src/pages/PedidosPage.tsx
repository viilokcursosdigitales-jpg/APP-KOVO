import { useState } from 'react';
import { ds } from '../design-system/ds';
import { DataTable, Th, Td, tableBase } from '../design-system/DataTable';
import { PageHeader } from '../design-system/PageHeader';
import { StatusBadge } from '../design-system/StatusBadge';

const ALL = [
  { id: '#4821', client: 'María G.', email: 'maria@mail.com', date: '11 abr 2026', total: '€ 124,90', st: 'success' as const, lb: 'Completado' },
  { id: '#4820', client: 'Pedro L.', email: 'pedro@mail.com', date: '11 abr 2026', total: '€ 89,00', st: 'info' as const, lb: 'En proceso' },
  { id: '#4819', client: 'Ana R.', email: 'ana@mail.com', date: '10 abr 2026', total: '€ 210,50', st: 'success' as const, lb: 'Completado' },
  { id: '#4818', client: 'Luis M.', email: 'luis@mail.com', date: '10 abr 2026', total: '€ 45,00', st: 'paused' as const, lb: 'Pendiente' },
  { id: '#4817', client: 'Elena S.', email: 'elena@mail.com', date: '09 abr 2026', total: '€ 312,00', st: 'error' as const, lb: 'Cancelado' },
];

export default function PedidosPage() {
  const [filter, setFilter] = useState<'all' | 'active' | 'done'>('all');

  return (
    <>
      <PageHeader
        title="Pedidos"
        subtitle="Listado de pedidos (datos de demostración)."
        right={
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(
              [
                { id: 'all' as const, label: 'Todos' },
                { id: 'active' as const, label: 'Activos' },
                { id: 'done' as const, label: 'Completados' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilter(t.id)}
                style={{
                  padding: '7px 14px',
                  borderRadius: 8,
                  border: `1px solid ${ds.borderCard}`,
                  background: filter === t.id ? ds.brandBg : ds.bgCard,
                  color: filter === t.id ? ds.brand : ds.textSecondary,
                  fontSize: 12,
                  fontWeight: filter === t.id ? 600 : 500,
                  cursor: 'pointer',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      />

      <DataTable title="Todos los pedidos" subtitle={`Mostrando ${ALL.length} resultados · demo`}>
        <table style={{ ...tableBase, minWidth: 640 }}>
          <thead>
            <tr>
              <Th>Pedido</Th>
              <Th>Cliente</Th>
              <Th>Fecha</Th>
              <Th>Total</Th>
              <Th>Estado</Th>
            </tr>
          </thead>
          <tbody>
            {ALL.filter((r) =>
              filter === 'all'
                ? true
                : filter === 'active'
                  ? r.st === 'info' || r.st === 'paused'
                  : r.st === 'success',
            ).map((o, i, arr) => (
              <tr key={o.id}>
                <Td isLast={i === arr.length - 1}>
                  <div style={{ fontWeight: 600, fontSize: 12, color: ds.textPrimary }}>{o.id}</div>
                  <div style={{ fontSize: 10.5, color: ds.textHint }}>{o.email}</div>
                </Td>
                <Td isLast={i === arr.length - 1}>{o.client}</Td>
                <Td isLast={i === arr.length - 1}>{o.date}</Td>
                <Td isLast={i === arr.length - 1}>{o.total}</Td>
                <Td isLast={i === arr.length - 1}>
                  <StatusBadge variant={o.st}>{o.lb}</StatusBadge>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTable>
    </>
  );
}
