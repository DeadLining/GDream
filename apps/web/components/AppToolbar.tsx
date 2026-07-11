'use client';

import {useEffect, useRef, useState} from 'react';
import {Activity, Boxes, Download, Film, Play, RefreshCw} from 'lucide-react';
import {getProviderHealth, mediaUrl, startRender} from '../lib/api';
import {pollJob} from '../lib/jobs';
import type {Job} from '../lib/types';

type AppToolbarProps = {
  projectLabel: string | null;
  episodeLabel: string | null;
  episodeId?: string | null;
  onRefresh?: () => void;
  onProduction?: () => void;
  renderReady?: boolean;
  healthRefreshKey?: number;
};

export function AppToolbar({
  projectLabel,
  episodeLabel,
  episodeId,
  onRefresh,
  onProduction,
  renderReady = true,
  healthRefreshKey = 0,
}: AppToolbarProps) {
  const [healthCount, setHealthCount] = useState<number | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [renderUrl, setRenderUrl] = useState('');
  const renderGeneration = useRef(0);
  const rendering = job && ['queued', 'running'].includes(job.status);
  const breadcrumb = [projectLabel, episodeLabel].filter(Boolean).join(' / ');

  useEffect(() => {
    renderGeneration.current += 1;
    setJob(null);
    setRenderUrl('');
  }, [episodeId]);

  const checkHealth = async () => {
    const health = await getProviderHealth();
    setHealthCount(Object.values(health).filter(item => item.status === 'ok').length);
  };
  useEffect(() => {if (healthRefreshKey > 0) void checkHealth();}, [healthRefreshKey]);
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
        <div className="brand-lockup" aria-label="AI 漫剧工坊">
          <Film aria-hidden="true" size={19}/>
          <strong>AI 漫剧工坊</strong>
        </div>
        {breadcrumb && <span className="workspace-breadcrumb" title={breadcrumb}>{breadcrumb}</span>}
      </div>
      <div className="toolbar-actions">
        <button className="health-button" title="模型服务状态" aria-label="模型服务状态" onClick={checkHealth}>
          <Activity aria-hidden="true" size={17}/>
          <span>{healthCount === null ? '检查服务' : `${healthCount}/3 服务`}</span>
        </button>
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
