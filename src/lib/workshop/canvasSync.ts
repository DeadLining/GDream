import { collectMediaProvenance, provenanceLabel } from './mediaProvenance';
/**
 * canvasSync — 工坊 ↔ 画布双向同步。
 *
 * 协议：画布节点 data.workshopRef = { projectId, kind, id, role }，
 * canvas.json 透传，canvasStore 零侵入。
 *
 * 工坊 → 画布：syncAssetsToCanvas（资产建节点+角色/场景编组）、
 *   syncShotPromptsToCanvas（视频提示词建 video 节点 + 参考资产连线）。
 * 画布 → 工坊：pullFromCanvas（工坊端拉取，新图进候选集不自动替换，
 *   description 变化回传 videoPrompt）。
 */
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { copyFile, createDir, readTextFile, exists, BaseDirectory } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';
import type { Edge, Node } from 'reactflow';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { groupSelection } from '@/lib/canvas/grouping';
import { defaultNodeStyle } from '@/lib/canvas/layout';
import { buildImageRefBindings, buildVideoRefBindings, buildVideoRefPaths, type ShotRefBinding } from '@/lib/workshop/shotRefs';
import { videoInputFingerprint } from '@/lib/workshop/productionLifecycle';
import { canSyncWorkshopCanvas, mergeCanvasVersions, type CanvasAssetVersion } from './liveCanvasPolicy';
import type { WsShot, WorkshopData } from '@/lib/workshop/types';

function activePromptTemplate(_shot: WsShot, _data: WorkshopData): 'legacy' | 'universal' {
  return 'universal';
}

function activeVideoPrompt(shot: WsShot, data: WorkshopData): string {
  return activePromptTemplate(shot, data) === 'universal'
    ? shot.universalVideoPrompt || shot.seedance25VideoPrompt || ''
    : shot.videoPrompt || '';
}

export interface WorkshopRef {
  projectId: string;
  kind: 'character' | 'scene' | 'prop' | 'colorPalette' | 'shot' | 'storyboardFrame' | 'storyboardBoard' | 'directorConstraintCard';
  id: string;
  role: 'asset' | 'prompt-reference' | 'shot-image' | 'shot-video' | 'storyboard-frame' | 'storyboard-board';
  /** 稳定身份用于跨排序/改镜号回传；快照只供 UI 展示。 */
  shotId?: string;
  shotNoSnapshot?: string;
  frameId?: string;
  sourceRevision?: number;
}

function refOf(node: Node): WorkshopRef | undefined {
  return (node.data as Record<string, unknown> | undefined)?.workshopRef as WorkshopRef | undefined;
}

function lineageKey(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function shotIdentity(shot: WsShot): string {
  return shot.id || shot.shotNo;
}

function lineageEdge(
  projectId: string,
  source: string,
  target: string,
  label: string,
  relation: string,
  routeIndex?: number,
): Edge {
  return {
    id: `e-lineage-${lineageKey(`${projectId}:${source}:${target}:${relation}`)}`,
    source,
    target,
    type: 'custom',
    data: { lineage: true, lineageLocked: true, lineageLabel: label, lineageRelation: relation, lineageRouteIndex: routeIndex ?? 0 },
  };
}

export function findRefNode(nodes: Node[], projectId: string, kind: string, id: string, role: string): Node | undefined {
  return nodes.find((n) => {
    const r = refOf(n);
    return r && r.projectId === projectId && r.kind === kind && r.id === id && r.role === role;
  });
}

const NUM_TO_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
function numToCn(n: number): string { return n <= 10 ? NUM_TO_CN[n - 1] : String(n); }

function buildShotVideoCanvasRefs(shot: WsShot, data: WorkshopData): { path: string; label: string }[] {
  const paths = buildVideoRefPaths(shot, {
    scenes: data.scenes,
    characters: data.characters,
    props: data.props ?? [],
    colorPalettes: data.colorPalettes ?? [],
    globalColorPaletteId: data.globalColorPaletteId,
  });
  const seen = new Set<string>();
  return paths
    .filter((path) => {
      if (!path || seen.has(path)) return false;
      seen.add(path);
      return true;
    })
    .map((path, i) => ({ path, label: `@图片${numToCn(i + 1)} ${shot.shotNo} 参考素材` }));
}

function clearShotVideoIncomingRefs(videoNodeId: string) {
  const store = useCanvasStore.getState();
  const localRefIds = new Set(
    store.nodes
      .filter((n) => {
        const d = n.data as Record<string, unknown> | undefined;
        return d?.workshopPromptRefTarget === videoNodeId;
      })
      .map((n) => n.id),
  );
  store.setEdges(store.edges.filter((e) => e.target !== videoNodeId && !localRefIds.has(e.source) && !localRefIds.has(e.target)));
  store.setNodes(store.nodes.filter((n) => !localRefIds.has(n.id)));
  store.updateNode(videoNodeId, {
    referenceImages: [],
    referenceVideos: [],
    imageUrl: undefined,
    generatedVideoUrl: undefined,
    localPath: undefined,
    sourceVideoPath: undefined,
    mediaRole: undefined,
  });
}

function connectShotVideoRefs(videoNodeId: string, refs: { path: string; label: string }[], baseX: number, baseY: number, projectId: string) {
  const store = useCanvasStore.getState();
  refs.forEach((ref, idx) => {
    const nodeId = `node-ws-shot-ref-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`;
    store.addNode({
      id: nodeId,
      type: 'image',
      position: { x: baseX - 300, y: baseY + idx * 92 },
      style: defaultNodeStyle('image'),
      data: {
        generatedImageUrl: convertFileSrc(ref.path),
        localPath: ref.path,
        description: ref.label,
        workshopPromptRefTarget: videoNodeId,
        workshopRef: { projectId, kind: 'shot', id: videoNodeId, role: 'asset' } satisfies WorkshopRef,
      },
    });
    store.onConnect({ source: nodeId, target: videoNodeId, sourceHandle: null, targetHandle: null });
  });
}

async function copyToAssets(projectId: string, srcAbs: string, baseName: string): Promise<string> {
  const home = await homeDir();
  const ext = srcAbs.includes('.') ? srcAbs.slice(srcAbs.lastIndexOf('.')) : '.png';
  const rel = `.gdream/aigc-memory/projects/${projectId}/assets/${baseName}${ext}`;
  await copyFile(srcAbs, rel, { dir: BaseDirectory.Home });
  return `${home}${rel}`;
}

async function copyToShots(projectId: string, srcAbs: string, baseName: string): Promise<string> {
  const home = await homeDir();
  const ext = srcAbs.includes('.') ? srcAbs.slice(srcAbs.lastIndexOf('.')) : '.mp4';
  const rel = `.gdream/aigc-memory/projects/${projectId}/shots/${baseName}${ext}`;
  await copyFile(srcAbs, rel, { dir: BaseDirectory.Home });
  return `${home}${rel}`;
}

/** 工坊资产 → 画布：建/更新 image 节点，人物一组、场景一组。 */
export async function syncAssetsToCanvas(): Promise<string> {
  const { project, data } = useWorkshopStore.getState();
  if (!project || !data) return '没有打开的工坊项目';
  const store = useCanvasStore.getState();

  let created = 0;
  let updated = 0;
  const newIdsByKind: Record<'character' | 'scene' | 'prop' | 'colorPalette', string[]> = { character: [], scene: [], prop: [], colorPalette: [] };

  const selectedPaletteIds = new Set([
    data.globalColorPaletteId,
    ...data.shots.map((shot) => shot.colorPaletteId),
  ].filter(Boolean) as string[]);

  const items: { kind: 'character' | 'scene' | 'prop' | 'colorPalette'; id: string; name: string; prompt?: string; imagePath?: string }[] = [
    ...data.characters.map((c) => ({ kind: 'character' as const, id: c.id, name: c.name, prompt: c.assetPrompt, imagePath: c.assetImagePath })),
    ...data.scenes.map((s) => ({ kind: 'scene' as const, id: s.id, name: s.name, prompt: s.assetPrompt, imagePath: s.assetImagePath })),
    ...(data.props ?? []).map((p) => ({ kind: 'prop' as const, id: p.id, name: p.name, prompt: p.assetPrompt, imagePath: p.assetImagePath })),
    ...(data.colorPalettes ?? [])
      .filter((p) => p.assetImagePath && selectedPaletteIds.has(p.id))
      .map((p) => ({ kind: 'colorPalette' as const, id: p.id, name: p.name, prompt: p.usagePrompt || p.assetPrompt, imagePath: p.assetImagePath })),
  ];

  items.forEach((item, i) => {
    const nodes = useCanvasStore.getState().nodes;
    const existing = findRefNode(nodes, project.id, item.kind, item.id, 'asset');
    const imgData = item.imagePath
      ? { generatedImageUrl: convertFileSrc(item.imagePath), localPath: item.imagePath }
      : {};
    if (existing) {
      store.updateNode(existing.id, { ...imgData, description: item.prompt || item.name });
      updated++;
    } else {
      const col = item.kind === 'character' ? 0 : item.kind === 'scene' ? 1 : item.kind === 'prop' ? 2 : 3;
      const idx = newIdsByKind[item.kind].length;
      const nodeId = `node-ws-asset-${Date.now()}-${i}`;
      store.addNode({
        id: nodeId,
        type: 'image',
        position: { x: 80 + col * 320, y: 80 + idx * 240 },
        style: defaultNodeStyle('image'),
        data: {
          ...imgData,
          description: item.prompt || item.name,
          workshopRef: { projectId: project.id, kind: item.kind, id: item.id, role: 'asset' } satisfies WorkshopRef,
        },
      });
      newIdsByKind[item.kind].push(nodeId);
      created++;
    }
  });

  // 编组：新建的角色一组、场景一组（groupSelection 作用于 selected）
  for (const kind of ['character', 'scene', 'prop', 'colorPalette'] as const) {
    const ids = newIdsByKind[kind];
    if (ids.length < 2) continue;
    const cur = useCanvasStore.getState();
    cur.setNodes(cur.nodes.map((n) => ({ ...n, selected: ids.includes(n.id) })));
    groupSelection();
  }
  // 清选中
  const fin = useCanvasStore.getState();
  fin.setNodes(fin.nodes.map((n) => ({ ...n, selected: false })));

  await useProjectStore.getState().flushActiveCanvas();
  return `资产同步完成：新建 ${created} 个节点，更新 ${updated} 个`;
}

/** 工坊分镜提示词 → 画布：video 节点 + 参考资产连线（onConnect 自动写引用）。 */
export async function syncShotPromptsToCanvas(): Promise<string> {
  const { project, data } = useWorkshopStore.getState();
  if (!project || !data) return '没有打开的工坊项目';
  const store = useCanvasStore.getState();

  let created = 0;
  let updated = 0;
  const shotsWithPrompt = data.shots.filter((shot) => activeVideoPrompt(shot, data));

  shotsWithPrompt.forEach((shot, i) => {
    const prompt = activeVideoPrompt(shot, data);
    const nodes = useCanvasStore.getState().nodes;
    const existing = findRefNode(nodes, project.id, 'shot', shot.shotNo, 'shot-video');
    let nodeId = existing?.id;
    let nodePosition = existing?.position ?? { x: 980, y: 80 + (created + updated) * 300 };
    if (existing) {
      store.updateNode(existing.id, {
        description: prompt,
        videoPromptTemplate: shot.videoPromptTemplate,
        legacyVideoPrompt: shot.videoPrompt,
        universalVideoPrompt: shot.universalVideoPrompt || shot.seedance25VideoPrompt,
        generatedVideoUrl: undefined,
        localPath: undefined,
        sourceVideoPath: undefined,
        mediaRole: undefined,
        referenceVideos: [],
      });
      updated++;
    } else {
      nodeId = `node-ws-shot-${Date.now()}-${i}`;
      store.addNode({
        id: nodeId,
        type: 'video',
        position: nodePosition,
        style: defaultNodeStyle('video'),
        data: {
          description: prompt,
          videoPromptTemplate: shot.videoPromptTemplate,
          legacyVideoPrompt: shot.videoPrompt,
          universalVideoPrompt: shot.universalVideoPrompt || shot.seedance25VideoPrompt,
          workshopRef: { projectId: project.id, kind: 'shot', id: shot.shotNo, role: 'shot-video' } satisfies WorkshopRef,
        },
      });
      created++;
    }
    if (!nodeId) return;
    clearShotVideoIncomingRefs(nodeId);
    const refs = buildShotVideoCanvasRefs(shot, data);
    connectShotVideoRefs(nodeId, refs, nodePosition.x, nodePosition.y, project.id);
    useWorkshopStore.getState().updateShot(shot.shotNo, { canvasNodeId: nodeId });
  });

  await useProjectStore.getState().flushActiveCanvas();
  return `分镜同步完成：新建 ${created} 个视频节点（含参考连线），更新 ${updated} 个`;
}

/**
 * 工坊项目 → 画布血缘图：按真实生成绑定展示
 * 资产 → 镜头图/故事板格 → 故事板拼板 → 视频。
 */
export async function syncWorkshopLineageToCanvas(): Promise<string> {
  const { project, data } = useWorkshopStore.getState();
  if (!project || !data) return '没有打开的工坊项目';
  const canvas = useProjectStore.getState();
  if (!canSyncWorkshopCanvas(data.canvasProjectId, canvas.activeProjectId, canvas.switching) || data.projectId !== project.id) return '等待关联项目画布加载';
  // Optional historical evidence ledger; absence is not evidence of extraction.
  const ledgerPath = `.gdream/aigc-memory/projects/${project.id}/media-provenance.json`;
  let ledger: unknown[] = [];
  if (await exists(ledgerPath, { dir: BaseDirectory.Home })) {
    const parsed = JSON.parse(await readTextFile(ledgerPath, { dir: BaseDirectory.Home }));
    if (Array.isArray(parsed.records)) ledger = parsed.records;
  }
  // File IO must not project a stale project snapshot into a newly selected canvas.
  const fresh = useProjectStore.getState();
  if (useWorkshopStore.getState().data !== data || !canSyncWorkshopCanvas(data.canvasProjectId, fresh.activeProjectId, fresh.switching)) return '项目已变化，等待下次同步';
  const store = useCanvasStore.getState();
  const originalNodes = store.nodes;
  const desiredIds = new Set<string>();
  const lineageEdges: Edge[] = [];
  let nodes = [...originalNodes];

  const upsertNode = (candidate: Node, match?: (node: Node) => boolean): Node => {
    const existing = nodes.find(match ?? ((node) => node.id === candidate.id));
    const existingData = existing?.data as Record<string, unknown> | undefined;
    const keepManualPosition = Boolean(existing);
    const versions = mergeCanvasVersions(
      mergeCanvasVersions((existingData?.assetVersions as CanvasAssetVersion[] | undefined) ?? [], [], existingData?.localPath as string | undefined),
      (candidate.data.assetVersions as CanvasAssetVersion[] | undefined) ?? [],
      candidate.data.localPath,
    );
    candidate.data = { ...candidate.data, assetVersions: versions, generationHistory: versions.map((v) => ({ url: convertFileSrc(v.path), timestamp: v.createdAt })), adoptedVersionPath: candidate.data.localPath };
    const node = existing
      ? {
          ...existing,
          type: candidate.type,
          position: keepManualPosition ? existing.position : candidate.position,
          style: candidate.style,
          parentNode: existing.parentNode,
          extent: existing.extent,
          expandParent: existing.expandParent,
          draggable: true,
          data: { ...(existing.data as Record<string, unknown>), ...(candidate.data as Record<string, unknown>) },
        }
      : { ...candidate, draggable: true };
    desiredIds.add(node.id);
    nodes = existing ? nodes.map((item) => item.id === existing.id ? node : item) : [...nodes, node];
    return node;
  };

  const projectTexts = [
    { id: 'synopsis', label: '项目梗概', content: data.synopsis },
    ...(data.scriptRevisions ?? []).map((revision) => ({ id: `script-${revision.id}`, label: `剧本版本 · ${revision.id}`, content: revision.content })),
  ];
  projectTexts.filter((item) => item.content).forEach((item, index) => upsertNode({
    id: `node-lineage-${project.id}-${item.id}`, type: 'text',
    position: { x: -800, y: 80 + index * 260 }, style: defaultNodeStyle('text'),
    data: { description: item.content, generatedContent: item.content, lineageManaged: true, lineageLabel: item.label,
      workshopRef: { projectId: project.id, kind: 'shot', id: item.id, role: 'prompt-reference' } },
  }));

  const ctx = {
    scenes: data.scenes,
    characters: data.characters,
    props: data.props ?? [],
    colorPalettes: data.colorPalettes ?? [],
    globalColorPaletteId: data.globalColorPaletteId,
  };
  const assetEntries = [
    ...data.characters.map((item) => ({ kind: 'character' as const, id: item.id, name: item.name, path: item.assetImagePath, prompt: item.assetPrompt, candidates: item.candidates ?? [] })),
    ...data.scenes.map((item) => ({ kind: 'scene' as const, id: item.id, name: item.name, path: item.assetImagePath, prompt: item.assetPrompt, candidates: item.candidates ?? [] })),
    ...(data.props ?? []).map((item) => ({ kind: 'prop' as const, id: item.id, name: item.name, path: item.assetImagePath, prompt: item.assetPrompt, candidates: item.candidates ?? [] })),
    ...(data.colorPalettes ?? []).filter((item) => item.source !== 'default' || item.assetImagePath || item.id === data.globalColorPaletteId || data.shots.some((shot) => shot.colorPaletteId === item.id)).map((item) => ({ kind: 'colorPalette' as const, id: item.id, name: item.name, path: item.assetImagePath, prompt: item.assetPrompt, candidates: item.candidates ?? [] })),
  ];
  const assetNodeByIdentity = new Map<string, Node>();
  const assetNodeByPath = new Map<string, Node>();
  const assetLabels = { character: '角色资产', scene: '场景资产', prop: '道具资产', colorPalette: '色卡资产' } as const;

  assetEntries.forEach((item, index) => {
    const ref = { projectId: project.id, kind: item.kind, id: item.id, role: 'asset' } satisfies WorkshopRef;
    const candidate: Node = {
      id: `node-lineage-${project.id}-asset-${item.kind}-${lineageKey(item.id)}`,
      type: 'image',
      position: { x: 60, y: 80 + index * 210 },
      style: defaultNodeStyle('image'),
      data: {
        ...(item.path ? { generatedImageUrl: convertFileSrc(item.path) } : {}),
        assetVersions: item.candidates,
        localPath: item.path,
        description: item.prompt || item.name,
        lineageManaged: true,
        lineageLabel: `${assetLabels[item.kind]} · ${item.name}`,
        lineageKind: item.kind,
        workshopRef: ref,
      },
    };
    const node = upsertNode(candidate, (existing) => {
      const existingRef = refOf(existing);
      return existingRef?.projectId === project.id && existingRef.kind === item.kind && existingRef.id === item.id && existingRef.role === 'asset';
    });
    assetNodeByIdentity.set(`${item.kind}:${item.id}`, node);
    if (item.path) assetNodeByPath.set(item.path, node);
    if (item.prompt) {
      const promptNode = upsertNode({
        id: `${candidate.id}-prompt`, type: 'text',
        position: { x: -380, y: 80 + index * 210 }, style: defaultNodeStyle('text'),
        data: { description: item.prompt, generatedContent: item.prompt, lineageManaged: true, lineageLabel: `${item.name} · 图片提示词`, workshopRef: { ...ref, role: 'prompt-reference' } },
      });
      lineageEdges.push(lineageEdge(project.id, promptNode.id, node.id, '图片提示词', 'prompt-image'));
    }
  });

  // A file is one reference asset; shot/role describes an edge, not its identity.
  const referenceByPath = new Map<string, Node>();
  const referenceUsages = new Map<string, string[]>();
  const isManagedReference = (node: Node) => node.type === 'image'
    && node.data?.lineageManaged === true && refOf(node)?.projectId === project.id
    && refOf(node)?.role === 'prompt-reference';
  const usageLabel = (binding: ShotRefBinding, shot: WsShot) => {
    const detail = binding.label.replace(/^当前镜/, '').replace(/^生成输入/, '').trim();
    return `镜头 ${shot.shotNo} · 参考图${detail ? ` · ${detail}` : ''}`;
  };

  const ensureBindingNode = (binding: ShotRefBinding, shot: WsShot, position: { x: number; y: number }, legacyPosition = position): Node => {
    const usages = referenceUsages.get(binding.path) ?? [];
    const usage = usageLabel(binding, shot);
    if (!usages.includes(usage)) usages.push(usage);
    referenceUsages.set(binding.path, usages);
    const mappedKind = binding.kind === 'palette' ? 'colorPalette' : binding.kind;
    const semantic = binding.id ? assetNodeByIdentity.get(`${mappedKind}:${binding.id}`) : undefined;
    const existingAsset = (semantic?.data.localPath === binding.path ? semantic : undefined) ?? assetNodeByPath.get(binding.path);
    if (existingAsset) { referenceByPath.set(binding.path, existingAsset); return existingAsset; }
    const cached = referenceByPath.get(binding.path);
    if (cached) return cached;
    const existing = nodes.find(node => isManagedReference(node) && node.data.localPath === binding.path);
    const identity = `reference:${binding.path}`;
    const result = upsertNode({
      id: existing?.id ?? `node-lineage-${project.id}-ref-${lineageKey(identity)}`,
      type: 'image', position, style: defaultNodeStyle('image'),
      data: {
        generatedImageUrl: convertFileSrc(binding.path), localPath: binding.path,
        description: existing?.data.description || binding.label,
        lineageManaged: true, lineageLabel: usage, lineageKind: binding.kind,
        referenceAssetKey: identity,
        workshopRef: { projectId: project.id, kind: 'shot', id: identity, role: 'prompt-reference' } satisfies WorkshopRef,
      },
    });
    // Migrate only the old automatic placement. Never move manually arranged/grouped nodes.
    if (existing && !existing.parentNode && !existing.data.referenceAssetKey
      && existing.position.x === legacyPosition.x && existing.position.y === legacyPosition.y) {
      result.position = position;
    }
    referenceByPath.set(binding.path, result);
    return result;
  };

  let rowY = 80;
  data.shots.forEach((shot) => {
    const shotKey = shotIdentity(shot);
    const frames = (shot.storyboardFrames ?? []).filter((frame) => frame.imagePath);
    const boards = (shot.storyboardBoards ?? []).filter((board) => board.imagePath);
    const contentRows = Math.max(1, Math.ceil(frames.length / 2), boards.length);
    const rowHeight = Math.max(280, contentRows * 205 + 70);
    const imageBindings = buildImageRefBindings(shot, ctx);
    const frameNodes = new Map<string, Node>();
    const boardNodes = new Map<string, Node>();

    frames.forEach((frame, index) => {
      const frameNode = upsertNode({
        id: `node-lineage-${project.id}-frame-${lineageKey(`${shotKey}:${frame.id}`)}`,
        type: 'image',
        position: { x: 420 + (index % 2) * 300, y: rowY + Math.floor(index / 2) * 205 },
        style: defaultNodeStyle('image'),
        data: {
          generatedImageUrl: convertFileSrc(frame.imagePath!),
          localPath: frame.imagePath,
          description: frame.prompt,
          lineageManaged: true,
          lineageLabel: `镜头 ${shot.shotNo} · 故事板 ${index + 1}`,
          lineageKind: 'storyboardFrame',
          workshopRef: { projectId: project.id, kind: 'storyboardFrame', id: frame.id, role: 'storyboard-frame', shotId: shotKey, shotNoSnapshot: shot.shotNo, frameId: frame.id } satisfies WorkshopRef,
        },
      });
      frameNodes.set(frame.id, frameNode);
      imageBindings.forEach((binding, bindingIndex) => {
        const source = ensureBindingNode(binding, shot, { x: 60, y: rowY + bindingIndex * 185 });
        lineageEdges.push(lineageEdge(project.id, source.id, frameNode.id, binding.label, `frame-${binding.kind}`));
      });
    });

    boards.forEach((board, index) => {
      const boardNode = upsertNode({
        id: `node-lineage-${project.id}-board-${lineageKey(`${shotKey}:${board.id}`)}`,
        type: 'image',
        position: { x: 1040, y: rowY + index * 205 },
        style: defaultNodeStyle('image'),
        data: {
          generatedImageUrl: convertFileSrc(board.imagePath),
          localPath: board.imagePath,
          description: `镜头 ${shot.shotNo} 高清故事板`,
          lineageManaged: true,
          lineageLabel: `镜头 ${shot.shotNo} · 故事板拼板 ${index + 1}`,
          lineageKind: 'storyboardBoard',
          workshopRef: { projectId: project.id, kind: 'storyboardBoard', id: board.id, role: 'storyboard-board', shotId: shotKey, shotNoSnapshot: shot.shotNo } satisfies WorkshopRef,
        },
      });
      boardNodes.set(board.id, boardNode);
      board.frameIds.forEach((frameId) => {
        const source = frameNodes.get(frameId);
        if (source) lineageEdges.push(lineageEdge(project.id, source.id, boardNode.id, '拼入故事板', 'frame-to-board'));
      });
    });

    if (shot.imagePath) {
      const shotImage = upsertNode({
        id: `node-lineage-${project.id}-shot-image-${lineageKey(shotKey)}`,
        type: 'image',
        position: { x: 1040, y: rowY + Math.max(0, boards.length) * 205 },
        style: defaultNodeStyle('image'),
        data: {
          generatedImageUrl: convertFileSrc(shot.imagePath),
          localPath: shot.imagePath,
          description: shot.imagePrompt || shot.description,
          lineageManaged: true,
          lineageLabel: `镜头 ${shot.shotNo} · 镜头图`,
          lineageKind: 'shotImage',
          workshopRef: { projectId: project.id, kind: 'shot', id: shot.shotNo, role: 'shot-image', shotId: shotKey, shotNoSnapshot: shot.shotNo } satisfies WorkshopRef,
        },
      }, (existing) => {
        const existingRef = refOf(existing);
        return existingRef?.projectId === project.id && existingRef.kind === 'shot' && existingRef.role === 'shot-image' && (existingRef.shotId === shotKey || existingRef.id === shot.shotNo);
      });
      imageBindings.forEach((binding, bindingIndex) => {
        const source = ensureBindingNode(binding, shot, { x: 60, y: rowY + bindingIndex * 185 });
        lineageEdges.push(lineageEdge(project.id, source.id, shotImage.id, binding.label, `shot-image-${binding.kind}`));
      });
    }

    const latestCandidate = [...(shot.videoCandidates ?? [])].sort((a, b) => b.createdAt - a.createdAt)[0];
    // Unadopted candidates are previews, never production bindings. Project the
    // media and its frozen input receipt together instead of retaining stale media.
    const displayedVideoPath = shot.videoPath || latestCandidate?.path;
    const submitted = shot.videoCandidates?.find(candidate => candidate.path === displayedVideoPath)?.productionPacket;
    if (activeVideoPrompt(shot, data) || displayedVideoPath) {
      const videoNode = upsertNode({
        id: `node-lineage-${project.id}-shot-video-${lineageKey(shotKey)}`,
        type: 'video',
        position: { x: 1400, y: rowY },
        style: defaultNodeStyle('video'),
        data: {
          assetVersions: shot.videoCandidates ?? [],
          description: submitted?.prompt || activeVideoPrompt(shot, data) || shot.description,
          generatedVideoUrl: displayedVideoPath ? convertFileSrc(displayedVideoPath) : undefined,
          localPath: displayedVideoPath,
          imageUrl: shot.videoPath && shot.videoThumbPath ? convertFileSrc(shot.videoThumbPath) : undefined,
          lineageManaged: true,
          lineageLabel: `镜头 ${shot.shotNo} · 视频`,
          lineageKind: 'shotVideo',
          workshopRef: { projectId: project.id, kind: 'shot', id: shot.shotNo, role: 'shot-video', shotId: shotKey, shotNoSnapshot: shot.shotNo } satisfies WorkshopRef,
        },
      }, (existing) => {
        const existingRef = refOf(existing);
        return existingRef?.projectId === project.id && existingRef.kind === 'shot' && existingRef.role === 'shot-video' && (existingRef.shotId === shotKey || existingRef.id === shot.shotNo);
      });
      videoNode.data.adoptedVersionPath = shot.videoPath;
      videoNode.data.lineageLabel = `镜头 ${shot.shotNo} · ${shot.videoPath ? '视频' : displayedVideoPath ? '视频候选（未采用）' : '视频'}`;
      const promptNode = upsertNode({
        id: `node-lineage-${project.id}-shot-prompt-${lineageKey(shotKey)}`, type: 'text',
        position: { x: 1050, y: rowY }, style: defaultNodeStyle('text'),
        data: { description: submitted?.prompt || activeVideoPrompt(shot, data) || shot.description, generatedContent: submitted?.prompt || activeVideoPrompt(shot, data) || shot.description, lineageManaged: true, lineageLabel: `镜头 ${shot.shotNo} · 视频提示词`, workshopRef: { projectId: project.id, kind: 'shot', id: shotKey, role: 'prompt-reference' } },
      });
      lineageEdges.push(lineageEdge(project.id, promptNode.id, videoNode.id, '视频提示词', 'prompt-video'));
      // Frozen submission inputs are authoritative, including extracted tails.
      // Never hide an actual reference based on its label or filename.
      const videoBindings: ShotRefBinding[] = (submitted
        ? submitted.referencePaths.map((path, index) => ({ index: index + 1, kind: 'extra' as const, path, label: submitted.referenceLabels?.[index] || `生成输入 ${index + 1}` }))
        : buildVideoRefBindings(shot, ctx))
        .map((binding, index) => ({ ...binding, index: index + 1 }));
      videoBindings.forEach((binding, bindingIndex) => {
        const source = binding.kind === 'storyboardBoard' && binding.id
          ? boardNodes.get(binding.id) ?? ensureBindingNode(binding, shot, { x: 1040, y: rowY + bindingIndex * 205 })
          : ensureBindingNode(binding, shot, { x: videoNode.position.x - 680, y: videoNode.position.y + bindingIndex * 185 }, { x: 60, y: rowY + bindingIndex * 185 });
        lineageEdges.push(lineageEdge(project.id, source.id, videoNode.id, usageLabel(binding, shot), `video-${binding.kind}-${binding.index}`));
      });
    }

    rowY += rowHeight + 90;
  });

  // Rebuild upstream lineage from saved receipts, not current shot order or filenames.
  const records = collectMediaProvenance(data.shots, [
    ...ledger, ...originalNodes.flatMap(node => Array.isArray(node.data?.mediaProvenance) ? node.data.mediaProvenance : []),
    // Use frozen successful candidate receipts, never the current editable refs.
    ...assetEntries.flatMap(asset => asset.candidates.flatMap(candidate =>
      candidate.productionPacket?.referencePaths.map(sourcePath => ({sourcePath, outputPath:candidate.path,
        operation:'image-reference', evidence:`candidate:${candidate.candidateId || candidate.path}`})) ?? [])),
  ]);
  const provenanceNode = (path: string, type: 'image' | 'video', near?: Node): Node => {
    const existing = nodes.find(n => n.type === type && n.data.localPath === path);
    if (existing) { desiredIds.add(existing.id); return existing; }
    const made = upsertNode({ id: `node-lineage-${project.id}-origin-${lineageKey(path)}`, type,
      position: {x:(near?.position.x ?? 720)-340,y:near?.position.y ?? 80}, style:defaultNodeStyle(type),
      data: {localPath:path, ...(type === 'video' ? {generatedVideoUrl:convertFileSrc(path)} : {generatedImageUrl:convertFileSrc(path)}),
        lineageManaged:true,lineageLabel:type === 'video' ? '来源视频 · 原始版本' : '来源图片',
        workshopRef:{projectId:project.id,kind:'shot',id:`origin:${path}`,role:'prompt-reference'} satisfies WorkshopRef},
    });
    if (type === 'image') referenceByPath.set(path, made);
    return made;
  };
  // Include ancestor records recursively; never put unrelated ledger entries on this canvas.
  const needed = new Set(nodes.map(n => n.data.localPath).filter(Boolean));
  const relevant = new Set<number>();
  for (let changed = true; changed;) {
    changed = false;
    records.forEach((record, index) => {
      if (needed.has(record.outputPath) && !relevant.has(index)) {
        relevant.add(index); needed.add(record.sourcePath); changed = true;
      }
      // Accepted-video extraction is also a deliverable even before the next shot consumes it.
      if (record.operation === 'extract' && needed.has(record.sourcePath) && !relevant.has(index)) {
        relevant.add(index); needed.add(record.outputPath); changed = true;
      }
    });
  }
  for (const index of [...relevant].sort((a, b) => a - b)) {
    const record = records[index];
    const output = provenanceNode(record.outputPath, 'image');
    const source = provenanceNode(record.sourcePath, record.operation === 'extract' ? 'video' : 'image', output);
    const sourceShot = record.operation === 'extract' ? data.shots.find(shot => shot.videoPath === record.sourcePath) : undefined;
    if (record.operation === 'extract') {
      // A captured frame is an output to the right of its exact video version.
      // Never relocate a user-arranged existing capture during subsequent syncs.
      if (!originalNodes.some(node => node.id === output.id)) {
        output.position = {x:source.position.x + Number(source.style?.width || source.width || 320) + 100,y:source.position.y};
      }
      output.data = {...output.data, lineageLabel: `${sourceShot ? `镜头 ${sourceShot.shotNo}` : '来源视频'} · ${record.position === 'last' ? '成片实际末帧' : '实际抽帧'}`,
        mediaRole:'extracted-frame'};
      nodes = nodes.map(node => node.id === output.id ? output : node);
    }
    const edge = lineageEdge(project.id, source.id, output.id, provenanceLabel(record), `provenance-${record.operation}`);
    edge.data = {...edge.data, relation:'provenance', mediaProvenance:record};
    lineageEdges.push(edge);
    nodes = nodes.map(n => n.id === output.id ? {...n,data:{...n.data,provenanceStatus:'verified',provenanceLabel:provenanceLabel(record)}} : n);
  }
  nodes = nodes.map(node => {
    if (node.type !== 'image' || !isManagedReference(node)) return node;
    const label = String(node.data.lineageLabel ?? '');
    // Migrate the old canvas-only name without touching the underlying file,
    // version history, or production packet.
    if (/生成输入首帧/.test(label)) {
      return { ...node, data: { ...node.data, lineageLabel: label.replace(/生成输入首帧/g, '参考图 · 首帧') } };
    }
    return node;
  });
  nodes = nodes.map(node => node.type === 'image' && isManagedReference(node)
    && !records.some(r => r.outputPath === node.data.localPath)
    ? {...node,data:{...node.data,provenanceStatus:'unknown',provenanceLabel:'来源待核实'}} : node);

  nodes = nodes.filter((node) => {
    const nodeData = node.data as Record<string, unknown> | undefined;
    const ref = refOf(node);
    // Keep obsolete real results and their version history; only remove empty projections.
    return !(nodeData?.lineageManaged && ref?.projectId === project.id && !desiredIds.has(node.id) && !(nodeData.assetVersions as unknown[] | undefined)?.length && !nodeData.localPath);
  });
  const obsoletePromptRefIds = new Set(nodes
    .filter((node) => {
      const nodeData = node.data as Record<string, unknown> | undefined;
      const ref = refOf(node);
      return Boolean(nodeData?.workshopPromptRefTarget)
        && ref?.projectId === project.id
        && nodeData?.lineageManaged !== true;
    })
    .map((node) => node.id));
  nodes = nodes.filter((node) => !obsoletePromptRefIds.has(node.id));

  // Consolidate legacy per-shot copies, preserving history and every user-authored edge.
  const aliases = new Map<string, string>();
  for (const [path, canonical] of referenceByPath) {
    const duplicates = nodes.filter(node => node.id !== canonical.id && isManagedReference(node) && node.data.localPath === path);
    let versions = canonical.data.assetVersions as CanvasAssetVersion[] ?? [];
    const history = new Map<string, { url: string; timestamp: number }>();
    for (const node of [canonical, ...duplicates]) {
      versions = mergeCanvasVersions(versions, node.data.assetVersions ?? [], path);
      for (const version of node.data.generationHistory ?? []) history.set(version.url, version);
      if (node.id !== canonical.id) aliases.set(node.id, canonical.id);
    }
    for (const version of versions) {
      const url = convertFileSrc(version.path);
      if (!history.has(url)) history.set(url, { url, timestamp: version.createdAt });
    }
    const usages = referenceUsages.get(path) ?? [];
    const mergedData = { ...(nodes.find(n => n.id === canonical.id)?.data ?? canonical.data), assetVersions: versions,
      generationHistory: [...history.values()].sort((a, b) => a.timestamp - b.timestamp),
      referenceUsages: usages,
      ...(isManagedReference(canonical) && usages.length ? { lineageLabel: usages.join(' / ') } : {}),
    };
    nodes = nodes.map(node => node.id === canonical.id ? { ...node, data: mergedData } : node);
  }
  nodes = nodes.filter(node => !aliases.has(node.id));
  const remapEdge = (edge: Edge): Edge => ({ ...edge,
    source: aliases.get(edge.source) ?? edge.source, target: aliases.get(edge.target) ?? edge.target });

  const otherEdges = store.edges.filter((edge) => {
    const receipt = edge.data?.mediaProvenance;
    if (edge.data?.relation === 'provenance' && receipt && lineageEdges.some(e =>
      e.data?.relation === 'provenance' && e.data.mediaProvenance?.sourcePath === receipt.sourcePath
      && e.data.mediaProvenance?.outputPath === receipt.outputPath)) return false;
    if ((edge.data as Record<string, unknown> | undefined)?.lineage && originalNodes.some((n) => n.id === edge.target && refOf(n)?.projectId === project.id)) return false;
    return !obsoletePromptRefIds.has(edge.source) && !obsoletePromptRefIds.has(edge.target);
  });
  store.setNodes(nodes);
  const edgeIds = new Set<string>();
  const validIds = new Set(nodes.map(node => node.id));
  store.setEdges([...otherEdges, ...lineageEdges].map(remapEdge).filter(edge => {
    if (edgeIds.has(edge.id) || !validIds.has(edge.source) || !validIds.has(edge.target)) return false;
    edgeIds.add(edge.id); return true;
  }));
  if (store.selectedNodeId && aliases.has(store.selectedNodeId)) store.setSelectedNodeId(aliases.get(store.selectedNodeId)!);
  await useProjectStore.getState().flushActiveCanvas();
  return `血缘图已同步：${desiredIds.size} 个节点，${lineageEdges.length} 条来源关系`;
}

/**
 * 按项目展示真实视频生产链：全局资产 → 镜头提示词 → 视频。
 * 一个资产只创建一个节点，多个镜头通过血缘线复用该节点。
 */
export async function syncWorkshopShotLanesToCanvas(): Promise<string> {
  const { project, data } = useWorkshopStore.getState();
  if (!project || !data) return '没有打开的工坊项目';
  const store = useCanvasStore.getState();
  const ctx = {
    scenes: data.scenes,
    characters: data.characters,
    props: data.props ?? [],
    colorPalettes: data.colorPalettes ?? [],
    globalColorPaletteId: data.globalColorPaletteId,
  };
  const existing = store.nodes;
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const laneX = { source: 60, prompt: 800, video: 1280 };
  const sourceNodeByKey = new Map<string, Node>();
  const sourceNodeByPath = new Map<string, Node>();
  const sourceLabels = { character: '角色', scene: '场景', prop: '道具', palette: '色卡', extra: '额外参考', storyboardBoard: '故事板', directorConstraintCard: '约束卡' } as const;
  const canonicalVideoByShot = new Map<string, Node>();
  const duplicateVideoIds = new Set<string>();
  for (const shot of data.shots) {
    const shotKey = shotIdentity(shot);
    const shotVideoUrl = shot.videoPath ? convertFileSrc(shot.videoPath) : undefined;
    const candidates = existing.filter((node) => {
      const ref = refOf(node);
      const nodeData = node.data as Record<string, unknown> | undefined;
      const matchesRef = ref?.projectId === project.id
        && ref.kind === 'shot'
        && ref.role === 'shot-video'
        && (ref.shotId === shotKey || ref.id === shot.shotNo);
      const matchesImportedNode = node.type === 'video'
        && node.id === `node-ws-${project.id}-${shot.shotNo}`;
      const matchesVideoPath = node.type === 'video'
        && Boolean(shot.videoPath)
        && (nodeData?.localPath === shot.videoPath || nodeData?.generatedVideoUrl === shotVideoUrl);
      return matchesRef || matchesImportedNode || matchesVideoPath;
    });
    const preferred = candidates.find((node) => {
      const nodeData = node.data as Record<string, unknown> | undefined;
      return nodeData?.lineageManaged !== true && Boolean(nodeData?.localPath || nodeData?.generatedVideoUrl);
    }) ?? candidates.find((node) => {
      const nodeData = node.data as Record<string, unknown> | undefined;
      return Boolean(nodeData?.localPath || nodeData?.generatedVideoUrl);
    }) ?? candidates.find((node) => (node.data as Record<string, unknown> | undefined)?.lineageManaged !== true)
      ?? candidates[0];
    if (!preferred) continue;
    canonicalVideoByShot.set(shotKey, preferred);
    candidates.forEach((node) => {
      if (node.id !== preferred.id) duplicateVideoIds.add(node.id);
    });
  }
  const addNode = (candidate: Node): Node => {
    const previous = existing.find((node) => node.id === candidate.id);
    const node = previous
      ? {
          ...candidate,
          ...previous,
          position: candidate.position,
          parentNode: undefined,
          extent: undefined,
          expandParent: false,
          draggable: true,
          data: { ...(previous.data as Record<string, unknown>), ...(candidate.data as Record<string, unknown>) },
        }
      : { ...candidate, draggable: true };
    nodes.push(node);
    return node;
  };
  const addEdge = (source: Node, target: Node, relation: string, label: string) => {
    edges.push(lineageEdge(project.id, source.id, target.id, label, relation, edges.length));
  };
  const nodeId = (lane: string, id: string) => `node-lane-${project.id}-${lane}-${lineageKey(id)}`;
  const labels = { character: '角色', scene: '场景', prop: '道具', palette: '色卡', extra: '额外参考', storyboardBoard: '故事板', directorConstraintCard: '约束卡' } as const;

  let sourceIndex = 0;
  const addSource = (binding: ShotRefBinding, sourceKey: string, role: WorkshopRef['role'] = 'prompt-reference'): Node => {
    const existingSource = sourceNodeByKey.get(sourceKey) ?? sourceNodeByPath.get(binding.path);
    if (existingSource) return existingSource;
    const kind = binding.kind === 'palette' ? 'palette' : binding.kind;
    const refKind: WorkshopRef['kind'] = binding.kind === 'storyboardBoard' ? 'storyboardBoard'
      : binding.kind === 'directorConstraintCard' ? 'directorConstraintCard'
        : kind === 'palette' ? 'colorPalette'
          : kind === 'scene' || kind === 'character' || kind === 'prop' ? kind : 'shot';
    const node = addNode({
      id: nodeId('source', sourceKey), type: 'image', position: { x: laneX.source, y: 70 + sourceIndex * 190 },
      style: defaultNodeStyle('image'),
      data: {
        generatedImageUrl: convertFileSrc(binding.path), localPath: binding.path,
        description: binding.label, lineageManaged: true,
        lineageSourceIndex: sourceIndex,
        lineageLabel: `${sourceLabels[kind as keyof typeof sourceLabels] || '参考'} · ${binding.label}`,
        lineageKind: binding.kind,
        workshopRef: {
          projectId: project.id, kind: refKind, id: binding.id ?? sourceKey, role,
        } satisfies WorkshopRef,
      },
    });
    sourceIndex++;
    sourceNodeByKey.set(sourceKey, node);
    sourceNodeByPath.set(binding.path, node);
    return node;
  };

  const projectAssets: ShotRefBinding[] = [
    ...data.characters.filter((item) => item.assetImagePath).map((item) => ({ index: 0, kind: 'character' as const, label: `角色 ${item.name ?? item.id}`, path: item.assetImagePath!, id: item.id })),
    ...data.scenes.filter((item) => item.assetImagePath).map((item) => ({ index: 0, kind: 'scene' as const, label: `场景 ${item.name ?? item.id}`, path: item.assetImagePath!, id: item.id })),
    ...(data.props ?? []).filter((item) => item.assetImagePath).map((item) => ({ index: 0, kind: 'prop' as const, label: `道具 ${item.name ?? item.id}`, path: item.assetImagePath!, id: item.id })),
    ...(data.colorPalettes ?? []).filter((item) => item.assetImagePath).map((item) => ({ index: 0, kind: 'palette' as const, label: `色卡 ${item.name ?? item.id}`, path: item.assetImagePath!, id: item.id })),
  ];
  projectAssets.forEach((binding) => addSource(binding, `${binding.kind}:${binding.id}`, 'asset'));

  let laneY = 70;
  let laneCount = 0;
  for (const shot of data.shots) {
    const shotKey = shotIdentity(shot);
    const bindings = buildVideoRefBindings(shot, ctx, {
      includeStoryboardBoards: false,
      includeDirectorConstraintCard: false,
    });
    const uniqueBindings = bindings.filter((binding, index, all) => all.findIndex((item) => item.path === binding.path) === index);
    const promptText = activeVideoPrompt(shot, data) || shot.description;
    const promptHeight = Math.min(300, Math.max(180, 130 + Math.ceil(promptText.length / 52) * 22));
    const laneHeight = Math.max(250, promptHeight + 70);
    const prompt = addNode({
      id: nodeId('prompt', shotKey), type: 'text', position: { x: laneX.prompt, y: laneY },
      style: { width: 320, height: promptHeight },
      data: {
        description: promptText,
        generatedContent: promptText,
        lineageManaged: true, lineageLabel: `镜头 ${shot.shotNo} · 提示词`, lineageKind: 'shotPrompt',
        workshopRef: { projectId: project.id, kind: 'shot', id: shot.shotNo, role: 'asset', shotId: shotKey, shotNoSnapshot: shot.shotNo } satisfies WorkshopRef,
      },
    });

    uniqueBindings.forEach((binding) => {
      const kind = binding.kind === 'palette' ? 'palette' : binding.kind;
      const sourceKey = binding.id ? `${kind}:${binding.id}` : `${kind}:${binding.path}`;
      const source = addSource(binding, sourceKey);
      addEdge(source, prompt, `asset-${binding.kind}`, labels[kind as keyof typeof labels] || '参考');
    });

    if (activeVideoPrompt(shot, data) || shot.videoPath) {
      const existingShotVideo = canonicalVideoByShot.get(shotKey);
      const video = addNode({
        id: existingShotVideo?.id || nodeId('video', shotKey), type: 'video', position: { x: laneX.video, y: laneY }, style: defaultNodeStyle('video'),
        data: { description: activeVideoPrompt(shot, data) || shot.description, ...(shot.videoPath ? { generatedVideoUrl: convertFileSrc(shot.videoPath), localPath: shot.videoPath } : {}), lineageManaged: true, lineageLabel: `镜头 ${shot.shotNo} · 最终视频`, lineageKind: 'shotVideo', workshopRef: { projectId: project.id, kind: 'shot', id: shot.shotNo, role: 'shot-video', shotId: shotKey, shotNoSnapshot: shot.shotNo } satisfies WorkshopRef },
      });
      addEdge(prompt, video, 'prompt-to-video', '资产参考生成视频');
    }
    laneY += laneHeight + 80;
    laneCount++;
  }

  const videoNodes = nodes.filter((node) => (
    (node.data as Record<string, unknown> | undefined)?.lineageKind === 'shotVideo'
  ));
  const sourceNodes = [...sourceNodeByKey.values()];
  if (videoNodes.length > 0 && sourceNodes.length > 0) {
    const videoTop = Math.min(...videoNodes.map((node) => node.position.y));
    const videoBottom = Math.max(...videoNodes.map((node) => node.position.y + 180));
    const videoCenter = (videoTop + videoBottom) / 2;
    const sourceBlockHeight = (sourceNodes.length - 1) * 190 + 160;
    const sourceTop = videoCenter - sourceBlockHeight / 2;
    const sourceIndexById = new Map(sourceNodes.map((node, index) => [node.id, index]));
    nodes.forEach((node) => {
      const index = sourceIndexById.get(node.id);
      if (index !== undefined) node.position = { ...node.position, y: sourceTop + index * 190 };
    });
  }

  const syncedNodes = nodes.map((node) => ({ ...node, selected: false }));
  const syncedNodeIds = new Set(syncedNodes.map((node) => node.id));
  const preservedNodes = existing.filter((node) => {
    const nodeData = node.data as Record<string, unknown> | undefined;
    const ref = refOf(node);
    if (duplicateVideoIds.has(node.id)) return false;
    if (syncedNodeIds.has(node.id)) return false;
    return !(nodeData?.lineageManaged === true && ref?.projectId === project.id);
  });
  const nonLineageEdges = store.edges.filter((edge) => {
    if ((edge.data as Record<string, unknown> | undefined)?.lineage) return false;
    if (duplicateVideoIds.has(edge.source) || duplicateVideoIds.has(edge.target)) return false;
    return !syncedNodeIds.has(edge.source) && !syncedNodeIds.has(edge.target);
  });
  store.setNodes([...preservedNodes.map((node) => ({ ...node, selected: false })), ...syncedNodes]);
  store.setEdges([...nonLineageEdges, ...edges.filter((edge) => !duplicateVideoIds.has(edge.source) && !duplicateVideoIds.has(edge.target))]);
  await useProjectStore.getState().flushActiveCanvas();
  return `镜头泳道已同步：${laneCount} 个镜头，${nodes.length} 个节点，${edges.length} 条关系`;
}

/** 画布 → 工坊：拉取带 workshopRef 的节点变化（画布零污染，工坊端主动）。 */
export async function pullFromCanvas(): Promise<string> {
  const { project, data } = useWorkshopStore.getState();
  if (!project || !data) return '没有打开的工坊项目';
  const ws = useWorkshopStore.getState();
  const nodes = useCanvasStore.getState().nodes;

  let newCandidates = 0;
  let videosPulled = 0;
  let promptsPulled = 0;
  let voicesPulled = 0;

  for (const node of nodes) {
    const ref = refOf(node);
    if (!ref || ref.projectId !== project.id) continue;
    const d = node.data as Record<string, unknown>;

    if (ref.role === 'asset' && (ref.kind === 'character' || ref.kind === 'scene' || ref.kind === 'prop' || ref.kind === 'colorPalette')) {
      const localPath = d.localPath as string | undefined;
      if (!localPath) continue;
      const item = ref.kind === 'character'
        ? ws.data!.characters.find((c) => c.id === ref.id)
        : ref.kind === 'scene'
          ? ws.data!.scenes.find((s) => s.id === ref.id)
          : ref.kind === 'colorPalette'
            ? (ws.data!.colorPalettes ?? []).find((p) => p.id === ref.id)
            : (ws.data!.props ?? []).find((p) => p.id === ref.id);
      if (!item) continue;
      const known = (item.candidates ?? []).some((c) => c.path === localPath)
        || item.assetImagePath === localPath;
      if (known) continue;
      // 画布上改过的图 → 拷入项目 assets/ 进候选集（不自动替换最终图）
      try {
        const dest = await copyToAssets(project.id, localPath, `${ref.kind}-${ref.id.replace(/[^\w-]+/g, '_')}-cv-${Date.now()}`);
        ws.addAssetCandidate(ref.kind, ref.id, {
          path: dest, source: 'canvas', prompt: d.description as string | undefined, createdAt: Date.now(),
        }, false);
        newCandidates++;
      } catch (err) {
        console.warn('[canvasSync] 拉取资产失败:', err);
      }
    }

    if (ref.role === 'shot-image' && ref.kind === 'shot') {
      const shot = ws.data!.shots.find((s) => s.shotNo === ref.id);
      if (!shot) continue;
      const localPath = d.localPath as string | undefined;
      if (!localPath) continue;
      // 画布上生成分镜图后回传 → 写 shot.imagePath 作为分镜图/封面产物；
      // 不再作为视频参考资产传入，视频参考由高清故事板和显式参考图控制。
      if (localPath !== shot.imagePath) {
        try {
          const dest = await copyToShots(project.id, localPath, `${ref.id.replace(/[^\w-]+/g, '_')}-img-${Date.now()}`);
          ws.updateShot(ref.id, { imagePath: dest });
        } catch (err) {
          console.warn('[canvasSync] 拉取分镜图失败:', err);
        }
      }
    }

    if (ref.role === 'shot-video' && ref.kind === 'shot') {
      const shot = ws.data!.shots.find((s) => s.shotNo === ref.id);
      if (!shot) continue;
      const localPath = d.localPath as string | undefined;
      const desc = d.description as string | undefined;
      // 视频回流。被用户删除的源路径必须保持墓碑状态，否则画布节点仍存在时，
      // 下一次同步会复制成带新时间戳的路径并再次出现在候选列表。
      const canvasCandidateId = `video-${shot.id}-canvas-${node.id}`;
      const canvasCandidateDeleted = Boolean(localPath) && Boolean(
        shot.deletedVideoCandidatePaths?.includes(localPath!)
        || shot.deletedVideoCandidateIds?.includes(canvasCandidateId)
        || shot.deletedVideoCandidateNodeIds?.includes(node.id)
      );
      if (localPath && localPath !== shot.videoPath && !canvasCandidateDeleted) {
        try {
          const dest = await copyToShots(project.id, localPath, `${ref.id.replace(/[^\w-]+/g, '_')}-cv-${Date.now()}`);
          const candidate = {
            candidateId: canvasCandidateId,
            path: dest,
            source: 'canvas' as const,
            engineId: 'canvas',
            prompt: desc,
            originNodeId: node.id,
            inputFingerprint: videoInputFingerprint({
              engineId: 'canvas',
              prompt: desc ?? '',
              referencePaths: [],
              videoPaths: [],
              params: { importedFromCanvas: true },
            }),
            createdAt: Date.now(),
          };
          ws.updateShot(ref.id, {
            videoCandidates: [...(shot.videoCandidates ?? []).filter((item) => item.path !== dest), candidate],
            genStatus: 'done',
            genProgress: '画布视频已回流为候选，等待评审采用',
          });
          videosPulled++;
        } catch (err) {
          console.warn('[canvasSync] 拉取视频失败:', err);
        }
      }
      // 提示词回传
      const nodeTemplate = d.videoPromptTemplate === 'legacy' || d.videoPromptTemplate === 'universal'
        ? d.videoPromptTemplate
        : activePromptTemplate(shot, ws.data!);
      const currentPrompt = nodeTemplate === 'universal'
        ? shot.universalVideoPrompt || shot.seedance25VideoPrompt
        : shot.videoPrompt;
      if (desc && desc !== currentPrompt) {
        ws.updateShot(ref.id, nodeTemplate === 'universal' ? { universalVideoPrompt: desc } : { videoPrompt: desc });
        promptsPulled++;
      }
    }
  }

  // 音频节点 → 角色音色：扫描所有 audio 节点，通过 edge 找到连接的角色资产节点
  const edges = useCanvasStore.getState().edges;
  for (const node of nodes) {
    if (node.type !== 'audio') continue;
    const d = node.data as Record<string, unknown>;
    const localPath = d.localPath as string | undefined;
    if (!localPath) continue;
    // 找与此 audio 节点通过 edge 相连的角色资产节点
    const connectedIds = edges
      .filter((e) => e.source === node.id || e.target === node.id)
      .map((e) => e.source === node.id ? e.target : e.source);
    for (const connId of connectedIds) {
      const connNode = nodes.find((n) => n.id === connId);
      if (!connNode) continue;
      const connRef = refOf(connNode);
      if (!connRef || connRef.projectId !== project.id || connRef.kind !== 'character' || connRef.role !== 'asset') continue;
      const char = useWorkshopStore.getState().data!.characters.find((c) => c.id === connRef.id);
      if (!char || char.voicePath === localPath) continue;
      try {
        const ext = localPath.includes('.') ? localPath.slice(localPath.lastIndexOf('.')) : '.mp3';
        const relDir = `.gdream/aigc-memory/projects/${project.id}/assets/voices`;
        await createDir(relDir, { dir: BaseDirectory.Home, recursive: true }).catch(() => {});
        const rel = `${relDir}/${connRef.id.replace(/[^\w-]+/g, '_')}-cv${ext}`;
        await copyFile(localPath, rel, { dir: BaseDirectory.Home });
        const home = await homeDir();
        useWorkshopStore.getState().setCharacterVoice(connRef.id, `${home}${rel}`, 'canvas');
        voicesPulled++;
      } catch (err) {
        console.warn('[canvasSync] 拉取音色失败:', err);
      }
    }
  }

  if (newCandidates + videosPulled + promptsPulled + voicesPulled === 0) return '画布没有新的变化';
  return `已拉取：${newCandidates} 张新候选图（在候选集中手选启用）、${videosPulled} 段视频、${promptsPulled} 条提示词更新${voicesPulled > 0 ? `、${voicesPulled} 个音色` : ''}`;
}
