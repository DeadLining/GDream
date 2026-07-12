import {Database, HardDrive, Server, Waypoints} from 'lucide-react';
import type {ModelRuntimeHealth} from '../lib/types';

export function RuntimeInfrastructure({health}: {health: ModelRuntimeHealth}) {
  const {infrastructure} = health;
  const sshRunning = infrastructure.mock_ssh.state === 'running';
  return <section className="runtime-infrastructure" aria-labelledby="runtime-infrastructure-title">
    <header><h2 id="runtime-infrastructure-title">运行基础设施</h2><time dateTime={health.checked_at}>更新于 {new Date(health.checked_at).toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'})}</time></header>
    <div className="runtime-infrastructure-grid">
      <div><Server aria-hidden="true" size={17}/><span><small>本地 API</small><strong>{infrastructure.api.status === 'healthy' ? '运行正常' : infrastructure.api.status}</strong></span></div>
      <div><HardDrive aria-hidden="true" size={17}/><span><small>Mock SSH</small><strong>{sshRunning ? '已运行' : 'Mock SSH 未运行'}</strong></span></div>
      <div><Waypoints aria-hidden="true" size={17}/><span><small>后台队列</small><strong>排队 {infrastructure.queue.queued} · 运行 {infrastructure.queue.running}</strong></span></div>
      <div><Database aria-hidden="true" size={17}/><span><small>配置持久化</small><strong>{infrastructure.persistence.status === 'saved' ? '已保存' : '使用默认值'}</strong></span></div>
    </div>
  </section>;
}
