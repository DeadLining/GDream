'use client';
import {useEffect,useMemo,useState,type KeyboardEvent as ReactKeyboardEvent} from 'react';
import {GitBranch,MessageSquare,Search,X} from 'lucide-react';
import {searchProject} from '../lib/api';
import type {EpisodeDetail,ProjectDetail,ProjectSearchResult} from '../lib/types';

type Scope='all'|'script'|'assets'|'structure'|'shot'|'review'|'task';
const scopes:Array<[Scope,string]>=[['all','全部'],['script','剧本'],['assets','角色与资产'],['structure','集与场景'],['shot','镜头'],['review','评论'],['task','任务']];
const kindScope:Record<ProjectSearchResult['kind'],Scope>={script:'script',character:'assets',asset_variant:'assets',asset_state:'assets',library_asset:'assets',episode:'structure',scene:'structure',shot:'shot',review:'review',task:'task'};
const openLabels:Record<ProjectSearchResult['kind'],string>={script:'打开剧本',character:'打开资产库',asset_variant:'打开资产库',asset_state:'打开资产库',library_asset:'打开资产库',episode:'打开剧集',scene:'打开场景',shot:'定位到镜头',review:'打开评论',task:'打开任务'};
const resultKey=(item:ProjectSearchResult)=>`${item.kind}:${item.id}`;

export function GlobalSearchOverlay({project,onClose,onOpenResult}:{project:ProjectDetail|null;episode:EpisodeDetail|null;onClose:()=>void;onOpenResult:(item:ProjectSearchResult)=>void}){
  const [query,setQuery]=useState('');
  const [scope,setScope]=useState<Scope>('all');
  const [results,setResults]=useState<ProjectSearchResult[]>([]);
  const [selectedKey,setSelectedKey]=useState('');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{
    const normalized=query.trim();
    if(!project?.id||!normalized){setResults([]);setSelectedKey('');setLoading(false);setError('');return;}
    let active=true;setLoading(true);setError('');
    const timer=window.setTimeout(()=>{searchProject(project.id,normalized).then(response=>{if(active){setResults(response.results);setSelectedKey(response.results[0]?resultKey(response.results[0]):'');}}).catch(cause=>active&&setError(cause instanceof Error?cause.message:'搜索失败')).finally(()=>active&&setLoading(false));},150);
    return()=>{active=false;window.clearTimeout(timer);};
  },[project?.id,query]);
  useEffect(()=>{
    const handleEscape=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();};
    window.addEventListener('keydown',handleEscape);
    return()=>window.removeEventListener('keydown',handleEscape);
  },[onClose]);
  const filtered=useMemo(()=>scope==='all'?results:results.filter(item=>kindScope[item.kind]===scope),[results,scope]);
  const selected=filtered.find(item=>resultKey(item)===selectedKey)??filtered[0]??null;
  const groups=[{title:'角色与资产',icon:<GitBranch size={15}/>,items:filtered.filter(item=>kindScope[item.kind]==='assets')},{title:'剧本、集与场景',items:filtered.filter(item=>['script','structure'].includes(kindScope[item.kind]))},{title:'镜头与画面',items:filtered.filter(item=>item.kind==='shot')},{title:'评论与任务',icon:<MessageSquare size={15}/>,items:filtered.filter(item=>['review','task'].includes(kindScope[item.kind]))}];
  const handleSearchKeyDown=(event:ReactKeyboardEvent<HTMLInputElement>)=>{
    if(!filtered.length)return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();
      const current=selected?filtered.findIndex(item=>resultKey(item)===resultKey(selected)):0;
      const offset=event.key==='ArrowDown'?1:-1;
      setSelectedKey(resultKey(filtered[(Math.max(0,current)+offset+filtered.length)%filtered.length]));
    }else if(event.key==='Enter'&&selected){
      event.preventDefault();
      onOpenResult(selected);
    }
  };
  return <div className="search-backdrop" role="presentation"><section className="global-search-dialog" role="dialog" aria-modal="true" aria-label="全局搜索">
    <header><label><Search size={18}/><input autoFocus value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={handleSearchKeyDown} placeholder="搜索剧本、角色、资产、场景、镜头、评论或任务" aria-label="搜索作品内容"/></label><button className="icon-button" aria-label="关闭全局搜索" onClick={onClose}><X size={18}/></button></header>
    <div className="search-scopes">{scopes.map(([value,label])=><button key={value} className={scope===value?'active':''} onClick={()=>setScope(value)}>{label}</button>)}</div>
    <div className="global-search-body"><div className="search-results">{loading?<p>正在搜索…</p>:error?<p className="warning-box" role="alert">{error}</p>:!query.trim()?<p>输入关键词开始搜索当前作品。</p>:filtered.length===0?<p>没有找到匹配内容。</p>:groups.filter(group=>group.items.length).map(group=><section key={group.title}><h2>{group.icon}{group.title}</h2>{group.items.map(item=><button className={`search-result ${selected&&resultKey(item)===resultKey(selected)?'selected':''}`} key={resultKey(item)} onClick={()=>setSelectedKey(resultKey(item))}><span className="result-thumb">{item.kind==='shot'?'镜':item.title.slice(0,1)}</span><span><strong>{item.title}</strong><small>{item.hierarchy.length?item.hierarchy.join(' → '):item.subtitle}</small></span><em>{item.reference_count?`${item.reference_count} 引用`:item.status}</em></button>)}</section>)}</div>
      <aside className="search-preview">{selected?<><h2>{selected.title}</h2><div className="asset-preview-placeholder">{selected.kind==='asset_state'?'资产状态':'搜索结果'}</div><h3>位置与关系</h3><p>{selected.hierarchy.length?selected.hierarchy.join(' / '):selected.subtitle}</p><h3>下游引用</h3><div className="reference-counts"><span><strong>{selected.reference_count}</strong>镜头引用</span></div><button className="command-button" onClick={()=>onOpenResult(selected)}>{openLabels[selected.kind]}</button></>:<><h2>搜索详情</h2><p>选择结果后查看层级、状态和引用。</p></>}</aside>
    </div>
  </section></div>;
}
