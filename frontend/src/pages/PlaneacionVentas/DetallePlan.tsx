import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ModalConfirmar } from '../../components/planeacion/ModalConfirmar';
import { KPICard } from '../../components/planeacion/KPICard';
import { ProductoCard } from '../../components/planeacion/ProductoCard';
import { DataTable, Td, Th, tableBase } from '../../design-system/DataTable';
import { ds } from '../../design-system/ds';
import {
  IconCalendar,
  IconMegaphone,
  IconPackage,
  IconPencil,
  IconTarget,
  IconTrendingUp,
} from '../../design-system/icons';
import { usePlanesVentas } from '../../hooks/usePlanesVentas';
import { etiquetaMesAnio, type PlanVentas, type ProductoPlan } from '../../types/planVentas';
import {
  analizarPlan,
  diasEnMes,
  formatCop,
  mergePlanYObjetivosRoas,
  planSinAlertas,
  sincronizarPresupuestoSiObjetivosRoas,
  tieneObjetivosRoas,
} from '../../utils/calculosVentas';

const COLORES_BORDE = [
  ds.brand,
  ds.successText,
  'var(--kpi-traffic-icon)',
  ds.warningText,
  ds.infoText,
  ds.dangerText,
];

const fieldStyle: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 10,
  border: `1px solid ${ds.borderCard}`,
  background: ds.bgApp,
  color: ds.textPrimary,
  fontSize: 14,
  boxSizing: 'border-box',
};

function fmtFecha(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Misma lógica que las tarjetas KPI: techo de la media mensual ÷ días del mes. */
function pedidosPorDiaEstimado(total: number, diasMes: number): number {
  const d = Math.max(1, diasMes);
  return Math.max(0, Math.ceil(total / d));
}

function dineroPorDiaEstimado(total: number, diasMes: number): string {
  const d = Math.max(1, diasMes);
  return formatCop(Math.round(total / d));
}

function fmtRoasEmbudo(presupuestoAds: number, roas: number): string {
  return presupuestoAds > 0 ? `${roas.toFixed(2)}×` : '—';
}

function fmtCpaEmbudo(v: number | null): string {
  return v != null && Number.isFinite(v) ? formatCop(v) : '—';
}

function parseRoasObjetivoInput(raw: string): number | undefined {
  const t = raw.trim();
  if (t === '') return undefined;
  const parsed = Number(t.replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

export default function DetallePlan() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { obtenerPlan, actualizarPlan, eliminarPlan } = usePlanesVentas();
  const [draft, setDraft] = useState<PlanVentas | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [guardandoManual, setGuardandoManual] = useState(false);
  const [msgGuardado, setMsgGuardado] = useState<string | null>(null);
  const [confirmEliminar, setConfirmEliminar] = useState(false);
  const [expandido, setExpandido] = useState<Record<string, boolean>>({});
  const lastSavedJson = useRef<string>('');

  const cargar = useCallback(async () => {
    if (!id) return;
    setCargando(true);
    setErrorCarga(null);
    try {
      const p = await obtenerPlan(id);
      if (!p) {
        navigate('/planeacion-ventas', { replace: true });
        return;
      }
      const json = JSON.stringify(p);
      lastSavedJson.current = json;
      setDraft(p);
      const nextExp: Record<string, boolean> = {};
      for (const pr of p.productos) nextExp[pr.id] = true;
      setExpandido(nextExp);
    } catch (e) {
      setErrorCarga(e instanceof Error ? e.message : 'Error al cargar');
    } finally {
      setCargando(false);
    }
  }, [id, navigate, obtenerPlan]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const analisis = useMemo(() => (draft ? analizarPlan(draft) : null), [draft]);
  const diasMesNatural = draft ? diasEnMes(draft.anio, draft.mes) : 30;
  const diasCalculo =
    draft != null
      ? Math.min(
          Math.max(
            1,
            draft.diasCalculo != null &&
              Number.isFinite(Number(draft.diasCalculo)) &&
              Number(draft.diasCalculo) > 0
              ? Math.round(Number(draft.diasCalculo))
              : diasMesNatural,
          ),
          diasMesNatural,
        )
      : 30;

  const filasKpisDiarios = useMemo(() => {
    if (!draft || !analisis) return [];
    const d = Math.max(1, diasCalculo);
    const t = analisis.totales;
    return [
      {
        label: 'Pedidos meta / día (estim.)',
        value: pedidosPorDiaEstimado(t.totalPedidosMeta, d).toLocaleString('es-CO'),
      },
      {
        label: 'Pedidos confirmados / día (estim.)',
        value: pedidosPorDiaEstimado(t.totalPedidosConfirmados, d).toLocaleString('es-CO'),
      },
      {
        label: 'Pedidos entregados / día (estim.)',
        value: pedidosPorDiaEstimado(t.totalPedidosEntregados, d).toLocaleString('es-CO'),
      },
      { label: 'Facturación / día (estim.)', value: dineroPorDiaEstimado(t.totalFacturacion, d) },
      { label: 'Utilidad / día (estim.)', value: dineroPorDiaEstimado(t.totalUtilidad, d) },
      { label: 'Presupuesto ads / día (referencia)', value: dineroPorDiaEstimado(draft.presupuestoAds, d) },
      {
        label: 'Inversión ads objetivo / día (estim.)',
        value: dineroPorDiaEstimado(t.totalInversionAdsObjetivo, d),
      },
      {
        label: 'ROAS publicidad (fact. meta / presup. ads)',
        value: fmtRoasEmbudo(draft.presupuestoAds, t.roasPublicidad),
      },
      {
        label: 'ROAS confirmados (fact. confirm. / presup. ads)',
        value: fmtRoasEmbudo(draft.presupuestoAds, t.roasConfirmados),
      },
      {
        label: 'ROAS entregados (fact. entreg. / presup. ads)',
        value: fmtRoasEmbudo(draft.presupuestoAds, t.roasEntregados),
      },
      { label: 'CPA publicidad (ads ÷ pedidos meta)', value: fmtCpaEmbudo(t.cpaPublicidad) },
      { label: 'CPA confirmados (ads ÷ pedidos confirm.)', value: fmtCpaEmbudo(t.cpaConfirmados) },
      { label: 'CPA entregados (ads ÷ pedidos entreg.)', value: fmtCpaEmbudo(t.cpaEntregados) },
    ];
  }, [draft, analisis, diasCalculo]);

  useEffect(() => {
    if (!draft || !id) return;
    const json = JSON.stringify(draft);
    if (json === lastSavedJson.current) return;
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const saved = await actualizarPlan(draft.id, draft);
          lastSavedJson.current = JSON.stringify(saved);
          setDraft(saved);
          setMsgGuardado('Guardado');
          window.setTimeout(() => setMsgGuardado(null), 1500);
        } catch (e) {
          setMsgGuardado(e instanceof Error ? e.message : 'Error al guardar');
        }
      })();
    }, 500);
    return () => window.clearTimeout(handle);
  }, [draft, actualizarPlan, id]);

  const guardarAhora = async () => {
    if (!draft) return;
    setGuardandoManual(true);
    setMsgGuardado(null);
    try {
      const saved = await actualizarPlan(draft.id, draft);
      lastSavedJson.current = JSON.stringify(saved);
      setDraft(saved);
      setMsgGuardado('Guardado');
      window.setTimeout(() => setMsgGuardado(null), 1500);
    } catch (e) {
      setMsgGuardado(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      setGuardandoManual(false);
    }
  };

  const actualizarCampo = (patch: Partial<PlanVentas>) => {
    setDraft((d) => (d ? mergePlanYObjetivosRoas(d, patch) : d));
  };

  const actualizarProducto = (idx: number, patch: Partial<ProductoPlan>) => {
    setDraft((d) => {
      if (!d) return d;
      const productos = [...d.productos];
      productos[idx] = { ...productos[idx], ...patch };
      return sincronizarPresupuestoSiObjetivosRoas({ ...d, productos });
    });
  };

  const quitarProducto = (idx: number) => {
    setDraft((d) => {
      if (!d) return d;
      const productos = d.productos.filter((_, i) => i !== idx);
      return sincronizarPresupuestoSiObjetivosRoas({ ...d, productos });
    });
  };

  const agregarProducto = () => {
    setDraft((d) => {
      if (!d) return d;
      const nuevo: ProductoPlan = {
        id: crypto.randomUUID(),
        nombre: 'Nuevo producto',
        precioVenta: 50000,
        margenBrutoPct: 30,
        tasaConfirmacion: 20,
        tasaEntrega: 80,
        distribucionVentas: 0,
      };
      return sincronizarPresupuestoSiObjetivosRoas({ ...d, productos: [...d.productos, nuevo] });
    });
  };

  if (cargando || !draft || !analisis) {
    return (
      <div>
        <Link
          to="/planeacion-ventas"
          style={{ fontSize: 13, color: ds.brand, textDecoration: 'none', fontWeight: 600 }}
        >
          ← Volver a la lista
        </Link>
        <p style={{ marginTop: 20, color: ds.textMuted }}>{errorCarga || 'Cargando plan…'}</p>
      </div>
    );
  }

  const a = analisis;
  const ok = planSinAlertas(a);
  const distTotal = a.validacion.distribucionTotal;
  const mensajeSemaforo = ok
    ? 'El plan cuadra: distribución al 100%, márgenes positivos y presupuesto de ads cubre la inversión objetivo agregada.'
    : [
        !a.validacion.distribucionValida
          ? `Distribución en ${distTotal.toFixed(1)}% (debe sumar 100%).`
          : null,
        a.validacion.algunProductoInviable ? 'Hay productos con margen antes de ads no viable.' : null,
        a.validacion.adsInsuficiente ? 'El presupuesto de ads está por debajo de la inversión objetivo sumada.' : null,
      ]
        .filter(Boolean)
        .join(' ');

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Link
          to="/planeacion-ventas"
          style={{ fontSize: 13, color: ds.brand, textDecoration: 'none', fontWeight: 600 }}
        >
          ← Planeación de Ventas
        </Link>
        <span style={{ color: ds.textHint, margin: '0 8px' }}>/</span>
        <span style={{ fontSize: 13, color: ds.textMuted }}>{draft.nombre}</span>
      </div>

      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 20,
        }}
      >
        <div style={{ flex: '1 1 240px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ color: ds.textMuted, display: 'flex' }}>
              <IconPencil size={18} />
            </span>
            <input
              type="text"
              value={draft.nombre}
              onChange={(e) => actualizarCampo({ nombre: e.target.value })}
              style={{
                ...fieldStyle,
                fontSize: 20,
                fontWeight: 700,
                maxWidth: 420,
              }}
            />
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 12, color: ds.textMuted }}>
            Última actualización: {fmtFecha(draft.actualizadoEn)}
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          {msgGuardado ? (
            <span style={{ fontSize: 12, color: msgGuardado === 'Guardado' ? ds.successText : ds.dangerText }}>
              {msgGuardado}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void guardarAhora()}
            disabled={guardandoManual}
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: 'none',
              background: ds.brand,
              color: ds.textOnBrand,
              fontWeight: 600,
              fontSize: 13,
              cursor: guardandoManual ? 'wait' : 'pointer',
            }}
          >
            {guardandoManual ? 'Guardando…' : 'Guardar'}
          </button>
          <button
            type="button"
            onClick={() => setConfirmEliminar(true)}
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: `1px solid ${ds.borderCard}`,
              background: ds.dangerBg,
              color: ds.dangerText,
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Eliminar
          </button>
        </div>
      </header>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          padding: '14px 16px',
          borderRadius: 12,
          border: `1px solid ${ds.borderCard}`,
          background: ok ? ds.successBg : ds.warningBg,
          marginBottom: 22,
        }}
      >
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: 999,
            marginTop: 3,
            flexShrink: 0,
            background: ok ? ds.successText : ds.warningText,
          }}
        />
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: ds.textPrimary, marginBottom: 4 }}>
            {ok ? 'Plan viable' : 'Alertas en el plan'}
          </div>
          <div style={{ fontSize: 13, color: ds.textSecondary, lineHeight: 1.45 }}>{mensajeSemaforo}</div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 14,
          marginBottom: 22,
        }}
      >
        <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 14, padding: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: ds.textMuted, marginBottom: 10, textTransform: 'uppercase' }}>
            Meta mensual
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {(['utilidad', 'facturacion'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => actualizarCampo({ tipoMeta: t })}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: `1px solid ${draft.tipoMeta === t ? ds.brand : ds.borderCard}`,
                  background: draft.tipoMeta === t ? ds.brandBg : ds.bgSubtle,
                  color: draft.tipoMeta === t ? ds.brand : ds.textSecondary,
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {t === 'utilidad' ? 'Utilidad' : 'Facturación'}
              </button>
            ))}
          </div>
          <input
            type="number"
            min={0}
            value={draft.meta || ''}
            onChange={(e) => actualizarCampo({ meta: Number(e.target.value) || 0 })}
            style={fieldStyle}
          />
        </div>
        <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 14, padding: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: ds.textMuted, marginBottom: 10, textTransform: 'uppercase' }}>
            Gastos generales (% admin)
          </div>
          <input
            type="number"
            min={0}
            value={draft.gastosAdminPct || ''}
            onChange={(e) => actualizarCampo({ gastosAdminPct: Number(e.target.value) || 0 })}
            style={fieldStyle}
          />
        </div>
        <div style={{ background: ds.bgCard, border: `1px solid ${ds.borderCard}`, borderRadius: 14, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: ds.textMuted, textTransform: 'uppercase' }}>
              Presupuesto ads
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '4px 8px',
                borderRadius: 8,
                background: a.totales.adsSuficiente ? ds.successBg : ds.warningBg,
                color: a.totales.adsSuficiente ? ds.successText : ds.warningText,
              }}
            >
              {a.totales.adsSuficiente ? 'Suficiente' : 'Ajustar'}
            </span>
          </div>
          <input
            type="number"
            min={0}
            value={draft.presupuestoAds || ''}
            onChange={(e) => actualizarCampo({ presupuestoAds: Number(e.target.value) || 0 })}
            style={{ ...fieldStyle, marginTop: 10 }}
          />
          <p style={{ margin: '10px 0 0', fontSize: 11, color: ds.textHint, lineHeight: 1.4 }}>
            Inversión objetivo sumada: {formatCop(a.totales.totalInversionAdsObjetivo)}
          </p>
        </div>
      </div>

      <div
        style={{
          marginBottom: 22,
          padding: '14px 16px',
          borderRadius: 12,
          border: `1px solid ${ds.borderCard}`,
          background: ds.bgCard,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: ds.textMuted,
            marginBottom: 8,
            textTransform: 'uppercase',
            letterSpacing: '0.3px',
          }}
        >
          Base para promedios «por día»
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: ds.textSecondary, lineHeight: 1.45, maxWidth: 720 }}>
          Los totales del mes se dividen entre los días que indiques (p. ej. 22 laborables). No cambia la meta ni los
          pedidos del plan; solo ajusta la referencia diaria y la tabla de KPIs diarios.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: ds.textSecondary, display: 'flex', alignItems: 'center', gap: 8 }}>
            Días
            <input
              type="number"
              min={1}
              max={diasMesNatural}
              value={diasCalculo}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!Number.isFinite(n)) return;
                actualizarCampo({ diasCalculo: Math.min(Math.max(1, n), diasMesNatural) });
              }}
              style={{ ...fieldStyle, width: 88, marginTop: 0 }}
            />
          </label>
          <span style={{ fontSize: 12, color: ds.textMuted }}>
            de {diasMesNatural} en {etiquetaMesAnio(draft.mes, draft.anio)}
          </span>
          <button
            type="button"
            onClick={() => actualizarCampo({ diasCalculo: diasMesNatural })}
            style={{
              padding: '8px 14px',
              borderRadius: 10,
              border: `1px solid ${ds.borderCard}`,
              background: diasCalculo === diasMesNatural ? ds.brandBg : ds.bgSubtle,
              color: diasCalculo === diasMesNatural ? ds.brand : ds.textSecondary,
              fontWeight: 600,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Todo el mes
          </button>
        </div>
      </div>

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
          label="Pedidos meta / mes"
          value={
            <>
              {a.totales.totalPedidosMeta.toLocaleString('es-CO')}
              <span style={{ fontSize: 13, fontWeight: 500, color: ds.textMuted, marginLeft: 6 }}>
                (~{Math.max(1, Math.ceil(a.totales.totalPedidosMeta / diasCalculo))}/día)
              </span>
            </>
          }
          icon={<IconTarget />}
        />
        <KPICard
          variant="traffic"
          label="Entregados / mes"
          value={
            <>
              {a.totales.totalPedidosEntregados.toLocaleString('es-CO')}
              <span style={{ fontSize: 13, fontWeight: 500, color: ds.textMuted, marginLeft: 6 }}>
                (~{Math.max(1, Math.ceil(a.totales.totalPedidosEntregados / diasCalculo))}/día)
              </span>
            </>
          }
          icon={<IconPackage />}
        />
        <KPICard
          variant="sales"
          label="Facturación total"
          value={formatCop(a.totales.totalFacturacion)}
          icon={<IconTrendingUp />}
        />
        <KPICard
          variant="spend"
          label="Utilidad proyectada · ROAS entregados"
          value={
            <>
              {formatCop(a.totales.totalUtilidad)}
              <span style={{ fontSize: 13, fontWeight: 500, color: ds.textMuted, marginLeft: 8 }}>
                ROAS {fmtRoasEmbudo(draft.presupuestoAds, a.totales.roasEntregados)}
              </span>
            </>
          }
          icon={<IconCalendar />}
        />
      </div>

      <section style={{ marginBottom: 28 }}>
        <h2
          style={{
            margin: '0 0 6px',
            fontSize: 15,
            fontWeight: 700,
            color: ds.textPrimary,
          }}
        >
          Publicidad: ROAS y CPA por etapa del embudo
        </h2>
        <p style={{ margin: '0 0 14px', fontSize: 12, color: ds.textMuted, lineHeight: 1.45, maxWidth: 720 }}>
          ROAS = facturación estimada en cada etapa ÷ presupuesto publicitario del mes. CPA = presupuesto ads ÷
          pedidos de esa etapa (costo por pedido a nivel meta, confirmado o entregado).
        </p>
        <div
          style={{
            marginBottom: 16,
            padding: '14px 16px',
            borderRadius: 12,
            border: `1px solid ${ds.borderCard}`,
            background: ds.bgSubtle,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: ds.textMuted,
              marginBottom: 8,
              textTransform: 'uppercase',
              letterSpacing: '0.3px',
            }}
          >
            Objetivos ROAS (opcional)
          </div>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: ds.textSecondary, lineHeight: 1.45, maxWidth: 720 }}>
            Indica el ROAS mínimo que quieres en cada etapa. Si defines al menos uno, el presupuesto de ads se recalcula
            como el menor gasto que cumple todas las cotas (facturación de la etapa ÷ ROAS objetivo). Si editas el
            presupuesto de ads a mano, se desactivan estos objetivos.
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 12,
              marginBottom: 12,
            }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 600, color: ds.textSecondary }}>
              ROAS meta (publicidad)
              <input
                type="number"
                min={0.01}
                step="0.01"
                placeholder={draft.presupuestoAds > 0 ? a.totales.roasPublicidad.toFixed(2) : '—'}
                value={draft.roasObjetivoMeta ?? ''}
                onChange={(e) =>
                  actualizarCampo({ roasObjetivoMeta: parseRoasObjetivoInput(e.target.value) })
                }
                style={fieldStyle}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 600, color: ds.textSecondary }}>
              ROAS confirmados
              <input
                type="number"
                min={0.01}
                step="0.01"
                placeholder={draft.presupuestoAds > 0 ? a.totales.roasConfirmados.toFixed(2) : '—'}
                value={draft.roasObjetivoConfirmados ?? ''}
                onChange={(e) =>
                  actualizarCampo({ roasObjetivoConfirmados: parseRoasObjetivoInput(e.target.value) })
                }
                style={fieldStyle}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 600, color: ds.textSecondary }}>
              ROAS entregados
              <input
                type="number"
                min={0.01}
                step="0.01"
                placeholder={draft.presupuestoAds > 0 ? a.totales.roasEntregados.toFixed(2) : '—'}
                value={draft.roasObjetivoEntregados ?? ''}
                onChange={(e) =>
                  actualizarCampo({ roasObjetivoEntregados: parseRoasObjetivoInput(e.target.value) })
                }
                style={fieldStyle}
              />
            </label>
          </div>
          {tieneObjetivosRoas(draft) ? (
            <button
              type="button"
              onClick={() =>
                actualizarCampo({
                  roasObjetivoMeta: undefined,
                  roasObjetivoConfirmados: undefined,
                  roasObjetivoEntregados: undefined,
                })
              }
              style={{
                padding: '8px 14px',
                borderRadius: 10,
                border: `1px solid ${ds.borderCard}`,
                background: ds.bgCard,
                color: ds.textSecondary,
                fontWeight: 600,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Quitar objetivos ROAS
            </button>
          ) : null}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 14,
          }}
        >
          <KPICard
            variant="spend"
            label="ROAS publicidad (meta)"
            value={fmtRoasEmbudo(draft.presupuestoAds, a.totales.roasPublicidad)}
            icon={<IconMegaphone />}
            badge={
              <span style={{ fontSize: 10, color: ds.textHint, fontWeight: 500 }}>
                Fact. meta {formatCop(a.totales.totalFacturacionMeta)}
              </span>
            }
          />
          <KPICard
            variant="conversion"
            label="ROAS confirmados"
            value={fmtRoasEmbudo(draft.presupuestoAds, a.totales.roasConfirmados)}
            icon={<IconTarget />}
            badge={
              <span style={{ fontSize: 10, color: ds.textHint, fontWeight: 500 }}>
                Fact. {formatCop(a.totales.totalFacturacionConfirmados)}
              </span>
            }
          />
          <KPICard
            variant="sales"
            label="ROAS entregados"
            value={fmtRoasEmbudo(draft.presupuestoAds, a.totales.roasEntregados)}
            icon={<IconTrendingUp />}
            badge={
              <span style={{ fontSize: 10, color: ds.textHint, fontWeight: 500 }}>
                Fact. {formatCop(a.totales.totalFacturacion)}
              </span>
            }
          />
          <KPICard
            variant="spend"
            label="CPA publicidad (meta)"
            value={fmtCpaEmbudo(a.totales.cpaPublicidad)}
            icon={<IconMegaphone />}
          />
          <KPICard
            variant="conversion"
            label="CPA confirmados"
            value={fmtCpaEmbudo(a.totales.cpaConfirmados)}
            icon={<IconTarget />}
          />
          <KPICard
            variant="traffic"
            label="CPA entregados"
            value={fmtCpaEmbudo(a.totales.cpaEntregados)}
            icon={<IconPackage />}
          />
        </div>
      </section>

      <section style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: ds.textPrimary }}>Productos</h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: ds.textMuted }}>
              {draft.productos.length} línea{draft.productos.length === 1 ? '' : 's'} · Distribución total:{' '}
              <strong style={{ color: a.validacion.distribucionValida ? ds.successText : ds.warningText }}>
                {distTotal.toFixed(1)}%
              </strong>
            </p>
          </div>
          <button
            type="button"
            onClick={agregarProducto}
            style={{
              padding: '8px 14px',
              borderRadius: 10,
              border: `1px solid ${ds.borderCard}`,
              background: ds.bgSubtle,
              color: ds.textPrimary,
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            + Agregar producto
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            height: 12,
            borderRadius: 8,
            overflow: 'hidden',
            marginBottom: 16,
            border: `1px solid ${ds.borderCard}`,
          }}
        >
          {draft.productos.map((p, i) => (
            <div
              key={p.id}
              title={`${p.nombre}: ${p.distribucionVentas}%`}
              style={{
                width: `${Math.max(0, p.distribucionVentas)}%`,
                background: COLORES_BORDE[i % COLORES_BORDE.length],
                opacity: 0.85,
              }}
            />
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {draft.productos.map((p, i) => (
            <ProductoCard
              key={p.id}
              producto={p}
              colorBorde={COLORES_BORDE[i % COLORES_BORDE.length]}
              expandido={Boolean(expandido[p.id])}
              onToggle={() => setExpandido((ex) => ({ ...ex, [p.id]: !ex[p.id] }))}
              onChange={(patch) => actualizarProducto(i, patch)}
              onEliminar={() => quitarProducto(i)}
            />
          ))}
        </div>
      </section>

      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: ds.textMuted, textTransform: 'uppercase' }}>
          Notas
        </label>
        <textarea
          value={draft.notas ?? ''}
          onChange={(e) => actualizarCampo({ notas: e.target.value })}
          rows={3}
          style={{ ...fieldStyle, marginTop: 8, resize: 'vertical' }}
        />
      </div>

      <DataTable title="Tabla comparativa" subtitle="Métricas por producto (recalculadas en vivo)">
        <table style={tableBase}>
          <thead>
            <tr>
              <Th>Producto</Th>
              <Th style={{ textAlign: 'right' }}>Distrib. %</Th>
              <Th style={{ textAlign: 'right' }}>Pedidos meta</Th>
              <Th style={{ textAlign: 'right' }}>Confirmados</Th>
              <Th style={{ textAlign: 'right' }}>Entregados</Th>
              <Th style={{ textAlign: 'right' }}>Facturación</Th>
              <Th style={{ textAlign: 'right' }}>Utilidad</Th>
              <Th style={{ textAlign: 'right' }}>CPA obj.</Th>
            </tr>
          </thead>
          <tbody>
            {a.productos.map((pc, row) => (
              <tr key={pc.id}>
                <Td isLast={false}>{pc.nombre}</Td>
                <Td isLast={false} style={{ textAlign: 'right' }}>
                  {pc.distribucionVentas}%
                </Td>
                <Td isLast={false} style={{ textAlign: 'right' }}>
                  {pc.pedidosMeta.toLocaleString('es-CO')}
                </Td>
                <Td isLast={false} style={{ textAlign: 'right' }}>
                  {pc.pedidosConfirmados.toLocaleString('es-CO')}
                </Td>
                <Td isLast={false} style={{ textAlign: 'right' }}>
                  {pc.pedidosEntregados.toLocaleString('es-CO')}
                </Td>
                <Td isLast={false} style={{ textAlign: 'right' }}>
                  {formatCop(pc.facturacion)}
                </Td>
                <Td isLast={false} style={{ textAlign: 'right' }}>
                  {formatCop(pc.utilidadTotal)}
                </Td>
                <Td isLast={row === a.productos.length - 1} style={{ textAlign: 'right' }}>
                  {formatCop(pc.cpaObjetivo)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTable>

      <div style={{ marginTop: 24 }}>
        <DataTable
          title="KPIs diarios estimados"
          subtitle={`Totales del plan repartidos en ${diasCalculo} día${diasCalculo === 1 ? '' : 's'} (máx. ${diasMesNatural} en el mes; referencia lineal).`}
        >
          <table style={tableBase}>
            <thead>
              <tr>
                <Th>Indicador</Th>
                <Th style={{ textAlign: 'right' }}>Valor</Th>
              </tr>
            </thead>
            <tbody>
              {filasKpisDiarios.map((fila, idx) => (
                <tr key={fila.label}>
                  <Td isLast={false}>{fila.label}</Td>
                  <Td isLast={idx === filasKpisDiarios.length - 1} style={{ textAlign: 'right', fontWeight: 600 }}>
                    {fila.value}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      </div>

      <ModalConfirmar
        open={confirmEliminar}
        titulo="Eliminar plan"
        mensaje="Se eliminará este plan del almacenamiento local."
        etiquetaConfirmar="Eliminar"
        peligro
        onCancelar={() => setConfirmEliminar(false)}
        onConfirmar={() => {
          void eliminarPlan(draft.id).then(() => navigate('/planeacion-ventas', { replace: true }));
        }}
      />
    </div>
  );
}
