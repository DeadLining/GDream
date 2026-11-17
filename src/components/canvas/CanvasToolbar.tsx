import { useEffect, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize, Expand, Shrink, GitBranch, Loader2, LayoutGrid } from 'lucide-react';
import { useReactFlow, useViewport } from 'reactflow';
import { appWindow } from '@tauri-apps/api/window';
import { useCanvasStore } from '@/stores/canvasStore';
import { useCanvasTaskStore } from '@/stores/canvasTaskStore';
import { useProjectStore } from '@/stores/projectStore';
import { captureSnapshot } from '@/lib/canvas/history';
import { arrangeCanvasNodes } from '@/lib/canvas/arrange';
import { syncWorkshopLineageToCanvas } from '@/lib/workshop/canvasSync';

export default function CanvasToolbar() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  // useViewport subscribes to viewport changes — getZoom() during render
  // returned a stale value because zooming doesn't re-render this component.
  const { zoom } = useViewport();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [layoutMenu, setLayoutMenu] = useState(false);
  const [layoutMessage, setLayoutMessage] = useState('');
  const selectedCount = useCanvasStore(s => s.nodes.filter(n => n.selected && !n.parentNode && !n.hidden).length);
  const busy = useCanvasTaskStore(s => s.tasks.some(t => ['queued','uploading','running','downloading'].includes(t.status)));
  const arrange = async (selectedOnly: boolean) => {
    if (busy) return;
    const store = useCanvasStore.getState();
    const next = arrangeCanvasNodes(store.nodes, store.edges, selectedOnly);
    const changed = next.some((n,i) => n.position.x !== store.nodes[i].position.x || n.position.y !== store.nodes[i].position.y);
    setLayoutMenu(false);
    if (!changed) {setLayoutMessage('布局已整齐，无需调整'); return;}
    captureSnapshot();
    store.setNodes(next);
    setLayoutMessage('已整理 · ⌘Z 撤销');
    requestAnimationFrame(() => fitView({padding:0.15,duration:400}));
    try {await useProjectStore.getState().flushActiveCanvas();}
    catch {setLayoutMessage('布局已调整，但保存失败，请重试');}
  };
  const [syncingLineage, setSyncingLineage] = useState(false);

  useEffect(() => {
    appWindow.isFullscreen().then(setIsFullscreen).catch(() => {});
  }, []);

  const toggleFullscreen = async () => {
    try {
      const next = !(await appWindow.isFullscreen());
      await appWindow.setFullscreen(next);
      setIsFullscreen(next);
    } catch (err) {
      console.warn('切换全屏失败:', err);
    }
  };

  const syncLineage = async () => {
    if (syncingLineage) return;
    setSyncingLineage(true);
    try {
      const message = await syncWorkshopLineageToCanvas();
      console.info('[canvas-lineage]', message);
      requestAnimationFrame(() => fitView({ padding: 0.12, duration: 450 }));
    } catch (error) {
      console.error('同步血缘图失败:', error);
    } finally {
      setSyncingLineage(false);
    }
  };

  return (
    <div className="absolute bottom-4 left-4 z-10 flex items-center gap-1 bg-[var(--canvas-panel)] rounded-lg border border-[var(--canvas-node-border)] shadow-md px-1.5 py-1">
      <button onClick={() => zoomOut()} className="p-2.5 rounded-lg hover:bg-[var(--canvas-controls-hover)] text-[var(--canvas-text-2)] transition-colors" title="缩小">
        <ZoomOut size={17} />
      </button>
      <span className="text-[12px] text-[var(--canvas-text-2)] min-w-[42px] text-center font-medium">
        {Math.round(zoom * 100)}%
      </span>
      <button onClick={() => zoomIn()} className="p-2.5 rounded-lg hover:bg-[var(--canvas-controls-hover)] text-[var(--canvas-text-2)] transition-colors" title="放大">
        <ZoomIn size={17} />
      </button>
      <div className="w-px h-4 bg-[rgba(255,255,255,0.12)] mx-0.5" />
      <button onClick={() => void syncLineage()} disabled={syncingLineage} className="p-2.5 rounded-lg hover:bg-[var(--canvas-controls-hover)] text-[var(--canvas-text-2)] transition-colors disabled:opacity-40" title="从当前工坊同步镜头资产血缘图">
        {syncingLineage ? <Loader2 size={17} className="animate-spin" /> : <GitBranch size={17} />}
      </button>
      <div className="relative">
        <button onClick={() => setLayoutMenu(!layoutMenu)} disabled={busy || syncingLineage} aria-expanded={layoutMenu}
          title={busy ? '生成完成后可整理，确保支持撤销' : '整理画布布局'}
          className="flex items-center gap-1 rounded-lg p-2.5 text-[12px] text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)] disabled:opacity-40">
          <LayoutGrid size={17} /> 整理
        </button>
        {layoutMenu && <div className="absolute bottom-full left-0 mb-2 w-44 rounded-lg border border-white/10 bg-neutral-900 p-1 text-xs text-neutral-200 shadow-xl"
          onKeyDown={e => {if(e.key === 'Escape') setLayoutMenu(false);}}>
          <button className="w-full rounded px-3 py-2 text-left hover:bg-white/10" onClick={() => void arrange(false)}>按镜头整理全部</button>
          <button disabled={!selectedCount} className="w-full rounded px-3 py-2 text-left hover:bg-white/10 disabled:opacity-40" onClick={() => void arrange(true)}>仅整理选中（{selectedCount}）</button>
          <div className="px-3 py-1 text-[10px] text-neutral-500">只改位置 · ⌘Z 可撤销</div>
        </div>}
      </div>
      {layoutMessage && <div role="status" className="absolute bottom-full left-0 mb-14 whitespace-nowrap rounded bg-neutral-900/95 px-3 py-2 text-xs text-neutral-300" onClick={() => setLayoutMessage('')}>{layoutMessage}</div>}
      <button onClick={() => fitView({ padding: 0.2 })} className="p-2.5 rounded-lg hover:bg-[var(--canvas-controls-hover)] text-[var(--canvas-text-2)] transition-colors" title="适配画布">
        <Maximize size={17} />
      </button>
      <button onClick={() => void toggleFullscreen()} className="p-2.5 rounded-lg hover:bg-[var(--canvas-controls-hover)] text-[var(--canvas-text-2)] transition-colors" title={isFullscreen ? '退出全屏' : '全屏'}>
        {isFullscreen ? <Shrink size={17} /> : <Expand size={17} />}
      </button>
    </div>
  );
}
