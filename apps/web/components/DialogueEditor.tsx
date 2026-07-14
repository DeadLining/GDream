'use client';
import {useEffect,useRef,useState} from 'react';
import {Mic2, Save} from 'lucide-react';
import {mediaUrl, startSpeech, updateDialogue} from '../lib/api';
import {pollJob} from '../lib/jobs';
import type {Character, DialogueLine, Job} from '../lib/types';
import {JobStatus} from './JobStatus';

export function DialogueEditor({line,characters=[],onLineUpdated}:{line:DialogueLine;characters?:Character[];onLineUpdated?:(line:DialogueLine)=>void}) {
  const [form,setForm]=useState(line);const [job,setJob]=useState<Job|null>(null);const [audio,setAudio]=useState<string|null>(null);const [saving,setSaving]=useState(false);const [generating,setGenerating]=useState(false);const [saved,setSaved]=useState(false);const [error,setError]=useState('');const busyRef=useRef(false);
  useEffect(()=>{setForm(line);setError('');setSaved(false);},[line]);
  const assignedCharacterId = characters.some(character => character.id === form.character_id) ? form.character_id ?? '' : '';
  const busy=saving||generating;
  const persist=async()=>{const updated=await updateDialogue(line.id,{character_id:form.character_id,text:form.text,subtitle_text:form.subtitle_text,emotion:form.emotion,performance_instruction:form.performance_instruction});setForm(updated);setSaved(true);onLineUpdated?.(updated);return updated;};
  const save=async()=>{if(busyRef.current)return;busyRef.current=true;setSaving(true);setSaved(false);setError('');try{await persist();}catch(cause){setError(cause instanceof Error?cause.message:'对白保存失败');}finally{busyRef.current=false;setSaving(false);}};
  const speech=async()=>{if(busyRef.current||!assignedCharacterId)return;busyRef.current=true;setGenerating(true);setSaved(false);setError('');setJob(null);setAudio(null);try{const updated=await persist();if(!updated.character_id)throw new Error('请先选择并保存对白角色');const started=await startSpeech(updated.id);const finished=await pollJob(started.job_id);setJob(finished);const path=finished.result_metadata.media_url;if(finished.status==='succeeded'&&typeof path==='string')setAudio(mediaUrl(path));}catch(cause){setError(cause instanceof Error?cause.message:'配音生成失败');}finally{busyRef.current=false;setGenerating(false);}};
  return <div className="dialogue-editor">
    <label>对白角色<select aria-label="对白角色" value={assignedCharacterId} disabled={busy} onChange={event=>setForm({...form,character_id:event.target.value||null})}><option value="">未分配角色</option>{characters.map(character=><option key={character.id} value={character.id}>{character.name} · {character.voice_speaker||'未设置声音'}</option>)}</select></label>
    <div className="dialogue-copy"><label>对白<textarea aria-label="对白文本" value={form.text} disabled={busy} onChange={event=>setForm({...form,text:event.target.value})}/></label><label>字幕<textarea aria-label="字幕文本" value={form.subtitle_text} disabled={busy} onChange={event=>setForm({...form,subtitle_text:event.target.value})}/></label></div>
    <div className="inline-fields"><label>情绪<input value={form.emotion} disabled={busy} onChange={event=>setForm({...form,emotion:event.target.value})}/></label><label>表演指令<input value={form.performance_instruction} disabled={busy} onChange={event=>setForm({...form,performance_instruction:event.target.value})}/></label></div>
    <div className="dialogue-actions"><button onClick={()=>void save()} disabled={busy}><Save size={15}/>{saving?'保存中':'保存对白'}</button><button className="primary-action dialogue-primary-action" onClick={()=>void speech()} disabled={!assignedCharacterId||busy||job?.status==='queued'||job?.status==='running'} title={assignedCharacterId?'生成配音':'请先选择并保存对白角色'}><Mic2 size={15}/>{generating?'生成中':'生成配音'}</button></div>
    {error?<p className="dialogue-save-status error" role="alert">{error}</p>:saved?<p className="dialogue-save-status success" role="status">对白已保存</p>:null}
    <JobStatus job={job}/>{audio && <audio aria-label="对白音频" controls src={audio}/>}
  </div>;
}
