import {AudioLines, Film, Image, MessageSquareText} from 'lucide-react';
import type {ModelCapability, ModelRuntimeHealth} from '../lib/types';

const capabilities: Array<{key: ModelCapability; label: string; Icon: typeof Film}> = [
  {key: 'text', label: '文本', Icon: MessageSquareText},
  {key: 'image', label: '画面', Icon: Image},
  {key: 'speech', label: '语音', Icon: AudioLines},
  {key: 'video', label: '视频', Icon: Film},
];
const statusLabel = {healthy: '正常', unavailable: '不可用', disabled: '未启用'};

export function ModelRuntimeOverview({health}: {health: ModelRuntimeHealth}) {
  return <section className="runtime-capabilities" aria-label="模型能力状态">
    {capabilities.map(({key, label, Icon}) => {
      const item = health.capabilities[key];
      return <article className="runtime-capability" key={key}>
        <header><span className="runtime-capability-icon"><Icon aria-hidden="true" size={17}/></span><span><small>{label}</small><strong>{item.model || '未配置模型'}</strong></span><i className={`runtime-status runtime-status-${item.status}`}>{statusLabel[item.status]}</i></header>
        <dl><div><dt>主机</dt><dd>{item.host}</dd></div><div><dt>检测</dt><dd>{item.elapsed_ms ? `${item.elapsed_ms} ms` : '-'}</dd></div><div><dt>最近调用</dt><dd>{item.last_invocation_elapsed_ms === null ? '-' : `${item.last_invocation_elapsed_ms} ms`}</dd></div></dl>
        {item.error && <p role="alert">{item.error}</p>}
      </article>;
    })}
  </section>;
}
