'use client';
import {useState} from 'react'; import type {EpisodeCreate} from '../lib/types';
export function CreateEpisodeDialog({open,onClose,onCreate}:{open:boolean;onClose:()=>void;onCreate:(data:EpisodeCreate)=>Promise<void>}) {
  const [saving,setSaving]=useState(false);const [error,setError]=useState('');if(!open)return null;
  return <div className="dialog-backdrop"><form className="form-dialog" role="dialog" aria-label="新建剧集" onSubmit={async(event)=>{event.preventDefault();setSaving(true);setError('');const form=new FormData(event.currentTarget);try{await onCreate({title:String(form.get('title')),premise:String(form.get('premise')),target_duration_seconds:Number(form.get('duration'))});}catch(cause){setError(cause instanceof Error?cause.message:'创建失败');}finally{setSaving(false);}}}>
    <header><h2>新建剧集</h2><button type="button" aria-label="关闭" onClick={onClose}>×</button></header><label>剧集名称<input name="title" required/></label><label>本集梗概<textarea name="premise" required rows={4}/></label><label>目标时长（秒）<input name="duration" type="number" min={15} max={1800} defaultValue={60} required/></label>{error&&<p className="form-error">{error}</p>}<footer><button type="button" onClick={onClose}>取消</button><button className="primary-action" disabled={saving}>{saving?'创建中…':'创建剧集'}</button></footer>
  </form></div>;
}
