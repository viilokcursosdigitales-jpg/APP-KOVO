import { ds } from '../../design-system/ds';

type ModalConfirmarProps = {
  open: boolean;
  titulo: string;
  mensaje: string;
  etiquetaCancelar?: string;
  etiquetaConfirmar?: string;
  /** Si true, el botón de confirmación usa estilo de peligro. */
  peligro?: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
};

/** Modal genérico (mismo patrón overlay que Motico). */
export function ModalConfirmar({
  open,
  titulo,
  mensaje,
  etiquetaCancelar = 'Cancelar',
  etiquetaConfirmar = 'Confirmar',
  peligro = false,
  onCancelar,
  onConfirmar,
}: ModalConfirmarProps) {
  if (!open) return null;

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
      aria-labelledby="modal-confirmar-titulo"
      onClick={onCancelar}
    >
      <div
        style={{
          background: ds.bgCard,
          borderRadius: 16,
          padding: 28,
          width: '100%',
          maxWidth: 420,
          border: `1px solid ${ds.borderCard}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="modal-confirmar-titulo"
          style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: ds.textPrimary }}
        >
          {titulo}
        </h3>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: ds.textSecondary, lineHeight: 1.45 }}>{mensaje}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onCancelar}
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
            {etiquetaCancelar}
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: 'none',
              background: peligro ? ds.dangerText : ds.brand,
              color: peligro ? '#fff' : ds.textOnBrand,
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {etiquetaConfirmar}
          </button>
        </div>
      </div>
    </div>
  );
}
