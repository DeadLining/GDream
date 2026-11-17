import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';

/** Comparison is read-only; expand restores the original editable image nodes. */
export default memo(function FrameComparisonNode({id, data, selected}: NodeProps) {
  const [showTarget, setShowTarget] = useState(false);
  const planned = data.comparisonPlanned;
  return <div onClick={() => setShowTarget(false)} className={`relative h-full w-full rounded-2xl border bg-neutral-900 text-neutral-200 ${selected ? 'border-white/70' : 'border-white/15'}`}>
    <div className="absolute -top-6 text-[11px] text-neutral-400">{String(data.lineageLabel || '镜头尾帧')} · 对比</div>
    <Handle type="target" position={Position.Left} isConnectable={false} style={{top:'35%'}} />
    <Handle type="source" position={Position.Right} isConnectable={false} style={{top:'35%'}} />
    <Handle id="planned-in" type="target" position={Position.Left} isConnectable={false} style={{top:'85%'}} />
    <Handle id="planned-out" type="source" position={Position.Right} isConnectable={false} style={{top:'85%'}} />
    <img src={showTarget ? planned.url : data.generatedImageUrl} alt={showTarget ? '生成前的目标尾帧' : '从视频提取的实际末帧'} className="h-full w-full rounded-2xl object-contain" />
    <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-[10px]">
      {showTarget ? '目标尾帧 · 生成输入（只读对比）' : '实际末帧 · 视频提取'}
    </div>
    <div className="nodrag nopan absolute bottom-0 left-0 right-0 flex items-center justify-between gap-2 rounded-b-2xl bg-neutral-950/90 px-2 py-2 text-[10px]">
      <button className="rounded px-1 py-1 hover:bg-white/10" onClick={e => {e.stopPropagation(); setShowTarget(!showTarget);}}>{showTarget ? '查看实际末帧' : '对比目标尾帧'}</button>
      <span className="text-neutral-500" title={planned.usages.join('\n')}>目标输入 ↗</span>
      <button className="rounded px-1 py-1 hover:bg-white/10" onClick={e => {e.stopPropagation(); data.expandComparison(id);}}>拆开编辑</button>
    </div>
  </div>;
});
