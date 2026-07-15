'use client';

import {useEffect,useState} from 'react';
import {Download,RotateCcw} from 'lucide-react';
import {listEpisodeVersions,restoreEpisodeVersion} from '../lib/api';
import type {EpisodeDetail,EpisodeVersion} from '../lib/types';

const csvCell=(value:unknown)=>`"${String(value??'').replaceAll('"','""')}"`;
export const serializeEpisodeVersionsCsv=(versions:EpisodeVersion[])=>[
  ['版本','标签','来源','作者','恢复来源','创建时间'].map(csvCell).join(','),
  ...versions.map(version=>[`V${version.version}`,version.label,version.source,version.author,version.restored_from_id??'',version.created_at].map(csvCell).join(',')),
].join('\n');
const downloadVersions=(episodeId:string,versions:EpisodeVersion[])=>{const anchor=document.createElement('a');anchor.href=`data:text/csv;charset=utf-8,${encodeURIComponent('\uFEFF'+serializeEpisodeVersionsCsv(versions))}`;anchor.download=`episode-${episodeId}-versions.csv`;anchor.click();};

export function VersionHistory({episode,onRestored}:{episode:EpisodeDetail|null;onRestored?:()=>Promise<void>|void}){
  const [versions,setVersions]=useState<EpisodeVersion[]>([]);
  const [selectedId,setSelectedId]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');
  const [restoring,setRestoring]=useState(false);
  useEffect(()=>{
    if(!episode?.id){setVersions([]);setLoading(false);return;}
    let active=true;setLoading(true);setError('');
    listEpisodeVersions(episode.id).then(items=>{if(active){setVersions(items);setSelectedId(items[0]?.id??'');}}).catch(cause=>active&&setError(cause instanceof Error?cause.message:'版本加载失败')).finally(()=>active&&setLoading(false));
    return()=>{active=false;};
  },[episode?.id]);
  const selected=versions.find(version=>version.id===selectedId)??versions[0]??null;
  const snapshotEpisode=selected?.snapshot?.episode;
  const snapshotScenes=Array.isArray(selected?.snapshot?.scenes)?selected.snapshot.scenes:[];
  const snapshotShotCount=snapshotScenes.reduce((sum,scene)=>sum+(typeof scene==='object'&&scene&&Array.isArray((scene as {shots?:unknown[]}).shots)?(scene as {shots:unknown[]}).shots.length:0),0);
  const restoreSnapshot=async()=>{if(!selected||!window.confirm(`恢复 V${selected.version}“${selected.label}”？当前状态会先自动备份。`))return;setRestoring(true);setError('');setSuccess('');try{const created=await restoreEpisodeVersion(selected.id);const refreshed=episode?await listEpisodeVersions(episode.id):[];setVersions(refreshed.some(item=>item.id===created.id)?refreshed:[created,...refreshed]);setSelectedId(created.id);try{await onRestored?.();}catch{setError('快照已恢复，但工作区刷新失败，请手动刷新项目。');}setSuccess(`已恢复 V${selected.version}，恢复前状态已自动备份。`);}catch(cause){setError(cause instanceof Error?cause.message:'快照恢复失败');}finally{setRestoring(false);}};

  return <main className="operations-page version-history-page">
    <header className="operations-page-header"><div><h1>版本历史</h1><p>{episode?.title??'当前单集'} · 这里保存的是不可变快照记录</p></div></header>
    {error&&<p className="warning-box" role="alert">{error}</p>}
    {success&&<p className="success-box" role="status">{success}</p>}
    <div className="version-layout">
      <aside className="version-timeline"><h2>历史快照</h2>{loading?<p>正在加载版本…</p>:versions.length===0?<p>暂无版本记录。</p>:versions.map(version=><button key={version.id} className={version.id===selected?.id?'active':''} onClick={()=>setSelectedId(version.id)}><strong>V{version.version} {version.label}</strong><small>{version.author} · {version.created_at?new Date(version.created_at).toLocaleString('zh-CN'):'时间未记录'}</small></button>)}</aside>
      <section className="version-compare version-snapshot-summary">
        <span className="eyebrow">快照内容</span>
        <h2>{selected?`V${selected.version} ${selected.label}`:'请选择版本'}</h2>
        <p className="diff-summary">当前仅保存完整快照，尚未生成结构化版本差异。</p>
        {selected&&<div className="snapshot-metrics"><div><small>单集标题</small><strong>{typeof snapshotEpisode==='object'&&snapshotEpisode&&'title' in snapshotEpisode?String(snapshotEpisode.title):episode?.title??'未记录'}</strong></div><div><small>场景数量</small><strong>{snapshotScenes.length}</strong></div><div><small>镜头数量</small><strong>{snapshotShotCount}</strong></div><div><small>记录来源</small><strong>{selected.source}</strong></div></div>}
        <p className="warning-box">此页面不会声称已比较两个版本。结构化差异功能接入前，只展示服务端实际保存的快照摘要。</p>
      </section>
      <aside className="operations-inspector">
        <h2>快照信息</h2>
        {selected?<><h3>V{selected.version} {selected.label}</h3><dl className="snapshot-details"><div><dt>来源</dt><dd>{selected.source}</dd></div><div><dt>创建者</dt><dd>{selected.author}</dd></div><div><dt>恢复来源</dt><dd>{selected.restored_from_id??'无'}</dd></div></dl><p className="warning-box">恢复会应用单集、场景、镜头和对白快照；当前状态会先自动保存为检查点。</p></>:<p>请选择一个历史快照。</p>}
      </aside>
    </div>
    <footer className="operations-sticky-footer">
      <p>恢复操作会先备份当前状态，再原子化应用所选快照。</p>
      <button aria-label="导出版本记录" disabled={!episode||!versions.length} onClick={()=>episode&&downloadVersions(episode.id,versions)}><Download size={16}/>导出版本记录</button>
      <button className="command-button" aria-label="恢复所选快照" disabled={!selected||restoring} onClick={restoreSnapshot}><RotateCcw size={16}/>{restoring?'恢复中…':'恢复所选快照'}</button>
    </footer>
  </main>;
}
