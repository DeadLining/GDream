/**
 * ProjectSessionSwitcher — 抽屉头部的项目对话切换器：
 * 当前项目唯一主对话的切换入口。
 * 仅统一项目模式渲染。
 */
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useChatStore } from '@/stores';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { projectSessionHistory } from '@/lib/projectSessionPolicy';
import { loadSessionRaw } from '@/hooks/useSessions';

export default function ProjectSessionSwitcher() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeId = useUnifiedProjectStore((s) => s.activeId);
  const project = useWorkshopStore((s) => s.project);
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const isStreaming = useChatStore((s) => s.isStreaming);

  // During an async project switch, do not render the previous project's
  // history under the new project's header.
  if (!activeId || !project || project.id !== activeId) return null;

  const projectSessions = projectSessionHistory(sessions, activeId);
  const current = projectSessions.find((s) => s.id === currentSessionId);

  const handleSwitch = async (id: string) => {
    if (isStreaming) { setError('任务正在执行，结束后可切换历史对话。'); return; }
    setError(null);
    try {
      if (await loadSessionRaw(id)) setOpen(false);
      else setError('历史记录未能加载，请重试；现有对话未清空。');
    } catch { setError('历史记录加载失败，请重试；现有对话未清空。'); }
  };

  const surfaceStyle = {
    background: 'var(--canvas-panel, rgb(var(--c-card)))',
    borderColor: 'var(--canvas-node-border, rgb(var(--c-border)))',
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-colors max-w-[140px]"
        title="切换项目对话"
      >
        <span className="truncate">
          {current ? current.title.replace(`${project.name} · `, '') : '对话'}
        </span>
        <ChevronDown size={10} className="shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute top-full right-0 mt-1 w-[200px] z-50 rounded-xl border shadow-xl"
            style={surfaceStyle}
          >
            <div
              role="listbox"
              aria-label="项目对话列表"
              className="max-h-[min(60vh,360px)] overflow-y-auto overscroll-contain py-1 [scrollbar-width:thin]"
              onWheel={(event) => event.stopPropagation()}
            >
              {error && <p role="alert" className="px-3 py-2 text-xs text-amber-400">{error}</p>}
              {projectSessions.length === 0 && <p className="px-3 py-2 text-xs">正在读取项目历史</p>}
              {projectSessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => void handleSwitch(s.id)}
                  className="w-full text-left px-3 py-1.5 text-[11px] transition-colors truncate"
                  style={{
                    color: s.id === currentSessionId ? 'var(--canvas-accent, rgb(2 132 199))' : 'var(--canvas-text-2, rgb(var(--c-text-muted)))',
                    fontWeight: s.id === currentSessionId ? 600 : 400,
                  }}
                >
                  {s.title.replace(`${project.name} · `, '')}
                  <span className="ml-1.5 text-[9px] text-[var(--canvas-text-3)]">{s.messageCount} 条</span>
                </button>
              ))}
            </div>

          </div>
        </>
      )}
    </div>
  );
}
