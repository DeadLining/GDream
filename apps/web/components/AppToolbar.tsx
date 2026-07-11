import {Activity, Film, Play, RefreshCw, Settings} from 'lucide-react';

export function AppToolbar() {
  return (
    <header className="app-toolbar">
      <div className="brand-lockup">
        <Film aria-hidden="true" size={20} />
        <strong>AI 漫剧工坊</strong>
        <span className="workspace-label">本地制作台</span>
      </div>
      <div className="toolbar-actions">
        <button className="icon-button health-button" title="模型服务状态" aria-label="模型服务状态">
          <Activity size={18} />
          <span>3/3 服务</span>
        </button>
        <button className="icon-button" title="刷新项目" aria-label="刷新项目"><RefreshCw size={18} /></button>
        <button className="command-button"><Play size={17} /><span className="desktop-command-label">渲染本集</span><span className="mobile-command-label">渲染</span></button>
        <button className="icon-button" title="设置" aria-label="设置"><Settings size={18} /></button>
      </div>
    </header>
  );
}
