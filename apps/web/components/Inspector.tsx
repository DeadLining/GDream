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
  useEffect(() => {setForm(shot); setError(''); listPanelVersions(shot.id).then(setAssets).catch(() => setAssets([])); listVideoVersions(shot.id).then(setVideos).catch(()=>setVideos([]));}, [shot]);
  const save = async () => {try {const updated = await updateShot(shot.id, {duration_seconds: Number(form.duration_seconds), composition: form.composition, camera_motion: form.camera_motion, image_prompt: form.image_prompt, negative_prompt: form.negative_prompt, video_prompt: form.video_prompt??'', negative_video_prompt: form.negative_video_prompt??'', review_status: form.review_status}); onShotUpdated?.(updated); setError('');} catch (cause) {setError(cause instanceof Error ? cause.message : '保存失败');}};
  const generate = async () => {const started = await startPanelGeneration(shot.id, true); const finished = await pollJob(started.job_id); setJob(finished); if (finished.status === 'succeeded') {setAssets(await listPanelVersions(shot.id)); onShotUpdated?.({...shot, active_panel_asset_id: String(finished.result_metadata.asset_id ?? shot.active_panel_asset_id)});}};
  const activate = async (assetId: string) => {const updated = await activatePanel(shot.id, assetId); onShotUpdated?.(updated); setForm(updated);};
  const generateVideo = async()=>{const started=await startVideoGeneration(shot.id,true);const finished=await pollJob(started.job_id);setJob(finished);if(finished.status==='succeeded'){setVideos(await listVideoVersions(shot.id));onShotUpdated?.({...shot,active_video_asset_id:String(finished.result_metadata.asset_id??shot.active_video_asset_id)});}};
  const selectVideo=async(assetId:string)=>{const updated=await activateVideo(shot.id,assetId);onShotUpdated?.(updated);setForm(updated);};

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
      <div className="inspector-actions"><button onClick={save}><Save size={17}/>保存镜头</button><button className="primary-action" onClick={generate}><ImagePlus size={18}/>生成画面</button></div>
      <JobStatus job={job}/>
    </section>
    <PanelVersions assets={assets} activeId={form.active_panel_asset_id} onActivate={activate}/>
    <section className="inspector-section video-section"><div className="section-heading-row"><h3>视频生成</h3><span>{videos.length} 个版本</span></div><label>视频提示词<textarea value={form.video_prompt??''} onChange={event=>setForm({...form,video_prompt:event.target.value})} rows={3}/></label><label className="field-spacer">视频负面提示词<textarea value={form.negative_video_prompt??''} onChange={event=>setForm({...form,negative_video_prompt:event.target.value})} rows={2}/></label><button className="primary-action video-generate" onClick={generateVideo} disabled={!form.active_panel_asset_id||form.review_status!=='approved'}><Film size={16}/>生成视频</button><div className="video-versions">{videos.map(asset=><button key={asset.id} className={form.active_video_asset_id===asset.id?'active':''} onClick={()=>selectVideo(asset.id)}><video src={mediaUrl(asset.media_url)} muted playsInline controls/><span>V{asset.generation_attempt}</span></button>)}</div></section>
    <section className="inspector-section dialogue-section" aria-labelledby="dialogue-heading">
      <div className="section-heading-row"><h3 id="dialogue-heading">对白与配音</h3><span>{shot.dialogue.length} 条对白</span></div>
      {shot.dialogue.length ? shot.dialogue.map(line => <DialogueEditor key={line.id} line={line} characters={characters}/>) : <p className="section-empty">此镜头没有对白</p>}
    </section>
    <div className="model-note"><Sparkles size={16}/><span>图像由 <strong>gpt-image-2</strong> 生成</span></div>
  </aside>;
}
