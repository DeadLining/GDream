import {Check} from 'lucide-react';
import type {Asset} from '../lib/types';
import {mediaUrl} from '../lib/api';

export function PanelVersions({assets, activeId, onActivate}: {assets: Asset[]; activeId: string | null; onActivate: (id: string) => void}) {
  return <section className="inspector-section panel-version-section" aria-labelledby="panel-versions-heading">
    <div className="section-heading-row"><h3 id="panel-versions-heading">画面版本</h3><span>{assets.length} 个版本</span></div>
    {assets.length ? <div className="panel-versions">{assets.map(asset => {
      const active = asset.id === activeId;
      const staleLabel=asset.stale_reason==='missing_provenance'?'缺少生成快照':asset.stale_reason==='inputs_unavailable'?'当前输入不可用':'输入已变化';
      return <button key={asset.id} className={[active?'active':'',asset.is_stale?'stale':''].filter(Boolean).join(' ')} onClick={() => onActivate(asset.id)} aria-label={`画面版本 ${asset.generation_attempt}${active ? '，当前版本' : ''}${asset.is_stale?`，${staleLabel}`:''}`} aria-pressed={active}>
        <img src={mediaUrl(asset.media_url)} alt=""/>
        <span>v{asset.generation_attempt}</span>{asset.is_stale&&<em aria-hidden="true">过期</em>}{active && <i aria-hidden="true"><Check size={12}/></i>}
      </button>;
    })}</div> : <p className="section-empty">尚未生成画面版本</p>}
  </section>;
}
