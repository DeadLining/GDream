/**
 * shotRefs — 工坊分镜参考图顺序与 @图片N 编号的单一权威模块。
 *
 * 修复的核心病灶（与画布 collectRefs.ts 同款病）：store 生成（generateShot）、
 * tools 校验（buildShotRequiredRefs）、UI 展示/重排（StepPrompts 内私有函数）
 * 三处各自维护参考图顺序——任何一处口径不一致都会让 @图片N 指错素材。
 *
 * 纪律：
 * 1. 顺序唯一权威（video）：故事板分镜板(useInVideo)→场景→角色→道具→额外图→色卡。
 * 2. 顺序唯一权威（image/storyboard）：场景→角色→道具→额外图→色卡（不含首帧/故事板——
 *    它们是 imagePrompt 的产物，不能作它自己的参考）。
 * 3. 任何增删参考的写入路径（UI 删除、agent 工具、画布回传、分镜板增删）都必须
 *    经 remapShotPromptRefs 重排提示词编号。
 */
import type { AdCreativeSpec } from './adSpec.ts';
import type { WsShot, StoryboardBoard, StoryboardFrame } from './types.ts';
import { isMiniMaxH3Model } from './providerCapabilities.ts';

const NUM_TO_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五'];

export function numToCn(n: number): string {
  return n >= 1 && n <= NUM_TO_CN.length ? NUM_TO_CN[n - 1] : String(n);
}

interface SceneLike { id: string; name?: string; assetImagePath?: string; selectedImagePaths?: string[]; sceneReferenceMode?: 'multi' }
interface AssetLike { id: string; name?: string; assetImagePath?: string }
interface PaletteLike { id: string; name?: string; assetImagePath?: string }

function characterNameTokens(name: string): string[] {
  const raw = name.split(/[（(、，,；;\/]/u).map((part) => part.replace(/[）)]/gu, '').trim()).filter(Boolean);
  const aliases = raw.flatMap((part) => part.split(/(?:化名|别名|又名)[:：]?/u).map((item) => item.trim()).filter(Boolean));
  return [...new Set([...raw, ...aliases])];
}

/** Resolve image characters from the opening state, not from later screen/media content. */
export function effectiveOpeningCharacterIds(
  shot: Pick<WsShot, 'characterIds' | 'entryState'> & Partial<Pick<WsShot, 'description'>>,
  characters: AssetLike[],
): string[] {
  // The opening state determines physical staging, while the shot
  // description determines every person visibly rendered in the 0.00s image
  // (including a presenter inside a television). Both visible identities need
  // appearance references.
  const opening = [shot.entryState?.characters, shot.description].filter(Boolean).join(' ').trim();
  if (!opening) return [...new Set(shot.characterIds ?? [])];
  const matches = characters.filter((character) => (
    characterNameTokens(character.name ?? '').some((token) => token.length >= 2 && opening.includes(token))
  ));
  // The image/storyboard reference set must cover every named person visible
  // in the 0.00s frame, including a presenter shown inside a TV, phone, photo
  // or other on-screen medium. Keep explicit characterIds as a supplement
  // for legacy shots whose description omitted a name; never let that field
  // discard a second person that is explicitly described in the opening.
  return [...new Set([
    ...(shot.characterIds ?? []),
    ...matches.map((character) => character.id),
  ])];
}

export interface ShotRefsContext {
  creativeSpec?: { workKind?: string; adSpec?: AdCreativeSpec };
  scenes: SceneLike[];
  characters: AssetLike[];
  props: AssetLike[];
  colorPalettes?: PaletteLike[];
  globalColorPaletteId?: string;
}

export type ShotRefBindingKind = 'storyboardBoard' | 'directorConstraintCard' | 'scene' | 'character' | 'prop' | 'extra' | 'palette';

export interface ShotRefBinding {
  /** Must survive sparse storyboard compaction: user-approved product identity. */
  productIdentity?: boolean;
  index: number;
  kind: ShotRefBindingKind;
  label: string;
  path: string;
  id?: string;
}

/** Structural preflight for the exact reference set sent to a provider. */
export function validateShotReferenceBindings(
  shot: WsShot,
  bindings: ShotRefBinding[],
  ctx: ShotRefsContext,
): string[] {
  const errors: string[] = [];
  const paths = bindings.map((binding) => binding.path).filter(Boolean);
  const duplicatePaths = paths.filter((path, index) => paths.indexOf(path) !== index);
  if (duplicatePaths.length) errors.push(`参考图重复：${[...new Set(duplicatePaths)].join('、')}`);
  const sceneCount = bindings.filter((binding) => binding.kind === 'scene').length;
  if (shot.sceneId && sceneCount === 0) errors.push('缺少本镜场景参考图');
  const expectedCharacters = effectiveOpeningCharacterIds(shot, ctx.characters);
  const boundCharacters = new Set(bindings.filter((binding) => binding.kind === 'character').map((binding) => binding.id));
  expectedCharacters.filter((id) => !boundCharacters.has(id)).forEach((id) => {
    const name = ctx.characters.find((character) => character.id === id)?.name ?? id;
    errors.push(`缺少人物参考图：${name}`);
  });
  const expectedProps = [...new Set((shot.assetPropIds ?? shot.propIds ?? []).filter(Boolean))];
  const boundProps = new Set(bindings.filter((binding) => binding.kind === 'prop').map((binding) => binding.id));
  expectedProps.filter((id) => !boundProps.has(id)).forEach((id) => {
    const name = ctx.props.find((prop) => prop.id === id)?.name ?? id;
    errors.push(`缺少道具参考图：${name}`);
  });
  return errors;
}

function bindingIdentityList(bindings: ShotRefBinding[]): string[] {
  const idFrequencies = new Map<string, number>();
  bindings.forEach((binding) => {
    if (!binding.id) return;
    const idKey = `${binding.kind}:${binding.id}`;
    idFrequencies.set(idKey, (idFrequencies.get(idKey) ?? 0) + 1);
  });
  const counts = new Map<string, number>();
  return bindings.map((binding) => {
    const idKey = binding.id ? `${binding.kind}:${binding.id}` : '';
    // 单图角色/道具换文件时身份仍是同一资产；一个场景有多角度时则必须
    // 把路径并入身份，否则拖动多角度顺序会让 @图片N 指向另一张图。
    const base = binding.id && idFrequencies.get(idKey) === 1
      ? idKey
      : `${binding.kind}:${binding.id ?? ''}:${binding.path}`;
    const occurrence = (counts.get(base) ?? 0) + 1;
    counts.set(base, occurrence);
    return `${base}:${occurrence}`;
  });
}

/** 稳定的引用快照签名。Agent 写提示词时用它防止基于旧编号覆盖新状态。 */
export function shotReferenceSignature(shot: WsShot, ctx: ShotRefsContext): string {
  const source = [
    ...buildImageRefBindings(shot, ctx).map((ref) => `i:${ref.kind}:${ref.id ?? ''}:${ref.path}`),
    ...buildVideoRefBindings(shot, ctx).map((ref) => `v:${ref.kind}:${ref.id ?? ''}:${ref.path}`),
  ].join('|');
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `refs-${(hash >>> 0).toString(36)}`;
}

export function getSceneReferencePaths(
  shot: Pick<WsShot, 'sceneId' | 'sceneImagePaths'>,
  scenes: SceneLike[],
): string[] {
  const scene = scenes.find((x) => x.id === shot.sceneId);
  const selected = scene?.selectedImagePaths?.filter(Boolean) ?? [];
  // A multi-angle scene is a single spatial asset, not an optional alternate.
  // Prefer the scene's current pair so stale per-shot snapshots cannot silently
  // drop one of the complementary views after an asset refresh.
  if (scene?.sceneReferenceMode === 'multi' && selected.length > 0) return selected;
  if (shot.sceneImagePaths) return shot.sceneImagePaths.filter(Boolean);
  return scene?.assetImagePath ? [scene.assetImagePath] : [];
}

function getPaletteReferencePath(shot: WsShot, ctx: ShotRefsContext): string | undefined {
  const paletteId = shot.colorPaletteId || ctx.globalColorPaletteId;
  if (!paletteId) return undefined;
  return ctx.colorPalettes?.find((x) => x.id === paletteId)?.assetImagePath;
}

/** 生图/高清故事板的实际参考绑定（缺图资产不占 @图片N 编号）。 */
export function buildImageRefBindings(shot: WsShot, ctx: ShotRefsContext): ShotRefBinding[] {
  const refs: ShotRefBinding[] = [];
  const scene = ctx.scenes.find((x) => x.id === shot.sceneId);
  getSceneReferencePaths(shot, ctx.scenes).forEach((path, i) => {
    refs.push({
      index: refs.length + 1,
      kind: 'scene',
      label: i === 0 ? `场景 ${scene?.name ?? shot.sceneId ?? ''}`.trim() : `场景角度 ${i + 1}`,
      path,
      id: scene?.id,
    });
  });
  // A character is a single identity in a shot.  Old projects can contain
  // duplicate IDs after repeated asset imports; do not submit the same
  // character image twice (which also shifts every following @图片N).
  const seenCharacterIds = new Set<string>();
  for (const cid of effectiveOpeningCharacterIds(shot, ctx.characters)) {
    if (seenCharacterIds.has(cid)) continue;
    seenCharacterIds.add(cid);
    const c = ctx.characters.find((x) => x.id === cid);
    if (c?.assetImagePath) refs.push({
      index: refs.length + 1,
      kind: 'character',
      label: `角色 ${c.name ?? cid}`,
      path: c.assetImagePath,
      id: cid,
    });
  }
  // assetPropIds is the canonical visual-asset binding when a shot has a
  // separate production prop set; fall back to the legacy propIds field for
  // older projects. Keeping this choice here makes image and storyboard
  // references agree with the preflight validator.
  for (const pid of (shot.assetPropIds ?? shot.propIds ?? [])) {
    const p = ctx.props.find((x) => x.id === pid);
    if (p?.assetImagePath) refs.push({
      index: refs.length + 1,
      kind: 'prop',
      label: `道具 ${p.name ?? pid}`,
      path: p.assetImagePath,
      id: pid,
    });
  }
  {
    const productImages = ctx.creativeSpec?.workKind === 'product-ad' ? ctx.creativeSpec.adSpec?.productImages ?? [] : shot.productReferenceImages ?? [];
    for (const [slot, path] of productImages.entries()) {
      if (!path) continue;
      const existing = refs.find(ref => ref.path === path);
      if (existing) { existing.productIdentity = true; continue; }
      refs.push({ index: refs.length + 1, kind: 'extra', label: '用户产品身份参考', path, id: `ad-product:${slot}`, productIdentity: true });
    }
  }
  const extraPaths = [...(shot.extraRefImages ?? []).filter(Boolean)]
    .filter((path) => !/(?:white[_-]?model|whitebox|blender)/i.test(path));
  for (const path of extraPaths) {
    if (refs.some(ref => ref.path === path)) continue;
    refs.push({
      index: refs.length + 1,
      kind: 'extra',
      label: `额外参考 ${path.split('/').pop() ?? ''}`.trim(),
      path,
    });
  }
  const palettePath = getPaletteReferencePath(shot, ctx);
  if (palettePath) {
    const paletteId = shot.colorPaletteId || ctx.globalColorPaletteId;
    const palette = ctx.colorPalettes?.find((x) => x.id === paletteId);
    refs.push({
      index: refs.length + 1,
      kind: 'palette',
      label: `色卡 ${palette?.name ?? paletteId ?? ''}`.trim(),
      path: palettePath,
      id: paletteId,
    });
  }
  return refs;
}

/** H3 首尾帧使用的真实资产参考。 */
export function getBoundaryFrameBindings(shot: WsShot, ctx: ShotRefsContext): ShotRefBinding[] {
  return buildImageRefBindings(shot, ctx);
}

/**
 * 单格故事板传入画布时的参考绑定。
 *
 * frame.refImagePaths 是该格提示词写入时保存的真实编号快照，优先级高于
 * 当前资产列表。资产发生重排后 remapShotPromptRefs 会同步更新这份快照；
 * 对旧项目或历史缺失资产，则保留路径并降级为“历史参考”，避免静默漏传。
 */
export function buildStoryboardFrameRefBindings(
  shot: WsShot,
  frame: Pick<StoryboardFrame, 'refImagePaths' | 'useDirectorConstraintCard'>,
  ctx: ShotRefsContext,
): ShotRefBinding[] {
  const current = buildImageRefBindings(shot, ctx);
  const cardPath = shot.directorConstraintCard?.imagePath;
  const paths = frame.refImagePaths?.filter((path) => Boolean(path) && path !== cardPath);
  let resolved: ShotRefBinding[];
  if (!paths?.length) {
    resolved = current;
  } else {
    // 同一路径理论上不应重复占编号；这里用队列匹配，兼容旧数据中的重复路径，
    // 同时确保每一个 @图片N 都能得到对应的可见节点。
    const buckets = new Map<string, ShotRefBinding[]>();
    current.forEach((binding) => {
      const list = buckets.get(binding.path) ?? [];
      list.push(binding);
      buckets.set(binding.path, list);
    });

    resolved = paths.map((path, index) => {
      const matched = buckets.get(path)?.shift();
      return matched
        ? { ...matched, index: index + 1 }
        : {
            index: index + 1,
            kind: 'extra',
            label: `历史参考 ${index + 1}`,
            path,
          };
    });
  }

  // Identity refs are mandatory even when a frame carries an older sparse snapshot.
  for (const product of current.filter(binding => binding.productIdentity)) {
    if (!resolved.some(binding => binding.path === product.path)) resolved.push({...product,index:resolved.length+1});
  }

  if (frame.useDirectorConstraintCard && cardPath) {
    resolved.push({
      index: resolved.length + 1,
      kind: 'directorConstraintCard',
      label: '导演约束卡',
      path: cardPath,
      id: shot.directorConstraintCard?.id,
    });
  }
  return resolved;
}

export interface CompactStoryboardFrameReferencesResult {
  prompt: string;
  bindings: ShotRefBinding[];
}

/**
 * Convert a frame's sparse references into its own contiguous @图片N scope.
 * Example: a frame using the shot-level @图片一 and @图片三 stores/sends only
 * those two assets and rewrites the latter to local @图片二.
 */
export function compactStoryboardFrameReferences(
  shot: WsShot,
  frame: Pick<StoryboardFrame, 'prompt' | 'refImagePaths' | 'useDirectorConstraintCard'>,
  ctx: ShotRefsContext,
): CompactStoryboardFrameReferencesResult {
  const bindings = buildStoryboardFrameRefBindings(shot, frame, ctx);
  const mentioned = new Set<number>();
  for (const match of frame.prompt.matchAll(/@图片([一二三四五六七八九十]+|\d+)/g)) {
    const raw = match[1];
    const index = /^\d+$/.test(raw) ? Number(raw) : NUM_TO_CN.indexOf(raw) + 1;
    if (index >= 1 && index <= bindings.length) mentioned.add(index);
  }
  if (mentioned.size === 0) return { prompt: frame.prompt, bindings };

  const selected = bindings.filter((binding) => (
    mentioned.has(binding.index)
    || binding.productIdentity === true
    || (frame.useDirectorConstraintCard === true && binding.kind === 'directorConstraintCard')
  ));
  const compacted = selected.map((binding, index) => ({ ...binding, index: index + 1 }));
  return {
    prompt: replaceImageMentionsByPath(
      frame.prompt,
      bindings.map((binding) => binding.path),
      compacted.map((binding) => binding.path),
    ) ?? frame.prompt,
    bindings: compacted,
  };
}

/** 视频生成的实际参考绑定（分镜板→导演约束卡→常规资产；分镜图 imagePath 只做产物展示）。 */
export interface VideoRefBindingOptions {
  /** 是否把拼合故事板作为视频模型输入。 */
  includeStoryboardBoards?: boolean;
  /** 正式生成时只允许使用所有组成帧都已接受的故事板。 */
  requireApprovedStoryboardBoards?: boolean;
  /** 是否把导演约束卡作为视频模型输入。 */
  includeDirectorConstraintCard?: boolean;
}

function storyboardFrameIsApproved(frame: StoryboardFrame | undefined): boolean {
  const binding = frame?.panelProductionBinding;
  if (!binding || !frame.imagePath || binding.path !== frame.imagePath) return false;
  return (frame.panelReviews ?? []).some((review) => (
    review.candidateId === binding.candidateId
    && review.candidateFingerprint === binding.candidateFingerprint
    && review.verdict === 'accepted'
  ));
}

export function storyboardBoardIsApproved(shot: WsShot, board: StoryboardBoard): boolean {
  if (!board.frameIds.length) return false;
  const frames = new Map((shot.storyboardFrames ?? []).map((frame) => [frame.id, frame]));
  return board.frameIds.every((frameId) => storyboardFrameIsApproved(frames.get(frameId)));
}

function activeStoryboardBoards(shot: WsShot, options: VideoRefBindingOptions = {}): StoryboardBoard[] {
  return (shot.storyboardBoards ?? []).filter((board) => (
    board.imagePath
    && board.useInVideo !== false
    && (!options.requireApprovedStoryboardBoards || storyboardBoardIsApproved(shot, board))
  ));
}

export function buildVideoRefBindings(
  shot: WsShot,
  ctx: ShotRefsContext,
  options: VideoRefBindingOptions = {},
): ShotRefBinding[] {
  const refs: ShotRefBinding[] = [];
  if (options.includeStoryboardBoards !== false) {
    const boards = activeStoryboardBoards(shot, options);
    for (const [i, board] of boards.entries()) {
      refs.push({
        index: refs.length + 1,
        kind: 'storyboardBoard',
        label: `高清故事板 ${i + 1}`,
        path: board.imagePath,
        id: board.id,
      });
    }
  }
  if (options.includeDirectorConstraintCard !== false && shot.directorConstraintCard?.imagePath && shot.directorConstraintCard.useInVideo === true) {
    refs.push({
      index: refs.length + 1,
      kind: 'directorConstraintCard',
      label: '导演约束卡',
      path: shot.directorConstraintCard.imagePath,
      id: shot.directorConstraintCard.id,
    });
  }
  for (const binding of buildImageRefBindings(shot, ctx)) {
    refs.push({ ...binding, index: refs.length + 1 });
  }
  return refs;
}

/** 生图/高清故事板的参考路径（不含首帧/故事板，色卡作为普通图片资产排在最后） */
export function buildImageRefPaths(shot: WsShot, ctx: ShotRefsContext): string[] {
  return buildImageRefBindings(shot, ctx).map((ref) => ref.path);
}

/** 视频生成的参考路径（分镜板置首；分镜图 imagePath 只做封面/产物，不作为参考） */
export function buildVideoRefPaths(shot: WsShot, ctx: ShotRefsContext): string[] {
  return buildVideoRefBindings(shot, ctx).map((ref) => ref.path);
}

/** 兼容旧调用：按路径重排。新代码应优先使用语义绑定重排。 */
export function replaceImageMentionsByPath(prompt: string | undefined, oldPaths: string[], newPaths: string[]): string | undefined {
  if (!prompt) return prompt;
  const oldIndexToPath = new Map<number, string>();
  oldPaths.forEach((path, i) => oldIndexToPath.set(i + 1, path));
  const newPathToIndex = new Map<string, number>();
  newPaths.forEach((path, i) => {
    if (!newPathToIndex.has(path)) newPathToIndex.set(path, i + 1);
  });

  return prompt.replace(/@图片([一二三四五六七八九十]+|\d+)/g, (match, raw: string) => {
    const oldIndex = /^\d+$/.test(raw) ? Number(raw) : NUM_TO_CN.indexOf(raw) + 1;
    const oldPath = oldIndexToPath.get(oldIndex);
    if (!oldPath) return match;
    const nextIndex = newPathToIndex.get(oldPath);
    if (!nextIndex) return '';
    return `@图片${numToCn(nextIndex)}`;
  });
}

function replaceImageMentionsByBinding(
  prompt: string | undefined,
  oldBindings: ShotRefBinding[],
  newBindings: ShotRefBinding[],
): string | undefined {
  if (!prompt) return prompt;
  const oldIdentities = bindingIdentityList(oldBindings);
  const nextIndexByIdentity = new Map(
    bindingIdentityList(newBindings).map((identity, index) => [identity, index + 1]),
  );
  return prompt
    .replace(/@图片([一二三四五六七八九十]+|\d+)|<Picture\s+(\d+)>/gi, (match, raw: string | undefined, picture: string | undefined) => {
      const rawIndex = picture ?? raw ?? '';
      const oldIndex = /^\d+$/.test(rawIndex) ? Number(rawIndex) : NUM_TO_CN.indexOf(rawIndex) + 1;
      const identity = oldIdentities[oldIndex - 1];
      if (!identity) return match;
      const nextIndex = nextIndexByIdentity.get(identity);
      if (!nextIndex) return '';
      return picture ? `<Picture ${nextIndex}>` : `@图片${numToCn(nextIndex)}`;
    })
    .replace(/[、，]\s*(?=[、，。；])/g, '')
    .replace(/[ \t]{2,}/g, ' ');
}

/** 参考资产变更后重排 imagePrompt/videoPrompt/storyboardFrames 的 @图片N */
export function remapShotPromptRefs(
  oldShot: WsShot,
  nextShot: WsShot,
  oldCtx: ShotRefsContext,
  nextCtx: ShotRefsContext = oldCtx,
): Partial<WsShot> {
  const oldImageRefs = buildImageRefBindings(oldShot, oldCtx);
  const nextImageRefs = buildImageRefBindings(nextShot, nextCtx);
  const oldVideoRefs = buildVideoRefBindings(oldShot, oldCtx);
  const nextVideoRefs = buildVideoRefBindings(nextShot, nextCtx);
  const oldSeedance25Refs = buildVideoRefBindings(oldShot, oldCtx, { includeStoryboardBoards: false });
  const nextSeedance25Refs = buildVideoRefBindings(nextShot, nextCtx, { includeStoryboardBoards: false });

  const storyboardFrames = (oldShot.storyboardFrames ?? []).map((frame) => {
    const oldFrameRefs = buildStoryboardFrameRefBindings(oldShot, frame, oldCtx);
    const originalNextFrame = nextShot.storyboardFrames?.find((item) => item.id === frame.id) ?? frame;
    const staleProductPaths = new Set(oldImageRefs.filter(ref => ref.productIdentity && !nextImageRefs.some(next => next.path === ref.path)).map(ref => ref.path));
    const rawNextFrame = {...originalNextFrame,refImagePaths:originalNextFrame.refImagePaths?.filter(path => !staleProductPaths.has(path))};
    // 替换/删除导演卡时，旧卡路径不能降级成“历史参考”继续占一个 @图片N。
    const oldCardPath = oldShot.directorConstraintCard?.imagePath;
    const nextFrame = oldCardPath
      ? {
          ...rawNextFrame,
          refImagePaths: rawNextFrame.refImagePaths?.filter((path) => path !== oldCardPath),
        }
      : rawNextFrame;
    const nextFrameRefs = buildStoryboardFrameRefBindings(nextShot, nextFrame, nextCtx);
    const cardRef = nextFrameRefs.find((ref) => ref.kind === 'directorConstraintCard');
    const remappedPrompt = replaceImageMentionsByBinding(
      frame.prompt,
      oldFrameRefs,
      nextFrameRefs,
    ) ?? frame.prompt;
    return {
      ...frame,
      ...nextFrame,
      prompt: cardRef
        ? ensureDirectorConstraintMention(remappedPrompt, cardRef.index)
        : stripDirectorConstraintMention(remappedPrompt),
      refImagePaths: nextFrameRefs.map((ref) => ref.path),
    };
  });

  return {
    imagePrompt: replaceImageMentionsByBinding(oldShot.imagePrompt, oldImageRefs, nextImageRefs),
    videoPrompt: replaceImageMentionsByBinding(oldShot.videoPrompt, oldVideoRefs, nextVideoRefs),
    seedance25VideoPrompt: replaceImageMentionsByBinding(
      oldShot.seedance25VideoPrompt,
      oldSeedance25Refs,
      nextSeedance25Refs,
    ),
    universalVideoPrompt: replaceImageMentionsByBinding(
      oldShot.universalVideoPrompt,
      oldVideoRefs,
      nextVideoRefs,
    ),
    ...(storyboardFrames.length > 0 ? { storyboardFrames } : {}),
    referenceRevision: (oldShot.referenceRevision ?? 0) + 1,
  };
}

/** 会移动 @图片N 编号的分镜字段 */
export const REF_PATCH_FIELDS = new Set<string>([
  'characterIds',
  'propIds',
  'assetPropIds',
  'sceneId',
  'sceneImagePaths',
  'extraRefImages',
  'productReferenceImages',
  'colorPaletteId',
  'storyboardBoards',
  'directorConstraintCard',
]);

export function patchTouchesRefs(patch: Partial<WsShot>): boolean {
  return Object.keys(patch).some((key) => REF_PATCH_FIELDS.has(key));
}

/** 带重排的分镜补丁：任何增删参考的写入都应走这里而不是裸 updateShot */
export function buildRefAwarePatch(shot: WsShot, patch: Partial<WsShot>, ctx: ShotRefsContext): Partial<WsShot> {
  if (!patchTouchesRefs(patch)) return patch;
  const nextShot = { ...shot, ...patch };
  const remap = remapShotPromptRefs(shot, nextShot, ctx);
  return { ...remap, ...patch };
}

/** 视频提示词的分镜板前缀（编号与 buildVideoRefPaths 中分镜板置首严格一致） */
export function storyboardVideoPrefix(boards: StoryboardBoard[], shot?: WsShot, options: VideoRefBindingOptions = {}): string {
  const active = shot ? activeStoryboardBoards(shot, options) : boards.filter((b) => b.imagePath && b.useInVideo !== false);
  if (active.length === 0) return '';
  const refs = active.map((_b, i) => `@图片${numToCn(i + 1)}`).join('、');
  return `以分镜板${refs}作为本镜景别变化和画面参考，保持人物脸部一致、光线方向和画面层次。`;
}

export function stripStoryboardVideoPrefix(prompt?: string): string {
  return (prompt ?? '')
    // 旧版本与 Agent 曾写出多种分镜板前缀。只要它位于提示词开头，
    // Seedance 2.5 隐藏分镜板时都必须整行移除，不能仅删掉 @图片N 后留下
    // “以分镜板作为参考”这种幽灵约束。
    .replace(/^(?:以|参考)\s*分镜[版板][^\n]*(?:\n|$)/u, '')
    .trimStart();
}

const DIRECTOR_CONSTRAINT_PREFIX_RE = /^参考\s*@导演约束卡（对应\s*@图片(?:[一二三四五六七八九十]+|\d+)）[^\n]*\n?/u;
const DIRECTOR_CONSTRAINT_VIDEO_PREFIX_RE = /^以\s*@导演约束卡（对应\s*@图片(?:[一二三四五六七八九十]+|\d+)）[^\n]*\n?/u;

/** 单格故事板启用导演约束卡时的稳定前缀；同时保留模型可识别的 @图片N。 */
export function ensureDirectorConstraintMention(prompt: string, imageIndex: number): string {
  const body = stripDirectorConstraintMention(prompt);
  return `参考 @导演约束卡（对应 @图片${numToCn(imageIndex)}）锁定人物站位、视线、机位和动作关系；只继承空间调度约束，不复制僵硬姿势。\n${body}`.trim();
}

export function stripDirectorConstraintMention(prompt?: string): string {
  return (prompt ?? '').replace(DIRECTOR_CONSTRAINT_PREFIX_RE, '').trimStart();
}

/** 视频生成启用导演约束卡时的稳定前缀。 */
export function directorConstraintVideoPrefix(
  shot: WsShot,
  options: VideoRefBindingOptions = {},
): string {
  if (options.includeDirectorConstraintCard === false || !shot.directorConstraintCard?.imagePath || shot.directorConstraintCard.useInVideo !== true) return '';
  const boardCount = options.includeStoryboardBoards === false
    ? 0
    : activeStoryboardBoards(shot, options).length;
  return `以 @导演约束卡（对应 @图片${numToCn(boardCount + 1)}）锁定本镜人物站位、视线、机位和动作关系；只继承调度约束，不复制僵硬姿势。`;
}

export function stripDirectorConstraintVideoPrefix(prompt?: string): string {
  return (prompt ?? '').replace(DIRECTOR_CONSTRAINT_VIDEO_PREFIX_RE, '').trimStart();
}

const CONTROLLED_TRANSITION_BLOCK_RE = /\n?【受控转场】[\s\S]*?【受控转场结束】\n?/gu;
const CONTINUITY_GUARD_BLOCK_RE = /\n?【连续性与生成约束】[\s\S]*?【连续性与生成约束结束】\n?/gu;

const TRANSITION_KIND_LABEL: Record<NonNullable<WsShot['transitionPlan']>['kind'], string> = {
  'match-cut': '匹配剪辑',
  'whip-pan': '甩镜转场',
  occlusion: '遮挡转场',
  'light-flash': '强光闪白',
  dissolve: '溶解转场',
  morph: '形态变换',
};

export function transitionPromptForShot(shot: WsShot): string {
  const plan = shot.transitionPlan;
  if (!plan?.kind || !plan.trigger?.trim() || !plan.target?.trim() || !plan.prompt?.trim()) return '';
  return `【受控转场】\n本镜只执行一次${TRANSITION_KIND_LABEL[plan.kind]}：当“${plan.trigger.trim()}”在画面中发生时，以连续可见的运动完成转场，自然揭示“${plan.target.trim()}”。保持人物身份、动作方向、视线逻辑以及光线、色彩或构图匹配；不要增加第二次切换，不要插入额外地点，不要发展新的剧情。\n导演约束：${plan.prompt.trim()}\n【受控转场结束】`;
}

export function continuityGuardPromptForShot(shot: WsShot): string {
  const transitionRule = shot.transitionPlan?.kind
    ? '除上方已明确标注的这一次受控转场外，不要增加随意的镜头剪切、额外场景转场或角色替换。'
    : '不要增加随意的镜头剪切、场景转场或角色替换。';
  const coreAction = shot.atomicAction?.trim()
    ? `本镜核心动作必须完整可见：${shot.atomicAction.trim()}。`
    : '本镜已经明确的核心动作必须完整可见。';
  const dialogueRule = shot.dialogue?.trim()
    ? `本镜唯一允许出现的可辨识中文对白原文是：“${shot.dialogue.trim()}”。必须逐字、按时间轴由提示词明确指定的唯一说话人说出，不得改写、重复、增补或交给其他角色。声源必须与该人物在画面中的口部位置绑定，并保持其人物设定对应的年龄、性别和音色，不得变成其他角色的声音、错误性别/年龄音色、画外音或群众声；说话前自然吸气启唇，说话期间嘴唇、下颌和脸颊持续自然运动并与整句中文口型同步，说完自然收口。未说话角色不形成说话音节、不得与对白同步张嘴，但允许双唇自然合拢或微松，并保留下颌、吞咽、呼吸、脸颊和视线的无声反应；不得新增旁白、VO、画外人声或无来源群众喊话。`
    : '本镜没有指定对白，所有角色不形成可辨识语言或说话音节；双唇可以自然合拢或微松，并保留下颌、吞咽、呼吸、脸颊和视线的自然反应，只保留时间轴明确的环境声和动作音效。';
  return `【连续性与生成约束】
请保持时间轴的因果顺序和核心动作结果，但不要把人物表演或走位写成固定坐标。三维空间通过场景拓扑、稳定物体和人物与锚点之间的相对关系保持清楚，光源方向与轴线按照镜头设计延续。用高台、门口、道路、桌面、台阶或另一人物建立世界坐标，区分人物脚下落点、躯干/骨盆朝向、脸部朝向、视线目标和屏幕方向；人物可以依据剧情自然走动、转身、靠近、后退、瞬移、闪现、改变姿态、视线、表情、手势和身体重心，中间表演允许根据性格、能力设定和现场刺激自然发挥。用台阶踏步、栏杆、门框、桌面、车辆或另一人物肩线维持人物相对身高、头身比例和体型关系；景别变化只能改变画面占比，不得改变人物真实尺度。人物位置变化使用画面中稳定可见的参照物。时间轴每个区间都要交代主要人物和关键道具所在支撑平面、相对锚点方位、彼此距离及是否进入伸手/落脚/近身范围；没有位移时也要承接上一段的位置状态。任何踩踏、抓取、拥抱、递交、推拉或攻击发生前，必须先通过走近、下阶、跨步、俯身、伸手或已设定的超自然位移进入可达空间，不得让高台上的人物直接接触台下地面的目标。普通走位写清起点、经过区域、距离如何缩短或拉开、进入伸手或落脚范围的时刻和最终相对位置；若本镜事实明确是瞬移、闪现、缩地、遁光或空间跃迁，则写清发动前相对位置、触发动作、残影/灵光/空间扭曲等起点特效、消失与现身衔接、相对目标的落点/朝向/距离，以及现身时的风压、尘土、衣摆和光影反馈，再自然承接踩踏、攻击、交接或其他后续动作。允许一次服务核心动作或情绪落点的表情、手部、动作接触或道具特写；特写只改变取景范围或焦点，前后必须继承同一动作轴线、世界面朝目标、屏幕方向、视线关系和人物尺度，不得镜像翻面、凭空换边、无因转身或改变身高体型。没有在提示词中明确设计特写时不得擅自增加。${coreAction}不得省略、替换或提前结束。
不要引入新人物、新场景、新道具或无关动作。${transitionRule}不得从开场状态直接跳到后续状态，必须呈现中间动作和因果过程。不要在生成画面中渲染字幕、对白文字、贴纸、水印或任何其他文字。
${dialogueRule}保留写实、连续的环境声。保持首帧、尾帧与本提示词的起止状态一致。
【连续性与生成约束结束】`;
}

function applyControlledTransitionPrompt(shot: WsShot, prompt?: string): string {
  const body = (prompt ?? '')
    .replace(CONTROLLED_TRANSITION_BLOCK_RE, '\n')
    .replace(CONTINUITY_GUARD_BLOCK_RE, '\n')
    .trim();
  const transition = transitionPromptForShot(shot);
  if (!body && !transition) return '';
  return [body, transition, continuityGuardPromptForShot(shot)].filter(Boolean).join('\n').trim();
}

/**
 * 去掉生成期由系统追加的【受控转场】与【连续性与生成约束】块，得到「模型原文」。
 *
 * 为什么需要它：`applyVideoPlanningReferencePrefixes()` 会把这两块拼到模型写回的提示词
 * 之后，而这两块的正文里含有「转场」「特写」「视线」「光源」「门框」「本镜没有指定对白」
 * 等字样。任何**对提示词内容做判定**的地方如果量的是拼接后的文本，就会同时犯两类错：
 *
 * - **假警告**：规则文本自身命中关键词。例如「不要增加随意的镜头剪切、场景转场…」
 *   让「出现内部切镜/换场」恒成立；「本镜没有指定对白」让「不要写本镜没有旁白」恒成立；
 *   长度门禁量到的是「原文 + 约 1000 字规则」，于是 466 字被判「过长（1473字）」。
 * - **遮蔽**：存在性检查被规则文本满足而恒为真。例如「允许…道具特写」让
 *   「缺少明确的主要运镜」永不报警，「光源方向」让「缺少光线」永不报警。
 *
 * 所以**内容判定必须量模型原文**；而「是否已追加受控转场块」这类判定仍应量完整文本。
 */
export function stripGeneratedVideoBlocks(prompt?: string): string {
  return (prompt ?? '')
    .replace(CONTROLLED_TRANSITION_BLOCK_RE, '\n')
    .replace(CONTINUITY_GUARD_BLOCK_RE, '\n')
    .trim();
}

/** 生成或手动写入视频提示词时统一补齐可选参考前缀。 */
export function applyVideoPlanningReferencePrefixes(
  shot: WsShot,
  prompt?: string,
  options: VideoRefBindingOptions = {},
): string {
  const body = stripDirectorConstraintVideoPrefix(stripStoryboardVideoPrefix(prompt));
  // MiniMax H3 consumes its official prompt as-is. The legacy transition and
  // continuity blocks are incompatible with integrated_multimodal_description.
  if (isMiniMaxH3Model(shot.videoModel ?? '')) return body.trim();
  const prefixes = [
    options.includeStoryboardBoards === false ? '' : storyboardVideoPrefix(shot.storyboardBoards ?? [], shot, options),
    directorConstraintVideoPrefix(shot, options),
  ].filter(Boolean);
  return applyControlledTransitionPrompt(shot, [...prefixes, body].filter(Boolean).join('\n'));
}

/** 新版提示词必须逐一声明实际提交的图片资产；模型改写遗漏时在统一出口确定性补齐。 */
export function ensureUniversalVideoPromptAssetMentions(
  prompt: string | undefined,
  bindings: ShotRefBinding[],
): string {
  const body = (prompt ?? '').trim();
  if (!body || bindings.length === 0) return body;

  const usedIndices = new Set<number>();
  for (const match of body.matchAll(/@图片([一二三四五六七八九十]+|\d+)/g)) {
    const index = /^\d+$/.test(match[1]) ? Number(match[1]) : NUM_TO_CN.indexOf(match[1]) + 1;
    if (index > 0) usedIndices.add(index);
  }
  const missingLines = bindings
    .filter((binding) => !usedIndices.has(binding.index))
    .map((binding) => {
      const safeLabel = binding.kind === 'extra'
        ? `额外参考图 ${binding.index}`
        : binding.label.replace(/\S+\.(?:png|jpe?g|webp|gif|bmp|tiff?)\b/gi, '').trim() || '参考素材';
      return `- @图片${numToCn(binding.index)}：${safeLabel}。`;
    });
  if (missingLines.length === 0) return body;

  const identityHeading = '【素材身份】';
  if (body.includes(identityHeading)) {
    return body.replace(identityHeading, `${identityHeading}\n${missingLines.join('\n')}\n`);
  }
  return `${identityHeading}\n${missingLines.join('\n')}\n${body}`;
}

/** H3 首尾帧属于提交时注入的运行时素材，不能残留在基础视频提示词里。 */
export function stripRuntimeBoundaryImageMentions(prompt: string | undefined, assetCount: number): string {
  const body = (prompt ?? '').trim();
  if (!body) return body;
  const imageRefPattern = /@图片([一二三四五六七八九十]+|\d+)/g;
  const parseIndex = (raw: string) => /^\d+$/.test(raw) ? Number(raw) : NUM_TO_CN.indexOf(raw) + 1;
  return body
    .split(/\r?\n/)
    .filter((line) => {
      const indices = [...line.matchAll(imageRefPattern)].map((match) => parseIndex(match[1]));
      const hasRuntimeRef = indices.some((index) => index > assetCount);
      return !(hasRuntimeRef && (/^\s*[-*]?\s*@图片/u.test(line) || /(?:上一镜|当前镜).{0,8}(?:首帧|尾帧)/u.test(line)));
    })
    .map((line) => line.replace(imageRefPattern, (match, raw: string) => parseIndex(raw) > assetCount ? '' : match))
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 在不改写存量提示词的前提下，为 Seedance 2.5 隐藏故事板并重排 @图片N。 */
export function seedance25PromptForShot(shot: WsShot, ctx: ShotRefsContext): string {
  if (shot.seedance25VideoPrompt?.trim()) {
    return applyVideoPlanningReferencePrefixes(
      shot,
      shot.seedance25VideoPrompt,
      { includeStoryboardBoards: false },
    );
  }
  const fullRefs = buildVideoRefBindings(shot, ctx);
  const seedance25Refs = buildVideoRefBindings(shot, ctx, { includeStoryboardBoards: false });
  const remapped = replaceImageMentionsByBinding(shot.videoPrompt, fullRefs, seedance25Refs);
  return applyVideoPlanningReferencePrefixes(
    shot,
    remapped,
    { includeStoryboardBoards: false },
  );
}

/**
 * Resolve the active prompt variant without mutating either saved template.
 * Seedance 2.5 keeps its historical no-storyboard prompt slot because its
 * submitted reference scope differs from the normal full storyboard scope.
 */
export function videoPromptForShot(
  shot: WsShot,
  ctx: ShotRefsContext,
  options: {
    template: 'legacy' | 'universal';
    includeStoryboardBoards: boolean;
    requireApprovedStoryboardBoards?: boolean;
    includeDirectorConstraintCard?: boolean;
    skipPlanningAugmentation?: boolean;
  },
): string {
  const fullRefs = buildVideoRefBindings(shot, ctx);
  const targetRefs = buildVideoRefBindings(shot, ctx, {
    includeStoryboardBoards: options.includeStoryboardBoards,
    requireApprovedStoryboardBoards: options.requireApprovedStoryboardBoards,
    includeDirectorConstraintCard: options.includeDirectorConstraintCard,
  });
  const usesHistoricalNoStoryboardPrompt = options.template === 'universal'
    && !options.includeStoryboardBoards
    && !shot.universalVideoPrompt?.trim()
    && Boolean(shot.seedance25VideoPrompt?.trim());
  const basePrompt = options.template === 'universal'
    ? shot.universalVideoPrompt || shot.seedance25VideoPrompt || ''
    : shot.videoPrompt || '';
  if (options.skipPlanningAugmentation) return basePrompt.trim();
  const remapped = options.includeStoryboardBoards || usesHistoricalNoStoryboardPrompt
    ? basePrompt
    : replaceImageMentionsByBinding(basePrompt, fullRefs, targetRefs);
  const promptWithRequiredAssets = options.template === 'universal'
    ? ensureUniversalVideoPromptAssetMentions(
        stripRuntimeBoundaryImageMentions(remapped, targetRefs.length),
        targetRefs,
      )
    : remapped;
  return applyVideoPlanningReferencePrefixes(shot, promptWithRequiredAssets, {
    includeStoryboardBoards: options.includeStoryboardBoards,
    requireApprovedStoryboardBoards: options.requireApprovedStoryboardBoards,
    includeDirectorConstraintCard: options.includeDirectorConstraintCard,
  });
}
