import {Film,Image, ListTodo,Mic2,Pause,Play,Settings2} from 'lucide-react';
import type {ProductionRun,ProductionStage} from '../../lib/types';

export function ProductionRunControls({open,onOpenChange,stages,setStages,concurrency,setConcurrency,regenerate,setRegenerate,panelGenerationMode,setPanelGenerationMode,budgetCapUsd,setBudgetCapUsd,budgetMode,setBudgetMode,run,starting,onStart,onPause,onResume,onOpenQueue}:{
  open:boolean;onOpenChange:(open:boolean)=>void;stages:ProductionStage[];setStages:(stages:ProductionStage[])=>void;concurrency:number;setConcurrency:(value:number)=>void;
  regenerate:{panels:boolean;speech:boolean;videos:boolean};setRegenerate:(next:{panels:boolean;speech:boolean;videos:boolean})=>void;
  panelGenerationMode:'solo'|'grid';setPanelGenerationMode:(value:'solo'|'grid')=>void;
  budgetCapUsd:number;setBudgetCapUsd:(value:number)=>void;
  budgetMode:'observe'|'warn'|'cap';setBudgetMode:(value:'observe'|'warn'|'cap')=>void;
  run:ProductionRun|null;starting:boolean;onStart:()=>void;onPause:()=>void;onResume:()=>void;onOpenQueue:()=>void;
}){
  const toggleStage=(stage:ProductionStage,checked:boolean)=>setStages(checked?[...stages,stage]:stages.filter(item=>item!==stage));
  const budgetProgress = run && run.budget_cap_usd ? Math.min(100, Math.round((run.spent_usd / run.budget_cap_usd) * 100)) : null;
  return <div className="production-run-controls">
    <button aria-label="生产设置" aria-expanded={open} onClick={()=>onOpenChange(!open)}><Settings2 size={16}/><span>生产设置</span></button>
    {!run&&<button className="primary-action" aria-label={starting?'正在启动':'开始批量生产'} disabled={!stages.length||starting} aria-busy={starting} onClick={onStart}><Play size={16}/><span>{starting?'正在启动':'开始批量生产'}</span></button>}
    {run?.status==='running'&&<button aria-label="暂停" onClick={onPause}><Pause size={16}/><span>暂停</span></button>}
    {run?.status==='paused'&&<button aria-label="继续" onClick={onResume}><Play size={16}/><span>继续</span></button>}
    {run&&<button aria-label={`任务队列 ${run.total_items}`} onClick={onOpenQueue}><ListTodo size={16}/><span>任务队列</span><b>{run.total_items}</b></button>}
    {open&&<section className="production-config-popover" role="dialog" aria-label="生产设置面板">
      <header><div><small>当前集统一执行</small><h2>生产配置</h2></div><button aria-label="关闭生产设置" onClick={()=>onOpenChange(false)}>×</button></header>
      <fieldset><legend>生成范围</legend>
        <label><input aria-label="画面" type="checkbox" checked={stages.includes('panels')} onChange={event=>toggleStage('panels',event.target.checked)}/><Image size={15}/>画面</label>
        <label><input aria-label="配音" type="checkbox" checked={stages.includes('speech')} onChange={event=>toggleStage('speech',event.target.checked)}/><Mic2 size={15}/>配音</label>
        <label><input aria-label="视频" type="checkbox" checked={stages.includes('videos')} onChange={event=>toggleStage('videos',event.target.checked)}/><Film size={15}/>视频</label>
      </fieldset>
      <label className="production-concurrency">并发数<input aria-label="并发数" type="number" min={1} max={4} value={concurrency} onChange={event=>setConcurrency(Number(event.target.value))}/></label>
      <label className="production-panel-mode">画面生成模式
        <select aria-label="画面生成模式" value={panelGenerationMode} onChange={event=>setPanelGenerationMode(event.target.value as 'solo'|'grid')}>
          <option value="solo">单镜生成</option>
          <option value="grid">宫格生成（2x2）</option>
        </select>
      </label>
      <label className="production-budget">预算上限（USD）<input aria-label="预算上限" type="number" min={0} step={0.01} value={budgetCapUsd} onChange={event=>setBudgetCapUsd(Math.max(0, Number(event.target.value)))}/></label>
      <label className="production-budget-mode">预算模式
        <select aria-label="预算模式" value={budgetMode} onChange={event=>setBudgetMode(event.target.value as 'observe'|'warn'|'cap')}>
          <option value="observe">仅观察</option>
          <option value="warn">超出警告</option>
          <option value="cap">超出暂停</option>
        </select>
      </label>
      {budgetProgress !== null && (
        <div className="production-budget-progress" role="progressbar" aria-label="预算使用进度" aria-valuenow={budgetProgress}>
          <span>已用 ${run!.spent_usd.toFixed(3)} / ${run!.budget_cap_usd!.toFixed(2)}</span>
          <div className="progress-bar"><div style={{width:`${budgetProgress}%`}}/></div>
          <span>{budgetProgress}%</span>
        </div>
      )}
      <fieldset><legend>重新生成</legend>
        <label><input aria-label="重生成画面" type="checkbox" checked={regenerate.panels} onChange={event=>setRegenerate({...regenerate,panels:event.target.checked})}/>画面</label>
        <label><input aria-label="重生成配音" type="checkbox" checked={regenerate.speech} onChange={event=>setRegenerate({...regenerate,speech:event.target.checked})}/>配音</label>
        <label><input aria-label="重生成视频" type="checkbox" checked={regenerate.videos} onChange={event=>setRegenerate({...regenerate,videos:event.target.checked})}/>视频</label>
      </fieldset>
    </section>}
  </div>;
}
