'use client';
import {useEffect, useState} from 'react';
import {Mic2, Save} from 'lucide-react';
import {mediaUrl, startSpeech, updateDialogue} from '../lib/api';
import {pollJob} from '../lib/jobs';
import type {Character, DialogueLine, Job} from '../lib/types';
import {JobStatus} from './JobStatus';

export function DialogueEditor({line, characters = []}: {line: DialogueLine; characters?: Character[]}) {
  const [form, setForm] = useState(line); const [job, setJob] = useState<Job | null>(null); const [audio, setAudio] = useState<string | null>(null);
  useEffect(() => setForm(line), [line]);
  const assignedCharacterId = characters.some(character => character.id === form.character_id) ? form.character_id ?? '' : '';
  const speech = async () => {const started = await startSpeech(line.id); const finished = await pollJob(started.job_id); setJob(finished); const path = finished.result_metadata.media_url; if (finished.status === 'succeeded' && typeof path === 'string') setAudio(mediaUrl(path));};
  return <div className="dialogue-editor">
    <label>对白角色<select aria-label="对白角色" value={assignedCharacterId} onChange={event => setForm({...form, character_id: event.target.value || null})}><option value="">未分配角色</option>{characters.map(character => <option key={character.id} value={character.id}>{character.name} · {character.voice_speaker || '未设置声音'}</option>)}</select></label>
    <div className="dialogue-copy"><label>对白<textarea aria-label="对白文本" value={form.text} onChange={event => setForm({...form, text: event.target.value})}/></label><label>字幕<textarea aria-label="字幕文本" value={form.subtitle_text} onChange={event => setForm({...form, subtitle_text: event.target.value})}/></label></div>
    <div className="inline-fields"><label>情绪<input value={form.emotion} onChange={event => setForm({...form, emotion: event.target.value})}/></label><label>表演指令<input value={form.performance_instruction} onChange={event => setForm({...form, performance_instruction: event.target.value})}/></label></div>
    <div className="dialogue-actions"><button onClick={() => updateDialogue(line.id, {character_id: form.character_id, text: form.text, subtitle_text: form.subtitle_text, emotion: form.emotion, performance_instruction: form.performance_instruction})}><Save size={15}/>保存对白</button><button className="primary-action dialogue-primary-action" onClick={speech} disabled={!assignedCharacterId || job?.status === 'queued' || job?.status === 'running'} title={assignedCharacterId ? '生成配音' : '请先选择并保存对白角色'}><Mic2 size={15}/>生成配音</button></div>
    <JobStatus job={job}/>{audio && <audio aria-label="对白音频" controls src={audio}/>}
  </div>;
}
