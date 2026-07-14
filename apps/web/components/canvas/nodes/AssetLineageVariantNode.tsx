'use client';

import {memo} from 'react';
import {Handle, Position} from '@xyflow/react';
import type {AssetLineageNode} from '../../../lib/asset-lineage-canvas';

export const AssetLineageVariantNode = memo(function AssetLineageVariantNode({
  data,
}: {
  data: AssetLineageNode['data'];
}) {
  const label = String(data.label);
  const image = data.image as string | null;
  const onSelect = data.onSelect as (() => void) | undefined;
  const variant = data.variant;

  const overrides = variant ? Object.keys(variant.overrides).length : 0;
  const parentLabel = variant?.parent_variant_id ? '父级变体' : '主设定';
  const subtitle = `继承 ${parentLabel} · ${overrides} 项覆盖`;

  return (
    <div
      role="button"
      aria-label={label}
      tabIndex={0}
      className="lineage-node variant-node"
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
          <span>变</span>
        </span>
      )}
      <span>
        <strong>{label}</strong>
        <small>{subtitle}</small>
      </span>
    </div>
  );
});
