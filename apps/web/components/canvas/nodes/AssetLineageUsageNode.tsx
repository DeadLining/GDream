'use client';

import {memo} from 'react';
import {Handle, Position} from '@xyflow/react';
import type {AssetLineageNode} from '../../../lib/asset-lineage-canvas';

const usageLabels: Record<string, string> = {
  panel: '画面',
  video: '视频',
  reference: '参考',
};

export const AssetLineageUsageNode = memo(function AssetLineageUsageNode({
  data,
}: {
  data: AssetLineageNode['data'];
}) {
  const label = String(data.label);
  const image = data.image as string | null;
  const onSelect = data.onSelect as (() => void) | undefined;
  const usage = data.usage;
  const kind = usage?.usage_kind ?? 'reference';

  return (
    <div
      role="button"
      aria-label={label}
      tabIndex={0}
      className="lineage-node usage-node"
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect?.();
        }
      }}
    >
      <Handle type="target" position={Position.Left} />
      {image ? (
        <img src={image} alt="" />
      ) : (
        <span className="lineage-node-icon">
          <span>镜</span>
        </span>
      )}
      <span>
        <strong>{label}</strong>
        <small>{usageLabels[kind] ?? '引用'}</small>
      </span>
    </div>
  );
});
