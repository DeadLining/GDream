'use client';
import {useEffect, useState} from 'react';
import {AudioLines, ChevronRight, Film, ImagePlus, Images, Save, Sparkles} from 'lucide-react';
import {activatePanel, listPanelVersions, startPanelGeneration, updateShot} from '../lib/api';
import {pollJob} from '../lib/jobs';
import type {Asset, Job, ReviewStatus, Shot} from '../lib/types';
import {JobStatus} from './JobStatus';
import {PanelVersions} from './PanelVersions';

export function Inspector({shot,onShotUpdated,onOpenMedia,onOpenDialogue}: {shot:Shot;onShotUpdated?:(shot:Shot)=>void;onOpenMedia?:(mode:'panel'|'video')=>void;onOpenDialogue?:()=>void}) {
  const [form, setForm] = useState(shot); const [assets, setAssets] = useState<Asset[]>([]); const [job, setJob] = useState<Job | null>(null); const [error, setError] = useState('');
  const [generatingPanel,setGeneratingPanel]=useState(false);
  useEffect(() => {
    let current = true;
    setForm(shot);
    setError('');
    setAssets([]);
    listPanelVersions(shot.id)
      .then(nextAssets => {if (current) setAssets(nextAssets);})
      .catch(() => {if (current) setAssets([]);});
    return () => {current = false;};
  }, [shot]);
  const save = async () => {try {const updated = await updateShot(shot.id, {duration_seconds: Number(form.duration_seconds), composition: form.composition, camera_motion: form.camera_motion, image_prompt: form.image_prompt, negative_prompt: form.negative_prompt, review_status: form.review_status}); onShotUpdated?.(updated); setError('');} catch (cause) {setError(cause instanceof Error ? cause.message : '保存失败');}};
  const generate = async () => {if(generatingPanel)return;setGeneratingPanel(true);setError('');setJob(null);try{const started = await startPanelGeneration(shot.id, true); const finished = await pollJob(started.job_id); setJob(finished); if (finished.status === 'succeeded') {setAssets(await listPanelVersions(shot.id)); onShotUpdated?.({...shot, active_panel_asset_id: String(finished.result_metadata.asset_id ?? shot.active_panel_asset_id)});}}catch(cause){setError(cause instanceof Error?cause.message:'画面生成失败');}finally{setGeneratingPanel(false);}};
  const activate = async (assetId: string) => {const updated = await activatePanel(shot.id, assetId); onShotUpdated?.(updated); setForm(updated);};
  const activePanel = assets.find(asset => asset.id === form.active_panel_asset_id);
  const stalePanelMessage=activePanel?.is_stale
    ?activePanel.stale_reason==='missing_provenance'
      ?'当前画面缺少可验证的生成快照'
      :activePanel.stale_reason==='inputs_unavailable'
        ?'当前画面依赖的角色或导演输入已不可用'
        :'当前画面使用的角色、场景或导演输入已变化'
    :'';

  return <aside className="inspector">
    <div className="inspector-heading"><span>镜头检查器</span><h2>镜头 {shot.position}</h2><p>{shot.shot_type.replaceAll('_', ' ')} · {shot.duration_seconds} 秒</p></div>
    <section className="inspector-section" aria-labelledby="shot-status-heading">
      <h3 id="shot-status-heading">镜头状态</h3>
      <div className="inline-fields"><label>时长（秒）<input id="shot-duration" aria-label="时长（秒）" type="number" min={0.1} max={30} step={0.1} value={form.duration_seconds} onChange={event => setForm({...form, duration_seconds: Number(event.target.value)})}/></label><label>审核状态<select aria-label="审核状态" value={form.review_status} onChange={event => setForm({...form, review_status: event.target.value as ReviewStatus})}><option value="draft">待审核</option><option value="needs_changes">需修改</option><option value="approved">已通过</option></select></label></div>
    </section>
    <section className="inspector-section" aria-labelledby="composition-heading">
      <h3 id="composition-heading">构图与运动</h3>
      <label htmlFor="shot-composition">画面描述</label><textarea id="shot-composition" value={form.composition} onChange={event => setForm({...form, composition: event.target.value})} rows={3}/>
      <label className="field-spacer">运镜<select aria-label="运镜" value={form.camera_motion} onChange={event => setForm({...form, camera_motion: event.target.value})}><option value="push_in">push in</option><option value="pull_out">pull out</option><option value="pan_left">pan left</option><option value="pan_right">pan right</option><option value="still">still</option></select></label>
    </section>
    <section className="inspector-section" aria-labelledby="prompt-heading">
      <h3 id="prompt-heading">生成提示</h3>
      <label htmlFor="shot-prompt">生成提示词</label><textarea id="shot-prompt" value={form.image_prompt} onChange={event => setForm({...form, image_prompt: event.target.value})} rows={5} className="prompt-field"/>
      <details className="inspector-advanced"><summary>高级生成设置</summary><label htmlFor="shot-negative-prompt">负面提示词</label><textarea id="shot-negative-prompt" value={form.negative_prompt} onChange={event => setForm({...form, negative_prompt: event.target.value})} rows={2} className="prompt-field"/><div className="model-note"><Sparkles size={14}/><span>图像模型 <strong>gpt-image-2</strong></span></div></details>
      {error && <p className="form-error">{error}</p>}
      {stalePanelMessage&&<p className="panel-stale-notice" role="status">{stalePanelMessage}</p>}
      <div className="inspector-actions"><button onClick={save}><Save size={17}/>保存镜头</button><button className="primary-action" onClick={generate} disabled={generatingPanel}><ImagePlus size={18}/>{generatingPanel?'生成中':activePanel?.is_stale?'重新生成画面':'生成画面'}</button></div>
      <JobStatus job={job}/>
    </section>
    <PanelVersions assets={assets} activeId={form.active_panel_asset_id} onActivate={activate}/>
    <section className="inspector-section inspector-workflows" aria-labelledby="production-tools-heading">
      <h3 id="production-tools-heading">继续制作</h3>
      <div className="inspector-workflow-list">
        <button type="button" aria-label="管理分镜版本" onClick={()=>onOpenMedia?.('panel')}><Images size={16}/><span><strong>分镜版本</strong><small>{assets.length} 个版本</small></span><ChevronRight size={15}/></button>
        <button type="button" aria-label="打开视频生成" onClick={()=>onOpenMedia?.('video')}><Film size={16}/><span><strong>视频生成</strong><small>{form.active_video_asset_id?'已有当前版本':'进入完整工作区'}</small></span><ChevronRight size={15}/></button>
        <button type="button" aria-label="打开对白配音" onClick={onOpenDialogue}><AudioLines size={16}/><span><strong>对白与配音</strong><small>{shot.dialogue.length} 条对白</small></span><ChevronRight size={15}/></button>
      </div>
    </section>
  </aside>;
}
