import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ds } from '../../design-system/ds';
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

type ModalDuplicarPlanProps = {
  open: boolean;
  nombreOrigen: string;
  anioDefecto: number;
  onCerrar: () => void;
  onDuplicar: (mes: number, anio: number) => Promise<void>;
};

export function ModalDuplicarPlan({
  open,
  nombreOrigen,
  anioDefecto,
  onCerrar,
  onDuplicar,
}: ModalDuplicarPlanProps) {
  const [mes, setMes] = useState(1);
  const [anio, setAnio] = useState(anioDefecto);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const aniosOpciones = useMemo(() => {
    const y = anioDefecto;
    return [y - 1, y, y + 1, y + 2];
  }, [anioDefecto]);

  useEffect(() => {
    if (open) {
      setMes(1);
      setAnio(anioDefecto);
      setError(null);
      setEnviando(false);
    }
  }, [open, anioDefecto]);

  if (!open) return null;

  const submit = async () => {
    setError(null);
    setEnviando(true);
    try {
      await onDuplicar(mes, anio);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo duplicar.');
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
      aria-labelledby="modal-dup-titulo"
      onClick={onCerrar}
    >
      <div
        style={{
          background: ds.bgCard,
          borderRadius: 16,
          padding: 28,
          width: '100%',
          maxWidth: 440,
          border: `1px solid ${ds.borderCard}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="modal-dup-titulo"
          style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: ds.textPrimary }}
        >
          Duplicar plan
        </h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: ds.textSecondary, lineHeight: 1.45 }}>
          Origen: <strong style={{ color: ds.textPrimary }}>{nombreOrigen}</strong>. Elige el mes destino (no debe existir ya un plan ahí).
        </p>
        <label style={labelStyle}>
          Mes destino
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))} style={fieldStyle}>
            {MESES_ES.map((nombre, i) => (
              <option key={nombre} value={i + 1}>
                {nombre}
              </option>
            ))}
          </select>
        </label>
        <label style={{ ...labelStyle, marginTop: 14 }}>
          Año destino
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} style={fieldStyle}>
            {aniosOpciones.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        {error ? <p style={{ margin: '14px 0 0', fontSize: 13, color: ds.dangerText }}>{error}</p> : null}
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
            disabled={enviando}
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
              opacity: enviando ? 0.55 : 1,
            }}
          >
            {enviando ? 'Duplicando…' : 'Duplicar'}
          </button>
        </div>
      </div>
    </div>
  );
}
