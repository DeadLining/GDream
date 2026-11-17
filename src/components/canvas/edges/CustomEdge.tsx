import { memo, useState, useCallback } from 'react';
import { BaseEdge, getBezierPath } from 'reactflow';
import type { EdgeProps } from 'reactflow';
import { X } from 'lucide-react';
import { useCanvasStore } from '@/stores/canvasStore';
import { CANVAS_THEME } from '@/lib/canvas/theme';
import { captureSnapshot } from '@/lib/canvas/history';

function CustomEdgeComponent({
  id, source, target, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, style = {}, markerEnd, selected, data,
}: EdgeProps) {
  const [isHovered, setIsHovered] = useState(false);
  // dashdraw flow while the TARGET node is generating — reads "素材正流入
  // 生成中的节点". Selector is per-edge and cheap.
  const { targetGenerating, selectedNodeId, sourceSelected, targetSelected } = useCanvasStore((s) => {
    const sourceNode = s.nodes.find((x) => x.id === source);
    const targetNode = s.nodes.find((x) => x.id === target);
    return {
      targetGenerating: Boolean((targetNode?.data as Record<string, unknown> | undefined)?.isGenerating),
      selectedNodeId: s.selectedNodeId,
      sourceSelected: Boolean(sourceNode?.selected),
      targetSelected: Boolean(targetNode?.selected),
    };
  });
  // When a node is selected, make its direct inputs and outputs visibly flow.
  // This is a presentation-only state: no edge data or persisted canvas state
  // is changed, and lineage locks remain respected.
  const connectedToSelection = selectedNodeId === source || selectedNodeId === target || sourceSelected || targetSelected;

  const isLineage = Boolean(data?.lineage);
  const lineageLabel = typeof data?.lineageLabel === 'string' ? data.lineageLabel : '';
  const lineageRelation = typeof data?.lineageRelation === 'string' ? data.lineageRelation : '';
  const locked = Boolean(data?.lineageLocked);
  const routeIndex = typeof data?.lineageRouteIndex === 'number' ? data.lineageRouteIndex : 0;
  const routeX = Math.min(targetX - 24, sourceX + 80 + (routeIndex % 24) * 16);
  const edgePath = isLineage
    ? `M ${sourceX},${sourceY} C ${routeX},${sourceY} ${routeX},${targetY} ${targetX},${targetY}`
    : getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })[0];

  const isActive = isHovered || selected || connectedToSelection;

  const edgeStyle = {
    ...style,
    stroke: selected ? CANVAS_THEME.edgeSelected : isHovered ? CANVAS_THEME.edgeHover
      : lineageRelation.includes('character') ? '#b896ff'
        : lineageRelation.includes('scene') ? '#5dd7e8'
          : lineageRelation.includes('prop') ? '#f5b85b'
            : lineageRelation.includes('palette') ? '#ef6d78'
              : lineageRelation.includes('board') ? '#78aaf7'
                : CANVAS_THEME.edge,
    strokeWidth: isActive ? 2 : isLineage ? 1.2 : 1.5,
    opacity: isActive ? 1 : isLineage ? 0.38 : 0.6,
    transition: 'stroke 0.15s, stroke-width 0.15s, opacity 0.15s',
    ...(connectedToSelection ? { strokeDasharray: '7 5', animation: 'selectionFlow 0.75s linear infinite', filter: 'drop-shadow(0 0 3px rgba(56,189,248,0.65))' } : {}),
    ...(targetGenerating && !connectedToSelection ? { strokeDasharray: 5, animation: 'dashdraw 0.5s linear infinite' } : {}),
  };

  const handleMouseEnter = useCallback(() => setIsHovered(true), []);
  const handleMouseLeave = useCallback(() => setIsHovered(false), []);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    captureSnapshot();
    useCanvasStore.getState().deleteEdge(id);
  }, [id]);

  // Midpoint for delete button
  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;

  return (
    <g onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={edgeStyle}
        // .edge-generating applies accent color + dasharray + dashdraw keyframes
        // (defined in index.css under .canvas-dark)
      />
      {connectedToSelection && (
        <>
          <path d={edgePath} className="edge-selection-trace" aria-hidden="true" />
          <circle r="4.5" className="edge-selection-pulse" aria-hidden="true">
            <animateMotion dur="0.9s" repeatCount="indefinite" path={edgePath} />
          </circle>
          <circle r="3" className="edge-selection-pulse edge-selection-pulse-delayed" aria-hidden="true">
            <animateMotion dur="0.9s" begin="-0.45s" repeatCount="indefinite" path={edgePath} />
          </circle>
        </>
      )}
      {/* Wider invisible hit area */}
      <path d={edgePath} fill="none" stroke="transparent" strokeWidth={24} style={{ pointerEvents: 'stroke' }} />
      {isLineage && lineageLabel && isActive && (
        <foreignObject x={midX - 62} y={midY - 11} width={124} height={22} style={{ overflow: 'visible', pointerEvents: 'none' }}>
          <div className="truncate rounded-full border border-white/10 bg-neutral-950/85 px-2 py-1 text-center text-[9px] font-medium text-neutral-300 shadow-lg">
            {lineageLabel}
          </div>
        </foreignObject>
      )}
      {isActive && !locked && (
        <foreignObject x={midX - 10} y={midY - 10} width={20} height={20} style={{ overflow: 'visible' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20 }}>
            <button
              onClick={handleDelete}
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                border: 'none',
                background: 'rgba(38,38,38,0.88)',
                backdropFilter: 'blur(8px)',
                boxShadow: '0 1px 4px rgba(0,0,0,0.12), 0 0 0 1px rgba(255,255,255,0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                color: '#94a3b8',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#ef4444';
                e.currentTarget.style.color = '#fff';
                e.currentTarget.style.transform = 'scale(1.15)';
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(239,68,68,0.35)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(38,38,38,0.88)';
                e.currentTarget.style.color = '#94a3b8';
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.12), 0 0 0 1px rgba(255,255,255,0.08)';
              }}
              title="删除连线"
            >
              <X size={10} strokeWidth={2.5} />
            </button>
          </div>
        </foreignObject>
      )}
    </g>
  );
}

export default memo(CustomEdgeComponent);
