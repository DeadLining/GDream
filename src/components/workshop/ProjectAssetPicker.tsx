import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ImageIcon, Loader2, Plus, RefreshCw, Search, X } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import type { ProjectAssetImage } from '@/lib/workshop/projectAssetReferences';
import type { WorkshopAssetKind } from '@/lib/workshop/types';
import { Z, useEscapeClose } from '@/lib/ui/layers';

const KIND_LABELS: Record<WorkshopAssetKind, string> = {
  character: '角色', scene: '场景', prop: '道具', colorPalette: '色卡',
};
const FILTERS = ['all', 'character', 'scene', 'prop', 'colorPalette'] as const;

interface Props {
  images: ProjectAssetImage[];
  existingPaths: readonly string[];
  onAdd: (paths: string[]) => Promise<void>;
  onClose: () => void;
}

export default function ProjectAssetPicker({ images, existingPaths, onAdd, onClose }: Props) {
  const [filter, setFilter] = useState<typeof FILTERS[number]>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);
  const existing = useMemo(() => new Set(existingPaths), [existingPaths]);
  const available = useMemo(() => new Set(images.map((image) => image.path)), [images]);
  // A failed disk commit may already have updated memory; allow saving it again.
  const pending = selected.filter((path) => available.has(path) && (!existing.has(path) || Boolean(error)));
  const query = search.trim().toLocaleLowerCase();
  const visible = images.filter((image) => (filter === 'all' || image.kind === filter)
    && (!query || image.name.toLocaleLowerCase().includes(query)));
  const close = () => { if (!savingRef.current) onClose(); };
  useEscapeClose(true, close);

  const add = async () => {
    if (!pending.length || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await onAdd(pending);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 canvas-dark flex items-center justify-center bg-black/60 p-4" style={{ zIndex: Z.picker }} onClick={close}>
      <section role="dialog" aria-modal="true" aria-label="当前项目资产"
        className="flex max-h-[calc(100dvh-32px)] w-[720px] max-w-full flex-col overflow-hidden rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] shadow-xl"
        onClick={(event) => event.stopPropagation()}>
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--canvas-node-border)] px-4 py-3">
          <h2 className="min-w-0 flex-1 text-[14px] font-medium text-[var(--canvas-text-1)]">当前项目资产</h2>
          <span className="text-[11px] text-[var(--canvas-text-3)]">{images.length} 张</span>
          <button type="button" onClick={close} disabled={saving} aria-label="关闭项目资产选择器" title="关闭"
            className="rounded p-1 text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)] disabled:opacity-40">
            <X size={16} />
          </button>
        </header>
        <div className="shrink-0 space-y-3 border-b border-[var(--canvas-node-border)] px-4 py-3">
          <label className="flex items-center gap-2 rounded border border-[var(--canvas-node-border)] px-2.5 py-2 text-[var(--canvas-text-3)]">
            <Search size={14} className="shrink-0" />
            <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索资产名称" aria-label="搜索项目资产"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--canvas-text-1)] outline-none" />
          </label>
          <div role="tablist" aria-label="资产类型" className="flex gap-4 overflow-x-auto">
            {FILTERS.map((kind) => (
              <button key={kind} type="button" role="tab" aria-selected={filter === kind} onClick={() => setFilter(kind)}
                className={`shrink-0 border-b-2 pb-1 text-[12px] ${filter === kind ? 'border-[var(--canvas-accent)] text-[var(--canvas-text-1)]' : 'border-transparent text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)]'}`}>
                {kind === 'all' ? '全部' : KIND_LABELS[kind]}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4" style={{ height: 360 }}>
          {visible.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {visible.map((image) => {
                const included = existing.has(image.path);
                const checked = pending.includes(image.path);
                return (
                  <label key={image.path} className={`relative min-w-0 overflow-hidden rounded-lg border ${included ? 'border-[var(--canvas-node-border)] opacity-60' : checked ? 'border-[var(--canvas-accent)]' : 'border-[var(--canvas-node-border)] hover:border-[var(--canvas-text-3)]'} ${included || saving ? 'cursor-default' : 'cursor-pointer'}`}>
                    <div className="relative aspect-square bg-black/25">
                      <AssetThumbnail path={image.path} name={image.name} />
                      {included ? (
                        <span className="absolute right-1 top-1 flex items-center gap-1 rounded bg-black/75 px-1.5 py-1 text-[10px] text-white"><Check size={11} /> 已添加</span>
                      ) : (
                        <input type="checkbox" checked={checked} disabled={saving} aria-label={`选择 ${KIND_LABELS[image.kind]} ${image.name}${image.angle ? ` 视角 ${image.angle}` : ''}`}
                          onChange={() => setSelected((current) => checked ? current.filter((path) => path !== image.path) : [...current, image.path])}
                          className="absolute right-2 top-2 h-4 w-4 accent-[var(--canvas-accent)]" />
                      )}
                    </div>
                    <div className="min-w-0 px-2 py-1.5">
                      <div className="truncate text-[11px] text-[var(--canvas-text-1)]" title={image.name}>{image.name}</div>
                      <div className="text-[10px] text-[var(--canvas-text-3)]">{KIND_LABELS[image.kind]}{image.angle ? ` · 视角 ${image.angle}` : ''}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          ) : <p className="py-16 text-center text-[12px] text-[var(--canvas-text-3)]">{images.length ? '没有匹配的资产' : '当前项目暂无可用资产图片'}</p>}
        </div>
        <footer className="shrink-0 border-t border-[var(--canvas-node-border)] px-4 py-3">
          {error && <p role="alert" className="mb-2 break-words text-[12px] text-red-400">{error}</p>}
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-[var(--canvas-text-3)]">已选 {pending.length} 张</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={close} disabled={saving} className="rounded border border-[var(--canvas-node-border)] px-3 py-1.5 text-[12px] text-[var(--canvas-text-2)] disabled:opacity-40">取消</button>
              <button type="button" onClick={() => void add()} disabled={!pending.length || saving}
                className="inline-flex items-center gap-1.5 rounded bg-[var(--canvas-accent)] px-3 py-1.5 text-[12px] text-white disabled:cursor-not-allowed disabled:opacity-40">
                {saving ? <Loader2 size={13} className="animate-spin" /> : error ? <RefreshCw size={13} /> : <Plus size={13} />}
                {error ? '重试保存' : `添加${pending.length ? ` ${pending.length} 张` : ''}`}
              </button>
            </div>
          </div>
        </footer>
      </section>
    </div>, document.body,
  );
}

function AssetThumbnail({ path, name }: { path: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? <div className="flex h-full items-center justify-center text-[var(--canvas-text-3)]"><ImageIcon size={24} /></div>
    : <img src={/^(https?:|data:|asset:)/i.test(path) ? path : convertFileSrc(path)} alt={name} onError={() => setFailed(true)} loading="lazy" decoding="async" className="h-full w-full object-contain" />;
}
