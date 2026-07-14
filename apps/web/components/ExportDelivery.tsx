'use client';

import {useEffect,useMemo,useState} from 'react';
import {CheckCircle2,Clock3,PackageCheck,TriangleAlert} from 'lucide-react';
import {createDeliveryPackage,listDeliveryPackages,listReleaseCandidates} from '../lib/api';
import type {DeliveryOutput,DeliveryPackage,EpisodeDetail,ProjectDetail,ReleaseCandidate} from '../lib/types';
import {OperationsLayout} from './OperationsLayout';
import {RenderReviewBadge} from './RenderReviewBadge';

const defaultOutputs:DeliveryOutput[]=[
  {kind:'landscape_video',format:'MP4 / H.264',enabled:true},
  {kind:'vertical_video',format:'MP4 / H.264',enabled:true},
  {kind:'clean_master',format:'MP4 / ProRes',enabled:true},
  {kind:'subtitles',format:'SRT / ASS',enabled:true},
  {kind:'audio_mix',format:'WAV / PCM 24bit',enabled:true},
  {kind:'asset_manifest',format:'JSON / UTF-8',enabled:true},
];
const outputLabels:Record<DeliveryOutput['kind'],string>={landscape_video:'横屏视频',vertical_video:'竖屏视频',clean_master:'无字幕母版',subtitles:'字幕',audio_mix:'混音音轨',asset_manifest:'资产清单'};
const statusLabels:Record<DeliveryPackage['status'],string>={queued:'已排队',running:'处理中',completed:'已完成',failed:'失败'};
const checkLabels:Record<string,string>={release_candidate_approved:'候选版本已审核',render_complete:'主渲染文件存在',asset_license:'素材许可确认'};

export function ExportDelivery({project,episode,onNavigate}:{project:ProjectDetail|null;episode:EpisodeDetail|null;onNavigate?:(page:string)=>void}){
  const [candidates,setCandidates]=useState<ReleaseCandidate[]>([]);
  const [packages,setPackages]=useState<DeliveryPackage[]>([]);
  const [selectedPackageId,setSelectedPackageId]=useState('');
  const [loading,setLoading]=useState(true);
  const [creating,setCreating]=useState(false);
  const [outputs,setOutputs]=useState<DeliveryOutput[]>(defaultOutputs);
  const [error,setError]=useState('');

  useEffect(()=>{
    if(!episode?.id){setLoading(false);return;}
    let active=true;
    setLoading(true);setError('');
    Promise.all([listReleaseCandidates(episode.id),listDeliveryPackages(episode.id)])
      .then(([nextCandidates,nextPackages])=>{if(active){setCandidates(nextCandidates);setPackages(nextPackages);setSelectedPackageId(nextPackages[0]?.id??'');}})
      .catch(cause=>active&&setError(cause instanceof Error?cause.message:'交付信息加载失败'))
      .finally(()=>active&&setLoading(false));
    return()=>{active=false;};
  },[episode?.id]);

  const approved=[...candidates].reverse().find(candidate=>candidate.status==='approved'||candidate.status==='published')??null;
  const selectedPackage=packages.find(item=>item.id===selectedPackageId)??packages[0]??null;
  const selectedChecks=useMemo(()=>selectedPackage?Object.entries(selectedPackage.checks):[],[selectedPackage]);
  const create=async()=>{
    if(!episode||!approved)return;
    setCreating(true);setError('');
    try{
      const created=await createDeliveryPackage(episode.id,{release_candidate_id:approved.id,preset_name:'平台标准包',outputs});
      setPackages(items=>[created,...items]);setSelectedPackageId(created.id);
    }catch(cause){setError(cause instanceof Error?cause.message:'交付任务创建失败');}
    finally{setCreating(false);}
  };

  return <OperationsLayout active="export" onNavigate={onNavigate}>
    <div className="operations-page export-page">
      <header className="operations-page-header"><div><h1>导出与交付</h1><p>配置已审核单集的交付输出，并查看真实任务状态。</p>{episode?.id&&<RenderReviewBadge episodeId={episode.id}/>}</div></header>
      {error&&<p className="warning-box" role="alert">{error}</p>}
      <div className="export-layout">
        <aside className="delivery-tree">
          <h2>当前单集</h2>
          <div className="delivery-current-episode"><strong>{episode?.title??'尚未选择单集'}</strong><small>{project?.title??'当前作品'} · {project?.aspect_ratio??'画幅未配置'}</small></div>
          <h3>交付历史</h3>
          {loading?<p>加载中…</p>:packages.length?packages.map(item=><button key={item.id} className={item.id===selectedPackage?.id?'active':''} onClick={()=>setSelectedPackageId(item.id)}><strong>{item.preset_name}</strong><small>{statusLabels[item.status]}</small></button>):<p>暂无交付任务</p>}
        </aside>

        <section className="delivery-main">
          <div className="delivery-preview delivery-summary">
            <PackageCheck size={30}/>
            <section><span className={`status-chip ${approved?'status-approved':''}`}>{approved?`${approved.version} 已审核通过`:'尚无已审核候选版本'}</span><h2>{episode?.title??'当前单集'}</h2><p>{project?.title??'当前作品'} · {project?.aspect_ratio??'画幅未配置'}</p></section>
          </div>
          <h2>输出清单</h2>
          <table className="operations-table"><thead><tr><th>输出项</th><th>格式</th><th>包含</th></tr></thead><tbody>{outputs.map(output=><tr key={output.kind}><td><strong>{outputLabels[output.kind]}</strong></td><td>{output.format}</td><td><input aria-label={`包含${outputLabels[output.kind]}`} type="checkbox" checked={output.enabled} onChange={()=>setOutputs(items=>items.map(item=>item.kind===output.kind?{...item,enabled:!item.enabled}:item))}/></td></tr>)}</tbody></table>
          <div className="delivery-flow"><span className={approved?'complete':''}><CheckCircle2 size={17}/>{approved?'已审核':'待审核'}</span><b>→</b><span className={selectedPackage?.status==='queued'?'active':''}>{selectedPackage?'任务已创建':'待创建'}</span><b>→</b><span className={selectedPackage?.status==='completed'?'complete':''}>产物可用</span></div>
        </section>

        <aside className="operations-inspector">
          <h2>任务状态</h2>
          {!selectedPackage?<div className="delivery-empty-state"><Clock3 size={20}/><strong>尚未创建交付任务</strong><p>选择输出项后可创建任务记录。当前后端尚未接入打包执行器。</p></div>:<>
            <p className="status-chip">{statusLabels[selectedPackage.status]}</p>
            <h3>{selectedPackage.preset_name}</h3>
            <ul className="delivery-checks">{selectedChecks.map(([key,value])=><li key={key} className={value?'success-text':'warning-text'}>{value?<CheckCircle2 size={16}/>:<TriangleAlert size={16}/>}<span><strong>{checkLabels[key]??key}</strong><small>{value?'服务端记录为是':'服务端记录为否'}</small></span></li>)}</ul>
            {selectedPackage.status==='queued'&&<p className="warning-box">任务已排队，打包执行器尚未接入</p>}
            {selectedPackage.status==='completed'&&!selectedPackage.artifact_path&&<p className="warning-box">任务标记完成，但尚未提供可下载产物。</p>}
          </>}
          <button className="command-button" aria-label="创建交付任务记录" disabled={loading||creating||!approved||!outputs.some(item=>item.enabled)} onClick={create}><PackageCheck size={16}/>{creating?'正在创建…':'创建交付任务记录'}</button>
        </aside>
      </div>
    </div>
  </OperationsLayout>;
}
