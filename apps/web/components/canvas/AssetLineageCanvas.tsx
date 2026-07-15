'use client';

import {applyNodeChanges, Background, Controls, MiniMap, ReactFlow, type ReactFlowInstance} from '@xyflow/react';
import {X} from 'lucide-react';
import {useEffect, useMemo, useRef, useState} from 'react';
import type {AssetImpact, AssetVariant, AssetVariantState, AssetVariantUsage, Character, CharacterReference, EpisodeSummary} from '../../lib/types';
import {
  assetLineageNodeId,
  assetLineageNodeSize,
  buildAssetLineageGraph,
  highlightAssetLineageGraph,
  layoutAssetLineageGraph,
  type AssetLineageEdge,
  type AssetLineageNode,
  type AssetLineageScope,
} from '../../lib/asset-lineage-canvas';
import {AssetLineageToolbar} from './AssetLineageToolbar';
import {AssetLineageMasterNode} from './nodes/AssetLineageMasterNode';
import {AssetLineageVariantNode} from './nodes/AssetLineageVariantNode';
import {AssetLineageStateNode} from './nodes/AssetLineageStateNode';
import {AssetLineageUsageNode} from './nodes/AssetLineageUsageNode';

const nodeTypes = {
  master: AssetLineageMasterNode,
  variant: AssetLineageVariantNode,
  state: AssetLineageStateNode,
  usage: AssetLineageUsageNode,
};

type VariantDraft = {
  kind: 'master' | 'episode';
  label: string;
  episode_id: string | null;
  parent_variant_id: string | null;
  inherited_fields: string[];
  overrides: Record<string, unknown>;
};

type StateDraft = {
  kind: AssetVariantState['kind'];
  label: string;
  overrides: Record<string, unknown>;
};

type UsageDraft = {
  state_id: string | null;
  shot_id: string;
  usage_kind: 'panel' | 'video' | 'reference';
};

type ShotOption = {id: string; label: string};

const usageBindingLabels:Record<AssetVariantUsage['binding_status'],string>={
  pending:'待解析',resolved:'已解析',fallback:'已回退',missing_representation:'缺少 3D',missing_director_object:'缺少导演对象',invalid_scope:'作用域失效',
};

type Selection =
  | {kind: 'variant'; item: AssetVariant}
  | {kind: 'state'; item: AssetVariantState; variant: AssetVariant}
  | {kind: 'usage'; item: AssetVariantUsage; variant: AssetVariant};

export function AssetLineageCanvas({
  character,
  references,
  variants,
  episodes = [],
  onCreateVariant,
  onUpdateVariant,
  onDeleteVariant,
  onCreateState,
  onUpdateState,
  onDeleteState,
  onLoadEpisodeShots,
  onCreateUsage,
  onAnalyzeImpact,
  onRegenerateImpact,
}: {
  character: Character;
  references: CharacterReference[];
  variants: AssetVariant[];
  episodes?: EpisodeSummary[];
  onCreateVariant?: (data: VariantDraft) => Promise<void> | void;
  onUpdateVariant?: (id: string, data: VariantDraft) => Promise<void> | void;
  onDeleteVariant?: (id: string) => Promise<void> | void;
  onCreateState?: (variantId: string, data: StateDraft) => Promise<void> | void;
  onUpdateState?: (id: string, data: StateDraft) => Promise<void> | void;
  onDeleteState?: (id: string) => Promise<void> | void;
  onLoadEpisodeShots?: (episodeId: string) => Promise<ShotOption[]>;
  onCreateUsage?: (variantId: string, data: UsageDraft) => Promise<void> | void;
  onAnalyzeImpact?: (scope: {characterId: string; variantId: string | null; stateId: string | null}) => Promise<AssetImpact>;
  onRegenerateImpact?: (impact: AssetImpact) => Promise<void> | void;
}) {
  const [scope, setScope] = useState<AssetLineageScope>('work');
  const [selectedNodeId, setSelectedNodeId] = useState(() => {
    const master = variants.find((item) => item.kind === 'master');
    if (master) return assetLineageNodeId.master(character.id);
    const first = variants.find((item) => item.kind !== 'master');
    return first ? assetLineageNodeId.variant(first.id) : '';
  });
  const [editor, setEditor] = useState<'variant-create' | 'variant-edit' | 'state-create' | 'state-edit' | 'usage-create' | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [variantLabel, setVariantLabel] = useState('');
  const [stateLabel, setStateLabel] = useState('');
  const [stateKind, setStateKind] = useState<AssetVariantState['kind']>('expression');
  const [episodeId, setEpisodeId] = useState<string | null>(null);
  const [usageShots, setUsageShots] = useState<ShotOption[]>([]);
  const [usageShotId, setUsageShotId] = useState('');
  const [usageKind, setUsageKind] = useState<UsageDraft['usage_kind']>('panel');
  const [usageLoading, setUsageLoading] = useState(false);
  const [viewport, setViewport] = useState({x: 0, y: 0, zoom: 0.75});
  const [undoNodes, setUndoNodes] = useState<any[] | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [impact, setImpact] = useState<AssetImpact | null>(null);
  const [impactMode, setImpactMode] = useState<'analysis' | 'confirm' | null>(null);
  const [impactBusy, setImpactBusy] = useState(false);
  const [impactMessage, setImpactMessage] = useState('');
  const [pendingMutation, setPendingMutation] = useState<
    | {kind: 'variant'; id: string; data: VariantDraft}
    | {kind: 'state'; id: string; data: StateDraft}
    | null
  >(null);
  const flowRef = useRef<ReactFlowInstance<any, any> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(max-width: 700px)');
    const update = () => setReadOnly(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const graph = useMemo(
    () => buildAssetLineageGraph(character, references, variants, scope),
    [character, references, variants, scope],
  );

  const [positionedNodes, setPositionedNodes] = useState(() =>
    graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: node.data,
      style: {
        width: assetLineageNodeSize(node.type).width,
        height: assetLineageNodeSize(node.type).height,
      },
    })),
  );

  useEffect(() => {
    const valid = graph.nodes.some((node) => node.id === selectedNodeId);
    if (!valid) setSelectedNodeId(graph.nodes[0]?.id ?? '');
  }, [graph, selectedNodeId]);

  const highlighted = useMemo(
    () => highlightAssetLineageGraph(graph.nodes, graph.edges, selectedNodeId),
    [graph, selectedNodeId],
  );

  useEffect(() => {
    let active = true;
    void layoutAssetLineageGraph(graph.nodes, graph.edges).then((next) => {
      if (!active) return;
      setPositionedNodes(
        next.map((node) => ({
          id: node.id,
          type: node.type,
          position: node.position,
          data: node.data,
          style: {
            width: assetLineageNodeSize(node.type).width,
            height: assetLineageNodeSize(node.type).height,
          },
        })),
      );
    });
    return () => {
      active = false;
    };
  }, [graph]);

  const renderNodes = useMemo(() => {
    const dimmed = new Map(highlighted.nodes.map((node) => [node.id, node.data.dimmed]));
    return positionedNodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        dimmed: dimmed.get(node.id),
        onSelect: () => setSelectedNodeId(node.id),
      },
      className: [dimmed.get(node.id) ? 'lineage-node-dimmed' : '', node.id === selectedNodeId ? 'lineage-node-selected' : ''].filter(Boolean).join(' '),
    }));
  }, [positionedNodes, highlighted, selectedNodeId]);

  const renderEdges = useMemo(
    () =>
      highlighted.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'smoothstep' as const,
        style: {
          stroke: edge.data.highlighted
            ? 'var(--color-accent-strong)'
            : edge.type === 'reference'
              ? 'var(--color-info)'
              : 'var(--color-line-strong)',
          strokeWidth: edge.data.highlighted ? 2.4 : 1.4,
          strokeDasharray: edge.type === 'reference' ? '6 5' : 'none',
        },
      })),
    [highlighted.edges],
  );

  const selectedNode = useMemo(() => positionedNodes.find((node) => node.id === selectedNodeId), [positionedNodes, selectedNodeId]);

  const selected = useMemo<Selection | null>(() => {
    if (!selectedNode) return null;
    const {data, type} = selectedNode;
    if (type === 'master' || type === 'variant') {
      const variant = data.variant as AssetVariant | undefined;
      return variant ? {kind: 'variant', item: variant} : null;
    }
    if (type === 'state') {
      const state = data.state as AssetVariantState | undefined;
      const variant = data.variant as AssetVariant | undefined;
      return state && variant ? {kind: 'state', item: state, variant} : null;
    }
    if (type === 'usage') {
      const usage = data.usage as AssetVariantUsage | undefined;
      const variant = data.variant as AssetVariant | undefined;
      return usage && variant ? {kind: 'usage', item: usage, variant} : null;
    }
    return null;
  }, [selectedNode]);

  const selectedVariant = useMemo(() => {
    if (selected?.kind === 'variant') return selected.item;
    if (selected?.kind === 'state' || selected?.kind === 'usage') return selected.variant;
    return null;
  }, [selected]);

  const episodeVariants = useMemo(() => variants.filter((item) => item.kind === 'episode'), [variants]);

  const episodeOptions = useMemo(() => {
    return episodes.length
      ? episodes
      : Array.from(
          new Map(
            episodeVariants
              .filter((item) => item.episode_id)
              .map((item) => [
                item.episode_id!,
                {
                  id: item.episode_id!,
                  title: `剧集 ${item.episode_id}`,
                  project_id: character.project_id,
                  premise: '',
                  target_duration_seconds: 0,
                  status: 'planned' as const,
                  created_at: '',
                  updated_at: '',
                },
              ]),
          ).values(),
        );
  }, [episodes, episodeVariants, character.project_id]);

  useEffect(() => {
    setEpisodeId((prev) => {
      if (prev && episodeOptions.some((item) => item.id === prev)) return prev;
      return episodeOptions[0]?.id ?? null;
    });
  }, [episodeOptions]);

  const detail = useMemo(() => {
    if (!selected) return null;
    if (selected.kind === 'variant') {
      return {
        kind: selected.item.kind === 'master' ? '主设定' : '集级变体',
        title: selected.item.label,
        inherited: selected.item.inherited_fields.join('、') || '无',
        overridden: Object.keys(selected.item.overrides).join('、') || '无',
        impact: `${selected.item.usages.length} 个镜头引用`,
        version: selected.item.version,
      };
    }
    if (selected.kind === 'state') {
      return {
        kind: '状态',
        title: selected.item.label,
        inherited: selected.variant.label,
        overridden: Object.keys(selected.item.overrides).join('、') || '无',
        impact: `${selected.variant.usages.filter((usage) => usage.state_id === selected.item.id).length} 个镜头引用`,
        version: selected.item.version,
      };
    }
    return {
      kind: '镜头引用',
      title: `镜头 ${selected.item.shot_id}`,
      inherited: selected.variant.label,
      overridden: `${selected.item.usage_kind} · ${usageBindingLabels[selected.item.binding_status]}`,
      impact: selected.item.effective_representation_version
        ? `3D V${selected.item.effective_representation_version} · ${selected.item.director_object_id?'导演对象已绑定':'导演对象未绑定'}`
        : '尚未绑定有效 3D',
      version: selected.variant.version,
    };
  }, [selected]);

  const closeEditor = () => {
    setEditor(null);
    setEditingId(null);
    setFormError('');
  };

  const openCreateVariant = () => {
    setEditingId(null);
    setVariantLabel('');
    setFormError('');
    setEditor('variant-create');
  };

  const openEditVariant = () => {
    if (!selectedVariant) return;
    setEditingId(selectedVariant.id);
    setVariantLabel(selectedVariant.label);
    setFormError('');
    setEditor('variant-edit');
  };

  const openCreateState = () => {
    setEditingId(null);
    setStateLabel('');
    setStateKind('expression');
    setFormError('');
    setEditor('state-create');
  };

  const openEditState = () => {
    if (selected?.kind !== 'state') return;
    setEditingId(selected.item.id);
    setStateLabel(selected.item.label);
    setStateKind(selected.item.kind);
    setFormError('');
    setEditor('state-edit');
  };

  const openCreateUsage = async () => {
    if (!selectedVariant?.episode_id || !onLoadEpisodeShots) return;
    setEditor('usage-create');
    setUsageShots([]);
    setUsageShotId('');
    setUsageKind('panel');
    setFormError('');
    setUsageLoading(true);
    try {
      const shots = await onLoadEpisodeShots(selectedVariant.episode_id);
      setUsageShots(shots);
      setUsageShotId(shots[0]?.id ?? '');
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : '加载剧集镜头失败');
    } finally {
      setUsageLoading(false);
    }
  };

  const impactScope = () => ({
    characterId: character.id,
    variantId: selectedVariant?.id ?? null,
    stateId:
      selected?.kind === 'state'
        ? selected.item.id
        : selected?.kind === 'usage'
          ? selected.item.state_id
          : null,
  });

  const loadImpact = async (mode: 'analysis' | 'confirm') => {
    if (!onAnalyzeImpact || !selectedVariant || impactBusy) return null;
    setImpactBusy(true);
    setImpactMessage('');
    setFormError('');
    try {
      const report = await onAnalyzeImpact(impactScope());
      setImpact(report);
      setImpactMode(mode);
      return report;
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : '分析影响范围失败');
      return null;
    } finally {
      setImpactBusy(false);
    }
  };

  const closeImpact = () => {
    setImpact(null);
    setImpactMode(null);
    setImpactMessage('');
    setPendingMutation(null);
  };

  const saveVariant = async () => {
    if (!selectedVariant || !variantLabel.trim() || busy) return;
    setBusy(true);
    setFormError('');
    try {
      const data: VariantDraft = editingId
        ? {
            kind: selectedVariant.kind,
            label: variantLabel.trim(),
            episode_id: selectedVariant.episode_id,
            parent_variant_id: selectedVariant.parent_variant_id,
            inherited_fields: selectedVariant.inherited_fields,
            overrides: selectedVariant.overrides,
          }
        : {
            kind: 'episode',
            label: variantLabel.trim(),
            episode_id: episodeId ?? selectedVariant.episode_id ?? null,
            parent_variant_id: selectedVariant.id,
            inherited_fields: ['identity', 'hair', 'outfit'],
            overrides: {},
          };
      if (editingId) {
        if (!onUpdateVariant) return;
        if (onAnalyzeImpact) {
          const report = await loadImpact('confirm');
          if (report) setPendingMutation({kind: 'variant', id: editingId, data});
          return;
        }
        await onUpdateVariant(editingId, data);
      } else {
        if (!onCreateVariant) return;
        await onCreateVariant(data);
      }
      setVariantLabel('');
      closeEditor();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : '保存变体失败');
    } finally {
      setBusy(false);
    }
  };

  const saveState = async () => {
    if (!selectedVariant || !stateLabel.trim() || busy) return;
    setBusy(true);
    setFormError('');
    try {
      const overrides = selected?.kind === 'state' && editingId ? selected.item.overrides : {};
      const data: StateDraft = {kind: stateKind, label: stateLabel.trim(), overrides};
      if (editingId) {
        if (!onUpdateState) return;
        if (onAnalyzeImpact) {
          const report = await loadImpact('confirm');
          if (report) setPendingMutation({kind: 'state', id: editingId, data});
          return;
        }
        await onUpdateState(editingId, data);
      } else {
        if (!onCreateState) return;
        await onCreateState(selectedVariant.id, data);
      }
      setStateLabel('');
      closeEditor();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : '保存状态失败');
    } finally {
      setBusy(false);
    }
  };

  const saveUsage = async () => {
    if (!selectedVariant || !usageShotId || !onCreateUsage || busy) return;
    setBusy(true);
    setFormError('');
    try {
      await onCreateUsage(selectedVariant.id, {
        state_id: selected?.kind === 'state' ? selected.item.id : null,
        shot_id: usageShotId,
        usage_kind: usageKind,
      });
      closeEditor();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : '保存镜头绑定失败');
    } finally {
      setBusy(false);
    }
  };

  const removeVariant = async () => {
    if (
      selected?.kind !== 'variant' ||
      selected.item.kind === 'master' ||
      !onDeleteVariant ||
      busy ||
      !window.confirm(`删除资产变体“${selected.item.label}”？`)
    )
      return;
    setBusy(true);
    try {
      await onDeleteVariant(selected.item.id);
      setSelectedNodeId(
        selected.item.parent_variant_id
          ? assetLineageNodeId.variant(selected.item.parent_variant_id)
          : assetLineageNodeId.master(character.id),
      );
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : '删除变体失败');
    } finally {
      setBusy(false);
    }
  };

  const removeState = async () => {
    if (selected?.kind !== 'state' || !onDeleteState || busy || !window.confirm(`删除资产状态“${selected.item.label}”？`)) return;
    setBusy(true);
    try {
      await onDeleteState(selected.item.id);
      setSelectedNodeId(assetLineageNodeId.variant(selected.variant.id));
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : '删除状态失败');
    } finally {
      setBusy(false);
    }
  };

  const confirmMutation = async () => {
    if (!pendingMutation || impactBusy) return;
    setImpactBusy(true);
    setFormError('');
    try {
      if (pendingMutation.kind === 'variant') {
        await onUpdateVariant?.(pendingMutation.id, pendingMutation.data);
        setVariantLabel('');
      } else {
        await onUpdateState?.(pendingMutation.id, pendingMutation.data);
        setStateLabel('');
      }
      closeImpact();
      closeEditor();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : '保存变更失败');
    } finally {
      setImpactBusy(false);
    }
  };

  const regenerateImpact = async () => {
    if (!impact || !onRegenerateImpact || impactBusy) return;
    setImpactBusy(true);
    setImpactMessage('');
    try {
      await onRegenerateImpact(impact);
      setImpactMessage(`已启动 ${impact.episodes.length} 集的画面重生成`);
    } catch (cause) {
      setImpactMessage(cause instanceof Error ? cause.message : '启动画面重生成失败');
    } finally {
      setImpactBusy(false);
    }
  };

  const fitAll = () => {
    if (flowRef.current) void flowRef.current.fitView({padding: 0.16, maxZoom: 0.88});
  };

  const focusSelection = () => {
    if (!flowRef.current || !selectedNodeId) return;
    void flowRef.current.fitView({nodes: [{id: selectedNodeId}], padding: 0.18, maxZoom: 0.9});
  };

  const autoLayout = async () => {
    setUndoNodes(positionedNodes);
    const next = await layoutAssetLineageGraph(graph.nodes, graph.edges);
    setPositionedNodes(
      next.map((node) => ({
        id: node.id,
        type: node.type,
        position: node.position,
        data: node.data,
        style: {
          width: assetLineageNodeSize(node.type).width,
          height: assetLineageNodeSize(node.type).height,
        },
      })),
    );
    requestAnimationFrame(() => fitAll());
  };

  const undoLayout = () => {
    if (!undoNodes) return;
    setPositionedNodes(undoNodes);
    setUndoNodes(null);
  };

  const effectiveLayout = null;

  return (
    <section className="asset-lineage-workspace">
      <AssetLineageToolbar
        scope={scope}
        setScope={setScope}
        onLayout={() => void autoLayout()}
        onUndo={undoLayout}
        canUndo={Boolean(undoNodes)}
        onFitAll={fitAll}
        onFocusSelection={focusSelection}
        canFocus={Boolean(selectedNodeId)}
      />
      <div className="lineage-body">
        <ReactFlow
          className="lineage-canvas"
          nodes={renderNodes}
          edges={renderEdges}
          nodeTypes={nodeTypes}
          nodesConnectable={false}
          nodesDraggable={!readOnly}
          minZoom={0.2}
          maxZoom={1.35}
          panOnDrag={!readOnly}
          elementsSelectable={!readOnly}
          selectionOnDrag={false}
          defaultViewport={viewport}
          fitView={!effectiveLayout}
          fitViewOptions={{padding: 0.16, maxZoom: 0.88}}
          onInit={(instance) => {
            flowRef.current = instance;
          }}
          onNodesChange={(changes) => setPositionedNodes((current) => applyNodeChanges(changes, current))}
          onNodeDragStop={(_, node) => {
            setPositionedNodes((current) => current.map((item) => (item.id === node.id ? {...item, position: node.position} : item)));
          }}
          onMoveEnd={(_, nextViewport) => setViewport(nextViewport)}
        >
          <Background gap={18} size={1} />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
        <aside className="lineage-inspector">
          {editor?.startsWith('variant') ? (
            <form
              className="lineage-create-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveVariant();
              }}
            >
              <header>
                <span>{editingId ? '资产变体' : `继承 ${selectedVariant?.label}`}</span>
                <h2>{editingId ? '编辑集级变体' : '创建集级变体'}</h2>
                <button type="button" aria-label="关闭变体表单" onClick={closeEditor}>
                  <X size={14} />
                </button>
              </header>
              <label>
                变体名称
                <input aria-label="变体名称" value={variantLabel} onChange={(event) => setVariantLabel(event.target.value)} autoFocus />
              </label>
              {!editingId && episodeOptions.length > 0 && (
                <label>
                  关联剧集
                  <select aria-label="变体关联剧集" value={episodeId ?? ''} onChange={(event) => setEpisodeId(event.target.value || null)}>
                    {episodeOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p>{editingId ? '修改会创建新版本并保留继承关系。' : '默认继承身份、发型和服装；创建后可继续添加覆盖状态。'}</p>
              {formError && <p role="alert">{formError}</p>}
              <button className="primary-action" type="submit" disabled={!variantLabel.trim() || busy}>
                {busy ? '正在保存' : '保存变体'}
              </button>
            </form>
          ) : editor?.startsWith('state') ? (
            <form
              className="lineage-create-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveState();
              }}
            >
              <header>
                <span>{selectedVariant?.label}</span>
                <h2>{editingId ? '编辑状态' : '创建状态'}</h2>
                <button type="button" aria-label="关闭状态表单" onClick={closeEditor}>
                  <X size={14} />
                </button>
              </header>
              <label>
                状态类型
                <select aria-label="状态类型" value={stateKind} onChange={(event) => setStateKind(event.target.value as AssetVariantState['kind'])}>
                  <option value="expression">表情</option>
                  <option value="outfit">服装</option>
                  <option value="injury">伤势</option>
                  <option value="age">年龄</option>
                  <option value="custom">自定义</option>
                </select>
              </label>
              <label>
                状态名称
                <input aria-label="状态名称" value={stateLabel} onChange={(event) => setStateLabel(event.target.value)} autoFocus />
              </label>
              {formError && <p role="alert">{formError}</p>}
              <button className="primary-action" type="submit" disabled={!stateLabel.trim() || busy}>
                {busy ? '正在保存' : '保存状态'}
              </button>
            </form>
          ) : editor === 'usage-create' ? (
            <form
              className="lineage-create-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveUsage();
              }}
            >
              <header>
                <span>{selectedVariant?.label}</span>
                <h2>绑定到镜头</h2>
                <button type="button" aria-label="关闭镜头绑定表单" onClick={closeEditor}>
                  <X size={14} />
                </button>
              </header>
              <label>
                目标镜头
                <select aria-label="目标镜头" value={usageShotId} disabled={usageLoading} onChange={(event) => setUsageShotId(event.target.value)}>
                  {usageShots.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
              <label>
                生成用途
                <select aria-label="生成用途" value={usageKind} onChange={(event) => setUsageKind(event.target.value as UsageDraft['usage_kind'])}>
                  <option value="panel">画面生成</option>
                  <option value="video">视频生成</option>
                  <option value="reference">通用参考</option>
                </select>
              </label>
              {usageLoading && <p role="status">正在加载镜头…</p>}
              {!usageLoading && !usageShots.length && !formError && <p>当前剧集尚无可绑定镜头。</p>}
              {formError && <p role="alert">{formError}</p>}
              <button className="primary-action" type="submit" disabled={!usageShotId || usageLoading || busy}>
                {busy ? '正在保存' : '保存镜头绑定'}
              </button>
            </form>
          ) : detail ? (
            <>
              <header>
                <span>{detail.kind}</span>
                <h2>{detail.title}</h2>
                <p>{character.name}</p>
              </header>
              <section>
                <h3>继承关系</h3>
                <div className="inheritance-summary">
                  <p>继承：{detail.inherited}</p>
                  <p>覆盖：{detail.overridden}</p>
                </div>
              </section>
              <section>
                <h3>下游影响</h3>
                <strong className="impact-count">{detail.impact}</strong>
                <button className="impact-action" onClick={() => void loadImpact('analysis')} disabled={!onAnalyzeImpact || impactBusy}>
                  {impactBusy ? '正在分析' : '分析影响范围'}
                </button>
              </section>
              <section>
                <h3>版本与引用</h3>
                <div className="lineage-version">
                  <span>当前版本</span>
                  <strong>V{detail.version}</strong>
                </div>
              </section>
              <div className="lineage-inspector-actions">
                <button>与父级比较</button>
                {selected?.kind === 'variant' && onUpdateVariant && selected.item.kind === 'episode' && (
                  <button onClick={openEditVariant}>编辑变体</button>
                )}
                {selected?.kind === 'variant' && onDeleteVariant && selected.item.kind === 'episode' && (
                  <button className="danger-action" onClick={() => void removeVariant()}>
                    删除变体
                  </button>
                )}
                {selected?.kind === 'state' && onUpdateState && <button onClick={openEditState}>编辑状态</button>}
                {selected?.kind === 'state' && onDeleteState && (
                  <button className="danger-action" onClick={() => void removeState()}>
                    删除状态
                  </button>
                )}
                {onCreateState && selectedVariant?.kind === 'episode' && <button onClick={openCreateState}>创建状态</button>}
                {onCreateUsage && onLoadEpisodeShots && selectedVariant?.kind === 'episode' && selected?.kind !== 'usage' && (
                  <button onClick={() => void openCreateUsage()}>绑定到镜头</button>
                )}
                {onCreateVariant && selectedVariant && (
                  <button className="primary-action" onClick={openCreateVariant}>
                    创建子变体
                  </button>
                )}
              </div>
              {formError && <p role="alert">{formError}</p>}
            </>
          ) : (
            <div className="lineage-empty-inspector">
              <h2>选择谱系节点</h2>
              <p>节点详情和下游影响会显示在这里。</p>
            </div>
          )}
        </aside>
      </div>
      {impact && impactMode && (
        <div className="dialog-backdrop">
          <section className="form-dialog impact-dialog" role="dialog" aria-label={impactMode === 'confirm' ? '确认下游影响' : '下游影响范围'}>
            <header>
              <div>
                <h2>{impactMode === 'confirm' ? '确认下游影响' : '下游影响范围'}</h2>
                <small>共 {impact.shots.length} 个镜头，分布在 {impact.episodes.length} 集</small>
              </div>
              <button type="button" aria-label="关闭影响范围" onClick={closeImpact}>×</button>
            </header>
            <div className="impact-report">
              {impact.episodes.length ? impact.episodes.map((episode) => (
                <section key={episode.episode_id}>
                  <h3>{episode.episode_title}</h3>
                  {episode.scenes.map((scene) => (
                    <div key={scene.scene_id} className="impact-scene">
                      <strong>{scene.scene_label}</strong>
                      {scene.shots.map((shot) => <p key={shot.id}>镜头 {String(shot.position).padStart(2, '0')} · {shot.composition}</p>)}
                    </div>
                  ))}
                </section>
              )) : <p>当前变更没有已绑定镜头。</p>}
            </div>
            {impactMessage && <p role="status" className="impact-message">{impactMessage}</p>}
            <footer>
              <button type="button" onClick={closeImpact}>取消</button>
              {impactMode === 'analysis' && onRegenerateImpact && impact.shots.length > 0 && (
                <button type="button" className="primary-action" onClick={() => void regenerateImpact()} disabled={impactBusy}>
                  {impactBusy ? '正在启动' : '重新生成受影响画面'}
                </button>
              )}
              {impactMode === 'confirm' && (
                <button type="button" className="primary-action" onClick={() => void confirmMutation()} disabled={impactBusy}>
                  {impactBusy ? '正在保存' : '确认变更'}
                </button>
              )}
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
