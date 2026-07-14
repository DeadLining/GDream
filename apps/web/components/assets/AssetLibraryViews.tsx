'use client';

import {ArrowLeft,Check,CheckCircle2,ChevronRight,Circle,GitBranch,ImageIcon,MessageSquareText,MousePointer2,Plus,Search,Send,Sparkles} from 'lucide-react';
import {useEffect,useMemo,useState,type ReactNode} from 'react';
import {mediaUrl,suggestAssetVariant,type AssetVariantSuggestion} from '../../lib/api';
import type {AssetVariant,AssetVariantState,Character,CharacterReference,CharacterReferenceType,EpisodeSummary} from '../../lib/types';

const referenceLabels:Record<CharacterReferenceType,string>={primary:'主参考',front:'正面',three_quarter:'四分之三',side:'侧面',back:'背面',expression:'表情',outfit:'服装'};
const stateLabels:Record<AssetVariantState['kind'],string>={expression:'表情',outfit:'服装',injury:'伤势',age:'年龄',custom:'自定义'};
const statusLabel=(status:string)=>status==='approved'?'已通过':status==='needs_changes'?'需修改':'待审核';
const firstReference=(references:CharacterReference[],type?:CharacterReferenceType)=>references.find(item=>(!type||item.reference_type===type)&&item.is_active)??references.find(item=>!type||item.reference_type===type);
const imageFor=(references:CharacterReference[],type?:CharacterReferenceType)=>{const reference=firstReference(references,type);return reference?mediaUrl(reference.asset.media_url):null;};

export type AssetWorkspaceView='catalog'|'master'|'variant'|'lineage';
type CharacterDetailTab='master'|'references'|'variant'|'lineage';

export function AssetCatalogView({characters,character,references,variants,onSelect,onOpen}:{characters:Character[];character:Character;references:CharacterReference[];variants:AssetVariant[];onSelect:(id:string)=>void;onOpen:(view:AssetWorkspaceView)=>void}){
  const [filter,setFilter]=useState<'all'|'variants'|'pending'>('all');
  const selectedImage=imageFor(references);
  const episodeVariants=variants.filter(item=>item.kind==='episode');
  const pending=references.filter(item=>item.review_status!=='approved').length+variants.filter(item=>item.review_status!=='approved').length;
  const filtered=characters.filter(item=>filter==='all'||item.id===character.id);

  return <main className="character-workspace asset-library-page asset-catalog-page">
    <div className="asset-catalog-layout">
      <aside className="asset-catalog-sidebar">
        <h2>工作区</h2>
        <button className="active"><span>角色资产</span><b>{characters.length}</b></button>
        <button disabled><span>场景</span><b>0</b></button>
        <button disabled><span>道具</span><b>0</b></button>
        <button disabled><span>服装</span><b>0</b></button>
        <button disabled><span>声音</span><b>0</b></button>
      </aside>

      <section className="asset-catalog-content">
        <header>
          <div><h1>作品资产库</h1><p>管理作品级主设定、集级变体与审核状态。</p></div>
          <label className="asset-search"><Search size={15}/><span className="sr-only">搜索资产</span><input placeholder="搜索资产名称"/></label>
        </header>
        <div className="asset-catalog-filters">
          <button className={filter==='all'?'active':''} onClick={()=>setFilter('all')}>主设定</button>
          <button className={filter==='variants'?'active':''} onClick={()=>setFilter('variants')}>有变体</button>
          <button className={filter==='pending'?'active':''} onClick={()=>setFilter('pending')}>待审核</button>
        </div>
        <div className="asset-card-grid">
          {filtered.map(item=>{
            const current=item.id===character.id;
            const image=current?selectedImage:null;
            const visible=filter!=='variants'||current&&episodeVariants.length>0;
            const pendingVisible=filter!=='pending'||current&&pending>0;
            if(!visible||!pendingVisible)return null;
            return <button type="button" className={`asset-catalog-card ${current?'selected':''}`} key={item.id} onClick={()=>{onSelect(item.id);onOpen('master');}} aria-label={`${item.name} ${item.role}`}>
              <span className="asset-card-media">{image?<img src={image} alt=""/>:<span className="asset-card-placeholder">{item.name.slice(0,1)}</span>}<i>{current&&pending?'待审核':'主设定'}</i></span>
              <span className="asset-card-body"><strong>{item.name}</strong><small>{item.role}</small><span><em>{current?statusLabel(variants.find(variant=>variant.kind==='master')?.review_status??'draft'):'未加载'}</em></span><span className="asset-card-stats">集级变体 {current?episodeVariants.length:0}</span></span>
            </button>;
          })}
        </div>
      </section>

      <aside className="asset-catalog-inspector">
        <header><div><h2>{character.name}</h2><span>{character.role}</span></div><strong>{statusLabel(variants.find(item=>item.kind==='master')?.review_status??'draft')}</strong></header>
        <dl><div><dt>资产类型</dt><dd>角色</dd></div><div><dt>主设定</dt><dd>MASTER v{variants.find(item=>item.kind==='master')?.version??1}</dd></div><div><dt>集级变体</dt><dd>{episodeVariants.length}</dd></div><div><dt>状态数量</dt><dd>{episodeVariants.reduce((total,item)=>total+item.states.length,0)}</dd></div></dl>
        <div className="asset-inspector-tabs"><button className="active">主设定</button><button onClick={()=>onOpen('variant')}>集级变体</button><button onClick={()=>onOpen('lineage')}>引用</button></div>
        <section className="asset-lineage-preview"><h3>继承谱系</h3><div><span className="lineage-preview-root">{character.name}<small>主设定</small></span><ChevronRight size={16}/><span className="lineage-preview-branches">{episodeVariants.slice(0,2).map(item=><button key={item.id} onClick={()=>onOpen('variant')}>{item.label}</button>)}</span></div></section>
        <footer><button onClick={()=>onOpen('lineage')}><GitBranch size={15}/>打开谱系</button><button className="primary-action" onClick={()=>onOpen('variant')}><Plus size={15}/>创建变体</button></footer>
      </aside>
    </div>
  </main>;
}

export function CharacterMasterView({characters,character,references,variants,referenceManager,variantWorkspace,lineageWorkspace,initialTab='master',onSelect,onOpen}:{characters:Character[];character:Character;references:CharacterReference[];variants:AssetVariant[];referenceManager:ReactNode;variantWorkspace:ReactNode;lineageWorkspace:ReactNode;initialTab?:Exclude<CharacterDetailTab,'references'>;onSelect:(id:string)=>void;onOpen:(view:AssetWorkspaceView)=>void}){
  const [tab,setTab]=useState<CharacterDetailTab>(initialTab);
  const master=variants.find(item=>item.kind==='master');
  const episodeVariants=variants.filter(item=>item.kind==='episode');
  const approved=references.filter(item=>item.review_status==='approved').length;
  const score=references.length?Math.round(approved/references.length*100):0;
  const slots:Array<[string,CharacterReferenceType|undefined]>=[['1. 正面视图','front'],['2. 侧面视图','side'],['3. 背面视图','back'],['4. 表情设定','expression'],['5. 全身视图','primary'],['6. 服装细节','outfit']];
  const embedded=tab==='variant'||tab==='lineage';
  useEffect(()=>setTab(initialTab),[initialTab]);

  return <main className={`character-workspace asset-library-page master-setting-page ${embedded?'master-setting-page-embedded':''}`}>
    <aside className="master-character-list"><h2>角色列表</h2>{characters.map(item=><button key={item.id} className={item.id===character.id?'active':''} onClick={()=>onSelect(item.id)}><span>{item.name}</span><small>{item.id===character.id?'已锁定':item.role}</small></button>)}</aside>
    <section className="master-setting-content">
      <header><button className="asset-back" aria-label="返回资产库" onClick={()=>onOpen('catalog')}><ArrowLeft size={15}/></button><h1>角色主设定</h1><span className="master-lock"><CheckCircle2 size={14}/>已锁定</span></header>
      <nav className="master-tabs" aria-label="角色资产详情">
        <button className={tab==='master'?'active':''} onClick={()=>setTab('master')}>主设定</button>
        <button className={tab==='references'?'active':''} onClick={()=>setTab('references')}>参考集</button>
        <button className={tab==='variant'?'active':''} onClick={()=>setTab('variant')}>变体</button>
        <button className={tab==='lineage'?'active':''} onClick={()=>setTab('lineage')}>使用记录</button>
      </nav>
      {tab==='references'?referenceManager:tab==='variant'?<div className="master-embedded-workspace">{variantWorkspace}</div>:tab==='lineage'?<div className="master-embedded-workspace">{lineageWorkspace}</div>:<>
        <div className="master-image-grid">{slots.map(([label,type])=>{const image=imageFor(references,type);return <article key={label}><span>{label}</span>{image?<img src={image} alt={`${character.name}${label}`}/>:<div><ImageIcon size={20}/><small>尚无图片</small></div>}</article>;})}</div>
        <section className="identity-bible"><h2>设定档案 (Identity Bible)</h2><div><article><span>身份与外观</span><p>{character.appearance_bible||'尚未填写角色外观设定。'}</p></article><article><span>性格</span><p>{character.personality||'尚未填写角色性格。'}</p></article><article><span>连续性规则</span><p>{character.continuity_rules||'尚未填写连续性规则。'}</p></article><article><span>禁止漂移</span><p>{character.negative_constraints||'尚未填写禁止项。'}</p></article></div></section>
      </>}
    </section>
    {!embedded&&<aside className="master-setting-inspector"><h2>设定信息</h2><dl><div><dt>版本</dt><dd>MASTER v{master?.version??1}</dd></div><div><dt>状态</dt><dd>{statusLabel(master?.review_status??'draft')}</dd></div><div><dt>一致性</dt><dd>{score} / 100</dd></div><div><dt>参考图</dt><dd>{references.length} 张</dd></div></dl><section><h3>来源参考图 ({references.length})</h3><div className="master-source-strip">{references.slice(0,6).map(item=><img key={item.id} src={mediaUrl(item.asset.media_url)} alt=""/>)}</div></section><section><h3>血统（继承关系）</h3><div className="master-lineage-summary"><strong>MASTER v{master?.version??1}</strong>{episodeVariants.map(item=><button key={item.id} onClick={()=>setTab('variant')}>{item.label}</button>)}</div></section><button className="primary-action" onClick={()=>setTab('variant')}>创建集级变体</button><button onClick={()=>setTab('lineage')}>查看继承关系</button></aside>}
  </main>;
}

type VariantDraft={kind:'master'|'episode';label:string;episode_id:string|null;parent_variant_id:string|null;inherited_fields:string[];overrides:Record<string,unknown>};
type StateDraft={kind:AssetVariantState['kind'];label:string;overrides:Record<string,unknown>};

export function AssetVariantEditorView({character,references,variants,episodes,onOpen,onCreateVariant,onCreateState,embedded=false}:{character:Character;references:CharacterReference[];variants:AssetVariant[];episodes:EpisodeSummary[];onOpen:(view:AssetWorkspaceView)=>void;onCreateVariant:(data:VariantDraft)=>Promise<void>|void;onCreateState:(variantId:string,data:StateDraft)=>Promise<void>|void;embedded?:boolean}){
  const master=variants.find(item=>item.kind==='master')??variants[0];
  const episodeVariants=variants.filter(item=>item.kind==='episode');
  const [selectedId,setSelectedId]=useState(episodeVariants[0]?.id??master?.id??'');
  const [stateId,setStateId]=useState<string>('');
  const [busy,setBusy]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [messages,setMessages]=useState<Array<{role:'user'|'assistant';content:string}>>([{role:'assistant',content:'描述角色在本集发生的视觉变化。我会判断它属于集级变体，还是表情、服装、伤势等临时状态。'}]);
  const [draft,setDraft]=useState<AssetVariantSuggestion|null>(null);
  const [annotations,setAnnotations]=useState<Array<{cx:number;cy:number;label:string}>>([]);
  const selected=variants.find(item=>item.id===selectedId)??episodeVariants[0]??master;
  const selectedState=selected?.states.find(item=>item.id===stateId)??selected?.states[0];
  const image=imageFor(references);
  const stateImage=(state:AssetVariantState)=>imageFor(references,state.kind==='expression'?'expression':state.kind==='outfit'?'outfit':undefined)??image;
  const canvasImage=selectedState?stateImage(selectedState):image;
  const fields=useMemo(()=>Array.from(new Set(['年龄','发型','服装','伤势','表情',...Object.keys(selected?.overrides??{}),...Object.keys(selectedState?.overrides??{}),...Object.keys(draft?.overrides??{})])),[selected,selectedState,draft]);
  useEffect(()=>{if(selected&&!selected.states.some(item=>item.id===stateId))setStateId(selected.states[0]?.id??'');},[selected,stateId]);
  useEffect(()=>{if(!selectedId&&episodeVariants[0])setSelectedId(episodeVariants[0].id);},[episodeVariants,selectedId]);

  const addAnnotation=(event:React.MouseEvent<HTMLDivElement>)=>{if(!canvasImage)return;const rect=event.currentTarget.getBoundingClientRect();if(!rect.width||!rect.height)return;const clamp=(value:number)=>Math.min(.92,Math.max(.08,value));setAnnotations(current=>[...current,{cx:Number(clamp((event.clientX-rect.left)/rect.width).toFixed(4)),cy:Number(clamp((event.clientY-rect.top)/rect.height).toFixed(4)),label:`圈点 ${String(current.length+1).padStart(2,'0')}`}]);};
  const send=async()=>{const content=message.trim();if(!content||busy)return;const nextMessages=[...messages,{role:'user' as const,content}];setMessages(nextMessages);setMessage('');setBusy(true);setError('');try{const episode=episodes.find(item=>item.id===selected?.episode_id)??episodes[0]??null;const suggestion=await suggestAssetVariant({character_id:character.id,episode_id:episode?.id??null,message:content,character:{name:character.name,role:character.role,appearance_bible:character.appearance_bible,personality:character.personality,continuity_rules:character.continuity_rules,negative_constraints:character.negative_constraints},episode:episode?{id:episode.id,title:episode.title,premise:episode.premise}:null,conversation:nextMessages,annotations:annotations.map(item=>({kind:'circle',geometry:{cx:item.cx,cy:item.cy,rx:.08,ry:.08},label:item.label}))});setDraft(suggestion);setMessages(current=>[...current,{role:'assistant',content:suggestion.assistant_message}]);}catch(cause){setError(cause instanceof Error?cause.message:'AI 变体分析失败');}finally{setBusy(false);}};
  const confirmDraft=async()=>{if(!draft||saving)return;setSaving(true);setError('');try{if(draft.kind==='episode'){await onCreateVariant({kind:'episode',label:draft.label,episode_id:episodes[0]?.id??null,parent_variant_id:master?.id??null,inherited_fields:draft.inherited_fields,overrides:draft.overrides});}else if(selected?.kind==='episode'&&draft.state_kind){await onCreateState(selected.id,{kind:draft.state_kind,label:draft.label,overrides:draft.overrides});}else{throw new Error('AI 判断这是临时状态，请先在左侧选择一个集级变体，或继续对话创建本集基础造型。');}setMessages(current=>[...current,{role:'assistant',content:`“${draft.label}”已确认入库。`}]);setDraft(null);setAnnotations([]);}catch(cause){setError(cause instanceof Error?cause.message:'保存变体失败');}finally{setSaving(false);}};

  const content=<div className="variant-editor-layout">
      <aside className="variant-tree"><h2>继承树</h2>{master&&<button className={selected?.id===master.id?'active':''} onClick={()=>{setSelectedId(master.id);setStateId('');}}><span>{character.name}</span><small>MASTER v{master.version}</small></button>}{episodeVariants.map(variant=><div key={variant.id}><button className={selected?.id===variant.id?'active':''} onClick={()=>{setSelectedId(variant.id);setStateId(variant.states[0]?.id??'');}}><span>{variant.label}</span><small>{statusLabel(variant.review_status)}</small></button>{variant.states.map(state=><button className={`variant-tree-state ${stateId===state.id?'active':''}`} key={state.id} onClick={()=>{setSelectedId(variant.id);setStateId(state.id);}}><span>{state.label}</span><small>{stateLabels[state.kind]}</small></button>)}</div>)}</aside>
      <section className="variant-editor-main">
        <div className="ai-variant-canvas-shell"><header><div><button aria-label="选择工具"><MousePointer2 size={16}/></button><button className="active" aria-label="圈选工具"><Circle size={16}/></button></div><span>圈点角色图片后，在右侧描述需要改变的部分</span></header><div className="ai-variant-canvas" aria-label="变体创作画布" onClick={addAnnotation}>{canvasImage?<img src={canvasImage} alt={`${character.name}角色主设定`}/>:<div><ImageIcon size={24}/><span>尚无角色参考图</span></div>}{annotations.map((item,index)=><button type="button" key={`${item.cx}-${item.cy}-${index}`} aria-label={item.label} style={{left:`${item.cx*100}%`,top:`${item.cy*100}%`}}>{String(index+1).padStart(2,'0')}</button>)}</div><footer><div><span>当前基线</span><strong>{selected?.kind==='episode'?selected.label:`MASTER v${master?.version??1}`}</strong></div>{references.slice(0,5).map(reference=><span key={reference.id}><img src={mediaUrl(reference.asset.media_url)} alt=""/></span>)}</footer></div>
        <section className="variant-diff"><h2>属性差异（与继承源对比）</h2><table><thead><tr><th>属性</th><th>MASTER</th><th>{selected?.label??'集级变体'}</th><th>{draft?.label??selectedState?.label??'AI 草案'}</th></tr></thead><tbody>{fields.map(field=>{const comparison=draft?.overrides??selectedState?.overrides??{};return <tr key={field}><td>{field}</td><td>继承</td><td className={field in (selected?.overrides??{})?'changed':''}>{String(selected?.overrides?.[field]??'继承')}</td><td className={field in comparison?'changed':''}>{String(comparison[field]??'继承')}</td></tr>;})}</tbody></table></section>
      </section>
      <aside className="variant-impact ai-variant-conversation"><header><div><span>资产创作助手</span><h2>{character.name}</h2></div><MessageSquareText size={18}/></header><div className="review-context"><span>{episodes.find(item=>item.id===selected?.episode_id)?.title??episodes[0]?.title??'作品级'}</span><span>{selected?.kind==='episode'?'集级变体':'MASTER'}</span><span>{annotations.length} 个圈点</span></div><div className="conversation-thread">{messages.map((item,index)=>item.role==='assistant'?<div className="conversation-ai" key={index}><Sparkles size={16}/><p>{item.content}</p></div>:<div className="conversation-user" key={index}>{item.content}</div>)}</div><div className="ai-variant-compose"><input aria-label="描述角色变化" value={message} onChange={event=>setMessage(event.target.value)} placeholder="例如：第一集换成唐代书生服装，保持脸型" onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void send();}}}/><button aria-label="发送变体创作消息" disabled={!message.trim()||busy} onClick={()=>void send()}>{busy?<Sparkles size={15}/>:<Send size={15}/>}</button></div>{draft&&<section className="ai-variant-draft"><header><div><span>{draft.kind==='episode'?'集级变体':'临时状态'}</span><h3>{draft.label}</h3></div><strong>{draft.kind==='state'&&draft.state_kind?stateLabels[draft.state_kind]:'本集'}</strong></header><p>{draft.summary}</p><dl><div><dt>继承</dt><dd>{draft.inherited_fields.join('、')||'身份基线'}</dd></div><div><dt>覆盖</dt><dd>{Object.keys(draft.overrides).join('、')||'无'}</dd></div></dl><button className="primary-action" aria-label="确认入库" disabled={saving} onClick={()=>void confirmDraft()}><Check size={15}/>{saving?'正在保存':'确认入库'}</button><button onClick={()=>setDraft(null)}>继续对话修改</button></section>}{error&&<p className="form-error" role="alert">{error}</p>}</aside>
    </div>;
  if(embedded)return <section className="asset-variant-embedded">{content}</section>;
  return <main className="character-workspace asset-library-page asset-variant-page"><header className="variant-page-header"><button aria-label="返回角色主设定" onClick={()=>onOpen('master')}><ArrowLeft size={16}/></button><h1>AI 角色变体创作</h1><button onClick={()=>onOpen('lineage')}><GitBranch size={15}/>查看资产谱系</button></header>{content}</main>;
}
