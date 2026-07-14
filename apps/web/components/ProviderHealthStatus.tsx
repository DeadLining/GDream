'use client';

import {Activity, AlertCircle, CheckCircle2, CircleOff, LoaderCircle} from 'lucide-react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {getProviderHealth} from '../lib/api';
import type {ProviderHealth, ProviderHealthItem, ProviderHealthKind} from '../lib/types';

const providers: Array<{kind: ProviderHealthKind; label: string}> = [
  {kind: 'llm', label: '剧本规划'},
  {kind: 'image', label: '画面生成'},
  {kind: 'tts', label: '语音合成'},
  {kind: 'video', label: '视频生成'},
];

type RequestState = 'idle' | 'checking' | 'success' | 'error';

function displayError(error: string | null) {
  const clean = (error ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, 240) : '服务响应异常';
}

function statusLabel(item: ProviderHealthItem) {
  if (item.status === 'ok') return '正常';
  if (item.status === 'disabled') return '已禁用';
  return '异常';
}

function StatusIcon({status}: {status: ProviderHealthItem['status']}) {
  if (status === 'ok') return <CheckCircle2 aria-hidden="true" size={16}/>;
  if (status === 'disabled') return <CircleOff aria-hidden="true" size={16}/>;
  return <AlertCircle aria-hidden="true" size={16}/>;
}

export function ProviderHealthStatus({healthRefreshKey = 0}: {healthRefreshKey?: number}) {
  const [requestState, setRequestState] = useState<RequestState>('idle');
  const [health, setHealth] = useState<ProviderHealth | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const pending = useRef(false);
  const previousRefreshKey = useRef(healthRefreshKey);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!detailsOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setDetailsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [detailsOpen]);

  const check = useCallback(async (supersede = false, openOnSuccess = false) => {
    if (pending.current && !supersede) return;
    const requestGeneration = ++generation.current;
    pending.current = true;
    setRequestState('checking');
    try {
      const result = await getProviderHealth();
      if (!mounted.current || generation.current !== requestGeneration) return;
      setHealth(result);
      setRequestState('success');
      if (openOnSuccess) setDetailsOpen(true);
    } catch {
      if (!mounted.current || generation.current !== requestGeneration) return;
      setHealth(null);
      setRequestState('error');
      setDetailsOpen(false);
    } finally {
      if (generation.current === requestGeneration) pending.current = false;
    }
  }, []);

  useEffect(() => {
    const changed = previousRefreshKey.current !== healthRefreshKey;
    previousRefreshKey.current = healthRefreshKey;
    if (changed && healthRefreshKey > 0) void check(true);
  }, [check, healthRefreshKey]);

  const enabled = health ? providers.filter(({kind}) => health[kind].status !== 'disabled') : [];
  const okCount = enabled.filter(({kind}) => health?.[kind].status === 'ok').length;
  const buttonText = requestState === 'checking'
    ? '检测中'
    : requestState === 'error'
      ? '检测失败'
      : requestState === 'success'
        ? `${okCount}/${enabled.length} 正常`
        : '检测服务';

  const activate = () => {
    void check(false, true);
  };

  return (
    <div className="provider-health-status" ref={container}>
      <button
        className="health-button"
        type="button"
        title="检测模型服务"
        aria-label="检测模型服务"
        aria-expanded={requestState === 'success' ? detailsOpen : undefined}
        aria-controls={requestState === 'success' ? 'provider-health-details' : undefined}
        onClick={activate}
        disabled={requestState === 'checking'}
      >
        {requestState === 'checking' ? <LoaderCircle className="provider-health-spinner" aria-hidden="true" size={17}/> : <Activity aria-hidden="true" size={17}/>}
        <span>{buttonText}</span>
      </button>
      {requestState === 'error' && <span className="provider-health-request-error" role="alert">服务检测失败，请重试</span>}
      {requestState === 'success' && detailsOpen && health && (
        <section id="provider-health-details" className="provider-health-popover" role="region" aria-label="模型服务检测详情">
          {providers.map(({kind, label}) => {
            const item = health[kind];
            return (
              <div className={`provider-health-row ${item.status}`} key={kind}>
                <StatusIcon status={item.status}/>
                <div className="provider-health-copy">
                  <div className="provider-health-row-heading">
                    <strong>{label}</strong>
                    <span>{statusLabel(item)}</span>
                    {item.status !== 'disabled' && <small>{item.elapsed_ms} ms</small>}
                  </div>
                  {(item.model || item.host) && (
                    <div className="provider-health-meta">
                      {item.model && <span className="provider-health-model" title={item.model}>{item.model}</span>}
                      {item.host && <span className="provider-health-host" title={item.host}>{item.host}</span>}
                    </div>
                  )}
                  {item.status === 'failed' && <p className="provider-health-error">{displayError(item.error)}</p>}
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
