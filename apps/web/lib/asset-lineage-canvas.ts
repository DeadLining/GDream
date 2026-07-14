// Asset lineage graph builder / layout / highlight utilities
// Designed to mirror the production-canvas graph pipeline.

import ELK from 'elkjs/lib/elk.bundled.js';
import {mediaUrl} from './api/core';
import type {
  AssetVariant,
  AssetVariantState,
  AssetVariantUsage,
  Character,
  CharacterReference,
} from './types';

export type AssetLineageScope = 'work' | 'episode';

export type AssetLineageNodeType = 'master' | 'variant' | 'state' | 'usage';

export type AssetLineageNode = {
  id: string;
  type: AssetLineageNodeType;
  position: {x: number; y: number};
  style?: Record<string, string | number>;
  data: {
    label: string;
    image: string | null;
    variant?: AssetVariant;
    state?: AssetVariantState;
    usage?: AssetVariantUsage;
    dimmed?: boolean;
    [key: string]: unknown;
  };
};

export type AssetLineageEdgeType = 'inheritance' | 'reference';

export type AssetLineageEdge = {
  id: string;
  source: string;
  target: string;
  type: AssetLineageEdgeType;
  data: {lineStyle: 'solid' | 'dashed'; highlighted?: boolean};
};

export const assetLineageNodeId = {
  master: (characterId: string) => `al-master:${characterId}`,
  variant: (id: string) => `al-variant:${id}`,
  state: (id: string) => `al-state:${id}`,
  usage: (id: string) => `al-usage:${id}`,
};

function primaryImage(references: CharacterReference[]): string | null {
  const primary =
    references.find((item) => item.is_active) ??
    references.find((item) => item.reference_type === 'primary') ??
    references[0];
  return primary ? mediaUrl(primary.asset.media_url) : null;
}

export function assetLineageNodeSize(type: AssetLineageNodeType) {
  if (type === 'master') return {width: 196, height: 140};
  if (type === 'variant') return {width: 196, height: 148};
  if (type === 'state') return {width: 184, height: 124};
  return {width: 152, height: 92};
}

export function buildAssetLineageGraph(
  character: Character,
  references: CharacterReference[],
  variants: AssetVariant[],
  scope: AssetLineageScope = 'work',
): {nodes: AssetLineageNode[]; edges: AssetLineageEdge[]} {
  const image = primaryImage(references);
  const nodes: AssetLineageNode[] = [];
  const edges: AssetLineageEdge[] = [];
  const nodeIds = new Set<string>();
  const masterVariant = variants.find((item) => item.kind === 'master');

  const addNode = (node: AssetLineageNode) => {
    const size = assetLineageNodeSize(node.type);
    nodeIds.add(node.id);
    nodes.push({
      ...node,
      style: {width: size.width, height: size.height},
    });
  };

  const addEdge = (edge: AssetLineageEdge) => edges.push(edge);

  const variantSourceId = (variant: AssetVariant) =>
    variant.kind === 'master'
      ? assetLineageNodeId.master(character.id)
      : assetLineageNodeId.variant(variant.id);

  // Root master node. In 'episode' scope we hide the master root to focus on
  // episode-level variants.
  if (scope === 'work') {
    const rootVariant = masterVariant ?? variants[0];
    addNode({
      id: assetLineageNodeId.master(character.id),
      type: 'master',
      position: {x: 0, y: 0},
      data: {
        label: `${character.name} ${rootVariant && rootVariant.kind !== 'master' ? '基础设定' : '作品主设定'}`,
        image,
        variant: rootVariant,
      },
    });
  }

  const includedVariants =
    scope === 'work'
      ? variants
      : variants.filter((item) => item.kind === 'episode' && item.episode_id);

  // Variants
  for (const variant of includedVariants) {
    if (variant.kind === 'master') continue;
    const parentVariant = variant.parent_variant_id
      ? variants.find((item) => item.id === variant.parent_variant_id)
      : undefined;
    const parentId =
      parentVariant?.kind === 'master'
        ? assetLineageNodeId.master(character.id)
        : variant.parent_variant_id
          ? assetLineageNodeId.variant(variant.parent_variant_id)
          : assetLineageNodeId.master(character.id);
    addNode({
      id: assetLineageNodeId.variant(variant.id),
      type: 'variant',
      position: {x: 0, y: 0},
      data: {label: variant.label, image, variant},
    });
    if (nodeIds.has(parentId)) {
      addEdge({
        id: `inheritance:${parentId}:${assetLineageNodeId.variant(variant.id)}`,
        source: parentId,
        target: assetLineageNodeId.variant(variant.id),
        type: 'inheritance',
        data: {lineStyle: 'solid'},
      });
    }
  }

  // States
  for (const variant of includedVariants) {
    const sourceId = variantSourceId(variant);
    for (const state of variant.states) {
      addNode({
        id: assetLineageNodeId.state(state.id),
        type: 'state',
        position: {x: 0, y: 0},
        data: {label: state.label, image, state, variant},
      });
      if (nodeIds.has(sourceId)) {
        addEdge({
          id: `inheritance:${sourceId}:${assetLineageNodeId.state(state.id)}`,
          source: sourceId,
          target: assetLineageNodeId.state(state.id),
          type: 'inheritance',
          data: {lineStyle: 'solid'},
        });
      }
    }
  }

  // Usages
  for (const variant of includedVariants) {
    for (const usage of variant.usages) {
      addNode({
        id: assetLineageNodeId.usage(usage.id),
        type: 'usage',
        position: {x: 0, y: 0},
        data: {label: `镜头 ${usage.shot_id}`, image, usage, variant},
      });
      const sourceId = usage.state_id
        ? assetLineageNodeId.state(usage.state_id)
        : variantSourceId(variant);
      if (nodeIds.has(sourceId)) {
        addEdge({
          id: `reference:${sourceId}:${assetLineageNodeId.usage(usage.id)}`,
          source: sourceId,
          target: assetLineageNodeId.usage(usage.id),
          type: 'reference',
          data: {lineStyle: 'dashed'},
        });
      }
    }
  }

  return {nodes, edges};
}

export function highlightAssetLineageGraph(
  nodes: AssetLineageNode[],
  edges: AssetLineageEdge[],
  selectedNodeId: string | null,
): {nodes: AssetLineageNode[]; edges: AssetLineageEdge[]} {
  const connected = new Set<string>(selectedNodeId ? [selectedNodeId] : []);
  const queue = selectedNodeId ? [selectedNodeId] : [];
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of edges) {
      if (edge.source !== current && edge.target !== current) continue;
      const next = edge.source === current ? edge.target : edge.source;
      if (!connected.has(next)) {
        connected.add(next);
        queue.push(next);
      }
    }
  }
  return {
    nodes: nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        dimmed: Boolean(selectedNodeId && !connected.has(node.id)),
      },
    })),
    edges: edges.map((edge) => ({
      ...edge,
      data: {
        ...edge.data,
        highlighted: Boolean(
          selectedNodeId &&
            connected.has(edge.source) &&
            connected.has(edge.target),
        ),
      },
    })),
  };
}

export async function layoutAssetLineageGraph(
  nodes: AssetLineageNode[],
  edges: AssetLineageEdge[],
): Promise<AssetLineageNode[]> {
  const elk = new ELK();
  const result = await elk.layout({
    id: 'asset-lineage-root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '36',
      'elk.layered.spacing.nodeNodeBetweenLayers': '64',
      'elk.edgeRouting': 'ORTHOGONAL',
    },
    children: nodes.map((node) => {
      const size = assetLineageNodeSize(node.type);
      return {id: node.id, width: size.width, height: size.height};
    }),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  });
  const positions = new Map(
    (result.children ?? []).map((node) => [
      node.id,
      {x: node.x ?? 0, y: node.y ?? 0},
    ]),
  );
  return nodes.map((node) => {
    const position = positions.get(node.id);
    return position ? {...node, position} : node;
  });
}
