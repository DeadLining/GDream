import { PROP_ASSET_DESCRIPTION, SHOT_PROP_IDS_DESCRIPTION } from '@/lib/workshop/assetScope';
import { hasNonVideoPromptPayload } from '@/lib/workshop/promptWritePayload';
import { readVideoEvidenceTool, recordVideoReviewTool } from './videoEvidenceTools';
import type { AgentUserContentBlock } from '../types';
import { readNativeImage } from '../nativeImageInput';
import { reconcileCharacterIdentity, remapCharacterReferences } from '@/lib/workshop/characterIdentity';
import { adGetReferencePlanTool, adReadReferenceImagesTool, adSetReferencePlanTool } from './adReferencePlanTool';
import { generationRequest, needsGeneration } from '@/lib/workshop/generationRequest';
import { adResearchCanvasTool } from './adResearchCanvasTool';
import { projectAdCreativeSpec } from '@/lib/workshop/adStateProjection';
import { adMaterialsTool, adProductImagesTool } from './adMaterialsTool';
import { adMaterialsError } from '@/lib/workshop/adMaterials';
import { rewriteWorkshopShotVideo } from '@/lib/workshop/rewriteShotVideo';
import { selectPromptShots, promptShotFacts } from '@/lib/workshop/promptState';
import { planDialogueSync } from '@/lib/workshop/dialogueSync';
import { parseShotSyncAuthorization, permitsShotSync } from '@/lib/workshop/shotSyncAuthorization';
import { dialogueSupportedByScreenplay as supportsRestoredDialogue } from '@/lib/workshop/breakdownWrite';
import { breakdownReconciliationState, breakdownQueueInstruction, pendingBreakdownUnits, recordBreakdownWork } from '@/lib/workshop/breakdownQueue';
import { resolveWorkshopExecutionTask } from '../executionRecovery';
/**
 * workshopTools — agent tools that operate the creation workshop directly.
 * Mirrors the timelineTools pattern: tools mutate workshopStore, the
 * workshop UI updates reactively. Gated to activeView==='workshop'.
 */
import type { Tool } from '../types';
import { WorkshopStatePager, isInitialWorkshopStateRead, normalizeWorkshopStateRead } from '../workshopStatePaging';
import { missingPersistedShotResult } from '../missingShotRecovery';
import { buildEpisodeScriptState } from '@/lib/workshop/episodeScriptState';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useCanvasTaskStore } from '@/stores/canvasTaskStore';
import { useRunStepStore } from '@/stores/runStepStore';
import { listProjectFiles, projectAbsPath } from '@/lib/aigc/projectStore';
import type { AssetCandidate, AudioCandidate, ScriptReviewReceipt, StoryboardFrame, WorkshopAssetKind, WorkshopEpisode, WorkshopProjectBibles, WorkshopStepId, WsCharacter, WsCharacterHandoff, WsNarrativeBeat, WsProp, WsScene, WsShot } from '@/lib/workshop/types';
import { writeProjectFile } from '@/lib/aigc/projectStore';
import { homeDir } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/tauri';
import { findAiDramaPerformanceHits } from '@/lib/videoPrompt/performance';
import {
  applyVideoPlanningReferencePrefixes,
  buildImageRefBindings,
  buildStoryboardFrameRefBindings,
  buildVideoRefBindings,
  compactStoryboardFrameReferences,
  ensureDirectorConstraintMention,
  effectiveOpeningCharacterIds,
  getSceneReferencePaths,
  numToCn,
  patchTouchesRefs,
  remapShotPromptRefs,
  shotReferenceSignature,
  stripDirectorConstraintMention,
  stripGeneratedVideoBlocks,
  type ShotRefBinding,
} from '@/lib/workshop/shotRefs';
import {
  classifyWorkshopEditScope,
  findUnsupportedPromptDialogue,
  findUnsupportedRelationshipClaims,
  isTextSupportedByCanonical,
  validateAudioPromptsAgainstShot,
  valuesEqual,
  type WorkshopEditScope,
} from '@/lib/workshop/narrativeGuard';
import { acceptVideoCandidate, videoCandidateFingerprint, videoCandidateMatchesProductionInput } from '@/lib/workshop/productionLifecycle';
import { acceptAudioCandidate, audioCandidateFingerprint } from '@/lib/workshop/audioLifecycle';
import { buildProductionAudit } from '@/lib/workshop/productionAudit';
import { assetCandidateFingerprint } from '@/lib/workshop/assetLineage';
import { reasonsForStepCompletion } from '@/lib/workshop/stepStatus';
import { ALLOWED_BEAT_PURPOSES, validateBreakdownInput } from '@/lib/workshop/breakdownValidation';
import {
  buildProspectiveShots,
  collectShotWriteConflicts,
  shotScreenplaySource,
  compileNarrativeBeatShotNos,
  mergeBreakdownRecords,
  mergeNarrativeBeats,
  resolveBreakdownWriteMode,
  sortNarrativeBeats,
  type BreakdownWriteMode,
} from '@/lib/workshop/breakdownWrite';
import { normalizeWorkshopArrayParam } from '../toolArgumentParsing';
import { workshopBreakdownRequiredFields } from '@/lib/workshop/breakdownSchema';
import { validateCharacterHandoffs } from '@/lib/workshop/characterContinuity';
import { planStructureRestore } from '@/lib/workshop/scriptStructureRestore';
import { isMiniMaxH3Model, projectMiniMaxH3Ref2vaCapabilities } from '@/lib/workshop/providerCapabilities';
import { shouldUsePreviousTail } from '@/lib/workshop/shotContinuity';
import { enqueueVideoGeneration } from '@/lib/workshop/videoGenerationQueue';
import { currentVideoQualityReview, qualityReviewerFingerprint } from '@/lib/workshop/qualityReview';
import { normalizeMiniMaxH3DialogueEmissions, sanitizeMiniMaxH3Prompt, validateMiniMaxH3VideoPrompt } from '@/lib/workshop/h3PromptContract';
import type { SglangH3Task } from '@/lib/canvasGen/sglangH3';
import { promptHasVisibleCharacterMention } from '@/lib/workshop/promptCharacterGuard';
import {
  IMAGE_PROMPT_BUDGET,
  budgetLabel,
  planningModeLabel,
  videoPromptBudget,
} from '@/lib/workshop/promptLengthBudget';

const STEP_IDS = ['script', 'breakdown', 'assets', 'prompts', 'generate', 'handoff'];

const NUM_TO_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五'];

function currentWorkshopEditScope(): { scope: WorkshopEditScope; request: string } {
  const runState = useRunStepStore.getState();
  const run = runState.currentRunId ? runState.runsById[runState.currentRunId] : undefined;
  const request = run?.userRequest?.trim() ?? '';
  const scope = classifyWorkshopEditScope(request);
  return { scope: scope === 'unknown' && resolveWorkshopExecutionTask(request, useWorkshopStore.getState().data) ? 'breakdown' : scope, request };
}

function currentShotSyncConsent() {
  const state = useRunStepStore.getState();
  const run = state.currentRunId ? state.runsById[state.currentRunId] : undefined;
  const data = useWorkshopStore.getState().data;
  if (!run || run.status !== 'running' || !data) return undefined;
  const saved = run.workshopShotSync;
  if (saved?.projectId === data.projectId && saved.revisionId === data.currentScriptRevisionId) return saved;
  return parseShotSyncAuthorization(run.userRequest);
}

function guardError(action: string, request: string): string {
  return [
    `事实锁已阻止${action}。当前用户要求被识别为“${request || '未明确要求改剧本'}”，不是剧本改写。`,
    '修改提示词时只能写 imagePrompt/videoPrompt/audioPrompts，不得顺带改画面描述、对白、角色、场景或道具关系。',
    '只有用户明确要求修改剧本、剧情、对白、人物关系，或明确要求重排分镜结构时，才能改对应字段。',
  ].join('\n');
}

/**
 * 失败批次落盘：整批校验失败时保存原始 payload 和逐条错误，避免模型上下文
 * 丢失后无法定位到底哪一镜哪个字段错了。文件写在项目目录下，不进入 git。
 */
async function persistRejectedShotBatch(
  projectId: string | undefined,
  incoming: readonly Partial<WsShot>[],
  mode: string,
  error: string,
): Promise<void> {
  if (!projectId) return;
  const shotNos = incoming
    .map((shot) => (typeof shot.shotNo === 'string' ? shot.shotNo.trim() : ''))
    .filter(Boolean)
    .join(',') || 'unknown';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const relPath = `breakdown/rejected-shots/${stamp}-${mode}-${shotNos.replace(/[^\w,-]+/g, '_').slice(0, 40)}.json`;
  await writeProjectFile(projectId, relPath, JSON.stringify({
    savedAt: new Date().toISOString(),
    mode,
    shotNos,
    error,
    shots: incoming,
  }, null, 2));
}

/**
 * 自动将提示词中的 @文件名.ext 引用转换为 @图片N 格式。
 * 映射规则：最终场景资产在前；只有用户明确启用多角度参考时，场景参考组才连续占位，角色/道具随后。
 */
function normalizePromptRefs(shotNo: string, prompt: string, mode: 'image' | 'video'): string {
  const s = useWorkshopStore.getState();
  if (!s.data) return prompt;
  const shot = s.data.shots.find((x) => x.shotNo === shotNo);
  if (!shot) return prompt;

  const context = {
    scenes: s.data.scenes,
    characters: s.data.characters,
    props: s.data.props ?? [],
    colorPalettes: s.data.colorPalettes ?? [],
    globalColorPaletteId: s.data.globalColorPaletteId,
  };
  const effectiveModel = shot.videoModel || s.data.videoModel || '';
  const h3Task = useWorkshopStore.getState().getH3InputMode() as SglangH3Task;
  const omitStoryboardForRef2va = mode === 'video'
    && isMiniMaxH3Model(effectiveModel)
    && h3Task === 'ref2va';
  const bindings = mode === 'video'
    ? buildVideoRefBindings(shot, context, { includeStoryboardBoards: !omitStoryboardForRef2va })
    : buildImageRefBindings(shot, context);
  const fileToIdx = new Map<string, number>();
  for (const binding of bindings) {
    const fileName = binding.path.split('/').pop();
    if (fileName && !fileToIdx.has(fileName)) fileToIdx.set(fileName, binding.index);
  }
  const paletteIdx = bindings.find((binding) => binding.kind === 'palette')?.index ?? null;

  // Models sometimes serialize a multiline prompt as literal "\\n" text.
  // Store real line breaks so the prompt editor and downstream providers do
  // not receive the escape sequence as visible content.
  let nextPrompt = prompt.replace(/\\n/g, '\n').replace(/@([^\s@,;，；]+\.\w{2,5})/g, (_match, fileName: string) => {
    const i = fileToIdx.get(fileName);
    return i ? `@图片${numToCn(i)}` : _match;
  });
  if (paletteIdx) {
    nextPrompt = nextPrompt.replace(/@色卡|色卡对应的@图片N|色卡对应的 @图片N/g, `@图片${numToCn(paletteIdx)}`);
  }
  const looksLikeH3Prompt = /\b(?:integrated_multimodal_description|subject_definitions|detailed_description|overall_soundscape|non_diegetic_music)\s*:/i.test(nextPrompt);
  const isH3Video = mode === 'video' && (isMiniMaxH3Model(effectiveModel) || looksLikeH3Prompt);
  // H3 提示词必须保持官方 skill 原始结构，禁止拼接旧中文导演约束。
  if (isH3Video) return normalizeMiniMaxH3DialogueEmissions(sanitizeMiniMaxH3Prompt(nextPrompt, h3Task), shot.dialogue);
  // Agent 写回非 H3 视频提示词时固化分镜板/导演约束卡前缀。
  // “生成视频”才临时补。这样界面、校验、画布和实际请求看到的是同一份 prompt。
  return mode === 'video'
    ? applyVideoPlanningReferencePrefixes(shot, nextPrompt, {
      includeStoryboardBoards: !isMiniMaxH3Model(shot.videoModel || s.data.videoModel || ''),
      includeDirectorConstraintCard: !isMiniMaxH3Model(shot.videoModel || s.data.videoModel || ''),
    })
    : nextPrompt;
}

function textLen(text?: string): number {
  return (text ?? '').replace(/\s+/g, '').length;
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

function countPattern(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

/**
 * 导演级内容检查（长度、运镜、光线、表演、空间层次、材质、内部切镜…）。
 *
 * **导出供探针复用**：探针桩的 `workshop_set_prompts` 曾经完全不返回这一块，
 * 于是探针的对话记录里看不到任何内容质量反馈——F10（④ 的 videoPrompt 系统性偏短）
 * 因此只能靠人工分析留档参数才能发现，探针自己报不出来。
 * 桩若自己近似一遍这套规则，就会重演 F17 的口径漂移；所以两边共用这一份实现。
 */
export function collectDirectorPromptWarnings(shot: WsShot, imagePrompt?: string, videoPrompt?: string): string[] {
  const shotNo = shot.shotNo;
  const warnings: string[] = [];

  if (imagePrompt !== undefined) {
    const len = textLen(imagePrompt);
    if (len < IMAGE_PROMPT_BUDGET.min) warnings.push(`${shotNo}: imagePrompt 过短（${len}字），建议写到 ${budgetLabel(IMAGE_PROMPT_BUDGET)} 字，需要空间锚点、主体站位、景别构图、表演瞬间、光线色温和材质细节`);
    if (len > IMAGE_PROMPT_BUDGET.max) warnings.push(`${shotNo}: imagePrompt 过长（${len}字），超出建议上限 ${IMAGE_PROMPT_BUDGET.max} 字；只描述 0.00 秒首帧，色卡与画风约束在末句统一写一次，不要展开后续动作`);
    if (!/@图片[一二三四五六七八九十]/.test(imagePrompt)) warnings.push(`${shotNo}: imagePrompt 缺少 @图片N 参考图引用`);
    if (!hasAny(imagePrompt, [/景|构图|特写|近景|中景|全景|远景|过肩|俯拍|仰拍/])) warnings.push(`${shotNo}: imagePrompt 缺少明确景别/构图`);
    if (!hasAny(imagePrompt, [/光|灯|阴影|色温|逆光|侧光|顶光|冷白|暖黄|霓虹|月光|日光|反光/])) warnings.push(`${shotNo}: imagePrompt 缺少光线/色温描述`);
    if (countPattern(imagePrompt, /画面配色严格参考/g) > 1 || countPattern(imagePrompt, /色卡/g) > 2) {
      warnings.push(`${shotNo}: imagePrompt 色卡/配色约束出现过多；色卡只在最后一句统一写一次，不要在每个画面短句重复`);
    }
    const imageDramaHits = findAiDramaPerformanceHits(imagePrompt);
    if (imageDramaHits.length > 0) {
      warnings.push(`${shotNo}: imagePrompt 含 AI 短剧/漫剧风表演词（${imageDramaHits.join('、')}）；请核对表演触发与剧情依据；有依据的强烈情绪应保留，不自动改成克制`);
    }
  }

  if (videoPrompt !== undefined) {
    // 内容判定必须量「模型原文」。`normalizePromptRefs()` 已把系统追加的
    // 【受控转场】/【连续性与生成约束】块拼进来，而那两块正文含有「转场」「特写」
    // 「视线」「光源」「门框」「本镜没有指定对白」等字样：直接量拼接文本会既产生
    // 假警告（466 字被判「过长（1473字）」），又让存在性检查恒为真（运镜/光线/
    // 表演/空间层次/材质 永不报警）。见 `stripGeneratedVideoBlocks()` 的注释。
    const authored = stripGeneratedVideoBlocks(videoPrompt);
    const len = textLen(authored);
    const isTimelineShot = shot.shotPlanningMode === 'single-timeline';
    // 长度阈值与提示词文案同源（`promptLengthBudget.ts`）：阈值就是告知模型的区间端点。
    // 曾经这里是 `(isTimelineShot ? 500 : 240)` / `(isTimelineShot ? 1400 : 650)`，
    // 而提示词说的是 500-1200 → 1200-1400 成为静默区（既不满足契约也拿不到反馈）。
    // storecheck 的 A9/A10 已实测确认：还原旧阈值后两项立刻转 DIFF、退出码 1。
    const budget = videoPromptBudget(shot.shotPlanningMode);
    if (len < budget.min) warnings.push(`${shotNo}: videoPrompt 过短（${len}字），${planningModeLabel(shot.shotPlanningMode)}建议写到 ${budgetLabel(budget)} 字`);
    if (len > budget.max) warnings.push(`${shotNo}: videoPrompt 过长（${len}字），超出建议上限 ${budget.max} 字；可能在提示词中继续发展剧情，请压缩到既定时间轴和主叙事线`);
    if (isTimelineShot && !/\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-—–~至]\s*\d+(?:\.\d+)?\s*(?:s|秒)/iu.test(authored)) {
      warnings.push(`${shotNo}: single-timeline videoPrompt 缺少可识别的时间段，必须按 0.0-8.0 秒等顺序写清每个节拍`);
    }
    if (!hasAny(authored, [/光|灯|阴影|色温|逆光|侧光|顶光|冷白|暖黄|霓虹|月光|日光|反光/])) warnings.push(`${shotNo}: videoPrompt 缺少光线/色温变化`);
    if (!hasAny(authored, [/摩擦|变形|破裂|碎|灰尘|水面|雪|衣摆|发丝|玻璃|金属|木|地面|墙面|褶皱|震动|回声|反弹|溅|晃动/])) warnings.push(`${shotNo}: videoPrompt 缺少材质变化或环境物理反馈`);
    if (!hasAny(authored, [/前景|中景|背景|遮挡|纵深|门框|窗框|货架|栏杆|玻璃后|人群后/])) warnings.push(`${shotNo}: videoPrompt 缺少空间层次（前景/中景/背景或遮挡关系）`);
    const hasTransitionPlan = Boolean(shot.transitionPlan?.kind
      && shot.transitionPlan.trigger?.trim()
      && shot.transitionPlan.target?.trim()
      && shot.transitionPlan.prompt?.trim());
    if (!hasTransitionPlan && /切到|硬切|正反打|匹配剪辑|快切|慢切|转场|另一边|与此同时|几分钟后|几小时后|第二天|次日|闪回|梦境/u.test(authored)) {
      warnings.push(`${shotNo}: 普通镜头的 videoPrompt 出现内部切镜、换场、跳时或并行动作信号；如确需一次强场景变化，请先配置完整 transitionPlan`);
    }
    // 这一条反过来：它判的是「系统有没有把受控转场块追加进来」，必须量完整文本。
    if (hasTransitionPlan && !videoPrompt.includes('【受控转场】')) {
      warnings.push(`${shotNo}: 已配置 transitionPlan，但 videoPrompt 缺少自动受控转场约束；请重新写入提示词`);
    }
    if (/正反打|快切|另一边|与此同时/u.test(authored)) {
      warnings.push(`${shotNo}: videoPrompt 出现多机位剪辑或并行动作信号；受控转场也只允许一次连续场景变化`);
    }
    if (/切换到镜头\S*的理由|切换理由|理由[:：]/.test(authored)) {
      warnings.push(`${shotNo}: videoPrompt 不要写"理由"说明或"切换到某镜头的理由"这类分析文字；请把剪辑动机改写为画面内可见的动作、视线、声音或情绪触发点`);
    }
    if (/(?:没有|无|不需要|无需).{0,8}(?:VO|vo|旁白|画外音)|(?:VO|vo|旁白|画外音).{0,8}(?:没有|无|不需要|无需)|本句没有|本镜没有/.test(authored)) {
      warnings.push(`${shotNo}: videoPrompt 不要写"本句没有VO/本镜没有旁白/无画外音"这类占位说明；没有旁白就完全省略 VO 行`);
    }
    if (/很悲伤|很愤怒|很紧张|非常悲伤|非常愤怒|非常紧张|情绪复杂|氛围感|电影感十足/.test(authored)) {
      warnings.push(`${shotNo}: videoPrompt 出现抽象情绪/空泛形容，需改成可见的身体动作和环境反馈`);
    }
    const videoDramaHits = findAiDramaPerformanceHits(authored);
    if (videoDramaHits.length > 0) {
      warnings.push(`${shotNo}: videoPrompt 含 AI 短剧/漫剧风表演词（${videoDramaHits.join('、')}）；请核对行为目的与刺激依据；这是表达建议，不是删改原剧情情绪的依据，也不要求一律克制`);
    }
    if (countPattern(authored, /画面配色严格参考/g) > 1 || countPattern(authored, /全片画面配色严格参考/g) > 1 || countPattern(authored, /色卡/g) > 3) {
      warnings.push(`${shotNo}: videoPrompt 色卡/配色约束重复出现；色卡是全局风格参考，只能在全文最后一句点名一次`);
    }
  }

  return warnings;
}

function countStoryboardBoardRefs(shot: WsShot): number {
  return (shot.storyboardBoards ?? []).filter((board) => board.imagePath && board.useInVideo !== false).length;
}

function firstPromptSentence(prompt: string): string {
  const trimmed = prompt.trim();
  const match = trimmed.match(/^[\s\S]{1,260}?[。！？\n]/);
  return match ? match[0] : trimmed.slice(0, 260);
}

function buildShotRequiredRefs(shot: WsShot, data: NonNullable<ReturnType<typeof useWorkshopStore.getState>['data']>) {
  const bindings = buildShotRefBindings(shot, data);
  const sceneRefIndices = bindings.filter((ref) => ref.kind === 'scene').map((ref) => ref.index);
  return {
    refs: bindings.map((ref) => ({ index: ref.index, label: ref.label })),
    sceneRefCount: sceneRefIndices.length,
    sceneRefIndices,
  };
}

function buildShotRefBindings(shot: WsShot, data: NonNullable<ReturnType<typeof useWorkshopStore.getState>['data']>): ShotRefBinding[] {
  const isH3Ref2va = isMiniMaxH3Model(shot.videoModel || data.videoModel || '')
    && useWorkshopStore.getState().getH3InputMode() === 'ref2va';
  return buildVideoRefBindings(shot, {
    scenes: data.scenes,
    characters: data.characters,
    props: data.props ?? [],
    colorPalettes: data.colorPalettes ?? [],
    globalColorPaletteId: data.globalColorPaletteId,
  }, { includeStoryboardBoards: !isH3Ref2va });
}

let videoGenerationTail: Promise<unknown> = Promise.resolve();

function ref2vaPreflightFailures(
  shots: WsShot[],
  data: NonNullable<ReturnType<typeof useWorkshopStore.getState>['data']>,
): string[] {
  if (useWorkshopStore.getState().getH3InputMode() !== 'ref2va') return [];
  return shots.flatMap((shot) => {
    const model = shot.videoModel || data.videoModel || '';
    if (!isMiniMaxH3Model(model)) return [];
    const shotIndex = data.shots.findIndex((item) => item.shotNo === shot.shotNo);
    const previousShot = shotIndex > 0 ? data.shots[shotIndex - 1] : undefined;
    const previousTailCount = shouldUsePreviousTail(shot, previousShot) && previousShot?.videoEndFramePath ? 1 : 0;
    const generatedAudioCount = shot.audioInjected && shot.generatedAudios?.length
      ? shot.generatedAudios.length
      : (shot.voiceCharacterIds ?? []).filter((characterId) => data.characters.some((character) => character.id === characterId && character.voicePath)).length;
    const projection = projectMiniMaxH3Ref2vaCapabilities({
      imageCount: buildShotRefBindings(shot, data).length + previousTailCount,
      audioCount: generatedAudioCount,
      videoCount: 0,
    });
    return projection.canSubmit ? [] : [`${shot.shotNo}: ${projection.summary}`];
  });
}

function remapPromptRefsForShot(
  oldShot: WsShot,
  nextShot: WsShot,
  data: NonNullable<ReturnType<typeof useWorkshopStore.getState>['data']>,
): Partial<WsShot> {
  return remapShotPromptRefs(oldShot, nextShot, data);
}

function touchesReferenceFields(patch: Partial<WsShot>): boolean {
  return patchTouchesRefs(patch);
}

function sameStringArray(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  return a.every((item, i) => item === b[i]);
}

function verifyShotPatch(latest: WsShot, patch: Partial<WsShot>): string[] {
  const failures: string[] = [];
  const arrayFields: Array<keyof WsShot> = ['characterIds', 'propIds', 'assetPropIds', 'sceneImagePaths', 'extraRefImages', 'voiceCharacterIds'];
  for (const key of arrayFields) {
    if (key in patch && !sameStringArray(latest[key], patch[key])) failures.push(String(key));
  }
  const scalarFields: Array<keyof WsShot> = ['sceneId', 'imagePath', 'videoPath', 'videoThumbPath', 'videoRatio'];
  for (const key of scalarFields) {
    if (key in patch && latest[key] !== patch[key]) failures.push(String(key));
  }
  return failures;
}

function parseImageRefIndex(ref: unknown): number | null {
  if (typeof ref === 'number' && Number.isFinite(ref)) return Math.max(1, Math.floor(ref));
  if (typeof ref !== 'string') return null;
  const m = ref.match(/@?图片([一二三四五六七八九十]|\d+)/);
  if (!m) return null;
  const raw = m[1];
  const cn = NUM_TO_CN.indexOf(raw);
  if (cn >= 0) return cn + 1;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function uniqStrings(items: unknown[]): string[] {
  return [...new Set(items.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()))];
}

function mergeAudioPrompts(
  existing: WsShot['audioPrompts'],
  incoming: WsShot['audioPrompts'],
): NonNullable<WsShot['audioPrompts']> {
  const merged = (existing ?? []).map((item) => ({ ...item }));
  for (const item of incoming ?? []) {
    const characterId = typeof item?.characterId === 'string' ? item.characterId.trim() : '';
    if (!characterId || typeof item?.prompt !== 'string') continue;
    const next = { characterId, prompt: item.prompt };
    const index = merged.findIndex((current) => current.characterId === characterId);
    if (index >= 0) merged[index] = next;
    else merged.push(next);
  }
  return merged;
}

function collectUnlinkedCharacterWarnings(
  shotNo: string,
  shot: WsShot,
  data: NonNullable<ReturnType<typeof useWorkshopStore.getState>['data']>,
  prompts: Array<string | undefined>,
): string[] {
  const text = prompts.filter(Boolean).join('\n');
  if (!text) return [];
  const linkedIds = new Set(effectiveOpeningCharacterIds(shot, data.characters));
  return data.characters
    .filter((character) => character.name && !linkedIds.has(character.id) && promptHasVisibleCharacterMention(text, character.name))
    .map((character) => `${shotNo}: 提示词写了角色“${character.name}”，但本镜 characterIds 未包含该角色。需要他露脸时，先用 workshop_update_shot_refs 加入 ${character.id}；若只是背景身影/剪影，请改用无名的描述性称谓（如“身后的队友”“只露出剪影的身影”），不要写出具体角色名。`);
}

function validatePromptPatch(
  shotNo: string,
  shot: WsShot,
  data: NonNullable<ReturnType<typeof useWorkshopStore.getState>['data']>,
  imagePrompt?: string,
  videoPrompt?: string,
): { promptNeedsRefresh: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const effectiveVideoModel = shot.videoModel || data.videoModel || '';
  const isH3 = isMiniMaxH3Model(effectiveVideoModel);
  warnings.push(...collectDirectorPromptWarnings(shot, imagePrompt, isH3 ? undefined : videoPrompt));
  if (isH3 && videoPrompt) {
    warnings.push(...validateMiniMaxH3VideoPrompt(
      videoPrompt,
      shot.durationSec ?? 5,
      shot.dialogue,
      useWorkshopStore.getState().getH3InputMode(),
    ).map((warning) => `${shotNo}: ${warning}`));
  }
  warnings.push(...collectUnlinkedCharacterWarnings(shotNo, shot, data, [imagePrompt, videoPrompt]));

  if (videoPrompt) {
    const effectiveVideoModel = shot.videoModel || data.videoModel || '';
    const h3Task = useWorkshopStore.getState().getH3InputMode();
    const isH3 = isMiniMaxH3Model(effectiveVideoModel);
    const h3WithoutAssetRefs = isH3 && h3Task !== 'ref2va';
    if (!h3WithoutAssetRefs) {
      const storyboardRefCount = countStoryboardBoardRefs(shot);
      if (storyboardRefCount > 0 && !isH3) {
        const firstSentence = firstPromptSentence(videoPrompt);
        const missingStoryboardRefs = Array.from({ length: storyboardRefCount }, (_, i) => `@图片${numToCn(i + 1)}`)
          .filter((ref) => !firstSentence.includes(ref));
        if (missingStoryboardRefs.length > 0) {
          warnings.push(`${shotNo}: 本镜有 ${storyboardRefCount} 张高清分镜板，videoPrompt 第一句话必须把所有分镜板作为"本镜景别变化和画面参考"引用，缺少 ${missingStoryboardRefs.join('、')}`);
        }
        if (!/分镜板|故事板|导演分镜|景别变化|画面参考|storyboard/i.test(firstSentence)) {
          warnings.push(`${shotNo}: 第一句话引用了高清分镜板时，必须明确写"本镜景别变化和画面参考"，不要把它当普通场景图处理，也不要暗示必须完全按每格逐镜切分`);
        }
      } else if (!isH3 && /^以分镜[版板]\s*@图片/u.test(firstPromptSentence(videoPrompt))) {
        warnings.push(`${shotNo}: 当前没有启用高清分镜板，但 videoPrompt 仍保留了分镜板前缀，请删除该前缀并按当前 videoReferenceOrder 重新引用场景/角色参考图`);
      }
      const directorCardRef = buildShotRefBindings(shot, data).find((ref) => ref.kind === 'directorConstraintCard');
      if (directorCardRef && !isH3) {
        const expectedImageRef = `@图片${numToCn(directorCardRef.index)}`;
        const opening = videoPrompt.slice(0, 520);
        if (!opening.includes('@导演约束卡') || !opening.includes(expectedImageRef)) {
          warnings.push(`${shotNo}: 已启用导演约束卡，但 videoPrompt 开头没有明确引用 @导演约束卡（对应 ${expectedImageRef}）；必须用它锁定人物站位、视线、机位和动作关系`);
        }
      }
    }


  }

  return { promptNeedsRefresh: warnings.length > 0, warnings };
}

async function applySinglePromptPatch(
  shotNo: string,
  patch: Pick<Partial<WsShot>, 'imagePrompt' | 'videoPrompt' | 'audioPrompts'>,
): Promise<{ ok: boolean; warnings: string[]; error?: string }> {
  const ws = useWorkshopStore.getState();
  const shot = ws.data?.shots.find((x) => x.shotNo === shotNo);
  if (!ws.data || !shot) return { ok: false, warnings: [], error: `分镜 ${shotNo} 不存在` };
  if (patch.videoPrompt !== undefined) {
    const result = await setPromptsTool.execute({ items: [{ shotNo, ...patch }] });
    return { ok: result.success, warnings: [], ...(result.success ? {} : { error: [result.output, result.error].filter(Boolean).join('\n') }) };
  }
  const normalizedImage = patch.imagePrompt !== undefined ? normalizePromptRefs(shotNo, patch.imagePrompt, 'image') : undefined;
  const normalizedVideo = patch.videoPrompt !== undefined ? normalizePromptRefs(shotNo, patch.videoPrompt, 'video') : undefined;
  if (patch.audioPrompts !== undefined) {
    const audioPromptErrors = validateAudioPromptsAgainstShot({
      dialogue: shot.dialogue,
      characterIds: shot.characterIds,
      audioPrompts: patch.audioPrompts,
    });
    if (audioPromptErrors.length > 0) {
      return { ok: false, warnings: [], error: `audioPrompts 校验未通过：\n${audioPromptErrors.join('\n')}` };
    }
  }
  const unsupportedDialogue = findUnsupportedPromptDialogue({
    videoPrompt: normalizedVideo,
    audioPrompts: patch.audioPrompts,
    canonicalDialogue: shot.dialogue,
  });
  if (unsupportedDialogue.length > 0) {
    return {
      ok: false,
      warnings: [],
      error: `分镜 ${shotNo} 的提示词出现原分镜 dialogue 中不存在的对白：${unsupportedDialogue.map((line) => `“${line}”`).join('、')}。提示词优化不得创作新台词；如用户确实要改剧本，请先明确修改分镜对白，再重新生成提示词。`,
    };
  }
  const unsupportedRelationships = findUnsupportedRelationshipClaims({
    prompts: [normalizedImage, normalizedVideo, ...(patch.audioPrompts ?? []).map((item) => item.prompt)],
    canonicalFacts: [shot.sourceExcerpt, shot.description, shot.dialogue].filter(Boolean).join('\n'),
  });
  if (unsupportedRelationships.length > 0) {
    return {
      ok: false,
      warnings: [],
      error: `分镜 ${shotNo} 的提示词新增了原剧本不存在的人物关系：${unsupportedRelationships.join('、')}。电影级导演表达可以丰富，但人物关系必须来自 sourceExcerpt/description/dialogue。`,
    };
  }
  const unlinkedCharacters = collectUnlinkedCharacterWarnings(
    shotNo,
    shot,
    ws.data,
    [normalizedImage, normalizedVideo],
  );
  if (unlinkedCharacters.length > 0) {
    return { ok: false, warnings: [], error: unlinkedCharacters.join('\n') };
  }
  const validation = validatePromptPatch(shotNo, shot, ws.data, normalizedImage, normalizedVideo);
  const promptPatch: Partial<WsShot> = {};
  if (normalizedImage !== undefined) promptPatch.imagePrompt = normalizedImage;
  // H3 只有一个官方英文提示词槽位；不要让“经典/新版”模板选择把 H3
  // 结果写回普通 videoPrompt。非 H3 仍按项目模板路由。
  const promptTemplate = 'universal';
  const h3Prompt = isMiniMaxH3Model(shot.videoModel || ws.data.videoModel || '') && normalizedVideo !== undefined;
  if (normalizedVideo !== undefined) {
    if (h3Prompt || promptTemplate === 'universal') promptPatch.universalVideoPrompt = normalizedVideo;
    else promptPatch.videoPrompt = normalizedVideo;
  }
  if (patch.audioPrompts !== undefined) {
    promptPatch.audioPrompts = mergeAudioPrompts(shot.audioPrompts, patch.audioPrompts);
  }
  if (normalizedImage !== undefined || normalizedVideo !== undefined) {
    // A successful rewrite has just been checked against the current asset
    // signature. Format/style checks are advisory warnings; they must not be
    // mistaken for a stale reference binding and block the production audit.
    promptPatch.promptNeedsRefresh = false;
  }

  ws.updateShot(shotNo, promptPatch);
  ws.markStepStatus('prompts', 'in-progress');
  ws.logChange('prompts', `更新 ${shotNo} 提示词字段${validation.warnings.length ? `，检查警告 ${validation.warnings.length} 条` : ''}`);
  await ws.commitNow();

  const latest = useWorkshopStore.getState().data?.shots.find((x) => x.shotNo === shotNo);
  if (!latest) return { ok: false, warnings: validation.warnings, error: `分镜 ${shotNo} 写入后无法读取` };
  if (normalizedImage !== undefined && latest.imagePrompt !== normalizedImage) {
    return { ok: false, warnings: validation.warnings, error: 'imagePrompt 写入校验失败：保存后内容没有变化，请改用 workshop_set_prompts 重试' };
  }
  const writtenVideo = h3Prompt || promptTemplate === 'universal' ? latest.universalVideoPrompt : latest.videoPrompt;
  if (normalizedVideo !== undefined && writtenVideo !== normalizedVideo) {
    return { ok: false, warnings: validation.warnings, error: `${h3Prompt || promptTemplate === 'universal' ? 'universalVideoPrompt' : 'videoPrompt'} 写入校验失败：保存后内容没有变化，请改用 workshop_set_prompts 重试` };
  }
  if (promptPatch.audioPrompts !== undefined && JSON.stringify(latest.audioPrompts ?? []) !== JSON.stringify(promptPatch.audioPrompts)) {
    return { ok: false, warnings: validation.warnings, error: 'audioPrompts 写入校验失败：保存后的配音提示词不完整，请重试' };
  }
  return { ok: true, warnings: validation.warnings };
}

function buildShotStoryboardRefs(shot: WsShot, data: NonNullable<ReturnType<typeof useWorkshopStore.getState>['data']>) {
  // 高清故事板必须与普通生图共用同一个绑定函数。此前这里单独按
  // shot.characterIds/extraRefImages 拼装，容易在资产刷新后漏掉屏幕人物或多角度场景，
  // 也会让 @图片N 与 UI 卡片错位。
  const refs = buildImageRefBindings(shot, {
    scenes: data.scenes,
    characters: data.characters,
    props: data.props ?? [],
    colorPalettes: data.colorPalettes ?? [],
    globalColorPaletteId: data.globalColorPaletteId,
  }).map((binding) => ({
    ...binding,
    name: binding.label.replace(/^(?:场景|角色|道具|额外参考|色卡)\s*/u, '') || binding.label,
  }));
  return { refs, sceneRefCount: refs.filter((ref) => ref.kind === 'scene').length };
}

function sanitizeStoryboardImagePrompt(prompt: string): string {
  return prompt
    .replace(/[，,、\s]*\{[^{}]*\}/g, '')
    .replace(/[，,、\s]*<[^<>]*>/g, '')
    .replace(/[，,、\s]*（[^（）]*(?:台词|对白|字幕|旁白|音效|声音|环境音|音乐|配乐|BGM|bgm|说|念|喊|唱)[^（）]*）/g, '')
    .replace(/[，,、\s]*\([^()]*(?:台词|对白|字幕|旁白|音效|声音|环境音|音乐|配乐|BGM|bgm|说|念|喊|唱)[^()]*\)/g, '')
    .replace(/(?:台词|对白|字幕|旁白|音效|声音|环境音|音乐|配乐|BGM|bgm)[：:][^。；;\n]*(?:[。；;]|$)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/([，,、]){2,}/g, '$1')
    .trim();
}

function requireOpen(): { ok: true } | { ok: false; error: string } {
  const { project, data } = useWorkshopStore.getState();
  if (!project || !data) return { ok: false, error: '当前没有打开的工坊项目，请让用户先在创作工坊中打开或新建项目' };
  return { ok: true };
}

function storyboardCandidateList(frame: { imagePath?: string; prompt?: string; candidates?: AssetCandidate[] }): AssetCandidate[] {
  const existing = frame.candidates ?? [];
  if (existing.length > 0) return existing;
  return frame.imagePath
    ? [{ path: frame.imagePath, source: 'generate', prompt: frame.prompt, createdAt: Date.now() }]
    : [];
}

function withStoryboardCandidate(
  frame: NonNullable<WsShot['storyboardFrames']>[number],
  path: string,
  source: AssetCandidate['source'],
  engineId?: string,
): NonNullable<WsShot['storyboardFrames']>[number] {
  const candidates = storyboardCandidateList(frame);
  const nextCandidates = candidates.some((c) => c.path === path)
    ? candidates
    : [...candidates, {
        path,
        source,
        engineId,
        prompt: frame.prompt,
        createdAt: Date.now(),
      }];
  return {
    ...frame,
    imagePath: path,
    candidates: nextCandidates,
    status: 'done',
    error: undefined,
  };
}

function collectStoryboardGenerationRefs(
  shot: WsShot,
  frame: StoryboardFrame,
  data: NonNullable<ReturnType<typeof useWorkshopStore.getState>['data']>,
): string[] {
  return compactStoryboardFrameReferences(shot, frame, data).bindings.map((ref) => ref.path);
}

/**
 * get_state step 详情里的资产对象瘦身：candidates 是只增不减的历史（每条还带 prompt 全文），
 * 全量序列化会让单次回执到 100-400KB。候选只保留定位/来源/用途 + prompt 80 字预览；
 * 实体本身保留名称、id、assetImagePath（最终图/选中状态）等 Agent 判断信息。
 */
function slimAssetForState<T extends {
  candidates?: AssetCandidate[];
  assetReviews?: unknown;
  assetProductionBinding?: unknown;
}>(asset: T): T {
  return {
    ...asset,
    candidates: asset.candidates?.map((c) => ({
      path: c.path,
      source: c.source,
      role: c.role,
      checksum: c.checksum,
      fingerprint: assetCandidateFingerprint(c),
      promptPreview: c.prompt ? (c.prompt.length > 80 ? `${c.prompt.slice(0, 80)}...` : c.prompt) : undefined,
    })),
    assetReviews: asset.assetReviews,
    assetProductionBinding: asset.assetProductionBinding,
  };
}

/** Prompt rewriting only needs identity and current image paths. Returning
 * full asset prompts/candidate history here bloats the model turn and can
 * prevent it from ever closing the workshop_set_prompts call. */
function promptAssetForState(asset: { id?: string; name?: string; assetImagePath?: string; selectedImagePaths?: string[]; sceneReferenceMode?: string }) {
  return {
    id: asset.id,
    name: asset.name,
    assetImagePath: asset.assetImagePath,
    selectedImagePaths: asset.selectedImagePaths,
    sceneReferenceMode: asset.sceneReferenceMode,
  };
}

const workshopStatePager = new WorkshopStatePager();

const getStateTool: Tool = {
  definition: {
    name: 'workshop_get_state',
    description: '获取创作工坊状态。程序检查点已提供必要事实时直接使用，不必重复调用。section 可显式指定读取区域，避免用户切换页面后 currentStep 改变导致 Agent 读错数据；修改某一镜时请传 shot_no。长输出自动分页；出现 next_call 时必须原样传参续读，直至所需事实完整。分页和上下文压缩后的同页恢复不是无效重复读取；允许按原 output_id/offset 重读，快照过期时重新读取原 section。不要因未读完而要求用户复制正文。',
    parameters: {
      type: 'object',
      properties: {
        detail: { type: 'string', enum: ['summary', 'step'], description: 'summary=概要（默认），step=步骤数据，长内容自动分页' },
        output_id: { type: 'string', description: '续读时原样使用上一页 next_call.output_id；读取同一状态快照。' },
        offset: { type: 'integer', description: '首次读取省略 output_id 和 offset（空 output_id 配合 offset=0 也表示首次读取）；续读时同时原样传入上一页 next_call.output_id 和 next_call.offset。' },
        section: { type: 'string', enum: ['current', 'breakdown', 'breakdown-work', 'episode-script', 'assets', 'prompts', 'generate', 'ad-materials'], description: '显式读取区域，默认 current。ad-materials 返回完整广告调研来源原文（可分页），普通区域只带来源索引；核实广告事实时按需读取原文。补写分集剧本用 episode-script：不带 episode 读取一次公共源文和季纲；带 episode 只读本集与上一集正文，不含分镜/提示词/生成任务。' },
        work_unit_id: { type: 'string', description: 'breakdown-work 使用检查点中的 workUnitId，只返回该集核对所需镜头事实，不含长提示词和媒体' },
        shot_no: { type: 'string', description: '可选。detail=step 且在提示词/生成步骤时，只返回该分镜的完整数据，避免一次塞入全片提示词。与 episode 互斥；同时传则以 shot_no 为准。' },
        episode: { type: 'string', description: '可选。episode-script 区域用它读取指定集正文/Beat/前集衔接。detail=step 且在 prompts/generate 步骤时，只返回该分集（episode 值，如 "4" 或 "05"）的镜头与这些镜头实际用到的角色/场景/道具/色卡，避免一次塞入全片。例如用户明确只重写某一集提示词时必须传 episode 缩小范围。' },
      },
      required: [],
    },
  },
  risk: 'safe',
  async execute(params) {
    params = normalizeWorkshopStateRead(params);
    const s = useWorkshopStore.getState();
    if (!isInitialWorkshopStateRead(params)) {
      if (typeof params.output_id !== 'string' || !params.output_id.trim() || params.offset === undefined) {
        return { success: false, output: '', error: '分页续读必须同时提供 output_id 和 offset。首次读取请移除这两个参数，保留原 detail/section/shot_no/episode；续读请原样使用上一页 next_call，勿猜测快照编号或偏移。' };
      }
      try {
        return { success: true, output: workshopStatePager.read(params.output_id, params.offset, s.data, s.project?.id ?? '') };
      } catch (error) {
        return { success: false, output: '', error: error instanceof Error ? error.message : '状态分页读取失败' };
      }
    }
    if (params.section === 'breakdown-work' && s.data) {
      try {
        const state = breakdownReconciliationState(s.data, typeof params.work_unit_id === 'string' ? params.work_unit_id : undefined);
        return { success: true, output: workshopStatePager.start(JSON.stringify(state, null, 2), s.data, s.project?.id ?? '') };
      } catch (error) {
        return { success: false, output: '', error: (error as Error).message, recoverable: true };
      }
    }
    const h3Task = useWorkshopStore.getState().getH3InputMode();
    if (params.detail === 'step' && params.section === 'episode-script' && s.data) {
      try {
        const episodeNo = typeof params.episode === 'string' ? params.episode.trim() : '';
        return { success: true, output: workshopStatePager.start(JSON.stringify(buildEpisodeScriptState(s.data, episodeNo)), s.data, s.project?.id ?? '') };
      } catch (error) {
        return { success: false, output: '', error: error instanceof Error ? error.message : '分集剧本状态读取失败', recoverable: true };
      }
    }
    if (params.section === 'ad-materials') {
      if (s.data?.creativeSpec?.workKind !== 'product-ad') return { success: false, output: '', error: '当前项目不是产品广告项目。' };
      return { success: true, output: workshopStatePager.start(JSON.stringify({
        section: 'ad-materials', projectId: s.data.projectId,
        adSpec: s.data.creativeSpec.adSpec,
        instruction: '这里是已保存的完整调研资料，不是新的联网结果；事实仍须结合来源核实。',
      }), s.data, s.project?.id ?? '') };
    }
    const summary = s.getStateSummary() + (s.data?.creativeSpec?.workKind === 'product-ad' ? `\n广告资料：${JSON.stringify(projectAdCreativeSpec(s.data.creativeSpec)?.adSpec)}` : '');
    const generationTasks = useCanvasTaskStore.getState().tasks
      .filter((t) => t.workshopShotNo)
      .slice(-30)
      .map((t) => ({
        id: t.id,
        shotNo: t.workshopShotNo,
        kind: t.workshopShotKind,
        engineId: t.engineId,
        status: t.status,
        progress: t.progress,
        rhTaskId: t.rhTaskId,
        resultPaths: t.resultPaths,
        resultUrls: t.resultUrls,
        error: t.error,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        finishedAt: t.finishedAt,
      }));
    const preview = (text?: string, max = 220) => {
      if (!text) return undefined;
      return text.length > max ? `${text.slice(0, max)}...` : text;
    };
    if (params.detail === 'step' && s.data) {
      const requestedSection = typeof params.section === 'string' ? params.section : 'current';
      const step = requestedSection === 'current' ? s.data.currentStep : requestedSection;
      const requestedShotNo = typeof params.shot_no === 'string' ? params.shot_no.trim() : '';
      const requestedEpisode = typeof params.episode === 'string' ? params.episode.trim() : '';

      // 按集限流：单集批量操作（如只重写某一集提示词）只携带该集实际用到的资产，
      // 避免把全项目角色/场景/道具塞进上下文。
      const requestedEpisodeShots = selectPromptShots(s.data, requestedShotNo, requestedEpisode);
      if ((step === 'prompts' || step === 'generate') && (requestedShotNo || requestedEpisode) && !requestedEpisodeShots.length) return { success: false, output: '', error: '指定镜头或分集没有已保存镜头，请核对镜号/集号；没有返回全项目替代。' };
      const episodeReferencedAssets = (requestedEpisode || requestedShotNo)
        ? (() => {
            const charIds = new Set<string>();
            const sceneIds = new Set<string>();
            const propIds = new Set<string>();
            for (const shot of requestedEpisodeShots) {
              for (const id of shot.characterIds ?? []) charIds.add(id);
              if (shot.sceneId) sceneIds.add(shot.sceneId);
              for (const id of shot.propIds ?? []) propIds.add(id);
            }
            return { charIds, sceneIds, propIds };
          })()
        : null;
      const detail = step === 'breakdown'
        ? {
            creativeSpec: projectAdCreativeSpec(s.data.creativeSpec),
            synopsis: s.data.synopsis,
            currentScriptRevisionId: s.data.currentScriptRevisionId,
            currentScriptRevision: (s.data.scriptRevisions ?? []).find((revision) => revision.id === s.data?.currentScriptRevisionId),
            scriptReview: s.data.scriptReview,
            directorReport: s.data.directorReport,
            characterHandoffs: s.data.characterHandoffs ?? [],
            sourceEvidence: s.data.breakdownSourceEvidence ?? [],
            episodes: s.data.episodes,
            narrativeBeats: s.data.narrativeBeats ?? [],
            characters: s.data.characters,
            scenes: s.data.scenes,
            props: s.data.props ?? [],
            // 事实锁：模型写 Atomic Shot 时只能引用下面这份 ID 清单里的值。
            // 之前模型按语义自造 characterIds（如 qin_coach），整批被拒且上下文丢失后无法安全重提。
            idManifest: {
              characters: s.data.characters.map((c) => ({ id: c.id, name: c.name })),
              scenes: s.data.scenes.map((sc) => ({ id: sc.id, name: sc.name })),
              props: (s.data.props ?? []).map((pr) => ({ id: pr.id, name: pr.name })),
            },
            idRule: 'characterIds/sceneId/propIds 只能逐字取自上面的 idManifest；禁止按人物名、职业、语义自行编造 ID。凡未在 idManifest.characters 中列出的角色，必须先从剧本补入 characters（workshop_set_breakdown mode:"merge"）再写入分镜。',
          }
        : step === 'assets'
          ? {
              characters: s.data.characters.map(slimAssetForState),
              scenes: s.data.scenes.map(slimAssetForState),
              props: (s.data.props ?? []).map(slimAssetForState),
              colorPalettes: (s.data.colorPalettes ?? []).map(slimAssetForState),
              globalColorPaletteId: s.data.globalColorPaletteId,
            }
          : step === 'prompts' || step === 'generate'
            ? {
                shots: requestedEpisodeShots
                  .map((shot) => {
                  const { refs, sceneRefCount } = buildShotRequiredRefs(shot, s.data!);
                  const storyboard = buildShotStoryboardRefs(shot, s.data!);
                  const full = !!requestedShotNo;
                  const base = step === 'prompts' ? promptShotFacts(shot, full) : full ? shot : {
                    shotNo: shot.shotNo,
                    episode: shot.episode,
                    sceneId: shot.sceneId,
                    description: shot.description,
                    narrativeBeat: shot.narrativeBeat,
                    atomicAction: shot.atomicAction,
                    continuityMode: shot.continuityMode,
                    entryState: shot.entryState,
                    exitState: shot.exitState,
                    transitionPlan: shot.transitionPlan,
                    sourceExcerpt: shot.sourceExcerpt,
                    sourceScriptRevisionId: shot.sourceScriptRevisionId,
                    dialogue: shot.dialogue,
                    shotType: shot.shotType,
                    camera: shot.camera,
                    mood: shot.mood,
                    soundIntent: shot.soundIntent,
                    durationSec: shot.durationSec,
                    // Full-project prompt rewrites need the structured timing
                    // facts to decide which shots actually require a timeline
                    // write. Keep the compact payload small, but never omit
                    // actionTimeline itself or the model will regenerate it
                    // for every shot on every run.
                    spatialStaging: shot.spatialStaging,
                    actionTimeline: shot.actionTimeline,
                    characterIds: shot.characterIds,
                    propIds: shot.propIds,
                    assetPropIds: shot.assetPropIds,
                    incidentalObjects: shot.incidentalObjects,
                    videoRatio: shot.videoRatio,
                    videoModel: shot.videoModel,
                    videoCandidates: shot.videoCandidates?.map((candidate) => ({
                      path: candidate.path,
                      engineId: candidate.engineId,
                      createdAt: candidate.createdAt,
                      inputFingerprint: candidate.inputFingerprint,
                      fingerprint: videoCandidateFingerprint(candidate),
                      productionPacket: candidate.productionPacket
                        ? {
                          packetVersion: candidate.productionPacket.packetVersion,
                          jobId: candidate.productionPacket.jobId,
                          productionRunId: candidate.productionPacket.productionRunId,
                          model: candidate.productionPacket.model,
                          engineId: candidate.productionPacket.engineId,
                          inputFingerprint: candidate.productionPacket.inputFingerprint,
                          referenceCount: candidate.productionPacket.referencePaths.length,
                          audioCount: candidate.productionPacket.audioPaths.length,
                          videoCount: candidate.productionPacket.videoPaths.length,
                          continuityMode: candidate.productionPacket.continuityMode,
                          createdAt: candidate.productionPacket.createdAt,
                        }
                        : undefined,
                    })),
                    videoProductionBinding: shot.videoProductionBinding,
                    lastProductionPacket: full
                      ? shot.lastProductionPacket
                      : shot.lastProductionPacket
                          ? {
                            packetVersion: shot.lastProductionPacket.packetVersion,
                            jobId: shot.lastProductionPacket.jobId,
                            productionRunId: shot.lastProductionPacket.productionRunId,
                            model: shot.lastProductionPacket.model,
                            engineId: shot.lastProductionPacket.engineId,
                            inputFingerprint: shot.lastProductionPacket.inputFingerprint,
                            referenceCount: shot.lastProductionPacket.referencePaths.length,
                            audioCount: shot.lastProductionPacket.audioPaths.length,
                            videoCount: shot.lastProductionPacket.videoPaths.length,
                            continuityMode: shot.lastProductionPacket.continuityMode,
                            createdAt: shot.lastProductionPacket.createdAt,
                          }
                        : undefined,
                    audioCandidates: shot.audioCandidates?.map((candidate) => ({
                      candidateId: candidate.candidateId,
                      characterId: candidate.characterId,
                      characterName: candidate.characterName,
                      path: candidate.path,
                      duration: candidate.duration,
                      createdAt: candidate.createdAt,
                      fingerprint: audioCandidateFingerprint(candidate),
                    })),
                    audioProductionBinding: shot.audioProductionBinding,
                    imagePath: shot.imagePath,
                    videoPath: shot.videoPath,
                    genStatus: shot.genStatus,
                    genError: shot.genError,
                    promptNeedsRefresh: shot.promptNeedsRefresh,
                    referenceRevision: shot.referenceRevision ?? 0,
                    imagePromptLength: shot.imagePrompt?.length ?? 0,
                    // H3/ref2va and the universal template use the dedicated
                    // universal slot. Expose the effective prompt to DSH so
                    // it cannot mistake a valid prompt for a missing one.
                    videoPromptLength: (shot.universalVideoPrompt || shot.videoPrompt)?.length ?? 0,
                    universalVideoPromptLength: shot.universalVideoPrompt?.length ?? 0,
                    imagePromptPreview: preview(shot.imagePrompt),
                    videoPromptPreview: preview(shot.universalVideoPrompt || shot.videoPrompt),
                    storyboardFrameCount: shot.storyboardFrames?.length ?? 0,
                    storyboardBoardCount: shot.storyboardBoards?.length ?? 0,
                    // 故事板帧/分镜板只给计数和 id；完整内容传 shot_no 单镜读取。
                    storyboardFrameIds: (shot.storyboardFrames ?? []).map((frame) => frame.id),
                    storyboardBoardIds: (shot.storyboardBoards ?? []).map((board) => board.id),
                    hasDirectorConstraintCard: Boolean(shot.directorConstraintCard?.imagePath),
                    directorConstraintAppliedFrameCount: (shot.storyboardFrames ?? []).filter((frame) => frame.useDirectorConstraintCard === true).length,
                  };
                  return {
                    ...base,
                    referenceSignature: shotReferenceSignature(shot, s.data!),
                    // videoReferenceOrder：videoPrompt 专用编号（分镜板置首）。
                    // imagePrompt/故事板 prompt 禁止用它——生图不传分镜板，
                    // 必须用 imageReferenceOrder（否则 @图片N 系统性偏移）。
                    videoReferenceOrder: refs.map((ref) => `@图片${numToCn(ref.index)}=${ref.label}`),
                    imageReferenceOrder: storyboard.refs.map((ref) => `@图片${numToCn(ref.index)}=${ref.label}`),
                    videoReferenceBindings: buildVideoRefBindings(shot, s.data!).map((ref) => ({
                      ref: `@图片${numToCn(ref.index)}`,
                      kind: ref.kind,
                      label: ref.label,
                      id: ref.id,
                      path: ref.path,
                    })),
                    imageReferenceBindings: buildImageRefBindings(shot, s.data!).map((ref) => ({
                      ref: `@图片${numToCn(ref.index)}`,
                      kind: ref.kind,
                      label: ref.label,
                      id: ref.id,
                      path: ref.path,
                    })),
                    sceneReferenceCount: sceneRefCount,
                    storyboardReferenceOrder: storyboard.refs.map((ref) => `@图片${numToCn(ref.index)}=${ref.label}`),
                    storyboardSceneReferenceCount: storyboard.sceneRefCount,
                    directorConstraintCard: shot.directorConstraintCard?.imagePath
                      ? {
                          id: shot.directorConstraintCard.id,
                          imagePath: shot.directorConstraintCard.imagePath,
                          prompt: shot.directorConstraintCard.prompt,
                          useInVideo: shot.directorConstraintCard.useInVideo === true,
                          appliedFrameIndices: (shot.storyboardFrames ?? [])
                            .flatMap((frame, index) => frame.useDirectorConstraintCard === true ? [index + 1] : []),
                          rule: '导演约束卡是可选参考。只有明确启用的故事板格才会追加该图，且对应 prompt 必须出现 @导演约束卡；视频也由独立 useInVideo 开关控制。',
                        }
                      : null,
                  };
                }),
                characters: (episodeReferencedAssets
                  ? s.data.characters.filter((c) => episodeReferencedAssets.charIds.has(c.id))
                  : s.data.characters).map(promptAssetForState),
                scenes: (episodeReferencedAssets
                  ? s.data.scenes.filter((sc) => episodeReferencedAssets.sceneIds.has(sc.id))
                  : s.data.scenes).map(promptAssetForState),
                props: (episodeReferencedAssets
                  ? (s.data.props ?? []).filter((p) => episodeReferencedAssets.propIds.has(p.id))
                  : (s.data.props ?? [])).map(promptAssetForState),
                colorPalettes: (s.data.colorPalettes ?? []).map(promptAssetForState),
                globalColorPaletteId: s.data.globalColorPaletteId,
                qualityLearning: {
                  avoidanceRules: s.data.qualityLearning?.avoidanceRules.slice(0, 12) ?? [],
                  highScorePromptExamples: s.data.qualityLearning?.highScorePrompts.slice(0, 5).map((item) => ({
                    kind: item.kind,
                    shotNo: item.shotNo,
                    score: item.score,
                    model: item.model,
                    promptPreview: preview(item.prompt, 600),
                  })) ?? [],
                  instruction: '优先复用高频规避规则；高分提示词只参考结构和细节密度，不得复制其中的剧情、人物或道具。',
                },
              }
            : {};
      if (step === 'prompts') {
        return { success: true, output: workshopStatePager.start(JSON.stringify({
          section: 'prompts', projectId: s.data.projectId, h3Task, creativeSpec: projectAdCreativeSpec(s.data.creativeSpec),
          currentScriptRevisionId: s.data.currentScriptRevisionId,
          videoModel: s.data.videoModel, videoRatio: s.data.videoRatio, videoPromptTemplate: s.data.videoPromptTemplate,
          instruction: '只使用指定范围内镜头事实和当前 referenceSignature。逐镜读取后立即写回 workshop_set_prompts 并传 expectedRefSignature；成功后继续下一镜，不重复读取全项目或历史生成任务。这里只读到参考路径并不代表已查看图片。',
          ...detail,
        }), s.data, s.project?.id ?? '') };
      }
      return { success: true, output: workshopStatePager.start(`${summary}\n\n当前 H3 task: ${h3Task}\n\n生成任务:\n${JSON.stringify(generationTasks)}\n\n当前步骤数据:\n${JSON.stringify({ h3Task, creativeSpec: projectAdCreativeSpec(s.data.creativeSpec), ...detail })}`, s.data, s.project?.id ?? '') };
    }
    return { success: true, output: `${summary}\n\n当前 H3 task: ${h3Task}\n\n生成任务:\n${JSON.stringify(generationTasks)}` };
  },
};

const getProductionAuditTool: Tool = {
  definition: {
    name: 'workshop_get_production_audit',
    description: '读取当前工坊的生产审计报告：剧本 revision、原子镜头连续性、资产引用、提示词、视频候选评审绑定和渲染 lineage。交付或重试前调用，不能用猜测替代。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  risk: 'safe',
  async execute() {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const data = useWorkshopStore.getState().data;
    if (!data) return { success: false, output: '', error: '请先打开工坊项目' };
    const settings = useSettingsStore.getState();
    return {
      success: true,
      output: JSON.stringify(buildProductionAudit(data, {
        videoQualityReviewRequired: settings.qualityReviewEnabled,
        reviewerFingerprint: settings.qualityReviewEnabled
          ? qualityReviewerFingerprint(settings.qualityReviewBaseUrl, settings.qualityReviewModel)
          : undefined,
      }), null, 2),
    };
  },
};

const getShotRefsTool: Tool = {
  definition: {
    name: 'workshop_get_shot_refs',
    description: '只读取已经成功写入分镜表的单镜参考顺序和快照签名。尚未落库的失败批次不能调用本工具，应直接修正原始 shots 并用 workshop_set_shots 重提；第二步落库不依赖参考图。修改已保存镜头的参考资产或写提示词前调用；写回 workshop_set_prompts 时原样传 expectedRefSignature，防止用户换图后 Agent 仍按旧 @图片N 覆盖。',
    parameters: {
      type: 'object',
      properties: {
        shot_no: { type: 'string', description: '分镜编号' },
      },
      required: ['shot_no'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const data = useWorkshopStore.getState().data!;
    const shotNo = String(params.shot_no ?? '').trim();
    const shot = data.shots.find((item) => item.shotNo === shotNo);
    if (!shot) return missingPersistedShotResult(shotNo);
    const imageBindings = buildImageRefBindings(shot, data);
    const serialize = (binding: ShotRefBinding) => ({
      ref: `@图片${numToCn(binding.index)}`,
      kind: binding.kind,
      id: binding.id,
      label: binding.label,
      path: binding.path,
    });
    // Fail closed: never claim all references were inspected after dropping a file.
    const media: AgentUserContentBlock[] = [];
    for (const binding of imageBindings) {
      try {
        media.push(await readNativeImage(binding.path));
      } catch (error) {
        return { success: false, output: '', error: `参考图 ${binding.label} (${binding.path}) 读取失败：${error instanceof Error ? error.message : String(error)}。未返回不完整的参考图序列。` };
      }
    }
    return {
      success: true,
      output: JSON.stringify({
        shotNo,
        transitionPlan: shot.transitionPlan,
        referenceRevision: shot.referenceRevision ?? 0,
        referenceSignature: shotReferenceSignature(shot, data),
        imageReferenceBindings: imageBindings.map(serialize),
        videoReferenceBindings: buildVideoRefBindings(shot, data).map(serialize),
        lastProductionPacket: shot.lastProductionPacket ? {
          jobId: shot.lastProductionPacket.jobId,
          productionRunId: shot.lastProductionPacket.productionRunId,
          inputFingerprint: shot.lastProductionPacket.inputFingerprint,
          model: shot.lastProductionPacket.model,
          engineId: shot.lastProductionPacket.engineId,
          referenceCount: shot.lastProductionPacket.referencePaths.length,
          audioCount: shot.lastProductionPacket.audioPaths.length,
          videoCount: shot.lastProductionPacket.videoPaths.length,
          continuityMode: shot.lastProductionPacket.continuityMode,
        } : undefined,
        promptNeedsRefresh: shot.promptNeedsRefresh === true,
        instruction: '以上 imageReferenceBindings 已按同一顺序作为原生图片附加。必须实际查看全部图片；多张 scene 图片是同一场景的互补对角视角，联合确定空间事实，不得二选一。',
      }),
      media,
    };
  },
};

const readSourceTool: Tool = {
  definition: {
    name: 'workshop_read_source',
    description: '列出工坊项目的剧本源文件（sources/ 目录），返回绝对路径。docx/pdf 等非纯文本请用对应 skill 或工具读取内容。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  risk: 'safe',
  async execute() {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const { project } = useWorkshopStore.getState();
    const files = await listProjectFiles(project!.id, 'sources');
    const home = await homeDir();
    const base = projectAbsPath(project!.id).replace('~/', home);
    return {
      success: true,
      output: JSON.stringify({
        files: files.map((f) => `${base}/sources/${f}`),
      }),
    };
  },
};

const setScriptReviewTool: Tool = {
  definition: {
    name: 'workshop_set_script_review',
    description: '保存当前剧本 revision 的 Draft Review 凭据。审核结果必须绑定 currentScriptRevisionId；passed 才允许进入剧本拆解，needs-repair 只能先让用户修订剧本。',
    parameters: {
      type: 'object',
      properties: {
        revision_id: { type: 'string', description: 'workshop_get_state 返回的 currentScriptRevisionId' },
        status: { type: 'string', enum: ['passed', 'needs-repair'] },
        scene_count: { type: 'number' },
        beat_count: { type: 'number' },
        issues: { type: 'array', items: { type: 'string' }, description: '阻塞问题；passed 时应为空数组' },
        summary: { type: 'string' },
      },
      required: ['revision_id', 'status', 'scene_count', 'beat_count', 'issues'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const s = useWorkshopStore.getState();
    const revisionId = String(params.revision_id ?? '');
    if (!revisionId || revisionId !== s.data?.currentScriptRevisionId) {
      return { success: false, output: '', error: '剧本审核凭据对应的 revision 不是当前版本，请重新读取工坊状态后审核。' };
    }
    const review: ScriptReviewReceipt = {
      revisionId,
      status: params.status === 'passed' ? 'passed' : 'needs-repair',
      sceneCount: Math.max(0, Number(params.scene_count) || 0),
      beatCount: Math.max(0, Number(params.beat_count) || 0),
      issues: Array.isArray(params.issues) ? params.issues.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()) : [],
      summary: typeof params.summary === 'string' ? params.summary.trim() : undefined,
      reviewedAt: Date.now(),
    };
    if (review.status === 'passed' && review.issues.length > 0) {
      return { success: false, output: '', error: 'passed 审核不能携带阻塞 issues；请改为 needs-repair 或清空 issues。' };
    }
    s.recordScriptReview(review);
    await s.commitNow();
    return { success: true, output: `剧本 Draft Review 已保存：${review.status === 'passed' ? '通过' : '需要修订'}（Scene ${review.sceneCount}，Beat ${review.beatCount}）` };
  },
};

const recordScriptRevisionTool: Tool = {
  definition: {
    name: 'workshop_record_script_revision',
    description: '保存一版修订后的正式剧本 revision，并将其设为当前版本。用于 Draft Review 标记 needs-repair 后，依据审核意见完成剧本修订；不会自动伪造审核通过结果。',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '修订后的完整剧本正文，必须保留未涉及问题的原有事实' },
        source_names: { type: 'array', items: { type: 'string' }, description: '来源名称，默认沿用当前 revision 来源' },
      },
      required: ['content'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const s = useWorkshopStore.getState();
    const content = String(params.content ?? '').trim();
    if (!content) return { success: false, output: '', error: '修订后的剧本正文不能为空。' };
    const current = (s.data?.scriptRevisions ?? []).find((revision) => revision.id === s.data?.currentScriptRevisionId);
    const sourceNames = Array.isArray(params.source_names)
      ? params.source_names.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim())
      : (current?.sourceNames ?? ['AI 修订剧本']);
    s.recordScriptRevision({
      sourceNames: sourceNames.length > 0 ? sourceNames : ['AI 修订剧本'],
      sourceKind: current?.sourceKind ?? 'manual',
      content,
    });
    await s.commitNow();
    return { success: true, output: '修订后的剧本已保存为新的正式 revision，当前版本已切换；请重新执行 Draft Review。' };
  },
};

const setBreakdownTool: Tool = {
  definition: {
    name: 'workshop_set_breakdown',
    description: '写入第②步拆解结果。首次拆解必须一次提交完整结构；已有拆解的修复默认 mode=merge，按 ID 增量更新并保留未提交项，禁止用局部修复覆盖完整 Scene/Beat 列表。只有明确全量重建时使用 mode=replace。所有写入都会先对合并后的完整结构做原子校验，失败时不会保存任何字段。',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['merge', 'replace'],
          description: '已有拆解默认 merge；全量重建才使用 replace。首次拆解自动按 replace 处理。',
        },
        sourceEvidence: {
          type: 'array',
          items: { type: 'string' },
          description: '3-12 条从剧本逐字摘录的短句。禁止润色、概括或填写提示词。',
        },
        synopsis: { type: 'string', description: '故事梗概（200-500字）' },
        episodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              no: { type: 'string', description: '集号，如 "1"' },
              title: { type: 'string' },
              sceneList: { type: 'string', description: '本集场次概览，分号分隔' },
              sourceScope: { type: 'string', description: '本集覆盖的原文范围或依据' },
              synopsis: { type: 'string', description: '本集完整梗概' },
              openingState: { type: 'string', description: '本集开场状态' },
              centralConflict: { type: 'string', description: '本集核心冲突' },
              climax: { type: 'string', description: '本集高潮与不可逆事件' },
              cliffhanger: { type: 'string', description: '本集结尾追更钩子' },
              endingState: { type: 'string', description: '本集结束状态及下集承接' },
              script: { type: 'string', description: '本集详细剧本（第二阶段完成后写入）' },
              scriptStatus: { type: 'string', enum: ['planned', 'draft', 'frozen'] },
              characterAssetNotes: { type: 'string', description: '本集角色与资产变化说明' },
            },
            required: ['no', 'title', 'sceneList'],
          },
        },
        narrativeBeats: {
          type: 'array',
          description: 'Scene 与 Atomic Shot 之间的叙事节拍；每个 Beat 只承担一个叙事功能，可对应多个原子镜头。',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '英文短 id，如 "scene-01-beat-01"' },
              sceneId: { type: 'string', description: '所属场景 id' },
              episode: { type: 'string' },
              title: { type: 'string', description: '节拍标题，如“发现门缝透光”' },
              purpose: { type: 'string', enum: [...ALLOWED_BEAT_PURPOSES], description: '单一叙事功能：信息/关系/情绪/不可逆动作之一' },
              sourceExcerpt: { type: 'string', description: '对应剧本逐字短句，可选' },
              shotNos: { type: 'array', items: { type: 'string' }, description: '写入后对应的原子镜头编号，可选' },
            },
            required: ['id'],
          },
        },
        characters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '英文短 id，如 "linfeng"' },
              name: { type: 'string' },
              personality: { type: 'string', description: '性格' },
              appearance: { type: 'string', description: '外形（年龄/身材/服饰/面部特征，生图可用的具体描述）' },
              lifecycleStages: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { stage: { type: 'string' }, appearance: { type: 'string' } },
                  required: ['stage', 'appearance'],
                },
                description: '形象随剧情变化时填写（如 少年期/中年期）',
              },
            },
            required: ['id', 'name', 'personality', 'appearance'],
          },
        },
        scenes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              description: { type: 'string', description: '场景视觉描述（环境/光线/氛围）' },
            },
            required: ['id', 'name', 'description'],
          },
        },
        props: {
          type: 'array',
          description: PROP_ASSET_DESCRIPTION,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              description: { type: 'string', description: '道具视觉描述' },
            },
            required: ['id', 'name', 'description'],
          },
        },
      },
      required: [],
    },
  },
  // Advertise the state-aware contract so the model is never told a field is
  // optional when the executor will require it (first breakdown), and never
  // told a field is required when a partial re-analysis is legitimate.
  resolveDefinition() {
    const state = useWorkshopStore.getState();
    const hasExistingBreakdown = Boolean(
      state.data?.synopsis?.trim()
      || state.data?.episodes?.length
      || state.data?.characters?.length
      || state.data?.scenes?.length
      || state.data?.props?.length,
    );
    const hasSourceMaterial = Boolean(state.project?.sources?.length);
    const required = workshopBreakdownRequiredFields({ hasExistingBreakdown, hasSourceMaterial });
    return {
      ...setBreakdownTool.definition,
      parameters: { ...setBreakdownTool.definition.parameters, required },
    };
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const s = useWorkshopStore.getState();
    const adError = adMaterialsError(s.data?.creativeSpec);
    if (adError) return { success: false, output: '', error: adError, recoverable: true };
    const { data } = s;
    const { scope, request } = currentWorkshopEditScope();

    // Models occasionally emit an array-valued argument as a JSON *string*
    // (the array is valid JSON, but double-encoded). Only that exact shape is
    // recovered; any other malformed string becomes an explicit, recoverable
    // parameter error instead of silently being dropped to `undefined`.
    const normalizedArrays = {
      episodes: normalizeWorkshopArrayParam(params.episodes, 'episodes'),
      narrativeBeats: normalizeWorkshopArrayParam(params.narrativeBeats, 'narrativeBeats'),
      characters: normalizeWorkshopArrayParam(params.characters, 'characters'),
      scenes: normalizeWorkshopArrayParam(params.scenes, 'scenes'),
      props: normalizeWorkshopArrayParam(params.props, 'props'),
      sourceEvidence: normalizeWorkshopArrayParam(params.sourceEvidence, 'sourceEvidence'),
    };
    const arrayParamErrors = Object.values(normalizedArrays)
      .map((item) => item.error)
      .filter((item): item is string => Boolean(item));
    if (arrayParamErrors.length > 0) {
      return {
        success: false,
        output: '',
        error: `拆解参数格式错误，请修正后重试：\n${arrayParamErrors.join('\n')}`,
        recoverable: true,
      };
    }
    if (normalizedArrays.episodes.value !== undefined) params.episodes = normalizedArrays.episodes.value;
    if (normalizedArrays.narrativeBeats.value !== undefined) params.narrativeBeats = normalizedArrays.narrativeBeats.value;
    if (normalizedArrays.characters.value !== undefined) params.characters = normalizedArrays.characters.value;
    if (normalizedArrays.scenes.value !== undefined) params.scenes = normalizedArrays.scenes.value;
    if (normalizedArrays.props.value !== undefined) params.props = normalizedArrays.props.value;
    if (normalizedArrays.sourceEvidence.value !== undefined) params.sourceEvidence = normalizedArrays.sourceEvidence.value;

    const hasExistingBreakdown = Boolean(
      data?.synopsis?.trim()
      || data?.episodes?.length
      || data?.narrativeBeats?.length
      || data?.characters?.length
      || data?.scenes?.length
      || data?.props?.length,
    );
    // A damaged persisted breakdown can have one empty core array. It is still
    // a repair: honour merge and let prospective validation report the exact
    // missing fields without deleting the surviving records.
    const writeMode: BreakdownWriteMode = resolveBreakdownWriteMode(hasExistingBreakdown, params.mode);
    const requiresFullStructure = !hasExistingBreakdown || writeMode === 'replace';
    const sourceEvidence = Array.isArray(params.sourceEvidence)
      ? [...new Set(params.sourceEvidence
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean))]
      : [];
    const hasSourceMaterial = Boolean(s.project?.sources?.length);
    if (data?.currentScriptRevisionId) {
      const review = data.scriptReview;
      if (!review || review.revisionId !== data.currentScriptRevisionId || review.status !== 'passed') {
        return {
          success: false,
          output: '',
          error: '当前剧本尚未通过 Draft Review，不能进入拆解。请先读取剧本并调用 workshop_set_script_review；只有 status="passed" 才能继续。',
        };
      }
    }
    if (requiresFullStructure && hasSourceMaterial && (sourceEvidence.length < 3 || sourceEvidence.length > 12)) {
      return {
        success: false,
        output: '',
        error: '首次剧本拆解必须提交 3-12 条 sourceEvidence，逐字摘录剧本中能证明主要人物、关系和事件的短句。电影化表达可以丰富，但故事事实必须先有原文收据。',
        recoverable: true,
      };
    }
    if (requiresFullStructure) {
      const missing: string[] = [];
      if (!Array.isArray(params.episodes) || params.episodes.length === 0) missing.push('episodes');
      if (!Array.isArray(params.narrativeBeats) || params.narrativeBeats.length === 0) missing.push('narrativeBeats');
      if (!Array.isArray(params.characters) || (params.characters.length === 0 && data?.creativeSpec?.workKind !== 'product-ad')) missing.push('characters');
      if (!Array.isArray(params.scenes) || params.scenes.length === 0) missing.push('scenes');
      if (missing.length > 0) {
        return {
          success: false,
          output: '',
          error: `首次拆解不能只写梗概，缺少结构化字段：${missing.join('、')}。请按 Scene → Narrative Beat → 角色/场景一次性提交；不要跳过中间层。`,
        };
      }
    }
    if (hasExistingBreakdown && scope !== 'story' && scope !== 'breakdown') {
      const conflicts: string[] = [];
      if (typeof params.synopsis === 'string' && data?.synopsis?.trim() && params.synopsis.trim() !== data.synopsis.trim()) {
        conflicts.push('故事梗概');
      }
      if (Array.isArray(params.episodes) && data?.episodes?.length && !valuesEqual(params.episodes, data.episodes)) {
        conflicts.push('分集分场');
      }
      const checkCoreEntities = (
        incoming: unknown,
        existing: Array<{ id: string; name: string }>,
        label: string,
      ) => {
        if (!Array.isArray(incoming) || existing.length === 0) return;
        const oldById = new Map(existing.map((item) => [item.id, item]));
        const changed = (incoming as Array<{ id?: string; name?: string }>).some((item) => {
          if (!item.id) return true;
          const old = oldById.get(item.id);
          return !old || (typeof item.name === 'string' && item.name !== old.name);
        });
        if (changed) conflicts.push(label);
      };
      checkCoreEntities(params.characters, data?.characters ?? [], '角色名单');
      checkCoreEntities(params.scenes, data?.scenes ?? [], '场景名单');
      checkCoreEntities(params.props, data?.props ?? [], '道具名单');
      if (conflicts.length > 0) {
        return {
          success: false,
          output: '',
          error: `${guardError(`已有拆解中的${conflicts.join('、')}`, request)}\n如果只是重新分析，请保留既有故事事实和实体 ID，只补充外形、性格或视觉描述。`,
        };
      }
    }
    type EpisodeRecord = WorkshopEpisode & { id: string };
    const episodePatches = Array.isArray(params.episodes)
      ? (params.episodes as Partial<WorkshopEpisode>[]).map((episode) => ({
        ...episode,
        id: typeof episode.no === 'string' ? episode.no.trim() : '',
        no: typeof episode.no === 'string' ? episode.no.trim() : '',
      })) as Array<Partial<EpisodeRecord> & Pick<EpisodeRecord, 'id'>>
      : undefined;
    const nextEpisodeRecords = episodePatches
      ? mergeBreakdownRecords<EpisodeRecord>(
        data!.episodes.map((episode) => ({ ...episode, id: episode.no })),
        episodePatches,
        writeMode,
      )
      : data!.episodes.map((episode) => ({ ...episode, id: episode.no }));
    const nextEpisodes = nextEpisodeRecords.map(({ id, ...episode }) => ({ ...episode, no: id }));

    const beatPatches = Array.isArray(params.narrativeBeats)
      ? (params.narrativeBeats as Array<Partial<WsNarrativeBeat>>).map((beat) => ({
        ...beat,
        id: typeof beat.id === 'string' ? beat.id.trim() : '',
        ...(typeof beat.sceneId === 'string' ? { sceneId: beat.sceneId.trim() } : {}),
        ...(typeof beat.title === 'string' ? { title: beat.title.trim() } : {}),
        ...(typeof beat.purpose === 'string' ? { purpose: beat.purpose.trim() } : {}),
        ...(Array.isArray(beat.shotNos) ? { shotNos: beat.shotNos.map((shotNo) => shotNo.trim()).filter(Boolean) } : {}),
      })) as Array<Partial<WsNarrativeBeat> & Pick<WsNarrativeBeat, 'id'>>
      : undefined;
    const recordPatches = <T extends { id: string }>(value: unknown) => Array.isArray(value)
      ? (value as Array<Partial<T>>).map((item) => ({
        ...item,
        id: typeof item.id === 'string' ? item.id.trim() : '',
      })) as Array<Partial<T> & Pick<T, 'id'>>
      : undefined;
    const characterPatches = recordPatches<WsCharacter>(params.characters);
    const scenePatches = recordPatches<WsScene>(params.scenes);
    const propPatches = recordPatches<WsProp>(params.props);
    const characterIdentity = reconcileCharacterIdentity(data!, characterPatches ?? [], characterPatches ? writeMode : 'merge');
    const nextCharacters = characterIdentity.data.characters;
    const nextScenes = scenePatches
      ? mergeBreakdownRecords(data!.scenes, scenePatches, writeMode)
      : data!.scenes.map((scene) => ({ ...scene }));
    const nextProps = propPatches
      ? mergeBreakdownRecords(data!.props, propPatches, writeMode)
      : data!.props.map((prop) => ({ ...prop }));
    // A merge restores missing Beats by appending them; restore the authored
    // Scene → Beat order before validating, otherwise the Beat list and the
    // Beat → Atomic Shot panel would show a repaired project out of order.
    const nextBeats = sortNarrativeBeats(
      beatPatches
        ? mergeNarrativeBeats(data!.narrativeBeats, beatPatches, writeMode)
        : (data!.narrativeBeats ?? []).map((beat) => ({ ...beat, shotNos: beat.shotNos ? [...beat.shotNos] : beat.shotNos })),
      nextScenes.map((scene) => scene.id),
    );
    const nextSynopsis = typeof params.synopsis === 'string' ? params.synopsis.trim() : data!.synopsis;
    const nextSourceEvidence = sourceEvidence.length > 0
      ? sourceEvidence
      : [...(data!.breakdownSourceEvidence ?? [])];

    // Validate the complete prospective structure on every write. This is
    // intentionally before the first mutation so a failed repair cannot leave
    // a half-written synopsis, Beat list or entity collection behind.
    const collectStructureErrors = (scenes: WsScene[], beats: WsNarrativeBeat[]): string[] => {
      const errors = validateBreakdownInput({
        creativeSpec: data?.creativeSpec,
        synopsis: nextSynopsis,
        episodes: nextEpisodes,
        narrativeBeats: beats,
        characters: nextCharacters,
        scenes,
        props: nextProps,
      });
      const review = data!.scriptReview;
      if (review && review.revisionId === data!.currentScriptRevisionId && review.status === 'passed') {
        if (review.sceneCount > scenes.length) {
          errors.push(`当前 Draft Review 记录 ${review.sceneCount} 个 Scene，合并后只有 ${scenes.length} 个；请从当前 revision 补齐缺失 Scene`);
        }
        if (review.beatCount > beats.length) {
          errors.push(`当前 Draft Review 记录 ${review.beatCount} 个 Narrative Beat，合并后只有 ${beats.length} 个；请从当前 revision 补齐缺失 Beat`);
        }
      }
      return errors;
    };
    const reviewForWrite = data!.scriptReview;
    const reviewGateOpen = Boolean(
      reviewForWrite
      && reviewForWrite.revisionId === data!.currentScriptRevisionId
      && reviewForWrite.status === 'passed',
    );
    let scenesForWrite = nextScenes;
    let beatsForWrite = nextBeats;
    let structureErrors = collectStructureErrors(scenesForWrite, beatsForWrite);

    // “审核计数 vs 实际计数”不一致时，每一轮修复都会撞同一堵门：模型提交
    // 局部补充后总数仍低于 Draft Review 门槛，写入被原子拒绝，进度永远
    // 无法累计。拒绝之前先用当前 revision 正文做一次确定性补齐，只解析
    // 原文里既有的 Scene/Beat，不调用模型、不改写已有记录。
    let structureRestoreNote = '';
    if (structureErrors.length > 0 && reviewGateOpen) {
      const revision = (data!.scriptRevisions ?? []).find((item) => item.id === data!.currentScriptRevisionId);
      const content = revision?.content ?? '';
      if (content.trim()) {
        const plan = planStructureRestore({
          content,
          scenes: scenesForWrite,
          beats: beatsForWrite,
          expectedSceneCount: reviewForWrite?.sceneCount,
          expectedBeatCount: reviewForWrite?.beatCount,
        });
        if (plan.newScenes.length > 0 || plan.newBeats.length > 0) {
          const restoredErrors = collectStructureErrors(plan.nextScenes, plan.nextBeats);
          if (restoredErrors.length < structureErrors.length) {
            scenesForWrite = plan.nextScenes;
            beatsForWrite = plan.nextBeats;
            structureErrors = restoredErrors;
            structureRestoreNote = `已按当前剧本 revision 原文确定性补齐 ${plan.newScenes.length} 个 Scene、${plan.newBeats.length} 条 Narrative Beat，未改动已有记录`;
          }
        }
      }
    }

    if (structureErrors.length > 0) {
      return {
        success: false,
        output: '',
        error: `拆解结构校验未通过，本次提交未保存任何字段；请仅修正以下问题后重试：\n${[...new Set(structureErrors)].join('\n')}`,
      };
    }

    useWorkshopStore.setState({
      data: {
        ...characterIdentity.data,
        synopsis: nextSynopsis,
        breakdownSourceEvidence: nextSourceEvidence,
        episodes: nextEpisodes,
        narrativeBeats: beatsForWrite,
        characters: nextCharacters,
        scenes: scenesForWrite,
        props: nextProps,
      },
    });
    // Idea 快捷路径没有外部剧本文件，但生成结果本身仍必须成为正式、
    // 可审计的剧本 revision，供后续 Draft Review、原子镜头和提示词阶段
    // 使用。只在没有任何当前 revision 且项目没有 source 时创建，避免
    // 普通剧本重新拆解时意外覆盖现有版本。
    let createdIdeaRevision = false;
    if (!hasSourceMaterial && !data?.currentScriptRevisionId) {
      const revisionContent = [
        nextSynopsis ? `故事梗概：${nextSynopsis}` : '',
        ...nextEpisodes.map((episode) => [
          `第${String(episode.no ?? '').trim()}集《${String(episode.title ?? '').trim()}》`,
          episode.synopsis ? `本集梗概：${String(episode.synopsis).trim()}` : '',
          episode.sceneList ? `场次：${String(episode.sceneList).trim()}` : '',
          episode.openingState ? `开场状态：${String(episode.openingState).trim()}` : '',
          episode.centralConflict ? `核心冲突：${String(episode.centralConflict).trim()}` : '',
          episode.climax ? `高潮：${String(episode.climax).trim()}` : '',
          episode.endingState ? `结尾状态：${String(episode.endingState).trim()}` : '',
          episode.script ? `详细剧本：\n${String(episode.script).trim()}` : '',
        ].filter(Boolean).join('\n')),
      ].filter(Boolean).join('\n\n');
      if (revisionContent.trim()) {
        s.recordScriptRevision({
          sourceNames: ['Idea 故事规划'],
          sourceKind: 'idea',
          content: revisionContent,
        });
        // Idea 已经形成可追踪的正式剧本快照，脚本步骤完成；后续
        // Draft Review 仍由标准审核流程负责，不在这里伪造审核结果。
        s.markStepStatus('script', 'done');
        createdIdeaRevision = true;
      }
    }
    s.invalidateDownstream('breakdown');
    s.markStepStatus('breakdown', 'in-progress');
    s.logChange('breakdown', `写入拆解：${writeMode}，角色 ${nextCharacters.length}，场景 ${scenesForWrite.length}，Beat ${beatsForWrite.length}${structureRestoreNote ? `；${structureRestoreNote}` : ''}`);
    await useWorkshopStore.getState().commitNow();
    return {
      success: true,
      output: `${Object.keys(characterIdentity.data.characterIdAliases ?? {}).length ? `角色 ID 归并（后续请复用目标 ID）：${JSON.stringify(characterIdentity.data.characterIdAliases)}。\n` : ''}拆解结果已按 ${writeMode} 写入工坊：${nextEpisodes.length} 集、${scenesForWrite.length} 个 Scene、${beatsForWrite.length} 个 Beat、${nextCharacters.length} 个角色${createdIdeaRevision ? '，并自动保存为正式 Idea 剧本 revision' : ''}${sourceEvidence.length ? `，并保存 ${sourceEvidence.length} 条原文证据` : ''}${structureRestoreNote ? `；${structureRestoreNote}` : ''}`,
    };
  },
};

const setEpisodeScriptTool: Tool = {
  definition: {
    name: 'workshop_set_episode_script',
    description: '保存第二阶段指定分集的完整剧本与资产档案。只更新目标分集，不覆盖其他分集；剧本必须包含完整场次、对白、动作、情绪和进入/离开状态，资产备注用于后续第三、四阶段继承。多集补写时每完成一集立即保存，成功回执即可作为检查点，接着处理下一集；不要为确认同一次保存反复读取或改写已保存集。',
    parameters: {
      type: 'object',
      properties: {
        episode_no: { type: 'string', description: '目标集号，如 "1"' },
        script: { type: 'string', description: '本集完整详细剧本正文' },
        character_asset_notes: { type: 'string', description: '本集角色档案与造型/状态变化' },
        scene_asset_notes: { type: 'string', description: '本集场景资产档案与空间锚点' },
        prop_asset_notes: { type: 'string', description: '本集道具资产档案与状态变化' },
        status: { type: 'string', enum: ['draft', 'frozen'] },
      },
      required: ['episode_no', 'script'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const s = useWorkshopStore.getState();
    const episodeNo = String(params.episode_no ?? '').trim();
    const script = String(params.script ?? '').trim();
    if (!episodeNo || !script) return { success: false, output: '', error: 'episode_no 和 script 不能为空。' };
    const episode = s.data?.episodes.find((item) => item.no === episodeNo);
    if (!episode) return { success: false, output: '', error: `未找到第 ${episodeNo} 集，请先写入分集季纲。` };
    const patch: Partial<WorkshopEpisode> = {
      script,
      scriptStatus: params.status === 'frozen' ? 'frozen' : 'draft',
    };
    const notes = [
      typeof params.character_asset_notes === 'string' ? `角色资产：${params.character_asset_notes.trim()}` : '',
      typeof params.scene_asset_notes === 'string' ? `场景资产：${params.scene_asset_notes.trim()}` : '',
      typeof params.prop_asset_notes === 'string' ? `道具资产：${params.prop_asset_notes.trim()}` : '',
    ].filter(Boolean).join('\n');
    if (notes) patch.characterAssetNotes = notes;
    if (!s.setEpisodeScript(episodeNo, patch)) return { success: false, output: '', error: `第 ${episodeNo} 集保存失败。` };
    s.markStepStatus('breakdown', 'in-progress');
    s.logChange('breakdown', `保存第 ${episodeNo} 集详细剧本与资产档案`);
    await s.commitNow();
    return { success: true, output: JSON.stringify({
      saved: true, episodeNo, scriptStatus: patch.scriptStatus, scriptChars: script.length,
      message: resolveWorkshopExecutionTask(currentWorkshopEditScope().request, useWorkshopStore.getState().data)
        ? breakdownQueueInstruction(useWorkshopStore.getState().data!)
        : `第 ${episodeNo} 集详细剧本已保存；本次若是多集剧本补写，请继续下一目标集，不要切换为分镜拆解。`,
      scriptProgress: useWorkshopStore.getState().data?.episodes.map((item) => ({
        no: item.no, scriptStatus: item.scriptStatus ?? 'planned', hasScript: Boolean(item.script?.trim()),
      })),
    }) };
  },
};

const setShotsTool: Tool = {
  definition: {
    name: 'workshop_set_shots',
    description: `保存已编写的分镜，不进行原子镜头质量验收。不会因为 Beat 覆盖、动作数量、时间轴轨道或表演细节不足拒绝保存，也不会自动改写内容。
默认 mode="merge" 按 shotNo 更新；replace 全量替换，须遵守用户授权与防误删保护。分批每批不超过 8 镜。
尽量写清人物、场景、动作、表情、对白、声音和适合剧情的非均匀动作时间轴；这些是创作建议，不是验收门槛。资产 ID 使用项目已有记录。保留原剧本事实与用户授权边界。`,
    parameters: {
      type: 'object',
      properties: {
        shots: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              shotNo: { type: 'string', description: '镜号，如 "01-01"（集-镜）' },
              episode: { type: 'string' },
              sceneId: { type: 'string', description: '【必填】关联场景 id（从 breakdown 的 scenes 中选）' },
              description: { type: 'string', description: '画面描述（需有电影感：具体动作+情绪外化+环境光线）' },
              narrativeBeat: { type: 'string', description: '【必填】所属叙事节拍；同一 beat 可拆成多个原子镜头' },
              atomicAction: { type: 'string', description: '【必填】本镜主叙事动作线与可见起止变化；安静或固定机位不等于无人动作。有意定格/静物/停顿需说明创作目的和时长依据，不提前执行下一镜事件；single-timeline 可包含多个前后相继节拍' },
              spatialStaging: {
                type: 'object',
                description: '【必填】先于 shotType/camera 确定世界层级与上下关系。逐个列出物理主体所在高度层、支撑条件、相对另一主体的上下位置，并选择相机观察方向。镜头升降只是视点变化，不得把高处主体压到地面。',
                properties: {
                  layers: { type: 'array', items: { type: 'object', properties: {
                    subject: { type: 'string', description: '真实角色 id、群体名或关键主体的稳定称谓' },
                    layer: { type: 'string', enum: ['ground', 'elevated', 'aerial', 'upper-architecture', 'water-surface', 'underwater', 'other'] },
                    support: { type: 'string', description: '站地、云层、飞行、楼台、船面、水下等支撑或悬空依据' },
                    relativeTo: { type: 'string', description: '相对另一主体的上下关系，例如“位于下方主体或地面之上”' },
                  }, required: ['subject', 'layer', 'support'] } },
                  viewpoint: { type: 'string', enum: ['upward', 'downward', 'level', 'mixed'] },
                  relation: { type: 'string', description: '本镜如何保持高度差与尺度关系；不能只写“高大”“宏大”' },
                  dramaticIntent: { type: 'string', description: '本镜谁在空间、权力、威胁或情绪上占上风，以及观众应感到压迫、平等、脆弱还是其他关系；允许平等对话和同层角色保持平视。' },
                  cameraMotivation: { type: 'string', description: '为什么这个 viewpoint 服务本镜戏剧目的。不能只按题材标签选机位：神话压迫可仰拍，但平等神祇交谈仍可平视。' },
                },
                required: ['layers', 'viewpoint', 'relation'],
              },
              actionTimeline: {
                type: 'object',
                description: '【创作建议，不阻断保存】本镜结构化动作时间轴，提示词必须严格据此展开。segments 必须至少覆盖 body、camera、sound 三条轨道（sound 承接 soundIntent），并按剧情补充 left-hand/right-hand/prop/gaze/emotion。多人镜头还必须为 characterIds 中每个实体角色至少写一条带 subject（真实角色 id 或姓名）的时间段；轨道和角色覆盖不足不触发验收或拒绝保存。打斗镜头不能只写一次出手加一次格挡：按攻击→应对→接触/落空→结果→重心或位置变化→下一次出手写连续回合；远程招式被挡后，继续写拉近、震退、换位或反打。',
                properties: {
                  durationSec: { type: 'number', description: '必须与镜头 durationSec 一致' },
                  summary: { type: 'string', description: '本镜时间轴一句话概述' },
                  segments: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        startSec: { type: 'number' },
                        endSec: { type: 'number' },
                        track: { type: 'string', enum: ['body', 'left-hand', 'right-hand', 'prop', 'gaze', 'emotion', 'camera', 'sound'] },
                        label: { type: 'string', description: '该时间段可见动作、镜头或声音' },
                        subject: { type: 'string', description: '该段作用于哪个角色或道具；多人镜头中每个 characterIds 实体角色至少要有一段匹配其真实 id 或姓名' },
                      },
                      required: ['startSec', 'endSec', 'track', 'label'],
                    },
                  },
                },
                required: ['durationSec', 'summary', 'segments'],
              },
              shotPlanningMode: { type: 'string', enum: ['atomic', 'single-timeline'], description: '默认 single-timeline；同一镜内按时间轴写连续动作，atomic 仅用于必须严格单动作的镜头' },
              continuityMode: { type: 'string', enum: ['inherit', 'scene-cut', 'time-jump', 'montage'], description: '【必填】与上一镜关系；同场连续镜头默认 inherit' },
              entryState: {
                type: 'object',
                description: '【必填】开场状态快照',
                properties: {
                  location: { type: 'string' }, time: { type: 'string' }, characters: { type: 'string' }, props: { type: 'string' }, environment: { type: 'string' },
                },
                required: ['location', 'time', 'characters', 'props', 'environment'],
              },
              exitState: {
                type: 'object',
                description: '【必填】结尾状态快照，下一镜 inherit 时原样继承',
                properties: {
                  location: { type: 'string' }, time: { type: 'string' }, characters: { type: 'string' }, props: { type: 'string' }, environment: { type: 'string' },
                },
                required: ['location', 'time', 'characters', 'props', 'environment'],
              },
              transitionPlan: {
                type: 'object',
                description: '【可选】单个生成镜头内唯一允许的一次受控场景转场；普通动作承接不要填写',
                properties: {
                  kind: { type: 'string', enum: ['match-cut', 'whip-pan', 'occlusion', 'light-flash', 'dissolve', 'morph'] },
                  trigger: { type: 'string', description: '画面内可见的转场触发物或动作' },
                  target: { type: 'string', description: '转场结束后揭示的目标画面' },
                  prompt: { type: 'string', description: '转场动画与人物身份、运动方向、光线/色彩/构图匹配约束' },
                },
                required: ['kind', 'trigger', 'target', 'prompt'],
              },
              sourceExcerpt: { type: 'string', description: '新建分镜时填写对应的剧本原文短句，必须逐字摘录，不要润色。它是事实锁证据，不是提示词。' },
              dialogue: { type: 'string', description: '对白' },
              shotType: { type: 'string', description: '【必填】本原子镜头的主景别（大远景/远景/全景/中景/近景/特写/大特写）' },
              camera: { type: 'string', description: '【必填】主运镜（推/拉/摇/移/升/降/甩/跟/环绕/固定）' },
              mood: { type: 'string', description: '【必填】情绪（紧张/悲伤/温馨/激昂/平静/压抑/释然 等）' },
              soundIntent: { type: 'string', description: '【必填】本镜声音意图：对白、环境声、拟音或音乐' },
              durationSec: { type: 'number', description: '【必填】用户时长默认是参考值：先按完整对白自然语速、呼吸停顿、话轮交接、必要反应与动作估算，可内部延长并同步调整 actionTimeline。不要加速或删词卡秒数。当前 single-timeline 单镜预算 15 秒，超出按完整话轮/动作落点拆镜；strict atomic 4-7 秒；受控转场 5-8 秒。按剧情权重形成长短对比，不先定镜数平均分时。' },
              characterIds: { type: 'array', items: { type: 'string' }, description: '【必填】物理空间真实出场的角色 ID；电视/屏幕/照片/海报/回忆中的人物不是本镜角色，绝不能填入；纯媒介画面可为空数组' },
              propIds: { type: 'array', items: { type: 'string' }, description: SHOT_PROP_IDS_DESCRIPTION },
              incidentalObjects: { type: 'array', items: { type: 'string' }, description: '无需独立参考图的普通物件描述，保留外观/用途/持有状态；不创建资产或生成图片。' },
              videoRatio: { type: 'string', description: '视频生成比例（必填才能生成视频），如 "16:9"/"9:16"/"4:3"/"3:4"/"1:1"/"21:9"' },
            },
            required: ['shotNo'],
          },
        },
        mode: { type: 'string', enum: ['replace', 'merge'], description: '默认 merge（按 shotNo 合并）；replace 全量替换' },
        confirmRebuild: { type: 'boolean', description: '仅“按单镜时间轴重排”专用；用户明确要求重排已有镜头时传 true，允许安全阀放行大幅减少镜头' },
        workUnitId: { type: 'string', description: '程序检查点提供的正文片段 ID；拆解队列写入时原样回传' },
        workUnitComplete: { type: 'boolean', description: '本片段全部镜头已写完时 true；分批中间提交用 false，不是质量评分' },
      },
      required: ['shots'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const s = useWorkshopStore.getState();
    const adError = adMaterialsError(s.data?.creativeSpec);
    if (adError) return { success: false, output: '', error: adError, recoverable: true };
    const mode = (params.mode as 'replace' | 'merge') ?? 'merge';
    const confirmRebuild = params.confirmRebuild === true;
    const incoming = remapCharacterReferences(params.shots as Partial<WsShot>[], s.data?.characterIdAliases);
    if (!Array.isArray(incoming) || incoming.length === 0 || incoming.some((shot) => !shot || typeof shot.shotNo !== 'string' || !shot.shotNo.trim())
      || new Set(incoming.map((shot) => shot.shotNo)).size !== incoming.length
      || !['merge', 'replace'].includes(mode)) {
      if (Array.isArray(incoming) && incoming.every((shot) => shot && typeof shot === 'object')) await persistRejectedShotBatch(s.project?.id, incoming, mode, '分镜格式无效：镜号必须非空且不重复，mode 必须是 merge 或 replace');
      return { success: false, output: '', error: '分镜格式无效：shots 必须是镜号非空且不重复的数组，mode 只能为 merge 或 replace。' };
    }
    const { scope } = currentWorkshopEditScope();
    const existingShots = s.data!.shots;
    const canRestructureShots = scope === 'story' || scope === 'shots' || scope === 'breakdown';
    const scriptReview = s.data!.scriptReview;
    if (
      s.data!.currentScriptRevisionId
      && (!scriptReview
        || scriptReview.revisionId !== s.data!.currentScriptRevisionId
        || scriptReview.status !== 'passed')
    ) {
      return {
        success: false,
        output: '',
        error: '当前剧本 revision 尚未通过 Draft Review，本次分镜未保存。请先完成或修复剧本审核，不能用分镜写入绕过审核。',
      };
    }
    {
      const canonicalDialogue = existingShots.map((shot) => shot.dialogue ?? '').filter(Boolean).join('\n');
      const conflicts = collectShotWriteConflicts({
        existing: existingShots,
        incoming,
        mode,
        canRestructureShots,
        scope,
        canonicalDialogue,
        screenplayForShot: (shot) => shotScreenplaySource(s.data!, shot),
        valuesEqual,
        isTextSupportedByCanonical,
      });
      if (conflicts.length > 0) {
        await persistRejectedShotBatch(s.project?.id, incoming, mode, conflicts.join('；'));
        return {
          success: false,
          output: '',
          error: `分镜事实锁未通过：${[...new Set(conflicts)].slice(0, 12).join('、')}。本批未保存，已有镜头未改动。\n新增分镜可以直接登记对应分集已保存剧本或当前正式剧本中的原文对白，无需额外授权。请核对本镜所属集、原文和说话人；缺少正文时先读取或补齐剧本，不要把登记已有对白当作改写剧情请求授权。`,
        };
      }
    }

    const incomingNos = new Set(incoming.map((shot) => shot.shotNo).filter((shotNo): shotNo is string => Boolean(shotNo)));
    const prospective = buildProspectiveShots(
      existingShots,
      incoming.filter((shot): shot is Partial<WsShot> & Pick<WsShot, 'shotNo'> => typeof shot.shotNo === 'string' && Boolean(shot.shotNo.trim())),
      mode,
    );
    if (mode === 'replace') {
      const existing = s.data!.shots.length;
      if (existing > 5 && incoming.length < existing * 0.5 && !confirmRebuild) {
        return {
          success: false,
          output: '',
          error: `安全阀：replace 模式会把现有 ${existing} 条分镜替换为仅 ${incoming.length} 条，将删除 ${existing - incoming.length} 条分镜。只有用户明确执行“按单镜时间轴重排”时，才允许再次调用并传 confirmRebuild=true。`,
        };
      }
    }

    // Validate execution receipts BEFORE changing either shots or the ledger.
    let breakdownWork = s.data!.breakdownWork;
    if (typeof params.workUnitId === 'string') {
      if (incoming.length > 8) return { success: false, output: '', error: '正文片段每批最多8镜，请分批提交；中间批次 workUnitComplete=false。' };
      const changedExisting = existingShots.find((shot) => incomingNos.has(shot.shotNo) && !valuesEqual(shot, prospective.find((next) => next.shotNo === shot.shotNo)));
      if (changedExisting) return { success: false, output: '', error: `队列补写不能覆盖已有镜头 ${changedExisting.shotNo}。使用新镜号追加；已有内容覆盖正文时用 workshop_complete_breakdown_unit 登记。` };
      if (mode !== 'merge') return { success: false, output: '', error: '队列写入只支持 merge，禁止覆盖已保存镜头。' };
      try {
        breakdownWork = recordBreakdownWork({ ...s.data!, shots: prospective }, params.workUnitId, [...incomingNos], params.workUnitComplete === true);
      } catch (error) { return { success: false, output: '', error: (error as Error).message }; }
    }

    // Persist the already validated effective list. Using replace here is
    // deliberate: prospective contains every existing shot plus deep-merged
    // patches, so nested entry/exit/timeline fields cannot be lost by the
    // store's shallow merge implementation.
    s.setShots(prospective, 'replace');
    const currentData = useWorkshopStore.getState().data!;
    const compiledBeats = compileNarrativeBeatShotNos(currentData.narrativeBeats, currentData.shots);
    useWorkshopStore.setState({ data: { ...currentData, narrativeBeats: compiledBeats, breakdownWork } });
    s.logChange('breakdown', `写入分镜 ${incomingNos.size} 条（${mode}）`);
    await useWorkshopStore.getState().commitNow();
    return { success: true, output: `已写入 ${incomingNos.size} 条分镜（${mode}），当前共 ${useWorkshopStore.getState().data!.shots.length} 镜${params.workUnitId ? `\n${breakdownQueueInstruction(useWorkshopStore.getState().data!)}` : ''}` };
  },
};

/** Restore source dialogue only; cannot edit visuals, refs, existing lines or invent speech. */
const restoreShotDialogueTool: Tool = {
  definition: {
    name: 'workshop_restore_shot_dialogue',
    description: '修复已有镜头漏填的原文对白。自动区分：对白为空则补回；旧对白不符合当前正文则替换冲突内容；仍符合正文的旧台词保留。执行分镜修复时无需针对补回/替换再次确认。只更新 dialogue 并使旧提示词待刷新；保留镜号、画面、资产引用和所有其他剧情字段。逐字摘录对应分集正式剧本，保留原有台词顺序。先核对镜头剧情归属，不允许凭人物名猜测对应镜头。',
    parameters: { type: 'object', properties: {
      shotNo: { type: 'string' },
      dialogue: { type: 'string', description: '修复后的完整对白，保留现有台词并按原文顺序补入漏掉的台词' },
    }, required: ['shotNo', 'dialogue'] },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const s = useWorkshopStore.getState();
    const { scope } = currentWorkshopEditScope();
    const shot = s.data!.shots.find((item) => item.shotNo === params.shotNo);
    if (!shot || typeof params.dialogue !== 'string' || !params.dialogue.trim()) return { success: false, output: '', error: '请指定真实已保存镜号和非空原文对白。' };
    const consent = currentShotSyncConsent();
    const canReplace = permitsShotSync(consent, shot, ['dialogue']);
    if (consent && !canReplace) return { success: false, output: '', error: `本次对白同步授权仅限第${consent.episode}集，不能修改其他集。` };
    if (!canReplace && !['breakdown', 'shots', 'story'].includes(scope)) return { success: false, output: '', error: '当前请求没有分镜修复权限，不能修改对白。' };
    if (s.data!.currentScriptRevisionId && (s.data!.scriptReview?.revisionId !== s.data!.currentScriptRevisionId || s.data!.scriptReview?.status !== 'passed')) return { success: false, output: '', error: '已收到同步授权，但当前正式剧本版本尚未审核通过。' };
    const source = shotScreenplaySource(s.data!, shot);
    const sync = planDialogueSync(shot.dialogue ?? '', params.dialogue, source, canReplace);
    if (sync.error) return { success: false, output: '', error: sync.error };
    if (sync.kind === 'unchanged') return { success: true, output: `${shot.shotNo} 对白已与提交原文一致，无需重复写入。` };
    // Restoring source metadata must not discard already accepted media.
    useWorkshopStore.setState({ data: { ...s.data!, shots: s.data!.shots.map((item) => item.shotNo === shot.shotNo ? { ...item, dialogue: params.dialogue as string, promptNeedsRefresh: true } : item) } });
    await useWorkshopStore.getState().commitNow();
    return { success: true, output: `${shot.shotNo} ${sync.kind === 'replace' ? '冲突旧对白已按当前正文替换' : '漏填原文对白已补回'}；画面和镜号未修改，旧提示词需按新对白刷新。继续核对剩余原文台词，完成后登记正文片段。` };
  },
};

/** Migrate existing shots into the queue without rewriting any authored content. */
const completeBreakdownUnitTool: Tool = {
  definition: {
    name: 'workshop_complete_breakdown_unit',
    description: '把正文片段和已经保存的本集镜头关联，登记本片段已拆完。只记录执行进度，不改写镜头，不评估质量。尚未写完必须先追加镜头。',
    parameters: { type: 'object', properties: {
      workUnitId: { type: 'string' },
      shotNos: { type: 'array', items: { type: 'string' }, description: '完整覆盖该片段的已保存镜号，不能跨集' },
    }, required: ['workUnitId', 'shotNos'] },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const s = useWorkshopStore.getState();
    if (!Array.isArray(params.shotNos) || !params.shotNos.every((no) => typeof no === 'string')) return { success: false, output: '', error: 'shotNos 必须为真实镜号数组。' };
    try {
      const breakdownWork = recordBreakdownWork(s.data!, String(params.workUnitId), params.shotNos as string[], true);
      useWorkshopStore.setState({ data: { ...s.data!, breakdownWork } });
      await useWorkshopStore.getState().commitNow();
      return { success: true, output: `正文片段已登记完成；剩余 ${pendingBreakdownUnits(useWorkshopStore.getState().data!).length} 段。已有镜头内容未修改。\n${breakdownQueueInstruction(useWorkshopStore.getState().data!)}` };
    } catch (error) { return { success: false, output: '', error: (error as Error).message }; }
  },
};

const setCharacterHandoffsTool: Tool = {
  definition: {
    name: 'workshop_set_character_handoffs',
    description: `写入跨集人物连续性 handoff。必须由作者明确 inheritedState、intendedChange、目标镜头以及身份/造型是否变化；工具只校验，不替用户猜测状态或自动选变体。
⚠ shotIds 的语义：必须填写 **targetEpisode 中该角色真实出场的镜头 id**（交接的落点），不是源集的最后一镜，也不是 shotNo 与 id 混用。例如 1→2 的 handoff 应绑 02-xx 而非 01-10。请先用 workshop_get_state(section:"breakdown") 取目标集该角色的镜头 id；若目标集还没有该角色镜头，先补齐分镜再写 handoff。`,
    parameters: {
      type: 'object',
      properties: {
        handoffs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              characterId: { type: 'string' },
              sourceEpisode: { type: 'string' },
              targetEpisode: { type: 'string' },
              inheritedState: { type: 'string' },
              intendedChange: { type: 'string' },
              shotIds: { type: 'array', items: { type: 'string' } },
              visualHandoff: {
                type: 'object',
                properties: {
                  mode: { type: 'string', enum: ['preserve', 'change'] },
                  sourceVariantId: { type: 'string' },
                  targetVariantId: { type: 'string' },
                  changeReason: { type: 'string' },
                },
                required: ['mode'],
              },
              identityHandoff: {
                type: 'object',
                properties: {
                  mode: { type: 'string', enum: ['preserve', 'change'] },
                  changeReason: { type: 'string' },
                },
                required: ['mode'],
              },
              createdAt: { type: 'number' },
            },
            required: ['id', 'characterId', 'sourceEpisode', 'targetEpisode', 'inheritedState', 'intendedChange', 'shotIds'],
          },
        },
      },
      required: ['handoffs'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const store = useWorkshopStore.getState();
    const data = store.data!;
    const handoffs = (params.handoffs as WsCharacterHandoff[]).map((handoff) => ({ ...handoff, createdAt: handoff.createdAt || Date.now() }));
    const issues = validateCharacterHandoffs({ ...data, characterHandoffs: handoffs });
    if (issues.length > 0) return { success: false, output: '', error: `跨集人物连续性校验未通过：\n${issues.map((issue) => `${issue.handoffId}: ${issue.message}`).join('\n')}` };
    useWorkshopStore.setState({ data: { ...data, characterHandoffs: handoffs } });
    await useWorkshopStore.getState().commitNow();
    return { success: true, output: `已写入 ${handoffs.length} 条跨集人物 handoff；目标 Episode 的状态、变体和身份变化均已显式记录。` };
  },
};


const setBiblesTool: Tool = {
  definition: {
    name: 'workshop_set_bibles',
    description: `写入项目四圣经：导演圣经、角色圣经、场景圣经、连续性圣经。
用于剧本拆解完成后，把全项目必须继承的镜头/光影/角色/场景/连续性规则固化下来。
后续资产提示词、分镜提示词、Seedance 视频提示词都必须继承这些规则。
不要把单镜临时创意写进四圣经；只写跨全片稳定生效的约束。
continuity.blockingContinuity 专门记录每一幕/每一场景的世界空间站位基准和剧情触发的走位递进：场景锚点、人物相对位置/朝向/距离、180度轴线、出入口、上一状态→触发动作→下一状态。不要只写“画面左/右”，因为换机位后屏幕方位会变化。`,
    parameters: {
      type: 'object',
      properties: {
        bibles: {
          type: 'object',
          description: 'WorkshopProjectBibles 对象，可包含 director/character/scene/continuity 四段。每段必须带 updatedAt（毫秒时间戳）；没有则工具自动补齐。',
        },
      },
      required: ['bibles'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const now = Date.now();
    const incoming = params.bibles as WorkshopProjectBibles;
    const bibles: WorkshopProjectBibles = {
      director: incoming.director ? { ...incoming.director, updatedAt: incoming.director.updatedAt || now } : undefined,
      character: incoming.character ? { ...incoming.character, updatedAt: incoming.character.updatedAt || now } : undefined,
      scene: incoming.scene ? { ...incoming.scene, updatedAt: incoming.scene.updatedAt || now } : undefined,
      continuity: incoming.continuity ? { ...incoming.continuity, updatedAt: incoming.continuity.updatedAt || now } : undefined,
    };
    const store = useWorkshopStore.getState();
    store.setBibles(bibles);
    const projectId = store.project?.id;
    if (projectId) {
      await writeProjectFile(projectId, 'bibles/index.json', JSON.stringify(bibles, null, 2));
      if (bibles.director) await writeProjectFile(projectId, 'bibles/director-bible.json', JSON.stringify(bibles.director, null, 2));
      if (bibles.character) await writeProjectFile(projectId, 'bibles/character-bible.json', JSON.stringify(bibles.character, null, 2));
      if (bibles.scene) await writeProjectFile(projectId, 'bibles/scene-bible.json', JSON.stringify(bibles.scene, null, 2));
      if (bibles.continuity) await writeProjectFile(projectId, 'bibles/continuity-bible.json', JSON.stringify(bibles.continuity, null, 2));
    }
    await useWorkshopStore.getState().commitNow();
    const active = [
      bibles.director && '导演圣经',
      bibles.character && '角色圣经',
      bibles.scene && '场景圣经',
      bibles.continuity && '连续性圣经',
    ].filter(Boolean).join('、') || '空';
    return { success: true, output: `已写入项目四圣经：${active}` };
  },
};

const updateShotTool: Tool = {
  definition: {
    name: 'workshop_update_shot',
    description: `修改单条分镜的字段。事实锁：用户只要求改提示词时，不得修改 description/dialogue/sourceExcerpt/characterIds/sceneId/propIds；只有用户明确要求改剧本、对白或重排分镜时才放行。force_edit 不能绕过事实锁。

 patch 可用的字段名（必须严格一致）：description（画面描述）、sourceExcerpt（对应剧本逐字原文）、dialogue（对白）、narrativeBeat（叙事节拍）、atomicAction（主叙事动作线）、shotPlanningMode（atomic/single-timeline）、continuityMode（inherit/scene-cut/time-jump/montage）、entryState、exitState、transitionPlan（可选的单次受控转场：kind/trigger/target/prompt；关闭时传 null）、shotType（景别）、camera（运镜）、mood（情绪）、durationSec（按剧情权重分配，不要平均：single-timeline 上限 15s，H3 支持 5-15s；strict atomic 4-7s；受控转场 5-8s）、characterIds（关联角色ID数组，必填！）、propIds（关联道具ID数组）、sceneId（关联场景ID，必填！）、voiceCharacterIds（本镜显式启用的角色音色资产ID数组；只有这里列出的角色 voicePath 才会传入视频生成；没有台词/不需要音色时传 []）、audioInjected（是否把 generatedAudios 作为本镜配音资产传入）、generatedAudios（已生成配音文件）、imagePrompt（生图提示词）、videoPrompt（详细时间轴视频提示词，必须严格遵守时序、角色和资产）、expectedRefSignature（写提示词时从 workshop_get_shot_refs 原样带回的参考签名，不会存入分镜）、videoRatio（视频比例，如 "16:9"）、imagePath（生成图路径）、videoPath（视频路径）、genStatus。注意：不要用 prompt，必须用 imagePrompt 或 videoPrompt。批量或长文本提示词优先用 workshop_set_prompts；如果这里传 imagePrompt/videoPrompt，本工具会自动走同一套提示词校验与写后校验，videoPrompt 会按项目或单镜 videoPromptTemplate 写入经典版（videoPrompt）或新版（universalVideoPrompt）独立槽位，互不覆盖。

视频首次写入、优化和重写统一交给 workshop_set_prompts（rewriteVideo: true）调用 MiniMax H3 skill；不必先生成草稿。兼容 videoPrompt 字段同样触发该服务，不再使用中文通用模板或 Seedance @图片N 规则。英文描述，原文对白保留原语言。`,
    parameters: {
      type: 'object',
      properties: {
        shot_no: { type: 'string' },
        patch: {
          type: 'object',
          description: '要更新的字段子集，如 {"durationSec": 10}。长文本提示词建议用 workshop_set_prompts；这里传 videoPrompt/imagePrompt 时会自动走提示词管线。',
        },
      },
      required: ['shot_no', 'patch'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const s = useWorkshopStore.getState();
    const shotNo = params.shot_no as string;
    if (!s.data!.shots.some((x) => x.shotNo === shotNo)) {
      return missingPersistedShotResult(shotNo);
    }
    const rawPatch = params.patch as Record<string, unknown>;
    const forceEdit = rawPatch.force_edit === true;
    const expectedRefSignature = typeof rawPatch.expectedRefSignature === 'string'
      ? rawPatch.expectedRefSignature
      : typeof rawPatch.expected_ref_signature === 'string'
        ? rawPatch.expected_ref_signature
        : undefined;
    const promptPatch: Pick<Partial<WsShot>, 'imagePrompt' | 'videoPrompt' | 'audioPrompts'> = {};
    const patch: Partial<WsShot> = {};
    for (const [k, v] of Object.entries(rawPatch)) {
      if (k === 'force_edit' || k === 'expectedRefSignature' || k === 'expected_ref_signature') continue;
      if (k === 'imagePrompt' || k === 'image_prompt') {
        if (typeof v === 'string') promptPatch.imagePrompt = v;
        continue;
      }
      if (k === 'videoPrompt' || k === 'video_prompt' || k === 'universalVideoPrompt' || k === 'seedance25VideoPrompt') {
        if (typeof v === 'string') promptPatch.videoPrompt = v;
        continue;
      }
      if (k === 'audioPrompts' || k === 'audio_prompts') {
        if (Array.isArray(v)) promptPatch.audioPrompts = v as WsShot['audioPrompts'];
        continue;
      }
      if (k === 'character_ids') {
        if (Array.isArray(v)) patch.characterIds = v.filter((x): x is string => typeof x === 'string');
        continue;
      }
      if (k === 'characterIds') {
        if (Array.isArray(v)) patch.characterIds = v.filter((x): x is string => typeof x === 'string');
        continue;
      }
      if (k === 'prop_ids') {
        if (Array.isArray(v)) patch.propIds = v.filter((x): x is string => typeof x === 'string');
        continue;
      }
      if (k === 'propIds') {
        if (Array.isArray(v)) patch.propIds = v.filter((x): x is string => typeof x === 'string');
        continue;
      }
      if (k === 'scene_id') {
        if (typeof v === 'string') patch.sceneId = v;
        continue;
      }
      if (k === 'sceneId') {
        if (typeof v === 'string') patch.sceneId = v;
        continue;
      }
      if (k === 'scene_image_paths') {
        if (Array.isArray(v)) patch.sceneImagePaths = v.filter((x): x is string => typeof x === 'string');
        continue;
      }
      if (k === 'sceneImagePaths') {
        if (Array.isArray(v)) patch.sceneImagePaths = v.filter((x): x is string => typeof x === 'string');
        continue;
      }
      if (k === 'extra_ref_images') {
        if (Array.isArray(v)) patch.extraRefImages = v.filter((x): x is string => typeof x === 'string');
        continue;
      }
      if (k === 'extraRefImages') {
        if (Array.isArray(v)) patch.extraRefImages = v.filter((x): x is string => typeof x === 'string');
        continue;
      }
      if (k === 'voiceCharacterIds' || k === 'voice_character_ids') {
        if (Array.isArray(v)) patch.voiceCharacterIds = v.filter((x): x is string => typeof x === 'string');
        continue;
      }
      if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
    }

    // Protection: warn when modifying shots that already have generated output
    const existingShot = s.data!.shots.find((x) => x.shotNo === shotNo)!;
    const { scope, request } = currentWorkshopEditScope();
    const structuralFields: Array<keyof WsShot> = [
      'description',
      'sourceExcerpt',
      'episode',
      'sceneId',
      'characterIds',
      'propIds',
      'narrativeBeat',
      'atomicAction',
      'spatialStaging',
      'shotPlanningMode',
      'continuityMode',
      'entryState',
      'exitState',
      'transitionPlan',
      'soundIntent',
    ];
    const changedStructural = structuralFields.filter((field) =>
      patch[field] !== undefined && !valuesEqual(patch[field], existingShot[field]));
    const changesDialogue = patch.dialogue !== undefined && patch.dialogue !== existingShot.dialogue;
    // A source-dialogue-only patch is the same operation regardless of the
    // tool chosen by the model. Reuse its authorization, validation and
    // persistence path (which preserves existing media), not a second gate.
    const dialogueOnlySync = typeof patch.dialogue === 'string'
      && Object.keys(patch).every((field) => field === 'dialogue')
      && Object.keys(promptPatch).length === 0
      && (scope === 'breakdown' || scope === 'shots' || Boolean(currentShotSyncConsent()));
    if (dialogueOnlySync) {
      return restoreShotDialogueTool.execute({ shotNo, dialogue: patch.dialogue });
    }

    const syncConsent = currentShotSyncConsent();
    const syncFields = [...changedStructural, ...(changesDialogue ? ['dialogue'] : [])];
    const permittedSync = permitsShotSync(syncConsent, existingShot, syncFields);
    if (syncConsent && syncFields.length && !permittedSync) return { success: false, output: '', error: `本次同步授权仅限第${syncConsent.episode}集已有镜头的对白与不一致动作，不能修改其他集、镜号或集归属。` };
    if (permittedSync) {
      if (s.data!.currentScriptRevisionId && (s.data!.scriptReview?.revisionId !== s.data!.currentScriptRevisionId || s.data!.scriptReview?.status !== 'passed')) return { success: false, output: '', error: '已收到同步授权，但当前正式剧本版本尚未审核通过；不能用授权跳过源剧本审核。' };
      const source = shotScreenplaySource(s.data!, existingShot);
      if (changesDialogue && patch.dialogue?.trim() && !supportsRestoredDialogue(patch.dialogue, source)) {
        return { success: false, output: '', error: '已收到本集同步授权，但对白仍须逐字来自当前正文，不能编写新台词。' };
      }
      if (patch.sourceExcerpt?.trim() && !source.includes(patch.sourceExcerpt.trim())) return { success: false, output: '', error: '已收到同步授权，但 sourceExcerpt 必须逐字摘录当前分集正文。' };
    }
    if (!permittedSync && (
      (changedStructural.length > 0 && scope !== 'story' && scope !== 'shots')
      || (changesDialogue && scope !== 'story')
    )) {
      const fields = [
        ...changedStructural,
        ...(changesDialogue ? ['dialogue'] : []),
      ];
      return {
        success: false,
        output: '',
        error: guardError(`分镜 ${shotNo} 的 ${fields.join('、')}`, request),
      };
    }
    const protectedFields = ['characterIds', 'propIds', 'sceneId', 'durationSec'];
    const touchesPrompt = promptPatch.imagePrompt !== undefined || promptPatch.videoPrompt !== undefined || promptPatch.audioPrompts !== undefined;
    if (touchesPrompt && expectedRefSignature) {
      const currentRefSignature = shotReferenceSignature(existingShot, s.data!);
      if (expectedRefSignature !== currentRefSignature) {
        return {
          success: false,
          output: '',
          error: `分镜 ${shotNo} 的参考资产已在读取后发生变化。请重新调用 workshop_get_shot_refs，并按当前签名 ${currentRefSignature} 重写提示词。`,
        };
      }
    }
    const touchesProtected = touchesPrompt || protectedFields.some((f) => f in patch);
    if (!forceEdit && touchesProtected && (existingShot.videoPath || existingShot.imagePath)) {
      const hasVideo = !!existingShot.videoPath;
      const hasImage = !!existingShot.imagePath;
      const what = [hasVideo && '视频', hasImage && '分镜图'].filter(Boolean).join('和');
      return {
        success: false,
        output: '',
        error: `分镜 ${shotNo} 已有生成的${what}。修改 ${Object.keys(patch).join('/')} 后现有产物将与新内容不一致。请先确认用户同意修改，然后在 patch 中额外传入 force_edit: true 来覆盖保护。`,
      };
    }

    const changed: string[] = [];
    if (Object.keys(patch).length > 0) {
      const latestStore = useWorkshopStore.getState();
      const oldShot = latestStore.data!.shots.find((x) => x.shotNo === shotNo)!;
      const nextShot = { ...oldShot, ...patch };
      const refRemap = touchesReferenceFields(patch) ? remapPromptRefsForShot(oldShot, nextShot, latestStore.data!) : {};
      const finalPatch = { ...refRemap, ...patch };
      useWorkshopStore.getState().updateShot(shotNo, finalPatch);
      await useWorkshopStore.getState().commitNow();
      const latest = useWorkshopStore.getState().data?.shots.find((x) => x.shotNo === shotNo);
      if (!latest) return { success: false, output: '', error: `分镜 ${shotNo} 写入后无法读取` };
      const verifyFailures = verifyShotPatch(latest, patch);
      if (verifyFailures.length > 0) {
        return {
          success: false,
          output: '',
          error: `分镜 ${shotNo} 字段写入校验失败：${verifyFailures.join('、')} 保存后未生效。请刷新工坊状态后重试。`,
        };
      }
      changed.push(...Object.keys(finalPatch));
    }
    if (touchesPrompt) {
      const result = await applySinglePromptPatch(shotNo, promptPatch);
      if (!result.ok) return { success: false, output: '', error: result.error ?? `分镜 ${shotNo} 提示词写入失败` };
      changed.push(...Object.keys(promptPatch));
      const warningText = result.warnings.length
        ? `\n检查警告（已写入并标记建议重写）：\n${result.warnings.slice(0, 12).join('\n')}${result.warnings.length > 12 ? `\n…还有 ${result.warnings.length - 12} 条` : ''}`
        : '';
      return { success: true, output: `分镜 ${shotNo} 已通过提示词管线更新：${changed.join('、') || '提示词'}${warningText}` };
    }
    return { success: true, output: `分镜 ${shotNo} 已更新${changed.length ? `：${changed.join('、')}` : ''}` };
  },
};

const updateShotRefsTool: Tool = {
  definition: {
    name: 'workshop_update_shot_refs',
    description: `专门管理单条分镜实际传入生成的参考资产。用于添加/删除/替换 @图片N 背后的真实引用，避免只改提示词但资产没有传入。

常用：
- 给某镜加入角色参考：{"shot_no":"05-04","add_character_ids":["winged_beast_flying_bronze"]}
- 从某镜移除角色参考：{"shot_no":"05-04","remove_character_ids":["winged_beast_flying_bronze"]}
- 删除当前 @图片七：{"shot_no":"05-04","remove_refs":["@图片七"]}
- 替换当前 @图片七 为角色：{"shot_no":"05-04","replace_ref":"@图片七","to_kind":"character","to_id":"winged_beast_flying_bronze"}
- 单独指定本镜场景参考图：{"shot_no":"05-04","set_scene_image_paths":["/abs/a.png"]}；传 [] 表示本镜不传场景图；不传表示跟随场景默认图。

注意：这个工具改的是实际参考资产，并会按图片路径自动重排 imagePrompt/videoPrompt/storyboardFrames 里的 @图片N。语义内容仍可能需要用 workshop_set_prompts 进一步重写。`,
    parameters: {
      type: 'object',
      properties: {
        shot_no: { type: 'string' },
        add_character_ids: { type: 'array', items: { type: 'string' } },
        remove_character_ids: { type: 'array', items: { type: 'string' } },
        set_character_ids: { type: 'array', items: { type: 'string' } },
        add_prop_ids: { type: 'array', items: { type: 'string' } },
        remove_prop_ids: { type: 'array', items: { type: 'string' } },
        set_prop_ids: { type: 'array', items: { type: 'string' } },
        set_scene_image_paths: { type: 'array', items: { type: 'string' }, description: '本镜场景参考图路径。[] 表示本镜不传场景图；不传则不修改。' },
        add_extra_ref_images: { type: 'array', items: { type: 'string' } },
        remove_extra_ref_images: { type: 'array', items: { type: 'string' } },
        remove_refs: { type: 'array', items: { type: 'string' }, description: '按当前 @图片N 删除引用，如 ["@图片七"]。' },
        replace_ref: { type: 'string', description: '要替换的当前引用编号，如 @图片七。' },
        to_kind: { type: 'string', enum: ['character', 'prop', 'scene', 'extra'] },
        to_id: { type: 'string', description: 'to_kind 为 character/prop 时使用。' },
        to_path: { type: 'string', description: 'to_kind 为 scene/extra 时使用，也可用于把某角色/道具的资产图作为 extra 传入。' },
      },
      required: ['shot_no'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const ws = useWorkshopStore.getState();
    const data = ws.data!;
    const shotNo = String(params.shot_no ?? '').trim();
    const shot = data.shots.find((x) => x.shotNo === shotNo);
    if (!shot) return missingPersistedShotResult(shotNo);

    const charIds = new Set(shot.characterIds ?? []);
    const propIds = new Set(shot.assetPropIds ?? shot.propIds ?? []);
    let sceneImagePaths = shot.sceneImagePaths ? [...shot.sceneImagePaths] : undefined;
    const extraRefImages = new Set(shot.extraRefImages ?? []);
    let storyboardBoards = shot.storyboardBoards;
    let colorPaletteId = shot.colorPaletteId;
    const changed: string[] = [];
    const warnings: string[] = [];

    const verifyLocalReferencePath = async (path: string, label: string): Promise<string | null> => {
      const value = path.trim();
      if (!value || /^(?:https?:|data:image\/)/i.test(value)) return null;
      try {
        await invoke('get_file_metadata', { path: value });
        return null;
      } catch {
        return `${label}不是GDream本机可读取的图片文件：${value}`;
      }
    };

    // Drop unreadable references before applying the new reference set so a
    // stale local path cannot reach an image provider.
    const pruneUnreadableExistingRefs = async () => {
      const checkPaths = async (paths: string[] | undefined) => {
        const valid: string[] = [];
        for (const path of paths ?? []) {
          if (await verifyLocalReferencePath(path, '已有参考图')) {
            warnings.push(`已移除不可读取的旧参考图：${path}`);
          } else {
            valid.push(path);
          }
        }
        return valid;
      };
      if (sceneImagePaths) {
        const before = sceneImagePaths.length;
        sceneImagePaths = await checkPaths(sceneImagePaths);
        if (sceneImagePaths.length !== before) changed.push('sceneImagePaths');
      }
      const beforeExtra = extraRefImages.size;
      const validExtra = await checkPaths([...extraRefImages]);
      extraRefImages.clear();
      validExtra.forEach((path) => extraRefImages.add(path));
      if (extraRefImages.size !== beforeExtra) changed.push('extraRefImages');
    };

    const ensureCharacter = (id: string): string | null => {
      const c = data.characters.find((x) => x.id === id);
      if (!c) return `角色 ID 不存在：${id}`;
      if (!c.assetImagePath) warnings.push(`角色"${c.name}"还没有资产图，加入后生成时仍可能缺参考图`);
      return null;
    };
    const ensureProp = (id: string): string | null => {
      const p = (data.props ?? []).find((x) => x.id === id);
      if (!p) return `道具 ID 不存在：${id}`;
      if (!p.assetImagePath) warnings.push(`道具"${p.name}"还没有资产图，加入后生成时仍可能缺参考图`);
      return null;
    };
    const addTarget = (kind: unknown, id: unknown, path: unknown) => {
      if (kind === 'character') {
        if (typeof id !== 'string' || !id.trim()) throw new Error('to_kind=character 需要 to_id');
        const err = ensureCharacter(id.trim());
        if (err) throw new Error(err);
        charIds.add(id.trim());
        changed.push('characterIds');
      } else if (kind === 'prop') {
        if (typeof id !== 'string' || !id.trim()) throw new Error('to_kind=prop 需要 to_id');
        const err = ensureProp(id.trim());
        if (err) throw new Error(err);
        propIds.add(id.trim());
        changed.push('propIds');
      } else if (kind === 'scene') {
        if (typeof path !== 'string' || !path.trim()) throw new Error('to_kind=scene 需要 to_path');
        sceneImagePaths = [...new Set([...(sceneImagePaths ?? getSceneReferencePaths(shot, data.scenes)), path.trim()])];
        changed.push('sceneImagePaths');
      } else if (kind === 'extra') {
        if (typeof path !== 'string' || !path.trim()) throw new Error('to_kind=extra 需要 to_path');
        extraRefImages.add(path.trim());
        changed.push('extraRefImages');
      }
    };
    const removeBinding = (binding: ShotRefBinding) => {
      if (binding.kind === 'storyboardBoard') {
        storyboardBoards = (storyboardBoards ?? []).filter((b) => b.id !== binding.id);
        changed.push('storyboardBoards');
      } else if (binding.kind === 'scene') {
        const current = sceneImagePaths ?? getSceneReferencePaths(shot, data.scenes);
        sceneImagePaths = current.filter((p) => p !== binding.path);
        changed.push('sceneImagePaths');
      } else if (binding.kind === 'character') {
        if (binding.id) charIds.delete(binding.id);
        changed.push('characterIds');
      } else if (binding.kind === 'prop') {
        if (binding.id) propIds.delete(binding.id);
        changed.push('propIds');
      } else if (binding.kind === 'extra') {
        extraRefImages.delete(binding.path);
        changed.push('extraRefImages');
      } else if (binding.kind === 'palette') {
        colorPaletteId = '__none__';
        changed.push('colorPaletteId');
      }
    };

    try {
      await pruneUnreadableExistingRefs();
      const pathsToVerify: Array<[string, string]> = [];
      if (Array.isArray(params.set_scene_image_paths)) {
        uniqStrings(params.set_scene_image_paths).forEach((path) => pathsToVerify.push([path, '场景参考图']));
      }
      if (Array.isArray(params.add_extra_ref_images)) {
        uniqStrings(params.add_extra_ref_images).forEach((path) => pathsToVerify.push([path, '额外参考图']));
      }
      if ((params.to_kind === 'scene' || params.to_kind === 'extra') && typeof params.to_path === 'string') {
        pathsToVerify.push([params.to_path, '替换参考图']);
      }
      for (const [path, label] of pathsToVerify) {
        const error = await verifyLocalReferencePath(path, label);
        if (error) return { success: false, output: '', error };
      }

      if (Array.isArray(params.set_character_ids)) {
        const ids = uniqStrings(params.set_character_ids);
        for (const id of ids) {
          const err = ensureCharacter(id);
          if (err) return { success: false, output: '', error: err };
        }
        charIds.clear();
        ids.forEach((id) => charIds.add(id));
        changed.push('characterIds');
      }
      for (const id of uniqStrings(Array.isArray(params.add_character_ids) ? params.add_character_ids : [])) {
        const err = ensureCharacter(id);
        if (err) return { success: false, output: '', error: err };
        charIds.add(id);
        changed.push('characterIds');
      }
      for (const id of uniqStrings(Array.isArray(params.remove_character_ids) ? params.remove_character_ids : [])) {
        charIds.delete(id);
        changed.push('characterIds');
      }

      if (Array.isArray(params.set_prop_ids)) {
        const ids = uniqStrings(params.set_prop_ids);
        for (const id of ids) {
          const err = ensureProp(id);
          if (err) return { success: false, output: '', error: err };
        }
        propIds.clear();
        ids.forEach((id) => propIds.add(id));
        changed.push('propIds');
      }
      for (const id of uniqStrings(Array.isArray(params.add_prop_ids) ? params.add_prop_ids : [])) {
        const err = ensureProp(id);
        if (err) return { success: false, output: '', error: err };
        propIds.add(id);
        changed.push('propIds');
      }
      for (const id of uniqStrings(Array.isArray(params.remove_prop_ids) ? params.remove_prop_ids : [])) {
        propIds.delete(id);
        changed.push('propIds');
      }

      if (Array.isArray(params.set_scene_image_paths)) {
        sceneImagePaths = uniqStrings(params.set_scene_image_paths);
        changed.push('sceneImagePaths');
      }
      const incomingExtras = uniqStrings(Array.isArray(params.add_extra_ref_images) ? params.add_extra_ref_images : []);
      incomingExtras.forEach((path) => {
        extraRefImages.add(path);
        changed.push('extraRefImages');
      });
      uniqStrings(Array.isArray(params.remove_extra_ref_images) ? params.remove_extra_ref_images : []).forEach((path) => {
        extraRefImages.delete(path);
        changed.push('extraRefImages');
      });

      const bindings = buildShotRefBindings(shot, data);
      const removeRefs = Array.isArray(params.remove_refs) ? params.remove_refs : [];
      for (const ref of removeRefs) {
        const index = parseImageRefIndex(ref);
        if (!index) return { success: false, output: '', error: `无法识别引用编号：${String(ref)}` };
        const binding = bindings.find((b) => b.index === index);
        if (!binding) return { success: false, output: '', error: `当前分镜没有 @图片${numToCn(index)} 对应的参考资产` };
        removeBinding(binding);
      }

      if (params.replace_ref) {
        const index = parseImageRefIndex(params.replace_ref);
        if (!index) return { success: false, output: '', error: `无法识别 replace_ref：${String(params.replace_ref)}` };
        const binding = bindings.find((b) => b.index === index);
        if (!binding) return { success: false, output: '', error: `当前分镜没有 @图片${numToCn(index)} 对应的参考资产` };
        removeBinding(binding);
        addTarget(params.to_kind, params.to_id, params.to_path);
      }
    } catch (err) {
      return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }

    const uniqueChanged = [...new Set(changed)];
    if (uniqueChanged.length === 0) {
      return { success: true, output: `分镜 ${shotNo} 参考资产未变化` };
    }

    const patch: Partial<WsShot> = {
      characterIds: [...charIds],
      // A reference edit must update the effective visual subset too, otherwise
      // legacy assetPropIds can silently keep removed pictures in the request.
      ...(uniqueChanged.includes('propIds')
        ? { propIds: [...propIds], assetPropIds: [...propIds] }
        : {}),
      extraRefImages: [...extraRefImages],
      promptNeedsRefresh: true,
    };
    if (sceneImagePaths !== undefined) patch.sceneImagePaths = sceneImagePaths;
    if (storyboardBoards !== shot.storyboardBoards) patch.storyboardBoards = storyboardBoards;
    if (colorPaletteId !== shot.colorPaletteId) patch.colorPaletteId = colorPaletteId;
    const nextShot = { ...shot, ...patch };
    const refRemap = remapPromptRefsForShot(shot, nextShot, data);
    const finalPatch = { ...refRemap, ...patch };
    useWorkshopStore.getState().updateShot(shotNo, finalPatch);
    useWorkshopStore.getState().markStepStatus('prompts', 'in-progress');
    useWorkshopStore.getState().logChange('prompts', `更新 ${shotNo} 参考资产：${uniqueChanged.join('、')}`);
    await useWorkshopStore.getState().commitNow();

    const latest = useWorkshopStore.getState().data?.shots.find((x) => x.shotNo === shotNo);
    if (!latest) return { success: false, output: '', error: `分镜 ${shotNo} 写入后无法读取` };
    const verifyFailures = verifyShotPatch(latest, patch);
    if (verifyFailures.length > 0) {
      return {
        success: false,
        output: '',
        error: `分镜 ${shotNo} 参考资产写入校验失败：${verifyFailures.join('、')} 保存后未生效。请刷新工坊状态后重试。`,
      };
    }
    const latestBindings = buildShotRefBindings(latest, useWorkshopStore.getState().data!);
    const summary = latestBindings.map((ref) => `@图片${numToCn(ref.index)}=${ref.label}`).join('；') || '无图片参考';
    return {
      success: true,
      output: `分镜 ${shotNo} 参考资产已更新：${uniqueChanged.join('、')}\n当前引用顺序：${summary}${warnings.length ? `\n提醒：${warnings.join('；')}` : ''}\n已按真实图片路径同步重排 @图片N；如画面语义也变了，请继续用 workshop_set_prompts 重写。`,
    };
  },
};

/**
 * Prompt generation is a single user action. If an agent omitted the separate
 * timeline tool call for one shot, create a minimal valid timeline from facts
 * already stored on that shot so the remaining prompt batch is not blocked.
 * The fallback never invents a new story event; it only supplies the required
 * body/camera/sound tracks covering the complete shot duration.
 */
function ensureShotActionTimeline(shot: WsShot): boolean {
  if (shot.actionTimeline?.segments?.length) return false;
  const duration = Math.max(4, Number(shot.durationSec ?? 5));
  const summary = (shot.atomicAction || shot.description || '连续完成本镜既定动作').trim();
  const nextTimeline: NonNullable<WsShot['actionTimeline']> = {
    durationSec: duration,
    summary,
    segments: [
      { startSec: 0, endSec: duration, track: 'body', label: summary, subject: shot.narrativeBeat || undefined },
      { startSec: 0, endSec: duration, track: 'camera', label: (shot.camera || '固定机位').trim() },
      { startSec: 0, endSec: duration, track: 'sound', label: (shot.soundIntent || '环境声与动作声').trim() },
    ],
  };
  useWorkshopStore.getState().updateShot(shot.shotNo, { actionTimeline: nextTimeline });
  return true;
}

const setPromptsTool: Tool = {
  definition: {
    name: 'workshop_set_prompts',
    description: `写入镜头图片/音频提示词，或调用统一 MiniMax H3 skill 为镜头首次生成、优化、重写视频提示词。
视频请传 items: [{shotNo, rewriteVideo: true}]，不必先写草稿，也不必重复读取历史任务。兼容旧调用 videoPrompt：只作为重写请求，工具不会直接保存该草稿，而是从已保存镜头事实、原文对白、实际参考与当前 H3 输入模式生成英文 H3 提示词（对白保持原语言）。历史调用若误用 prompt/text 字段，也按视频重写请求兼容处理，不把它当作可直接保存的通用字段。与生成页“AI重写本镜”使用同一服务，写入 universalVideoPrompt 并设置单镜 H3 模型，不生成媒体，不修改剧情。批量逐镜保存，失败会列明，不重试已成功镜头。
imagePrompt 仍为中文静态画面提示词，使用真实图片引用，禁止新增剧情、对白和人物关系。可独立写 imagePrompt、startFramePrompt、endFramePrompt、audioPrompts；expectedRefSignature 可用于检测引用变更。`,
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              shotNo: { type: 'string' },
              imagePrompt: { type: 'string' },
              videoPrompt: { type: 'string', description: '兼容旧入口：触发 H3 skill 重写，不直接保存草稿。' },
              rewriteVideo: { type: 'boolean', description: '首次生成、优化、重写视频提示词均设为 true。' },
              startFramePrompt: { type: 'string', description: '本镜 0.0 秒首帧画面提示词；只描述当前开场状态，并在有上一镜尾帧时继承其可见资产、人物、位置、道具、光线和摄影机状态；不得包含完整动作时间轴或本镜结束状态。' },
              endFramePrompt: { type: 'string', description: '本镜结束时刻尾帧画面提示词；基于完整因果时间线、exitState 和 H3 integrated_multimodal_description 结尾状态。' },
              audioPrompts: {
                type: 'array',
                description: '按 characterId 增量合并；连续调用不会清空其他角色。',
                items: {
                  type: 'object',
                  properties: {
                    characterId: { type: 'string' },
                    prompt: { type: 'string' },
                  },
                  required: ['characterId', 'prompt'],
                },
              },
              replaceAudioPrompts: {
                type: 'boolean',
                description: '仅在明确需要整组替换或清空配音提示词时设为 true，默认 false。',
              },
              expectedRefSignature: {
                type: 'string',
                description: '从 workshop_get_shot_refs 或 workshop_get_state 读取的 referenceSignature。参考顺序变化后旧签名会被拒绝。',
              },
            },
            required: ['shotNo'],
          },
        },
      },
      required: ['items'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    let rawItems = params.items as unknown;
    if (typeof rawItems === 'string') {
      try { rawItems = JSON.parse(rawItems) as unknown; } catch { /* keep invalid */ }
    }
    if (!Array.isArray(rawItems)) {
      return { success: false, output: '', error: 'workshop_set_prompts 参数错误：items 必须是数组。请用 { items: [{ shotNo, imagePrompt, videoPrompt }] } 调用。' };
    }
    // Split each item by field ownership. The agent's full-field rewrite may
    // submit image/frame/audio prompts and videoPrompt together; the video
    // field must use the H3 skill route without swallowing the other fields.
    const normalizeNo = (raw: Record<string, unknown>) =>
      String(raw.shotNo ?? raw.shot_no ?? raw.shot ?? raw.id ?? '').trim();
    const rawByShot = new Map<string, Record<string, unknown>[]>();
    for (const raw of rawItems) {
      const item = raw as Record<string, unknown>;
      const no = normalizeNo(item);
      if (!no) continue;
      const bucket = rawByShot.get(no) ?? [];
      bucket.push(item);
      rawByShot.set(no, bucket);
    }
    const shotNos = [...rawByShot.keys()];
    const data = useWorkshopStore.getState().data!;
    for (const no of shotNos) {
      const shot = data.shots.find((candidate) => candidate.shotNo === no);
      if (!shot) return { success: false, output: '', error: `镜头 ${no} 不存在，未开始写入` };
      if (data.currentScriptRevisionId && shot.sourceScriptRevisionId !== data.currentScriptRevisionId) {
        return { success: false, output: '', error: `${no}: 当前剧本 revision 已变化，请先同步镜头事实` };
      }
      for (const item of rawByShot.get(no) ?? []) {
        const signature = item.expectedRefSignature ?? item.expected_ref_signature;
        if (signature && signature !== shotReferenceSignature(shot, data)) {
          return { success: false, output: '', error: `${no}: 参考资产已变化，请刷新引用后重写` };
        }
      }
    }
    const otherItems: Record<string, unknown>[] = [];
    const videoRequests: Array<{ no: string; item: Record<string, unknown> }> = [];
    for (const no of shotNos) {
      const nonVideo: Record<string, unknown> = { shotNo: no };
      for (const item of rawByShot.get(no) ?? []) {
        // Older callers used a generic `prompt`/`text` field for the
        // video rewrite request. It was never a writable WsShot field, so the
        // later normalizer filtered the item out and returned "没有可写入的提示词".
        // Treat those aliases as a request to run the H3 rewrite path; the
        // saved shot facts remain the source of truth and the alias content is
        // intentionally not written as a prompt draft.
        const hasLegacyVideoAlias = typeof item.prompt === 'string' || typeof item.text === 'string';
        const rewriteFlag = item.rewriteVideo ?? item.rewrite_video ?? item.rewrite ?? item.regenerateVideo ?? item.regenerate_video ?? item.video;
        const rewriteMode = item.action ?? item.mode ?? item.operation ?? item.op;
        const hasRewriteMode = typeof rewriteMode === 'string' && /^(?:rewrite|regenerate|optimize|refresh|重写|改写|优化)$/i.test(rewriteMode.trim());
        const hasVideoRequest = rewriteFlag === true
          || hasRewriteMode
          || typeof item.videoPrompt === 'string'
          || typeof item.video_prompt === 'string'
          || hasLegacyVideoAlias;
        if (hasVideoRequest) videoRequests.push({ no, item });
        for (const [key, value] of Object.entries(item)) {
          if (key === 'shotNo' || key === 'shot_no' || key === 'shot' || key === 'id'
            || key === 'videoPrompt' || key === 'video_prompt'
            || key === 'rewriteVideo' || key === 'rewrite_video' || key === 'rewrite'
            || key === 'regenerateVideo' || key === 'regenerate_video' || key === 'video'
            || key === 'action' || key === 'mode' || key === 'operation' || key === 'op'
            || key === 'prompt' || key === 'text') continue;
          if (value !== undefined) nonVideo[key] = value;
        }
      }
      if (hasNonVideoPromptPayload(nonVideo)) otherItems.push(nonVideo);
    }
    // Keep the legacy exported symbol used by callers that introspect this
    // tool's source contract; it now represents the per-item requests only.
    const isVideoRequest = videoRequests.length > 0;
    if (isVideoRequest) {
      const reports: string[] = [];
      if (otherItems.length) {
        const result = await setPromptsTool.execute({ items: otherItems });
        if (!result.success) return result;
        reports.push(result.output);
      }
      const completed: string[] = [];
      const failures: string[] = [];
      const pendingShotNos = [...new Set(videoRequests.map((request) => request.no))];
      // If all video requests in a shot are already satisfied by an explicit
      // legacy payload and no rewrite was requested, still route it through H3.
      for (const no of pendingShotNos) {
        if (useWorkshopStore.getState().data?.projectId !== data.projectId) {
          failures.push(`${no}及后续镜头：项目已切换，停止重写`);
          break;
        }
        try {
          await rewriteWorkshopShotVideo(data.projectId, no);
          completed.push(no);
        } catch (error) {
          failures.push(`${no}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      reports.push(`H3 视频提示词已保存 ${completed.length}/${pendingShotNos.length} 镜：${completed.join('、') || '无'}。未生成媒体。`);
      return {
        success: failures.length === 0,
        output: reports.join('\n'),
        ...(failures.length ? { error: `以下镜头未保存，请只处理失败镜头，不重试已成功镜头：\n${failures.join('\n')}` } : {}),
      };
    }
    const items = rawItems
      .map((raw) => {
        const it = raw as Record<string, unknown>;
        const shotNo = String(it.shotNo ?? it.shot_no ?? it.shot ?? it.id ?? '').trim();
        const rawAudio = it.audioPrompts ?? it.audio_prompts;
        return {
          shotNo,
          imagePrompt: typeof it.imagePrompt === 'string' ? it.imagePrompt : typeof it.image_prompt === 'string' ? it.image_prompt : undefined,
          videoPrompt: typeof it.videoPrompt === 'string' ? it.videoPrompt : typeof it.video_prompt === 'string' ? it.video_prompt : undefined,
          startFramePrompt: typeof it.startFramePrompt === 'string' ? it.startFramePrompt : typeof it.start_frame_prompt === 'string' ? it.start_frame_prompt : undefined,
          endFramePrompt: typeof it.endFramePrompt === 'string' ? it.endFramePrompt : typeof it.end_frame_prompt === 'string' ? it.end_frame_prompt : undefined,
          audioPrompts: Array.isArray(rawAudio) ? (rawAudio as { characterId: string; prompt: string }[]) : undefined,
          replaceAudioPrompts: it.replaceAudioPrompts === true || it.replace_audio_prompts === true,
          expectedRefSignature: typeof it.expectedRefSignature === 'string'
            ? it.expectedRefSignature
            : typeof it.expected_ref_signature === 'string'
              ? it.expected_ref_signature
              : undefined,
        };
      })
      .filter((it) => it.shotNo && (it.imagePrompt !== undefined || it.videoPrompt !== undefined || it.startFramePrompt !== undefined || it.endFramePrompt !== undefined || it.audioPrompts !== undefined));

    const warnings: string[] = [];
    const fatalErrors: string[] = [];
    const ws = useWorkshopStore.getState();
    const knownShotNos = new Set(ws.data!.shots.map((x) => x.shotNo));
    const warningByShot = new Set<string>();
    for (const it of items) {
      if (!knownShotNos.has(it.shotNo)) {
        warnings.push(`${it.shotNo}: 未找到对应分镜，已跳过`);
        continue;
      }
      let shot = ws.data!.shots.find((x) => x.shotNo === it.shotNo);
      if (!shot) continue;
      if (ws.data!.currentScriptRevisionId && shot.sourceScriptRevisionId !== ws.data!.currentScriptRevisionId) {
        fatalErrors.push(`${it.shotNo}: 当前剧本 revision 已变化，旧镜头禁止写提示词；请先重新拆解并绑定当前剧本版本`);
        continue;
      }
      const hasPromptPayload = it.imagePrompt !== undefined || it.videoPrompt !== undefined || it.startFramePrompt !== undefined || it.endFramePrompt !== undefined;
      if (hasPromptPayload && !shot.actionTimeline?.segments?.length) {
        ensureShotActionTimeline(shot);
        shot = useWorkshopStore.getState().data!.shots.find((x) => x.shotNo === it.shotNo)!;
      }
      const currentRefSignature = shotReferenceSignature(shot, ws.data!);
      if (it.expectedRefSignature && it.expectedRefSignature !== currentRefSignature) {
        fatalErrors.push(`${it.shotNo}: 参考资产已在读取后发生变化。请重新调用 workshop_get_shot_refs，并按当前签名 ${currentRefSignature} 的编号重写`);
        continue;
      }

      const normalizedImageForCheck = it.imagePrompt !== undefined ? normalizePromptRefs(it.shotNo, it.imagePrompt, 'image') : undefined;
      const normalizedVideoForCheck = it.videoPrompt !== undefined ? normalizePromptRefs(it.shotNo, it.videoPrompt, 'video') : undefined;
      const unsupportedDialogue = findUnsupportedPromptDialogue({
        videoPrompt: normalizedVideoForCheck,
        audioPrompts: it.audioPrompts,
        canonicalDialogue: shot.dialogue,
      });
      if (unsupportedDialogue.length > 0) {
        fatalErrors.push(`${it.shotNo}: 出现原分镜对白中不存在的台词 ${unsupportedDialogue.map((line) => `“${line}”`).join('、')}`);
      }
      const unsupportedRelationships = findUnsupportedRelationshipClaims({
        prompts: [
          normalizedImageForCheck,
          normalizedVideoForCheck,
          ...(it.audioPrompts ?? []).map((item) => item.prompt),
        ],
        canonicalFacts: [shot.sourceExcerpt, shot.description, shot.dialogue].filter(Boolean).join('\n'),
      });
      if (unsupportedRelationships.length > 0) {
        fatalErrors.push(`${it.shotNo}: 新增了剧本事实中不存在的人物关系：${unsupportedRelationships.join('、')}。电影级光影、运镜、材质和微表演可以丰富，但人物关系不能补写`);
      }
      const effectiveVideoModelForWarnings = shot.videoModel || ws.data!.videoModel || '';
      const isH3ForWarnings = isMiniMaxH3Model(effectiveVideoModelForWarnings);
      const directorWarnings = collectDirectorPromptWarnings(shot, normalizedImageForCheck, isH3ForWarnings ? undefined : normalizedVideoForCheck);
      if (directorWarnings.length > 0) {
        warnings.push(...directorWarnings);
        warningByShot.add(it.shotNo);
      }
      if (isH3ForWarnings && normalizedVideoForCheck) {
        const h3Warnings = validateMiniMaxH3VideoPrompt(
          normalizedVideoForCheck,
          shot.durationSec ?? 5,
          shot.dialogue,
          useWorkshopStore.getState().getH3InputMode(),
        );
        if (h3Warnings.length > 0) {
          warnings.push(...h3Warnings.map((warning) => `${it.shotNo}: ${warning}`));
          warningByShot.add(it.shotNo);
        }
      }
      const characterWarnings = collectUnlinkedCharacterWarnings(
        it.shotNo,
        shot,
        ws.data!,
        [normalizedImageForCheck, normalizedVideoForCheck],
      );
      if (characterWarnings.length > 0) {
        fatalErrors.push(...characterWarnings);
      }
      for (const audioPrompt of it.audioPrompts ?? []) {
        if (!ws.data!.characters.some((character) => character.id === audioPrompt.characterId)) {
          warnings.push(`${it.shotNo}: 配音提示词引用了不存在的角色 ID “${audioPrompt.characterId}”，数据会保留并显示，但生成配音前需要改成有效角色 ID。`);
        }
      }
      if (!normalizedVideoForCheck) continue;

      const effectiveVideoModel = shot.videoModel || ws.data!.videoModel || '';
      const h3Task = useWorkshopStore.getState().getH3InputMode();
      const isH3 = isMiniMaxH3Model(effectiveVideoModel);
      const h3WithoutAssetRefs = isH3 && h3Task !== 'ref2va';
      if (!h3WithoutAssetRefs) {
          const storyboardRefCount = countStoryboardBoardRefs(shot);
        if (storyboardRefCount > 0 && !isH3) {
          const firstSentence = firstPromptSentence(normalizedVideoForCheck);
          const missingStoryboardRefs = Array.from({ length: storyboardRefCount }, (_, i) => `@图片${numToCn(i + 1)}`)
            .filter((ref) => !firstSentence.includes(ref));
          if (missingStoryboardRefs.length > 0) {
            warnings.push(`${it.shotNo}: 本镜有 ${storyboardRefCount} 张高清分镜板，videoPrompt 第一句话必须把所有分镜板作为"本镜景别变化和画面参考"引用，缺少 ${missingStoryboardRefs.join('、')}`);
            warningByShot.add(it.shotNo);
          }
          if (!/分镜板|故事板|导演分镜|景别变化|画面参考|storyboard/i.test(firstSentence)) {
            warnings.push(`${it.shotNo}: 第一句话引用了高清分镜板时，必须明确写"本镜景别变化和画面参考"，不要把它当普通场景图处理，也不要暗示必须完全按每格逐镜切分`);
            warningByShot.add(it.shotNo);
          }
        }
      }
      const promptTemplate = shot.videoPromptTemplate || 'universal';
      const numberedShotCount = (normalizedVideoForCheck.match(/镜头\S+-\d+/g) || []).length;
      if (promptTemplate === 'legacy' && numberedShotCount > 1 && shot.shotPlanningMode !== 'single-timeline') {
        warnings.push(`${it.shotNo}: 经典版 videoPrompt 写了 ${numberedShotCount} 个编号镜头；每条 WsShot 只能写一个“镜头N-1”，其余动作必须拆成新的分镜`);
        warningByShot.add(it.shotNo);
      }

      // Asset readiness: check referenced assets have images
      if (shot.sceneId) {
        const scene = ws.data!.scenes.find((s) => s.id === shot.sceneId);
        const sceneRefs = getSceneReferencePaths(shot, ws.data!.scenes);
        if (scene && sceneRefs.length === 0) {
          warnings.push(`${it.shotNo}: 场景"${scene.name}"还没有可用参考图，生成视频时场景 @图片 引用将缺失`);
          warningByShot.add(it.shotNo);
        }
      }
      for (const cid of (shot.characterIds ?? [])) {
        const char = ws.data!.characters.find((c) => c.id === cid);
        if (char && !char.assetImagePath) {
          warnings.push(`${it.shotNo}: 角色"${char.name}"还没有资产图，生成视频时参考图将缺失`);
          warningByShot.add(it.shotNo);
        }
      }
    }

    if (fatalErrors.length > 0) {
      return {
        success: false,
        output: '',
        error: [
          '事实锁拒绝写入：电影级导演表达可以丰富，但不得补写剧本中没有的对白、人物或人物关系。',
          ...fatalErrors.slice(0, 20),
          '如果用户明确要求改剧本，请先更新分镜事实；否则删除新增事实后重试。',
        ].join('\n'),
      };
    }

    let n = 0;
    let skipped = 0;
    for (const it of items) {
      const s = useWorkshopStore.getState();
      if (!s.data!.shots.some((x) => x.shotNo === it.shotNo)) {
        skipped++;
        continue;
      }
      const patch: Partial<WsShot> = {};
      if (it.imagePrompt !== undefined) patch.imagePrompt = normalizePromptRefs(it.shotNo, it.imagePrompt, 'image');
      if (it.videoPrompt !== undefined) {
        const currentShot = s.data!.shots.find((shot) => shot.shotNo === it.shotNo)!;
        const template = currentShot.videoPromptTemplate || s.data!.videoPromptTemplate || 'legacy';
        const h3Prompt = isMiniMaxH3Model(currentShot.videoModel || s.data!.videoModel || '');
        const normalized = normalizePromptRefs(it.shotNo, it.videoPrompt, 'video');
        if (h3Prompt || template === 'universal') patch.universalVideoPrompt = normalized;
        else patch.videoPrompt = normalized;
      }
      if (it.startFramePrompt !== undefined) patch.plannedStartFramePrompt = it.startFramePrompt.trim();
      if (it.endFramePrompt !== undefined) patch.plannedEndFramePrompt = it.endFramePrompt.trim();
      if (it.audioPrompts !== undefined) {
        const currentShot = s.data!.shots.find((shot) => shot.shotNo === it.shotNo)!;
        patch.audioPrompts = it.replaceAudioPrompts
          ? mergeAudioPrompts([], it.audioPrompts)
          : mergeAudioPrompts(currentShot.audioPrompts, it.audioPrompts);
      }
      if (it.imagePrompt !== undefined || it.videoPrompt !== undefined || it.startFramePrompt !== undefined || it.endFramePrompt !== undefined) {
        // The prompt was written against the current reference signature.
        // H3/Seedance checks collected above are warnings, not stale-asset
        // evidence, so do not turn them into a production-audit blocker.
        patch.promptNeedsRefresh = false;
      }
      if (Object.keys(patch).length > 0) {
        s.updateShot(it.shotNo, patch);
        n++;
      }
    }
    const s = useWorkshopStore.getState();
    s.markStepStatus('prompts', 'in-progress');
    s.logChange('prompts', `写入提示词 ${n} 条${warnings.length ? `，检查警告 ${warnings.length} 条` : ''}`);
    await s.commitNow();
    if (n === 0) {
      const received = rawItems.slice(0, 3).map((raw) => {
        const keys = Object.keys(raw as Record<string, unknown>).filter((key) => key !== 'expectedRefSignature' && key !== 'expected_ref_signature');
        return keys.length ? keys.join('/') : '(空对象)';
      }).join('；');
      return { success: false, output: '', error: `没有可写入的提示词。${skipped ? `跳过 ${skipped} 条未知分镜。` : `收到的 items 字段：${received || '(空)'}。图片/首尾帧请传 imagePrompt/startFramePrompt/endFramePrompt；重写视频请传 shotNo + rewriteVideo:true（或 videoPrompt 作为重写请求）。`}` };
    }
    return {
      success: true,
      output: [
        `已写入 ${n}/${items.length} 条提示词${skipped ? `，跳过 ${skipped} 条` : ''}`,
        warnings.length ? `\n检查警告（提示词已经写入，本轮到此结束，不自动再次调用工具）：\n${warnings.slice(0, 20).join('\n')}${warnings.length > 20 ? `\n…还有 ${warnings.length - 20} 条` : ''}` : '',
      ].join(''),
    };
  },
};

const setStoryboardPromptsTool: Tool = {
  definition: {
    name: 'workshop_set_storyboard_prompts',
    description: `为单条分镜写入高清故事板提示词。用于"高清故事板"工作流：AI 先理解剧情、人物关系、情绪转折、当前工坊风格和 bibles，再把一条分镜创作成默认 8 张、也可按用户要求扩展为 12/16/更多张的独立电影分镜图提示词。每张都必须独立可生图，强调人物脸部一致性、电影级构图、光线、表演瞬间和空间锚点。不要写拼图提示词；拼合由工具完成。

写作要求：
- 默认写 8 条，每条是一张单独剧照，不是连续视频提示词，也不是固定模板机械套用。
- 必须继承 workshop_get_state 中的 bibles、当前风格/色卡和该镜剧情目的；如果用户选择了风格库，要把风格库的视觉基因落实到构图、色彩、光线、材质和镜头语言里。
- 每条必须使用 workshop_get_state 返回的 storyboardReferenceOrder 里的 @图片N 资产引用；这是高清故事板专用顺序，场景从 @图片一 开始，不要套用普通视频生成的 referenceOrder。
- 若状态中 directorConstraintCard 存在，可按剧情需要为指定 frame 传 use_director_constraint_card:true；不要默认全开。启用后该卡会追加到本格参考图末尾，提示词必须明确出现 @导演约束卡（工具会补齐对应 @图片N）。
- 每条都必须显式引用所有场景参考图，尤其不能漏 @图片一；人物出镜时人物名后紧跟 @图片N。
- 这是静态图片提示词，不是 Seedance 视频提示词。禁止写台词、对白、字幕、旁白、音效、环境音、音乐、BGM；禁止使用 {}、<>、（）来标注声音或台词。
- 每条必须强调"严格复刻参考图人物脸、发型、服装、五官比例"，但不要写成空泛口号。
- 每张应根据剧情重新设计叙事功能，可覆盖建立空间、人物关系、动作预备、关键表演、手部/道具细节、反应特写、环境反馈、尾帧构图，但顺序和内容必须服务本镜，不要死板照抄。
- 语言要像导演给摄影/美术/演员的执行说明，避免"电影感十足/氛围拉满"这类空词。`,
    parameters: {
      type: 'object',
      properties: {
        shot_no: { type: 'string', description: '分镜编号' },
        force: { type: 'boolean', description: '已有生成图时确认整组覆盖（会丢弃已生成图与候选集），默认 false 拒绝' },
        frames: {
          type: 'array',
          description: '故事板生图提示词。首次默认 8 条；用户追加分镜后可按当前格子数量写入。',
          items: {
            type: 'object',
            properties: {
              prompt: { type: 'string' },
              selected: { type: 'boolean' },
              use_director_constraint_card: { type: 'boolean', description: '可选。仅当本镜已有导演约束卡且本格需要锁定站位/视线/机位/动作关系时设 true。' },
            },
            required: ['prompt'],
          },
        },
      },
      required: ['shot_no', 'frames'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const ws = useWorkshopStore.getState();
    const shotNo = String(params.shot_no ?? '').trim();
    const shot = ws.data!.shots.find((s) => s.shotNo === shotNo);
    if (!shot) return { success: false, output: '', error: `分镜 ${shotNo} 不存在` };
    const rawFrames = params.frames as unknown;
    if (!Array.isArray(rawFrames)) {
      return { success: false, output: '', error: 'frames 必须是数组，每项包含 prompt' };
    }
    // 在途/已产出保护：整组覆盖会换掉全部 frame id——正在生成的任务完成后
    // 找不到格子回填（已付费产物成孤儿），已生成的图和候选集也全部丢失。
    const existingFrames = shot.storyboardFrames ?? [];
    const generatingCount = existingFrames.filter((f) => f.status === 'generating').length;
    if (generatingCount > 0) {
      return { success: false, output: '', error: `分镜 ${shotNo} 有 ${generatingCount} 张故事板正在生成中，整组覆盖会让生成结果无处回填。请等生成完成，或改用 workshop_update_storyboard_frame_prompts 只改指定格子。` };
    }
    const doneCount = existingFrames.filter((f) => f.imagePath).length;
    if (doneCount > 0 && params.force !== true) {
      return { success: false, output: '', error: `分镜 ${shotNo} 已有 ${doneCount} 张生成图，整组覆盖会丢弃它们和全部候选。局部修改请用 workshop_update_storyboard_frame_prompts；确认全部重来则传 force:true。` };
    }
    const storyboardRefs = buildShotStoryboardRefs(shot, ws.data!);
    const sceneLabels = storyboardRefs.refs
      .filter((ref) => ref.kind === 'scene')
      .map((ref) => `@图片${numToCn(ref.index)}`);
    const repairs: string[] = [];
    const frames = rawFrames
      .map((raw, i) => {
        const item = raw as Record<string, unknown>;
        let prompt = sanitizeStoryboardImagePrompt(normalizePromptRefs(shotNo, String(item.prompt ?? '').trim(), 'image'));
        if (!prompt) return null;
        const missingSceneLabels = sceneLabels.filter((label) => !prompt.includes(label));
        if (missingSceneLabels.length > 0) {
          prompt = `${missingSceneLabels.join('、')} 场景参考，${prompt}`;
          repairs.push(`第 ${i + 1} 张补入 ${missingSceneLabels.join('、')}`);
        }
        const useDirectorConstraintCard = item.use_director_constraint_card === true && Boolean(shot.directorConstraintCard?.imagePath);
        const draft = {
          id: `story-${Date.now()}-${i + 1}-${Math.random().toString(36).slice(2, 8)}`,
          prompt,
          useDirectorConstraintCard,
          selected: item.selected !== false,
          status: 'idle' as const,
        };
        const compacted = compactStoryboardFrameReferences(shot, draft, ws.data!);
        const bindings = compacted.bindings;
        const cardRef = bindings.find((ref) => ref.kind === 'directorConstraintCard');
        return {
          ...draft,
          prompt: cardRef
            ? ensureDirectorConstraintMention(compacted.prompt, cardRef.index)
            : stripDirectorConstraintMention(compacted.prompt),
          refImagePaths: bindings.map((ref) => ref.path),
        };
      })
      .filter(Boolean) as NonNullable<WsShot['storyboardFrames']>;
    if (frames.length === 0) return { success: false, output: '', error: '没有可写入的故事板提示词' };
    ws.updateShot(shotNo, { storyboardFrames: frames });
    ws.logChange('prompts', `写入 ${shotNo} 高清故事板提示词 ${frames.length} 条`);
    await ws.commitNow();
    const hint = frames.length < 8 ? `，默认建议补足到 8 张` : '';
    const repairText = repairs.length ? `\n已自动补齐漏写的场景引用：${repairs.join('；')}` : '';
    return { success: true, output: `已写入分镜 ${shotNo} 的高清故事板提示词 ${frames.length} 条${hint}${repairText}` };
  },
};

const updateStoryboardFramePromptsTool: Tool = {
  definition: {
    name: 'workshop_update_storyboard_frame_prompts',
    description: `只修改单条分镜中指定几张高清故事板提示词，保留其它格子的 prompt、已生成图片、选中状态和生成状态。

适用场景：用户说"把第3张改成低机位特写""只改第5张光线""第2和第6张更有压迫感"，或用户追加了 4 张空分镜后要求补写第 9-12 张。不要为了局部修改调用 workshop_set_storyboard_prompts 覆盖全部故事板。`,
    parameters: {
      type: 'object',
      properties: {
        shot_no: { type: 'string', description: '分镜编号' },
        updates: {
          type: 'array',
          description: '要局部修改的故事板格子。index 从 1 开始，对应 UI 里的第几张。',
          items: {
            type: 'object',
            properties: {
              index: { type: 'number', description: '第几张故事板，从 1 开始，可超过 8，对应 UI 里的当前格子序号。' },
              prompt: { type: 'string', description: '修改后的完整静态生图提示词。只用于高清故事板图片，禁止写台词、对白、字幕、旁白、音效、环境音、音乐、BGM；禁止使用 {}、<>、（）标注声音或台词。' },
              use_director_constraint_card: { type: 'boolean', description: '可选。设置本格是否使用导演约束卡；不传则保持现状。启用后 prompt 会自动写入 @导演约束卡。' },
            },
            required: ['index', 'prompt'],
          },
        },
      },
      required: ['shot_no', 'updates'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const ws = useWorkshopStore.getState();
    const shotNo = String(params.shot_no ?? '').trim();
    const shot = ws.data!.shots.find((s) => s.shotNo === shotNo);
    if (!shot) return { success: false, output: '', error: `分镜 ${shotNo} 不存在` };
    const frames = shot.storyboardFrames ?? [];
    if (frames.length === 0) return { success: false, output: '', error: `分镜 ${shotNo} 还没有故事板提示词，请先创建默认 8 张提示词，或在 UI 中新增空分镜后再写入` };
    const updates = params.updates as unknown;
    if (!Array.isArray(updates) || updates.length === 0) {
      return { success: false, output: '', error: 'updates 必须是非空数组' };
    }

    const storyboardRefs = buildShotStoryboardRefs(shot, ws.data!);
    const sceneLabels = storyboardRefs.refs
      .filter((ref) => ref.kind === 'scene')
      .map((ref) => `@图片${numToCn(ref.index)}`);
    const updateByIndex = new Map<number, { prompt: string; useDirectorConstraintCard?: boolean }>();
    const repairs: string[] = [];
    for (const raw of updates) {
      const item = raw as Record<string, unknown>;
      const index = Number(item.index);
      if (!Number.isFinite(index) || index < 1 || index > frames.length) {
        return { success: false, output: '', error: `故事板 index ${item.index} 超出范围，当前共有 ${frames.length} 张` };
      }
      let prompt = sanitizeStoryboardImagePrompt(normalizePromptRefs(shotNo, String(item.prompt ?? '').trim(), 'image'));
      if (!prompt) return { success: false, output: '', error: `第 ${index} 张 prompt 为空` };
      const missingSceneLabels = sceneLabels.filter((label) => !prompt.includes(label));
      if (missingSceneLabels.length > 0) {
        prompt = `${missingSceneLabels.join('、')} 场景参考，${prompt}`;
        repairs.push(`第 ${index} 张补入 ${missingSceneLabels.join('、')}`);
      }
      updateByIndex.set(index, {
        prompt,
        useDirectorConstraintCard: typeof item.use_director_constraint_card === 'boolean'
          ? item.use_director_constraint_card
          : undefined,
      });
    }

    const nextFrames = frames.map((frame, idx) => {
      const update = updateByIndex.get(idx + 1);
      if (!update) return frame;
      const useDirectorConstraintCard = update.useDirectorConstraintCard ?? frame.useDirectorConstraintCard ?? false;
      if (useDirectorConstraintCard && !shot.directorConstraintCard?.imagePath) return frame;
      const draft = { ...frame, prompt: update.prompt, useDirectorConstraintCard };
      const compacted = compactStoryboardFrameReferences(shot, draft, ws.data!);
      const bindings = compacted.bindings;
      const cardRef = bindings.find((ref) => ref.kind === 'directorConstraintCard');
      return {
        ...draft,
        prompt: cardRef
          ? ensureDirectorConstraintMention(compacted.prompt, cardRef.index)
          : stripDirectorConstraintMention(compacted.prompt),
        refImagePaths: bindings.map((ref) => ref.path),
        revision: (frame.revision ?? 0) + 1,
      };
    });
    ws.updateShot(shotNo, { storyboardFrames: nextFrames });
    ws.logChange('prompts', `局部修改 ${shotNo} 高清故事板提示词：${[...updateByIndex.keys()].map((i) => `第${i}张`).join('、')}`);
    await ws.commitNow();
    const repairText = repairs.length ? `\n已自动补齐漏写的场景引用：${repairs.join('；')}` : '';
    return { success: true, output: `已局部修改分镜 ${shotNo}：${[...updateByIndex.keys()].map((i) => `第 ${i} 张`).join('、')}${repairText}` };
  },
};

const setDirectorConstraintCardTool: Tool = {
  definition: {
    name: 'workshop_set_director_constraint_card',
    description: '为某一镜设置、替换或删除可选的导演约束卡。卡片用于锁定人物站位、视线、机位和动作关系，不会自动应用到故事板格或视频。设置后再用 workshop_set_director_constraint_usage 精确启用。',
    parameters: {
      type: 'object',
      properties: {
        shot_no: { type: 'string', description: '分镜编号' },
        image_path: { type: 'string', description: '导演约束卡本地图片路径。remove=true 时可省略。' },
        prompt: { type: 'string', description: '可选，卡片的空间/动作约束说明。' },
        source: { type: 'string', enum: ['generate', 'upload', 'artifact', 'canvas', 'external'], description: '来源，默认 external。' },
        remove: { type: 'boolean', description: '删除约束卡并关闭所有格和视频引用。' },
      },
      required: ['shot_no'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const ws = useWorkshopStore.getState();
    const shotNo = String(params.shot_no ?? '').trim();
    const shot = ws.data!.shots.find((item) => item.shotNo === shotNo);
    if (!shot) return { success: false, output: '', error: `分镜 ${shotNo} 不存在` };
    const remove = params.remove === true;
    const imagePath = String(params.image_path ?? '').trim();
    if (!remove && !imagePath) return { success: false, output: '', error: 'image_path 不能为空' };

    const nextFrames = remove
      ? (shot.storyboardFrames ?? []).map((frame) => ({
          ...frame,
          useDirectorConstraintCard: false,
          prompt: stripDirectorConstraintMention(frame.prompt),
          refImagePaths: frame.refImagePaths?.filter((path) => path !== shot.directorConstraintCard?.imagePath),
          revision: (frame.revision ?? 0) + 1,
        }))
      : shot.storyboardFrames;
    const nextCard = remove
      ? undefined
      : {
          id: shot.directorConstraintCard?.id ?? `director-card-${shotNo}-${Date.now()}`,
          imagePath,
          prompt: String(params.prompt ?? '').trim() || shot.directorConstraintCard?.prompt,
          createdAt: shot.directorConstraintCard?.createdAt ?? Date.now(),
          source: (params.source as 'generate' | 'upload' | 'artifact' | 'canvas' | 'external' | undefined) ?? 'external',
          useInVideo: shot.directorConstraintCard?.useInVideo ?? false,
          candidates: [
            ...(shot.directorConstraintCard?.candidates ?? []),
            {
              path: imagePath,
              source: ((params.source === 'artifact' || params.source === 'canvas' || params.source === 'generate' || params.source === 'upload')
                ? params.source
                : 'external') as AssetCandidate['source'],
              prompt: String(params.prompt ?? '').trim() || undefined,
              createdAt: Date.now(),
            },
          ],
        };
    const nextShot = { ...shot, directorConstraintCard: nextCard, storyboardFrames: nextFrames };
    const remapped = remapShotPromptRefs(shot, nextShot, ws.data!);
    ws.updateShot(shotNo, {
      ...remapped,
      directorConstraintCard: nextCard,
      storyboardFrames: nextFrames,
      videoPrompt: applyVideoPlanningReferencePrefixes(nextShot, remapped.videoPrompt ?? shot.videoPrompt),
    });
    ws.logChange('prompts', remove ? `删除 ${shotNo} 导演约束卡` : `设置 ${shotNo} 导演约束卡`);
    await ws.commitNow();
    return { success: true, output: remove ? `已删除 ${shotNo} 的导演约束卡，并关闭所有引用` : `已设置 ${shotNo} 的导演约束卡；当前未自动应用，请按需要启用具体格子或视频` };
  },
};

const updateDirectorConstraintPromptTool: Tool = {
  definition: {
    name: 'workshop_update_director_constraint_prompt',
    description: '只修改某一镜现有导演约束卡的提示词，不替换图片、不新增候选图，也不改变故事板格和视频的启用范围。',
    parameters: {
      type: 'object',
      properties: {
        shot_no: { type: 'string', description: '分镜编号' },
        prompt: { type: 'string', description: '完整的导演约束卡提示词。应描述素模站位、视线、机位、动线和动作关系；不得要求复刻具体人物外观。' },
      },
      required: ['shot_no', 'prompt'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const ws = useWorkshopStore.getState();
    const shotNo = String(params.shot_no ?? '').trim();
    const prompt = String(params.prompt ?? '').trim();
    const shot = ws.data!.shots.find((item) => item.shotNo === shotNo);
    if (!shot) return { success: false, output: '', error: `分镜 ${shotNo} 不存在` };
    if (!shot.directorConstraintCard?.imagePath) {
      return { success: false, output: '', error: `分镜 ${shotNo} 还没有导演约束卡` };
    }
    if (!prompt) return { success: false, output: '', error: 'prompt 不能为空' };

    ws.updateShot(shotNo, {
      directorConstraintCard: {
        ...shot.directorConstraintCard,
        prompt,
      },
    });
    ws.logChange('prompts', `修改 ${shotNo} 导演约束卡提示词`);
    await ws.commitNow();
    return { success: true, output: `已更新 ${shotNo} 的导演约束卡提示词；图片和应用范围保持不变` };
  },
};

const setDirectorConstraintUsageTool: Tool = {
  definition: {
    name: 'workshop_set_director_constraint_usage',
    description: '精确控制导演约束卡的使用范围。可对全部故事板格、指定格子（从 1 开始）和视频独立开关；启用格子的 prompt 会自动写入 @导演约束卡 及对应 @图片N。',
    parameters: {
      type: 'object',
      properties: {
        shot_no: { type: 'string', description: '分镜编号' },
        enabled: { type: 'boolean', description: '故事板格启用或关闭状态。' },
        all_frames: { type: 'boolean', description: 'true 时作用于本镜所有故事板格。' },
        frame_indices: { type: 'array', items: { type: 'number' }, description: '指定故事板格序号，从 1 开始。与 all_frames 二选一；只改视频时可省略。' },
        use_in_video: { type: 'boolean', description: '可选，独立设置是否传入视频生成。' },
      },
      required: ['shot_no'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const ws = useWorkshopStore.getState();
    const shotNo = String(params.shot_no ?? '').trim();
    const shot = ws.data!.shots.find((item) => item.shotNo === shotNo);
    if (!shot) return { success: false, output: '', error: `分镜 ${shotNo} 不存在` };
    if (!shot.directorConstraintCard?.imagePath) return { success: false, output: '', error: `分镜 ${shotNo} 还没有导演约束卡` };

    const requested = Array.isArray(params.frame_indices)
      ? new Set(params.frame_indices.map(Number).filter((index) => Number.isInteger(index) && index >= 1))
      : new Set<number>();
    const touchesFrames = params.all_frames === true || requested.size > 0;
    if (!touchesFrames && typeof params.use_in_video !== 'boolean') {
      return { success: false, output: '', error: '请指定 all_frames、frame_indices 或 use_in_video' };
    }
    const enabled = params.enabled !== false;
    const frames = (shot.storyboardFrames ?? []).map((frame, index) => {
      if (!touchesFrames || (params.all_frames !== true && !requested.has(index + 1))) return frame;
      const draft = { ...frame, useDirectorConstraintCard: enabled };
      const bindings = buildStoryboardFrameRefBindings(shot, draft, ws.data!);
      const cardRef = bindings.find((ref) => ref.kind === 'directorConstraintCard');
      return {
        ...draft,
        prompt: cardRef
          ? ensureDirectorConstraintMention(frame.prompt, cardRef.index)
          : stripDirectorConstraintMention(frame.prompt),
        refImagePaths: bindings.map((ref) => ref.path),
        revision: (frame.revision ?? 0) + 1,
      };
    });
    const directorConstraintCard = typeof params.use_in_video === 'boolean'
      ? { ...shot.directorConstraintCard, useInVideo: params.use_in_video }
      : shot.directorConstraintCard;
    const nextShot = { ...shot, storyboardFrames: frames, directorConstraintCard };
    const remapped = remapShotPromptRefs(shot, nextShot, ws.data!);
    ws.updateShot(shotNo, {
      ...remapped,
      storyboardFrames: frames,
      directorConstraintCard,
      videoPrompt: applyVideoPlanningReferencePrefixes(nextShot, remapped.videoPrompt ?? shot.videoPrompt),
    });
    ws.logChange('prompts', `更新 ${shotNo} 导演约束卡应用范围`);
    await ws.commitNow();
    const applied = frames.flatMap((frame, index) => frame.useDirectorConstraintCard === true ? [index + 1] : []);
    return {
      success: true,
      output: `已更新 ${shotNo}：故事板启用格 ${applied.length ? applied.join('、') : '无'}；视频${directorConstraintCard.useInVideo === true ? '已启用' : '未启用'}导演约束卡`,
    };
  },
};

const setAssetPromptTool: Tool = {
  definition: {
    name: 'workshop_set_asset_prompt',
    description: '设置角色/场景/道具/色卡资产图的生图提示词。GPT（prompt）和 MJ（mjPrompt）应同时写入两条提示词，用户切引擎即用对应的版本。角色GPT=中文三视图组合图格式（左侧正脸大图+右侧三视图并排），角色MJ=英文 character design sheet 短语式。场景=无人物概念图。色卡=16:9 扁平数字色卡参考设计图。统一画风关键词。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['character', 'scene', 'prop', 'colorPalette'] },
        id: { type: 'string' },
        prompt: { type: 'string', description: 'GPT 中文提示词（角色必须用三视图组合图格式）' },
        mjPrompt: { type: 'string', description: 'Midjourney 专用英文提示词（逗号短语式，不含 --ar 等后缀）' },
      },
      required: ['kind', 'id', 'prompt'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const ws = useWorkshopStore.getState();
    const kind = params.kind as WorkshopAssetKind;
    const id = String(params.id ?? '');
    // 必须先确认资产存在。store 层的 `setAssetPrompt` 用
    // `map(item => item.id === id ? 更新 : 原样)` 落库，**id 不命中时是静默 no-op**；
    // 若不在这里拦住，模型会拿到「提示词已设置」的成功回执，而实际什么都没写。
    // 静默失败会让 agent loop 失去唯一的纠错信号：资产提示词会以「全绿」的姿态
    // 缺失，直到生成阶段才暴露，代价是重跑（且已扣费）。
    const data = ws.data!;
    const exists = kind === 'character'
      ? data.characters.some((c) => c.id === id)
      : kind === 'scene'
        ? data.scenes.some((s) => s.id === id)
        : kind === 'colorPalette'
          ? (data.colorPalettes ?? []).some((p) => p.id === id)
          : (data.props ?? []).some((p) => p.id === id);
    if (!exists) {
      return {
        success: false,
        output: '',
        error: `未找到资产：${kind} ${id}。请先用 workshop_get_state 读取当前项目的真实资产 id，不要凭记忆或推测填写。`,
      };
    }
    if (params.prompt) {
      ws.setAssetPrompt(kind, id, params.prompt as string, 'gpt');
    }
    if (params.mjPrompt) {
      ws.setAssetPrompt(kind, id, params.mjPrompt as string, 'mj');
    }
    await useWorkshopStore.getState().commitNow();
    // 两个版本都要写：用户切引擎即用对应版本，缺 MJ 版会让 Midjourney 通道拿不到提示词。
    // 这里不直接失败（schema 里 mjPrompt 非必填），但必须让模型看见这条缺口。
    const missingMj = params.mjPrompt ? '' : '；⚠ 未提供 mjPrompt，Midjourney 通道将没有可用提示词，请补写英文版';
    return { success: true, output: `${params.kind} ${params.id} 提示词已设置${params.mjPrompt ? '（含 MJ 英文版）' : ''}${missingMj}` };
  },
};

const generateTool: Tool = {
  definition: {
    name: 'workshop_generate',
    description: '触发工坊生成（花钱操作）。kind=asset 生成角色/场景资产图；kind=image/video 生成分镜图/分镜视频；kind=boundary 显式生成 H3 首尾帧图片，不提交视频（同样为付费操作），复用已有首尾帧。H3 fl2va 视频提交前必须先生成首尾帧。targets="missing" 只补缺失项；targets="all" 全量生成；targets="01-01,01-02,01-03" 逗号分隔多镜号一次提交（并行生成，最多 6 个同时跑）。force=true 时忽略已有图强制重新生成。allow_missing_refs=true 时允许 Seedance 提示词缺少 @图片 引用仍继续生成，默认 false。Seedance 视频默认通过筷子丽帧（Kuaizi）API 通道生成，后端自动路由，无需额外处理。⚠ 音色/音频资产只来自本镜 voiceCharacterIds 或已注入 generatedAudios，不会因为角色库有 voicePath 自动传入；需要移除时用 workshop_clear_shot_audio。⚠ 生成视频前必须确保每条分镜都已设置 videoRatio（通过 workshop_update_shot 设置），未设置比例的分镜会生成失败。⚠ 当要生成多个分镜视频时（≥2 个），先用 ask_user_question 问用户："检测到 N 个分镜待生成视频，是否并行一起生成（更快，最多 6 个同时跑）？"选项：并行生成（推荐）/ 逐个确认。用户选并行后，把所有镜号合并成一次调用（targets="01-01,01-02,..."）一次性提交，不要逐个调用。⚠ 生成是后台异步任务，工具返回后请直接告知用户"已排队，可在任务面板查看进度"然后停止——不要用 workshop_get_state 轮询进度，不要等待完成。用户看到结果后会主动来找你。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['asset', 'image', 'video', 'boundary'] },
        targets: {
          type: 'string',
          description: '"all" | "missing"，或逗号分隔的镜号列表如 "01-01,01-02"（kind=image/video 时）',
        },
        frame_role: {type: 'string', enum: ['both', 'start', 'end'], description: '仅 kind=boundary 有效。默认 both；end 只编辑现有首帧生成尾帧，不重做首帧。'},
        asset_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'kind=asset 时要生成的角色/场景 id；省略=全部缺图资产',
        },
        force: { type: 'boolean', description: '强制重新生成，即使已有图/视频也重新生成' },
        allow_missing_refs: { type: 'boolean', description: '视频提示词缺少 @图片 引用时仍继续生成。默认 false；只有用户明确要求继续时使用。' },
      },
      required: ['kind'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const s = useWorkshopStore.getState();
    const adError = adMaterialsError(s.data?.creativeSpec);
    if (adError) return { success: false, output: '', error: adError, recoverable: true };
    let request: ReturnType<typeof generationRequest>;
    try { request = generationRequest(params.kind, !!params.allow_missing_refs, params.frame_role); }
    catch (error) { return {success: false, output: '', error: String(error)}; }
    const {kind, options} = request;
    const generateOptions = {...options, ...(params.kind === 'boundary' ? {forceBoundaryFrames: !!params.force} : {})};
    const boundaryOnly = params.kind === 'boundary';
    const force = !!params.force;
    const validateBoundaryTargets = (shots: WsShot[]) => boundaryOnly && shots.some(
      (shot) => !isMiniMaxH3Model(shot.videoModel || s.data!.videoModel || ''),
    );

    if (kind === 'asset') {
      const data = s.data!;
      const wanted = params.asset_ids as string[] | undefined;
      const targets: { kind: WorkshopAssetKind; id: string }[] = [];
      for (const c of data.characters) {
        if ((wanted ? wanted.includes(c.id) : (force || !c.assetImagePath))) targets.push({ kind: 'character', id: c.id });
      }
      for (const sc of data.scenes) {
        if ((wanted ? wanted.includes(sc.id) : (force || !sc.assetImagePath))) targets.push({ kind: 'scene', id: sc.id });
      }
      for (const p of (data.props ?? [])) {
        if ((wanted ? wanted.includes(p.id) : (force || !p.assetImagePath))) targets.push({ kind: 'prop', id: p.id });
      }
      const selectedPaletteIds = new Set([
        data.globalColorPaletteId,
        ...data.shots.map((shot) => shot.colorPaletteId),
      ].filter(Boolean) as string[]);
      for (const cp of (data.colorPalettes ?? [])) {
        if (wanted ? wanted.includes(cp.id) : (selectedPaletteIds.has(cp.id) && (force || !cp.assetImagePath))) {
          targets.push({ kind: 'colorPalette', id: cp.id });
        }
      }
      if (targets.length === 0) return { success: true, output: '没有需要生成的资产（都已有图）' };
      s.markStepStatus('assets', 'in-progress');
      void Promise.allSettled(targets.map((t) => s.generateAsset(t.kind, t.id)));
      return { success: true, output: `已排队 ${targets.length} 个资产图生成任务。进度在任务面板实时可见，生成完成后结果会自动显示在资产卡片上。请告知用户后结束本轮对话，不要轮询等待。` };
    }

    // 已在队列/生成中的分镜跳过（不重复触发），但允许向进行中的批次追加新分镜并行生成。
    // 并发上限由 canvasTaskStore 的 MAX_CONCURRENT_CANVAS_TASKS（6）控制，超出自动排队。
    const activeShotNos = new Set(s.data!.shots
      .filter((x) => x.genStatus === 'queued' || x.genStatus === 'generating')
      .map((x) => x.shotNo));

    const targetsRaw = (params.targets as string | undefined) ?? 'missing';
    if (targetsRaw !== 'all' && targetsRaw !== 'missing') {
      const nos = targetsRaw.split(',').map((x) => x.trim()).filter(Boolean)
        .filter((no) => !activeShotNos.has(no));
      if (nos.length === 0) return { success: true, output: '指定的分镜都已在生成中，已跳过。' };
      const selectedShots = nos.map((no) => s.data!.shots.find((shot) => shot.shotNo === no));
      const unknown = nos.filter((_, index) => !selectedShots[index]);
      if (unknown.length > 0) return { success: false, output: '', error: `以下分镜不存在：${unknown.join('、')}` };
      if (validateBoundaryTargets(selectedShots as WsShot[])) return {success:false, output:'', error:'首尾帧生成仅支持 H3 分镜，未提交任何任务。'};
      if (kind === 'video' && !boundaryOnly) {
        const failures = ref2vaPreflightFailures(selectedShots as WsShot[], s.data!);
        if (failures.length > 0) return { success: false, output: '', error: `视频提交前检查未通过：\n${failures.join('\n')}` };
      }
      if (kind === 'video' && !boundaryOnly) {
        const batch = enqueueVideoGeneration(videoGenerationTail, (selectedShots as WsShot[]).map((shot) =>
          () => s.generateShot(shot.shotNo, kind, generateOptions),
        ));
        videoGenerationTail = batch.promise;
        return { success: true, output: `已按分镜顺序排队 ${batch.count} 个视频生成任务（严格串行，不并行）。后一镜只有在前一镜完成并可提供连续性尾帧后才会提交；若前一镜需要人工采用，将在该处暂停。进度在分镜网格实时可见，请告知用户后结束本轮对话。${'外部视频请用 workshop_set_shot_media(shot_no, video_path) 导入为候选，再经 workshop_accept_video_candidate 评审采用。'}` };
      }
      void Promise.allSettled((selectedShots as WsShot[]).map((shot) => s.generateShot(shot.shotNo, kind, generateOptions)));
      return { success: true, output: `已排队 ${selectedShots.length} 个分镜生成任务。进度在分镜���格实时可见，请告知用户后结束本轮对话。` };
    }
    const onlyMissing = !force && targetsRaw !== 'all';
    const pendingShots = s.data!.shots.filter((x) => (onlyMissing ? needsGeneration(params.kind, x) : true) && !activeShotNos.has(x.shotNo));
    if (pendingShots.length === 0) return { success: true, output: '没有需要新生成的分镜（都已有产物或在生成中）。' };
    if (validateBoundaryTargets(pendingShots)) return {success:false, output:'', error:'首尾帧生成仅支持 H3 分镜，未提交任何任务。'};
    if (kind === 'video' && !boundaryOnly) {
      const failures = ref2vaPreflightFailures(pendingShots, s.data!);
      if (failures.length > 0) return { success: false, output: '', error: `视频提交前检查未通过：\n${failures.join('\n')}` };
    }
    const count = pendingShots.length;
    s.markStepStatus('generate', 'in-progress');
    if (kind === 'video' && !boundaryOnly) {
      const batch = enqueueVideoGeneration(videoGenerationTail, pendingShots.map((shot) =>
        () => s.generateShot(shot.shotNo, kind, generateOptions),
      ));
      videoGenerationTail = batch.promise;
      return { success: true, output: `已按分镜顺序排队 ${batch.count} 个视频生成任务（严格串行，不并行）��后一镜只有在前一镜完成并可提供连续性尾帧后才会提交；若前一镜需要人工采用，将在该处暂停。进度在分镜网格实时可见，请告知用户后结束本轮对话。${'外部视频请用 workshop_set_shot_media(shot_no, video_path) 导入为候选，再经 workshop_accept_video_candidate 评审采用。'}` };
    }
    void Promise.allSettled(pendingShots.map((x) => s.generateShot(x.shotNo, kind, generateOptions)));
    return { success: true, output: `已排队 ${count} 个分镜生成任务。进度在分镜网格实时可见，请告知用户后结束本轮对话。` };
  },
};

const acceptVideoCandidateTool: Tool = {
  definition: {
    name: 'workshop_accept_video_candidate',
    description: '评审并采用指定分镜的视频候选。必须先读取 workshop_get_state 获取候选 fingerprint；若候选已变化，工具会拒绝绑定，避免旧页面覆盖新结果。',
    parameters: {
      type: 'object',
      properties: {
        shot_no: { type: 'string', description: '分镜编号' },
        path: { type: 'string', description: '候选视频路径' },
        expected_fingerprint: { type: 'string', description: 'workshop_get_state 返回的候选 fingerprint' },
        note: { type: 'string', description: '可选评审备注' },
        criteria: {
          type: 'object',
          description: '可选的创意评审证据；不填写时兼容旧项目，但正式交付建议逐项记录。',
          properties: {
            continuity: { type: 'string', enum: ['pass', 'fail', 'not-reviewed'] },
            visualIdentity: { type: 'string', enum: ['pass', 'fail', 'not-reviewed'] },
            performance: { type: 'string', enum: ['pass', 'fail', 'not-reviewed'] },
            pacing: { type: 'string', enum: ['pass', 'fail', 'not-reviewed'] },
          },
          additionalProperties: false,
        },
      },
      required: ['shot_no', 'path', 'expected_fingerprint'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const ws = useWorkshopStore.getState();
    const shot = ws.data?.shots.find((item) => item.shotNo === params.shot_no);
    if (!shot) return { success: false, output: '', error: `未找到分镜 ${params.shot_no}` };
    try {
      const candidate = (shot.videoCandidates ?? []).find((item) => item.path === String(params.path));
      if (!candidate || !videoCandidateMatchesProductionInput(candidate, shot.lastProductionPacket?.inputFingerprint)) {
        return {
          success: false,
          output: '',
          error: '该视频候选缺少可验证的生产输入，或候选指纹与其冻结生产包不一致，已禁止采用。',
        };
      }
      const qualitySettings = useSettingsStore.getState();
      if (qualitySettings.qualityReviewEnabled) {
        const review = currentVideoQualityReview({
          reports: [shot.videoQualityReview, ...(shot.qualityReviewHistory ?? [])],
          candidatePath: candidate.path,
          candidateFingerprint: videoCandidateFingerprint(candidate),
          reviewerFingerprint: qualityReviewerFingerprint(
            qualitySettings.qualityReviewBaseUrl,
            qualitySettings.qualityReviewModel,
          ),
        });
        if (!review) {
          return {
            success: false,
            output: '',
            error: '该候选尚未通过当前审核服务与模型的多模态终审，已禁止采用。',
          };
        }
      }
      const accepted = acceptVideoCandidate({
        actor: 'dsh',
        candidates: shot.videoCandidates ?? [],
        path: String(params.path),
        expectedFingerprint: String(params.expected_fingerprint),
        note: typeof params.note === 'string' ? params.note : undefined,
        criteria: params.criteria && typeof params.criteria === 'object' ? params.criteria as {
          continuity?: 'pass' | 'fail' | 'not-reviewed';
          visualIdentity?: 'pass' | 'fail' | 'not-reviewed';
          performance?: 'pass' | 'fail' | 'not-reviewed';
          pacing?: 'pass' | 'fail' | 'not-reviewed';
        } : undefined,
      });
      ws.updateShot(shot.shotNo, {
        videoPath: accepted.binding.path,
        videoThumbPath: undefined,
        videoReviews: [...(shot.videoReviews ?? []), accepted.review],
        videoProductionBinding: accepted.binding,
        lastProductionPacket: candidate.productionPacket ?? shot.lastProductionPacket,
        genStatus: 'done',
        genError: undefined,
        genProgress: undefined,
      });
      await ws.commitNow();
      return { success: true, output: `分镜 ${shot.shotNo} 已采用视频候选并写入正式生产绑定：${accepted.binding.reviewFingerprint}` };
    } catch (error) {
      return { success: false, output: '', error: error instanceof Error ? error.message : String(error) };
    }
  },
};

const acceptAudioCandidateTool: Tool = {
  definition: {
    name: 'workshop_accept_audio_candidate',
    description: '评审并采用指定分镜的配音候选。必须先读取 workshop_get_state 获取 candidateId 和 fingerprint，候选变化后拒绝绑定。',
    parameters: {
      type: 'object',
      properties: {
        shot_no: { type: 'string', description: '分镜编号' },
        candidate_id: { type: 'string', description: '配音候选 ID' },
        expected_fingerprint: { type: 'string', description: '候选 fingerprint' },
        note: { type: 'string', description: '可选评审备注' },
      },
      required: ['shot_no', 'candidate_id', 'expected_fingerprint'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const ws = useWorkshopStore.getState();
    const shot = ws.data?.shots.find((item) => item.shotNo === params.shot_no);
    if (!shot) return { success: false, output: '', error: `未找到分镜 ${params.shot_no}` };
    try {
      const audioPromptErrors = validateAudioPromptsAgainstShot({
        dialogue: shot.dialogue,
        characterIds: shot.characterIds,
        audioPrompts: shot.audioPrompts,
      });
      if (audioPromptErrors.length > 0) {
        return { success: false, output: '', error: `配音候选采用已阻断：\n${audioPromptErrors.join('\n')}` };
      }
      const accepted = acceptAudioCandidate({
        candidates: shot.audioCandidates ?? [],
        candidateId: String(params.candidate_id),
        expectedFingerprint: String(params.expected_fingerprint),
        note: typeof params.note === 'string' ? params.note : undefined,
      });
      ws.updateShot(shot.shotNo, {
        generatedAudios: [
          ...(shot.generatedAudios ?? []).filter((item) => item.characterId !== accepted.audio.characterId),
          accepted.audio,
        ],
        audioReviews: [...(shot.audioReviews ?? []).filter((item) => item.candidateId !== accepted.review.candidateId), accepted.review],
        audioProductionBinding: accepted.binding,
        audioInjected: false,
      });
      await ws.commitNow();
      return { success: true, output: `分镜 ${shot.shotNo} 已采用配音候选并写入正式绑定：${accepted.binding.reviewFingerprint}` };
    } catch (error) {
      return { success: false, output: '', error: error instanceof Error ? error.message : String(error) };
    }
  },
};

const setAssetImageTool: Tool = {
  definition: {
    name: 'workshop_set_asset_image',
    description: '直接设置角色/场景/道具资产图路径（跳过生成流程）。当 AI 已通过其他方式获得图片（如 canvas_generate、降级链、用户上传等）时使用。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['character', 'scene', 'prop', 'colorPalette'] },
        id: { type: 'string', description: '角色/场景/道具/色卡 ID' },
        image_path: { type: 'string', description: '图片本地绝对路径' },
      },
      required: ['kind', 'id', 'image_path'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    useWorkshopStore.getState().setAssetImage(
      params.kind as 'character' | 'scene' | 'prop',
      params.id as string,
      params.image_path as string,
    );
    await useWorkshopStore.getState().commitNow();
    return { success: true, output: `${params.kind} ${params.id} 资产图已设置` };
  },
};

const setShotMediaTool: Tool = {
  definition: {
    name: 'workshop_set_shot_media',
    description: '关联产物到分镜：图片路径可作为分镜/封面产物手动关联；视频路径只追加为候选视频，必须经过当前输入指纹校验与评审后才能成为正式视频（不能把已有视频直接当作正式成片）。',
    parameters: {
      type: 'object',
      properties: {
        shot_no: { type: 'string' },
        image_path: { type: 'string', description: '分镜图片路径（可选）' },
        video_path: { type: 'string', description: '外部视频路径；只进入候选列表，需经 workshop_accept_video_candidate 评审采用' },
      },
      required: ['shot_no'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const s = useWorkshopStore.getState();
    const shotNo = params.shot_no as string;
    if (!s.data!.shots.some((x) => x.shotNo === shotNo)) {
      return { success: false, output: '', error: `分镜 ${shotNo} 不存在` };
    }
    const patch: Partial<WsShot> = {};
    if (params.image_path) patch.imagePath = params.image_path as string;
    const videoPath = typeof params.video_path === 'string' && params.video_path.trim()
      ? params.video_path.trim()
      : undefined;
    if (videoPath) {
      const current = s.data!.shots.find((x) => x.shotNo === shotNo);
      const candidate = {
        candidateId: `video-${current?.id ?? shotNo}-external-${Date.now()}`,
        path: videoPath,
        source: 'external' as const,
        engineId: 'external',
        prompt: current?.videoPrompt || '',
        inputFingerprint: current?.lastProductionPacket?.inputFingerprint,
        createdAt: Date.now(),
      };
      s.updateShot(shotNo, {
        videoCandidates: [...((current?.videoCandidates ?? []).filter((item) => item.path !== videoPath)), candidate],
        genStatus: 'done',
        genError: undefined,
        genTaskId: undefined,
        genProgress: '外部视频已导入为候选，等待评审采用',
      });
    } else if (Object.keys(patch).length > 0) {
      patch.genStatus = 'done';
      patch.genError = undefined;
      patch.genTaskId = undefined;
      s.updateShot(shotNo, patch);
    }
    await s.commitNow();
    return { success: true, output: videoPath
      ? `分镜 ${shotNo} 已将外部视频导入为候选，尚未写入正式视频；请用 workshop_accept_video_candidate 评审采用。`
      : `分镜 ${shotNo} 图片路径已设置` };
  },
};

const clearShotAudioTool: Tool = {
  definition: {
    name: 'workshop_clear_shot_audio',
    description: '清空某个分镜的视频音频资产引用。用于用户说“这镜不要音色/不要配音/去掉声音资产”或生成报错提示音频过长时。它会把 voiceCharacterIds 清空，并关闭 audioInjected；默认保留已生成配音文件以便之后重新启用。',
    parameters: {
      type: 'object',
      properties: {
        shot_no: { type: 'string', description: '分镜编号' },
        clear_generated: { type: 'boolean', description: '是否同时删除 generatedAudios 引用。默认 false，仅停止传入，不删除历史文件。' },
      },
      required: ['shot_no'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const s = useWorkshopStore.getState();
    const shotNo = params.shot_no as string;
    if (!s.data!.shots.some((x) => x.shotNo === shotNo)) {
      return { success: false, output: '', error: `分镜 ${shotNo} 不存在` };
    }
    s.updateShot(shotNo, {
      voiceCharacterIds: [],
      audioInjected: false,
      ...(params.clear_generated ? { generatedAudios: [] } : {}),
    });
    await s.commitNow();
    return { success: true, output: `已清空分镜 ${shotNo} 的音色/配音传入引用` };
  },
};

const addCandidateTool: Tool = {
  definition: {
    name: 'workshop_add_candidate',
    description: '把本地文件注册为资产候选图（不花钱、不调生成接口）。典型场景：用户上传了新图片、外部工具生成了图、画布传回工坊。select=true 立即设为当前使用图。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['character', 'scene', 'prop'] },
        id: { type: 'string', description: '角色/场景/道具 ID' },
        image_path: { type: 'string', description: '图片本地绝对路径' },
        source: { type: 'string', enum: ['upload', 'external', 'canvas', 'artifact'], description: '来源标记（默认 external）' },
        select: { type: 'boolean', description: '是否立即设为当前使用图（默认 true）' },
      },
      required: ['kind', 'id', 'image_path'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const s = useWorkshopStore.getState();
    const kind = params.kind as WorkshopAssetKind;
    const id = params.id as string;
    const source = (params.source as AssetCandidate['source']) ?? 'external';
    const select = params.select !== false;
    s.addAssetCandidate(kind, id, {
      path: params.image_path as string,
      source,
      createdAt: Date.now(),
    }, select);
    await s.commitNow();
    return { success: true, output: `${kind} ${id} 候选图已注册${select ? '并设为当前图' : ''}` };
  },
};

const removeAssetTool: Tool = {
  definition: {
    name: 'workshop_remove_asset',
    description: '删除工坊角色/场景/道具。会同步从所有分镜中移除引用，受影响分镜的提示词会被标记需刷新；删除后可在界面撤销一次。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['character', 'scene', 'prop'] },
        id: { type: 'string' },
      },
      required: ['kind', 'id'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const s = useWorkshopStore.getState();
    const kind = params.kind as 'character' | 'scene' | 'prop';
    if (kind === 'character') s.removeCharacter(params.id as string);
    else if (kind === 'scene') s.removeScene(params.id as string);
    else s.removeProp(params.id as string);
    await s.commitNow();
    return { success: true, output: `${kind} ${params.id} 已删除` };
  },
};

const upsertAssetsTool: Tool = {
  definition: {
    name: 'workshop_upsert_assets',
    description: '增量新增/更新角色、场景或道具。已有角色必须复用其 id，不得因分集或重试另造 id；名称及档案一致的重复角色会自动合并。可修改名称、外观、性格等字段。',
    parameters: {
      type: 'object',
      properties: {
        characters: { type: 'array', items: { type: 'object' }, description: '角色数组（id 必填，其他字段按需）' },
        scenes: { type: 'array', items: { type: 'object' }, description: '场景数组（id 必填，其他字段按需）' },
        props: { type: 'array', items: { type: 'object' }, description: `${PROP_ASSET_DESCRIPTION} id 必填，其他字段按需。` },
      },
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const s = useWorkshopStore.getState();
    if (Array.isArray(params.characters)) s.upsertCharacters(params.characters as WsCharacter[]);
    if (Array.isArray(params.scenes)) s.upsertScenes(params.scenes as WsScene[]);
    if (Array.isArray(params.props)) s.upsertProps(params.props as WsProp[]);
    await s.commitNow();
    return { success: true, output: `资产已更新${Object.keys(useWorkshopStore.getState().data?.characterIdAliases ?? {}).length ? `；角色 ID 归并：${JSON.stringify(useWorkshopStore.getState().data?.characterIdAliases)}` : ''}` };
  },
};

const setStepStatusTool: Tool = {
  definition: {
    name: 'workshop_set_step_status',
    description: '标记步骤状态（done=完成 / in-progress=进行中）。一键全流程时每完成一步调用一次。',
    parameters: {
      type: 'object',
      properties: {
        step: { type: 'string', enum: STEP_IDS },
        status: { type: 'string', enum: ['done', 'in-progress', 'pending'] },
      },
      required: ['step', 'status'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const store = useWorkshopStore.getState();
    const data = store.data;
    const step = params.step as WorkshopStepId;
    const status = params.status as 'done' | 'in-progress' | 'pending';
    if (!data) return { success: false, output: '', error: '请先打开工坊项目' };
    if (status === 'done' && step === 'breakdown') {
      const { request } = currentWorkshopEditScope();
      if (resolveWorkshopExecutionTask(request, data)) {
        const pending = pendingBreakdownUnits(data);
        if (pending.length) return { success: false, output: '', error: `还有 ${pending.length} 段正文未登记拆解完成。请处理当前检查点；已有镜头可用 workshop_complete_breakdown_unit 关联，不要重写。` };
      }
    }
    if (status === 'done') {
      const reasons = reasonsForStepCompletion({ data, project: store.project, step });
      if (reasons.length > 0) return { success: false, output: '', error: `步骤 ${step} 不能标记为完成：\n${reasons.join('\n')}` };
    }
    store.markStepStatus(step, status);
    await store.commitNow();
    return { success: true, output: `步骤 ${params.step} 已标记为 ${params.status}` };
  },
};

const refreshUiTool: Tool = {
  definition: {
    name: 'workshop_refresh_ui',
    description: '强制同步当前工坊内存态和界面显示。当前台没有立刻显示 agent 刚刚添加、替换、删除的提示词资产、故事板图片、分镜媒体或候选图时调用。mode=memory 只刷新当前内存引用并保存；mode=disk 从项目文件重新读取。',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['memory', 'disk'], description: '默认 memory；如果怀疑另一个进程直接改了 workshop.json，用 disk。' },
      },
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const mode = params.mode === 'disk' ? 'disk' : 'memory';
    const store = useWorkshopStore.getState();
    if (mode === 'disk') await store.reloadCurrent();
    else await store.commitNow();
    const latest = useWorkshopStore.getState();
    return {
      success: true,
      output: `工坊界面已同步：${latest.project?.name ?? latest.project?.id ?? '当前项目'}，分镜 ${latest.data?.shots.length ?? 0} 条。`,
    };
  },
};

const removeShotsTool: Tool = {
  definition: {
    name: 'workshop_remove_shots',
    description: '按 shotNo 删除指定分镜。删除前会确认每个 shotNo 存在。用于用户要求删除特定镜头的场景。',
    parameters: {
      type: 'object',
      properties: {
        shot_nos: {
          type: 'array',
          items: { type: 'string' },
          description: '要删除的分镜编号列表，如 ["06-06", "06-07"]',
        },
      },
      required: ['shot_nos'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const s = useWorkshopStore.getState();
    const nos = params.shot_nos as string[];
    const existing = nos.filter((no) => s.data!.shots.some((x) => x.shotNo === no));
    const missing = nos.filter((no) => !existing.includes(no));
    for (const no of existing) {
      s.removeShot(no);
    }
    s.logChange('breakdown', `删除分镜 ${existing.join(', ')}`);
    await useWorkshopStore.getState().commitNow();
    const parts = [`已删除 ${existing.length} 条分镜，当前共 ${useWorkshopStore.getState().data!.shots.length} 镜`];
    if (missing.length > 0) parts.push(`以下编号不存在已跳过：${missing.join(', ')}`);
    return { success: true, output: parts.join('。') };
  },
};

const recoverStoryboardResultsTool: Tool = {
  definition: {
    name: 'workshop_recover_storyboard_results',
    description: '修复高清故事板并行生成后回传错图的问题。根据任务队列里的 workshopStoryboardFrameId 找回每格对应结果：有远端 URL 就重新下载，有唯一可信本地文件就重绑；如果历史文件名撞车已被覆盖，会明确标记为需要重生成。可选 regenerate_missing=true 自动重生成无法恢复的格子。',
    parameters: {
      type: 'object',
      properties: {
        shot_no: { type: 'string', description: '可选。只恢复某一镜，如 "01-04"；不传则扫描当前项目所有高清故事板。' },
        regenerate_missing: { type: 'boolean', description: '是否对无法从历史记录恢复的格子重新生成。会调用生图通道并产生费用，默认 false。' },
        dry_run: { type: 'boolean', description: '只检查并输出恢复计划，不写回，默认 false。' },
      },
      required: [],
    },
  },
  risk: 'ask',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const ws = useWorkshopStore.getState();
    const data = ws.data!;
    const shotNo = typeof params.shot_no === 'string' ? params.shot_no.trim() : '';
    const regenerate = params.regenerate_missing === true;
    const dryRun = params.dry_run === true;
    const adError = adMaterialsError(data.creativeSpec);
    if (regenerate && !dryRun && adError) return { success: false, output: '', error: adError };
    const shots = data.shots.filter((shot) =>
      (!shotNo || shot.shotNo === shotNo) && (shot.storyboardFrames?.length ?? 0) > 0,
    );
    if (shots.length === 0) {
      return { success: false, output: '', error: shotNo ? `未找到带高清故事板的分镜 ${shotNo}` : '当前项目没有高清故事板分镜' };
    }

    const frameIds = new Set<string>();
    for (const shot of shots) {
      for (const frame of shot.storyboardFrames ?? []) frameIds.add(frame.id);
    }
    const allTasks = useCanvasTaskStore.getState().tasks
      .filter((task) =>
        task.kind === 'image' &&
        task.workshopStoryboardFrameId &&
        frameIds.has(task.workshopStoryboardFrameId) &&
        task.status === 'succeeded' &&
        (task.resultPaths.length > 0 || task.resultUrls.length > 0),
      )
      .sort((a, b) => (b.finishedAt ?? b.updatedAt ?? b.createdAt) - (a.finishedAt ?? a.updatedAt ?? a.createdAt));

    const localPathCounts = new Map<string, number>();
    for (const task of allTasks) {
      const path = task.resultPaths[0];
      if (path) localPathCounts.set(path, (localPathCounts.get(path) ?? 0) + 1);
    }

    const report: string[] = [];
    let recovered = 0;
    let redownloaded = 0;
    let regenerated = 0;
    let unrecoverable = 0;
    let unchanged = 0;

    const nextByShot = new Map<string, NonNullable<WsShot['storyboardFrames']>>();

    for (const shot of shots) {
      const nextFrames: NonNullable<WsShot['storyboardFrames']> = [];
      for (const frame of shot.storyboardFrames ?? []) {
        const frameTasks = allTasks.filter((task) => task.workshopShotNo === shot.shotNo && task.workshopStoryboardFrameId === frame.id);
        let nextPath = '';
        let nextEngine = '';
        let sourceLabel = '';
        let reason = '';

        for (const task of frameTasks) {
          const remote = task.resultUrls.find((url) => /^https?:\/\//.test(url));
          const local = task.resultPaths[0];
          const localDuplicated = local ? (localPathCounts.get(local) ?? 0) > 1 : false;
          if (remote) {
            if (dryRun) {
              nextPath = frame.imagePath || remote;
            } else {
              const { rhtvDownloadAll } = await import('@/lib/rhtv/download');
              const paths = await rhtvDownloadAll([remote], 'image', `storyboard-${shot.shotNo}-${frame.id.slice(-6)}`);
              nextPath = paths[0];
            }
            nextEngine = task.engineId;
            sourceLabel = '重新下载';
            redownloaded += 1;
            break;
          }
          if (local && !localDuplicated) {
            nextPath = local;
            nextEngine = task.engineId;
            sourceLabel = '历史重绑';
            recovered += 1;
            break;
          }
          if (local && localDuplicated) {
            reason = `历史输出文件 ${local.split('/').pop()} 被多个分镜共用，疑似并行撞名覆盖，不能再判断原图`;
          }
        }

        if (!nextPath && regenerate && frame.prompt.trim()) {
          if (dryRun) {
            sourceLabel = '将重新生成';
          } else {
            const { runGeneration } = await import('@/lib/canvasGen');
            const compacted = compactStoryboardFrameReferences(shot, frame, data);
            const bindings = compacted.bindings;
            const cardRef = bindings.find((ref) => ref.kind === 'directorConstraintCard');
            const prompt = cardRef
              ? ensureDirectorConstraintMention(compacted.prompt, cardRef.index)
              : stripDirectorConstraintMention(compacted.prompt);
            const result = await runGeneration({
              engineId: 'gpt-image-2',
              prompt,
              referenceUrls: collectStoryboardGenerationRefs(shot, frame, data),
              params: { aspectRatio: shot.videoRatio || data.videoRatio || '16:9' },
              workshopShotNo: shot.shotNo,
              workshopShotKind: 'image',
              workshopStoryboardFrameId: frame.id,
              projectId: data.projectId,
            });
            if (result.success && result.resultPaths[0]) {
              nextPath = result.resultPaths[0];
              nextEngine = 'gpt-image-2';
              sourceLabel = '重新生成';
              regenerated += 1;
            } else {
              reason = result.error || '重生成失败';
            }
          }
        }

        if (nextPath && !dryRun) {
          nextFrames.push(withStoryboardCandidate(frame, nextPath, 'generate', nextEngine));
          report.push(`${shot.shotNo} / ${frame.id}: ${sourceLabel} → ${nextPath.split('/').pop()}`);
        } else if (nextPath && dryRun) {
          nextFrames.push(frame);
          report.push(`${shot.shotNo} / ${frame.id}: 可${sourceLabel}`);
        } else {
          const nextFrame = {
            ...frame,
            status: 'failed' as const,
            error: reason || '没有找到该格子的历史生成结果；需要重新生成',
          };
          nextFrames.push(dryRun ? frame : nextFrame);
          unrecoverable += 1;
          report.push(`${shot.shotNo} / ${frame.id}: 需要重生成（${nextFrame.error}）`);
        }
      }
      nextByShot.set(shot.shotNo, nextFrames);
    }

    if (!dryRun) {
      for (const [no, frames] of nextByShot.entries()) {
        ws.updateShot(no, { storyboardFrames: frames });
      }
      await ws.commitNow();
    }

    unchanged = allTasks.length === 0 ? frameIds.size : 0;
    const summary = [
      dryRun ? '检查完成，未写回。' : '高清故事板恢复已写回。',
      `历史重绑 ${recovered}`,
      `重新下载 ${redownloaded}`,
      `重新生成 ${regenerated}`,
      `需重生成 ${unrecoverable}`,
      unchanged ? `没有历史任务 ${unchanged}` : '',
    ].filter(Boolean).join('，');
    return {
      success: true,
      output: `${summary}\n${report.slice(0, 80).join('\n')}${report.length > 80 ? `\n...还有 ${report.length - 80} 条` : ''}`,
    };
  },
};

const generateAudioTool: Tool = {
  definition: {
    name: 'workshop_generate_audio',
    description: '为指定分镜生成台词配音候选（Doubao Seed-Audio-1.0）。需先用 workshop_set_prompts 设置 audioPrompts；结果必须经 workshop_accept_audio_candidate 评审后才能注入视频。',
    parameters: {
      type: 'object',
      properties: {
        shot_no: { type: 'string', description: '分镜编号' },
        auto_trim: { type: 'boolean', description: '是否裁剪到镜头时长。H3 默认保留完整配音，超时应延长/拆镜；仅用户明确允许截断时才对 H3 传 true。其他模型保留原有裁剪策略。' },
      },
      required: ['shot_no'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const ws = useWorkshopStore.getState();
    const adError = adMaterialsError(ws.data?.creativeSpec);
    if (adError) return { success: false, output: '', error: adError };
    const shot = ws.data!.shots.find((s) => s.shotNo === params.shot_no);
    if (!shot) return { success: false, output: '', error: `未找到分镜 ${params.shot_no}` };
    if (!shot.audioPrompts?.length) return { success: false, output: '', error: '该分镜没有 audioPrompts，请先用 workshop_set_prompts 写入' };
    const audioPromptErrors = validateAudioPromptsAgainstShot({
      dialogue: shot.dialogue,
      characterIds: shot.characterIds,
      audioPrompts: shot.audioPrompts,
    });
    if (audioPromptErrors.length > 0) {
      return { success: false, output: '', error: `配音生成已阻断：\n${audioPromptErrors.join('\n')}` };
    }
    const { useSettingsStore } = await import('@/stores/settingsStore');
    const { resolveApiKey } = await import('@/lib/credentials');
    const speechSettings = useSettingsStore.getState();
    if (!resolveApiKey(speechSettings, 'doubaoSpeech', speechSettings.doubaoSpeechApiKey).trim()) return { success: false, output: '', error: '未配置豆包语音 API Key' };
    try {
      const { generateShotAudio } = await import('@/lib/doubaoSpeech/generate');
      let results = await generateShotAudio(shot, ws.data!.characters, ws.data!.projectId);
      // 音频总时长上限按当前分镜有效模型分档：Seedance 2.0 限 15s、2.5 限 30s
      const audioLimitSec = (shot.videoModel || ws.data!.videoModel) === 'seedance-2.5' ? 30 : 15;
      const total = results.reduce((s, a) => s + a.duration, 0);
      const shotDurationLimit = Math.min(audioLimitSec, shot.durationSec ?? audioLimitSec);
      const preserveH3Speech = isMiniMaxH3Model(shot.videoModel || ws.data!.videoModel || '') && params.auto_trim !== true;
      if (total > shotDurationLimit && !preserveH3Speech && params.auto_trim !== false) {
        const { trimAudiosToFit } = await import('@/lib/doubaoSpeech/trim');
        results = await trimAudiosToFit(results, shotDurationLimit, ws.data!.projectId);
      } else if (total > shotDurationLimit && !preserveH3Speech) {
        return { success: false, output: '', error: `配音总时长 ${total.toFixed(1)}s 超过本镜 ${shotDurationLimit}s，已拒绝写入候选；请缩短对白或允许自动裁剪。` };
      }
      const createdAt = Date.now();
      const candidates: AudioCandidate[] = results.map((audio, index) => ({
        ...audio,
        candidateId: `audio-${shot.id ?? shot.shotNo}-${audio.characterId}-${createdAt}-${index}`,
        prompt: shot.audioPrompts?.find((item) => item.characterId === audio.characterId)?.prompt,
        engineId: 'doubao-speech',
        createdAt: createdAt + index,
      }));
      const patch: Partial<WsShot> = {
        audioCandidates: [...(shot.audioCandidates ?? []), ...candidates],
        audioInjected: false,
      };
      ws.updateShot(shot.shotNo, patch);
      await useWorkshopStore.getState().commitNow();
      const summary = candidates.map((r) => `${r.characterName} ${(r.trimmedDuration ?? r.duration).toFixed(1)}s（${r.candidateId}）`).join(', ');
      const timingNotice = preserveH3Speech && total > shotDurationLimit
        ? `完整配音 ${total.toFixed(1)} 秒已保留，超过原镜头参考时长；采用后请重新排时，超过当前单镜预算需拆镜，不要再次生成或截断对白。`
        : '';
      return { success: true, output: `配音候选生成完成：${summary}。${timingNotice}结果尚未注入视频，请先用 workshop_get_state 获取 fingerprint，再调用 workshop_accept_audio_candidate。` };
    } catch (err) {
      return { success: false, output: '', error: `配音生成失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

export const allWorkshopTools: Tool[] = [
  adGetReferencePlanTool,
  adReadReferenceImagesTool,
  adSetReferencePlanTool,
  adMaterialsTool,
  adResearchCanvasTool,
  adProductImagesTool,
  getStateTool,
  getProductionAuditTool,
  getShotRefsTool,
  readSourceTool,
  recordScriptRevisionTool,
  setScriptReviewTool,
  setBreakdownTool,
  setEpisodeScriptTool,
  setShotsTool,
  completeBreakdownUnitTool,
  restoreShotDialogueTool,
  setCharacterHandoffsTool,
  setBiblesTool,
  updateShotTool,
  updateShotRefsTool,
  setPromptsTool,
  setStoryboardPromptsTool,
  updateStoryboardFramePromptsTool,
  setDirectorConstraintCardTool,
  updateDirectorConstraintPromptTool,
  setDirectorConstraintUsageTool,
  setAssetPromptTool,
  generateTool,
  setStepStatusTool,
  setAssetImageTool,
  setShotMediaTool,
  clearShotAudioTool,
  addCandidateTool,
  removeAssetTool,
  upsertAssetsTool,
  refreshUiTool,
  removeShotsTool,
  recoverStoryboardResultsTool,
  generateAudioTool,
  readVideoEvidenceTool,
  recordVideoReviewTool,
  acceptVideoCandidateTool,
  acceptAudioCandidateTool,
];
