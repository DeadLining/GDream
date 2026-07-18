import type {ProductionReadiness} from '../lib/types';
import {AlertTriangle, CircleCheck} from 'lucide-react';

export function ReadinessBlockers({
  blockers,
  ready,
  onOpenProduction,
  onOpenReview,
  compact = false,
}: {
  blockers: ProductionReadiness['blockers'];
  ready: boolean;
  onOpenProduction: () => void;
  onOpenReview: () => void;
  compact?: boolean;
}) {
  return (
    <section className={`readiness-blockers${ready ? ' ready' : ''}`} aria-labelledby="readiness-blockers-heading">
      <h2 id="readiness-blockers-heading">{ready ? <CircleCheck size={15}/> : <AlertTriangle size={15}/>} {ready ? '素材已就绪' : '渲染阻塞'}</h2>
      {!ready && <ul>
        <li>缺少画面 {blockers.missing_panels.length}</li>
        <li>过期画面 {blockers.stale_panels?.length ?? 0}</li>
        <li>未审核镜头 {blockers.unapproved_shots.length}</li>
        <li>缺少配音 {blockers.missing_speech.length}</li>
        <li>缺少视频 {blockers.missing_videos?.length ?? 0}</li>
        <li>过期视频 {blockers.stale_videos?.length ?? 0}</li>
      </ul>}
      {!ready && !compact && <div className="readiness-blocker-actions">
        <button type="button" onClick={onOpenProduction}>处理画面与配音</button>
        <button type="button" onClick={onOpenReview}>审核镜头</button>
      </div>}
    </section>
  );
}
