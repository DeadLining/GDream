'use client';

import {useEffect,useState} from 'react';
import {Save} from 'lucide-react';
import {resolveDirectorEnvironment,type DirectorEnvironmentSettings,type DirectorGroundStyle} from '../../lib/director-environment';

export function DirectorEnvironmentControls({environment,saving,onSave}:{environment:Record<string,unknown>;saving:boolean;onSave:(settings:DirectorEnvironmentSettings)=>void}){
  const [draft,setDraft]=useState(()=>resolveDirectorEnvironment(environment));
  useEffect(()=>setDraft(resolveDirectorEnvironment(environment)),[environment]);
  const set=<K extends keyof DirectorEnvironmentSettings>(key:K,value:DirectorEnvironmentSettings[K])=>setDraft(current=>({...current,[key]:value}));
  return <section className="director-environment-controls" aria-label="场景环境">
    <strong>场景环境</strong>
    <div className="director-environment-grid">
      <label><span>背景颜色</span><input aria-label="背景颜色" type="color" value={draft.background_color} onChange={event=>set('background_color',event.target.value)}/></label>
      <label><span>地面样式</span><select aria-label="地面样式" value={draft.ground} onChange={event=>set('ground',event.target.value as DirectorGroundStyle)}><option value="grid">网格</option><option value="solid">实体</option><option value="none">隐藏</option></select></label>
      <label><span>地面颜色</span><input aria-label="地面颜色" type="color" value={draft.ground_color} disabled={draft.ground==='none'} onChange={event=>set('ground_color',event.target.value)}/></label>
      <label><span>主光颜色</span><input aria-label="主光颜色" type="color" value={draft.key_light_color} onChange={event=>set('key_light_color',event.target.value)}/></label>
    </div>
    <label className="director-light-control"><span>环境光强度</span><input aria-label="环境光强度" type="range" min="0" max="3" step="0.1" value={draft.ambient_light} onChange={event=>set('ambient_light',Number(event.target.value))}/><output>{draft.ambient_light.toFixed(1)}</output></label>
    <label className="director-light-control"><span>主光强度</span><input aria-label="主光强度" type="range" min="0" max="3" step="0.1" value={draft.key_light_intensity} onChange={event=>set('key_light_intensity',Number(event.target.value))}/><output>{draft.key_light_intensity.toFixed(1)}</output></label>
    <button type="button" className="command-button" disabled={saving} onClick={()=>onSave(draft)}><Save size={14}/>{saving?'保存中':'保存环境设置'}</button>
  </section>;
}
