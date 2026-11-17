/**
 * ArtifactLibrary — browse every generated artifact (workspace + projects)
 * with type/date filters, multi-select batch export, save-as, reveal in
 * Finder, and drag-back-to-canvas.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image as Images, Film, Music, FileText, RefreshCw, Download, FolderOpen,
  CheckSquare, Square, Loader2,
} from 'lucide-react';
import { convertFileSrc, invoke } from '@tauri-apps/api/tauri';
import { open as openDialog, message as tauriMessage } from '@tauri-apps/api/dialog';
import { copyFile } from '@tauri-apps/api/fs';
import { listArtifacts, type ArtifactEntry, type ArtifactType } from '@/lib/artifacts';
import { useVideoThumb } from '@/lib/canvas/videoThumbs';
import { useProjectStore } from '@/stores/projectStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useChatStore } from '@/stores/chatStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { useAigcProjectStore } from '@/stores/aigcProjectStore';
import { nanoid } from 'nanoid';
import { defaultNodeStyle } from '@/lib/canvas/layout';

type TypeFilter = 'all' | ArtifactType;
type DateFilter = 'all' | 'today' | 'week' | 'month';

// Render in pages — mounting hundreds of <img>/<video> at once froze the view.
const PAGE_SIZE = 60;

const TYPE_TABS: { key: TypeFilter; label: string; icon: typeof Images }[] = [
  { key: 'all', label: '全部', icon: Images },
  { key: 'image', label: '图片', icon: Images },
  { key: 'video', label: '视频', icon: Film },
  { key: 'audio', label: '音频', icon: Music },
  { key: 'doc', label: '文档', icon: FileText },
];

function fmtSize(bytes: number): string {
  if (bytes > 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes > 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export default function ArtifactLibrary() {
  const [entries, setEntries] = useState<ArtifactEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const projects = useProjectStore((s) => s.projects);
  const aigcProjects = useAigcProjectStore((s) => s.projects);
  const setActiveView = useChatStore((s) => s.setActiveView);
  // 在项目里（从项目顶栏切进来）默认只看本项目的产物；自由模式保持「全部来源」。
  //
  // ⚠️ 产物条目的 projectId 由 lib/artifacts 从路径
  // .gdream/(projects|aigc-memory/projects)/<id>/ 解析而来——那是 **AIGC 项目 id**，
  // 而 useUnifiedProjectStore.activeId 也是 AIGC id，二者同源，可直接用。
  // 之前下拉的 option 来自 useProjectStore（画布 id，proj--xSpw10B8X 那种），
  // 两套 id 对不上：受控 select 找不到匹配项会退回显示第一项「全部来源」，
  // 但过滤条件仍按 AIGC id 执行 → 列表恒为 0 条（下拉写着全部来源、内容却空的假象）。
  // 只有当这个项目**确实有产物**时才锁定筛选；否则回「全部来源」。
  // 否则会出现：下拉显示「全部来源」、列表却是 0 条的假象（历史 bug 即此）。
  //
  // 用 ref 记录「已为该 AIGC id 自动决策过」，保证：
  //   · 项目切换 → 等首轮扫描结果到达后决策一次；
  //   · 用户随后手动改下拉 / 点刷新 → 不被这个 effect 覆盖。
  const unifiedProjectId = useUnifiedProjectStore((s) => s.activeId);
  const autoLockedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!unifiedProjectId) {
      autoLockedFor.current = null;
      setProjectFilter('all');
      return;
    }
    if (autoLockedFor.current === unifiedProjectId) return;
    if (entries.length === 0) return; // 首轮扫描还没回来，别急着改
    autoLockedFor.current = unifiedProjectId;
    const owned = entries.some((e) => e.projectId === unifiedProjectId);
    setProjectFilter(owned ? unifiedProjectId : 'all');
  }, [unifiedProjectId, entries]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await listArtifacts());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const cutoff = dateFilter === 'today' ? now - 86400_000
      : dateFilter === 'week' ? now - 7 * 86400_000
      : dateFilter === 'month' ? now - 30 * 86400_000
      : 0;
    return entries.filter((e) =>
      (typeFilter === 'all' || e.type === typeFilter)
      && e.createdAt >= cutoff
      && (projectFilter === 'all'
        || (projectFilter === 'workspace' ? !e.projectId : e.projectId === projectFilter)),
    );
  }, [entries, typeFilter, dateFilter, projectFilter]);

  // Reset pagination when filters change.
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [typeFilter, dateFilter, projectFilter]);
  const visible = filtered.slice(0, visibleCount);

  const toggleSelect = (path: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const allSelected = filtered.length > 0 && filtered.every((e) => selected.has(e.path));
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(filtered.map((e) => e.path)));
  };

  // Batch export: pick a directory, copy every selected file into it.
  const handleBatchExport = async () => {
    if (selected.size === 0 || exporting) return;
    const dir = await openDialog({ directory: true, title: '选择导出目录' });
    if (!dir || Array.isArray(dir)) return;
    setExporting(true);
    let ok = 0, fail = 0;
    try {
      for (const path of selected) {
        const name = path.split('/').pop()!;
        try {
          await copyFile(path, `${dir}/${name}`);
          ok += 1;
        } catch {
          fail += 1;
        }
      }
      await tauriMessage(`导出完成：成功 ${ok} 个${fail ? `，失败 ${fail} 个` : ''}\n${dir}`, { title: '批量导出' });
      setSelected(new Set());
    } finally {
      setExporting(false);
    }
  };

  const handleSaveAs = async (entry: ArtifactEntry) => {
    try {
      await invoke('save_file_dialog', {
        sourcePath: entry.path,
        defaultName: entry.path.split('/').pop(),
      });
    } catch (err) {
      console.error('另存为失败:', err);
    }
  };

  const handleReveal = (entry: ArtifactEntry) => {
    invoke('open_path', { path: entry.path, reveal: true }).catch(() => {});
  };

  // Drag back to canvas: create an image node from this artifact.
  const handleSendToCanvas = (entry: ArtifactEntry) => {
    if (entry.type !== 'image' && entry.type !== 'video') return;
    const { addNode } = useCanvasStore.getState();
    const url = convertFileSrc(entry.path);
    addNode({
      id: `node-${nanoid(8)}`,
      type: entry.type,
      position: { x: 120 + Math.random() * 120, y: 120 + Math.random() * 120 },
      style: defaultNodeStyle(entry.type),
      data: entry.type === 'image'
        ? { generatedImageUrl: url, localPath: entry.path, description: entry.prompt || '' }
        : {
          generatedVideoUrl: url,
          localPath: entry.path,
          mediaRole: 'output',
          description: entry.prompt || '',
        },
    });
    setActiveView('canvas');
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 canvas-dark" style={{ background: 'var(--canvas-bg)' }}>
      {/* Header / filters */}
      <div
        className="px-8 pt-5 pb-3 shrink-0"
        style={{ background: 'var(--canvas-panel)', borderBottom: '1px solid var(--canvas-node-border)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-[16px] font-semibold text-[var(--canvas-text-1)] flex items-center gap-2">
              <Images size={16} className="text-[var(--canvas-accent)]" /> 资产库
            </h1>
            <p className="text-[12px] text-[var(--canvas-text-3)] mt-1">
              {filtered.length} 个产物 · 含工作区与所有项目目录
            </p>
          </div>
          <button
            onClick={() => void refresh()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-[var(--canvas-text-2)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] hover:border-[var(--canvas-node-border-selected)] transition-colors"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            刷新
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center rounded-lg border border-[var(--canvas-node-border)] overflow-hidden">
            {TYPE_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTypeFilter(t.key)}
                className="px-3 py-1.5 text-[12px] transition-colors"
                style={{
                  background: typeFilter === t.key ? 'var(--canvas-accent)' : 'transparent',
                  color: typeFilter === t.key ? '#fff' : 'var(--canvas-text-2)',
                  fontWeight: typeFilter === t.key ? 600 : 400,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as DateFilter)}
            className="px-2.5 py-1.5 rounded-lg text-[12px] border border-[var(--canvas-node-border)]"
          >
            <option value="all">全部时间</option>
            <option value="today">今天</option>
            <option value="week">近 7 天</option>
            <option value="month">近 30 天</option>
          </select>

          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg text-[12px] border border-[var(--canvas-node-border)] max-w-[160px]"
          >
            <option value="all">全部来源</option>
            <option value="workspace">工作区（未归档）</option>
            {/* 产物的 projectId 来自 .gdream/aigc-memory/projects/<id>/，
                所以这里必须先列 AIGC 项目，否则选了也匹配不到任何条目。 */}
            {aigcProjects.map((p) => <option key={`aigc-${p.id}`} value={p.id}>{p.name}</option>)}
            {/* 画布项目目录（.gdream/projects/<id>/）下的产物同样可筛。 */}
            {projects
              .filter((p) => !aigcProjects.some((a) => a.id === p.id))
              .map((p) => <option key={`canvas-${p.id}`} value={p.id}>{p.name}</option>)}
          </select>

          <div className="flex-1" />

          <button onClick={toggleAll} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-colors">
            {allSelected ? <CheckSquare size={13} /> : <Square size={13} />}
            全选
          </button>
          {selected.size > 0 && (
            <button
              onClick={() => void handleBatchExport()}
              disabled={exporting}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-white text-[12px] font-medium disabled:opacity-60 transition-opacity hover:opacity-90"
              style={{ background: 'var(--canvas-accent)' }}
            >
              {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              导出 {selected.size} 个
            </button>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-8 py-5">
        {filtered.length === 0 ? (
          <div className="text-center py-20 text-[var(--canvas-text-3)] text-sm">
            {loading ? '扫描中…' : '没有匹配的产物'}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {visible.map((e) => (
                <ArtifactCard
                  key={e.path}
                  entry={e}
                  selected={selected.has(e.path)}
                  onToggle={() => toggleSelect(e.path)}
                  onSaveAs={() => void handleSaveAs(e)}
                  onReveal={() => handleReveal(e)}
                  onSendToCanvas={() => handleSendToCanvas(e)}
                />
              ))}
            </div>
            {visibleCount < filtered.length && (
              <div className="text-center mt-5">
                <button
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="px-5 py-2 rounded-xl border border-[var(--canvas-node-border)] text-[12px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:border-[var(--canvas-node-border-selected)] transition-colors"
                >
                  加载更多（还有 {filtered.length - visibleCount} 个）
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ArtifactCard({ entry, selected, onToggle, onSaveAs, onReveal, onSendToCanvas }: {
  entry: ArtifactEntry;
  selected: boolean;
  onToggle: () => void;
  onSaveAs: () => void;
  onReveal: () => void;
  onSendToCanvas: () => void;
}) {
  const url = convertFileSrc(entry.path);
  const name = entry.path.split('/').pop()!;

  return (
    <div
      className="group relative rounded-xl border overflow-hidden transition-colors"
      style={{
        background: 'var(--canvas-node-bg)',
        borderColor: selected ? 'var(--canvas-accent)' : 'var(--canvas-node-border)',
        boxShadow: selected ? '0 0 0 2px rgba(2,133,255,0.25)' : undefined,
      }}
    >
      <button
        onClick={onToggle}
        className="absolute top-1.5 left-1.5 z-10 p-0.5 rounded shadow-sm"
        style={{ background: 'rgba(0,0,0,0.55)' }}
      >
        {selected
          ? <CheckSquare size={14} style={{ color: 'var(--canvas-accent)' }} />
          : <Square size={14} className="text-[var(--canvas-text-2)] group-hover:text-[var(--canvas-text-1)]" />}
      </button>

      <div className="h-28 flex items-center justify-center overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
        {entry.type === 'image' ? (
          <img src={url} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
        ) : entry.type === 'video' ? (
          <VideoThumbCell path={entry.path} />
        ) : entry.type === 'audio' ? (
          <Music size={24} className="text-[var(--canvas-text-3)]" />
        ) : (
          <FileText size={24} className="text-[var(--canvas-text-3)]" />
        )}
      </div>

      <div className="px-2.5 py-2">
        <p className="text-[11px] text-[var(--canvas-text-1)] truncate" title={entry.prompt || name}>
          {entry.prompt ? entry.prompt.slice(0, 40) : name}
        </p>
        <p className="text-[10px] text-[var(--canvas-text-3)] mt-0.5">
          {fmtSize(entry.size)} · {new Date(entry.createdAt).toLocaleDateString('zh-CN')}
          {entry.scanned && <span className="ml-1 text-[var(--canvas-text-3)] opacity-70">扫描</span>}
        </p>
      </div>

      <div className="absolute bottom-9 right-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {(entry.type === 'image' || entry.type === 'video') && (
          <CardBtn onClick={onSendToCanvas} title="放到画布"><Images size={12} /></CardBtn>
        )}
        <CardBtn onClick={onSaveAs} title="另存为"><Download size={12} /></CardBtn>
        <CardBtn onClick={onReveal} title="在 Finder 中显示"><FolderOpen size={12} /></CardBtn>
      </div>
    </div>
  );
}

function CardBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      className="p-1.5 rounded-lg border shadow-sm text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] transition-colors"
      style={{ background: 'var(--canvas-panel-elevated)', borderColor: 'var(--canvas-node-border)' }}
    >
      {children}
    </button>
  );
}

function VideoThumbCell({ path }: { path: string }) {
  const thumb = useVideoThumb(path);
  return thumb ? (
    <div className="relative w-full h-full">
      <img src={thumb} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
      <span className="absolute bottom-1 right-1 px-1 rounded bg-black/60 text-white text-[8px] flex items-center gap-0.5"><Film size={8} />视频</span>
    </div>
  ) : (
    <div className="flex flex-col items-center gap-1 text-[var(--canvas-text-3)]">
      <Film size={24} />
      <span className="text-[9px]">视频</span>
    </div>
  );
}
