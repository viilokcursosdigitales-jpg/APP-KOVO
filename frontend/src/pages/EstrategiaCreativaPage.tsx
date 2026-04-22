import { useEffect, useMemo, useRef, useState } from 'react';
import { ds } from '../design-system/ds';

type Tone = 'neutral' | 'info' | 'success' | 'warning';
type CreativeType = 'imagen' | 'video';
type Stage = {
  id: string;
  title: string;
  short: string;
  defaultTone: Tone;
};
type Position = { x: number; y: number };
type Connection = { from: string; to: string };
type DragState = {
  stageId: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
} | null;
type NodeData = {
  objective: string;
  structure: string;
  description: string;
  prompts: string[];
  creativeType: CreativeType;
  creativeAssetUrl: string;
  creativeNotes: string;
  creativeUploadUrl: string;
};
type NodeDataMap = Record<string, NodeData>;
type StagePositionMap = Record<string, Position>;
type StageColorMap = Record<string, Tone>;

const STAGES: Stage[] = [
  { id: 'producto', title: 'Producto', short: 'Producto', defaultTone: 'warning' },
  { id: 'angulos-venta', title: 'Angulo de venta', short: 'Angulo', defaultTone: 'info' },
  { id: 'hook', title: 'Hook', short: 'Hook', defaultTone: 'neutral' },
  { id: 'formatos', title: 'Formato', short: 'Formato', defaultTone: 'success' },
  { id: 'estructura-creativa', title: 'Estructura', short: 'Estructura', defaultTone: 'warning' },
  { id: 'creativo', title: 'Creativo', short: 'Creativo', defaultTone: 'info' },
];

const TONE_OPTIONS: Array<{ value: Tone; label: string }> = [
  { value: 'neutral', label: 'Neutral' },
  { value: 'info', label: 'Info' },
  { value: 'success', label: 'Success' },
  { value: 'warning', label: 'Warning' },
];

const DEFAULT_POSITIONS: StagePositionMap = {
  producto: { x: 26, y: 52 },
  'angulos-venta': { x: 274, y: 86 },
  hook: { x: 524, y: 74 },
  formatos: { x: 46, y: 242 },
  'estructura-creativa': { x: 304, y: 232 },
  creativo: { x: 562, y: 236 },
};

const DEFAULT_COLORS: StageColorMap = {
  producto: 'warning',
  'angulos-venta': 'info',
  hook: 'neutral',
  formatos: 'success',
  'estructura-creativa': 'warning',
  creativo: 'info',
};

const DEFAULT_CONNECTIONS: Connection[] = [
  { from: 'producto', to: 'angulos-venta' },
  { from: 'angulos-venta', to: 'hook' },
  { from: 'hook', to: 'formatos' },
  { from: 'formatos', to: 'estructura-creativa' },
  { from: 'estructura-creativa', to: 'creativo' },
];

const EMPTY_NODE: NodeData = {
  objective: '',
  structure: '',
  description: '',
  prompts: [],
  creativeType: 'imagen',
  creativeAssetUrl: '',
  creativeNotes: '',
  creativeUploadUrl: '',
};

function buildInitialNodeData(): NodeDataMap {
  const out: NodeDataMap = {};
  for (const stage of STAGES) out[stage.id] = { ...EMPTY_NODE };
  return out;
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    border: `1px solid ${active ? ds.brand : ds.borderCard}`,
    background: active ? ds.brandBg : ds.bgCard,
    color: active ? ds.brand : ds.textSecondary,
    borderRadius: 999,
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: active ? 700 : 600,
    cursor: 'pointer',
  };
}

function toneColorMap(tone: Tone): { border: string; fill: string } {
  if (tone === 'warning') return { border: ds.warningText, fill: ds.warningBg };
  if (tone === 'success') return { border: ds.successText, fill: ds.successBg };
  if (tone === 'info') return { border: ds.brand, fill: ds.brandBg };
  return { border: ds.borderCard, fill: ds.bgCard };
}

function findStageById(stageId: string): Stage | null {
  return STAGES.find((s) => s.id === stageId) || null;
}

export default function EstrategiaCreativaPage() {
  const [positions, setPositions] = useState<StagePositionMap>(DEFAULT_POSITIONS);
  const [colors, setColors] = useState<StageColorMap>(DEFAULT_COLORS);
  const [connections, setConnections] = useState<Connection[]>(DEFAULT_CONNECTIONS);
  const [selectedStage, setSelectedStage] = useState<string>('producto');
  const [fromStage, setFromStage] = useState<string>('producto');
  const [toStage, setToStage] = useState<string>('angulos-venta');
  const [drag, setDrag] = useState<DragState>(null);
  const [nodeData, setNodeData] = useState<NodeDataMap>(buildInitialNodeData());
  const [newPrompt, setNewPrompt] = useState('');
  const [viewerOpen, setViewerOpen] = useState(false);
  const uploadUrlToRevokeRef = useRef<string>('');

  const selected = nodeData[selectedStage] || EMPTY_NODE;
  const selectedInfo = findStageById(selectedStage);

  const totalPrompts = useMemo(
    () => Object.values(nodeData).reduce((sum, node) => sum + node.prompts.length, 0),
    [nodeData],
  );

  useEffect(() => {
    return () => {
      if (uploadUrlToRevokeRef.current && uploadUrlToRevokeRef.current.startsWith('blob:')) {
        URL.revokeObjectURL(uploadUrlToRevokeRef.current);
      }
    };
  }, []);

  const updateSelectedNode = (patch: Partial<NodeData>) => {
    setNodeData((prev) => ({
      ...prev,
      [selectedStage]: { ...(prev[selectedStage] || EMPTY_NODE), ...patch },
    }));
  };

  const handleMoveBoard = (clientX: number, clientY: number) => {
    if (!drag) return;
    const nextX = Math.max(12, Math.min(690, drag.originX + (clientX - drag.startX)));
    const nextY = Math.max(12, Math.min(350, drag.originY + (clientY - drag.startY)));
    setPositions((prev) => ({ ...prev, [drag.stageId]: { x: nextX, y: nextY } }));
  };

  const handleAddPrompt = () => {
    const trimmed = newPrompt.trim();
    if (!trimmed) return;
    updateSelectedNode({ prompts: [...selected.prompts, trimmed] });
    setNewPrompt('');
  };

  const clearBoard = () => {
    setPositions(DEFAULT_POSITIONS);
    setColors(DEFAULT_COLORS);
    setConnections(DEFAULT_CONNECTIONS);
    setDrag(null);
  };

  const addConnection = () => {
    if (!fromStage || !toStage || fromStage === toStage) return;
    if (connections.some((line) => line.from === fromStage && line.to === toStage)) return;
    setConnections((prev) => [...prev, { from: fromStage, to: toStage }]);
  };

  const stageOptions = STAGES.map((s) => ({ value: s.id, label: s.title }));

  const creativePreviewSrc = selected.creativeUploadUrl || selected.creativeAssetUrl;
  const isCreativeStage = selectedStage === 'creativo';
  const isCreativeImage = selected.creativeType === 'imagen';

  return (
    <div style={{ maxWidth: 1320, margin: '0 auto', fontFamily: ds.font }}>
      <header
        style={{
          marginBottom: 14,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 8,
              background: ds.brand,
              color: ds.textOnBrand,
              display: 'grid',
              placeItems: 'center',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            K
          </div>
          <div>
            <h1 style={{ margin: 0, color: ds.textPrimary, fontSize: 24 }}>Estrategia Creativa KOVO</h1>
            <p style={{ margin: '4px 0 0', color: ds.textMuted, fontSize: 12 }}>
              Flujo: Producto {'>'} Angulo {'>'} Hook {'>'} Formato {'>'} Estructura {'>'} Creativo
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={clearBoard} style={actionBtnStyle('secondary')}>
            Limpiar
          </button>
          <button
            type="button"
            onClick={() => setSelectedStage('creativo')}
            style={actionBtnStyle('ghost')}
          >
            Ver creativo
          </button>
        </div>
      </header>

      <div
        style={{
          marginBottom: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
          background: ds.bgCard,
          border: `1px solid ${ds.borderCard}`,
          borderRadius: 12,
          padding: '10px 12px',
        }}
      >
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STAGES.map((stage, index) => (
            <button
              key={stage.id}
              type="button"
              onClick={() => setSelectedStage(stage.id)}
              style={chipStyle(selectedStage === stage.id)}
            >
              {index + 1}. {stage.short}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={counterBadgeStyle}>{STAGES.length} nodos</span>
          <span style={counterBadgeStyle}>{totalPrompts} prompts</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <section
          onMouseMove={(e) => handleMoveBoard(e.clientX, e.clientY)}
          onMouseLeave={() => setDrag(null)}
          onMouseUp={() => setDrag(null)}
          style={{
            position: 'relative',
            minHeight: 460,
            border: `1px solid ${ds.borderCard}`,
            borderRadius: 12,
            background: ds.bgCard,
            overflow: 'hidden',
            backgroundImage: `radial-gradient(${ds.borderRow} 1px, transparent 1px)`,
            backgroundSize: '14px 14px',
          }}
        >
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 900 460"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            {connections.map((line, idx) => {
              const from = positions[line.from];
              const to = positions[line.to];
              if (!from || !to) return null;
              return (
                <line
                  key={`${line.from}-${line.to}-${idx}`}
                  x1={from.x + 100}
                  y1={from.y + 30}
                  x2={to.x + 100}
                  y2={to.y + 30}
                  stroke={ds.brand}
                  strokeWidth={1.5}
                  opacity={0.8}
                />
              );
            })}
          </svg>

          {STAGES.map((stage) => {
            const pos = positions[stage.id] || { x: 20, y: 20 };
            const node = nodeData[stage.id] || EMPTY_NODE;
            const tone = colors[stage.id] || stage.defaultTone;
            const palette = toneColorMap(tone);
            const active = selectedStage === stage.id;
            return (
              <div
                key={stage.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setSelectedStage(stage.id);
                  setDrag({
                    stageId: stage.id,
                    startX: e.clientX,
                    startY: e.clientY,
                    originX: pos.x,
                    originY: pos.y,
                  });
                }}
                style={{
                  position: 'absolute',
                  left: pos.x,
                  top: pos.y,
                  width: 198,
                  background: palette.fill,
                  border: `1px solid ${palette.border}`,
                  borderRadius: 10,
                  padding: '8px 9px',
                  cursor: 'grab',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <strong style={{ fontSize: 12, color: ds.textPrimary }}>{stage.title}</strong>
                  {active ? <span style={{ ...counterBadgeStyle, color: ds.brand }}>Activo</span> : null}
                </div>
                <p
                  style={{
                    margin: '6px 0',
                    fontSize: 11,
                    color: ds.textMuted,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {node.objective || stage.short}
                </p>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setSelectedStage(stage.id)}
                    style={{ ...actionBtnStyle('primary'), padding: '4px 8px', fontSize: 11 }}
                  >
                    + Prompts ({node.prompts.length})
                  </button>
                  <span style={counterBadgeStyle}>{stage.id}</span>
                </div>
              </div>
            );
          })}
        </section>

        <aside
          style={{
            background: ds.bgCard,
            border: `1px solid ${ds.borderCard}`,
            borderRadius: 12,
            padding: 12,
            minHeight: 460,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <strong style={{ color: ds.textPrimary, fontSize: 12 }}>
              NIVEL: {selectedInfo?.title || 'Editor'}
            </strong>
            <select
              value={colors[selectedStage] || 'neutral'}
              onChange={(e) => {
                const tone = e.target.value as Tone;
                setColors((prev) => ({ ...prev, [selectedStage]: tone }));
              }}
              style={inputStyle}
            >
              {TONE_OPTIONS.map((tone) => (
                <option key={tone.value} value={tone.value}>
                  {tone.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            <input
              value={selected.objective}
              onChange={(e) => updateSelectedNode({ objective: e.target.value })}
              placeholder="Objetivo"
              style={inputStyle}
            />
            <input
              value={selected.structure}
              onChange={(e) => updateSelectedNode({ structure: e.target.value })}
              placeholder="Hook > Problema > Solucion > CTA"
              style={inputStyle}
            />
            <textarea
              value={selected.description}
              onChange={(e) => updateSelectedNode({ description: e.target.value })}
              placeholder="Descripcion / detalle"
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          <hr style={separatorStyle} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <strong style={{ fontSize: 13, color: ds.textPrimary }}>Prompts</strong>
            <button type="button" onClick={handleAddPrompt} style={{ ...actionBtnStyle('secondary'), fontSize: 11 }}>
              + Anadir
            </button>
          </div>
          <input
            value={newPrompt}
            onChange={(e) => setNewPrompt(e.target.value)}
            placeholder="Escribe un prompt..."
            style={{ ...inputStyle, marginTop: 8 }}
          />
          <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
            {selected.prompts.length === 0 ? (
              <small style={{ color: ds.textHint }}>Sin prompts aun</small>
            ) : (
              selected.prompts.map((prompt, idx) => (
                <div key={`${selectedStage}-${idx}`} style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={prompt}
                    onChange={(e) => {
                      const next = selected.prompts.map((item, i) => (i === idx ? e.target.value : item));
                      updateSelectedNode({ prompts: next });
                    }}
                    style={inputStyle}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      updateSelectedNode({
                        prompts: selected.prompts.filter((_, i) => i !== idx),
                      });
                    }}
                    style={{ ...actionBtnStyle('ghost'), fontSize: 11 }}
                  >
                    Borrar
                  </button>
                </div>
              ))
            )}
          </div>

          <hr style={separatorStyle} />
          <strong style={{ fontSize: 13, color: ds.textPrimary }}>Conexiones</strong>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
            <select value={fromStage} onChange={(e) => setFromStage(e.target.value)} style={inputStyle}>
              {stageOptions.map((opt) => (
                <option key={`from-${opt.value}`} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <select value={toStage} onChange={(e) => setToStage(e.target.value)} style={inputStyle}>
              {stageOptions.map((opt) => (
                <option key={`to-${opt.value}`} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={addConnection} style={actionBtnStyle('primary')}>
              Conectar
            </button>
            <button type="button" onClick={() => setConnections([])} style={actionBtnStyle('ghost')}>
              Limpiar
            </button>
          </div>

          {isCreativeStage ? (
            <>
              <hr style={separatorStyle} />
              <CalloutBanner title="Estructura > Creativo">
                Carga el creativo final y visualizalo como imagen o video.
              </CalloutBanner>
              <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                <select
                  value={selected.creativeType}
                  onChange={(e) => updateSelectedNode({ creativeType: e.target.value as CreativeType })}
                  style={inputStyle}
                >
                  <option value="imagen">Imagen</option>
                  <option value="video">Video</option>
                </select>

                <input
                  value={selected.creativeAssetUrl}
                  onChange={(e) => updateSelectedNode({ creativeAssetUrl: e.target.value })}
                  placeholder="URL del creativo (opcional)"
                  style={inputStyle}
                />

                <input
                  type="file"
                  accept={selected.creativeType === 'imagen' ? 'image/*' : 'video/*'}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (uploadUrlToRevokeRef.current && uploadUrlToRevokeRef.current.startsWith('blob:')) {
                      URL.revokeObjectURL(uploadUrlToRevokeRef.current);
                    }
                    const blobUrl = URL.createObjectURL(file);
                    uploadUrlToRevokeRef.current = blobUrl;
                    updateSelectedNode({ creativeUploadUrl: blobUrl });
                    setViewerOpen(true);
                  }}
                  style={inputStyle}
                />

                <textarea
                  value={selected.creativeNotes}
                  onChange={(e) => updateSelectedNode({ creativeNotes: e.target.value })}
                  rows={2}
                  placeholder="Notas del creativo"
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" onClick={() => setViewerOpen(true)} style={actionBtnStyle('primary')}>
                  {isCreativeImage ? 'Ampliar imagen' : 'Reproducir video'}
                </button>
                <button type="button" onClick={() => setViewerOpen(false)} style={actionBtnStyle('ghost')}>
                  Cerrar visor
                </button>
              </div>
            </>
          ) : null}
        </aside>
      </div>

      {viewerOpen && isCreativeStage ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2, 6, 23, 0.65)',
            zIndex: 60,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setViewerOpen(false)}
        >
          <div
            style={{
              width: 'min(1000px, 95vw)',
              maxHeight: '92vh',
              overflow: 'auto',
              background: ds.bgCard,
              borderRadius: 12,
              border: `1px solid ${ds.borderCard}`,
              padding: 12,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <strong style={{ color: ds.textPrimary }}>Visualizacion del creativo</strong>
              <button type="button" onClick={() => setViewerOpen(false)} style={actionBtnStyle('ghost')}>
                Cerrar
              </button>
            </div>
            {creativePreviewSrc ? (
              isCreativeImage ? (
                <img
                  src={creativePreviewSrc}
                  alt="Creativo"
                  style={{ width: '100%', maxHeight: '78vh', objectFit: 'contain', borderRadius: 10 }}
                />
              ) : (
                <video
                  controls
                  autoPlay
                  src={creativePreviewSrc}
                  style={{ width: '100%', maxHeight: '78vh', borderRadius: 10 }}
                />
              )
            ) : (
              <p style={{ color: ds.textMuted, margin: 0 }}>
                Agrega una URL o sube un archivo para visualizar el creativo final.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CalloutBanner({ title, children }: { title: string; children: string }) {
  return (
    <div
      style={{
        border: `1px solid ${ds.borderCard}`,
        borderRadius: 10,
        background: ds.brandBg,
        padding: '8px 10px',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: ds.brand, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: ds.textSecondary }}>{children}</div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: `1px solid ${ds.borderCard}`,
  borderRadius: 8,
  padding: '7px 9px',
  fontSize: 12,
  color: ds.textPrimary,
  background: ds.bgCard,
  fontFamily: ds.font,
};

const counterBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 999,
  border: `1px solid ${ds.borderCard}`,
  background: ds.bgSubtle,
  color: ds.textMuted,
  fontSize: 10,
  fontWeight: 700,
  padding: '2px 8px',
};

const separatorStyle: React.CSSProperties = {
  margin: '10px 0',
  border: 'none',
  borderTop: `1px solid ${ds.borderRow}`,
};

function actionBtnStyle(variant: 'primary' | 'secondary' | 'ghost'): React.CSSProperties {
  if (variant === 'primary') {
    return {
      border: `1px solid ${ds.brand}`,
      background: ds.brand,
      color: ds.textOnBrand,
      borderRadius: 8,
      padding: '7px 10px',
      fontSize: 12,
      fontWeight: 600,
      cursor: 'pointer',
    };
  }
  if (variant === 'secondary') {
    return {
      border: `1px solid ${ds.borderCard}`,
      background: ds.bgCard,
      color: ds.textSecondary,
      borderRadius: 8,
      padding: '7px 10px',
      fontSize: 12,
      fontWeight: 600,
      cursor: 'pointer',
    };
  }
  return {
    border: `1px solid ${ds.borderCard}`,
    background: 'transparent',
    color: ds.textMuted,
    borderRadius: 8,
    padding: '7px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  };
}
