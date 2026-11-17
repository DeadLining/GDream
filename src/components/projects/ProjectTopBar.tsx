/**
 * ProjectTopBar — 全局唯一的顶部栏（Adobe 式）。
 *
 * 左侧栏已整体移除：品牌的常驻位、项目名、视图切换、设置都收在这一行里。
 * - 未打开项目：显示品牌（GDream）+ 设置
 * - 打开项目后：显示返回 + 项目名 + 工坊/画布/剪辑/资产库 + 设置
 *
 * 设置固定在最右端，和「资产库」同一行，任何视图下都可直接打开。
 */
import { useState } from 'react';
import { ArrowLeft, Clapperboard, LayoutDashboard, Scissors, Wrench, Image as Images, Settings } from 'lucide-react';
import { useChatStore } from '@/stores';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import SettingsPanel from '@/components/Settings';

const VIEW_TABS = [
  { view: 'workshop' as const, label: '工坊', icon: Wrench },
  { view: 'canvas' as const, label: '画布', icon: LayoutDashboard },
  { view: 'editor' as const, label: '剪辑', icon: Scissors },
  { view: 'library' as const, label: '资产库', icon: Images },
];

export default function ProjectTopBar() {
  const activeView = useChatStore((s) => s.activeView);
  const setActiveView = useChatStore((s) => s.setActiveView);
  const project = useWorkshopStore((s) => s.project);
  const activeId = useUnifiedProjectStore((s) => s.activeId);
  const closeUnified = useUnifiedProjectStore((s) => s.closeUnified);
  const [showSettings, setShowSettings] = useState(false);

  // 项目模式：有项目且停在四个项目视图之一，才显示视图切换。
  const projectMode = Boolean(project && activeId)
    && (activeView === 'workshop' || activeView === 'canvas' || activeView === 'editor' || activeView === 'library');

  return (
    <div
      className="canvas-dark flex items-center gap-3 px-3 shrink-0"
      style={{ height: 38, background: 'var(--canvas-panel)', borderBottom: '1px solid var(--canvas-node-border)' }}
    >
      {projectMode ? (
        <>
          <button
            onClick={() => { void closeUnified(); setActiveView('workshop'); }}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-colors"
            title="返回项目列表"
          >
            <ArrowLeft size={12} />
          </button>
          <div className="flex items-center gap-1.5 min-w-0">
            <Clapperboard size={13} className="text-[var(--canvas-accent)] shrink-0" />
            <span className="text-[12px] font-medium text-[var(--canvas-text-1)] truncate max-w-[220px]">
              {project!.name}
            </span>
          </div>
          <div className="flex items-center gap-0.5 ml-2">
            {VIEW_TABS.map((t) => {
              const active = activeView === t.view;
              return (
                <button
                  key={t.view}
                  onClick={() => setActiveView(t.view)}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] transition-colors"
                  style={{
                    background: active ? 'rgba(2,133,255,0.15)' : 'transparent',
                    color: active ? 'var(--canvas-accent)' : 'var(--canvas-text-2)',
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  <t.icon size={12} /> {t.label}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          {activeView === 'projects' && (
            <button
              onClick={() => setActiveView('workshop')}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-colors"
              title="返回短剧工坊"
            >
              <ArrowLeft size={12} />
            </button>
          )}
          <button
            onClick={() => setActiveView('workshop')}
            className="flex items-center gap-2 min-w-0 rounded-md px-1.5 py-1 hover:bg-[var(--canvas-controls-hover)] transition-colors"
            title="短剧工坊"
          >
            <img src="/gdream-whale.svg" alt="GDream" className="h-5 w-5 shrink-0 object-contain" />
            <span className="text-[12px] font-medium text-[var(--canvas-text-1)]">GDream</span>
            {activeView === 'projects' && (
              <span className="text-[11px] text-[var(--canvas-text-3)]">/ 项目列表</span>
            )}
          </button>
        </>
      )}

      <div className="flex-1" />

      <button
        onClick={() => setShowSettings(true)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-colors shrink-0"
        title="设置"
      >
        <Settings size={13} /> 设置
      </button>

      <SettingsPanel isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}
