'use client';

import {useState} from 'react';
import {Film, Image, Mic2, RefreshCw} from 'lucide-react';
import type {ProductionStage} from '../../lib/types';

/**
 * M1.3 — Work-flow group rerun control.
 *
 * Shown when the operator has box-selected one or more shot nodes on the
 * production canvas. Lets them kick off a `shot_group`-scoped ProductionRun
 * for just those shots, without disturbing the main episode-scope run.
 */
export function ShotGroupRerun({
  selectedShotIds,
  starting,
  error,
  onSubmit,
}: {
  selectedShotIds: string[];
  starting: boolean;
  error: string;
  onSubmit: (stages: ProductionStage[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [stages, setStages] = useState<ProductionStage[]>(['panels', 'speech']);

  if (selectedShotIds.length === 0) return null;

  const toggleStage = (stage: ProductionStage, checked: boolean) =>
    setStages(checked ? [...stages, stage] : stages.filter(item => item !== stage));

  const submit = () => {
    if (!stages.length || starting) return;
    onSubmit(stages);
    setOpen(false);
  };

  return (
    <div className="shot-group-rerun" role="region" aria-label="补跑控制">
      <button
        className="primary-action"
        aria-label={`为选中的 ${selectedShotIds.length} 个镜头创建补跑`}
        aria-expanded={open}
        disabled={starting}
        aria-busy={starting}
        onClick={() => setOpen(!open)}
      >
        <RefreshCw size={16} />
        <span>补跑 {selectedShotIds.length} 镜头</span>
      </button>
      {open && (
        <section className="shot-group-rerun-popover" role="dialog" aria-label="补跑配置">
          <header>
            <div>
              <small>shot_group 范围</small>
              <h2>补跑配置</h2>
            </div>
            <button aria-label="关闭补跑配置" onClick={() => setOpen(false)}>×</button>
          </header>
          <p className="shot-group-rerun-summary">
            只会重跑选中的 <b>{selectedShotIds.length}</b> 个镜头，主 run 的其他镜头不受影响。
          </p>
          <fieldset>
            <legend>生成范围</legend>
            <label>
              <input
                aria-label="画面"
                type="checkbox"
                checked={stages.includes('panels')}
                onChange={event => toggleStage('panels', event.target.checked)}
              />
              <Image size={15} />画面
            </label>
            <label>
              <input
                aria-label="配音"
                type="checkbox"
                checked={stages.includes('speech')}
                onChange={event => toggleStage('speech', event.target.checked)}
              />
              <Mic2 size={15} />配音
            </label>
            <label>
              <input
                aria-label="视频"
                type="checkbox"
                checked={stages.includes('videos')}
                onChange={event => toggleStage('videos', event.target.checked)}
              />
              <Film size={15} />视频
            </label>
          </fieldset>
          <button
            className="primary-action"
            aria-label="启动补跑"
            disabled={!stages.length || starting}
            aria-busy={starting}
            onClick={submit}
          >
            <RefreshCw size={16} />
            <span>{starting ? '正在启动' : '启动补跑'}</span>
          </button>
          {error && <p className="shot-group-rerun-error" role="alert">{error}</p>}
        </section>
      )}
    </div>
  );
}
