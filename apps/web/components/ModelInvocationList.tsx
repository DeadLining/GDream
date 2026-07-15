import {RotateCcw} from 'lucide-react';
import type {ModelInvocation} from '../lib/types';

const labels = {text: '文本', image: '画面', speech: '语音', video: '视频', model3d: '3D'};

export function ModelInvocationList({items, retrying, onRetry}: {items: ModelInvocation[]; retrying: string; onRetry: (item: ModelInvocation) => void}) {
  return <section className="runtime-invocations" aria-labelledby="runtime-invocations-title">
    <header><h2 id="runtime-invocations-title">最近调用</h2><span>{items.length} 条</span></header>
    {items.length ? <div className="runtime-invocation-list">{items.map(item => <article key={item.id}>
      <span className={`runtime-invocation-kind kind-${item.capability}`}>{labels[item.capability]}</span>
      <div><strong>{item.model}</strong><small>{item.provider} · {item.target_type || '平台'} {item.target_id}</small></div>
      <div className="runtime-invocation-result"><strong className={`invocation-${item.status}`}>{item.status === 'succeeded' ? '成功' : item.status === 'running' ? '运行中' : '失败'}</strong><small>{item.error_code || `${item.elapsed_ms} ms`}</small></div>
      {item.retryable && item.job_id ? <button className="icon-button" aria-label={`重试${labels[item.capability]}调用`} title="重试调用" disabled={retrying === item.id} onClick={() => onRetry(item)}><RotateCcw aria-hidden="true" size={15}/></button> : <span className="runtime-invocation-spacer"/>}
    </article>)}</div> : <p className="runtime-empty">暂无模型调用记录</p>}
  </section>;
}
