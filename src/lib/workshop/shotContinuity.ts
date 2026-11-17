import { numToCn } from './shotRefs.ts';
import { h3BoundaryCompositionRuleZh } from './h3DirectingPolicy.ts';
import type { SglangH3Task } from '../canvasGen/sglangH3.ts';
import type { ShotContinuityState, WsShot } from './types.ts';

export interface ShotContinuityReferencePlan {
  previousTailIndex?: number;
  startFrameIndex: number;
  endFrameIndex: number;
  previousExitState?: ShotContinuityState;
  entryState?: ShotContinuityState;
  exitState?: ShotContinuityState;
}

export function appendShotSoundIntent(prompt: string, soundIntent?: string): string {
  const body = prompt.trim();
  const intent = soundIntent?.trim();
  if (!body || !intent || body.includes(intent)) return body;
  return `${body}\n\n声音意图：${intent}`;
}

type ContinuityShot = Pick<WsShot, 'shotNo' | 'episode' | 'sceneId' | 'sceneImagePaths' | 'continuityMode'>;

export function shouldUsePreviousTail(shot: ContinuityShot, previous?: ContinuityShot): boolean {
  if (!previous) return false;
  // Frame chaining is determined by episode and scene identity, not AI-authored
  // editorial labels (legacy scene-cut/time-jump flags may be contradictory).
  const episode = shot.episode || shot.shotNo.match(/^(\d+)-/u)?.[1];
  const previousEpisode = previous.episode || previous.shotNo.match(/^(\d+)-/u)?.[1];
  if (!episode || !previousEpisode) return false;
  if (episode.replace(/^0+(?=\d)/u, '') !== previousEpisode.replace(/^0+(?=\d)/u, '')) return false;
  if (!shot.sceneId || shot.sceneId !== previous.sceneId) return false;
  // Per-shot scene image overrides are also a boundary, even under the same ID.
  if (shot.sceneImagePaths !== undefined || previous.sceneImagePaths !== undefined) {
    const currentImages = [...new Set(shot.sceneImagePaths ?? [])].sort();
    const previousImages = [...new Set(previous.sceneImagePaths ?? [])].sort();
    if (JSON.stringify(currentImages) !== JSON.stringify(previousImages)) return false;
  }
  return true;
}

export function validateShotContinuityForGeneration(shot: WsShot, previous?: WsShot): string[] {
  if (!shouldUsePreviousTail(shot, previous)) return [];
  const errors: string[] = [];
  if (!previous) {
    errors.push('本镜声明承接上一镜，但不存在上一镜头。');
    return errors;
  }
  if (previous.sceneId !== shot.sceneId) {
    errors.push(`本镜声明承接上一镜，但场景从 ${previous.sceneId ?? '未设置'} 变为 ${shot.sceneId ?? '未设置'}；请改为 scene-cut/time-jump/montage。`);
  }
  if (!previous.videoEndFramePath) {
    errors.push('本镜声明承接上一镜，但上一镜没有可用尾帧。请先生成上一镜尾帧，或明确解除继承关系。');
  }
  return errors;
}

function imageRef(index: number): string {
  return `@图片${numToCn(index)}`;
}

function multimodalImageRef(index: number): string {
  return `<Picture ${index}>`;
}

function shiftImageReferences(prompt: string, offset: number): string {
  if (!offset) return prompt;
  return prompt.replace(/@图片([一二三四五六七八九十]+|\d+)/g, (match, raw: string) => {
    const numeric = /^\d+$/.test(raw) ? Number(raw) : [
      '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
      '十一', '十二', '十三', '十四', '十五',
    ].indexOf(raw) + 1;
    return numeric > 0 ? imageRef(numeric + offset) : match;
  });
}

export interface BoundaryFramePromptSegments {
  start: string;
  end: string;
  timeline: string;
  spatialContext: string;
  cameraContext: string;
  endVerification: string;
  segmentCount: number;
}

export interface BoundaryFrameAssetReference {
  index: number;
  label: string;
}

function assetReferenceSection(references: BoundaryFrameAssetReference[]): string {
  if (references.length === 0) return '【资产参考清单】\n无额外资产参考图。';
  const sceneRefs = references.filter((reference) => /场景/.test(reference.label));
  const multiScene = sceneRefs.length >= 2;
  const jointSceneRule = multiScene
    ? '\n场景参考图为同一空间的两个互补斜对角视角，必须联合读取而不是二选一：视角A与视角B共同定义唯一世界坐标、墙面关系、出入口、固定家具和物体位置。不得把两张图拼成分屏，不得复制或改变物体；首帧中的每个空间锚点必须同时符合两张视角图，使用第二视角校验第一视角的盲区。'
    : '';
  return `【资产参考清单：以下图片文件均已随请求实际上传】\n${references
    .map((reference) => `${imageRef(reference.index)}：${reference.label}`)
    .join('\n')}\n必须按上述用途读取每一张资产图：场景图锁定空间和环境，角色图锁定人物身份、脸型五官、发型与服装，道具图锁定物件外观，色卡锁定配色；禁止忽略已上传但未在镜头动作句中重复点名的资产。${jointSceneRule}`;
}

function timedOrNumberedSegment(line: string): boolean {
  const normalized = line.trim().replace(/^[-*]\s*/, '');
  return /^(?:镜头|子镜头)\s*\d+(?:\s*[-－—.]\s*\d+)?(?:\s|[:：、])/u.test(normalized)
    || /^\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-~～—至]\s*\d+(?:\.\d+)?\s*(?:s|秒)\s*[:：，,、]/iu.test(normalized);
}

function boundarySectionHeading(line: string): boolean {
  const normalized = line.trim();
  return /^【[^】]+】$/u.test(normalized)
    || /^\[[A-Z_]+\]$/u.test(normalized)
    || /^(?:全片|整体|物理与一致性|一致性|视觉与声音|声音|负面约束|色彩|画面配色)[^。！？!?]{0,20}[:：]/u.test(normalized);
}

function extractInlineTimedSegments(text: string): string[] {
  const marker = /(?:from\s+)?(?:\d{1,2}:)?\d+(?:\.\d+)?\s*(?:s|秒)?\s*(?:[-~～—至]|\bto\b)\s*(?:\d{1,2}:)?\d+(?:\.\d+)?\s*(?:seconds?|s|秒)?\s*[:：，,、]?/giu;
  const matches = [...text.matchAll(marker)];
  return matches.map((match, index) => text.slice(
    match.index ?? 0,
    matches[index + 1]?.index ?? text.length,
  ).trim()).filter(Boolean);
}

function extractNamedSection(prompt: string, heading: string): string {
  const lines = prompt.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return '';
  const endOffset = lines.slice(start + 1).findIndex((line) => /^(?:【[^】]+】|\[[A-Z_]+\]|(?:overall_soundscape|non_diegetic_music)\s*:)/u.test(line.trim()));
  const end = endOffset >= 0 ? start + 1 + endOffset : lines.length;
  return lines.slice(start + 1, end).join('\n').trim();
}

function extractOfficialIntegratedDescription(prompt: string): string {
  const match = prompt.match(/(?:^|\n)\s*integrated_multimodal_description\s*:\s*([\s\S]*?)(?=\n\s*(?:overall_soundscape|non_diegetic_music)\s*:|$)/iu);
  return match?.[1]?.trim() ?? '';
}

export function normalizeStartFrameDescription(frameDescription: string): string {
  const prompt = frameDescription.trim();
  if (!prompt) return prompt;
  // Older projects may have persisted the complete H3 prompt in the start-frame slot.
  // Keep only the opening visual description so future actions and end-state blocks
  // cannot leak into the single-frame image request.
  const visualTargetMarker = '【当前镜头 0.00 秒唯一画面目标】';
  const markerPositions = [...prompt.matchAll(new RegExp(visualTargetMarker, 'g'))].map((match) => match.index ?? 0);
  const candidate = markerPositions.length > 0
    ? prompt.slice(markerPositions[markerPositions.length - 1] + visualTargetMarker.length)
    : prompt;
  const normalizedCandidate = candidate.replace(/\\_/g, '_').replace(/\\n/g, '\n');
  const integrated = extractOfficialIntegratedDescription(normalizedCandidate);
  if (integrated) {
    const firstShot = splitOfficialShotDescriptions(integrated)[0] ?? integrated;
    const beforeNextSection = firstShot.split(/\n\s*(?=\[[A-Z_]+\]|【[^】]+】)/u)[0]?.trim() ?? firstShot;
    return sentenceWindow(beforeNextSection, false);
  }
  const taskMarker = normalizedCandidate.indexOf('【视频首帧生成任务】');
  const withoutTask = taskMarker >= 0 ? normalizedCandidate.slice(0, taskMarker) : normalizedCandidate;
  const shotMarker = withoutTask.match(/^\s*\[Shot\s+1\]\s*([\s\S]*?)(?=\n\s*\[(?:[A-Z_]+)\]|\n\s*【[^】]+】|$)/iu);
  if (shotMarker?.[1]?.trim()) return shotMarker[1].trim();
  const sectionMarker = withoutTask.search(/(?:\n|\\n)\s*(?:\[[A-Z_]+\]|【[^】]+】)/u);
  return (sectionMarker >= 0 ? withoutTask.slice(0, sectionMarker) : withoutTask).trim();
}

function splitOfficialShotDescriptions(description: string): string[] {
  const shots = [...description.matchAll(/(?:^|\s)(\[Shot\s+\d+\])\s*/giu)];
  if (shots.length === 0) return [description.trim()].filter(Boolean);
  return shots.map((match, index) => description.slice(
    (match.index ?? 0) + match[0].indexOf(match[1]),
    shots[index + 1]?.index ?? description.length,
  ).trim()).filter(Boolean);
}

function sentenceWindow(text: string, fromEnd: boolean): string {
  const sentences = text.split(/(?<=[.!?。！？])\s+/u).map((item) => item.trim()).filter(Boolean);
  if (sentences.length <= 4) return text.trim();
  return (fromEnd ? sentences.slice(-4) : sentences.slice(0, 4)).join(' ');
}

function formatContinuityState(label: string, state?: ShotContinuityState): string {
  if (!state) return `${label}：未提供结构化状态，只能依据画面和时间轴推导。`;
  return `${label}：地点=${state.location}；时间=${state.time}；人物=${state.characters}；道具=${state.props}；环境=${state.environment}。`;
}

function continuityStateLedger(input: {
  previousExitState?: ShotContinuityState;
  entryState?: ShotContinuityState;
  exitState?: ShotContinuityState;
  includeExitState?: boolean;
}): string {
  const exitLine = input.includeExitState === false ? '' : `\n${formatContinuityState('本镜结束状态', input.exitState)}`;
  return `【人物与道具状态账本】
${formatContinuityState('上一镜结束状态', input.previousExitState)}
${formatContinuityState('本镜开始状态', input.entryState)}${exitLine}
继承镜头中，上一镜结束状态与本镜开始状态描述的是同一时刻，人物位置、朝向、可见范围以及道具的持有人、落点、完整/破损/消耗状态不得自行复位。所有状态变化只能按照当前镜头时间轴向前发生一次；除非当前镜头事实明确写出新的交接、抛掷、拾取、召回、修复、复制或超自然控制过程，否则道具不得返回旧持有人、反向飞行、恢复完整、凭空消失或出现在另一人物手中。`;
}

export function extractBoundaryFramePromptSegments(videoPrompt: string): BoundaryFramePromptSegments {
  const prompt = videoPrompt.trim();
  if (!prompt) return { start: '', end: '', timeline: '', spatialContext: '', cameraContext: '', endVerification: '', segmentCount: 0 };

  const officialIntegrated = extractOfficialIntegratedDescription(prompt);
  if (officialIntegrated) {
    const actionEngine = extractNamedSection(officialIntegrated, '[ACTION_ENGINE]');
    const timedSegments = extractInlineTimedSegments(actionEngine || officialIntegrated);
    if (actionEngine && timedSegments.length > 0) {
      return {
        start: timedSegments[0],
        end: timedSegments[timedSegments.length - 1],
        timeline: timedSegments.join('\n'),
        spatialContext: extractNamedSection(officialIntegrated, '[WORLD_CONTINUITY]'),
        cameraContext: extractNamedSection(officialIntegrated, '[CAMERA_LOGIC]'),
        endVerification: extractNamedSection(officialIntegrated, '[STATE_TRANSITION]'),
        segmentCount: timedSegments.length,
      };
    }
    const shotDescriptions = splitOfficialShotDescriptions(officialIntegrated);
    const startShot = shotDescriptions[0] ?? officialIntegrated;
    const endShot = shotDescriptions[shotDescriptions.length - 1] ?? officialIntegrated;
    const timeline = timedSegments.length > 0 ? timedSegments.join('\n') : officialIntegrated;
    return {
      start: sentenceWindow(startShot, false),
      end: sentenceWindow(endShot, true),
      timeline,
      spatialContext: '',
      cameraContext: '',
      endVerification: sentenceWindow(endShot, true),
      segmentCount: timedSegments.length || shotDescriptions.length,
    };
  }

  const actionEngine = extractNamedSection(prompt, '[ACTION_ENGINE]');
  const actionSegments = extractInlineTimedSegments(actionEngine);
  if (actionEngine && actionSegments.length > 0) {
    return {
      start: actionSegments[0],
      end: actionSegments[actionSegments.length - 1],
      timeline: actionSegments.join('\n'),
      spatialContext: extractNamedSection(prompt, '[WORLD_CONTINUITY]'),
      cameraContext: extractNamedSection(prompt, '[CAMERA_LOGIC]'),
      endVerification: extractNamedSection(prompt, '[STATE_TRANSITION]'),
      segmentCount: actionSegments.length,
    };
  }

  const lines = prompt.split(/\r?\n/);
  const starts = lines.reduce<number[]>((indices, line, index) => {
    if (timedOrNumberedSegment(line)) indices.push(index);
    return indices;
  }, []);
  if (starts.length > 0) {
    const segments = starts.map((start, index) => {
      const nextNumbered = starts[index + 1] ?? lines.length;
      const nextSectionOffset = lines.slice(start + 1, nextNumbered).findIndex(boundarySectionHeading);
      const end = nextSectionOffset >= 0 ? start + 1 + nextSectionOffset : nextNumbered;
      return lines.slice(start, end).join('\n').trim();
    }).filter(Boolean);
    return {
      start: segments[0],
      end: segments[segments.length - 1],
      timeline: segments.join('\n'),
      spatialContext: '',
      cameraContext: '',
      endVerification: '',
      segmentCount: segments.length,
    };
  }

  const paragraphs = prompt.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  if (paragraphs.length > 1) {
    return {
      start: paragraphs[0],
      end: paragraphs[paragraphs.length - 1],
      timeline: paragraphs.join('\n'),
      spatialContext: '',
      cameraContext: '',
      endVerification: '',
      segmentCount: paragraphs.length,
    };
  }

  const sentences = prompt.split(/(?<=[。！？!?；;])\s*/u).map((item) => item.trim()).filter(Boolean);
  return {
    start: sentences[0] ?? prompt,
    end: sentences[sentences.length - 1] ?? prompt,
    timeline: sentences.join('\n'),
    spatialContext: '',
    cameraContext: '',
    endVerification: '',
    segmentCount: sentences.length || 1,
  };
}

export function buildShotStartFramePrompt(input: {
  frameDescription: string;
  timelineDescription?: string;
  previousTailDescription?: string;
  spatialContext?: string;
  cameraContext?: string;
  aspectRatio: string;
  previousTailIndex?: number;
  previousExitState?: ShotContinuityState;
  entryState?: ShotContinuityState;
  exitState?: ShotContinuityState;
  assetReferences?: BoundaryFrameAssetReference[];
  /** Set to i2va only when the generated first frame belongs to an inheriting first-frame shot. */
  h3Task?: SglangH3Task;
}): string {
  const frameDescription = normalizeStartFrameDescription(input.frameDescription);
  const i2vaBoundaryRule = h3BoundaryCompositionRuleZh(input.h3Task);
  const continuity = input.previousTailIndex
    ? `上一镜头尾帧为 ${imageRef(input.previousTailIndex)}。它是当前首帧的即时视觉主参考。先完整读取尾帧中实际可见的资产、人物、位置、朝向、可见范围、手部接触、道具状态、电视/屏幕内容、光线方向、阴影和摄影机轴线，再将这些状态原样继承到当前首帧。${input.previousTailDescription?.trim() ? `尾帧内容补充描述：${input.previousTailDescription.trim()}。` : ''}除当前镜头开场状态明确要求的变化外，不得重排场景、替换人物、改变道具状态或改变摄影机侧别。`
    : '这是本项目第一个镜头，不存在上一镜尾帧；请严格依据资产参考建立稳定的角色、场景、道具和光线基准。';
  return `${assetReferenceSection(input.assetReferences ?? [])}

${continuityStateLedger({ ...input, includeExitState: false })}

【上一镜尾帧可见内容与资产继承】
${input.previousTailIndex ? '上一镜尾帧中的所有可见资产都必须按原用途、原位置、原朝向、原尺度和原状态继承；未出现在尾帧中的资产不得仅因上传过参考图而强行加入画面。人物、家具、道具、屏幕内容、光源和阴影必须逐项核对。' : '无上一镜尾帧；所有资产以当前镜头首帧状态和已上传参考图为准。'}

【空间与摄影机基准】
${input.spatialContext?.trim() || '以开场描述和参考图建立空间关系。'}
${input.cameraContext?.trim() || '若没有明确摄影机运动，首帧使用开场描述规定的机位与景别。'}
场景参考图中的斜俯视/高位广角视角仅用于校准空间坐标、固定物体位置和盲区，不是首帧的输出机位；首帧必须严格采用当前镜头开场描述、镜头设定和摄影机基准规定的机位、景别、俯仰、透视和构图，不得模仿或复制场景资产的观察角度。

【当前镜头 0.00 秒唯一画面目标】
${frameDescription}

【视频首帧生成任务】
只生成当前镜头 0.00 秒的单张开场画面。首帧必须表现第一个动作发生前的本镜开始状态；不得把完整动作时间轴、后续人物、后续动作、道具结果或结尾状态提前画进首帧。只有 entryState、当前开场描述或上一镜尾帧中已经可见的人物才能出现在画面内，后续才进入画面的角色不得提前出现。${continuity}
若摄影机时间轴没有明确写出开场前已经后移、拉远、变焦、升降、转向或切换机位，首帧不得自行扩大视野、改变透视或露出原构图外的人物和背景。${i2vaBoundaryRule ? ` ${i2vaBoundaryRule}` : ''}
输出画幅必须严格为 ${input.aspectRatio}，不得沿用参考图自身比例，不得增加留白、黑边或画布扩边。画面必须是单张完整电影画面，不要分镜拼图、边框、说明文字、水印或参数标注。`;
}

export function buildShotEndFramePrompt(input: {
  frameDescription: string;
  timelineDescription?: string;
  startDescription?: string;
  spatialContext?: string;
  cameraContext?: string;
  endVerification?: string;
  aspectRatio: string;
  startFrameIndex: number;
  previousTailIndex?: number;
  previousExitState?: ShotContinuityState;
  entryState?: ShotContinuityState;
  exitState?: ShotContinuityState;
  assetReferenceOffset?: number;
  assetReferences?: BoundaryFrameAssetReference[];
}): string {
  const endDescription = shiftImageReferences(input.frameDescription.trim(), input.assetReferenceOffset ?? 0);
  const timelineDescription = shiftImageReferences((input.timelineDescription || input.frameDescription).trim(), input.assetReferenceOffset ?? 0);
  const startDescription = shiftImageReferences((input.startDescription || '').trim(), input.assetReferenceOffset ?? 0);
  const spatialContext = shiftImageReferences((input.spatialContext || '').trim(), input.assetReferenceOffset ?? 0);
  const cameraContext = shiftImageReferences((input.cameraContext || '').trim(), input.assetReferenceOffset ?? 0);
  const endVerification = shiftImageReferences((input.endVerification || '').trim(), input.assetReferenceOffset ?? 0);
  const continuity = input.previousTailIndex
    ? `同时继承上一镜尾帧 ${imageRef(input.previousTailIndex)} 的跨镜连续状态。`
    : '';
  return `${assetReferenceSection(input.assetReferences ?? [])}

${continuityStateLedger(input)}

【空间与摄影机基准】
${spatialContext || '以首帧、时间轴和参考图建立空间关系。'}
${cameraContext || '若时间轴没有明确摄影机运动，保持首帧的机位、透视、视野范围和构图边界。'}

【时间轴开始状态】
${startDescription || '以当前镜首帧和本镜 entryState 为准。'}

【完整动作时间轴：必须按顺序推导最终状态】
${timelineDescription}

【尾帧验收补充】
${endVerification || '以时间轴所有动作完成后的可见结果作为尾帧。'}

【唯一画面目标：时间轴最后一段的结束时刻】
${endDescription}

【视频尾帧生成任务】
先从本镜开始状态出发，按照完整时间轴把每一次人物移动、道具交接、落地、破损、消耗、摄影机运动和角色入画依次执行一遍，再生成所有动作完成后的唯一结束画面。不得跳过中间因果，也不得倒放、重演、反向交接或恢复旧状态。最后一段即使文字较短，也必须继承前面全部已完成的状态变化；尾帧不是“只画最后一句”，而是“完整时间轴执行后的最终世界状态”。
末段描述、exitState 和尾帧验收中的人物位置、姿态、视线、双手状态、道具持有人/落点/形态、景别、焦点和情绪结果具有最高语义优先级。若道具已经落地、破碎、放下、交出、消失或不再由人物持有，不得因为首帧或资产图仍显示旧状态而复制或复位；除非时间轴明确存在反向交接、召回、修复或复制过程，否则道具不得回到之前的持有人。
${imageRef(input.startFrameIndex)} 是本镜首帧，只作为身份、画风、场景结构、光影和摄影机连续性的主参考，不得复制它的动作、手势、道具持有状态或开场构图。若完整时间轴没有明确写出摄影机后移、拉远、变焦变广、升降、转向、切换机位或遮挡揭示，尾帧必须保持首帧相同的摄影机位置、焦段、透视、地平线、视野边界和主体画面占比；不得为了容纳更多人物而自行后退镜头或扩大取景。新人物只有在时间轴明确写出从哪个入口、沿什么路径进入当前视野，或明确由摄影机运动揭示时，才能出现在尾帧。
尾帧必须与首帧产生时间轴规定的可见差异，严禁输出与首帧相同或近似相同的画面；同时不得改变人物身份或视觉风格，严禁把写实首帧转换成漫画、插画、动漫、3D 卡通、设定稿或分镜草图。${continuity}
输出画幅必须与首帧完全一致并严格为 ${input.aspectRatio}，不得沿用其他参考图比例，不得增加留白、黑边或画布扩边。画面必须是单张完整电影画面，不要分镜拼图、边框、说明文字、水印或参数标注。`;
}

export function buildShotVideoContinuityPrompt(originalPrompt: string, plan: ShotContinuityReferencePlan): string {
  const previous = plan.previousTailIndex
    ? `上一镜头尾帧是 ${multimodalImageRef(plan.previousTailIndex)}，仅作为跨镜连续性锚点。当前镜头开场必须自然承接其中的人物身份、服装发型、道具状态、场景拓扑、空间轴线、光线方向和运动趋势；随后人物位置、姿态、朝向、视线和道具状态必须按照当前镜头时间轴自然变化，不得冻结在上一帧。若当前镜头 atomicAction 明确包含瞬移、闪现、缩地、遁光或空间跃迁，应从上一状态触发该能力，写清起点与现身特效、相对目标的落点/朝向/距离和环境反馈；否则按普通走位连续描述相对位置变化。不得无因换装或重置道具。\n`
    : '';
  return `【首尾帧与镜间连续性硬约束】
${previous}${continuityStateLedger(plan)}
当前镜头首帧是 ${multimodalImageRef(plan.startFrameIndex)}，尾帧是 ${multimodalImageRef(plan.endFrameIndex)}。视频必须从首帧的构图、姿态和状态准确开始，按照下方原始分镜提示词连续演变，并在结尾自然收束到尾帧的构图、动作结果和情绪状态。首尾帧是时间边界，不是并列拼图；禁止在画面中同时展示它们。整个过程中保持人物身份、脸型与身体比例、服装身份、道具身份、场景拓扑、轴线和光影逻辑稳定；人物位置、姿态、视线、嘴形、动作方向、手势和道具持有状态必须依照时间轴从首帧连续演变到尾帧，禁止冻结动作或复制首帧。人物与道具状态只能沿时间轴向前演变：上一镜已经完成的交接、落地、破损、消耗或位置变化不得在本镜开场被撤销；当前镜若没有明确的新交接、抛掷、召回、修复、复制或超自然控制动作，不得让道具反向飞回、回到旧持有人或恢复旧形态。

【原始分镜提示词】
${originalPrompt.trim()}`;
}

export function buildPreviousTailContinuityPrompt(originalPrompt: string, previousTailIndex: number, states?: {
  previousExitState?: ShotContinuityState;
  entryState?: ShotContinuityState;
  exitState?: ShotContinuityState;
}): string {
  return `【跨镜连续性硬约束】上一镜头尾帧是 ${imageRef(previousTailIndex)}，仅作为当前镜头的开场状态锚点。
${continuityStateLedger(states ?? {})}
当前镜头必须从这张尾帧自然开始，继承人物身份、脸型五官、服装发型、道具状态、场景拓扑、空间轴线、光线方向和运动趋势；人物姿态、视线、位置和道具持有状态随后必须按当前镜头 atomicAction 变化，不得冻结在上一镜尾帧。上一镜已经完成的交接、落地、破损、消耗或位置变化不得撤销；当前镜没有明确的新交接、抛掷、召回、修复、复制或超自然控制动作时，道具不得反向飞行、返回旧持有人、恢复旧形态或凭空换手。若 atomicAction 明确包含瞬移、闪现、缩地、遁光或空间跃迁，应保留能力设定并写清发动触发、起点与现身特效、相对目标的落点/朝向/距离和环境反馈；普通走位则写清相对参照物的路径与距离变化。不得无因换装、重置道具或改变场景结构。只表现当前镜头已经确定的单一 atomicAction，不得把上一镜之后的剧情、后续镜头或第二个动作目标塞进本镜。

【本镜原始提示词】
${originalPrompt.trim()}`;
}

export function buildShotContinuityReferencePlan(input: {
  assetCount: number;
  hasPreviousTail: boolean;
  previousExitState?: ShotContinuityState;
  entryState?: ShotContinuityState;
  exitState?: ShotContinuityState;
}): ShotContinuityReferencePlan {
  const previousTailIndex = input.hasPreviousTail ? input.assetCount + 1 : undefined;
  const startFrameIndex = input.assetCount + (input.hasPreviousTail ? 2 : 1);
  return {
    previousTailIndex,
    startFrameIndex,
    endFrameIndex: startFrameIndex + 1,
    ...(input.previousExitState ? { previousExitState: input.previousExitState } : {}),
    ...(input.entryState ? { entryState: input.entryState } : {}),
    ...(input.exitState ? { exitState: input.exitState } : {}),
  };
}

export function shotBoundaryFrameSignature(input: {
  videoPrompt: string;
  plannedStartFramePrompt?: string;
  plannedEndFramePrompt?: string;
  referencePaths: string[];
  previousTailPath?: string;
  aspectRatio: string;
  imageEngine?: string;
}): string {
  const source = JSON.stringify({ contractVersion: 10, ...input });
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `boundary-${(hash >>> 0).toString(36)}`;
}
