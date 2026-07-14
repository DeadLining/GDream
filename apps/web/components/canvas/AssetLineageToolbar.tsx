'use client';

import {Focus, LayoutDashboard, Maximize2, Undo2} from 'lucide-react';
import type {AssetLineageScope} from '../../lib/asset-lineage-canvas';

export function AssetLineageToolbar({
  scope,
  setScope,
  onLayout,
  onUndo,
  canUndo,
  onFitAll,
  onFocusSelection,
  canFocus,
}: {
  scope: AssetLineageScope;
  setScope: (scope: AssetLineageScope) => void;
  onLayout: () => void;
  onUndo: () => void;
  canUndo: boolean;
  onFitAll: () => void;
  onFocusSelection: () => void;
  canFocus: boolean;
}) {
  return (
    <div className="lineage-toolbar" aria-label="谱系画布工具栏">
      <div className="lineage-scope">
        <button aria-pressed={scope === 'work'} onClick={() => setScope('work')}>
          全作品
        </button>
        <button aria-pressed={scope === 'episode'} onClick={() => setScope('episode')}>
          本集
        </button>
      </div>
      <div className="lineage-tools">
        <button title="自动布局" aria-label="自动布局" onClick={onLayout}>
          <LayoutDashboard size={16} />
        </button>
        <button title="撤销布局" aria-label="撤销布局" onClick={onUndo} disabled={!canUndo}>
          <Undo2 size={16} />
        </button>
        <span className="lineage-toolbar-divider" />
        <button title="适应画布" aria-label="适应画布" onClick={onFitAll}>
          <Maximize2 size={16} />
        </button>
        <button title="聚焦选中节点" aria-label="聚焦选中节点" onClick={onFocusSelection} disabled={!canFocus}>
          <Focus size={16} />
        </button>
      </div>
    </div>
  );
}
