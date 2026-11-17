import type { Edge, Node } from 'reactflow';

const GAP = 20;
const REGION_GAP = 28;
const RESEARCH_PREFIX = 'ad-research-';

type NodeData = Record<string, unknown>;

function dataOf(node: Node): NodeData {
  return (node.data ?? {}) as NodeData;
}

function size(node: Node) {
  return {
    width: Math.max(Number(node.style?.width) || 0, node.width || 0, 280),
    height: Math.max(Number(node.style?.height) || 0, node.height || 0, 160),
  };
}

function refOf(node: Node): NodeData {
  return (dataOf(node).workshopRef ?? {}) as NodeData;
}

function labelOf(node: Node): string {
  const data = dataOf(node);
  return String(data.lineageLabel ?? data.title ?? data.description ?? '');
}

function isResearch(node: Node): boolean {
  const data = dataOf(node);
  return node.id.startsWith(RESEARCH_PREFIX) || Boolean(data.adResearchProjectId || data.adResearchStatus);
}

function isVideo(node: Node): boolean {
  return node.type === 'video' || refOf(node).role === 'shot-video' || dataOf(node).lineageKind === 'shotVideo';
}

function isVideoPrompt(node: Node, videoPromptIds?: Set<string>): boolean {
  if (node.type !== 'text' || isResearch(node)) return false;
  const ref = refOf(node);
  const label = labelOf(node);
  return /视频提示词|视频 prompt|video prompt/i.test(label)
    || (ref.role === 'prompt-reference' && ref.kind === 'shot' && (dataOf(node).lineageKind === 'shotPrompt' || /视频提示词|video prompt/i.test(label)))
    || Boolean(videoPromptIds?.has(node.id));
}

function isImagePrompt(node: Node, imagePromptIds?: Set<string>): boolean {
  if (node.type !== 'text' || isResearch(node) || isVideoPrompt(node)) return false;
  const ref = refOf(node);
  const label = labelOf(node);
  return /图片提示词|图像提示词|image prompt/i.test(label)
    || (ref.role === 'prompt-reference' && ['scene', 'prop', 'character', 'colorPalette'].includes(String(ref.kind)))
    || Boolean(imagePromptIds?.has(node.id));
}

function hasExplicitAssetIdentity(node: Node): boolean {
  const ref = refOf(node);
  const kind = String(dataOf(node).lineageKind ?? ref.kind ?? '');
  return ref.role === 'asset' || ['scene', 'prop', 'character', 'colorPalette', 'palette'].includes(kind);
}

function isBaseAsset(node: Node, edges: Edge[] = [], ids: Set<string> = new Set()): boolean {
  if (node.type !== 'image' || isResearch(node)) return false;
  if (hasExplicitAssetIdentity(node)) return true;
  // Backward-compatible fallback for ordinary image nodes: unless their
  // provenance or a direct video-input edge says otherwise, they are base
  // assets. This keeps untyped user-created images visible in the asset lane.
  return provenanceEdgesFor(node, edges, ids).length === 0
    && dataOf(node).provenanceStatus !== 'verified'
    && !/合成首帧|生成输入|衍生|镜头图|derived|first frame/i.test(labelOf(node));
}

function provenanceEdgesFor(node: Node, edges: Edge[], ids: Set<string>): Edge[] {
  return edges.filter((edge) => edge.target === node.id && ids.has(edge.source)
    && (edge.data?.relation === 'provenance' || String(edge.data?.lineageRelation ?? '').startsWith('provenance-')));
}

function isExtractedTail(node: Node, edges: Edge[], ids: Set<string>, byIdForClassification: Map<string, Node> = new Map()): boolean {
  const data = dataOf(node);
  if (data.mediaRole === 'extracted-frame' || labelOf(node).includes('成片实际末帧')) return true;
  return provenanceEdgesFor(node, edges, ids).some((edge) => {
    const record = edge.data?.mediaProvenance as NodeData | undefined;
    return record?.operation === 'extract'
      || String(edge.data?.lineageRelation ?? '').includes('extract')
      || Boolean(byIdForClassification.get(edge.source) && isVideo(byIdForClassification.get(edge.source)!));
  });
}

/**
 * A generated/edited image is a derived image when its provenance is explicit.
 * Never infer this from filename, similarity, or canvas position: an unconnected
 * image remains a base asset candidate and is kept in the asset column.
 */
function isDerivedImage(node: Node, edges: Edge[], ids: Set<string>, byIdForClassification: Map<string, Node>): boolean {
  if (node.type !== 'image' || isResearch(node) || hasExplicitAssetIdentity(node)) return false;
  if (isExtractedTail(node, edges, ids, byIdForClassification)) return false;
  const label = labelOf(node);
  const ref = refOf(node);
  const isShotSpecificReference = ref.role === 'prompt-reference' && ref.kind === 'shot';
  return isShotSpecificReference
    || provenanceEdgesFor(node, edges, ids).length > 0
    || /合成首帧|生成输入|参考图|衍生|镜头图|derived|first frame|reference image/i.test(label)
    || dataOf(node).provenanceStatus === 'verified';
}

function shotNo(node: Node): string {
  const ref = refOf(node);
  return String(ref.shotNoSnapshot || ref.shotId || ref.id || labelOf(node) || node.id);
}

function edgeIsProvenance(edge: Edge): boolean {
  return edge.data?.relation === 'provenance' || String(edge.data?.lineageRelation ?? '').startsWith('provenance-');
}

function isSecondaryVideoInput(edge: Edge): boolean {
  const relation = String(edge.data?.lineageRelation ?? '');
  const label = String(edge.data?.lineageLabel ?? '');
  return relation === 'video-extra-2' || /生成输入尾帧/.test(label);
}

function isPrimaryDerivedForVideo(node: Node, video: Node): boolean {
  const shot = shotNo(video);
  const label = labelOf(node);
  return label.includes(`镜头 ${shot} ·`)
    && /(?:生成输入首帧|参考图)/.test(label)
    && !/(?:生成输入尾帧|收尾帧|末帧)/.test(label);
}

function maxHeight(nodes: Node[], fallback = 280): number {
  return Math.max(fallback, ...nodes.map((node) => size(node).height));
}

/**
 * Production-oriented canvas layout. Position only: content, versions,
 * provenance records and edges are never mutated.
 *
 * The horizontal order is intentional and mirrors the production flow:
 * research/planning → image prompt → base asset → shot reference →
 * video prompt → video → extracted frame. A tail frame is an output only;
 * it is never treated as an active H3 input.
 */
export function arrangeCanvasNodes(nodes: Node[], edges: Edge[], selectedOnly = false): Node[] {
  const movable = nodes.filter((node) => !node.parentNode && !node.hidden && (!selectedOnly || node.selected));
  if (!movable.length) return nodes;

  const ids = new Set(movable.map((node) => node.id));
  const byId = new Map(movable.map((node) => [node.id, node]));
  const incoming = (id: string) => edges.filter((edge) => edge.target === id && ids.has(edge.source));
  const outgoing = (id: string) => edges.filter((edge) => edge.source === id && ids.has(edge.target));
  const positions = new Map<string, { x: number; y: number }>();
  const placed = new Set<string>();
  const place = (node: Node, x: number, y: number) => {
    if (placed.has(node.id)) return false;
    positions.set(node.id, { x, y });
    placed.add(node.id);
    return true;
  };
  const regionWidth = (region: Node[], fallback = 280) => Math.max(fallback, ...region.map((node) => size(node).width));

  const videos = movable.filter(isVideo).sort((a, b) => shotNo(a).localeCompare(shotNo(b), 'zh-CN', { numeric: true }));
  const videoIds = new Set(videos.map((node) => node.id));
  const videoPromptIds = new Set(edges
    .filter((edge) => videoIds.has(edge.target) && ids.has(edge.source) && byId.get(edge.source)?.type === 'text' && !edgeIsProvenance(edge))
    .map((edge) => edge.source));
  const imagePromptIds = new Set(edges
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target) && byId.get(edge.source)?.type === 'text' && byId.get(edge.target)?.type === 'image' && !edgeIsProvenance(edge))
    .map((edge) => edge.source));
  const research = movable.filter(isResearch).sort((a, b) => a.id.localeCompare(b.id));
  const imagePrompts = movable.filter((node) => isImagePrompt(node, imagePromptIds)).sort((a, b) => a.id.localeCompare(b.id));
  const assets = movable.filter((node) => isBaseAsset(node, edges, ids)).sort((a, b) => a.id.localeCompare(b.id));
  const derived = movable.filter((node) => isDerivedImage(node, edges, ids, byId)).sort((a, b) => a.id.localeCompare(b.id));
  const tails = movable.filter((node) => node.type === 'image' && isExtractedTail(node, edges, ids, byId));
  const videoPrompts = movable.filter((node) => isVideoPrompt(node, videoPromptIds)).sort((a, b) => shotNo(a).localeCompare(shotNo(b), 'zh-CN', { numeric: true }));

  // Notes without an explicit workflow role stay in the left planning column.
  const planningNotes = movable.filter((node) => node.type === 'text' && !isResearch(node) && !isImagePrompt(node, imagePromptIds) && !isVideoPrompt(node, videoPromptIds));
  const researchRegion = [...research, ...planningNotes];
  const researchX = 0;
  const researchWidth = regionWidth(researchRegion);
  const promptX = researchX + researchWidth + REGION_GAP;
  const promptWidth = regionWidth([...imagePrompts, ...videoPrompts], 320);
  const assetX = promptX + promptWidth + REGION_GAP;
  const assetWidth = regionWidth(assets);
  const derivedX = assetX + assetWidth + REGION_GAP;
  const derivedWidth = regionWidth(derived);
  const videoPromptX = derivedX + derivedWidth + REGION_GAP;
  const videoPromptWidth = regionWidth(videoPrompts, promptWidth);
  const videoX = videoPromptX + videoPromptWidth + REGION_GAP;
  const videoWidth = regionWidth(videos, 320);
  const tailX = videoX + videoWidth + REGION_GAP;

  // Leftmost research and planning content is intentionally independent of the
  // number of shots; it must not drift below the production lanes.
  let researchY = 0;
  for (const node of researchRegion) {
    place(node, researchX, researchY);
    researchY += size(node).height + GAP;
  }

  // Image prompt → base asset lanes. Match by explicit edge only. An asset with
  // multiple prompts keeps them stacked in the same row rather than collapsing
  // every prompt into one global column.
  let assetY = 0;
  for (const asset of assets) {
    const prompts = incoming(asset.id)
      .filter((edge) => !edgeIsProvenance(edge))
      .map((edge) => byId.get(edge.source))
      .filter((node): node is Node => Boolean(node && isImagePrompt(node, imagePromptIds)));
    const members = [...new Set(prompts.map((node) => node.id))].map((id) => byId.get(id)!).filter(Boolean);
    const rowHeight = Math.max(size(asset).height, ...members.map((node) => size(node).height), 160);
    for (const prompt of members) {
      place(prompt, promptX, assetY + (rowHeight - size(prompt).height) / 2);
    }
    place(asset, assetX, assetY + (rowHeight - size(asset).height) / 2);
    assetY += rowHeight + GAP;
  }
  // Image prompts not connected to a current asset remain visible, but never
  // steal a production lane from a different asset.
  for (const prompt of imagePrompts) {
    if (!placed.has(prompt.id)) {
      place(prompt, promptX, assetY);
      assetY += size(prompt).height + GAP;
    }
  }

  // One horizontal production lane per video. Derived inputs are placed in the
  // derived column; shared nodes are physical singletons and keep their first
  // occurrence, so later shots connect to them without duplicating the image.
  let videoY = 0;
  const placedDerived = new Set<string>();
  for (const video of videos) {
    const promptNodes = incoming(video.id)
      .filter((edge) => !edgeIsProvenance(edge))
      .map((edge) => byId.get(edge.source))
      .filter((node): node is Node => Boolean(node && isVideoPrompt(node, videoPromptIds)));
    const directlyBoundInputs = incoming(video.id)
      // A shared tail frame is the next shot's primary first frame. Keep the
      // physical node in that next row; otherwise every shot reserves a second
      // vertical slot and the whole storyboard becomes needlessly stretched.
      .filter((edge) => !edgeIsProvenance(edge) && !isSecondaryVideoInput(edge))
      .map((edge) => byId.get(edge.source))
      .filter((node): node is Node => Boolean(node && (isDerivedImage(node, edges, ids, byId) || isBaseAsset(node, edges, ids))));
    // Older canvas snapshots may have the provenance record for a generated
    // first frame but no direct video-extra edge. Recover its lane from the
    // frozen label instead of dumping the node into an orphan column.
    const labelledInputs = derived.filter((node) => isPrimaryDerivedForVideo(node, video));
    const inputNodes = [...new Map([...directlyBoundInputs, ...labelledInputs].map((node) => [node.id, node])).values()];
    const outputNodes = outgoing(video.id)
      .filter((edge) => edgeIsProvenance(edge))
      .map((edge) => byId.get(edge.target))
      .filter((node): node is Node => Boolean(node && isExtractedTail(node, edges, ids, byId)));
    const members = [...promptNodes, ...inputNodes, video, ...outputNodes];
    const slotHeight = maxHeight(members, 160);
    const slotCount = Math.max(1, promptNodes.length, inputNodes.filter((node) => !isBaseAsset(node, edges, ids)).length, outputNodes.length);
    const laneHeight = slotCount * slotHeight + Math.max(0, slotCount - 1) * GAP;
    const slotY = (index: number, _node: Node) => videoY + index * (slotHeight + GAP);
    promptNodes.forEach((prompt, index) => place(prompt, videoPromptX, slotY(index, prompt)));
    let derivedIndex = 0;
    inputNodes.forEach((input) => {
      // Base assets stay in the dedicated asset column even when directly used
      // by a video; only derived/first-frame images enter the video lane.
      if (isBaseAsset(input, edges, ids)) return;
      if (!placedDerived.has(input.id)) {
        place(input, derivedX, slotY(derivedIndex, input));
        derivedIndex += 1;
        placedDerived.add(input.id);
      }
    });
    // Legacy tail-input projections are intentionally not part of the active
    // reference lane. The sync pass removes those disposable nodes; if one is
    // still present in an older snapshot, it remains untouched for history but
    // is not allowed to reserve a production row.
    // Do not place secondary tail-input labels here. They are legacy H3
    // projections and must not influence the active layout.
    // The primary row is a strict horizontal baseline: prompt, first frame,
    // video and extracted result all start at the same y. Secondary inputs
    // stack below this baseline and must never push the video down.
    place(video, videoX, videoY);
    outputNodes.forEach((output, index) => place(output, tailX, slotY(index, output)));
    videoY += laneHeight + GAP;
  }

  // Derived images that are not currently bound to a video still belong between
  // assets and videos, never in the left research pile.
  let derivedY = Math.max(assetY, videoY);
  for (const node of derived) {
    if (!placed.has(node.id)) {
      place(node, derivedX, derivedY);
      derivedY += size(node).height + GAP;
    }
  }
  // A video prompt can exist without a video result yet; keep it in the video
  // prompt column so the pending lane remains understandable.
  for (const prompt of videoPrompts) {
    if (!placed.has(prompt.id)) {
      place(prompt, videoPromptX, videoY);
      videoY += size(prompt).height + GAP;
    }
  }
  for (const tail of tails) {
    if (!placed.has(tail.id)) {
      place(tail, tailX, videoY);
      videoY += size(tail).height + GAP;
    }
  }

  // Any unknown node is retained, not discarded. Put it in the planning area so
  // new node types do not accidentally appear in a misleading production lane.
  for (const node of movable) {
    if (!placed.has(node.id)) {
      place(node, researchX, researchY);
      researchY += size(node).height + GAP;
    }
  }

  // Selected-only layout must not cover stationary nodes. Preserve the previous
  // translation behavior while keeping all relative positions from this layout.
  let offsetX = selectedOnly ? Math.min(...movable.map((node) => node.position.x)) : 0;
  const offsetY = selectedOnly ? Math.min(...movable.map((node) => node.position.y)) : 0;
  const stationary = nodes.filter((node) => !ids.has(node.id) && !node.parentNode && !node.hidden);
  const collides = stationary.some((blocked) => movable.some((node) => {
    const p = positions.get(node.id);
    if (!p) return false;
    const a = size(node);
    const b = size(blocked);
    return p.x + offsetX < blocked.position.x + b.width + GAP
      && p.x + offsetX + a.width + GAP > blocked.position.x
      && p.y + offsetY < blocked.position.y + b.height + GAP
      && p.y + offsetY + a.height + GAP > blocked.position.y;
  }));
  if (collides) offsetX = Math.max(...stationary.map((node) => node.position.x + size(node).width)) + GAP;

  return nodes.map((node) => {
    const position = positions.get(node.id);
    return position ? { ...node, position: { x: position.x + offsetX, y: position.y + offsetY } } : node;
  });
}
