import {AlertCircle, CheckCircle2, Clock3, Image, LoaderCircle, Mic2, SkipForward} from 'lucide-react';
import type {ProductionItem} from '../lib/types';
import {shotGenerationBlockerLabel} from '../lib/shot-generation-readiness';

const statusPresentation = {
  queued: {label: '等待中', icon: Clock3, accessibleName: '任务等待中'},
  running: {label: '进行中', icon: LoaderCircle, accessibleName: '任务进行中'},
  succeeded: {label: '已完成', icon: CheckCircle2, accessibleName: '任务已完成'},
  failed: {label: '失败', icon: AlertCircle, accessibleName: '任务失败'},
  skipped: {label: '已跳过', icon: SkipForward, accessibleName: '任务已跳过'},
} as const;

function stringList(value:unknown){return Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[];}

function skippedReason(item:ProductionItem){
  if(item.status!=='skipped')return '';
  const reason=item.result_metadata.reason;
  if(reason==='already_ready')return '已有审核画面';
  if(reason==='missing_approved_panel')return '缺少已审核画面';
  if(reason!=='generation_not_ready')return '';
  const direct=stringList(item.result_metadata.blockers);
  if(direct.length)return direct.map(shotGenerationBlockerLabel).join('、');
  const blockedShots=item.result_metadata.blocked_shots;
  if(!blockedShots||typeof blockedShots!=='object'||Array.isArray(blockedShots))return '';
  const entries=Object.values(blockedShots);
  const blockers=[...new Set(entries.flatMap(stringList))];
  return `${entries.length} 个镜头未就绪：${blockers.map(shotGenerationBlockerLabel).join('、')}`;
}

export function ProductionItemRow({item, selected, onSelect, onOpen}: {item: ProductionItem; selected: boolean; onSelect: (value: boolean) => void; onOpen: () => void}) {
  const StageIcon = item.stage === 'panel' ? Image : Mic2;
  const status = statusPresentation[item.status];
  const StatusIcon = status.icon;
  const skipReason=skippedReason(item);

  return <div className={`production-item ${item.status}`}>
    <span className="production-select-slot">{item.status === 'failed' && <input aria-label={`选择失败项 ${item.id}`} type="checkbox" checked={selected} onChange={event => onSelect(event.target.checked)}/>}</span>
    <button className="production-item-target" onClick={onOpen}>
      <StageIcon size={16} aria-label={item.stage === 'panel' ? '画面任务' : '配音任务'}/>
      <span className="production-item-context"><strong>{item.stage === 'panel' ? '画面' : '配音'} · {item.target_id}</strong><small>尝试 {item.attempt_count} 次</small></span>
    </button>
    <span className={`production-item-status ${item.status}`}><StatusIcon size={15} aria-label={status.accessibleName}/><span>{status.label}</span></span>
    {item.error && <small className="production-item-error" role="region" aria-label="任务错误">{item.error}</small>}
    {skipReason && <small className="production-item-skip-reason" role="region" aria-label="任务跳过原因">{skipReason}</small>}
  </div>;
}
