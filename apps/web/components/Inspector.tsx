'use client';
import {useEffect, useState} from 'react';
import {Film, ImagePlus, Save, Sparkles} from 'lucide-react';
import {activatePanel, activateVideo, listPanelVersions, listVideoVersions, startPanelGeneration, startVideoGeneration, updateShot} from '../lib/api';
import {mediaUrl} from '../lib/api';
import {pollJob} from '../lib/jobs';
import type {Asset, Character, Job, ReviewStatus, Shot} from '../lib/types';
import {DialogueEditor} from './DialogueEditor';
import {JobStatus} from './JobStatus';
import {PanelVersions} from './PanelVersions';

export function Inspector({shot, characters = [], onShotUpdated}: {shot: Shot; characters?: Character[]; onShotUpdated?: (shot: Shot) => void}) {
  const [form, setForm] = useState(shot); const [assets, setAssets] = useState<Asset[]>([]); const [job, setJob] = useState<Job | null>(null); const [error, setError] = useState('');
  const [videos,setVideos]=useState<Asset[]>([]);
  const [generatingPanel,setGeneratingPanel]=useState(false);
  const [generatingVideo,setGeneratingVideo]=useState(false);
  useEffect(() => {
    let current = true;
    setForm(shot);
    setError('');
    setAssets([]);
    setVideos([]);
    listPanelVersions(shot.id)
      .then(nextAssets => {if (current) setAssets(nextAssets);})
      .catch(() => {if (current) setAssets([]);});
    listVideoVersions(shot.id)
      .then(nextVideos => {if (current) setVideos(nextVideos);})
      .catch(() => {if (current) setVideos([]);});
    return () => {current = false;};
  }, [shot]);
  const save = async () => {try {const updated = await updateShot(shot.id, {duration_seconds: Number(form.duration_seconds), composition: form.composition, camera_motion: form.camera_motion, image_prompt: form.image_prompt, negative_prompt: form.negative_prompt, video_prompt: form.video_prompt??'', negative_video_prompt: form.negative_video_prompt??'', review_status: form.review_status}); onShotUpdated?.(updated); setError('');} catch (cause) {setError(cause instanceof Error ? cause.message : '保存失败');}};
  const generate = async () => {if(generatingPanel)return;setGeneratingPanel(true);setError('');setJob(null);try{const started = await startPanelGeneration(shot.id, true); const finished = await pollJob(started.job_id); setJob(finished); if (finished.status === 'succeeded') {setAssets(await listPanelVersions(shot.id)); onShotUpdated?.({...shot, active_panel_asset_id: String(finished.result_metadata.asset_id ?? shot.active_panel_asset_id)});}}catch(cause){setError(cause instanceof Error?cause.message:'画面生成失败');}finally{setGeneratingPanel(false);}};
  const activate = async (assetId: string) => {const updated = await activatePanel(shot.id, assetId); onShotUpdated?.(updated); setForm(updated);};
  const generateVideo = async()=>{if(generatingVideo)return;setGeneratingVideo(true);setError('');setJob(null);try{const updated=await updateShot(shot.id,{video_prompt:form.video_prompt??'',negative_video_prompt:form.negative_video_prompt??''});setForm(updated);onShotUpdated?.(updated);const started=await startVideoGeneration(shot.id,true);const finished=await pollJob(started.job_id);setJob(finished);if(finished.status==='succeeded'){setVideos(await listVideoVersions(shot.id));onShotUpdated?.({...updated,active_video_asset_id:String(finished.result_metadata.asset_id??updated.active_video_asset_id)});}}catch(cause){setError(cause instanceof Error?cause.message:'视频生成失败');}finally{setGeneratingVideo(false);}};
  const selectVideo=async(assetId:string)=>{const updated=await activateVideo(shot.id,assetId);onShotUpdated?.(updated);setForm(updated);};
  const activePanel = assets.find(asset => asset.id === form.active_panel_asset_id);
  const canGenerateVideo = Boolean(form.active_panel_asset_id && form.review_status === 'approved' && !generatingVideo);

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
      <label className="field-spacer" htmlFor="shot-negative-prompt">负面提示词</label><textarea id="shot-negative-prompt" value={form.negative_prompt} onChange={event => setForm({...form, negative_prompt: event.target.value})} rows={2} className="prompt-field"/>
      {error && <p className="form-error">{error}</p>}
      <div className="inspector-actions"><button onClick={save}><Save size={17}/>保存镜头</button><button className="primary-action" onClick={generate} disabled={generatingPanel}><ImagePlus size={18}/>{generatingPanel?'生成中':'生成画面'}</button></div>
      <JobStatus job={job}/>
    </section>
    <PanelVersions assets={assets} activeId={form.active_panel_asset_id} onActivate={activate}/>
    <section className="inspector-section video-section" aria-labelledby="video-generation-heading">
      <div className="section-heading-row">
        <div>
          <span className="section-kicker">短剧动态镜头</span>
          <h3 id="video-generation-heading">图 + 文生成视频</h3>
        </div>
        <span>{videos.length} 个版本</span>
      </div>
      <p className="video-generation-intro">使用当前已选画面作为首帧，再结合运镜与动态提示词生成镜头视频。</p>
      <div className="video-source-card">
        <div className="video-source-preview">
          {activePanel ? <img src={mediaUrl(activePanel.media_url)} alt={`视频首帧：画面版本 ${activePanel.generation_attempt}`}/> : <div className="video-source-empty"><ImagePlus size={20}/><span>尚未选择画面</span></div>}
        </div>
        <div className="video-source-copy"><span>首帧画面</span><strong>{activePanel ? `画面版本 V${activePanel.generation_attempt}` : '等待画面'}</strong><small>{form.active_panel_asset_id ? '生成时锁定当前画面' : '先生成或选择一个画面版本'}</small></div>
      </div>
      <label htmlFor="shot-video-prompt">视频动态提示词</label>
      <textarea id="shot-video-prompt" aria-label="视频动态提示词" className="prompt-field" value={form.video_prompt??''} onChange={event=>setForm({...form,video_prompt:event.target.value})} rows={4} placeholder="例如：镜头缓慢推近，人物抬眼，衣角被风吹动，保持角色外观稳定"/>
      <label className="field-spacer" htmlFor="shot-negative-video-prompt">视频负面提示词</label>
      <textarea id="shot-negative-video-prompt" aria-label="视频负面提示词" className="prompt-field" value={form.negative_video_prompt??''} onChange={event=>setForm({...form,negative_video_prompt:event.target.value})} rows={2} placeholder="例如：闪烁、变形、额外肢体、镜头抖动"/>
      {!form.active_panel_asset_id || form.review_status !== 'approved' ? <p className="video-generation-gate">先生成并选中一张画面，再将镜头审核为已通过。</p> : null}
      <button className="primary-action video-generate" onClick={generateVideo} disabled={!canGenerateVideo} aria-label="使用首帧和提示词生成视频"><Film size={16}/>{generatingVideo?'正在生成视频':'使用首帧 + 提示词生成视频'}</button>
      <div className="video-versions">{videos.map(asset=><button key={asset.id} className={form.active_video_asset_id===asset.id?'active':''} onClick={()=>selectVideo(asset.id)}><video src={mediaUrl(asset.media_url)} muted playsInline controls/><span>V{asset.generation_attempt}</span></button>)}</div>
    </section>
    <section className="inspector-section dialogue-section" aria-labelledby="dialogue-heading">
      <div className="section-heading-row"><h3 id="dialogue-heading">对白与配音</h3><span>{shot.dialogue.length} 条对白</span></div>
      {shot.dialogue.length ? shot.dialogue.map(line => <DialogueEditor key={line.id} line={line} characters={characters} onLineUpdated={updated=>onShotUpdated?.({...shot,dialogue:shot.dialogue.map(item=>item.id===updated.id?updated:item)})}/>) : <p className="section-empty">此镜头没有对白</p>}
    </section>
    <div className="model-note"><Sparkles size={16}/><span>图像由 <strong>gpt-image-2</strong> 生成</span></div>
  </aside>;
}
