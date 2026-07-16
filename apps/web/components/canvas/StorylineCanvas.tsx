'use client';

import {useMemo, useState} from 'react';
import {AlertTriangle, Focus, GitMerge, Maximize2, Pencil, Plus, Search, Trash2, X, ZoomIn, ZoomOut} from 'lucide-react';
import type {EpisodeSummary, Storyline, StorylineEvent, Volume} from '../../lib/types';

const stageLabel:Record<StorylineEvent['stage'],string>={setup:'铺垫',development:'发展',escalation:'升级',payoff:'回收',resolved:'已解决'};

type StorylineDraft={title:string;kind:Storyline['kind'];color:string;description:string};
type EventDraft=Pick<StorylineEvent,'episode_id'|'scene_id'|'shot_id'|'position'|'stage'|'title'|'description'|'setup_event_id'|'payoff_event_id'|'metadata'>;
type Editor='storyline-create'|'storyline-edit'|'event-create'|'event-edit'|null;

type Props={
  scriptTitle:string;
  volumes:Volume[];
  unassignedEpisodes?:EpisodeSummary[];
  storylines:Storyline[];
  initialStorylineId?:string;
  onCreateStoryline?:(data:StorylineDraft)=>Promise<void>|void;
  onUpdateStoryline?:(id:string,data:StorylineDraft)=>Promise<void>|void;
  onDeleteStoryline?:(id:string)=>Promise<void>|void;
  onCreateEvent?:(storylineId:string,data:EventDraft)=>Promise<void>|void;
  onUpdateEvent?:(id:string,data:EventDraft)=>Promise<void>|void;
  onDeleteEvent?:(id:string)=>Promise<void>|void;
};

const emptyLineDraft:StorylineDraft={title:'',kind:'foreshadowing',color:'#B9473E',description:''};
const episodeNumber=(position:number|undefined)=>String(Math.max(1,position??1)).padStart(2,'0');

export function StorylineCanvas({scriptTitle,volumes,unassignedEpisodes=[],storylines,initialStorylineId,onCreateStoryline,onUpdateStoryline,onDeleteStoryline,onCreateEvent,onUpdateEvent,onDeleteEvent}:Props){
  const displayVolumes=useMemo<Volume[]>(()=>unassignedEpisodes.length?[...volumes,{id:'__unassigned__',project_id:unassignedEpisodes[0].project_id,position:0,title:'未分卷',summary:'',created_at:'',updated_at:'',episodes:unassignedEpisodes}]:volumes,[unassignedEpisodes,volumes]);
  const allEvents=useMemo(()=>storylines.flatMap(line=>line.events.map(event=>({event,line}))).sort((a,b)=>a.event.position-b.event.position),[storylines]);
  const episodes=displayVolumes.flatMap(volume=>volume.episodes);
  const [selectedId,setSelectedId]=useState(allEvents[0]?.event.id??'');
  const [lineId,setLineId]=useState(storylines.some(line=>line.id===initialStorylineId)?initialStorylineId!:storylines[0]?.id??'all');
  const [editor,setEditor]=useState<Editor>(null);
  const [editingLineId,setEditingLineId]=useState<string|null>(null);
  const [editingEventId,setEditingEventId]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [formError,setFormError]=useState('');
  const [query,setQuery]=useState('');
  const [zoom,setZoom]=useState(100);
  const [lineDraft,setLineDraft]=useState<StorylineDraft>(emptyLineDraft);
  const [eventDraft,setEventDraft]=useState<EventDraft>({episode_id:episodes[0]?.id??'',scene_id:null,shot_id:null,position:Math.max(0,...allEvents.map(item=>item.event.position))+1,stage:'setup',title:'',description:'',setup_event_id:null,payoff_event_id:null,metadata:{}});
  const visibleLines=lineId==='all'?storylines:storylines.filter(line=>line.id===lineId);
  const normalizedQuery=query.trim().toLocaleLowerCase();
  const matchesQuery=(event:StorylineEvent,line:Storyline)=>!normalizedQuery||[event.title,event.description,line.title,...Object.values(event.metadata).flatMap(value=>Array.isArray(value)?value:[value])].join(' ').toLocaleLowerCase().includes(normalizedQuery);
  const filteredEvents=visibleLines.flatMap(line=>line.events.filter(event=>matchesQuery(event,line)).map(event=>({event,line}))).sort((a,b)=>a.event.position-b.event.position);
  const selectionPool=lineId==='all'&&!normalizedQuery?allEvents:filteredEvents;
  const selected=selectionPool.find(item=>item.event.id===selectedId)??selectionPool[0]??null;
  const activeLine=storylines.find(line=>line.id===lineId)??selected?.line??storylines[0]??null;
  const visibleEventCount=filteredEvents.length;
  const eventById=new Map(allEvents.map(item=>[item.event.id,item.event]));
  const episodeMap=new Map(displayVolumes.flatMap(volume=>volume.episodes.map(episode=>[episode.id,{episode,volume}] as const)));

  const closeEditor=()=>{setEditor(null);setEditingLineId(null);setEditingEventId(null);setFormError('');};
  const openCreateStoryline=()=>{setLineDraft(emptyLineDraft);setEditingLineId(null);setFormError('');setEditor('storyline-create');};
  const openEditStoryline=()=>{if(!activeLine)return;setLineDraft({title:activeLine.title,kind:activeLine.kind,color:activeLine.color,description:activeLine.description});setEditingLineId(activeLine.id);setFormError('');setEditor('storyline-edit');};
  const openCreateEvent=()=>{setEventDraft({episode_id:episodes[0]?.id??'',scene_id:null,shot_id:null,position:Math.max(0,...allEvents.map(item=>item.event.position))+1,stage:'setup',title:'',description:'',setup_event_id:null,payoff_event_id:null,metadata:{}});setEditingEventId(null);setFormError('');setEditor('event-create');};
  const openEditEvent=()=>{if(!selected)return;const {episode_id,scene_id,shot_id,position,stage,title,description,setup_event_id,payoff_event_id,metadata}=selected.event;setEventDraft({episode_id,scene_id,shot_id,position,stage,title,description,setup_event_id,payoff_event_id,metadata});setEditingEventId(selected.event.id);setFormError('');setEditor('event-edit');};

  const saveStoryline=async()=>{
    const title=lineDraft.title.trim();
    if(!title||busy)return;
    setBusy(true);setFormError('');
    try{
      const data={...lineDraft,title,description:lineDraft.description.trim()};
      if(editingLineId){if(!onUpdateStoryline)return;await onUpdateStoryline(editingLineId,data);}else{if(!onCreateStoryline)return;await onCreateStoryline(data);}
      closeEditor();
    }catch(cause){setFormError(cause instanceof Error?cause.message:'保存故事线失败');}finally{setBusy(false);}
  };
  const saveEvent=async()=>{
    const title=eventDraft.title.trim();
    if(!activeLine||!eventDraft.episode_id||!title||busy)return;
    setBusy(true);setFormError('');
    try{
      const data={...eventDraft,title,description:eventDraft.description.trim()};
      if(editingEventId){if(!onUpdateEvent)return;await onUpdateEvent(editingEventId,data);}else{if(!onCreateEvent)return;await onCreateEvent(activeLine.id,data);}
      closeEditor();
    }catch(cause){setFormError(cause instanceof Error?cause.message:'保存事件失败');}finally{setBusy(false);}
  };
  const removeEvent=async()=>{
    if(!selected||!onDeleteEvent||busy||!window.confirm(`删除故事线事件“${selected.event.title}”？`))return;
    setBusy(true);setFormError('');
    try{await onDeleteEvent(selected.event.id);setSelectedId(allEvents.find(item=>item.event.id!==selected.event.id)?.event.id??'');}
    catch(cause){setFormError(cause instanceof Error?cause.message:'删除事件失败');}
    finally{setBusy(false);}
  };
  const removeStoryline=async()=>{
    if(!activeLine||!onDeleteStoryline||busy||!window.confirm(`删除故事线“${activeLine.title}”及其 ${activeLine.events.length} 个事件？`))return;
    setBusy(true);setFormError('');
    try{await onDeleteStoryline(activeLine.id);setLineId('all');setSelectedId('');closeEditor();}
    catch(cause){setFormError(cause instanceof Error?cause.message:'删除故事线失败');}
    finally{setBusy(false);}
  };
  const focusUnresolved=()=>{const target=allEvents.find(item=>item.event.stage!=='resolved');if(target){setSelectedId(target.event.id);setLineId(target.line.id);setEditor(null);}};
  const eventButton=(event:StorylineEvent,line:Storyline)=>{
    const context=episodeMap.get(event.episode_id);
    return <button type="button" key={event.id} className={`story-event ${selected?.event.id===event.id?'selected':''}`} style={{borderLeftColor:line.color}} aria-label={event.title} onClick={()=>{setSelectedId(event.id);setEditor(null);}}><span>{stageLabel[event.stage]}</span><strong>{event.title}</strong><small>{context?`第 ${episodeNumber(context.episode.position)} 集 · ${line.title}`:line.title}</small></button>;
  };

  const storylineForm=editor?.startsWith('storyline')?<form className="narrative-editor" onSubmit={event=>{event.preventDefault();void saveStoryline();}}><header><span>标签关系</span><h2>{editingLineId?'编辑故事线':'新建故事线'}</h2><button type="button" aria-label="关闭故事线表单" onClick={closeEditor}><X size={14}/></button></header><label>标题<input aria-label="故事线标题" value={lineDraft.title} onChange={event=>setLineDraft(current=>({...current,title:event.target.value}))} autoFocus/></label><label>类型<select aria-label="故事线类型" value={lineDraft.kind} onChange={event=>setLineDraft(current=>({...current,kind:event.target.value as Storyline['kind']}))}><option value="foreshadowing">伏笔</option><option value="character_arc">角色成长</option><option value="conflict">冲突</option><option value="mystery">谜团</option><option value="theme">主题</option></select></label><label>颜色<input aria-label="故事线颜色" type="color" value={lineDraft.color} onChange={event=>setLineDraft(current=>({...current,color:event.target.value}))}/></label><label>说明<textarea aria-label="故事线说明" value={lineDraft.description} onChange={event=>setLineDraft(current=>({...current,description:event.target.value}))}/></label>{formError&&<p role="alert">{formError}</p>}<button className="primary-action" type="submit" disabled={!lineDraft.title.trim()||busy}>{busy?'正在保存':'保存故事线'}</button></form>:null;
  const eventForm=editor?.startsWith('event')?<form className="narrative-editor" onSubmit={event=>{event.preventDefault();void saveEvent();}}><header><span>{activeLine?.title}</span><h2>{editingEventId?'编辑跨集事件':'新建跨集事件'}</h2><button type="button" aria-label="关闭事件表单" onClick={closeEditor}><X size={14}/></button></header><label>关联剧集<select aria-label="关联剧集" value={eventDraft.episode_id} onChange={event=>setEventDraft(current=>({...current,episode_id:event.target.value}))}>{episodes.map(episode=><option value={episode.id} key={episode.id}>第 {episodeNumber(episode.position)} 集 · {episode.title}</option>)}</select></label><label>事件标题<input aria-label="事件标题" value={eventDraft.title} onChange={event=>setEventDraft(current=>({...current,title:event.target.value}))} autoFocus/></label><label>事件阶段<select aria-label="事件阶段" value={eventDraft.stage} onChange={event=>setEventDraft(current=>({...current,stage:event.target.value as StorylineEvent['stage']}))}>{Object.entries(stageLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>说明<textarea aria-label="事件说明输入" value={eventDraft.description} onChange={event=>setEventDraft(current=>({...current,description:event.target.value}))}/></label>{formError&&<p role="alert">{formError}</p>}<button className="primary-action" type="submit" disabled={!eventDraft.title.trim()||!eventDraft.episode_id||busy}>{busy?'正在保存':'保存事件'}</button></form>:null;

  return <section className="storyline-workspace">
    <header className="storyline-toolbar"><div className="storyline-search"><Search size={15}/><input aria-label="搜索故事线事件" placeholder="搜索事件、角色或伏笔" value={query} onChange={event=>setQuery(event.target.value)}/></div><div className="storyline-filter">{storylines.map(line=><button key={line.id} aria-pressed={lineId===line.id} onClick={()=>setLineId(line.id)}>{line.title}</button>)}<button aria-pressed={lineId==='all'} onClick={()=>setLineId('all')}>全部关系</button></div><div className="storyline-tools">{onCreateStoryline&&<button aria-label="新建故事线" onClick={openCreateStoryline}><Plus size={15}/></button>}{onUpdateStoryline&&activeLine&&<button aria-label={`编辑故事线 ${activeLine.title}`} onClick={openEditStoryline}><Pencil size={15}/></button>}{onDeleteStoryline&&activeLine&&<button aria-label={`删除故事线 ${activeLine.title}`} disabled={busy} onClick={()=>void removeStoryline()}><Trash2 size={15}/></button>}{onCreateEvent&&<button aria-label="新建事件" disabled={!activeLine||!episodes.length} onClick={openCreateEvent}><GitMerge size={15}/></button>}<button title="缩小" disabled={zoom<=60} onClick={()=>setZoom(current=>Math.max(60,current-10))}><ZoomOut size={15}/></button><span>{zoom}%</span><button title="放大" disabled={zoom>=140} onClick={()=>setZoom(current=>Math.min(140,current+10))}><ZoomIn size={15}/></button><button title="聚焦未解决节点" disabled={!allEvents.some(item=>item.event.stage!=='resolved')} onClick={focusUnresolved}><Focus size={15}/></button><button title="适应画布" onClick={()=>setZoom(100)}><Maximize2 size={15}/></button></div></header>
    <div className="storyline-body">
      <div className="storyline-canvas" data-line={lineId} style={{zoom:zoom/100}}>
        {!displayVolumes.length&&<div className="storyline-future"><GitMerge size={18}/><span>先创建剧集，再关联跨集故事线。</span></div>}
        {displayVolumes.map(volume=><div className="volume-lane" key={volume.id}><header><span>{volume.id==='__unassigned__'?'待编排':`第 ${String(volume.position).padStart(2,'0')} 卷`}</span><strong>{volume.title}</strong><small>{volume.episodes.length} 集</small></header>{volume.episodes.map(episode=><div className="episode-column" key={episode.id}><label>第 {episodeNumber(episode.position)} 集</label>{visibleLines.flatMap(line=>line.events.filter(event=>event.episode_id===episode.id&&matchesQuery(event,line)).map(event=>eventButton(event,line)))}</div>)}</div>)}
        {normalizedQuery&&visibleEventCount===0&&<div className="storyline-future"><Search size={18}/><span>没有匹配的故事线事件。</span></div>}
        <div className="storyline-legend">{storylines.map(line=><span key={line.id}><i style={{backgroundColor:line.color}}/>{line.title}</span>)}</div>
      </div>
      <aside className="storyline-inspector">{storylineForm??eventForm??(selected?<><header><span>{stageLabel[selected.event.stage]}</span><h2>{selected.event.title}</h2><p>{scriptTitle}</p></header><section><h3>事件说明</h3><p>{selected.event.description||'尚未补充事件说明。'}</p></section><section><h3>铺垫与回收</h3><div className="story-link-detail"><span>铺垫：{selected.event.setup_event_id?eventById.get(selected.event.setup_event_id)?.title??'关联事件已删除':'未关联'}</span><span>回收目标：{selected.event.payoff_event_id?eventById.get(selected.event.payoff_event_id)?.title??'关联事件已删除':'未关联'}</span></div></section><section><h3>关联标签</h3><div className="story-tags"><span>{selected.line.title}</span><span>{stageLabel[selected.event.stage]}</span></div></section><div className="story-warning"><AlertTriangle size={15}/><span>跨集修改前需检查后续事件和引用。</span></div><div className="narrative-inspector-actions">{onUpdateEvent&&<button type="button" onClick={openEditEvent}><Pencil size={14}/>编辑事件</button>}{onDeleteEvent&&<button type="button" className="danger-action" onClick={()=>void removeEvent()}><Trash2 size={14}/>删除事件</button>}</div>{formError&&<p role="alert">{formError}</p>}</>:<div className="storyline-empty"><GitMerge size={20}/><h2>尚无故事线事件</h2><p>创建事件后会按卷和剧集稳定排列。</p></div>)}</aside>
    </div>
  </section>;
}
