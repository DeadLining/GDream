'use client';
import {useEffect,useMemo,useState} from 'react';
import type {DirectorApplyField,DirectorSuggestion,Shot} from '../../lib/types';
const labels:Record<DirectorApplyField,string>={composition:'构图',camera_motion:'运镜',image_prompt:'图像提示词',negative_prompt:'负面提示词'};
export function DirectorSuggestionDialog({suggestion,shot,busy,onCancel,onApply}:{suggestion:DirectorSuggestion|null;shot:Shot;busy:boolean;onCancel:()=>void;onApply:(fields:DirectorApplyField[])=>void}){
  const available=useMemo(()=>suggestion?(Object.keys(labels) as DirectorApplyField[]).filter(field=>typeof suggestion.suggested_patch[field]==='string'):[],[suggestion]);
  const [selected,setSelected]=useState<Set<DirectorApplyField>>(new Set());
  useEffect(()=>setSelected(new Set(available.filter(field=>field==='composition'||field==='camera_motion'))),[suggestion?.id]);
  if(!suggestion)return null;
  const toggle=(field:DirectorApplyField)=>setSelected(current=>{const next=new Set(current);if(next.has(field))next.delete(field);else next.add(field);return next;});
  return <div className="director-dialog-backdrop"><section className="director-suggestion-dialog" role="dialog" aria-modal="true" aria-label="AI 导演建议"><header><div><strong>AI 导演建议</strong><span>{String(suggestion.suggested_patch.rationale??'构图与镜头建议')}</span></div><button className="icon-button" aria-label="关闭建议" onClick={onCancel}>×</button></header><div className="director-suggestion-fields">{available.map(field=><label key={field}><input type="checkbox" aria-label={labels[field]} checked={selected.has(field)} onChange={()=>toggle(field)}/><span>{labels[field]}</span><div><small>当前</small><p>{String(shot[field]??'')}</p></div><div><small>建议</small><p>{String(suggestion.suggested_patch[field]??'')}</p></div></label>)}</div><footer><button className="secondary-action" onClick={onCancel} disabled={busy}>取消</button><button className="primary-action" disabled={busy||selected.size===0} onClick={()=>onApply(available.filter(field=>selected.has(field)))}>{busy?'正在应用':'应用选中字段'}</button></footer></section></div>;
}
