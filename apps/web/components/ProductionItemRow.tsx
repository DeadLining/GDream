import {AlertCircle, CheckCircle2, Clock3, Image, LoaderCircle, Mic2, SkipForward} from 'lucide-react';
import type {ProductionItem} from '../lib/types';

const statusPresentation = {
  queued: {label: '等待中', icon: Clock3, accessibleName: '任务等待中'},
  running: {label: '进行中', icon: LoaderCircle, accessibleName: '任务进行中'},
  succeeded: {label: '已完成', icon: CheckCircle2, accessibleName: '任务已完成'},
  failed: {label: '失败', icon: AlertCircle, accessibleName: '任务失败'},
  skipped: {label: '已跳过', icon: SkipForward, accessibleName: '任务已跳过'},
} as const;

export function ProductionItemRow({item, selected, onSelect, onOpen}: {item: ProductionItem; selected: boolean; onSelect: (value: boolean) => void; onOpen: () => void}) {
  const StageIcon = item.stage === 'panel' ? Image : Mic2;
  const status = statusPresentation[item.status];
  const StatusIcon = status.icon;

  return <div className={`production-item ${item.status}`}>
    <span className="production-select-slot">{item.status === 'failed' && <input aria-label={`选择失败项 ${item.id}`} type="checkbox" checked={selected} onChange={event => onSelect(event.target.checked)}/>}</span>
    <button className="production-item-target" onClick={onOpen}>
      <StageIcon size={16} aria-label={item.stage === 'panel' ? '画面任务' : '配音任务'}/>
      <span className="production-item-context"><strong>{item.stage === 'panel' ? '画面' : '配音'} · {item.target_id}</strong><small>尝试 {item.attempt_count} 次</small></span>
    </button>
    <span className={`production-item-status ${item.status}`}><StatusIcon size={15} aria-label={status.accessibleName}/><span>{status.label}</span></span>
    {item.error && <small className="production-item-error" role="region" aria-label="任务错误">{item.error}</small>}
  </div>;
}
