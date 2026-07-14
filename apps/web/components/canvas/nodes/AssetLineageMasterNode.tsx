'use client';

import {memo} from 'react';
import {Handle, Position} from '@xyflow/react';
import type {AssetLineageNode} from '../../../lib/asset-lineage-canvas';

export const AssetLineageMasterNode = memo(function AssetLineageMasterNode({
  data,
}: {
  data: AssetLineageNode['data'];
}) {
  const label = String(data.label);
  const image = data.image as string | null;
  const onSelect = data.onSelect as (() => void) | undefined;

  return (
    <div
      role="button"
      aria-label={label}
      tabIndex={0}
      className="lineage-node master-node"
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect?.();
        }
      }}
    >
      <Handle type="source" position={Position.Right} />
      {image ? (
        <img src={image} alt="" />
      ) : (
        <span className="lineage-node-icon">
          <span>主</span>
        </span>
      )}
      <span>
        <strong>{label}</strong>
        <small>作品主设定</small>
      </span>
    </div>
  );
});
