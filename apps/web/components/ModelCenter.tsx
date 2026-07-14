'use client';

import {RefreshCw} from 'lucide-react';
import {useCallback, useEffect, useState} from 'react';
import {getModelRuntimeHealth, getModelRuntimeInvocations, retryModelRuntimeJob} from '../lib/api';
import type {ModelInvocation, ModelRuntimeHealth} from '../lib/types';
import {ModelInvocationList} from './ModelInvocationList';
import {ModelRuntimeOverview} from './ModelRuntimeOverview';
import {ProviderSettings} from './ProviderSettings';
import {RuntimeInfrastructure} from './RuntimeInfrastructure';

export function ModelCenter({onDirtyChange, onSaved}: {onDirtyChange?: (dirty: boolean) => void; onSaved?: () => void} = {}) {
  const [health, setHealth] = useState<ModelRuntimeHealth | null>(null);
  const [invocations, setInvocations] = useState<ModelInvocation[]>([]);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState('');
  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [nextHealth, nextInvocations] = await Promise.all([getModelRuntimeHealth(), getModelRuntimeInvocations()]);
      setHealth(nextHealth); setInvocations(nextInvocations); setError('');
    } catch (cause) {setError(cause instanceof Error ? cause.message : '模型运行状态加载失败');}
    finally {setRefreshing(false);}
  }, []);
  useEffect(() => {void load();}, [load]);
  const retry = async (item: ModelInvocation) => {
    if (!item.job_id || retrying) return;
    setRetrying(item.id);
    try {await retryModelRuntimeJob(item.job_id); await load();}
    catch (cause) {setError(cause instanceof Error ? cause.message : '重试失败');}
    finally {setRetrying('');}
  };
  return <main className="model-center">
    <header className="model-center-header"><div><h1>模型中心</h1><p>统一管理创作模型、运行状态与调用记录</p></div><button className="icon-button" aria-label="刷新模型中心" title="刷新模型中心" disabled={refreshing} onClick={() => void load()}><RefreshCw aria-hidden="true" size={17}/></button></header>
    <nav className="model-center-nav" aria-label="模型中心分区"><a href="#model-capabilities">能力概览</a><a href="#model-operations">运行记录</a><a href="#model-settings">渠道配置</a></nav>
    {error && <p className="model-center-error" role="alert">{error}</p>}
    {health ? <><div id="model-capabilities"><ModelRuntimeOverview health={health}/></div><div id="model-operations" className="runtime-operations"><RuntimeInfrastructure health={health}/><ModelInvocationList items={invocations} retrying={retrying} onRetry={item => void retry(item)}/></div></> : !error && <p className="runtime-loading">正在读取模型运行状态</p>}
    <section id="model-settings" className="model-center-settings" aria-labelledby="model-center-settings-title"><header><h2 id="model-center-settings-title">渠道配置</h2><p>修改后会应用到所有项目和创作流程</p></header><ProviderSettings embedded onDirtyChange={onDirtyChange} onSaved={onSaved}/></section>
  </main>;
}
