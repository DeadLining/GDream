'use client';

import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {ArrowRight,Download,Plus,RotateCcw} from 'lucide-react';
import {createEpisodeVersion,listEpisodeVersions,restoreEpisodeVersion} from '../lib/api';
import {diffEpisodeSnapshots} from '../lib/episode-version-diff';
import type {EpisodeDetail,EpisodeVersion} from '../lib/types';

const spreadsheetSafe=(value:unknown)=>{const text=String(value??'');return /^[=+\-@]/.test(text)?`'${text}`:text;};
const csvCell=(value:unknown)=>`"${spreadsheetSafe(value).replaceAll('"','""')}"`;
export const serializeEpisodeVersionsCsv=(versions:EpisodeVersion[])=>[
  ['版本','标签','来源','恢复来源','创建时间'].map(csvCell).join(','),
  ...versions.map(version=>[`V${version.version}`,version.label,version.source,version.restored_from_id??'',version.created_at].map(csvCell).join(',')),
].join('\n');
const downloadVersions=(episodeId:string,versions:EpisodeVersion[])=>{const anchor=document.createElement('a');anchor.href=`data:text/csv;charset=utf-8,${encodeURIComponent('\uFEFF'+serializeEpisodeVersionsCsv(versions))}`;anchor.download=`episode-${episodeId}-versions.csv`;anchor.click();};
const scopeLabels={episode:'单集',scene:'场景',shot:'镜头',dialogue:'对白'} as const;
const changeLabels={added:'新增',removed:'删除',changed:'修改',moved:'移动'} as const;
const formatValue=(value:unknown)=>{if(value===null||value===undefined)return'无';if(typeof value==='string')return value||'空';if(typeof value==='object')return JSON.stringify(value);return String(value);};

export function VersionHistory({episode,onRestored}:{episode:EpisodeDetail|null;onRestored?:()=>Promise<void>|void}){
  const [versions,setVersions]=useState<EpisodeVersion[]>([]);
  const [selectedId,setSelectedId]=useState('');
  const [compareId,setCompareId]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');
  const [restoring,setRestoring]=useState(false);
  const [createOpen,setCreateOpen]=useState(false);
  const [creating,setCreating]=useState(false);
  useEffect(()=>{
    if(!episode?.id){setVersions([]);setSelectedId('');setCompareId('');setLoading(false);return;}
    let active=true;setVersions([]);setSelectedId('');setCompareId('');setSuccess('');setError('');setLoading(true);
    listEpisodeVersions(episode.id).then(items=>{if(active){setVersions(items);setSelectedId(items[0]?.id??'');setCompareId(items[1]?.id??items[0]?.id??'');}}).catch(cause=>active&&setError(cause instanceof Error?cause.message:'版本加载失败')).finally(()=>active&&setLoading(false));
    return()=>{active=false;};
  },[episode?.id]);
  const selected=versions.find(version=>version.id===selectedId)??versions[0]??null;
  const baseline=versions.find(version=>version.id===compareId)??versions[1]??selected;
  const diff=useMemo(()=>baseline&&selected?diffEpisodeSnapshots(baseline.snapshot,selected.snapshot):null,[baseline,selected]);
  const createSnapshot=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();if(!episode||creating)return;
    const form=new FormData(event.currentTarget);setCreating(true);setError('');setSuccess('');
    try{const created=await createEpisodeVersion(episode.id,{label:String(form.get('label')).trim(),source:'manual'});setVersions(items=>[created,...items.filter(item=>item.id!==created.id)]);setCompareId(selected?.id??created.id);setSelectedId(created.id);setCreateOpen(false);setSuccess(`已保存 V${created.version}“${created.label}”。`);}
    catch(cause){setError(cause instanceof Error?cause.message:'版本保存失败');}
    finally{setCreating(false);}
  };
  const restoreSnapshot=async()=>{if(!selected||!window.confirm(`恢复 V${selected.version}“${selected.label}”？当前状态会先自动备份。`))return;setRestoring(true);setError('');setSuccess('');try{const created=await restoreEpisodeVersion(selected.id);const refreshed=episode?await listEpisodeVersions(episode.id):[];const nextVersions=refreshed.some(item=>item.id===created.id)?refreshed:[created,...refreshed];setVersions(nextVersions);setCompareId(selected.id);setSelectedId(created.id);try{await onRestored?.();}catch{setError('快照已恢复，但工作区刷新失败，请手动刷新项目。');}setSuccess(`已恢复 V${selected.version}，恢复前状态已自动备份。`);}catch(cause){setError(cause instanceof Error?cause.message:'快照恢复失败');}finally{setRestoring(false);}};

  return <main className="operations-page version-history-page">
    <header className="operations-page-header"><div><h1>版本历史</h1><p>{episode?.title??'当前单集'} · 比较不可变快照并恢复业务状态</p></div><button className="command-button" aria-label="保存当前版本" disabled={!episode} onClick={()=>setCreateOpen(true)}><Plus size={16}/>保存当前版本</button></header>
    {error&&<p className="warning-box" role="alert">{error}</p>}
    {success&&<p className="success-box" role="status">{success}</p>}
    <div className="version-layout">
      <aside className="version-timeline"><h2>历史快照</h2>{loading?<p>正在加载版本…</p>:versions.length===0?<p>暂无版本记录。</p>:versions.map(version=><button key={version.id} className={version.id===selected?.id?'active':''} onClick={()=>setSelectedId(version.id)}><strong>V{version.version} {version.label}</strong><small>{version.created_at?new Date(version.created_at).toLocaleString('zh-CN'):'时间未记录'}</small></button>)}</aside>
      <section className="version-compare version-structured-diff">
        <div className="version-compare-controls">
          <label><span>对比基线</span><select aria-label="对比基线" value={baseline?.id??''} disabled={!versions.length} onChange={event=>setCompareId(event.target.value)}>{versions.map(version=><option key={version.id} value={version.id}>V{version.version} {version.label}</option>)}</select></label>
          <ArrowRight size={18}/>
          <label><span>目标版本</span><select aria-label="目标版本" value={selected?.id??''} disabled={!versions.length} onChange={event=>setSelectedId(event.target.value)}>{versions.map(version=><option key={version.id} value={version.id}>V{version.version} {version.label}</option>)}</select></label>
        </div>
        <div className="version-diff-heading">
          <span className="eyebrow">结构化差异</span>
          <h2>{baseline&&selected?`V${baseline.version} ${baseline.label} → V${selected.version} ${selected.label}`:'请选择两个版本'}</h2>
          <p className="diff-summary"><strong>{diff?.summary.total??0} 项变化</strong><span>新增 {diff?.summary.added??0}</span><b>删除 {diff?.summary.removed??0}</b><em>修改 {diff?.summary.changed??0}</em><i>移动 {diff?.summary.moved??0}</i></p>
        </div>
        {!diff?.changes.length?<p className="version-diff-empty">两个快照的业务数据一致。</p>:<div className="version-diff-list">{diff.changes.map(change=><article key={`${change.scope}-${change.id}`} className={`version-diff-item diff-${change.change_type}`}>
          <header><span>{changeLabels[change.change_type]}</span><strong>{scopeLabels[change.scope]} · {change.label}</strong><small>{change.id}</small></header>
          {change.fields.length?<dl>{change.fields.map(field=><div key={field.key}><dt>{field.label}</dt><dd><span title={formatValue(field.before)}>{formatValue(field.before)}</span><ArrowRight size={13}/><strong title={formatValue(field.after)}>{formatValue(field.after)}</strong></dd></div>)}</dl>:<p>{change.change_type==='added'?'目标版本新增了这项内容。':'目标版本中已删除这项内容。'}</p>}
        </article>)}</div>}
      </section>
      <aside className="operations-inspector">
        <h2>目标快照</h2>
        {selected?<><h3>V{selected.version} {selected.label}</h3><dl className="snapshot-details"><div><dt>来源</dt><dd>{selected.source}</dd></div><div><dt>恢复来源</dt><dd>{selected.restored_from_id??'无'}</dd></div></dl><p className="warning-box">恢复会应用单集、场景、镜头和对白快照；当前状态会先自动保存为检查点。</p></>:<p>请选择一个目标快照。</p>}
      </aside>
    </div>
    <footer className="operations-sticky-footer">
      <p>差异来自两个服务端不可变快照；恢复始终作用于目标版本。</p>
      <button aria-label="导出版本记录" disabled={!episode||!versions.length} onClick={()=>episode&&downloadVersions(episode.id,versions)}><Download size={16}/>导出版本记录</button>
      <button className="command-button" aria-label="恢复所选快照" disabled={!selected||restoring} onClick={restoreSnapshot}><RotateCcw size={16}/>{restoring?'恢复中…':'恢复所选快照'}</button>
    </footer>
    {createOpen&&<div className="dialog-backdrop"><form className="form-dialog" role="dialog" aria-label="保存当前版本" onSubmit={createSnapshot}><header><h2>保存当前版本</h2><button type="button" aria-label="关闭" onClick={()=>setCreateOpen(false)}>×</button></header><label>版本标签<input aria-label="版本标签" name="label" placeholder="例如：导演确认版" required autoFocus/></label><p>将保存当前单集、场景、镜头和对白的不可变快照。</p><footer><button type="button" onClick={()=>setCreateOpen(false)}>取消</button><button className="primary-action" aria-label="保存版本" disabled={creating}>{creating?'保存中…':'保存版本'}</button></footer></form></div>}
  </main>;
}
