import { useMemo, useRef, useState } from 'react';
import { ds } from '../design-system/ds';

type Tone = 'neutral' | 'info' | 'success' | 'warning';
type NodeKind = 'producto' | 'angulo' | 'hook';
type Position = { x: number; y: number };
type Viewport = { x: number; y: number; scale: number };
type Connection = { from: string; to: string };
type BoardNode = {
  id: string;
  kind: NodeKind;
  title: string;
  tone: Tone;
  position: Position;
};
type NodeData = {
  objective: string;
  structure: string;
  description: string;
  prompts: string[];
};
type NodeDataMap = Record<string, NodeData>;
type NodeDragState = {
  nodeId: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
} | null;
type PanDragState = {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
} | null;

const PRODUCT_NODE_ID = 'producto-1';
const BOARD_SIZE = 8000;
const BOARD_CENTER = BOARD_SIZE / 2;
const PRODUCT_DEFAULT_POS: Position = { x: BOARD_CENTER, y: BOARD_CENTER };
const EMPTY_NODE_DATA: NodeData = {
  objective: '',
  structure: '',
  description: '',
  prompts: [],
};

function toneColorMap(tone: Tone): { border: string; fill: string } {
  if (tone === 'warning') return { border: ds.warningText, fill: ds.warningBg };
  if (tone === 'success') return { border: ds.successText, fill: ds.successBg };
  if (tone === 'info') return { border: ds.brand, fill: ds.brandBg };
  return { border: ds.borderCard, fill: ds.bgCard };
}

function getNodeData(nodeData: NodeDataMap, nodeId: string): NodeData {
  return nodeData[nodeId] || EMPTY_NODE_DATA;
}

export default function EstrategiaCreativaPage() {
  const [nodes, setNodes] = useState<BoardNode[]>([
    {
      id: PRODUCT_NODE_ID,
      kind: 'producto',
      title: 'Producto',
      tone: 'warning',
      position: PRODUCT_DEFAULT_POS,
    },
  ]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [nodeData, setNodeData] = useState<NodeDataMap>({});
  const [selectedNodeId, setSelectedNodeId] = useState<string>(PRODUCT_NODE_ID);
  const [editorNodeId, setEditorNodeId] = useState<string | null>(null);
  const [newPrompt, setNewPrompt] = useState('');
  const [nodeDrag, setNodeDrag] = useState<NodeDragState>(null);
  const [panDrag, setPanDrag] = useState<PanDragState>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: -3600, y: -3750, scale: 1 });

  const boardRef = useRef<HTMLDivElement | null>(null);
  const angleSequenceRef = useRef(1);
  const hookSequenceRef = useRef(1);

  const selectedNode = nodes.find((n) => n.id === (editorNodeId || selectedNodeId)) || null;
  const selectedData = selectedNode ? getNodeData(nodeData, selectedNode.id) : EMPTY_NODE_DATA;

  const angleNodes = useMemo(() => nodes.filter((node) => node.kind === 'angulo'), [nodes]);
  const hookNodes = useMemo(() => nodes.filter((node) => node.kind === 'hook'), [nodes]);
  const connectedAngles = useMemo(() => {
    const connectedIds = new Set(
      connections
        .filter((line) => line.from === PRODUCT_NODE_ID)
        .map((line) => line.to),
    );
    return angleNodes.filter((node) => connectedIds.has(node.id));
  }, [angleNodes, connections]);

  const getChildrenByParent = (parentId: string, kind?: NodeKind) => {
    const childIds = new Set(connections.filter((line) => line.from === parentId).map((line) => line.to));
    return nodes.filter((node) => childIds.has(node.id) && (!kind || node.kind === kind));
  };

  const totalPrompts = useMemo(
    () => Object.values(nodeData).reduce((sum, item) => sum + item.prompts.length, 0),
    [nodeData],
  );

  const updateNodeData = (nodeId: string, patch: Partial<NodeData>) => {
    setNodeData((prev) => ({
      ...prev,
      [nodeId]: { ...(prev[nodeId] || EMPTY_NODE_DATA), ...patch },
    }));
  };

  const addAngleFromProduct = () => {
    const angleIndex = angleSequenceRef.current;
    angleSequenceRef.current += 1;
    const nodeId = `angulo-${angleIndex}`;
    const position: Position = {
      x: PRODUCT_DEFAULT_POS.x + 320,
      y: PRODUCT_DEFAULT_POS.y - 80 + angleIndex * 86,
    };
    const newNode: BoardNode = {
      id: nodeId,
      kind: 'angulo',
      title: `Angulo de venta ${angleIndex}`,
      tone: 'info',
      position,
    };

    setNodes((prev) => [...prev, newNode]);
    setConnections((prev) => [...prev, { from: PRODUCT_NODE_ID, to: nodeId }]);
    setSelectedNodeId(nodeId);
    setEditorNodeId(nodeId);
  };

  const removeNodeCascade = (rootNodeId: string, fallbackSelectedNodeId: string = PRODUCT_NODE_ID) => {
    const toRemove = new Set<string>();
    const queue: string[] = [rootNodeId];

    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (toRemove.has(current)) continue;
      toRemove.add(current);
      for (const line of connections) {
        if (line.from === current && !toRemove.has(line.to)) queue.push(line.to);
      }
    }

    setNodes((prev) => prev.filter((node) => !toRemove.has(node.id)));
    setConnections((prev) => prev.filter((line) => !toRemove.has(line.from) && !toRemove.has(line.to)));
    setNodeData((prev) => {
      const next = { ...prev };
      for (const nodeId of toRemove) delete next[nodeId];
      return next;
    });
    if (selectedNodeId && toRemove.has(selectedNodeId)) setSelectedNodeId(fallbackSelectedNodeId);
    if (editorNodeId && toRemove.has(editorNodeId)) {
      setEditorNodeId(null);
      setNewPrompt('');
    }
  };

  const removeAngleFromProduct = (angleId: string) => {
    removeNodeCascade(angleId, PRODUCT_NODE_ID);
  };

  const addHookFromAngle = (angleId: string) => {
    const angleNode = nodes.find((node) => node.id === angleId);
    if (!angleNode) return;

    const hookIndex = hookSequenceRef.current;
    hookSequenceRef.current += 1;
    const nodeId = `hook-${hookIndex}`;
    const newNode: BoardNode = {
      id: nodeId,
      kind: 'hook',
      title: `Hook ${hookIndex}`,
      tone: 'neutral',
      position: {
        x: angleNode.position.x + 300,
        y: angleNode.position.y + 14,
      },
    };

    setNodes((prev) => [...prev, newNode]);
    setConnections((prev) => [...prev, { from: angleId, to: nodeId }]);
    setSelectedNodeId(nodeId);
    setEditorNodeId(nodeId);
    setNewPrompt('');
  };

  const clearBoard = () => {
    angleSequenceRef.current = 1;
    hookSequenceRef.current = 1;
    setNodes([
      {
        id: PRODUCT_NODE_ID,
        kind: 'producto',
        title: 'Producto',
        tone: 'warning',
        position: PRODUCT_DEFAULT_POS,
      },
    ]);
    setConnections([]);
    setNodeData({});
    setSelectedNodeId(PRODUCT_NODE_ID);
    setEditorNodeId(null);
    setNodeDrag(null);
    setPanDrag(null);
    setNewPrompt('');
  };

  const onBoardWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!boardRef.current) return;

    const rect = boardRef.current.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const nextScale = Math.min(2.5, Math.max(0.35, viewport.scale + (event.deltaY > 0 ? -0.08 : 0.08)));
    const worldX = (sx - viewport.x) / viewport.scale;
    const worldY = (sy - viewport.y) / viewport.scale;
    const nextX = sx - worldX * nextScale;
    const nextY = sy - worldY * nextScale;
    setViewport({ x: nextX, y: nextY, scale: nextScale });
  };

  const onBoardMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-node-id]')) return;
    setPanDrag({
      startX: event.clientX,
      startY: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
    });
  };

  const onBoardMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (nodeDrag) {
      const dx = (event.clientX - nodeDrag.startX) / viewport.scale;
      const dy = (event.clientY - nodeDrag.startY) / viewport.scale;
      setNodes((prev) =>
        prev.map((node) =>
          node.id === nodeDrag.nodeId
            ? { ...node, position: { x: nodeDrag.originX + dx, y: nodeDrag.originY + dy } }
            : node,
        ),
      );
      return;
    }

    if (panDrag) {
      const dx = event.clientX - panDrag.startX;
      const dy = event.clientY - panDrag.startY;
      setViewport((prev) => ({
        ...prev,
        x: panDrag.originX + dx,
        y: panDrag.originY + dy,
      }));
    }
  };

  const onBoardMouseUp = () => {
    setNodeDrag(null);
    setPanDrag(null);
  };

  const focusNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
  };

  const openPromptEditor = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setEditorNodeId(nodeId);
    setNewPrompt('');
  };

  const closePromptEditor = () => {
    setEditorNodeId(null);
    setNewPrompt('');
  };

  const addPrompt = () => {
    if (!editorNodeId) return;
    const trimmed = newPrompt.trim();
    if (!trimmed) return;
    const current = getNodeData(nodeData, editorNodeId);
    updateNodeData(editorNodeId, { prompts: [...current.prompts, trimmed] });
    setNewPrompt('');
  };

  return (
    <div style={{ maxWidth: '100%', margin: '0 auto', fontFamily: ds.font }}>
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
              Tablero infinito: rueda para zoom, arrastra fondo para mover el canvas.
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => setViewport((prev) => ({ ...prev, scale: Math.min(2.5, prev.scale + 0.15) }))}
            style={actionBtnStyle('secondary')}
          >
            Zoom +
          </button>
          <button
            type="button"
            onClick={() => setViewport((prev) => ({ ...prev, scale: Math.max(0.35, prev.scale - 0.15) }))}
            style={actionBtnStyle('secondary')}
          >
            Zoom -
          </button>
          <button
            type="button"
            onClick={() => setViewport({ x: -3600, y: -3750, scale: 1 })}
            style={actionBtnStyle('ghost')}
          >
            Centrar
          </button>
          <button type="button" onClick={clearBoard} style={actionBtnStyle('ghost')}>
            Limpiar
          </button>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 1fr', gap: 12 }}>
        <section
          ref={boardRef}
          onWheel={onBoardWheel}
          onMouseDown={onBoardMouseDown}
          onMouseMove={onBoardMouseMove}
          onMouseLeave={onBoardMouseUp}
          onMouseUp={onBoardMouseUp}
          style={{
            position: 'relative',
            minHeight: 620,
            border: `1px solid ${ds.borderCard}`,
            borderRadius: 12,
            background: ds.bgCard,
            overflow: 'hidden',
            cursor: panDrag ? 'grabbing' : 'grab',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: `radial-gradient(${ds.borderRow} 1px, transparent 1px)`,
              backgroundSize: `${14 * viewport.scale}px ${14 * viewport.scale}px`,
              opacity: 0.9,
              pointerEvents: 'none',
            }}
          />

          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: BOARD_SIZE,
              height: BOARD_SIZE,
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
              transformOrigin: '0 0',
            }}
          >
            <svg
              width={BOARD_SIZE}
              height={BOARD_SIZE}
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
            >
              {connections.map((line, idx) => {
                const from = nodes.find((n) => n.id === line.from);
                const to = nodes.find((n) => n.id === line.to);
                if (!from || !to) return null;
                return (
                  <line
                    key={`${line.from}-${line.to}-${idx}`}
                    x1={from.position.x + 100}
                    y1={from.position.y + 30}
                    x2={to.position.x + 100}
                    y2={to.position.y + 30}
                    stroke={ds.brand}
                    strokeWidth={1.5}
                    opacity={0.85}
                  />
                );
              })}
            </svg>

            {nodes.map((node) => {
              const palette = toneColorMap(node.tone);
              const active = selectedNodeId === node.id;
              const data = getNodeData(nodeData, node.id);
              const productIsNode = node.kind === 'producto';
              const angleIsNode = node.kind === 'angulo';
              const showAnglesInsideProduct = productIsNode && connectedAngles.length > 0;
              const connectedHooks = angleIsNode ? getChildrenByParent(node.id, 'hook') : [];
              return (
                <div
                  key={node.id}
                  data-node-id={node.id}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    focusNode(node.id);
                    setNodeDrag({
                      nodeId: node.id,
                      startX: event.clientX,
                      startY: event.clientY,
                      originX: node.position.x,
                      originY: node.position.y,
                    });
                  }}
                  style={{
                    position: 'absolute',
                    left: node.position.x,
                    top: node.position.y,
                    width: productIsNode ? 240 : 210,
                    border: `1px solid ${palette.border}`,
                    borderRadius: 10,
                    background: palette.fill,
                    padding: '8px 10px',
                    cursor: 'grab',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: 12, color: ds.textPrimary }}>{node.title}</strong>
                    {active ? <span style={{ ...counterBadgeStyle, color: ds.brand }}>Activo</span> : null}
                  </div>

                  <p style={{ margin: '6px 0', fontSize: 11, color: ds.textMuted }}>
                    {data.objective || (productIsNode ? 'Producto base' : angleIsNode ? 'Angulo de venta' : 'Hook')}
                  </p>

                  {productIsNode ? (
                    <div style={{ display: 'grid', gap: 6, marginBottom: 6 }}>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          addAngleFromProduct();
                        }}
                        style={{ ...actionBtnStyle('primary'), fontSize: 11, padding: '5px 8px' }}
                      >
                        + Agregar angulo de venta
                      </button>
                      {showAnglesInsideProduct ? (
                        <div style={{ display: 'grid', gap: 4 }}>
                          {connectedAngles.map((angle) => (
                            <div
                              key={`prod-angle-${angle.id}`}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 6,
                                border: `1px solid ${ds.borderCard}`,
                                borderRadius: 8,
                                padding: '4px 6px',
                                background: ds.bgCard,
                              }}
                            >
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  focusNode(angle.id);
                                }}
                                style={{
                                  border: 'none',
                                  background: 'transparent',
                                  color: ds.textSecondary,
                                  fontSize: 11,
                                  textAlign: 'left',
                                  cursor: 'pointer',
                                  padding: 0,
                                  fontWeight: 600,
                                }}
                              >
                                {angle.title}
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  removeAngleFromProduct(angle.id);
                                }}
                                style={{ ...actionBtnStyle('ghost'), fontSize: 10, padding: '3px 6px' }}
                              >
                                Quitar
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {angleIsNode ? (
                    <div style={{ display: 'grid', gap: 6, marginBottom: 6 }}>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          addHookFromAngle(node.id);
                        }}
                        style={{ ...actionBtnStyle('secondary'), fontSize: 11, padding: '5px 8px' }}
                      >
                        + Agregar hook
                      </button>
                      {connectedHooks.length > 0 ? (
                        <div style={{ display: 'grid', gap: 4 }}>
                          {connectedHooks.map((hook) => (
                            <div
                              key={`angle-hook-${hook.id}`}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 6,
                                border: `1px solid ${ds.borderCard}`,
                                borderRadius: 8,
                                padding: '4px 6px',
                                background: ds.bgCard,
                              }}
                            >
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  focusNode(hook.id);
                                }}
                                style={{
                                  border: 'none',
                                  background: 'transparent',
                                  color: ds.textSecondary,
                                  fontSize: 11,
                                  textAlign: 'left',
                                  cursor: 'pointer',
                                  padding: 0,
                                  fontWeight: 600,
                                }}
                              >
                                {hook.title}
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  removeNodeCascade(hook.id, node.id);
                                }}
                                style={{ ...actionBtnStyle('ghost'), fontSize: 10, padding: '3px 6px' }}
                              >
                                Quitar
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openPromptEditor(node.id);
                      }}
                      style={{ ...actionBtnStyle('primary'), fontSize: 11, padding: '4px 8px' }}
                    >
                      Prompts ({data.prompts.length})
                    </button>
                    <span style={counterBadgeStyle}>{node.id}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <aside
          style={{
            background: ds.bgCard,
            border: `1px solid ${ds.borderCard}`,
            borderRadius: 12,
            padding: 12,
            minHeight: 620,
          }}
        >
          <div style={{ marginBottom: 10 }}>
            <strong style={{ color: ds.textPrimary, fontSize: 13 }}>Resumen</strong>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <span style={counterBadgeStyle}>{nodes.length} cuadros</span>
              <span style={counterBadgeStyle}>{angleNodes.length} angulos</span>
              <span style={counterBadgeStyle}>{hookNodes.length} hooks</span>
              <span style={counterBadgeStyle}>{totalPrompts} prompts</span>
            </div>
          </div>

          {!editorNodeId || !selectedNode ? (
            <div
              style={{
                border: `1px dashed ${ds.borderCard}`,
                borderRadius: 10,
                padding: 12,
                color: ds.textMuted,
                fontSize: 12,
              }}
            >
              Haz clic en el boton <strong>Prompts</strong> de un cuadro para abrir su editor.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <strong style={{ color: ds.textPrimary, fontSize: 12 }}>
                  Editor: {selectedNode.title}
                </strong>
                <button type="button" onClick={closePromptEditor} style={{ ...actionBtnStyle('ghost'), fontSize: 11 }}>
                  Cerrar
                </button>
              </div>

              <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                <input
                  value={selectedData.objective}
                  onChange={(event) => updateNodeData(selectedNode.id, { objective: event.target.value })}
                  placeholder="Objetivo"
                  style={inputStyle}
                />
                <input
                  value={selectedData.structure}
                  onChange={(event) => updateNodeData(selectedNode.id, { structure: event.target.value })}
                  placeholder="Estructura"
                  style={inputStyle}
                />
                <textarea
                  value={selectedData.description}
                  onChange={(event) => updateNodeData(selectedNode.id, { description: event.target.value })}
                  rows={3}
                  placeholder="Descripcion / detalle"
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </div>

              <hr style={separatorStyle} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <strong style={{ color: ds.textPrimary, fontSize: 13 }}>Prompts</strong>
                <button type="button" onClick={addPrompt} style={{ ...actionBtnStyle('secondary'), fontSize: 11 }}>
                  + Anadir
                </button>
              </div>
              <input
                value={newPrompt}
                onChange={(event) => setNewPrompt(event.target.value)}
                placeholder="Nuevo prompt..."
                style={{ ...inputStyle, marginTop: 8 }}
              />
              <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                {selectedData.prompts.length === 0 ? (
                  <small style={{ color: ds.textHint }}>Sin prompts aun</small>
                ) : (
                  selectedData.prompts.map((prompt, idx) => (
                    <div key={`${selectedNode.id}-${idx}`} style={{ display: 'flex', gap: 6 }}>
                      <input
                        value={prompt}
                        onChange={(event) => {
                          const next = selectedData.prompts.map((item, i) =>
                            i === idx ? event.target.value : item,
                          );
                          updateNodeData(selectedNode.id, { prompts: next });
                        }}
                        style={inputStyle}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          updateNodeData(selectedNode.id, {
                            prompts: selectedData.prompts.filter((_, i) => i !== idx),
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
            </>
          )}
        </aside>
      </div>
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
