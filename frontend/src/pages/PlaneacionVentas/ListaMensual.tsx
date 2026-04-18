import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ModalConfirmar } from '../../components/planeacion/ModalConfirmar';
import { ModalDuplicarPlan } from '../../components/planeacion/ModalDuplicarPlan';
import { ModalNuevoPlan } from '../../components/planeacion/ModalNuevoPlan';
import { KPICard } from '../../components/planeacion/KPICard';
import { ds } from '../../design-system/ds';
import {
  IconCalendar,
  IconCopy,
  IconDotsVertical,
  IconPackage,
  IconPlus,
  IconTarget,
  IconTrash,
  IconTrendingUp,
} from '../../design-system/icons';
import { PageHeader } from '../../design-system/PageHeader';
import { usePlanesVentas } from '../../hooks/usePlanesVentas';
import { analizarPlan, formatCop, planSinAlertas } from '../../utils/calculosVentas';
import type { PlanVentas } from '../../types/planVentas';

const anioActual = () => new Date().getFullYear();

export default function ListaMensual() {
  const navigate = useNavigate();
  const { planes, cargando, crearPlan, duplicarPlan, eliminarPlan } = usePlanesVentas();
  const [modalNuevo, setModalNuevo] = useState(false);
  const [eliminarId, setEliminarId] = useState<string | null>(null);
  const [dupOrigen, setDupOrigen] = useState<PlanVentas | null>(null);
  const [menuAbiertoId, setMenuAbiertoId] = useState<string | null>(null);

  const year = anioActual();
  const planesAnio = useMemo(() => planes.filter((p) => p.anio === year), [planes, year]);

  const kpisAnio = useMemo(() => {
    const n = planesAnio.length;
    const utilidadAcum = planesAnio.reduce((s, p) => s + analizarPlan(p).totales.totalUtilidad, 0);
    const promedioMeta = n > 0 ? planesAnio.reduce((s, p) => s + p.meta, 0) / n : 0;
    let top: PlanVentas | null = null;
    for (const p of planesAnio) {
      if (!top || p.meta > top.meta) top = p;
    }
    return {
      n,
      utilidadAcum,
      promedioMeta,
      topLabel: top ? top.nombre : '—',
    };
  }, [planesAnio]);

  const cerrarMenus = () => setMenuAbiertoId(null);

  return (
    <div onClick={cerrarMenus}>
      <PageHeader
        title="Planeación de Ventas"
        subtitle="Planes mensuales, metas por producto y KPIs estimados (persistencia local)."
        right={
          <button
            type="button"
            onClick={() => setModalNuevo(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 16px',
              borderRadius: 10,
              border: 'none',
              background: ds.brand,
              color: ds.textOnBrand,
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            <IconPlus size={16} />
            Nuevo plan
          </button>
        }
      />

      {cargando ? (
        <p style={{ color: ds.textMuted, fontSize: 13 }}>Cargando planes…</p>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 14,
              marginBottom: 28,
            }}
          >
            <KPICard
              variant="conversion"
              label={`Planes ${year}`}
              value={kpisAnio.n}
              icon={<IconCalendar />}
            />
            <KPICard
              variant="sales"
              label="Utilidad proyectada (año)"
              value={formatCop(kpisAnio.utilidadAcum)}
              icon={<IconTrendingUp />}
            />
            <KPICard
              variant="traffic"
              label="Promedio meta mensual"
              value={formatCop(kpisAnio.promedioMeta)}
              icon={<IconTarget />}
            />
            <KPICard
              variant="stock"
              label="Mes con mayor meta"
              value={kpisAnio.topLabel}
              icon={<IconPackage />}
            />
          </div>

          {planes.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '48px 20px',
                borderRadius: 16,
                border: `1px dashed ${ds.borderCard}`,
                background: ds.bgCard,
              }}
            >
              <p style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600, color: ds.textPrimary }}>
                Aún no tienes planes guardados
              </p>
              <p style={{ margin: '0 0 22px', fontSize: 13, color: ds.textMuted, maxWidth: 420, marginInline: 'auto' }}>
                Crea tu primer plan para un mes: define meta, productos y embudo; los KPIs se calculan solos.
              </p>
              <button
                type="button"
                onClick={() => setModalNuevo(true)}
                style={{
                  padding: '14px 28px',
                  borderRadius: 12,
                  border: 'none',
                  background: ds.brand,
                  color: ds.textOnBrand,
                  fontWeight: 700,
                  fontSize: 15,
                  cursor: 'pointer',
                }}
              >
                Crear primer plan
              </button>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: 16,
              }}
            >
              {planes.map((plan) => {
                const a = analizarPlan(plan);
                const ok = planSinAlertas(a);
                return (
                  <div
                    key={plan.id}
                    style={{
                      position: 'relative',
                      background: ds.bgCard,
                      border: `1px solid ${ds.borderCard}`,
                      borderRadius: 14,
                      padding: '16px 18px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: ds.textPrimary }}>{plan.nombre}</div>
                        <div style={{ fontSize: 12, color: ds.textMuted, marginTop: 4 }}>
                          Meta: {formatCop(plan.meta)}{' '}
                          {plan.tipoMeta === 'utilidad' ? 'utilidad' : 'facturación'}
                        </div>
                        <div style={{ fontSize: 12, color: ds.textMuted, marginTop: 2 }}>
                          {plan.productos.length} producto{plan.productos.length === 1 ? '' : 's'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          title={ok ? 'Sin alertas' : 'Revisar distribución, márgenes o presupuesto de ads'}
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 999,
                            background: ok ? ds.successText : ds.warningText,
                            flexShrink: 0,
                          }}
                        />
                        <div style={{ position: 'relative' }}>
                          <button
                            type="button"
                            aria-label="Acciones"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuAbiertoId((id) => (id === plan.id ? null : plan.id));
                            }}
                            style={{
                              padding: 6,
                              borderRadius: 8,
                              border: `1px solid ${ds.borderCard}`,
                              background: ds.bgSubtle,
                              cursor: 'pointer',
                              color: ds.textMuted,
                              display: 'flex',
                            }}
                          >
                            <IconDotsVertical />
                          </button>
                          {menuAbiertoId === plan.id ? (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                position: 'absolute',
                                right: 0,
                                top: '100%',
                                marginTop: 6,
                                minWidth: 160,
                                background: ds.bgCard,
                                border: `1px solid ${ds.borderCard}`,
                                borderRadius: 10,
                                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                                zIndex: 5,
                                padding: 6,
                              }}
                            >
                              <Link
                                to={`/planeacion-ventas/${plan.id}`}
                                onClick={cerrarMenus}
                                style={{
                                  display: 'block',
                                  padding: '8px 10px',
                                  borderRadius: 8,
                                  color: ds.textPrimary,
                                  textDecoration: 'none',
                                  fontSize: 13,
                                  fontWeight: 500,
                                }}
                              >
                                Abrir
                              </Link>
                              <button
                                type="button"
                                onClick={() => {
                                  cerrarMenus();
                                  setDupOrigen(plan);
                                }}
                                style={{
                                  width: '100%',
                                  textAlign: 'left',
                                  padding: '8px 10px',
                                  borderRadius: 8,
                                  border: 'none',
                                  background: 'transparent',
                                  cursor: 'pointer',
                                  fontSize: 13,
                                  color: ds.textPrimary,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                }}
                              >
                                <IconCopy size={14} />
                                Duplicar
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  cerrarMenus();
                                  setEliminarId(plan.id);
                                }}
                                style={{
                                  width: '100%',
                                  textAlign: 'left',
                                  padding: '8px 10px',
                                  borderRadius: 8,
                                  border: 'none',
                                  background: 'transparent',
                                  cursor: 'pointer',
                                  fontSize: 13,
                                  color: ds.dangerText,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                }}
                              >
                                <IconTrash size={14} />
                                Eliminar
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        marginTop: 14,
                        paddingTop: 12,
                        borderTop: `1px solid ${ds.borderRow}`,
                        fontSize: 13,
                        fontWeight: 600,
                        color: ds.textSecondary,
                      }}
                    >
                      Utilidad proyectada:{' '}
                      <span style={{ color: ds.textPrimary }}>{formatCop(a.totales.totalUtilidad)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <ModalNuevoPlan
        open={modalNuevo}
        planesExistentes={planes}
        anioDefecto={year}
        onCerrar={() => setModalNuevo(false)}
        onCrear={async (mes, anio, duplicarDesdeId) => {
          const nuevo = await crearPlan(mes, anio, duplicarDesdeId ? { duplicarDesdeId } : undefined);
          setModalNuevo(false);
          navigate(`/planeacion-ventas/${nuevo.id}`);
        }}
      />

      <ModalDuplicarPlan
        open={Boolean(dupOrigen)}
        nombreOrigen={dupOrigen?.nombre ?? ''}
        anioDefecto={year}
        onCerrar={() => setDupOrigen(null)}
        onDuplicar={async (mes, anio) => {
          if (!dupOrigen) return;
          const nuevo = await duplicarPlan(dupOrigen.id, mes, anio);
          setDupOrigen(null);
          navigate(`/planeacion-ventas/${nuevo.id}`);
        }}
      />

      <ModalConfirmar
        open={Boolean(eliminarId)}
        titulo="Eliminar plan"
        mensaje="Se borrará este plan del almacenamiento local. Esta acción no se puede deshacer."
        etiquetaConfirmar="Eliminar"
        peligro
        onCancelar={() => setEliminarId(null)}
        onConfirmar={() => {
          if (eliminarId) void eliminarPlan(eliminarId).then(() => setEliminarId(null));
        }}
      />
    </div>
  );
}
