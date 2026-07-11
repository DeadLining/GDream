import {Check, Clock3, ImageIcon, MessageSquareText} from 'lucide-react';
import type {Shot} from '../lib/types';

export function ShotCard({shot, selected, onSelect}: {shot: Shot; selected: boolean; onSelect: () => void}) {
  const hasPanel = Boolean(shot.active_panel_asset_id);
  return (
    <button
      className={`shot-card ${selected ? 'selected' : ''}`}
      onClick={onSelect}
      aria-label={`镜头 ${shot.position}：${shot.composition}`}
    >
      <div className="shot-media">
        {hasPanel ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/demo-panel.png" alt="林默站在雨夜霓虹巷道的漫画分镜" />
        ) : (
          <div className="empty-panel"><ImageIcon size={28} /><span>等待生成</span></div>
        )}
        <span className="shot-number">{String(shot.position).padStart(2, '0')}</span>
        {shot.review_status === 'approved' ? <span className="approved-mark"><Check size={14} /></span> : null}
      </div>
      <div className="shot-meta">
        <strong>{shot.shot_type.replace('_', ' ')}</strong>
        <span><Clock3 size={13} />{shot.duration_seconds}s</span>
        {shot.dialogue.length ? <span><MessageSquareText size={13} />{shot.dialogue.length}</span> : null}
      </div>
      <p>{shot.composition}</p>
    </button>
  );
}
