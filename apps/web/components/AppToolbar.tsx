'use client';

import {useEffect, useRef, useState} from 'react';
import {Boxes, BrainCircuit, Download, Film, History, ListChecks, Play, RefreshCw, Search, Settings} from 'lucide-react';
import {mediaUrl, startRender} from '../lib/api';
import {pollJob} from '../lib/jobs';
import type {GlobalSection} from '../lib/navigation';
import type {Job} from '../lib/types';
import {ProviderHealthStatus} from './ProviderHealthStatus';

export type {GlobalSection} from '../lib/navigation';

type AppToolbarProps = {
  projectLabel: string | null;
  episodeLabel: string | null;
  episodeId?: string | null;
  onRefresh?: () => void;
  onProduction?: () => void;
  renderReady?: boolean;
  healthRefreshKey?: number;
  onModelCenter?: () => void;
  modelCenterOpen?: boolean;
  onProjectSettings?: () => void;
  projectSettingsOpen?: boolean;
  activeSection?: GlobalSection;
  onNavigate?: (section: GlobalSection) => void;
  onWorkspaceHome?: () => void;
  onSearch?: () => void;
  onTasks?: () => void;
  onVersions?: () => void;
};

const productNavigation: Array<{value: GlobalSection; label: string}> = [
  {value: 'overview', label: '作品总览'},
  {value: 'script', label: '剧本'},
  {value: 'assets', label: '资产库'},
  {value: 'episode', label: '单集制作'},
  {value: 'review', label: '审核发布'},
];

export function AppToolbar({
  projectLabel,
  episodeId,
  onRefresh,
  onProduction,
  renderReady = true,
  healthRefreshKey = 0,
  onModelCenter,
  modelCenterOpen = false,
  onProjectSettings,
  projectSettingsOpen = false,
  activeSection = 'episode',
  onNavigate,
  onWorkspaceHome,
  onSearch,
  onTasks,
  onVersions,
}: AppToolbarProps) {
  const [job, setJob] = useState<Job | null>(null);
  const [renderUrl, setRenderUrl] = useState('');
  const renderGeneration = useRef(0);
  const rendering = job && ['queued', 'running'].includes(job.status);

  useEffect(() => {
    renderGeneration.current += 1;
    setJob(null);
    setRenderUrl('');
  }, [episodeId]);

  const render = async () => {
    if (!episodeId || rendering) return;
    const generation = renderGeneration.current;
    const started = await startRender(episodeId);
    const finished = await pollJob(started.job_id);
    if (renderGeneration.current !== generation) return;
    setJob(finished);
    const path = finished.result_metadata.media_url;
    if (finished.status === 'succeeded' && typeof path === 'string') setRenderUrl(mediaUrl(path));
  };

  return (
    <header className="app-toolbar">
      <div className="toolbar-context">
        <button className="brand-lockup" aria-label="打开工作台" onClick={onWorkspaceHome}>
          <span className="brand-mark"><Film aria-hidden="true" size={16}/></span>
          <strong>AI 漫剧工坊</strong>
        </button>
      </div>
      <nav className="product-navigation" aria-label="产品导航">
        {productNavigation.map(item => <button key={item.value} type="button" className={activeSection === item.value ? 'active' : ''} aria-current={activeSection === item.value ? 'page' : undefined} onClick={() => onNavigate?.(item.value)}>{item.label}</button>)}
      </nav>
      <div className="toolbar-actions">
        <button className="icon-button mobile-essential" title="全局搜索" aria-label="全局搜索" onClick={onSearch}><Search aria-hidden="true" size={17}/></button>
        <span className="toolbar-mobile-spacer" aria-hidden="true"/>
        <button className="icon-button mobile-essential" title="任务中心" aria-label="任务中心" onClick={onTasks}><ListChecks aria-hidden="true" size={17}/></button>
        <button className="icon-button mobile-essential" title="版本历史" aria-label="版本历史" onClick={onVersions} disabled={!episodeId}><History aria-hidden="true" size={17}/></button>
        <ProviderHealthStatus healthRefreshKey={healthRefreshKey}/>
        <button className={`icon-button${modelCenterOpen ? ' active' : ''}`} title={modelCenterOpen ? '返回项目工作台' : '模型中心'} aria-label="模型中心" onClick={onModelCenter}><BrainCircuit aria-hidden="true" size={17}/></button>
        <button className={`icon-button${projectSettingsOpen?' active':''}`} title={projectSettingsOpen?'返回项目工作台':'作品设置'} aria-label="作品设置" onClick={onProjectSettings} disabled={!projectLabel}><Settings aria-hidden="true" size={17}/></button>
        <button className="icon-button" title="刷新项目" aria-label="刷新项目" onClick={onRefresh}><RefreshCw aria-hidden="true" size={17}/></button>
        <button className="icon-button" title="批量生产" aria-label="批量生产" onClick={onProduction} disabled={!episodeId}><Boxes aria-hidden="true" size={17}/></button>
        {renderUrl ? (
          <a className="command-button" href={renderUrl} download aria-label="下载 MP4"><Download aria-hidden="true" size={17}/><span>下载 MP4</span></a>
        ) : (
          <button className="command-button" aria-label="渲染本集" onClick={render} disabled={!episodeId || !renderReady || Boolean(rendering)} title={renderReady ? '渲染本集' : '素材未就绪'}>
            <Play aria-hidden="true" size={17}/>
            <span className="desktop-command-label">{rendering ? `渲染 ${job?.progress ?? 0}%` : '渲染本集'}</span>
            <span className="mobile-command-label">渲染</span>
          </button>
        )}
      </div>
    </header>
  );
}
