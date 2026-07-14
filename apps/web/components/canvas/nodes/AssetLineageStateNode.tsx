'use client';

import {memo} from 'react';
import {Handle, Position} from '@xyflow/react';
import type {AssetLineageNode} from '../../../lib/asset-lineage-canvas';

const stateLabels: Record<string, string> = {
  expression: '表情',
  outfit: '服装',
  injury: '伤势',
  age: '年龄',
  custom: '自定义',
};

export const AssetLineageStateNode = memo(function AssetLineageStateNode({
  data,
}: {
  data: AssetLineageNode['data'];
}) {
  const label = String(data.label);
  const image = data.image as string | null;
  const onSelect = data.onSelect as (() => void) | undefined;
  const state = data.state;
  const kind = state?.kind ?? 'custom';
  const overrides = state ? Object.keys(state.overrides).length : 0;

  return (
    <div
      role="button"
      aria-label={label}
      tabIndex={0}
      className="lineage-node state-node"
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect?.();
        }
      }}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      {image ? (
        <img src={image} alt="" />
      ) : (
        <span className="lineage-node-icon">
          <span>态</span>
        </span>
      )}
      <span>
        <strong>{label}</strong>
        <small>
          {stateLabels[kind] ?? '自定义'} · {overrides} 项覆盖
        </small>
      </span>
    </div>
  );
});
