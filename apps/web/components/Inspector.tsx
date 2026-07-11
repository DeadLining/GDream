import {ImagePlus, Mic2, RotateCcw, Sparkles} from 'lucide-react';
import type {Shot} from '../lib/types';

export function Inspector({shot}: {shot: Shot}) {
  return (
    <aside className="inspector">
      <div className="inspector-heading"><span>镜头检查器</span><h2>镜头 {shot.position}</h2><p>{shot.shot_type.replace('_', ' ')} · {shot.duration_seconds} 秒</p></div>
      <section className="inspector-section">
        <label>画面描述</label>
        <textarea value={shot.composition} readOnly rows={3} />
      </section>
      <section className="inspector-section">
        <label>生成提示词</label>
        <textarea value={shot.image_prompt} readOnly rows={5} className="prompt-field" />
      </section>
      <section className="inspector-section inline-fields">
        <div><label>运镜</label><button className="select-control">{shot.camera_motion}</button></div>
        <div><label>审核</label><span className={`status-badge ${shot.review_status}`}>{shot.review_status === 'approved' ? '已通过' : '待审核'}</span></div>
      </section>
      <div className="inspector-actions">
        <button className="primary-action"><ImagePlus size={18} />生成画面</button>
        <button><RotateCcw size={17} />重新生成</button>
        <button><Mic2 size={17} />生成对白</button>
      </div>
      <div className="model-note"><Sparkles size={16} /><span>图像由 <strong>gpt-image-2</strong> 生成</span></div>
    </aside>
  );
}
