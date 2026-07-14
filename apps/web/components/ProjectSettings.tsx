'use client';

import {useState} from 'react';
import {BookOpen, Boxes, Camera, Clapperboard, FileText, Settings2, ShieldAlert} from 'lucide-react';
import type {ProjectDetail,ProjectPatch,Volume} from '../lib/types';
import {ProjectImportExport} from './ProjectImportExport';

export function ProjectSettings({project,volumes,sceneCount,shotCount,onSave}:{project:ProjectDetail;volumes:Volume[];sceneCount:number;shotCount:number;onSave:(data:ProjectPatch)=>Promise<void>|void}){
  const [title,setTitle]=useState(project.title);
  const [logline,setLogline]=useState(project.logline);
  const [visualStyle,setVisualStyle]=useState(project.visual_style);
  const [aspectRatio,setAspectRatio]=useState<ProjectDetail['aspect_ratio']>(project.aspect_ratio);
  const [language,setLanguage]=useState(project.language);
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState('');
  const save=async()=>{if(!title.trim()||busy)return;setBusy(true);setStatus('');try{await onSave({title:title.trim(),logline:logline.trim(),visual_style:visualStyle.trim(),aspect_ratio:aspectRatio,language});setStatus('设置已保存');}catch(cause){setStatus(cause instanceof Error?cause.message:'保存失败');}finally{setBusy(false);}};
  return <main className="project-settings-page">
    <aside className="project-settings-nav"><h1>作品设置</h1>{[['基本信息',Settings2],['结构规则',BookOpen],['生成规范',Boxes],['文件与存储',FileText],['危险操作',ShieldAlert]].map(([label,Icon],index)=><button key={String(label)} className={index===0?'active':''}><Icon size={15}/>{String(label)}</button>)}</aside>
    <section className="project-settings-content">
      <header><div><span>作品设置 / 基本信息</span><h1>作品基本信息</h1><p>统一作品元数据、输出比例和稳定结构规则。</p></div></header>
      <form onSubmit={event=>{event.preventDefault();void save();}}>
        <section className="project-settings-form-section"><h2>基础资料</h2><label>作品名称<input aria-label="作品名称" value={title} onChange={event=>setTitle(event.target.value)}/></label><label>一句话梗概<textarea aria-label="一句话梗概" value={logline} onChange={event=>setLogline(event.target.value)}/></label><div><label>视觉风格<input aria-label="视觉风格" value={visualStyle} onChange={event=>setVisualStyle(event.target.value)}/></label><label>作品语言<select aria-label="作品语言" value={language} onChange={event=>setLanguage(event.target.value)}><option value="Chinese">简体中文</option><option value="English">English</option><option value="Japanese">日本語</option></select></label></div><fieldset><legend>画面比例</legend>{(['16:9','9:16','1:1'] as const).map(value=><label key={value}><input type="radio" name="aspect" value={value} checked={aspectRatio===value} onChange={()=>setAspectRatio(value)}/><span>{value}</span></label>)}</fieldset></section>
        <section className="project-structure-rules"><h2>作品结构规则</h2><div className="project-hierarchy"><span><BookOpen size={16}/>作品</span><b>→</b><span><FileText size={16}/>卷/篇章</span><b>→</b><span><Clapperboard size={16}/>集</span><b>→</b><span><Boxes size={16}/>场景</span><b>→</b><span><Camera size={16}/>镜头</span></div><strong>作品 → 卷/篇章 → 集 → 场景 → 镜头</strong><p>故事线是跨集标签关系，不影响卷与剧集排序。</p></section>
        <footer>{status&&<span role="status">{status}</span>}<button type="button" onClick={()=>{setTitle(project.title);setLogline(project.logline);setVisualStyle(project.visual_style);setAspectRatio(project.aspect_ratio);setLanguage(project.language);}}>放弃更改</button><button className="primary-action" type="submit" aria-label="保存设置" disabled={!title.trim()||busy}>{busy?'正在保存':'保存设置'}</button></footer>
      </form>

      <ProjectImportExport projectId={project.id} />
    </section>
    <aside className="project-settings-summary"><h2>当前作品</h2><div className="project-settings-cover"><Clapperboard size={26}/></div><strong>{project.title}</strong><small>项目 ID · {project.id}</small><section><span><b>{volumes.length}</b> 卷</span><span><b>{project.episodes.length}</b> 集</span><span><b>{sceneCount}</b> 场景</span><span><b>{shotCount}</b> 镜头</span></section><dl><div><dt>画面比例</dt><dd>{project.aspect_ratio}</dd></div><div><dt>作品语言</dt><dd>{project.language}</dd></div><div><dt>角色数量</dt><dd>{project.characters.length}</dd></div></dl></aside>
  </main>;
}
