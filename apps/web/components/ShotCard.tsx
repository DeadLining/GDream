import {AlertCircle, Check, Clock3, ImageOff, MessageSquareText} from 'lucide-react';
import type {Shot} from '../lib/types';

const SHOT_TYPES: Record<string, string> = {
  close_up: '特写', medium_shot: '中景', wide_shot: '全景', extreme_close_up: '大特写',
  long_shot: '远景', over_the_shoulder: '过肩', point_of_view: '主观', insert: '插入',
};

export function ShotCard({shot, selected, onSelect}: {shot: Shot; selected: boolean; onSelect: () => void}) {
  const hasPanel = Boolean(shot.active_panel_asset_id);
  const failed = shot.render_status === 'failed';
  const reviewLabel = shot.review_status === 'approved' ? '已通过' : shot.review_status === 'needs_changes' ? '需修改' : '待审核';
  const mediaLabel = failed ? '生成失败' : hasPanel ? '已有画面' : '缺少画面';
  const accessibleName = `镜头 ${shot.position}：${shot.composition}，${reviewLabel}，${mediaLabel}${selected ? '，已选中' : ''}`;

  return (
    <button className={`shot-card${selected ? ' selected' : ''}${failed ? ' failed' : ''}`} onClick={onSelect} aria-label={accessibleName} aria-pressed={selected}>
      <div className="shot-media">
        {hasPanel ? <img src="/demo-panel.png" alt="林默站在雨夜霓虹巷道的漫画分镜" /> : <div className="empty-panel"><ImageOff size={28}/><span>{failed ? '生成失败' : '等待生成'}</span></div>}
        <span className="shot-number">{String(shot.position).padStart(2, '0')}</span>
      </div>
      <div className="shot-meta">
        <strong>{SHOT_TYPES[shot.shot_type] ?? shot.shot_type.replaceAll('_', ' ')}</strong>
        <span><Clock3 size={13}/>{shot.duration_seconds}s</span>
        <span><MessageSquareText size={13}/>{shot.dialogue.length}</span>
      </div>
      <p className="shot-description">{shot.composition}</p>
      <div className="shot-status" aria-label="镜头状态">
        <span className={`shot-status-badge review-${shot.review_status}`}>{shot.review_status === 'approved' ? <Check size={13}/> : <AlertCircle size={13}/>} {reviewLabel}</span>
        <span className={`shot-status-badge media-${failed ? 'failed' : hasPanel ? 'ready' : 'missing'}`}>{failed ? <AlertCircle size={13}/> : hasPanel ? <Check size={13}/> : <ImageOff size={13}/>} {mediaLabel}</span>
      </div>
    </button>
  );
}
