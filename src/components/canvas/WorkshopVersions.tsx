import { useState } from 'react';
import { createPortal } from 'react-dom';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import AssetCandidatesModal from '@/components/workshop/AssetCandidatesModal';
import { useWorkshopStore } from '@/stores/workshopStore';
import type { WorkshopRef } from '@/lib/workshop/canvasSync';
import type { CanvasAssetVersion } from '@/lib/workshop/liveCanvasPolicy';

/** Uses the workshop's existing adoption UI; preview never changes production binding. */
export default function WorkshopVersions({ data, video = false }: { data: Record<string, unknown>; video?: boolean }) {
  const [open, setOpen] = useState(false);
  const projectId = useWorkshopStore((s) => s.project?.id);
  const ref = data.workshopRef as WorkshopRef | undefined;
  const versions = (data.assetVersions as CanvasAssetVersion[] | undefined) ?? [];
  if (!ref || ref.projectId !== projectId || !versions.length) return null;
  const kind = ref.kind;
  const asset = kind === 'character' || kind === 'scene' || kind === 'prop' || kind === 'colorPalette';
  return <>
    <button className="px-3 py-1 text-xs text-white/80 hover:text-white" onClick={() => setOpen(true)}>
      版本管理 · {versions.length} 个版本
    </button>
    {open && asset && ref.role === 'asset' ? <AssetCandidatesModal kind={kind} id={ref.id} onClose={() => setOpen(false)} /> : null}
    {open && !(asset && ref.role === 'asset') && createPortal(
      <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center" onClick={() => setOpen(false)}>
        <div className="bg-neutral-900 text-white rounded-xl p-5 w-[720px] max-w-[95vw] max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-between"><h3>版本记录</h3><button onClick={() => setOpen(false)}>关闭</button></div>
          <p className="text-xs text-white/60 my-3">此处仅预览历史产物。视频正式采用仍在工坊完成，保留原有评审门槛。</p>
          {versions.map((version, index) => <section key={version.path} className="border-t border-white/10 py-3">
            <p className="text-sm">V{index + 1} {data.adoptedVersionPath === version.path ? '· 当前采用' : '· 历史／候选'} · {version.source || '已有产物'}</p>
            {video ? <video src={convertFileSrc(version.path)} controls preload="metadata" className="w-full max-h-64" /> : <img src={convertFileSrc(version.path)} className="w-full max-h-64 object-contain" />}
            {version.prompt && <details className="text-xs"><summary>生成提示词</summary><p className="whitespace-pre-wrap">{version.prompt}</p></details>}
          </section>)}
        </div>
      </div>, document.body)}
  </>;
}
