import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ds } from '../../design-system/ds';
import type { PlanVentas } from '../../types/planVentas';
import { MESES_ES } from '../../types/planVentas';

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 700,
  color: ds.textSecondary,
  textTransform: 'uppercase',
  letterSpacing: '0.4px',
  marginBottom: 6,
};

const fieldStyle: CSSProperties = {
  width: '100%',
  marginTop: 4,
  padding: '10px 12px',
  borderRadius: 10,
  border: `1px solid ${ds.borderCard}`,
  background: ds.bgApp,
  color: ds.textPrimary,
  fontSize: 14,
  boxSizing: 'border-box',
};

type ModalNuevoPlanProps = {
  open: boolean;
  planesExistentes: PlanVentas[];
  anioDefecto: number;
  onCerrar: () => void;
  /** Debe lanzar si mes/año duplicado; el padre muestra el error. */
  onCrear: (mes: number, anio: number, duplicarDesdeId: string | null) => Promise<void>;
};

type ModoCreacion = 'cero' | 'duplicar';

export function ModalNuevoPlan({
  open,
  planesExistentes,
  anioDefecto,
  onCerrar,
  onCrear,
}: ModalNuevoPlanProps) {
  const [mes, setMes] = useState(1);
  const [anio, setAnio] = useState(anioDefecto);
  const [modo, setModo] = useState<ModoCreacion>('cero');
  const [duplicarId, setDuplicarId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const aniosOpciones = useMemo(() => {
    const y = anioDefecto;
    return [y - 1, y, y + 1, y + 2];
  }, [anioDefecto]);

  const planesOrdenados = useMemo(
    () =>
      [...planesExistentes].sort((a, b) => {
        if (a.anio !== b.anio) return b.anio - a.anio;
        return b.mes - a.mes;
      }),
    [planesExistentes],
  );

  useEffect(() => {
    if (open) {
      setMes(1);
      setAnio(anioDefecto);
      setModo('cero');
      setDuplicarId('');
      setError(null);
      setEnviando(false);
    }
  }, [open, anioDefecto]);

  if (!open) return null;

  const submit = async () => {
    setError(null);
    setEnviando(true);
    try {
      await onCrear(mes, anio, modo === 'duplicar' && duplicarId ? duplicarId : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el plan.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.18)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        zIndex: 100,
      }}
      role="dialog"
      aria-modal
      aria-labelledby="modal-nuevo-plan-titulo"
      onClick={onCerrar}
    >
      <div
        style={{
          background: ds.bgCard,
          borderRadius: 16,
          padding: 28,
          width: '100%',
          maxWidth: 480,
          border: `1px solid ${ds.borderCard}`,
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="modal-nuevo-plan-titulo"
          style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: ds.textPrimary }}
        >
          Nuevo plan mensual
        </h3>
        <p style={{ margin: '0 0 18px', fontSize: 12, color: ds.textMuted, lineHeight: 1.45 }}>
          Elige mes y año. No puede haber dos planes para el mismo mes.
        </p>

        <label style={labelStyle}>
          Mes
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))} style={fieldStyle}>
            {MESES_ES.map((nombre, i) => (
              <option key={nombre} value={i + 1}>
                {nombre}
              </option>
            ))}
          </select>
        </label>

        <label style={{ ...labelStyle, marginTop: 14 }}>
          Año
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} style={fieldStyle}>
            {aniosOpciones.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>

        <div style={{ marginTop: 18 }}>
          <span style={labelStyle}>Origen</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                color: ds.textSecondary,
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="modo-plan"
                checked={modo === 'cero'}
                onChange={() => setModo('cero')}
                style={{ accentColor: ds.brand }}
              />
              Empezar desde cero (productos de ejemplo)
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                color: ds.textSecondary,
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="modo-plan"
                checked={modo === 'duplicar'}
                onChange={() => setModo('duplicar')}
                style={{ accentColor: ds.brand }}
              />
              Duplicar de un plan existente
            </label>
          </div>
        </div>

        {modo === 'duplicar' ? (
          <label style={{ ...labelStyle, marginTop: 14 }}>
            Plan origen
            <select
              value={duplicarId}
              onChange={(e) => setDuplicarId(e.target.value)}
              style={fieldStyle}
            >
              <option value="">Selecciona un plan…</option>
              {planesOrdenados.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {error ? (
          <p style={{ margin: '14px 0 0', fontSize: 13, color: ds.dangerText }}>{error}</p>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onCerrar}
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: `1px solid ${ds.borderCard}`,
              background: ds.bgSubtle,
              color: ds.textSecondary,
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={enviando || (modo === 'duplicar' && !duplicarId)}
            onClick={() => void submit()}
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: 'none',
              background: ds.brand,
              color: ds.textOnBrand,
              fontWeight: 600,
              fontSize: 13,
              cursor: enviando ? 'wait' : 'pointer',
              opacity: enviando || (modo === 'duplicar' && !duplicarId) ? 0.55 : 1,
            }}
          >
            {enviando ? 'Creando…' : 'Crear'}
          </button>
        </div>
      </div>
    </div>
  );
}
