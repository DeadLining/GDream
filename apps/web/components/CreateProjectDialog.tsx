'use client';
import {useState} from 'react';
import type {AspectRatio, ProjectCreate} from '../lib/types';
export function CreateProjectDialog({open,onClose,onCreate}:{open:boolean;onClose:()=>void;onCreate:(data:ProjectCreate)=>Promise<void>}) {
  const [saving,setSaving]=useState(false); const [error,setError]=useState(''); if(!open)return null;
  return <div className="dialog-backdrop"><form className="form-dialog" role="dialog" aria-label="新建项目" onSubmit={async(event)=>{event.preventDefault();setSaving(true);setError('');const form=new FormData(event.currentTarget);try{await onCreate({title:String(form.get('title')),logline:String(form.get('logline')),story_bible:String(form.get('story_bible')),visual_style:String(form.get('visual_style')),aspect_ratio:String(form.get('aspect_ratio')) as AspectRatio});}catch(cause){setError(cause instanceof Error?cause.message:'创建失败');}finally{setSaving(false);}}}>
    <header><h2>新建项目</h2><button type="button" aria-label="关闭" onClick={onClose}>×</button></header>
    <label>项目名称<input name="title" required /></label><label>一句话梗概<textarea name="logline" required rows={2}/></label><label>故事设定<textarea name="story_bible" required rows={4}/></label><label>视觉风格<textarea name="visual_style" required rows={3}/></label><label>画幅<select name="aspect_ratio" defaultValue="9:16"><option>9:16</option><option>16:9</option><option>1:1</option></select></label>
    {error&&<p className="form-error">{error}</p>}<footer><button type="button" onClick={onClose}>取消</button><button className="primary-action" disabled={saving}>{saving?'创建中…':'创建项目'}</button></footer>
  </form></div>;
}
