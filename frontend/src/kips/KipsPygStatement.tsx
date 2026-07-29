import { useMemo, type CSSProperties } from 'react';
import { ds } from '../design-system/ds';

export type KipsPygInput = {
  ventasDespachadas: number;
  ventasEntregadas: number;
  pedidosDespachados: number;
  pedidosConfirmados: number;
  pedidosEntregados: number;
  cantidadEntregada: number;
  costoProducto: number;
  costoEnvio: number;
  costoAdmin: number;
  gastoPublicitario: number;
  entregadosPct: number;
  confirmadosPct: number;
  costoProductoUnit: number;
  costoEnvioPedido: number;
  costoAdminPct: number;
  currency: string | null;
};

type PygRow = {
  concepto: string;
  monto: number | null;
  pctBase: number | null;
  sub?: boolean;
  subSub?: boolean;
  total?: boolean;
  final?: boolean;
  negative?: boolean;
  muted?: boolean;
  section?: boolean;
};

function money(n: number | null, currency: string | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const c = (currency || 'USD').trim().toUpperCase();
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: c.length === 3 ? c : 'USD',
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return n.toLocaleString('es-CO', { maximumFractionDigits: 0 });
  }
}

function pctOfBase(part: number | null, base: number): string {
  if (part == null || !Number.isFinite(part) || base <= 0) return '—';
  return `${((part / base) * 100).toFixed(1)}%`;
}

function buildPygRows(data: KipsPygInput): PygRow[] {
  const {
    ventasDespachadas,
    ventasEntregadas,
    pedidosDespachados,
    pedidosConfirmados,
    pedidosEntregados,
    cantidadEntregada,
    costoProducto,
    costoEnvio,
    costoAdmin,
    gastoPublicitario,
    entregadosPct,
    confirmadosPct,
    costoProductoUnit,
    costoEnvioPedido,
    costoAdminPct,
  } = data;

  const costosDirectos = costoProducto + costoEnvio;
  const margenBruto = ventasEntregadas - costosDirectos;
  const gastosOperacionales = gastoPublicitario + costoAdmin;
  const utilidadNeta = ventasEntregadas - costosDirectos - gastosOperacionales;
  const ajusteNoEntregado = ventasDespachadas - ventasEntregadas;

  return [
    { concepto: 'INGRESOS', monto: null, pctBase: null, section: true },
    {
      concepto: 'Ventas despachadas',
      monto: ventasDespachadas,
      pctBase: ventasEntregadas,
      sub: true,
    },
    {
      concepto: `Pedidos despachados (${pedidosDespachados.toLocaleString('es-CO')} u.)`,
      monto: null,
      pctBase: null,
      subSub: true,
      muted: true,
    },
    {
      concepto: `Ajuste por no entregados (${(100 - entregadosPct).toFixed(0)}%)`,
      monto: ajusteNoEntregado > 0 ? -ajusteNoEntregado : 0,
      pctBase: ventasEntregadas,
      sub: true,
      negative: ajusteNoEntregado > 0,
    },
    {
      concepto: `Ventas entregadas (${entregadosPct}% de despachadas)`,
      monto: ventasEntregadas,
      pctBase: ventasEntregadas,
      total: true,
    },
    {
      concepto: `Pedidos confirmados (${confirmadosPct}% · ${Math.round(pedidosConfirmados).toLocaleString('es-CO')} u.)`,
      monto: null,
      pctBase: null,
      sub: true,
      muted: true,
    },
    { concepto: 'COSTOS DIRECTOS', monto: null, pctBase: null, section: true },
    {
      concepto: `Costo del producto (${money(costoProductoUnit, data.currency)}/u × ${Math.round(cantidadEntregada).toLocaleString('es-CO')} u.)`,
      monto: -costoProducto,
      pctBase: ventasEntregadas,
      sub: true,
      negative: true,
    },
    {
      concepto: `Costo de envío (${money(costoEnvioPedido, data.currency)}/ped. × ${Math.round(pedidosEntregados).toLocaleString('es-CO')} ped.)`,
      monto: -costoEnvio,
      pctBase: ventasEntregadas,
      sub: true,
      negative: true,
    },
    {
      concepto: 'Total costos directos',
      monto: -costosDirectos,
      pctBase: ventasEntregadas,
      total: true,
      negative: true,
    },
    {
      concepto: 'Margen bruto',
      monto: margenBruto,
      pctBase: ventasEntregadas,
      total: true,
    },
    { concepto: 'GASTOS OPERACIONALES', monto: null, pctBase: null, section: true },
    {
      concepto: 'Gasto publicitario (Meta Ads)',
      monto: -gastoPublicitario,
      pctBase: ventasEntregadas,
      sub: true,
      negative: true,
    },
    {
      concepto: `Costo administrativo (${costoAdminPct}%)`,
      monto: -costoAdmin,
      pctBase: ventasEntregadas,
      sub: true,
      negative: true,
    },
    {
      concepto: 'Total gastos operacionales',
      monto: -gastosOperacionales,
      pctBase: ventasEntregadas,
      total: true,
      negative: true,
    },
    {
      concepto: 'UTILIDAD NETA',
      monto: utilidadNeta,
      pctBase: ventasEntregadas,
      final: true,
    },
  ];
}

export function KipsPygStatement({
  data,
  periodLabel,
  productLabel,
}: {
  data: KipsPygInput;
  periodLabel: string;
  productLabel?: string;
}) {
  const rows = useMemo(() => buildPygRows(data), [data]);
  const utilidadNeta = useMemo(() => {
    const ingresos = data.ventasEntregadas;
    const egresos = data.costoProducto + data.costoEnvio + data.costoAdmin + data.gastoPublicitario;
    return ingresos - egresos;
  }, [data]);
  const margenNetoPct = data.ventasEntregadas > 0 ? (utilidadNeta / data.ventasEntregadas) * 100 : null;

  return (
    <div style={{ ...cardBase, height: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: ds.textPrimary }}>Estado de PyG</div>
          <div style={{ fontSize: 12, color: ds.textMuted, marginTop: 4 }}>
            {periodLabel}
            {productLabel ? ` · ${productLabel}` : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: ds.textMuted, textTransform: 'uppercase', letterSpacing: '0.3px' }}>
            Utilidad neta
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: utilidadNeta >= 0 ? ds.successText : ds.dangerText,
              lineHeight: 1.2,
            }}
          >
            {money(utilidadNeta, data.currency)}
          </div>
          <div style={{ fontSize: 12, color: ds.textMuted, marginTop: 2 }}>
            Margen {margenNetoPct != null ? `${margenNetoPct.toFixed(1)}%` : '—'} s/ ventas entregadas
          </div>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
          <thead>
            <tr>
              <th style={thStyle}>Concepto</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Monto</th>
              <th style={{ ...thStyle, textAlign: 'right', width: 100 }}>% s/ entregados</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              if (row.section) {
                return (
                  <tr key={`section-${row.concepto}`}>
                    <td
                      colSpan={3}
                      style={{
                        padding: '12px 8px 6px',
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '0.4px',
                        textTransform: 'uppercase',
                        color: ds.textHint,
                        borderTop: idx > 0 ? `1px solid ${ds.borderRow}` : undefined,
                      }}
                    >
                      {row.concepto}
                    </td>
                  </tr>
                );
              }

              const bg = row.final ? ds.brandBg : row.total ? ds.bgSubtle : 'transparent';
              const padLeft = row.subSub ? 28 : row.sub ? 16 : 8;
              const montoColor = row.negative
                ? ds.dangerText
                : row.final
                  ? ds.brand
                  : row.muted
                    ? ds.textMuted
                    : ds.textSecondary;

              return (
                <tr key={`${row.concepto}-${idx}`}>
                  <td
                    style={{
                      padding: '8px',
                      paddingLeft: padLeft,
                      fontSize: row.subSub ? 11 : row.sub ? 12 : 13,
                      fontWeight: row.final ? 800 : row.total ? 700 : 500,
                      color: row.muted ? ds.textMuted : row.final ? ds.brand : ds.textPrimary,
                      background: bg,
                    }}
                  >
                    {row.concepto}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      padding: '8px',
                      fontSize: 13,
                      fontWeight: row.final ? 800 : row.total ? 700 : 600,
                      fontVariantNumeric: 'tabular-nums',
                      color: row.monto == null ? ds.textMuted : montoColor,
                      background: bg,
                    }}
                  >
                    {row.monto == null ? '—' : money(row.monto, data.currency)}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      padding: '8px',
                      fontSize: 12,
                      color: ds.textMuted,
                      background: bg,
                    }}
                  >
                    {row.pctBase != null && row.monto != null ? pctOfBase(Math.abs(row.monto), row.pctBase) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div
        style={{
          marginTop: 14,
          padding: '10px 12px',
          borderRadius: 8,
          background: ds.bgSubtle,
          fontSize: 11,
          color: ds.textMuted,
          lineHeight: 1.5,
        }}
      >
        Producto: {money(data.costoProductoUnit, data.currency)}/u · Envío: {money(data.costoEnvioPedido, data.currency)}
        /ped. · Admin: {data.costoAdminPct}% s/ entregados · Confirmados: {data.confirmadosPct}% · Entregados:{' '}
        {data.entregadosPct}%
      </div>
    </div>
  );
}

const cardBase: CSSProperties = {
  background: ds.bgCard,
  borderRadius: 14,
  padding: '18px 20px',
  border: `1px solid ${ds.borderCard}`,
};

const thStyle: CSSProperties = {
  textAlign: 'left',
  fontSize: 10.5,
  textTransform: 'uppercase',
  letterSpacing: '0.4px',
  color: ds.textHint,
  padding: '10px 8px',
  fontWeight: 600,
  borderBottom: `1px solid ${ds.borderCard}`,
};
