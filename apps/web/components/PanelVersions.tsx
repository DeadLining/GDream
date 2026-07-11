import {Check} from 'lucide-react';
import type {Asset} from '../lib/types';
import {mediaUrl} from '../lib/api';

export function PanelVersions({assets, activeId, onActivate}: {assets: Asset[]; activeId: string | null; onActivate: (id: string) => void}) {
  return <section className="inspector-section panel-version-section" aria-labelledby="panel-versions-heading">
    <div className="section-heading-row"><h3 id="panel-versions-heading">画面版本</h3><span>{assets.length} 个版本</span></div>
    {assets.length ? <div className="panel-versions">{assets.map(asset => {
      const active = asset.id === activeId;
      return <button key={asset.id} className={active ? 'active' : ''} onClick={() => onActivate(asset.id)} aria-label={`画面版本 ${asset.generation_attempt}${active ? '，当前版本' : ''}`} aria-pressed={active}>
        <img src={mediaUrl(asset.media_url)} alt=""/>
        <span>v{asset.generation_attempt}</span>{active && <i aria-hidden="true"><Check size={12}/></i>}
      </button>;
    })}</div> : <p className="section-empty">尚未生成画面版本</p>}
  </section>;
}
