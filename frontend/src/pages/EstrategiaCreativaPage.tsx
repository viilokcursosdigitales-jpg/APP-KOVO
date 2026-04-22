import { useEffect, useMemo, useRef, useState } from 'react';
import { ds } from '../design-system/ds';

type Tone = 'neutral' | 'info' | 'success' | 'warning';
type NodeKind = 'producto' | 'angulo' | 'hook' | 'formato' | 'estructura' | 'creativo';
type Position = { x: number; y: number };
type Viewport = { x: number; y: number; scale: number };
type ConnectionStyle = 'curva' | 'recta' | 'ortogonal';
type Connection = {
  id: string;
  from: string;
  to: string;
  fromAnchor: Position;
  toAnchor: Position;
  style: ConnectionStyle;
};
type BoardNode = {
  id: string;
  kind: NodeKind;
  title: string;
  tone: Tone;
  position: Position;
};
type NodeData = {
  productName: string;
  productImageSrc: string;
  objective: string;
  structure: string;
  description: string;
  prompts: string[];
};
type NodeDataMap = Record<string, NodeData>;
type NodeStatus = 'guardado' | 'sin_guardar';
type NodeStatusMap = Record<string, NodeStatus>;
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
type ConnectionHandleDragState = {
  connectionId: string;
  end: 'from' | 'to';
  startX: number;
  startY: number;
  originAnchor: Position;
} | null;

const PRODUCT_NODE_ID = 'producto-1';
const BOARD_SIZE = 8000;
const BOARD_CENTER = BOARD_SIZE / 2;
const PRODUCT_DEFAULT_POS: Position = { x: BOARD_CENTER, y: BOARD_CENTER };
const EMPTY_NODE_DATA: NodeData = {
  productName: '',
  productImageSrc: '',
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

function getNodeCenter(node: BoardNode, size: { width: number; height: number }): Position {
  const { width, height } = size;
  return {
    x: node.position.x + width / 2,
    y: node.position.y + height / 2,
  };
}

function getNodeSizeByKind(kind: NodeKind): { width: number; height: number } {
  if (kind === 'producto') return { width: 240, height: 330 };
  if (kind === 'angulo') return { width: 210, height: 272 };
  if (kind === 'hook') return { width: 210, height: 220 };
  if (kind === 'formato') return { width: 210, height: 248 };
  if (kind === 'estructura') return { width: 210, height: 248 };
  if (kind === 'creativo') return { width: 240, height: 280 };
  return { width: 210, height: 124 };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function snapAnchorToNearestSide(
  node: BoardNode,
  anchor: Position,
  size: { width: number; height: number },
): Position {
  const { width, height } = size;
  const halfW = width / 2;
  const halfH = height / 2;
  const x = clamp(anchor.x, -halfW, halfW);
  const y = clamp(anchor.y, -halfH, halfH);

  const distLeft = Math.abs(x + halfW);
  const distRight = Math.abs(halfW - x);
  const distTop = Math.abs(y + halfH);
  const distBottom = Math.abs(halfH - y);
  const minDist = Math.min(distLeft, distRight, distTop, distBottom);

  if (minDist === distLeft) return { x: -halfW, y: 0 };
  if (minDist === distRight) return { x: halfW, y: 0 };
  if (minDist === distTop) return { x: 0, y: -halfH };
  return { x: 0, y: halfH };
}

function getSmartSideAnchor(
  node: BoardNode,
  target: BoardNode,
  nodeSize: { width: number; height: number },
  targetSize: { width: number; height: number },
): Position {
  const { width, height } = nodeSize;
  const halfW = width / 2;
  const halfH = height / 2;
  const fromCenter = getNodeCenter(node, nodeSize);
  const toCenter = getNodeCenter(target, targetSize);
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx >= 0) return { x: halfW, y: 0 };
    return { x: -halfW, y: 0 };
  }
  if (dy >= 0) return { x: 0, y: halfH };
  return { x: 0, y: -halfH };
}

function overlapsExistingNodes(
  candidate: Position,
  kind: NodeKind,
  existingNodes: BoardNode[],
  gap = 20,
): boolean {
  const size = getNodeSizeByKind(kind);
  const left = candidate.x;
  const top = candidate.y;
  const right = candidate.x + size.width;
  const bottom = candidate.y + size.height;

  return existingNodes.some((node) => {
    const nsize = getNodeSizeByKind(node.kind);
    const nleft = node.position.x;
    const ntop = node.position.y;
    const nright = node.position.x + nsize.width;
    const nbottom = node.position.y + nsize.height;
    return (
      left < nright + gap &&
      right + gap > nleft &&
      top < nbottom + gap &&
      bottom + gap > ntop
    );
  });
}

function findAvailablePosition(
  desired: Position,
  kind: NodeKind,
  existingNodes: BoardNode[],
): Position {
  const size = getNodeSizeByKind(kind);
  const clampCandidate = (p: Position): Position => ({
    x: clamp(p.x, 0, BOARD_SIZE - size.width),
    y: clamp(p.y, 0, BOARD_SIZE - size.height),
  });

  const base = clampCandidate(desired);
  if (!overlapsExistingNodes(base, kind, existingNodes)) return base;

  const step = 26;
  for (let layer = 1; layer <= 60; layer += 1) {
    const points: Position[] = [];
    const l = layer * step;

    for (let i = -layer; i <= layer; i += 1) {
      points.push({ x: base.x + i * step, y: base.y - l });
      points.push({ x: base.x + i * step, y: base.y + l });
    }
    for (let j = -layer + 1; j <= layer - 1; j += 1) {
      points.push({ x: base.x - l, y: base.y + j * step });
      points.push({ x: base.x + l, y: base.y + j * step });
    }

    for (const point of points) {
      const candidate = clampCandidate(point);
      if (!overlapsExistingNodes(candidate, kind, existingNodes)) return candidate;
    }
  }
  return base;
}

function buildCurvePath(start: Position, end: Position): string {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dir = dx === 0 ? 1 : Math.sign(dx);
  const curve = Math.min(280, Math.max(70, Math.abs(dx) * 0.42));
  const c1x = start.x + dir * curve;
  const c1y = start.y + dy * 0.12;
  const c2x = end.x - dir * curve;
  const c2y = end.y - dy * 0.12;
  return `M ${start.x} ${start.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${end.x} ${end.y}`;
}

function buildStraightPath(start: Position, end: Position): string {
  return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
}

function buildOrthogonalPath(start: Position, end: Position): string {
  const midX = start.x + (end.x - start.x) * 0.5;
  return `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`;
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
  const [nodeStatus, setNodeStatus] = useState<NodeStatusMap>({});
  const [selectedNodeId, setSelectedNodeId] = useState<string>(PRODUCT_NODE_ID);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [editorNodeId, setEditorNodeId] = useState<string | null>(null);
  const [newPrompt, setNewPrompt] = useState('');
  const [nodeDrag, setNodeDrag] = useState<NodeDragState>(null);
  const [panDrag, setPanDrag] = useState<PanDragState>(null);
  const [connectionHandleDrag, setConnectionHandleDrag] = useState<ConnectionHandleDragState>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: -3600, y: -3750, scale: 1 });
  const [nodeSizeMap, setNodeSizeMap] = useState<Record<string, { width: number; height: number }>>({});

  const boardRef = useRef<HTMLDivElement | null>(null);
  const productImageInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const saveTimersRef = useRef<Record<string, number | undefined>>({});
  const angleSequenceRef = useRef(1);
  const hookSequenceRef = useRef(1);
  const formatoSequenceRef = useRef(1);
  const estructuraSequenceRef = useRef(1);
  const creativoSequenceRef = useRef(1);
  const connectionSequenceRef = useRef(1);
  const productImageObjectUrlsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    return () => {
      for (const url of Object.values(productImageObjectUrlsRef.current)) {
        if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
      }
      for (const timerId of Object.values(saveTimersRef.current)) {
        if (timerId) window.clearTimeout(timerId);
      }
    };
  }, []);

  const selectedNode = nodes.find((n) => n.id === (editorNodeId || selectedNodeId)) || null;
  const selectedConnection = selectedConnectionId
    ? connections.find((line) => line.id === selectedConnectionId) || null
    : null;
  const selectedData = selectedNode ? getNodeData(nodeData, selectedNode.id) : EMPTY_NODE_DATA;

  const angleNodes = useMemo(() => nodes.filter((node) => node.kind === 'angulo'), [nodes]);
  const hookNodes = useMemo(() => nodes.filter((node) => node.kind === 'hook'), [nodes]);
  const formatoNodes = useMemo(() => nodes.filter((node) => node.kind === 'formato'), [nodes]);
  const estructuraNodes = useMemo(() => nodes.filter((node) => node.kind === 'estructura'), [nodes]);
  const creativoNodes = useMemo(() => nodes.filter((node) => node.kind === 'creativo'), [nodes]);
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

  const getNodeRenderSize = (node: BoardNode): { width: number; height: number } =>
    nodeSizeMap[node.id] || getNodeSizeByKind(node.kind);

  const markNodeChanged = (nodeId: string) => {
    setNodeStatus((prev) => ({ ...prev, [nodeId]: 'sin_guardar' }));
    const prevTimer = saveTimersRef.current[nodeId];
    if (prevTimer) window.clearTimeout(prevTimer);
    saveTimersRef.current[nodeId] = window.setTimeout(() => {
      setNodeStatus((prev) => ({ ...prev, [nodeId]: 'guardado' }));
      saveTimersRef.current[nodeId] = undefined;
    }, 700);
  };

  const updateNodeData = (nodeId: string, patch: Partial<NodeData>) => {
    markNodeChanged(nodeId);
    setNodeData((prev) => ({
      ...prev,
      [nodeId]: { ...(prev[nodeId] || EMPTY_NODE_DATA), ...patch },
    }));
  };

  const createConnection = (
    from: string,
    to: string,
    fromNodeOverride?: BoardNode,
    toNodeOverride?: BoardNode,
  ): Connection => {
    const id = `conn-${connectionSequenceRef.current}`;
    connectionSequenceRef.current += 1;
    const fromNode = fromNodeOverride || nodes.find((node) => node.id === from);
    const toNode = toNodeOverride || nodes.find((node) => node.id === to);
    const fromAnchor =
      fromNode && toNode
        ? getSmartSideAnchor(fromNode, toNode, getNodeRenderSize(fromNode), getNodeRenderSize(toNode))
        : { x: 0, y: 0 };
    const toAnchor =
      fromNode && toNode
        ? getSmartSideAnchor(toNode, fromNode, getNodeRenderSize(toNode), getNodeRenderSize(fromNode))
        : { x: 0, y: 0 };
    return {
      id,
      from,
      to,
      fromAnchor,
      toAnchor,
      style: 'curva',
    };
  };

  const addAngleFromProduct = () => {
    const angleIndex = angleSequenceRef.current;
    angleSequenceRef.current += 1;
    const nodeId = `angulo-${angleIndex}`;
    const desiredPosition: Position = {
      x: PRODUCT_DEFAULT_POS.x + 320,
      y: PRODUCT_DEFAULT_POS.y - 80 + angleIndex * 86,
    };
    const position = findAvailablePosition(desiredPosition, 'angulo', nodes);
    const newNode: BoardNode = {
      id: nodeId,
      kind: 'angulo',
      title: `Angulo de venta ${angleIndex}`,
      tone: 'info',
      position,
    };

    setNodes((prev) => [...prev, newNode]);
    setNodeStatus((prev) => ({ ...prev, [nodeId]: 'guardado' }));
    const productNode = nodes.find((node) => node.id === PRODUCT_NODE_ID);
    setConnections((prev) => [...prev, createConnection(PRODUCT_NODE_ID, nodeId, productNode, newNode)]);
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
      for (const nodeId of toRemove) {
        const blobUrl = productImageObjectUrlsRef.current[nodeId];
        if (blobUrl && blobUrl.startsWith('blob:')) URL.revokeObjectURL(blobUrl);
        const timerId = saveTimersRef.current[nodeId];
        if (timerId) window.clearTimeout(timerId);
        delete saveTimersRef.current[nodeId];
        delete productImageObjectUrlsRef.current[nodeId];
        delete next[nodeId];
      }
      return next;
    });
    setNodeStatus((prev) => {
      const next = { ...prev };
      for (const nodeId of toRemove) delete next[nodeId];
      return next;
    });
    if (selectedNodeId && toRemove.has(selectedNodeId)) setSelectedNodeId(fallbackSelectedNodeId);
    if (editorNodeId && toRemove.has(editorNodeId)) {
      setEditorNodeId(null);
      setNewPrompt('');
    }
    setSelectedConnectionId((prev) => {
      if (!prev) return null;
      const stillExists = connections.some(
        (line) => line.id === prev && !toRemove.has(line.from) && !toRemove.has(line.to),
      );
      return stillExists ? prev : null;
    });
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
    const desiredPosition: Position = {
      x: angleNode.position.x + 300,
      y: angleNode.position.y + 14,
    };
    const newNode: BoardNode = {
      id: nodeId,
      kind: 'hook',
      title: `Hook ${hookIndex}`,
      tone: 'neutral',
      position: findAvailablePosition(desiredPosition, 'hook', nodes),
    };

    setNodes((prev) => [...prev, newNode]);
    setNodeStatus((prev) => ({ ...prev, [nodeId]: 'guardado' }));
    setConnections((prev) => [...prev, createConnection(angleId, nodeId, angleNode, newNode)]);
    setSelectedNodeId(nodeId);
    setEditorNodeId(nodeId);
    setNewPrompt('');
  };

  const addFormatoFromHook = (hookId: string) => {
    const hookNode = nodes.find((node) => node.id === hookId);
    if (!hookNode) return;
    if (getChildrenByParent(hookId, 'formato').length > 0) return;

    const formatoIndex = formatoSequenceRef.current;
    formatoSequenceRef.current += 1;
    const nodeId = `formato-${formatoIndex}`;
    const desiredPosition: Position = {
      x: hookNode.position.x + 300,
      y: hookNode.position.y + 18,
    };
    const newNode: BoardNode = {
      id: nodeId,
      kind: 'formato',
      title: `Formato ${formatoIndex}`,
      tone: 'success',
      position: findAvailablePosition(desiredPosition, 'formato', nodes),
    };

    setNodes((prev) => [...prev, newNode]);
    setNodeStatus((prev) => ({ ...prev, [nodeId]: 'guardado' }));
    setConnections((prev) => [...prev, createConnection(hookId, nodeId, hookNode, newNode)]);
    setSelectedNodeId(nodeId);
    setEditorNodeId(nodeId);
    setNewPrompt('');
  };

  const addEstructuraFromFormato = (formatoId: string) => {
    const formatoNode = nodes.find((node) => node.id === formatoId);
    if (!formatoNode) return;
    if (getChildrenByParent(formatoId, 'estructura').length > 0) return;

    const estructuraIndex = estructuraSequenceRef.current;
    estructuraSequenceRef.current += 1;
    const nodeId = `estructura-${estructuraIndex}`;
    const desiredPosition: Position = {
      x: formatoNode.position.x + 300,
      y: formatoNode.position.y + 18,
    };
    const newNode: BoardNode = {
      id: nodeId,
      kind: 'estructura',
      title: `Estructura ${estructuraIndex}`,
      tone: 'warning',
      position: findAvailablePosition(desiredPosition, 'estructura', nodes),
    };

    setNodes((prev) => [...prev, newNode]);
    setNodeStatus((prev) => ({ ...prev, [nodeId]: 'guardado' }));
    setConnections((prev) => [...prev, createConnection(formatoId, nodeId, formatoNode, newNode)]);
    setSelectedNodeId(nodeId);
    setEditorNodeId(nodeId);
    setNewPrompt('');
  };

  const addCreativoFromEstructura = (estructuraId: string) => {
    const estructuraNode = nodes.find((node) => node.id === estructuraId);
    if (!estructuraNode) return;
    if (getChildrenByParent(estructuraId, 'creativo').length > 0) return;

    const creativoIndex = creativoSequenceRef.current;
    creativoSequenceRef.current += 1;
    const nodeId = `creativo-${creativoIndex}`;
    const desiredPosition: Position = {
      x: estructuraNode.position.x + 320,
      y: estructuraNode.position.y + 18,
    };
    const newNode: BoardNode = {
      id: nodeId,
      kind: 'creativo',
      title: `Creativo ${creativoIndex}`,
      tone: 'info',
      position: findAvailablePosition(desiredPosition, 'creativo', nodes),
    };

    setNodes((prev) => [...prev, newNode]);
    setNodeStatus((prev) => ({ ...prev, [nodeId]: 'guardado' }));
    setConnections((prev) => [...prev, createConnection(estructuraId, nodeId, estructuraNode, newNode)]);
    setSelectedNodeId(nodeId);
    setEditorNodeId(nodeId);
    setNewPrompt('');
  };

  const clearBoard = () => {
    for (const url of Object.values(productImageObjectUrlsRef.current)) {
      if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
    }
    for (const timerId of Object.values(saveTimersRef.current)) {
      if (timerId) window.clearTimeout(timerId);
    }
    saveTimersRef.current = {};
    productImageObjectUrlsRef.current = {};
    angleSequenceRef.current = 1;
    hookSequenceRef.current = 1;
    formatoSequenceRef.current = 1;
    estructuraSequenceRef.current = 1;
    creativoSequenceRef.current = 1;
    connectionSequenceRef.current = 1;
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
    setNodeStatus({});
    setSelectedNodeId(PRODUCT_NODE_ID);
    setSelectedConnectionId(null);
    setEditorNodeId(null);
    setNodeDrag(null);
    setPanDrag(null);
    setConnectionHandleDrag(null);
    setNewPrompt('');
  };

  const autoArrangeConnections = () => {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    setConnections((prev) =>
      prev.map((line) => {
        const fromNode = nodeMap.get(line.from);
        const toNode = nodeMap.get(line.to);
        const fromAnchor =
          fromNode && toNode
            ? getSmartSideAnchor(fromNode, toNode, getNodeRenderSize(fromNode), getNodeRenderSize(toNode))
            : { x: 0, y: 0 };
        const toAnchor =
          fromNode && toNode
            ? getSmartSideAnchor(toNode, fromNode, getNodeRenderSize(toNode), getNodeRenderSize(fromNode))
            : { x: 0, y: 0 };

        return {
          ...line,
          style: line.style || 'curva',
          fromAnchor,
          toAnchor,
        };
      }),
    );
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
    if (target.closest('[data-connection-handle]')) return;
    if (target.closest('[data-connection-path]')) return;
    if (target.closest('[data-node-id]')) return;
    setPanDrag({
      startX: event.clientX,
      startY: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
    });
  };

  const onBoardMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (connectionHandleDrag) {
      const dx = (event.clientX - connectionHandleDrag.startX) / viewport.scale;
      const dy = (event.clientY - connectionHandleDrag.startY) / viewport.scale;
      const nextAnchor = {
        x: connectionHandleDrag.originAnchor.x + dx,
        y: connectionHandleDrag.originAnchor.y + dy,
      };
      setConnections((prev) =>
        prev.map((line) =>
          line.id === connectionHandleDrag.connectionId
            ? connectionHandleDrag.end === 'from'
              ? { ...line, fromAnchor: nextAnchor }
              : { ...line, toAnchor: nextAnchor }
            : line,
        ),
      );
      return;
    }

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
    if (connectionHandleDrag) {
      setConnections((prev) =>
        prev.map((line) => {
          if (line.id !== connectionHandleDrag.connectionId) return line;
          const targetNodeId = connectionHandleDrag.end === 'from' ? line.from : line.to;
          const targetNode = nodes.find((node) => node.id === targetNodeId);
          if (!targetNode) return line;
          const targetSize = getNodeRenderSize(targetNode);
          if (connectionHandleDrag.end === 'from') {
            return { ...line, fromAnchor: snapAnchorToNearestSide(targetNode, line.fromAnchor, targetSize) };
          }
          return { ...line, toAnchor: snapAnchorToNearestSide(targetNode, line.toAnchor, targetSize) };
        }),
      );
    }
    setNodeDrag(null);
    setPanDrag(null);
    setConnectionHandleDrag(null);
  };

  const focusNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setSelectedConnectionId(null);
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
              Tablero infinito: rueda para zoom, arrastra fondo para mover el canvas y ajusta conectores desde ambos puntos.
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
                const fromCenter = getNodeCenter(from, getNodeRenderSize(from));
                const toCenter = getNodeCenter(to, getNodeRenderSize(to));
                const start = {
                  x: fromCenter.x + line.fromAnchor.x,
                  y: fromCenter.y + line.fromAnchor.y,
                };
                const end = {
                  x: toCenter.x + line.toAnchor.x,
                  y: toCenter.y + line.toAnchor.y,
                };
                const style = line.style || 'curva';
                const path =
                  style === 'recta'
                    ? buildStraightPath(start, end)
                    : style === 'ortogonal'
                      ? buildOrthogonalPath(start, end)
                      : buildCurvePath(start, end);
                const isSelected = selectedConnectionId === line.id;
                return (
                  <g key={line.id || `${line.from}-${line.to}-${idx}`}>
                    <path
                      data-connection-path={line.id}
                      d={path}
                      stroke={ds.brand}
                      strokeWidth={isSelected ? 2.4 : 1.8}
                      fill="none"
                      opacity={isSelected ? 1 : 0.88}
                      style={{ pointerEvents: 'all', cursor: 'pointer' }}
                      onMouseDown={(event) => {
                        event.stopPropagation();
                        setSelectedConnectionId(line.id);
                        setEditorNodeId(null);
                      }}
                    />
                    <circle
                      data-connection-handle="from"
                      cx={start.x}
                      cy={start.y}
                      r={isSelected ? 6.5 : 5.5}
                      fill={isSelected ? ds.brandBg : ds.bgCard}
                      stroke={ds.brand}
                      strokeWidth={1.5}
                      style={{ pointerEvents: 'all', cursor: 'pointer' }}
                      onMouseDown={(event) => {
                        event.stopPropagation();
                        setSelectedConnectionId(line.id);
                        setEditorNodeId(null);
                        setConnectionHandleDrag({
                          connectionId: line.id,
                          end: 'from',
                          startX: event.clientX,
                          startY: event.clientY,
                          originAnchor: line.fromAnchor,
                        });
                      }}
                    />
                    <circle
                      data-connection-handle="to"
                      cx={end.x}
                      cy={end.y}
                      r={isSelected ? 6.5 : 5.5}
                      fill={isSelected ? ds.brandBg : ds.bgCard}
                      stroke={ds.brand}
                      strokeWidth={1.5}
                      style={{ pointerEvents: 'all', cursor: 'pointer' }}
                      onMouseDown={(event) => {
                        event.stopPropagation();
                        setSelectedConnectionId(line.id);
                        setEditorNodeId(null);
                        setConnectionHandleDrag({
                          connectionId: line.id,
                          end: 'to',
                          startX: event.clientX,
                          startY: event.clientY,
                          originAnchor: line.toAnchor,
                        });
                      }}
                    />
                  </g>
                );
              })}
            </svg>

            {nodes.map((node) => {
              const palette = toneColorMap(node.tone);
              const active = selectedNodeId === node.id;
              const data = getNodeData(nodeData, node.id);
              const nodeSize = getNodeRenderSize(node);
              const productIsNode = node.kind === 'producto';
              const angleIsNode = node.kind === 'angulo';
              const hookIsNode = node.kind === 'hook';
              const formatoIsNode = node.kind === 'formato';
              const estructuraIsNode = node.kind === 'estructura';
              const creativoIsNode = node.kind === 'creativo';
              const productName = data.productName.trim();
              const displayTitle = productIsNode && productName ? productName : node.title;
              const showAnglesInsideProduct = productIsNode && connectedAngles.length > 0;
              const connectedHooks = angleIsNode ? getChildrenByParent(node.id, 'hook') : [];
              const connectedFormatos = hookIsNode ? getChildrenByParent(node.id, 'formato') : [];
              const connectedEstructuras = formatoIsNode ? getChildrenByParent(node.id, 'estructura') : [];
              const connectedCreativos = estructuraIsNode ? getChildrenByParent(node.id, 'creativo') : [];
              const cardOverflowVisible =
                productIsNode ||
                angleIsNode ||
                hookIsNode ||
                formatoIsNode ||
                estructuraIsNode ||
                creativoIsNode;
              const nodeKindLabel = productIsNode
                ? 'Producto base'
                : angleIsNode
                  ? 'Angulo de venta'
                  : hookIsNode
                    ? 'Hook'
                    : formatoIsNode
                      ? 'Formato'
                      : estructuraIsNode
                        ? 'Estructura'
                        : creativoIsNode
                          ? 'Creativo'
                          : 'Cuadro';
              return (
                <div
                  key={node.id}
                  data-node-id={node.id}
                  ref={(el) => {
                    if (!el) return;
                    const nextSize = { width: el.offsetWidth, height: el.offsetHeight };
                    setNodeSizeMap((prev) => {
                      const prevSize = prev[node.id];
                      if (
                        prevSize &&
                        prevSize.width === nextSize.width &&
                        prevSize.height === nextSize.height
                      ) {
                        return prev;
                      }
                      return { ...prev, [node.id]: nextSize };
                    });
                  }}
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
                    width: nodeSize.width,
                    minHeight: nodeSize.height,
                    border: `1px solid ${palette.border}`,
                    borderRadius: 10,
                    background: palette.fill,
                    padding: '8px 10px',
                    overflowY: cardOverflowVisible ? 'visible' : 'auto',
                    cursor: 'grab',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: 12, color: ds.textPrimary, fontWeight: 800 }}>{displayTitle}</strong>
                    {active ? <span style={{ ...counterBadgeStyle, color: ds.brand }}>Activo</span> : null}
                  </div>

                  <p style={{ margin: '6px 0', fontSize: 11, color: ds.textMuted }}>
                    {data.objective || nodeKindLabel}
                  </p>

                  {productIsNode ? (
                    <div style={{ display: 'grid', gap: 6, marginBottom: 6 }}>
                      <div
                        style={{
                          border: `1px solid ${ds.borderCard}`,
                          borderRadius: 8,
                          background: ds.bgCard,
                          padding: 6,
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                      >
                        <label
                          htmlFor={`product-image-input-${node.id}`}
                          style={{
                            width: '100%',
                            height: 98,
                            borderRadius: 6,
                            border: `1px dashed ${ds.borderCard}`,
                            display: 'block',
                            marginBottom: 6,
                            cursor: 'pointer',
                            overflow: 'hidden',
                            position: 'relative',
                            background: ds.bgSubtle,
                          }}
                        >
                          {data.productImageSrc ? (
                            <img
                              src={data.productImageSrc}
                              alt={productName || 'Producto'}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : (
                            <div
                              style={{
                                width: '100%',
                                height: '100%',
                                display: 'grid',
                                placeItems: 'center',
                              }}
                            >
                              <span style={{ ...actionBtnStyle('secondary'), fontSize: 11 }}>
                                Seleccionar archivo
                              </span>
                            </div>
                          )}
                        </label>
                        <input
                          id={`product-image-input-${node.id}`}
                          ref={(el) => {
                            productImageInputRefs.current[node.id] = el;
                          }}
                          type="file"
                          accept="image/*"
                          onChange={(event) => {
                            event.stopPropagation();
                            const file = event.target.files?.[0];
                            if (!file) return;
                            const previous = productImageObjectUrlsRef.current[node.id];
                            if (previous && previous.startsWith('blob:')) URL.revokeObjectURL(previous);
                            const blobUrl = URL.createObjectURL(file);
                            productImageObjectUrlsRef.current[node.id] = blobUrl;
                            updateNodeData(node.id, { productImageSrc: blobUrl });
                          }}
                          style={{ display: 'none' }}
                        />
                        <div style={{ display: 'grid', gap: 6 }}>
                          <input
                            value={data.productName}
                            onChange={(event) => updateNodeData(node.id, { productName: event.target.value })}
                            placeholder="Nombre del producto"
                            style={inputStyle}
                          />
                          {data.productImageSrc ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                productImageInputRefs.current[node.id]?.click();
                              }}
                              style={{ ...actionBtnStyle('secondary'), fontSize: 11 }}
                            >
                              Cambiar imagen
                            </button>
                          ) : null}
                        </div>
                      </div>
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
                      <input
                        value={node.title}
                        onChange={(event) => {
                          const value = event.target.value;
                          markNodeChanged(node.id);
                          setNodes((prev) =>
                            prev.map((item) => (item.id === node.id ? { ...item, title: value } : item)),
                          );
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                        placeholder="Nombre del angulo de venta"
                        style={inputStyle}
                      />
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

                  {hookIsNode ? (
                    <div style={{ display: 'grid', gap: 6, marginBottom: 6 }}>
                      {connectedFormatos.length === 0 ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            addFormatoFromHook(node.id);
                          }}
                          style={{ ...actionBtnStyle('secondary'), fontSize: 11, padding: '5px 8px' }}
                        >
                          + Agregar formato
                        </button>
                      ) : (
                        <div style={{ display: 'grid', gap: 4 }}>
                          {connectedFormatos.map((formato) => (
                            <div
                              key={`hook-formato-${formato.id}`}
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
                                  focusNode(formato.id);
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
                                {formato.title}
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  removeNodeCascade(formato.id, node.id);
                                }}
                                style={{ ...actionBtnStyle('ghost'), fontSize: 10, padding: '3px 6px' }}
                              >
                                Quitar
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}

                  {formatoIsNode ? (
                    <div style={{ display: 'grid', gap: 6, marginBottom: 6 }}>
                      <input
                        value={node.title}
                        onChange={(event) => {
                          const value = event.target.value;
                          markNodeChanged(node.id);
                          setNodes((prev) =>
                            prev.map((item) => (item.id === node.id ? { ...item, title: value } : item)),
                          );
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                        placeholder="Nombre del formato"
                        style={inputStyle}
                      />
                      {connectedEstructuras.length === 0 ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            addEstructuraFromFormato(node.id);
                          }}
                          style={{ ...actionBtnStyle('secondary'), fontSize: 11, padding: '5px 8px' }}
                        >
                          + Agregar estructura
                        </button>
                      ) : (
                        <div style={{ display: 'grid', gap: 4 }}>
                          {connectedEstructuras.map((estructura) => (
                            <div
                              key={`formato-estructura-${estructura.id}`}
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
                                  focusNode(estructura.id);
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
                                {estructura.title}
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  removeNodeCascade(estructura.id, node.id);
                                }}
                                style={{ ...actionBtnStyle('ghost'), fontSize: 10, padding: '3px 6px' }}
                              >
                                Quitar
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}

                  {estructuraIsNode ? (
                    <div style={{ display: 'grid', gap: 6, marginBottom: 6 }}>
                      <input
                        value={node.title}
                        onChange={(event) => {
                          const value = event.target.value;
                          markNodeChanged(node.id);
                          setNodes((prev) =>
                            prev.map((item) => (item.id === node.id ? { ...item, title: value } : item)),
                          );
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                        placeholder="Nombre de la estructura"
                        style={inputStyle}
                      />
                      {connectedCreativos.length === 0 ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            addCreativoFromEstructura(node.id);
                          }}
                          style={{ ...actionBtnStyle('secondary'), fontSize: 11, padding: '5px 8px' }}
                        >
                          + Agregar creativo
                        </button>
                      ) : (
                        <div style={{ display: 'grid', gap: 4 }}>
                          {connectedCreativos.map((creativo) => (
                            <div
                              key={`estructura-creativo-${creativo.id}`}
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
                                  focusNode(creativo.id);
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
                                {creativo.title}
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  removeNodeCascade(creativo.id, node.id);
                                }}
                                style={{ ...actionBtnStyle('ghost'), fontSize: 10, padding: '3px 6px' }}
                              >
                                Quitar
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}

                  {creativoIsNode ? (
                    <p style={{ margin: '0 0 6px', fontSize: 11, color: ds.textMuted }}>
                      Pieza final: usa <strong>Archivos</strong> para referencias y prompts.
                    </p>
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
                      Archivos ({data.prompts.length})
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
              <span style={counterBadgeStyle}>{formatoNodes.length} formatos</span>
              <span style={counterBadgeStyle}>{estructuraNodes.length} estructuras</span>
              <span style={counterBadgeStyle}>{creativoNodes.length} creativos</span>
              <span style={counterBadgeStyle}>{totalPrompts} archivos</span>
            </div>
            <div style={{ marginTop: 8 }}>
              <button type="button" onClick={autoArrangeConnections} style={{ ...actionBtnStyle('secondary'), width: '100%' }}>
                Autoordenar conectores
              </button>
            </div>
          </div>

          {selectedConnection ? (
            <div
              style={{
                border: `1px solid ${ds.borderCard}`,
                borderRadius: 10,
                padding: 10,
                marginBottom: 10,
                background: ds.bgSubtle,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: ds.textPrimary, marginBottom: 8 }}>
                Conexion seleccionada
              </div>
              <div style={{ fontSize: 11, color: ds.textMuted, marginBottom: 8 }}>
                {selectedConnection.from} {'->'} {selectedConnection.to}
              </div>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 11, color: ds.textSecondary }}>Estilo de linea</span>
                <select
                  value={selectedConnection.style}
                  onChange={(event) => {
                    const nextStyle = event.target.value as ConnectionStyle;
                    setConnections((prev) =>
                      prev.map((line) =>
                        line.id === selectedConnection.id ? { ...line, style: nextStyle } : line,
                      ),
                    );
                  }}
                  style={inputStyle}
                >
                  <option value="curva">Curva</option>
                  <option value="recta">Recta</option>
                  <option value="ortogonal">Ortogonal</option>
                </select>
              </label>
            </div>
          ) : null}

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
              Haz clic en el boton <strong>Archivos</strong> de un cuadro para abrir su editor.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'grid', gap: 2 }}>
                  <strong style={{ color: ds.textPrimary, fontSize: 12 }}>
                    Editor:{' '}
                    {selectedNode.kind === 'producto' && selectedData.productName.trim()
                      ? selectedData.productName.trim()
                      : selectedNode.title}
                  </strong>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: nodeStatus[selectedNode.id] === 'sin_guardar' ? ds.warningText : ds.successText,
                    }}
                  >
                    {nodeStatus[selectedNode.id] === 'sin_guardar' ? 'Sin guardar' : 'Guardado'}
                  </span>
                </div>
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
                <strong style={{ color: ds.textPrimary, fontSize: 13 }}>Archivos</strong>
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
                  <small style={{ color: ds.textHint }}>Sin archivos aun</small>
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
