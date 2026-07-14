'use client';

import {useEffect,useState} from 'react';
import {Download,Plus} from 'lucide-react';
import {listEpisodeVersions,restoreEpisodeVersion} from '../lib/api';
import type {EpisodeDetail,EpisodeVersion} from '../lib/types';

const csvCell=(value:unknown)=>`"${String(value??'').replaceAll('"','""')}"`;
export const serializeEpisodeVersionsCsv=(versions:EpisodeVersion[])=>[
  ['版本','标签','来源','作者','恢复来源','创建时间'].map(csvCell).join(','),
  ...versions.map(version=>[`V${version.version}`,version.label,version.source,version.author,version.restored_from_id??'',version.created_at].map(csvCell).join(',')),
].join('\n');
const downloadVersions=(episodeId:string,versions:EpisodeVersion[])=>{const anchor=document.createElement('a');anchor.href=`data:text/csv;charset=utf-8,${encodeURIComponent('\uFEFF'+serializeEpisodeVersionsCsv(versions))}`;anchor.download=`episode-${episodeId}-versions.csv`;anchor.click();};

export function VersionHistory({episode}:{episode:EpisodeDetail|null}){
  const [versions,setVersions]=useState<EpisodeVersion[]>([]);
  const [selectedId,setSelectedId]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
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
  const createFromSnapshot=async()=>{if(!selected)return;setRestoring(true);setError('');try{const created=await restoreEpisodeVersion(selected.id);setVersions(items=>[created,...items]);setSelectedId(created.id);}catch(cause){setError(cause instanceof Error?cause.message:'快照版本创建失败');}finally{setRestoring(false);}};

  return <main className="operations-page version-history-page">
    <header className="operations-page-header"><div><h1>版本历史</h1><p>{episode?.title??'当前单集'} · 这里保存的是不可变快照记录</p></div></header>
    {error&&<p className="warning-box" role="alert">{error}</p>}
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
        {selected?<><h3>V{selected.version} {selected.label}</h3><dl className="snapshot-details"><div><dt>来源</dt><dd>{selected.source}</dd></div><div><dt>创建者</dt><dd>{selected.author}</dd></div><div><dt>恢复来源</dt><dd>{selected.restored_from_id??'无'}</dd></div></dl><p className="warning-box">“基于所选快照创建版本”只会复制快照记录，不会改写当前单集、场景或镜头。</p></>:<p>请选择一个历史快照。</p>}
      </aside>
    </div>
    <footer className="operations-sticky-footer">
      <p>当前后端尚未实现把快照内容应用回业务数据。</p>
      <button aria-label="导出版本记录" disabled={!episode||!versions.length} onClick={()=>episode&&downloadVersions(episode.id,versions)}><Download size={16}/>导出版本记录</button>
      <button className="command-button" aria-label="基于所选快照创建版本" disabled={!selected||restoring} onClick={createFromSnapshot}><Plus size={16}/>{restoring?'创建中…':'基于所选快照创建版本'}</button>
    </footer>
  </main>;
}
