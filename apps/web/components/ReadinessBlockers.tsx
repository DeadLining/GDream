import type {ProductionReadiness} from '../lib/types';
import {AlertTriangle} from 'lucide-react';

export function ReadinessBlockers({
  blockers,
  onOpenProduction,
  onOpenReview,
  compact = false,
}: {
  blockers: ProductionReadiness['blockers'];
  onOpenProduction: () => void;
  onOpenReview: () => void;
  compact?: boolean;
}) {
  return (
    <section className="readiness-blockers" aria-labelledby="readiness-blockers-heading">
      <h2 id="readiness-blockers-heading"><AlertTriangle size={15}/>渲染阻塞</h2>
      <ul>
        <li>缺少画面 {blockers.missing_panels.length}</li>
        <li>未审核镜头 {blockers.unapproved_shots.length}</li>
        <li>缺少配音 {blockers.missing_speech.length}</li>
      </ul>
      {!compact && <div className="readiness-blocker-actions">
        <button type="button" onClick={onOpenProduction}>处理画面与配音</button>
        <button type="button" onClick={onOpenReview}>审核镜头</button>
      </div>}
    </section>
  );
}
