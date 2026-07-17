'use client';

import {useEffect, useState} from 'react';
import {BookOpen, Boxes, Camera, Clapperboard, FileText, Settings2} from 'lucide-react';
import type {ProjectDetail, ProjectImportResponse, ProjectPatch, Volume} from '../lib/types';
import {ProjectImportExport} from './ProjectImportExport';

type SettingsDraft = {
  title: string;
  logline: string;
  visual_style: string;
  aspect_ratio: ProjectDetail['aspect_ratio'];
  language: string;
};

const draftFromProject = (project: ProjectDetail): SettingsDraft => ({
  title: project.title,
  logline: project.logline,
  visual_style: project.visual_style,
  aspect_ratio: project.aspect_ratio,
  language: project.language,
});

const sections = [
  {id: 'project-basic', label: '基本信息', Icon: Settings2},
  {id: 'project-structure', label: '结构规则', Icon: BookOpen},
  {id: 'project-generation', label: '生成规范', Icon: Boxes},
  {id: 'project-files', label: '文件与存储', Icon: FileText},
] as const;

export function ProjectSettings({
  project,
  volumes,
  sceneCount,
  shotCount,
  onSave,
  onDirtyChange,
  onImported,
}: {
  project: ProjectDetail;
  volumes: Volume[];
  sceneCount: number;
  shotCount: number;
  onSave: (data: ProjectPatch) => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
  onImported?: (result: ProjectImportResponse) => void;
}) {
  const [baseline, setBaseline] = useState<SettingsDraft>(() => draftFromProject(project));
  const [draft, setDraft] = useState<SettingsDraft>(() => draftFromProject(project));
  const [activeSection, setActiveSection] = useState<(typeof sections)[number]['id']>('project-basic');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);

  useEffect(() => {
    const next = draftFromProject(project);
    setBaseline(next);
    setDraft(next);
    setStatus('');
  }, [project.id]);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  const updateDraft = (patch: Partial<SettingsDraft>) => {
    setDraft(current => ({...current, ...patch}));
    setStatus('');
  };
  const save = async () => {
    if (!draft.title.trim() || !dirty || busy) return;
    const normalized: SettingsDraft = {
      ...draft,
      title: draft.title.trim(),
      logline: draft.logline.trim(),
      visual_style: draft.visual_style.trim(),
    };
    setBusy(true);
    setStatus('');
    try {
      await onSave(normalized);
      setBaseline(normalized);
      setDraft(normalized);
      setStatus('设置已保存');
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };
  const abandon = () => {
    setDraft(baseline);
    setStatus('');
  };

  return <main className="project-settings-page">
    <aside className="project-settings-nav">
      <h1>作品设置</h1>
      {sections.map(({id, label, Icon}) => <a key={id} href={`#${id}`} className={activeSection === id ? 'active' : ''} aria-current={activeSection === id ? 'location' : undefined} onClick={() => setActiveSection(id)}><Icon aria-hidden="true" size={15}/>{label}</a>)}
    </aside>
    <section className="project-settings-content">
      <header><div><span>作品设置</span><h1>作品基本信息</h1><p>统一作品元数据、输出比例和稳定结构规则。</p></div></header>
      <form onSubmit={event => {event.preventDefault(); void save();}}>
        <section id="project-basic" className="project-settings-form-section"><h2>基础资料</h2><label>作品名称<input aria-label="作品名称" value={draft.title} onChange={event => updateDraft({title: event.target.value})}/></label><label>一句话梗概<textarea aria-label="一句话梗概" value={draft.logline} onChange={event => updateDraft({logline: event.target.value})}/></label></section>
        <section id="project-generation" className="project-settings-form-section"><h2>生成规范</h2><div><label>视觉风格<input aria-label="视觉风格" value={draft.visual_style} onChange={event => updateDraft({visual_style: event.target.value})}/></label><label>作品语言<select aria-label="作品语言" value={draft.language} onChange={event => updateDraft({language: event.target.value})}><option value="Chinese">简体中文</option><option value="English">English</option><option value="Japanese">日本語</option></select></label></div><fieldset><legend>画面比例</legend>{(['16:9', '9:16', '1:1'] as const).map(value => <label key={value}><input type="radio" name="aspect" value={value} checked={draft.aspect_ratio === value} onChange={() => updateDraft({aspect_ratio: value})}/><span>{value}</span></label>)}</fieldset></section>
        <section id="project-structure" className="project-structure-rules"><h2>作品结构规则</h2><div className="project-hierarchy"><span><BookOpen aria-hidden="true" size={16}/>作品</span><b>→</b><span><FileText aria-hidden="true" size={16}/>卷/篇章</span><b>→</b><span><Clapperboard aria-hidden="true" size={16}/>集</span><b>→</b><span><Boxes aria-hidden="true" size={16}/>场景</span><b>→</b><span><Camera aria-hidden="true" size={16}/>镜头</span></div><strong>作品 → 卷/篇章 → 集 → 场景 → 镜头</strong><p>故事线是跨集标签关系，不影响卷与剧集排序。</p></section>
        <footer>{status && <span role="status">{status}</span>}<button type="button" onClick={abandon} disabled={!dirty || busy}>放弃更改</button><button className="primary-action" type="submit" aria-label="保存设置" disabled={!dirty || !draft.title.trim() || busy}>{busy ? '正在保存' : '保存设置'}</button></footer>
      </form>
      <div id="project-files"><ProjectImportExport projectId={project.id} disabled={dirty} onImported={onImported}/></div>
    </section>
    <aside className="project-settings-summary"><h2>当前作品</h2><div className="project-settings-cover"><Clapperboard aria-hidden="true" size={26}/></div><strong>{project.title}</strong><small>项目 ID · {project.id}</small><section><span><b>{volumes.length}</b> 卷</span><span><b>{project.episodes.length}</b> 集</span><span><b>{sceneCount}</b> 场景</span><span><b>{shotCount}</b> 镜头</span></section><dl><div><dt>画面比例</dt><dd>{project.aspect_ratio}</dd></div><div><dt>作品语言</dt><dd>{project.language}</dd></div><div><dt>角色数量</dt><dd>{project.characters.length}</dd></div></dl></aside>
  </main>;
}
