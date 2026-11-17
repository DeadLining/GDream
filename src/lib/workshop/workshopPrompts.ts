import { ASSET_SCOPE_RULES } from './assetScope.ts';
import { CHARACTER_IDENTITY_RULE } from './characterIdentity.ts';
import { h3BoundaryCompositionRuleZh, H3_DIALOGUE_STAGING_POLICY, H3_DIRECTING_POLICY } from './h3DirectingPolicy.ts';
/**
 * workshopPrompts — 工坊各步骤的预制 agent prompt。
 * 由步骤组件的按钮触发，经 WorkshopChatPanel 发给 agent。
 */
import type { ShotSpatialStaging, WorkshopCreativeSpec, WorkshopData, WsShot } from './types';
import { buildStoryFormatRules, REFERENCE_ASSET_PLANNING_RULES, type StoryFormat } from './storyDirectorPrompt.ts';
import { buildProductAdPrompt } from './adSpec.ts';
import { PERFORMANCE_BRIEF, PERFORMANCE_GUIDE, AI_DRAMA_BAN, CINEMATIC_EXPRESSION_RULES } from '../videoPrompt/performance.ts';
import { normalizeMiniMaxH3DialogueEmissions, stripH3AuthoringNotes } from './h3PromptContract.ts';
import { repairI2vaBoundary } from './h3I2vaBoundary.ts';
import { auditH3ShotContract } from './h3ShotContract.ts';
import type { SglangH3Task } from '../canvasGen/sglangH3.ts';
import { h3OfficialOutputContract, h3PromptWritingSkillForTask } from './h3PromptWritingSkill.ts';
import { h3FormatIssues } from './h3PromptFormat.ts';
import { IMAGE_PROMPT_BUDGET, VIDEO_PROMPT_BUDGET, budgetLabel } from './promptLengthBudget.ts';
import { characterNamingDirective, dialoguePolicyDirective, resolveDialoguePolicy } from './dialoguePolicy.ts';
import { buildSpatialStagingDirective, directorViewpointExecutionRuleEn, spatialStagingAuthoringRuleZh } from './spatialStagingDirective.ts';
import { assertShotTimingFits, H3_FLEXIBLE_TIMING_EN, readH3TimedPrompt, resolveShotTiming, shotTimingAdviceEn, shotTimingDirectiveZh, SINGLE_TIMELINE_MAX_SEC } from './shotTimingPolicy.ts';

export function miniMaxH3TaskPromptRule(task?: SglangH3Task): string {
  if (task === 'i2va') {
    return `【当前 H3 任务：i2va 首帧 + 提示词】
- conditions 只提交运行时首帧，作为 0.00 秒 keyframe；提示词正文不得出现 @图片N、@音频N、@视频N 或 <Picture N> 等素材编号。
- 首帧只约束 0.00 秒开场状态，正文必须从该状态连续向前发展；不要把它写成首尾帧模式，也不要虚构用户提供的尾帧。
- 本模式的实际首帧可能来自上一镜尾帧，实际尾帧也可能被下一镜继承，因此开场和结束构图必须遵守 i2va 专属可继承边界规则；其他模式不得套用这条中景收尾要求。`;
  }
  if (task === 'fl2va') {
    return `【当前 H3 任务：fl2va 首尾帧生成视频】
- conditions 只提交首帧和尾帧，提示词正文不得出现 @图片N、@音频N、@视频N 或 <Picture N> 等素材编号。
- 使用官方关键帧对齐句声明首帧为 0 秒起点、尾帧为结束状态；正文不虚构场景或角色参考图。
- 准确描述首尾帧之间的核心动作、情绪变化、必要对白、镜头运动和物理反馈；开场自然接住首帧，结尾自然抵达尾帧，中间允许人物自然走位和表演。`;
  }
  if (task === 'ref2va') {
    return `【当前 H3 任务：ref2va 参考素材生成视频】
- conditions 提交场景、人物、道具、音频或视频参考素材。在 subject_definitions 建立真实素材与语义身份的映射；retention_analysis 简洁说明参考保留范围，不复制动作时间轴。
- 后续段落只使用人物名、场景名和道具名，不要在每个动作、每个时间段后重复素材编号。
- 保存时使用真实 reference order 的 @素材N；提交时程序会转换为 MiniMax H3 的 <Picture N>/<Audio N>/<Video N>。`;
  }
  if (task === 't2va') {
    return `【当前 H3 任务：t2va 纯文本生成视频】
- conditions 为空，提示词正文不得出现 @图片N、@音频N、@视频N 或 <Picture N> 等素材编号。
- 用完整文本写清人物身份、场景空间、核心动作、情绪变化、必要对白、摄影机和声音，不得假装存在参考素材。`;
  }
  return `【H3 任务类型分流】
- 先读取 workshop_get_state 返回的 h3Task。i2va、fl2va 与 t2va 的 videoPrompt 禁止出现任何 @素材N 或正文素材映射；ref2va 才使用素材编号，且每个编号只在简短素材绑定中出现一次，后续正文只写稳定语义名称。`;
}

export const MINIMAX_H3_VIDEO_PROMPT_BRIEF = `【MiniMax H3 专用视频提示词契约】
- 先读取项目级和单镜 videoModel；单镜覆盖优先。仅当有效模型是 MiniMax H3 / minimax-h3 / SGLang MiniMax-H3 时执行本段，其他模型继续使用其原有规范。
- H3 提示词必须信息完整但不得同义重复。字数不是创作目标：只写已确定事实、真实动作节拍、摄影机、物理反馈和声音；如果镜头动作简单，就保持简洁，不得为了凑字数新增剧情、人物、道具或空间锚点；允许服务已有情节的自然表演和有叙事目的的摄影设计，不要求未被逐字描述的身体部位保持不动。最终文本不得超过接口 12000 字符限制。
- 承接镜头时，输入首帧和 entryState 是 0.00 秒的唯一开场事实；不要把上一阶段已经完成的动作重新演一遍，不要把已经离开画面的固定物体拉回镜头，也不要用旧提示词中的站位覆盖首帧。固定物体保持原世界位置即可，离开画面后不必持续可见。
- 是否使用素材编号必须服从当前 H3 task；不得因为工坊存在资产图就在 i2va/fl2va/t2va 提示词里写 @图片N，也不得在 ref2va 的每个时间段重复引用编号。
- 基础模式固定使用 integrated_multimodal_description、overall_soundscape、non_diegetic_music；ref2va 固定使用 subject_definitions、summary、retention_analysis、detailed_description、overall_soundscape、non_diegetic_music。字段每个只出现一次，独占行首，顺序固定且非空；无声音或配乐写 N/A。正文以 [Shot 1] 开始，仅实际切镜新增连续编号的 [Shot N]，镜内按事件时间段展开，不强制八个子标题。
- [CAMERA_LOGIC] 必须服从任务模式：i2va 的开场与结束执行可继承边界构图规则；fl2va 必须准确抵达用户给定的尾帧，不套用 i2va 的中景收尾要求；其他模式按各自输入执行。
${spatialStagingAuthoringRuleZh()}
- [ACTION_ENGINE] 保留 actionTimeline 的事件顺序；总时长和时间窗是参考，不够自然演完时可内部延长并同步重排。按动作启动、接触、完成、台词重音、停顿与听者反应分段，不固定每 2 秒一段，不规定最小间隔或段数。长台词可跨越多个表演子节拍，不切碎语句；说话、听者反应和环境声可以自然重叠。时间分段不等于切镜。超过当前单镜预算请报告需拆镜，不得加速或删词。
- 首帧只约束开场瞬间。已确认完成的动作不重演；尚未看见的细部不能靠素材标签猜测。最终写成一个确定的动作延续，不输出“如果已完成则保持，否则再做”的分支。没有核实接触细节时，继承首帧姿势但不虚构具体手部接触，从已确定的下一动作继续。
- 写提示词前必须实际查看 workshop_get_shot_refs 返回的原生图片。场景资产默认一张图；以实际提供的图片确定可见空间，不要求第二视角，不编造不可见区域。已有多图时应理解为同一空间，不得混成两个房间。场景资产中已经确定的家具与家具、门窗与墙面的关系不在视频提示词中重复枚举，避免文本重建空间时覆盖图片事实。
- ref2va 按独立 skill 的六字段规范保存；summary 只概括任务与参考范围，retention_analysis 只说明素材保留或迁移关系，动作与原文对白只在 detailed_description 的时间轴出现，不在摘要或声音字段重复。
${miniMaxH3TaskPromptRule()}
- 以下标签仅是内部规划的信息类别，不是最终输出目录；将相关内容融合进统一字段与镜头段落，简单镜头省略无关项，身份和初始锚点只交代一次：
  1. [SUBJECTS]：锁定实际出场人物、人物身份、外观、服装、体态和可见边界；每个物理人物只能出现一次。正式名、字/号、职务、爵位、亲属称谓、代词和对白中的敬称必须归并到同一主体，并在该主体首次出现时用括号列明本镜对白实际使用的称呼，例如 'Lu Su (S1; addressed as 子敬 in dialogue)'；禁止把“子敬”“孔明”“都督”等称呼另写成第二个可见人物、说话人、听者、口部或声音。屏幕、照片或回忆中的人物必须明确其媒介边界，不得变成现场人物。
  2. [WORLD_CONTINUITY]：锁定同一个世界坐标、场景、时间、天气、光源和环境连续性。实际场景图定义可见固定空间，不要求双视角，不在正文重述家具之间或门窗与墙面的既定位置关系。
  3. [OBJECT_CONTINUITY]：锁定关键道具的身份、形态、材质、持有人和物理状态；交接、释放、飞行、接触、破损与落点必须具有连续可见路径。
  4. [ACTION_ENGINE]：在既定动作顺序和时间窗内写自然表演及有意义的子节拍。允许不改变事件的转头、重心变化、姿态调整和手势，不以“未写明”为由冻结人物；保持剧情结果、道具归属和空间连续性。按动作、对白与听者反应需要写相关通道，不机械填满所有通道。
  5. [DIALOGUE]：dialogue 是唯一对白白名单。保留原文与语言，定义稳定说话人 ID，并把说话人绑定到 [SUBJECTS] 中唯一的同一主体和 (Sx) ID；对白中的称呼只属于该行台词，不得生成额外出场者、听者、口型或声源。引用“子敬”“孔明”等称呼时，必须明确它指代已在 [SUBJECTS] 声明的那一个主体，而不是新增人物。明确声源绑定、音色、口型同步和听者反应；对白为空时仅保留已获依据的非语言声音，禁止添加可辨识语言、旁白或画外人声。
  6. [CAMERA_LOGIC]：优先遵守已明确的固定机位、一镜到底或剪辑方案。缺省时可根据已有情节的信息揭示、注意力变化、动作细节和反应设计景别、运镜、移焦或切镜；写明发生时刻、构图对象与叙事目的，不默认慢推，不强制特写或固定切镜数量。保持动作、视线、空间方向与声音连续，不借摄影变化新增事件。首帧不等于全片固定构图；首尾帧模式还须抵达既定尾帧。
  7. [STATE_TRANSITION]：把 entryState 到 exitState 写成单向因果链，说明关键人物与道具状态如何改变，并在最后时段抵达可直接验收的结束画面；不得重置或提前展示结尾。
  8. 约束：仅保留用户明确要求或当前镜确实必要的约束，简洁写一次；不要自动输出防错清单。
${H3_DIRECTING_POLICY}
${H3_DIALOGUE_STAGING_POLICY}
- 长提示词必须增加“可执行信息”，而不是增加导演名、摄影机品牌、空泛形容词或重复的保持一致。每个细节都应能对应到参考素材、镜头事实、模型时间轴或最终验收。`;

export interface RewriteMiniMaxH3ShotPromptInput {
  prompt: string;
  /** Explicit rebuild buttons ignore generated prose; free-form edits preserve user input. */
  rewriteMode?: 'reconstruct' | 'edit';
  references: Array<{ label: string; kind?: string; path?: string }>;
  duration: number;
  minimumDurationSec?: number;
  ratio: string;
  dialogue?: string;
  task?: SglangH3Task;
  factualContext?: string;
  /** Actual runtime keyframe, never a character asset or filename-only reference. */
  firstFramePath?: string;
  previousTailReferencePath?: string;
  /** Structured context from the immediately preceding same-scene shot. */
  previousShotContext?: string;
  /** Per-shot explicit choice: use the accepted previous tail as the authored 00:00 first frame. */
  previousTailAsFirstFrame?: boolean;
  /** Canonical world-layer planning for this shot; translated into a hard directing constraint below. */
  spatialStaging?: ShotSpatialStaging;
  /** Precomputed directive used by the Ref2VA route and tests. */
  spatialStagingDirective?: string;
}

function cleanGeneratedPrompt(text: string): string {
  return text.trim().replace(/^```(?:text|markdown)?\s*/i, '').replace(/\s*```$/, '').trim();
}

export function miniMaxH3RepairGuidance(warnings: string[]): string {
  const guidance: string[] = [];
  if (warnings.some((warning) => /逐段位置状态不足|接触可达性不足|垂直空间不可达/.test(warning))) {
    guidance.push(`必须重写整个 [ACTION_ENGINE]，不得只在 [RESTRICTIONS] 中补一句说明：
- 沿用 actionTimeline 的事件顺序和轨道内容；时长与时间窗是参考，可为自然对白、停顿和反应重排，不套用示例时长或机械等分；
- 合并同一时间窗内的身体、双手、道具、视线、情绪、摄影机和声音轨道，写成连续的动作因果，不要逐段重复固定空间清单；
- 遇到踩踏、抓取、拥抱、递交、推拉、攻击等接触动作，先检查主体与目标是否处于同一支撑平面和可达距离；不在范围内时，必须在接触前一段加入走近、下阶、跨步、俯身、伸手或剧情已有的瞬移/闪现/缩地过程，并重新分配时间；
- 如果人物在高台、目标在台下地面，不能直接接触。必须明确下阶/跃下/走近，或者按原有修仙能力写完整超自然位移特效和落点；不得通过缩小场景距离、拉长肢体或瞬间重置站位解决。`);
  }
  if (warnings.some((warning) => /人物朝向坐标不足|特写连续性不足/.test(warning))) {
    guidance.push('逐段补足脚下落点、躯干/骨盆朝向、脸部朝向、视线目标和屏幕方向；若有特写、近景、推近、移焦或景别渐变，在 [CAMERA_LOGIC] 原样加入：“特写前后延续同一动作轴线，人物面朝同一世界目标，屏幕方向和视线关系保持一致，人物真实身高、头身比例和体型关系不改变；特写只改变取景范围或焦点。”');
  }
  if (warnings.some((warning) => /人物尺度参照不足/.test(warning))) {
    guidance.push('补写主要人物相对身高与体型关系，并以台阶、栏杆、门框、桌面或另一人物肩线作为尺度参照，不虚构厘米数。');
  }
  if (warnings.some((warning) => /对白声源绑定不足/.test(warning))) {
    guidance.push('在 [DIALOGUE] 单独写“声源绑定”，明确唯一说话人的身份、年龄/性别音色、画面位置及声音只从该人物口部发出。');
  }
  if (warnings.some((warning) => /静态约束过密|不能冻结动态状态|表情被写成静态锁/.test(warning))) {
    guidance.push('重写 [ACTION_ENGINE] 中的冻结措辞：不要反复写“保持不变、固定站立、静止不动、僵硬站定、定在原地、几乎不动”；改写为角色在当前空间锚点附近的呼吸、重心、视线、衣摆和自然反应。固定机位只写在 [CAMERA_LOGIC]，不能套到人物身上。');
  }
  return guidance.join('\n');
}

/** MiniMax H3 单镜直接重写：生成阶段注入完整契约，返回后不再用规则校验阻断保存。 */
export async function rewriteMiniMaxH3ShotPrompt(input: RewriteMiniMaxH3ShotPromptInput, options: { signal?: AbortSignal; onProgress?: (status: string) => void; onDurationResolved?: (seconds: number) => void } = {}): Promise<string> {
  const spatialStagingDirective = input.spatialStagingDirective?.trim() || buildSpatialStagingDirective(input.spatialStaging);
  if (String(input.task) === 'ref2va') return (await import('./rewriteRef2vaPrompt')).rewriteRef2vaPrompt({ ...input, spatialStagingDirective }, options);
  const { quickChat } = await import('../agent/quickChat');
  const timing = resolveShotTiming({ durationSec: input.duration, dialogue: input.dialogue, minimumDurationSec: input.minimumDurationSec });
  assertShotTimingFits(timing);
  const minimumDuration = timing.minimumSeconds;
  let duration = timing.effectiveSeconds;
  const task = input.task ?? 'fl2va';
  const visualPath = task === 'ref2va' ? input.previousTailReferencePath : input.firstFramePath;
  const frameChat = visualPath && (task === 'i2va' || task === 'fl2va' || task === 'ref2va')
    ? await (await import('./firstFrameRewriteChat')).createFirstFrameRewriteChat(visualPath, options)
    : undefined;
  const complete = frameChat ?? ((messages: Array<{ role: string; content: string }>) => quickChat(messages, {
    ...options, maxTokens: 16000, continueOnTruncation: true, workspaceScope: 'workshop',
  }));
  const modalityIndexes = { image: 0, audio: 0, video: 0 };
  const references = task === 'ref2va'
    ? input.references.length > 0
      ? input.references.map((reference) => {
          const modality = reference.kind === '音频' ? 'audio' : reference.kind === '视频' ? 'video' : 'image';
          modalityIndexes[modality] += 1;
          const tag = modality === 'audio' ? 'Audio' : modality === 'video' ? 'Video' : 'Picture';
          return `<${tag} ${modalityIndexes[modality]}>：${reference.label}${reference.kind ? `（${reference.kind}）` : ''}`;
        }).join('\n')
      : '当前 ref2va 没有可用参考素材；不得虚构素材编号。'
    : task === 'fl2va'
      ? `Picture 1 是当前镜首帧并对齐 0.00 秒；Picture 2 是当前镜尾帧并对齐 ${duration.toFixed(2)} 秒。`
      : task === 'i2va'
        ? 'Picture 1 是当前镜首帧并对齐 0.00 秒；从该状态连续向前发展。'
        : '当前为 t2va，不提交任何参考素材；最终提示词不得出现任何素材编号。';
  const spatialStagingBlock = spatialStagingDirective
    ? `

${spatialStagingDirective}
SPATIAL FALLBACK WHEN PLANNED LAYERS ARE INSULATED FROM THE LEGACY TEXT: if the canonical description, entry/exit state, camera, or action timeline already establishes different support planes or a vertical group relationship, preserve that topology even when it is not repeated elsewhere. A shared frame with grounded subjects and an aerial, cloud, elevated, or upper-architecture mass must use a low-to-high/upward-looking composition unless the planned viewpoint explicitly says otherwise.`
    : `

SPATIAL INFERENCE REQUIRED: inspect the canonical description, entry/exit state, action timeline, camera and scene layout before writing. If subjects or groups have different support planes or a clear vertical relationship, preserve that topology in the final prompt: keep the lower subject/terrain in the lower foreground and the elevated/aerial/upper-architecture mass in the upper frame; use an upward or low-to-high composition when the main view includes both. Do not flatten different layers onto one ground plane and do not let camera movement move a subject between world layers without an explicit landing, takeoff, fall, rise, climb, jump, or support transfer.`;
  const baseRequest = `Output parameters: reference duration ${duration} seconds, ${input.ratio || '16:9'}. Feasible effective duration: ${minimumDuration}-${SINGLE_TIMELINE_MAX_SEC} seconds.
${shotTimingAdviceEn(timing)}

Current task: ${task}
Actual submitted conditions:
${references}
${spatialStagingBlock}
${directorViewpointExecutionRuleEn()}
${frameChat ? `${task === 'ref2va' ? 'The attached image is the LAST image in the reference list: the preceding accepted video tail, not Picture 1 or a forced keyframe. Other reference images are labels only in this rewrite request; do not pretend you inspected them.' : 'ACTUAL RUNTIME FIRST FRAME IS ATTACHED TO THIS REQUEST:'}
Inspect it before writing. Bind each canonical character to its visible clothing, position, pose and distinguishable features; preserve existing unnamed background people as silent background, not extra speaking roles. Canonical dialogue speaker ownership is immutable. Use the image for visible opening facts, the script for events and dialogue; never infer a speaker from an addressee. Name the supported visual identifier immediately beside each speaker's line. Do not invent hidden faces, hand contacts or props. If identity cannot be resolved from the attached frame plus character facts, or the required speaker is absent, return FRAME_BINDING_UNRESOLVED: with a concise question instead of guessing or rewriting the script. Produce concrete timed opening and ending compositions, not generic locks.` : 'No actual frame image was supplied for inspection. Do not claim visually verified identities or left/right positions.'}

CANONICAL PROJECT AND SHOT FACTS (higher priority than the old prompt):
${input.factualContext?.trim() || 'No additional structured context was supplied.'}

LEGACY SHOT TEXT TO REWRITE, NOT TO TRUST FOR CONFLICTING SPATIAL FACTS:
${stripH3AuthoringNotes(input.prompt)}

Dialogue whitelist for this shot:
${input.dialogue?.trim() || 'No dialogue; do not invent intelligible speech, narration, or voice-over.'}`;
  const result = await complete([
    {
      role: 'system',
      content: `You are the MiniMax H3 prompt editor. Keep the selected mode's packaging fields and keyframe alignment; descriptive subheadings are optional. Output only the final prompt, with no explanation or Markdown fence. Write visual prose in English and preserve original dialogue language. Preserve plot events, cast, relationships, dialogue, props, locations and required outcomes. Natural performance and motivated coverage are permitted under the workshop expression policy. Emit every canonical dialogue turn once in the unfolding event, bound to its sole speaker and stable voice ID. A dialogue ledger, if used, contains metadata only, not another copy of the words. Listening behavior remains non-spoken; preserve any explicitly authored overlap rather than inventing it.

Use CANONICAL PROJECT AND SHOT FACTS as the source of truth. Resolve conflicts in this order: the submitted runtime first frame and its visible state, explicit scene layout and bible facts, character and prop records, entry and exit state, structured actionTimeline, current shot facts, then the legacy prompt. For i2va/fl2va, the runtime first frame is the actual 0.00-second state: never reset a character to an earlier setup, re-stage a completed action, or recreate an object that has already moved out of frame. A screen-left/right phrase in the legacy prompt is not authoritative when it conflicts with the frame or scene layout. Treat each fixed object as one physical object; never create a second reception desk, fountain, doorway, table, or other anchor to reconcile a contradiction. If a fixed object is no longer visible, state only that it remains in its original world position and must not be recreated; do not require it to stay visible throughout the shot.

${H3_DIALOGUE_STAGING_POLICY}

PHYSICAL-CONSISTENCY PRIORITY:
- First frame and entryState define what exists, where it is, who holds each prop, and which actions are already complete. The video begins there.
- The actionTimeline defines only the changes that happen during this shot. Do not repeat pre-shot setup as a new action.
- Meaningful locomotion or object contact must be reachable, supported, and given enough time. Natural performance details may develop an established action; they need not be separately enumerated in the source. Do not replace spatial continuity with a blanket no-movement instruction.
- Fixed scene objects keep one world position but may naturally leave the camera frame. Do not pull them back into view, duplicate them, or use them as mandatory waypoints unless the timeline explicitly requires contact.
- Do not resolve contradictory instructions by adding props, extra limbs, a second person, a new aisle, a mirror flip, or a sudden position reset. Prefer the latest explicit frame/state and simplify the action.
- Every declared physical person has exactly one instance. A close-up, reaction shot, or insert may describe only the subjects visible in that crop. An off-screen subject stays completely omitted from that shot's visible expression, body action, and named identity prose; [WORLD_CONTINUITY] already accounts for the off-screen subject. Do not write the off-screen subject's face, eyes, brows, lips, posture, hands, or movement merely to explain a reaction. A cut or pull-out changes framing only and expands the existing view to the already-established subjects at their world positions; it must never reintroduce or regenerate a person. Number [Shot N] labels uniquely in strict playback order.

${h3PromptWritingSkillForTask(task)}

${h3OfficialOutputContract(task, duration)}
${H3_FLEXIBLE_TIMING_EN}
If you adjust the duration, update every endpoint and the FL2VA last-frame alignment to the effective duration, replacing the reference seconds in the example above.

${PERFORMANCE_GUIDE}

${AI_DRAMA_BAN}

CONTENT DENSITY: Add executable detail only when it is supported by the canonical facts. Detail is not a reason to invent a new prop, plot event, or spatial anchor. Use natural performance and motivated camera choices to express the existing event, without padding or redundant prohibitions. Never pad with director names, vague adjectives, repeated continuity clauses, or repeated descriptions of fixed objects. If the facts are simple, keep the action simple and physically legible.

Write the integrated description as an audiovisual event, using natural paragraphs or meaningful timed beats. Establish relevant identities and opening anchors once. Follow the structured actionTimeline's event order; reflow reference windows for natural speech, actions and reactions. Subdivide only where an action, line, pause or reaction changes. Show cause, contact or path and visible consequence when physical mechanics matter. Combine dialogue delivery, listening, motivated camera work and synchronized sound with the event, not in duplicate catalogues. Use the supplied spatial layout and preserve explicit camera decisions. Where coverage is unspecified, choose framing, movement, focus or cuts to reveal existing information. Express style through concrete medium, material, light, motion and sound choices. Preserve each original line and language inside its actual <d> turn; a silent shot remains silent. End on the approved changed state or intentional hold.`,
    },
    {
      role: 'user',
      content: `${baseRequest}\n\nRewrite the shot using only the canonical facts above. Discard any old Chinese nine-section template and produce the official H3 format only. Start from the submitted first-frame state and the entryState; do not reconstruct an earlier setup or repeat actions that are already complete. Preserve the scene's single spatial layout, make every requested movement physically reachable, preserve physical proportions and continuous spatial relationships through framing changes and visible motivated turns, include the exact dialogue when whitelisted, and end at the stated exit state. For every dialogue interval, bind the line to one and only one visible speaker ID and visible mouth; explicitly keep all other visible mouths closed during that interval, with no simultaneous speech or duplicate lip movement. For I2VA, allow motivated internal cuts at completed speaker turns while preserving identity, pose, eyeline and props. Respect any explicitly fixed camera. Remove contradictions by preferring the latest explicit frame/state and simplifying the action, never by adding a prop, person, limb, aisle, or position reset. Write enough concrete detail for the model to execute the supplied action timeline, develop natural performance and motivated camera coverage without changing the saved events. For i2va specifically, use tight framing only as internal coverage and return to an inheritable medium framing or the established spatial master during the final action beat; never end on an isolated hand, eye, partial face, small prop detail, or ambiguous crop. Resolve the opening into one factual continuation rather than conditional alternatives; do not pretend an uninspected reference label provides visible details. Do not output explanations, a review report, or partial edits.`,
    },
  ]);
  const timedResult = readH3TimedPrompt(result, duration, minimumDuration);
  duration = timedResult.durationSeconds;
  let rewritten = normalizeMiniMaxH3DialogueEmissions(cleanGeneratedPrompt(timedResult.prompt), input.dialogue);

  if (!rewritten) throw new Error('模型没有返回可用的 MiniMax H3 视频提示词');
  if (frameChat && rewritten.includes('FRAME_BINDING_UNRESOLVED:')) {
    throw new Error('首帧人物对应尚未确认，未覆盖原提示词。请核对首帧中各人物与本镜角色的对应关系，或确认当前模型能正常读取图片。');
  }

  // Mode-agnostic contract repair: camera spine, mutable props, one voice id
  // per speaker, no anonymous extra body, and a reaction window after the last
  // utterance. One targeted repair only; never loop or rewrite the whole shot.
  const contractIssues = [...h3FormatIssues(rewritten, false), ...auditH3ShotContract({
    prompt: rewritten,
    dialogue: input.dialogue,
    durationSeconds: duration,
  })];
  if (contractIssues.length > 0) {
    options.onProgress?.('正在定向修复 H3 镜头契约（最多一次）');
    const repairResult = await complete([
      ...(([
        { role: 'system', content: 'You are the MiniMax H3 prompt editor performing a targeted repair. Output only the complete prompt in the canonical mode-specific format. Correct only the listed contract violations. Preserve all canonical facts, exact dialogue, reference bindings, action order, timing and useful camera/action mechanics. Do not add people, props, events or extra dialogue, and never append a checklist.\n' + h3OfficialOutputContract(task, duration) },
        { role: 'user', content: `TARGETED CONTRACT REPAIR. The draft failed this mechanical audit:
${contractIssues.map((issue) => `- ${issue}`).join('\n')}
Canonical facts:
${input.factualContext?.trim() || 'No additional structured facts.'}
Exact dialogue whitelist:
${input.dialogue?.trim() || 'No dialogue; do not add intelligible speech.'}
Effective duration: ${duration} seconds. Keep this duration and its alignment during this content-only repair. Do not accelerate or truncate dialogue.
DRAFT TO REPAIR:
${rewritten}` },
      ]) as Array<{ role: string; content: string }>)],
    );
    const timedRepair = readH3TimedPrompt(repairResult, duration, minimumDuration);
    if (timedRepair.durationSeconds !== duration) throw new Error('定向修复改变了已确定时长，未覆盖原提示词。');
    const repairedContract = normalizeMiniMaxH3DialogueEmissions(cleanGeneratedPrompt(timedRepair.prompt), input.dialogue);
    if (!repairedContract) throw new Error('H3 镜头契约定向修复未返回可用提示词，未覆盖原提示词。');
    rewritten = repairedContract;
  }

  if (task !== 'i2va') {
    const issues = [...h3FormatIssues(rewritten, false), ...auditH3ShotContract({ prompt: rewritten, dialogue: input.dialogue, durationSeconds: duration })];
    if (issues.length) throw new Error(`H3 提示词定向修复未通过：${issues.join('；')}。未覆盖原提示词。`);
    options.onDurationResolved?.(duration);
    return rewritten;
  }

  // Model instructions are not a hard contract. Inspect the generated I2VA
  // result and run one targeted boundary repair only when the inheritability
  // check fails; the helper also has a deterministic composition fallback, so
  // a second model failure cannot leave the user stuck or trigger a loop.
  const repaired = await repairI2vaBoundary(rewritten, {
    duration,
    dialogue: input.dialogue,
    factualContext: input.factualContext,
    quickChat: async (messages, repairOptions) => frameChat ? frameChat(messages) : quickChat(messages, { ...repairOptions, ...options, workspaceScope: 'workshop' }),
  });
  const finalPrompt = stripH3AuthoringNotes(normalizeMiniMaxH3DialogueEmissions(repaired, input.dialogue));
  const issues = [...h3FormatIssues(finalPrompt, false), ...auditH3ShotContract({ prompt: finalPrompt, dialogue: input.dialogue, durationSeconds: duration })];
  if (issues.length) throw new Error(`H3 提示词定向修复未通过：${issues.join('；')}。未覆盖原提示词。`);
  options.onDurationResolved?.(duration);
  return finalPrompt;
}

/** 把风格关键词格式化为 prompt 附加段（兜底用，主路径走 StyleSelector.buildStyleSection） */
export function formatStyleSection(style?: WorkshopData['style']): string {
  const kw = [...(style?.keywords ?? []), style?.customText ?? ''].filter(Boolean).join('，');
  if (!kw) return '';
  return `\n## 风格关键词（所有提示词统一携带）\n${kw}`;
}

/** 第②步：剧本拆解 */
export function buildBreakdownPrompt(
  styleSection = '',
  repairIssues: readonly string[] = [],
  format?: WorkshopCreativeSpec['format'],
  episodeDurationSec?: number,
): string {
  // 未传格式时保持当前多集短剧式拆解行为；界面入口会传入真实作品形式。
  const effectiveFormat: StoryFormat = format ?? 'short-series';
  const isSlowDrama = effectiveFormat === 'slow-drama';
  const densityRule = isSlowDrama
    ? '- **慢剧信息密度**：尊重较慢的叙事呼吸，围绕少量核心事件展开关系、潜台词和细微变化；每个 Scene 仍要产生明确的关系、信息、情绪或行动变化，但不要求每个 Beat 都有反转、爽点或强推进，不用空镜和重复等待拖时长。'
    : '- **分集信息密度规划（不以数量硬验收）**：按每集实际时长和正式剧本内容，把本集拆成连续的“开场钩子→目标/阻力→升级或关系变化→可见行动/反应→转折或阶段性兑现→结尾状态”信息链。每一集都要让观众获得多个可感知的剧情推进，不得把一集压缩成一两个泛泛镜头，也不得用长时间无目的等待、重复走位或空泛表情填时长；但明确需要留白、观察、潜伏或纯动作的段落应保留，不能为凑密度硬塞对白。';
  const dialogueDensityRule = isSlowDrama
    ? '- **慢剧对白**：按人物性格和真实交流速度展开对白，允许停顿、留白、潜台词和听者反应；只有原剧本或明确展开的戏剧需要时才补充台词，不为了提高信息密度强行写入额外对白。'
    : '- **对白密度按剧情自适应**：正式分集剧本已有对白时，优先完整使用同一冲突链中的原文台词，把必要的问答、反问、确认和听者反应放入对应镜头，不得为了省事只保留一句。若同一场景内的短对白能够在一个连续动作链中自然完成，可合并到同一镜头；若对白、动作或人物目标过多导致无法自然表演，则拆成相邻镜头。只有当前集仍只有季纲/规划、且本轮允许把它展开成分集剧本时，才可补写简洁、承载信息的对白：对白必须服务当前目标、阻力或关系变化，不能引入无依据人物、支线或世界观事实，也不改变既定结局。';
  const repairContext = repairIssues.length > 0
    ? `\n【当前界面已检测到的拆解阻塞项】\n${repairIssues.map((issue) => `- ${issue}`).join('\n')}\n- 这些是本轮的优先修复目标。必须结合工具读取到的当前 revision 与已保存结构做最小增量修复；不得忽略后重新生成同一份错误结果。\n- 修复顺序固定：① 先补齐上游缺失结构——若审核记录的 Scene/Beat 数量大于当前保存数量，用一次 workshop_set_breakdown(mode:"merge") 从 currentScriptRevision.content 只补缺失 ID，保留已存在的 Scene/Beat/角色/道具与已通过审核的内容；② 再按第 6 条分批补写缺失的 Atomic Shot；③ 全部写入成功后只做一次状态核验后结束。不要在本轮重跑 Draft Review、四圣经、资产或媒体生成，也不要把同一份不完整结构再提交一次。\n`
    : '';
  return `请对当前工坊项目执行剧本拆解（第②步）：
[工坊任务:breakdown]
对白修复前先区分声音与视觉文字：人物键入、屏幕显示、字幕及书面引文属于 description 中的动作/画面，不是 dialogue。只有原文明确说出口的台词或旁白才写入 dialogue；不得把“苏禾敲下一行字”改成“苏禾：”。工具拒绝时核对表达方式，不通过删改标签反复调用 workshop_restore_shot_dialogue；无口播的镜头保留空对白并继续其他拆解工作。
执行时优先服从程序注入的“正文片段任务”检查点：它包含当前片段原文、真实 ID 和保存进度，不必再读取全量快照。写镜头回传 workUnitId，片段写完才传 workUnitComplete=true；已有镜头覆盖的片段用 workshop_complete_breakdown_unit 登记，禁止重写。每次成功后继续下一个程序任务，直到全部保存，不以一集已有一镜作为完成依据。
${repairContext}

【本次执行边界】
- ${REFERENCE_ASSET_PLANNING_RULES}
- ${CHARACTER_IDENTITY_RULE}
- 本次是执行任务，不是只核对状态。读取完必须继续实际写入；先处理已有完整分集剧本的缺失镜头，再处理尚只有规划的分集。后者优先使用正式剧本正文；若确实只有季纲，则依据既定剧情与创作设置展开分集剧本，用 workshop_set_episode_script 保存后再拆镜，不另起确认回合，不覆盖已有完整剧本或已保存镜头。展开季纲时遵守当前作品形式的节奏规则：多集短剧写成有钩子、升级、兑现和追更点的快节奏连续戏；慢剧保留关系、潜台词、停顿和情绪沉淀，不强行追求爽点或密集反转。无法从现有资料确定的关键剧情事实不得猜测。
- Beat 仅用于组织剧情和追踪来源，不要求固定数量或一 Beat 一镜，缺少映射不拒绝保存。未写完的集数属于任务进度，不是质量验收。四圣经缺失则在本轮补齐一次，然后继续，不只汇报缺失。
- 这是剧本结构与原子镜头规划，不是资产生成。角色、场景、道具记录存在即可参与拆解；assetImagePath、selectedImagePaths、场景图、角色图或其他资产图片尚未生成，都不能阻塞 Atomic Shot。不要调用资产生成、图片、音频或视频工具，也不要要求用户先完成第③步。
- 若程序已提供正文片段任务及真实 ID，直接使用，不再初读；仅缺少上游信息时进行一次 breakdown 初读、一次 prompts 分镜读取；写入结果以工具成功回执为准，不额外复读验收；每次若返回 next_call，必须按 output_id/offset 续读同一快照直到 complete=true，分页续读不计为重复读取。若上下文压缩导致已读页丢失，允许按原 output_id/offset 重读；快照过期则重新获取同一区域并从新快照读取，不能混拼旧页。这些事实恢复读取不受“一次初读”限制。不得在状态无变化时额外读取、重复审核、重复写入同一份 breakdown/bibles/shots，或用相同参数撞击同一个错误。

1. 若程序未提供正文片段任务，首次调用 workshop_get_state({ detail:"step", section:"breakdown" }) 读取拆解状态；如有 next_call，原样调用 workshop_get_state(next_call) 读完所有分页，再核对正文、审核凭据和 Beat；不得把未读完的分页当成正文缺失，也不要要求用户复制数据；不得使用默认 summary，也不得依赖用户当前打开的页面。
   - 若 scriptReview.revisionId === currentScriptRevisionId 且 scriptReview.status === "passed"，直接复用这份审核凭据，禁止再次调用 workshop_set_script_review。
   - 若同一 revision 已是 needs-repair，禁止重复审核或继续拆解；直接汇报已有 scriptReview.issues，等待剧本修订形成新 revision。
   - 仅当当前 revision 没有匹配的审核凭据时才审核一次并调用 workshop_set_script_review。若本次审核为 needs-repair，保存问题后停止；若为 passed，继续本轮拆解。
   - 优先使用 currentScriptRevision.content 作为当前 revision 正文；仅当正文为空且 sourceKind 为 file/link/copywriting 时，才调用 workshop_read_source 读取外部正文。sourceKind 为 idea 时不得调用 workshop_read_source。
2. 读取剧本内容（docx/pdf 用相应 skill 或工具；纯文本直接 read；Idea revision 使用已保存的 content）
   - 当前作品形式与节奏：${effectiveFormat === 'slow-drama' ? '慢剧' : effectiveFormat === 'short-series' ? '多集短剧' : effectiveFormat === 'series' ? '连续剧' : '短片'}
${buildStoryFormatRules(effectiveFormat)}
   - 对白来源：对应集已保存的完整剧本优先，缺少分集正文时核对当前正式剧本正文。已有分镜对白合集不是整部剧本。逐字登记原文属于拆解流程，无需用户重复确认。
   - 对白完整性：逐句建立“原文台词→说话人→目标镜号”的对应关系，保存到 dialogue，写后核对无遗漏、重复和顺序颠倒；不把说话改成沉默。时长不够应在相邻镜头自然分配，台词原文逐字保留。
   ${densityRule}
   ${dialogueDensityRule}
   - ${shotTimingDirectiveZh(episodeDurationSec).replace(/\n/g, '\n     ')}
   - 事实优先：所有人物、事件、人物关系、场景和对白都必须能在剧本源文中找到依据；允许展开季纲时，展开时补写的对白必须先登记在该集正式剧本中，再作为镜头事实使用
   - 选取 3-12 条能覆盖主要人物、关系和事件的原文短句，逐字放入 workshop_set_breakdown.sourceEvidence；不要润色或概括
   - 如果项目已有拆解，本次只是“重新拆解/重新分析”，默认保留既有剧情事实和对白，只补漏、纠错或完善视觉描述
   - 只有用户本轮明确要求改剧本、改剧情、改对白或增删人物时，才允许创作性改写；“优化提示词”绝不等于“改剧本”
3. 深度理解剧本后检查初始状态：只有拆解层缺失、结构不完整或与当前 revision 明确不一致时，才调用 workshop_set_breakdown 写入；已有完整且仍适用的 synopsis、episodes、narrativeBeats、characters、scenes、props 必须直接复用，不要为了重建分镜而重写上游。
   - 若 scriptReview.sceneCount 大于 scenes.length，或 scriptReview.beatCount 大于 narrativeBeats.length，当前拆解就是不完整的，必须从 currentScriptRevision.content 补齐缺失项；不能因数组非空就误判为完整。
   - 全量重建显式传 mode:"replace"；只修复审核点或补齐缺失 ID 时传 mode:"merge"。merge 必须保留未提交的既有 Scene/Beat/角色/道具，不得用局部数组覆盖整表。
   - sourceEvidence：3-12 条剧本原文短句，作为本次拆解的事实收据
   - synopsis：故事梗概（200-500字，讲清主线冲突与结局走向）
   - episodes：分集分场（每集标题 + 场次概览）
   - narrativeBeats：显式写入 Scene 与 Atomic Shot 之间的节拍层；每个 beat 必须有 id、sceneId、title、purpose，必要时附 sourceExcerpt；一个 beat 可以对应多个原子镜头
   - characters：角色档案（id 用英文短名；性格、外形必须是生图可直接使用的具体描述——年龄/身材/发型/服饰/面部特征；形象随剧情变化的角色填 lifecycleStages）
   - scenes：主要场景（环境/光线/氛围，以及普通电脑、家具和常规物件的视觉描述）
   - props：仅主产品及需要跨镜保持身份的核心剧情道具；普通物件留在场景/镜头描述中
${ASSET_SCOPE_RULES}
4. 仅在四圣经缺失或确有对应问题时调用 workshop_set_bibles；已有有效内容直接复用：
   - director：全片镜头、光影、色彩、节奏和禁忌
   - character：角色外观、服装、音色、阶段变化的不可漂移规则
   - scene：场景空间、材质、光源方向、色温和可变边界
   - continuity：跨镜头参考图顺序、服化道、道具、光源、剪辑连续性；blockingContinuity 必须按“幕/场景”建立站位基准：稳定空间锚点、人物相对位置/朝向/距离、180度轴线、出入口，以及只有剧本事件触发时才发生的走位变化
5. 完成或复用 breakdown 后，调用一次 workshop_get_state({ detail:"step", section:"prompts" })，以这里返回的 shots 为准判断实际缺口。不要只看 breakdown 概要猜测分镜是否存在，也不要按资产图片是否存在决定能否拆镜。
${CINEMATIC_EXPRESSION_RULES}

6. 按 Scene → Narrative Beat → Atomic Shot 三层规划，再调用 workshop_set_shots 写入缺失分镜或修复未通过分镜。**长剧本分批写，每批 ≤8 镜；所有程序片段任务和局部修复使用 mode:"merge"，无需清空整表**
   - 【ID 清单预检，强制】写镜前使用程序检查点中的真实资产 ID；只有检查点未提供时才读取 workshop_get_state(breakdown).idManifest。characterIds/sceneId/propIds 只能逐字引用清单里的 ID，禁止按人物名、职业、语义自造（例如把“秦教练”写成 qin_coach）。若剧本里有清单外的真实出场人物，必须先用 workshop_set_breakdown(mode:"merge") 把该角色补入 characters，拿到真实 ID 后再写镜头；不得为了通过校验删掉真实出场人物。
   - entryState.characters / exitState.characters 是自然语言状态，但其中出现的实体人物必须与 characterIds 一一对应；改 characterIds 时必须同步改这两个状态里的角色名/引用，避免两者不一致。
   - Scene 按地点、连续时间和戏剧事件划分；地点变化或明确跳时必须进入新 Scene
   - Narrative Beat 每个只承担一个叙事功能，例如“收到威胁”“尝试开门”“发现异常”；**信息密度要求作用于整集的 Beat 链，而不是要求一个 Beat 塞入多个冲突**。相邻 Beat 若属于同一连续戏剧动作，应通过镜头中的对白、表演和反应把推进落地；不同目标或不可逆转折必须分开。
   - Atomic Shot 一条就是一个可生成镜头，默认使用 shotPlanningMode="single-timeline"：一个镜头内用精确时间段组织前后相继的动作、对白、表情反应和运镜，不要把每个微动作拆成独立镜头，也不要把一集的关键交流拆得过碎导致每镜只有一句话或无信息静止。一个镜头可以承载一轮完整问答、一个动作结果和听者反应；不能自然容纳时再拆镜。
   - 每镜必须先填写 spatialStaging，再填写 narrativeBeat、atomicAction、continuityMode、entryState、exitState 和 soundIntent；spatialStaging 使用 { layers:[{ subject, layer, support, relativeTo? }], viewpoint, relation, dramaticIntent?, cameraMotivation? }，layer 只能取 ground/elevated/aerial/upper-architecture/water-surface/underwater/other。先判断本镜谁在戏剧权力、威胁或情绪上占上风，以及这种关系是否已经体现在空间高度或支撑面上，再决定 upward/downward/level/mixed 观看方向；题材只是判断信号，不能把所有神话场景一律仰拍，平等的同层角色仍应平视。逐个列出同镜有高度或支撑差异的物理主体/群体，写清所在世界层、支撑条件、相对另一主体的上下位置。神话、仙侠、玄幻、神权、天庭军队或超自然权威压向地面人物时，若高处一方在空间和戏剧权力上占优势，主视角优先使用低机位仰拍或低到高构图，让高处力量进入画面上方、地面人物与地形成为下方前景锚点；都市、日常、恋爱、办公和平等对话默认平视，俯拍只在明确的脆弱、被审视或权力压制时才用。镜头升降只是观众视点，不得改变支撑面或让主体跨层；只有本镜动作明确写出落地、起飞、坠落、飞升、攀爬、跳下或从一处支撑面转移到另一处时，才允许改变层级并写出连续路径。两个状态都包含 location、time、characters、props、environment，characters 中明确人物位置、姿态、朝向、视线、服装和持有道具；soundIntent 明确对白、环境声、拟音或音乐
   - 【actionTimeline 创作建议，不阻断保存】每镜必须同时写入结构化 actionTimeline：{ durationSec（必须与本镜 durationSec 一致）, summary, segments:[{ startSec, endSec, track, label, subject? }] }。**分段长度必须按动作真实时值决定，禁止机械等分或一律每 2 秒一段**：根据动作启动、接触、完成、台词重音、停顿和听者反应确定边界，不预设段数或最小间隔；长台词和持续动作允许长段，但写清其内部有意义的变化。**打斗镜头不能只写“出手一次、格挡一次”**：人数或招式允许时，应按“攻击→应对→接触或落空→结果→位置/重心变化→下一次出手”写出连续回合；远程招式命中/被挡后，还要写攻方或守方如何拉近、被震退、换位或反打，避免整个镜头停在一次施法加一次格挡。**同一镜的 segments 必须至少覆盖 body、camera、sound 三条轨道**（sound 轨道承接 soundIntent，写清对白/环境声/拟音/音乐），并按剧情补充 left-hand/right-hand/prop/gaze/emotion。**多人镜头还必须逐人覆盖 characterIds 中的每个实体角色**：每个角色至少有一条时间段把 subject 写成该角色真实 id 或姓名，写清该角色这一时间窗在做什么、视线/情绪如何变化；不能只给主角写 body，也不能用“队员”“众人”等泛称代替具体 subject。时间段必须连续且不超出 durationSec。每个 label 只写这段时间真实发生的动作和形成的状态，不要写禁止式或否定式句子（不再/不得/没有/避免/never/do not/without）：写“起身后压低重心前冲”，不写“不会再次跪地”；写“伏在碑下低吼”，不写“没有扑上去”。以上用于提升创作细节，不作为保存或继续生成的验收门槛。
   - characterIds 只登记本镜物理空间中真实出场、需要使用角色资产的角色。电视、手机、电脑、海报、照片、镜面、回忆或视频画面中的人物属于媒介内容，必须标注其媒介边界，但绝对不能写入本镜 characterIds，也不能作为本镜人物参考图传入
   - 同集相邻镜头默认承接上一镜正式视频尾帧；continuityMode="inherit" 可显式确认，未填写时由程序按相邻同场连续关系自动继承。下一镜 entryState 必须逐项继承上一镜 exitState；scene-cut/time-jump/montage 仅记录剪辑意图，不控制首帧继承；首帧继承只按同集同场景判断
   - 【镜头重点与可见变化】每镜有一个明确视觉重点，并在该镜时长内完成一条完整变化链：起势、行动、接触或推进、结果，以及之后位置、关系或情绪的新状态。时长越长，越要把同一条连续动作链展开成多个有因果关系的节拍；打斗、追逐、法术对抗、情绪递进和关键场面要写足攻防、应对、接触或落空、结果与反打，不要把一条连续动作链拆成多个每镜只有一次的短镜头。开场镜必须直接进入动作、冲突或明确问题，不得只做环境交代或人物摆位；禁止连续两镜只写环境、站位、气氛或蓄势。纯环境或空镜只在转场和必要留白处使用，并且要短。写动作必须写清谁、向哪、以什么方式、产生什么可见结果，不用“对峙”“蓄势”“气氛紧绷”等无可见变化的概括替代动作。
   - 平行动作线、角色替换、多次切场、复杂跳时或无法在时长内自然完成的对白与动作必须拆镜；同一条连续动作链可以保留在一个时间轴镜头中
   - 单次强烈场景变化只有在确实需要视觉转场时才可保留在同一镜，并必须填写完整 transitionPlan（kind/trigger/target/prompt）；转场必须是本镜唯一核心变化
- 每镜在当前景别下应有可读的动作、注意力转移、接触或反应，并明确起始状态与可见结果；固定机位、安静氛围和人物坐着不等于全员静止。建立镜头也要有叙事目的，不能默认写“画面内无人动作”。有意定格、静物或停顿可以保留，但说明其创作目的与时长依据；不能用环境声、眨眼或几厘米运镜冒充剧情推进，也不能提前执行下一镜的推卡、交接等事件。若正式事实确实禁止任何变化且没有合理静止目的，先修正上游事实，不能在最终提示词里偷偷加动作。
- 单镜时间轴上限按模型实际支持时长（H3 为 15 秒）；完整连续动作不要机械拆碎。只有超过该上限、存在并行动作线或多次场景切换时才拆成多个镜头。先按剧情权重分配每段时长，再决定镜头数量：铺垫与过场较短，常规推进与对话中等，高潮、关键揭示和情绪兑现更长。${isSlowDrama ? '慢剧允许更长的连续场景和有意义的停顿，但每个镜头仍要有可读的表演或状态变化。' : '多集短剧根据本集时长、对白长度、动作复杂度和场景变化自适应增减镜头，优先让每个镜头完成“可理解的动作/对白/反应”中的一组闭环，并覆盖本集的结尾状态。'} 不要用固定镜头数或固定对白数衡量信息密度和质量。
- 多集项目如果角色从上一集延续到下一集，必须在分镜完成后调用 workshop_set_character_handoffs，作者明确 inheritedState、intendedChange、target Episode 镜头以及 visualHandoff/identityHandoff；不能让工具自动猜测人物状态或变体

【workshop_set_shots 失败后的唯一修复协议】
- 若工具返回 success:false，本批数据没有保存，但工具已把原始 payload 与逐条错误落盘到当前项目的 breakdown/rejected-shots/。保留刚才提交的原始批次和镜号，逐条读取工具返回的原始 error，只修改 error 明确指出的字段、状态或拆镜问题，然后以相同 mode 重提同一批；不得调用 workshop_get_state 查询错误中的镜号，因为未保存的镜头在状态中必然不存在。
- 若本轮上下文已丢失原始 payload，必须先用 list_project_files/read 读取该项目 breakdown/rejected-shots/ 中最近一份 JSON，基于其中的 shots 做针对性字段修复后重提；禁止凭记忆重新编造整批数据。error 已给出可用的真实角色/场景/Beat ID，直接按清单替换未知 ID即可。
- 失败重试不能重跑 Draft Review 或 workshop_set_bibles，也不能改投下一批。唯一例外：若原始 error 明确以“上游拆解结构不完整”开头，先按错误列出的缺失 ID/数量调用一次 workshop_set_breakdown(mode:"merge") 补齐，再原样重提本批镜头；不得重写已存在且未报错的结构。每批最多进行两次有实质变化的修正重试；若错误文本与上次相同，或无法根据错误形成实质不同的 payload，立即停止并原样汇报该错误，禁止无变化循环。
- 若工具写入成功，再继续下一批；不运行镜头质量验收，不因规划字段不完整而循环修复。

7. 全部目标镜头写入成功后，调用 workshop_set_step_status 把 breakdown 标记为 done，并汇报实际保存镜头数；未写完不得声称全部完成。无需原子镜头验收。

${styleSection}

${WORKSHOP_TOOL_DISCIPLINE}`;
}

/** 第②步前的剧本结构审核：只读检查，不修改剧本、不生成媒体。 */
export function buildScriptReviewPrompt(): string {
  return `请先对当前工坊的剧本做一次只读结构审核，不要调用任何生成图片、音频或视频工具，也不要改写原剧本：

1. 调用 workshop_get_state（detail:"step", section:"breakdown"）读取当前 revision。普通 file/link/copywriting revision 仅在 currentScriptRevision.content 为空时再调用 workshop_read_source 并提取正文；sourceKind 为 idea 时直接审核 currentScriptRevision.content，不要求外部源文件。
2. 按 Scene → Narrative Beat → Atomic Shot 的生产链检查剧本是否可拆：
   - Scene 是否只有一个地点、连续时间和连续戏剧空间；地点切换、跳时、闪回、梦境、平行线是否明确分场。
   - 每个 Beat 是否只推进一个信息、关系、情绪或不可逆动作；是否把“然后/同时/转场后”的多个事件挤在同一节拍。
   - 动作与对白是否能自然落在一个可生成单元：单镜上限按模型实际支持时长（H3 为 15 秒），严格单动作镜头约 4-7 秒；不要把每句对白和每个微动作机械拆镜。同时检查时长分配是否按剧情权重形成长短对比，而不是把总时长平均摊给固定数量的镜头。过长对白、并行动作目标、反复切场或依赖多次转换效果的段落分别列出。
   - 人物、道具、场景和对白是否有原文依据；不要把抽象情绪当作可拍摄动作。
   - 创作质量建议与事实阻塞分开：检查是否无意连续沉默铺垫、听者缺少反应、不同情绪都写成下颌收紧，以及所有镜头重复慢推；明确的无对白、一镜到底或固定机位创作意图不算错误，不设对白比例或切镜数量硬门槛。
3. 调用 workshop_set_script_review 写入审核结果（revision_id 使用 currentScriptRevisionId；passed 时 issues 必须为空）。然后只输出审核报告：剧本版本/来源、估计 Scene 数、Beat 数、明确通过项、阻塞问题、最小修改建议。不要调用 workshop_set_breakdown 或 workshop_set_shots，不要自行补写剧情。

报告结论使用“可进入拆解”或“需要先修订剧本”，并说明判断依据。`;
}

/** 根据 Draft Review 的阻塞项修订当前正式剧本，保留未涉及的故事事实。 */
export function buildScriptRepairPrompt(): string {
  return `请修订当前工坊正式剧本 revision，解决最近一次 Draft Review 的全部阻塞问题。

1. 调用 workshop_get_state（detail:"step", section:"breakdown"），读取 currentScriptRevision、scriptReview、synopsis、episodes、narrativeBeats、characters、scenes 和 props。
2. 仅依据当前 revision 内容和 scriptReview.issues 修订剧本：补齐每个 Scene 的连续地点/时间、进入状态、核心目标、可拍动作和离开状态；把关键交流写成明确对白或可视行动；修正集与集之间的赛程、时间跳跃和状态承接；将混合多个时间段/空间的内容拆成独立 Scene；删除审核指出的未经授权扩写。保留未被问题涉及的人物、主线、冲突和结局事实，不新增无依据人物、支线或剧情。
3. 输出一份完整、可拍摄的修订剧本正文，包含故事核心、逐集剧本、Scene 和 Narrative Beat；不要输出审核解释或镜头提示词。
4. 调用 workshop_record_script_revision，将完整修订正文写入新的正式 revision；不要调用 workshop_set_breakdown、workshop_set_shots 或任何媒体生成工具。
5. 修订保存后停止，并提示用户重新点击“检查剧本结构”完成 Draft Review。`;
}

/** Canonical character-sheet templates shared by workshop and internal Agent flows. */
export const WORKSHOP_CHARACTER_TEMPLATE_ZH = '角色设定板（单张整图，不是拼贴海报）：顶部或左侧为{角色}全身主立绘与正脸大特写；中部为同一角色的正面、侧面、背面全身转面图；下部为发型/脸部特征、服装结构、关键道具的小型细节参考格。所有格子必须是同一个角色、同一年龄阶段、同一体态和同一套服装，{面部特征/表情/神态}，{服饰描述}。使用统一纯色浅灰背景、均匀摄影棚布光和清晰分区，不出现剧情场景、其他人物、对白、标题、水印或可读文字。保持身份、脸型、发型、服装材质、主色和关键道具在所有视角完全一致；这是后续生图和视频的角色一致性母版。{布光色调}。超高细节，电影级角色设定板格式。';
export const WORKSHOP_CHARACTER_TEMPLATE_EN = 'single character bible sheet, clean multi-panel layout, full-body hero pose and large face close-up, full-body turnaround front side back, small detail panels for hair and facial features, clothing construction and key prop, same identity age body proportions outfit and materials in every panel, plain light grey background, even studio lighting, clearly separated panels, no scene, no extra people, no readable text, no title, no watermark, no collage poster, cinematic character reference sheet, high detail';

export function buildCharacterSheetPrompt(
  name: string,
  appearance: string,
  language: 'zh' | 'en' = 'zh',
  options?: { personality?: string; lifecycleStages?: { stage: string; appearance: string }[] },
): string {
  const personality = options?.personality?.trim();
  const lifecycle = options?.lifecycleStages?.filter((stage) => stage.stage.trim() && stage.appearance.trim())
    .map((stage) => `${stage.stage}：${stage.appearance}`)
    .join('；');
  const identityContext = [
    personality ? (language === 'en' ? `personality and presence: ${personality}` : `性格气质：${personality}`) : '',
    lifecycle ? (language === 'en' ? `lifecycle visual variants: ${lifecycle}` : `生命周期造型变化：${lifecycle}`) : '',
  ].filter(Boolean).join(language === 'en' ? ', ' : '；');
  if (language === 'en') {
    return `${WORKSHOP_CHARACTER_TEMPLATE_EN}, character name concept: ${name}, ${appearance}${identityContext ? `, ${identityContext}` : ''}`;
  }
  const prompt = WORKSHOP_CHARACTER_TEMPLATE_ZH
    .replace('{角色}', name)
    .replace('{面部特征/表情/神态}', appearance)
    .replace('{服饰描述}', appearance)
    .replace('{背景/纯色浅灰}', '纯色浅灰')
    .replace('{布光色调}', '柔和顶光，低饱和统一色调');
  return identityContext ? `${prompt} ${identityContext}。` : prompt;
}

/** 第③步：资产提示词 */
export function buildAssetPromptsPrompt(styleSection = ''): string {
  return `请为当前工坊项目已经选定的角色、场景和关键道具编写资产图提示词（第③步）：

${REFERENCE_ASSET_PLANNING_RULES}
本步只为已登记的资产写提示词，不扩增道具目录，不删除已有资产，也不因普通物件出现在剧本中就要求为它生成参考图。

1. 先 workshop_get_state（detail:"step"）查看角色/场景/关键道具档案——**注意每个资产的 assetEngine 字段，引擎决定提示词语言和格式**：
   - 若 bibles 已存在，资产提示词必须继承 director/character/scene/continuity 里的稳定规则

【GPT-Image-2】（默认引擎）→ **中文段落式**，参考结构：
   - **角色 = 角色设定板（固定格式）**：「${WORKSHOP_CHARACTER_TEMPLATE_ZH}」；必须覆盖主立绘、正脸、正/侧/背三视图、脸部/服装/道具细节格，整张图作为后续生图和视频的角色一致性母版
   - 场景 = 无人物空间总览图：主体描述 → **约 45° 斜俯视/高位广角视角（从上方看清房间的完整平面布局、墙面关系、出入口、固定家具和主要空间锚点；必要时使用可见天花开口或剖切式构图，但保持真实透视）** → 布光色调 → 约束（画面无任何人物、文字或水印）。该俯视角只用于建立场景资产的空间母版，不代表后续分镜的实际摄影机机位。

【Midjourney】→ **英文逗号短语式**（subject, pose, lighting, style, quality 渐进排列），不要写 --ar 等后缀参数（比例由 API 参数传递）：
   角色模板：「${WORKSHOP_CHARACTER_TEMPLATE_EN}」

2. 风格统一：全项目同一套画风关键词；中文 prompt 拼中文关键词，英文 prompt 拼英文（导演 DNA 的 prompt_suffix 本身是英文可直接复用）
3. 为每个已选角色/场景/关键道具调用 workshop_set_asset_prompt，**一次同时写入两个版本**：
   - prompt：GPT 中文版（角色必须用上面的角色设定板固定格式；场景=无人物空景概念图）
   - mjPrompt：MJ 英文版（角色=逗号短语式 "single character bible sheet, clean multi-panel layout…"；场景同样英文短语式，必须包含 "empty environment overview, elevated 45-degree oblique top-down wide-angle view, complete room floor plan and spatial layout visible, walls, entrances, fixed furniture and spatial anchors clearly readable, realistic perspective, no people"）
   - 关键道具：中文或英文描述其可辨识形态、材质、比例和重要细节，使用单件清晰展示；不添加剧情场景，不为配件和普通附属物另建图。
   无论该资产当前选的什么引擎，两个版本都要写——用户随时切引擎即用。
4. 完成后向我确认是否立即生成（workshop_generate kind:"asset"，会消耗额度）${styleSection}`;
}

/**
 * 第④步的模板规则。抽成独立函数供两条路径共用，避免一键全流程里只写
 * 「继续遵循当前模板」却不把模板规则本身带下去。
 */
export function shotPromptTemplateRule(template: 'legacy' | 'universal' = 'legacy'): string {
  return template === 'universal'
    ? `当前项目选择【新版】。videoPrompt 必须使用以下段落：
【素材身份】说明每张参考素材的身份和用途；
【空间与初始站位】锁定场景锚点、人物相对位置/朝向/距离和轴线；
【一句话概述】概括本镜可见事件；
【时间戳动作与机位】按时间顺序写动作、表演、运镜、焦点和声音；
【物理与一致性】约束主体、材质、空间关系及起点→路径→终点；
【视觉与声音】统一影调、声音和禁止项。
新版仍须遵守参考图编号、事实锁、分镜板和导演约束卡规则；不再强制套用经典版的“分镜场景设定在/分镜具体动作描述”标题。`
    : '当前项目选择【经典版】。保留“分镜场景设定在/分镜具体动作描述/镜头N-1”标题；若 shotPlanningMode="single-timeline"，镜头N-1 内也必须写完整的 0.0-8.0 秒时间轴，保留同一叙事时间线；若规划已有同场切镜，在摄影轨道中明确切点，不新增剧情段落，也不把已定切镜改成慢推。';
}

/** 第④步：分镜提示词 */
export function buildShotPromptsPrompt(
  styleSection = '',
  template: 'legacy' | 'universal' = 'legacy',
  h3Task?: SglangH3Task,
  episode?: string,
  dialogueShots: readonly Pick<WsShot, 'shotNo' | 'dialogue'>[] = [],
): string {
  const policy = resolveDialoguePolicy(dialogueShots);
  const dialogueBlock = dialoguePolicyDirective(policy);
  const namingBlock = characterNamingDirective();
  if (h3Task) return buildMiniMaxH3ShotPromptsPrompt(styleSection, h3Task, episode, dialogueBlock, namingBlock);
  const templateRule = shotPromptTemplateRule(template);
  return `${episode ? `本次只处理第 ${episode} 集（分镜范围仅限本集，不包含其他分集，本次绝不处理其他分集）。` : ''}请为当前工坊项目${episode ? '' : '的'}所有分镜重新编写生图与视频提示词（第④步）：

【本次操作是用户明确发起的强制重写】
- 即使 prompts 步骤已经是 done、现有提示词非空或旧提示词曾经通过检查，也必须重写${episode ? `第 ${episode} 集` : '当前项目全部分镜'}在当前模板槽位中的 videoPrompt；不得只审核、只修一两镜、沿用旧提示词或回复“已有提示词无需重写”。
${episode ? `- 只处理第 ${episode} 集，不要处理任何其他分集，也不要回复“已有提示词无需重写”。\n- 读取状态时一定要调用 workshop_get_state(detail:"step", section:"prompts", episode:"${episode}")，工具只会返回该集分镜与该集用到的资产；不得省略 episode 参数读取全项目，否则会带回超大且无关的其他分集数据。` : ''}\n- 先用一次 workshop_get_state 获取镜头事实；只有参考签名缺失或过期的镜头才调用 workshop_get_shot_refs。已有合法 actionTimeline 直接复用，不要重复写入或重复读取。提示词按不超过 15 镜一批写入，最后只读取一次确认结果。
- 项目或单镜有效 videoModel 为 MiniMax H3 时，旧提示词只要没有下方八个英文段落标题，就视为旧格式，必须完整重写。

${templateRule}

${miniMaxH3TaskPromptRule(h3Task)}
${h3PromptWritingSkillForTask(h3Task ?? 'fl2va')}

1. 使用前面那一次 workshop_get_state 返回的全量数据，不要再次读取。必须应用 qualityLearning.avoidanceRules 中与当前镜相关的高频规避规则；qualityLearning.highScorePromptExamples 只参考段落结构、信息密度和审核通过方式，不得复制其中的剧情、人物、对白或道具。色卡在 imagePrompt 中按 imageReferenceOrder 引用；videoPrompt 是否引用色卡及其它资产必须服从模型与 h3Task，i2va/fl2va/t2va 不得写任何素材编号，ref2va 每个素材编号只在素材映射段出现一次。
2. 只为缺少或不合法 actionTimeline 的镜头生成时间轴，并通过 workshop_set_shots(mode:"merge") 批量写回；已有时间轴只有通过当前镜头事实对应的可见变化检查（或有明确创作目的的静止检查）才可复用；仅轨道齐全、时长正确不算通过，未检查的旧轴由视频重写服务重新规划。Schema 仍要求 durationSec 与镜头一致、segments 使用 startSec/endSec/track/label/subject、每镜至少 body/camera/sound。时间轴写回后只读取一次确认，随后生成提示词。
   - 本任务只允许用 workshop_set_shots(mode:"merge") 新增或更新 actionTimeline 与配套 durationSec；时长是参考，可为自然对白与反应延长，同步重排全部时间窗。超过当前单镜预算请报告需拆镜，不在提示词步骤擅自重构分镜。不得修改 description、dialogue、角色、场景、道具关系或其他剧本事实
   - 所有画面内对白、VO、旁白必须逐字来自该镜 dialogue；dialogue 没有对应内容就整段不写，禁止为了“更电影化”自行补台词
3. 如果发现某镜需要新增/删除/替换参考图，必须先调用 workshop_update_shot_refs 修改真实资产引用；不要只改提示词文字。注意这只影响 imagePrompt 和确实提交参考素材的 ref2va/其它参考图视频任务，不得把资产引用强塞进 i2va/fl2va/t2va videoPrompt。
4. 调用 workshop_set_prompts 批量写入（每批 ≤15 条）：

   - imagePrompt（中文，gpt-image-2 生分镜图）：本镜首帧画面。按普通资产参考模式生成，只使用场景、人物、道具、色卡和用户明确添加的额外参考图。
     **必须用 @图片N 引用场景和角色参考图**（严格以 workshop_get_state 返回的 imageReferenceOrder 为准；默认只有最终场景资产占用 @图片一；仅用户明确启用多角度参考时，多张场景图才会连续占用 @图片一/@图片二/@图片三…，角色/道具从后续编号开始）。
     必须继承 bibles 中的导演、角色、场景、连续性规则。
     强调「复刻参考图中的人物形象，保持人脸、服饰、体态高度一致」。
     如启用色卡，只在 imagePrompt 最后追加一句「画面配色严格参考 @图片N（色卡），用于统一整体色彩。」；色卡占用真实 @图片N 编号，必须按 imageReferenceOrder 写。正文不要在每个动作短句反复写「画面配色严格参考」或「色调参考色卡」。
     必须写成导演可执行的首帧画面：场景资产只负责校准物体位置和空间坐标，不提供输出视角；首帧必须使用本镜头规定的机位、景别、俯仰、透视和构图。随后写空间锚点 + 主体站位 + 表演瞬间 + 光线色温 + 材质细节 + 画风约束。不要把场景资产的斜俯视/高位广角视角复制到首帧，也不要只写剧情梗概。
     示例：「@图片一 深夜便利店内冷白灯光场景，@图片二 林风站在货架前，复刻参考图中人物形象保持人脸一致。中景，柔和冷色调顶光，电影感构图」

   - videoPrompt：只呈现已经确定的事实和 entryState → exitState，不得新增剧情。根据动作复杂度写动作、对白、反应、摄影和声音。H3 遵守上述事件驱动 skill，不设字数下限或固定时间分段；其他模型的 single-timeline 可沿用精确时间段和 ${budgetLabel(VIDEO_PROMPT_BUDGET['single-timeline'])} 中文字建议。同一镜内的大场景变化应来自已有 transitionPlan。
     必须继承 bibles 中的导演、角色、场景、连续性规则。
     仅在参考签名缺失、过期或用户明确要求刷新资产时调用 workshop_get_shot_refs；已有签名和参考顺序直接复用，并在 workshop_set_prompts 中回传 expectedRefSignature。若当前 H3 task 是 fl2va，videoPrompt 描述首尾帧之间的完整动作与表演，不写 @编号；t2va 同样不写素材编号。ref2va 按 videoReferenceBindings 的真实顺序简短绑定素材一次，不要求 subject_definitions 标题，之后使用稳定语义名称。导演约束卡只继承空间调度意图，不固定人物姿势和坐标。

【两层写作契约】
- 剧情事实层锁定：人物、人物关系、对白、关键动作目标、剧情结果只能来自 sourceExcerpt、description、dialogue 和已关联资产。没有写出的事实不得补。
- 导演表达层开放：机位、运镜、焦点、光影、材质、空间层次、微表演和剪辑节奏继续按电影级标准充分展开。
- 不要为了凑够材质、微表情、运镜和剪辑项目，新增人物、亲属/恋爱/师徒关系、对白、旁白或原分镜没有的剧情事件。

【导演级写作标准：每条 videoPrompt 都必须达到】
- H3 以专用 skill 为准：不套用下文其他模型的中文字数建议、强制多通道表情枚举、特写要求或切镜限制；已明确的摄影与剧情决策仍须保留，表达详略按当前事件需要选择。
- 按导演给 DP、演员、剪辑师下达可拍摄指令的标准写，不要把 description 简单改写成长句。
    - 每条分镜先依据已加载的场景多视角资产确认空间事实，再写地点、光源和人物相对必要锚点的站位/距离/朝向。不要在文字中重新枚举家具与家具、门窗与墙面的固定关系；这些由实际提供的场景图锁定。只有人物发生走位或接触时，才写与动作有关的锚点、起点、可达路径和落点。
- single-timeline 可以描述同一主叙事线中的起势→对白→动作→反应→落点，但必须按时间顺序连续呈现，不能增加并行动作线或角色替换。
- 必须从 entryState 准确开始并在 exitState 收束；人物、服装、道具、环境和空间轴线的变化只能来自 atomicAction。
- 在同一空间轴线内设计完整的运镜与景别层次：写清起幅与收幅景别、机位高度、观察方向，以及推/拉/摇/移/升降/变焦/移焦的幅度与速度。可以同一镜头内组合多种有动机的运动，并在核心动作或情绪落点主动收成一次或多次有动机的表情、手部、动作接触或道具特写，优先通过连续推近、拉远、移焦、遮挡揭示或景别渐变完成，也允许干净切入；禁止正反打、无动机快切、无动机碎切或切到另一地点。完整 transitionPlan 可使用一次匹配剪辑、甩镜、遮挡、闪白、溶解或形态变换，但不能继续二次切换。
- 情绪必须通过可见表演外化：每个时间段至少写出面部与视线（眼睑、眉间、唇线、下颌、注视目标）与呼吸/躯干张力的即时状态，并按动作补充手部与重心细节；情绪转折点可以多通道同时写满，但要用自然语言串成因果，禁止只写“悲伤/愤怒/紧张”，也禁止用机械角度或固定频率把人物写成参数化执行动作。
- ${PERFORMANCE_BRIEF}
- 关键动作优先写三层反馈：动作本身 → 已存在接触材质变化 → 环境响应；没有接触或道具时不要硬造破裂、碎片和新物件。
- 对话镜头要有表演节奏：说话前停顿、听到后的反应、视线回避/逼视、手部小动作；仅在**本镜 dialogue 字段确有台词**时，才把该台词逐字写在对应镜头行的 {} 内。dialogue 为空的镜头禁止生成任何台词。
- 非 H3 的 single-timeline videoPrompt 可参考 ${budgetLabel(VIDEO_PROMPT_BUDGET['single-timeline'])} 中文字；H3 无固定长度目标。imagePrompt 建议 ${budgetLabel(IMAGE_PROMPT_BUDGET)} 中文字。禁止为了凑字数补剧情或增加无动机镜头切换。

${dialogueBlock}

${namingBlock}
- workshop_set_prompts 返回后立即结束本次任务。检查警告只汇报，不要再次调用 workshop_set_prompts、workshop_get_state 或其它修复工具；用户明确要求下一次重写时再处理。禁止任何自动重试或循环。

${MINIMAX_H3_VIDEO_PROMPT_BRIEF}

5. 写入完成后直接汇报；不要调用 workshop_set_step_status 或其它后续工具。${styleSection}`;
}

function buildMiniMaxH3ShotPromptsPrompt(
  styleSection: string,
  task: SglangH3Task,
  episode?: string,
  dialogueBlock = '',
  namingBlock = '',
): string {
  const i2vaBoundaryRule = h3BoundaryCompositionRuleZh(task);
  return `${episode ? `本次只处理第 ${episode} 集的 H3 提示词。` : ''}请为当前工坊项目${episode ? '' : '的'}所有分镜重新编写生图与 MiniMax H3 视频提示词（第④步）：\n\n
【本次操作是用户明确发起的强制重写】
- ${episode ? `只重写第 ${episode} 集的 H3 videoPrompt；不得处理任何其他分集，不得沿用旧提示词、不得输出旧的中文九段式模板。读取状态时一定要调用 workshop_get_state(detail:"step", section:"prompts", episode:"${episode}")，工具只会返回该集分镜与该集用到的资产；不要省略 episode 参数读取全项目，否则会带回超大且无关的其他分集数据。` : '必须重写当前项目全部分镜的 H3 videoPrompt，不得沿用旧提示词，不得输出旧的中文九段式模板。'}
- 使用前面那一次 workshop_get_state 返回的剧本、分镜、角色、场景、道具、bibles、qualityLearning 和当前 h3Task；不要再次调用 workshop_get_state。
- 先用一次 workshop_get_state（detail:"step"）取得全部镜头事实、已有 actionTimeline、参考签名和资产顺序；不要为了单个镜头重复调用 workshop_get_state。仅对缺少或不合法 actionTimeline 的镜头生成符合 workshop_set_shots Schema 的时间轴，并用一次或少量批量 workshop_set_shots(mode:"merge") 写回；已有时间轴只有通过当前镜头事实对应的可见变化检查（或有明确创作目的的静止检查）才可复用；仅轨道齐全、时长正确不算通过，未检查的旧轴由视频重写服务重新规划，不要重复写入或重新读取。Schema 使用 durationSec、summary、segments[{startSec,endSec,track,label,subject}]，track 只允许 body/left-hand/right-hand/prop/gaze/emotion/camera/sound，每镜至少 body、camera、sound；多人镜头还必须为 characterIds 中每个实体角色至少写一条带 subject（真实 id 或姓名）的时间段。
- 仅对参考签名缺失、过期或明确需要刷新引用的镜头调用 workshop_get_shot_refs；不要逐镜重复读取已在 workshop_get_state 中完整返回的参考信息。需要读取时按批次完成，并按真实签名写入 expectedRefSignature。随后通过 workshop_set_prompts 分批写入，每批不超过 15 条；全部写入后只做一次汇总读取确认。
- workshop_get_shot_refs 返回的原生图片必须全部实际查看。若存在两张 scene 图片，它们是同一方形空间从两条不同斜对角机位拍摄的互补视角：视角 A 从前左角看向后右角，视角 B 从前右角看向后左角；不得把 B 当成 A 的反向镜像。必须联合推断唯一空间拓扑并检查人物动作是否能在该空间完成；这两张场景图只用于定位物体和校验空间盲区，绝不能作为首帧或视频的输出机位。图片已经定义的家具、墙面、门窗和固定物之间的位置关系不要在 videoPrompt 里重新逐项描述；只描述人物相对必要锚点的位置、朝向、可达路径，以及声音、表演、道具和摄影机变化。
- 只优化提示词与必要排时，不修改 description、dialogue、人物关系、分镜结构或资产绑定；所有对白、VO、旁白必须逐字来自当前镜 dialogue，没有对白就不要添加。durationSec 与时间窗是参考值：按自然语速、停顿、交接和反应延长或重排，并同步写回。超过当前单镜预算需在拆解阶段拆镜，不得加速或删词硬塞。

${h3PromptWritingSkillForTask(task)}

${h3OfficialOutputContract(task, 5)}

【禁止旧模板污染】
- 基础模式 videoPrompt 固定使用官方三个字段与对应关键帧对齐说明；ref2va 固定使用官方六字段；字段顺序唯一、每个字段非空、镜头正文以 [Shot 1] 开始，无配乐写 N/A。
- 不输出中文九段式、【受控转场】、【连续性与生成约束】或导演约束附录。ref2va 可保留必要的简短参考绑定，基础模式不输出 @图片N 资产清单。
- i2va 中 Picture 1 仅代表运行时提交的 0.00 秒首帧关键帧，不是场景图、角色图、道具图或色卡；不要描述 Picture 2，不要建立资产参考映射。
- 不要用剧情摘要代替发生中的视听事件，也不要靠旧中文约束附录补充执行信息。详略取决于动作复杂度与表达目的，不设字符下限或固定分段间隔；简洁但完整的镜头可以直接保存。

【H3 单镜事实与导演表达】
- 正文遵守当前模式统一字段顺序，以 [Shot 1] 开始，镜内采用自然段与事件时间段；仅实际切镜新增连续 [Shot N]，不追加八个子标题。学习优秀示例的写作逻辑，不复制剧情：身份只交代一次，动作呈现原因、过程和结果，对白连同语气与听者反应，摄影服务信息揭示，风格落实到媒介、材质、光线、动态质感与声音。
- 读取 actionTimeline 的 startSec/endSec 和轨道内容，在真实时间窗内写有意义的变化，合并可同时发生的动作、对白、反应和声音。不机械等分，也不为了填满通道枚举所有身体部位。
- videoPrompt 只写当前镜确定的剧情事实：sourceExcerpt、description、narrativeBeat、atomicAction、actionTimeline、entryState、exitState、transitionPlan、soundIntent 和已绑定资产；逐时段动作、人物表演、手部、道具、视线、情绪、镜头与声音必须忠实展开 actionTimeline，不得新增人物、对白、道具、场景或剧情事件。
- 用官方字段中的详细描述写清初始构图、人物身份、场景锚点、脚下落点、相对距离、面朝方向、视线目标、动作起点/路径/终点、摄影机、焦点、材质反馈、环境声和结束状态。
- 人物可以自然走位、转身、靠近、后退和改变表情；不要把人物冻结在坐标上。若发生普通接触，写清进入可达范围的过程；若原剧情明确有瞬移或闪现，写清特效、消失/现身位置和落点。
- 允许一个服务核心动作的表情、手部、接触或道具特写，但特写前后必须延续同一世界方向、屏幕方向、人物尺度和空间关系，不得无动机换边。${i2vaBoundaryRule ? ` ${i2vaBoundaryRule} 使用内部特写后，结束前必须把画面收回可继承的中景或合适主构图。` : ''}
- H3 videoPrompt 使用英文；只有原始中文对白保留中文，并按官方格式写入 <d>[Chinese] ...</d>。imagePrompt 仍使用中文并按实际图片资产规则使用 @图片N，两者不要混写。
- 时间必须覆盖当前镜完整时长；fl2va 必须从首帧连续抵达尾帧，ref2va 必须只使用实际提交的参考标签，t2va 不得出现任何参考标签。

【首帧/尾帧生图提示词（startFramePrompt / endFramePrompt）——先理解整镜，再派生单帧画面描述】
- 在 workshop_set_prompts 中，每个 H3 镜头都必须同时写 startFramePrompt 与 endFramePrompt 字段（与 imagePrompt、videoPrompt 一并提交），不能只写 videoPrompt。
- 必须先通读本镜已经写好的完整 videoPrompt（尤其是 integrated_multimodal_description、[WORLD_CONTINUITY]、[OBJECT_CONTINUITY]、[ACTION_ENGINE]、[CAMERA_LOGIC] 和 entryState/exitState），完整理解全镜的人物、道具、空间锚点、光线色温、镜头机位与剧情走向，再据此推导首帧与尾帧画面。
- 当 0.00 秒的 entryState 静止信息稀少时，必须依托整镜理解推导出首帧应有的可见内容（环境、人物身份/服饰、道具、光线、构图），而不是因为“0 秒没信息”就留白或只写一句梗概；但只能推导“0.00 秒那一帧”的画面，不得把中段动作、后续人物或结束状态提前画进首帧。
- startFramePrompt 只输出描述 0.00 秒静态首帧画面的中文提示词（供生图模型使用，按 imageReferenceOrder 用 @图片N 引用真实资产）；endFramePrompt 只描述结束时刻的画面。二者都不得原样粘贴 videoPrompt、integrated_multimodal_description、动作时间轴、[ACTION_ENGINE] 或状态账本——那些是视频契约，生图模型读不懂，会直接毁掉单帧画面。
- 首帧必须复用本镜规定的机位、景别、俯仰、透视和构图，不得复刻场景资产的斜俯视/高位广角观察角度；参考图只校准空间、人物身份、服饰与道具外观。

${dialogueBlock}

${namingBlock}

写入完成后不要再次读取状态、不要调用修复工具；直接汇报已写入数量和警告（如有）。只有用户下一次明确要求修复时才重新执行。${styleSection}`;
}

/** 仅重排现有分镜粒度，不重写剧本事实。 */
export function buildAtomicResplitPrompt(
  styleSection = '',
  episodeDurationSec?: number,
  format?: StoryFormat,
): string {
  const allocationRule = shotTimingDirectiveZh(episodeDurationSec) + (format === 'slow-drama'
    ? '慢剧允许更长的连续场景和有意义的停顿，但仍按剧情权重分配时长：铺垫与单一信息点缩短，冲突升级、关键揭示和情绪兑现加长。'
    : '短剧尽早进入行动或关系变化，保留完整交锋与结果。');
  return `[工坊任务:breakdown-resplit]
请把当前工坊已有的分镜按“单镜详细时间轴”重新拆解并重排为更少但完整的可生成镜头。先调用 workshop_get_state（detail:"step"）读取当前正式剧本、Scene、Narrative Beat、已有分镜、角色/场景/道具和四圣经；分页必须读完。

这不是重新写故事，也不是重新生成提示词：必须保留原有 sourceExcerpt、人物、人物关系、对白、场景事实、剧情顺序和结果，只重新决定 WsShot 的生成单元与时长。旧的 breakdown=done 只代表上一版拆解完成，不代表本轮重排完成；本轮必须产生新的完整镜头表并重新标记完成。

重排目标：
- 优先合并同一条连续动作链、同一组问答和听者反应，避免把一句话或一个动作机械拆成多个镜头；只有并行动作线、多次切场、复杂跳时或超出模型时长时才拆分。
- 每个镜头必须有可拍摄的视觉重点和一条完整可见变化链，写清谁、向哪、用什么方式、造成什么结果以及之后位置/关系/情绪的新状态；禁止用“对峙”“蓄势”“气氛紧绷”等无可见变化的概括替代动作。时长越长，越要在同一镜内增加连续节拍，而不是只保留一次动作。
- 一个 Narrative Beat 默认对应一个详细时间轴镜头；镜头内部可以用 body/left-hand/right-hand/prop/gaze/emotion/camera/sound 轨道写清起势、对白、动作、反应和落点。打斗、追逐、法术对抗、情绪递进和关键场面要写足攻防、应对、接触或落空、结果与反打；不要把一个连续动作链机械拆成多个每镜只有一次的短镜头。
- 有承接关系的镜头显式写 continuityMode:"inherit"；未填写时同集相邻同场镜头由程序默认继承。下一镜 entryState 逐项继承上一镜 exitState；scene-cut/time-jump/montage 只记录剪辑意图。
- 每镜必须填写 narrativeBeat、atomicAction、entryState、exitState；两个状态都必须包含 location、time、characters、props、environment，characters 中写清位置、姿态、朝向、视线、服装和持有道具。这些字段只写画面里真实发生的事和已经形成的状态：写“他起身后压低重心前冲”，不写“他不会再次跪地”；写“犬伏在碑下低吼”，不写“没有扑上去”。禁止式、否定式、防错式的句子（不再、不得、没有、避免、never、do not、without）由写作流程自己处理，不要写进事实字段——下游会把它们当画面内容照搬。
- 对白必须逐字保留并放入时间轴对应区间；同一句台词只属于一个说话人的一个时间段，不能同时挂在多个角色或多个镜头上。先按实际语速和模型时长判断能否放进同一镜，不要为凑镜头数机械拆开。
- single-timeline 单镜上限按模型实际支持时长（H3 为 15 秒），严格 atomic 约 4-7 秒，受控转场约 5-8 秒。${allocationRule}

写入协议（防止分批覆盖误删）：
1. 先在读取阶段完成全量重排规划，核对新表是否覆盖所有原剧情、对白、人物和结尾状态。
2. 确认完整后，用一次 workshop_set_shots(mode:"replace", confirmRebuild:true) 提交完整新镜头表，包含所有保留、合并、拆分和重排的镜头。replace 会替换整张表，禁止只提交部分镜头。
3. 严禁先 replace 再 merge，也禁止用多批 merge 代替最终全量表；成功回执必须是本轮新产生的完整镜头表。
4. 写入成功后调用 workshop_set_step_status(step:"breakdown", status:"done") 收尾；不要生成图片、视频或音频。

完成后汇报：原镜头数、新镜头数、减少数量、single-timeline 镜头数、严格 atomic 镜头数、转场镜头数，以及新表如何重新分配长短镜头。${styleSection}`;
}

/** 单条分镜结构化动作时间轴 */
export function buildShotActionTimelinePrompt(shotNo: string, h3Task?: SglangH3Task): string {
  const i2vaBoundaryRule = h3BoundaryCompositionRuleZh(h3Task);
  const cameraBoundaryInstruction = i2vaBoundaryRule
    ? `若既有方案没有明确边界景别，camera 轨道必须补清：开场机位/景别、镜内特写或切点发生的原因与时刻，以及结束前回到可继承中景或合适主构图的收束动作；${i2vaBoundaryRule}`
    : '保留既有开场与结束机位/景别、镜内切点和运镜方案；不得把末尾改写成 i2va 的可继承中景收尾，也不得擅自删改已明确的结束构图。';
  const h3Layer = h3Task
    ? `

【h3-prompt-writing 第一层：动作时间轴】
当前镜头将用于 MiniMax H3 ${h3Task}。时间轴不是提示词正文，必须先作为结构化事实写入，再进入第二层提示词生成。每个时间段要表达真实动作持续区间，不得平均切分，不得照抄示例时长；同时合并 body、双手、prop、gaze、emotion、camera、sound 轨道。`
    : '';
  return `请只为工坊分镜 ${shotNo} 生成结构化动作时间轴，不要生成或修改任何图片提示词、视频提示词、首帧提示词或尾帧提示词。

1. 先调用 workshop_get_state（detail:"step", section:"prompts", shot_no:"${shotNo}"）读取本镜 durationSec、description、dialogue、narrativeBeat、atomicAction、entryState、exitState、camera、soundIntent、人物和道具。
2. 根据上述既有事实生成 actionTimeline，严格使用 workshop_set_shots 的 Schema：{ durationSec, summary, segments: [{ startSec, endSec, track, label, subject? }] }。
3. track 只能是 body、left-hand、right-hand、prop、gaze、emotion、camera、sound。每镜至少包含 body、camera、sound；按实际剧情补充手部、道具、视线和情绪轨道。**多人镜头必须逐人覆盖 characterIds 中的每个实体角色**：每个人都至少有一条带 subject 的时间段，subject 使用真实角色 id 或姓名，写清各自的动作、反应、视线或情绪；不能只写主角，也不能用“众人/队员”等泛称。道具轨道用 subject 标明道具。
3.1 表演与声音不能只写机械动作：为参与互动的人物写清刺激、情绪意图、可见表情和听者反应，已有台词逐句绑定 sound 轨道中的说话人及对应时间窗；dialogue 漏填时先报告原文证据，不将其认定为无对白。没有对白也可以有鲜明情绪，不能统一写成低头、下颌收紧、呼吸变浅。
3.2 摄影轨道保留 camera 中已经规划的景别、机位、运镜或同场切点，并交代信息揭示动机；本任务只拆解既有方案，不擅自增删切点，也不将已有正反打或特写改成一条慢推。${cameraBoundaryInstruction}
4. durationSec 必须与镜头时长完全一致；每段满足 0 <= startSec < endSec <= durationSec。同一轨道可以连续分段，但不得时间矛盾。完整覆盖动作起点、推进和结尾落点。
4.1 【按动作真实时值分段，禁止机械等分】每段长度必须由该动作实际需要多久决定，不得把整镜平均切成等长块，也不得默认每 2 秒一段。不预设段数或最小间隔；根据动作启动、接触、完成、台词重音、停顿和听者反应确定边界。长台词和持续动作允许长段，但写清其内部有意义的变化；说话与听者反应可以重叠，不为细分而切碎语句，不为凑时长拖慢微小动作。时间分段不等于切镜。
5. 时间轴只能拆解已有剧情事实，不得新增人物、对白、道具、动作结果、镜头切换或场景变化。
6. 当前 durationSec 是参考值，按完整对白的自然语速、停顿、话轮交接、必要反应与动作判断时长；不够则延长并同步重排时间窗。超过当前单镜预算时报告需拆镜，不删词、不加速。调用 workshop_set_shots({ mode:"merge", shots:[{ shotNo:"${shotNo}", durationSec, actionTimeline }] })，只写 shotNo、durationSec 和 actionTimeline，禁止传入或修改其他字段。写入后重新读取本镜，确认 Schema 已保存，然后汇报有效时长、时间轴轨道数和时间段数。${h3Layer}`;
}

/** 单条分镜 AI 优化 */
export function buildOptimizeShotPrompt(shotNo: string, h3Task?: SglangH3Task): string {
  const i2vaBoundaryRule = h3BoundaryCompositionRuleZh(h3Task);
  return `请完整重写并补齐工坊分镜 ${shotNo} 的全部适用提示词，而不是只审核或只更新视频：先 workshop_get_state（detail:"step", section:"prompts", shot_no:"${shotNo}"）查看该镜事实，再调用 workshop_get_shot_refs 读取当前引用顺序和 referenceSignature。若用户要求换参考图、删除已引用参考图、加入角色/道具引用，必须先用 workshop_update_shot_refs 更新真实资产引用，再重新读取签名；不要只改提示词文字。
workshop_get_shot_refs 会把引用资产作为原生图片附加返回。必须实际查看全部图片，场景图默认一张即可，已有多图时按同一空间理解，不得因缺少第二视角阻塞；场景图负责固定物体拓扑，提示词不要重新枚举物体与物体的位置关系，只在人物走位或接触需要时描述人物相对相关锚点的位置和可达路径。
仅当本镜 actionTimeline 缺失或不合法，或只是旧版整镜兜底（一个 body 段覆盖全片，再加 camera/sound）时才按 workshop_set_shots Schema 生成并写回；已有可靠时间轴直接复用，不要重复写入或重新读取确认。若 camera 轨道缺少可继承的边界景别，也视为时间轴需要补齐。这里“不合法”明确包含：缺少 body/camera/sound 任一必需轨道，或本镜有多个 characterIds 时没有为每个实体角色写至少一条带 subject（真实角色 id 或姓名）的时间段。多人镜头只写主角一条 body 轨道就是不合法，必须逐人补齐动作、反应、视线或情绪；不得用“队员/众人”等泛称代替 subject。写回时只传 shotNo 和 actionTimeline，不得修改其他字段。时间轴使用 durationSec/summary/segments，segment 使用 startSec/endSec/track/label/subject，至少包含 body、camera、sound，并按剧情补充双手、道具、视线和情绪轨道。
事实锁：本任务只优化提示词，不得修改 description、dialogue 或剧本人物关系。人物、人物关系、对白、关键动作目标和剧情结果只能来自 sourceExcerpt/description/dialogue；所有台词、VO、旁白必须逐字来自该镜 dialogue，没有就不写。电影级细节继续保留并加强：可以丰富机位、运镜、焦点、光影、材质、空间层次、呼吸、视线、手部细节和剪辑节奏，但不能为了凑项目新增人物关系、对白或剧情事件。只有用户明确要求修改剧本或对白时，才先修改分镜事实再重写提示词。
【单镜完整重写与缺项补齐】
- videoPrompt 必须重写，即使原来为空或已完成也不能跳过。
- 读取本镜及相邻上一镜的 episode、sceneId、continuityMode 和已接受视频末帧信息（必要时只补读上一镜）。首镜、跨集或换场景时，需要新的首帧生图提示词；同集同场景必须承接上一镜已采用视频尾帧，不受 continuityMode 影响，尾帧未就绪时等待截取，不改为重新生图；不得把上一场景的站位、布局套进新场景。
- 需要新首帧时，imagePrompt 与 startFramePrompt 必须同时重写并以完全相同的中文静态画面描述提交，缺哪个补哪个；前者显示在高清故事板，后者供首帧生成使用。只写本镜 0 秒的场景、人物、站位、道具、构图和光线，不复制视频时间轴或提前展示结束状态。
- 同集同场且使用已接受视频真实末帧承接时，保留实际首帧，不重新生图；已有生图规划需更新时仍同步两个字段，不为凑齐字段编造新的开场。
- fl2va 需要的 endFramePrompt 必须重写或补齐，只描述本镜结束画面；其他模式已有尾帧规划也同步更新。${i2vaBoundaryRule ? `${i2vaBoundaryRule} ` : ''}存在对白或已有 audioPrompts 时，按原对白及真实角色 ID 重写或补齐适用配音提示词；无对白不新增台词或无意义配音项。
- 一次 workshop_set_prompts 提交本镜所有适用字段及 expectedRefSignature，不得漏掉需要的生图字段、只更新 videoPrompt；不得修改其他镜头，不自动调用生图、视频或配音生成工具。完成后列出重写/补齐项，承接首帧等不适用项说明原因。
imagePrompt：必须继承 bibles，用 @图片N 引用场景和角色参考图；编号严格按 workshop_get_state 的 imageReferenceOrder，默认只使用最终场景资产，只有 imageReferenceOrder 中确实出现多张场景图时才全部写入；强调复刻参考图人物形象保持人脸一致，含景别/构图/光线/画风关键词；如启用色卡，只在最后一句写「画面配色严格参考 @图片N（色卡），用于统一整体色彩」，禁止写 @色卡，也禁止在多个短句反复写色卡/色调。
videoPrompt：先读取项目和本镜 videoPromptTemplate、shotPlanningMode、narrativeBeat、atomicAction、entryState、exitState、transitionPlan 和 h3Task。single-timeline 模式按关键节拍写清动作、台词、连续运镜、角色身份、声音和结尾状态；动作接触、对白转折和情绪落点可细分，普通过渡允许自然插值，不要机械细分到每 0.1 秒。只有本镜 transitionPlan 明确要求镜内转场时才写转场动画；跨集或镜间换场直接从新场景开场，不强加旧场景过渡。提示词可以很详细，但不能新增剧本事实、无关动作、字幕或画面文字。
必须补足电影级表演与镜头调度：空间锚点、人物起止关系、逐段表情（眼睑/眉间/唇线/下颌/呼吸）、视线与注视目标、姿态与重心、手部压力、连续动作节拍、已有材质与光照反馈、环境响应；镜头要有明确运镜与景别层次——在同一空间轴线下写清起幅、机位高度、推/拉/摇/移/升降/变焦的幅度与速度、焦点与景深变化，并在核心动作或情绪落点主动收成一次有动机的表情/手部/动作接触/道具特写。可以丰富表演与镜头表达，但不得扩写剧情。不得新增人物或对白。不得新增道具。不得改变剧情结果。${PERFORMANCE_BRIEF}
三维空间关系：先读取 bibles.continuity.blockingContinuity 和本镜 description，用稳定物体、道具和人物关系明确位移前后的相对位置。普通走位写起点、经过区域、距离变化和终点；剧情明确的瞬移、闪现、缩地、遁光或空间跃迁要保留能力设定，并补足发动特效、消失现身衔接、相对落点、朝向距离和环境反馈。人物可以自然改变位置、姿态、朝向和视线，不要固定坐标或动作。
${MINIMAX_H3_VIDEO_PROMPT_BRIEF}
${miniMaxH3TaskPromptRule(h3Task)}
${h3PromptWritingSkillForTask(h3Task ?? 'fl2va')}
调用 workshop_set_prompts 时必须传 expectedRefSignature。保持与前后镜头的画风、光线、角色形象连贯。完成后简述改了什么。`;
}

/** 仅按当前模型和模板强制重写单镜视频提示词。 */
export function buildRewriteSingleShotVideoPrompt(shotNo: string, h3Task?: SglangH3Task): string {
  const i2vaBoundaryRule = h3BoundaryCompositionRuleZh(h3Task);
  return `请强制重新生成工坊分镜 ${shotNo} 的视频提示词，只处理这一镜：

【本次操作是用户明确发起的单镜强制重写】
- 即使该镜已有 videoPrompt、prompts 步骤是 done、旧提示词通过过检查，也必须按当前最新规则完整重写；不得只审核、沿用旧文本或回复“无需重写”。
- 只允许更新当前模板槽位中的视频提示词：经典版写 videoPrompt，新版写 universalVideoPrompt；不得修改 imagePrompt、audioPrompts、description、dialogue、分镜结构、人物关系、资产绑定或其他镜头。
- 先调用 workshop_get_state（detail:"step", section:"prompts", shot_no:"${shotNo}"）读取本镜 videoModel、videoPromptTemplate、durationSec、narrativeBeat、atomicAction、entryState、exitState、transitionPlan、dialogue、bibles、qualityLearning。必须应用 qualityLearning.avoidanceRules；高分示例只参考结构与细节密度，禁止复制别镜剧情。
- 在写视频提示词前，仅当本镜 actionTimeline 缺失或不合法，或只是旧版整镜兜底（一个 body 段覆盖全片，再加 camera/sound）时才按工具 Schema 生成并写回；已有可靠时间轴直接复用。不合法包含缺少 body/camera/sound 任一必需轨道，以及本镜有多个 characterIds 时漏掉任一实体角色的 subject 覆盖：每个实体角色都必须至少有一条 subject 写成其真实 id 或姓名的时间段，不能用“队员/众人”泛称或只写主角一条。时间轴写回后只重新读取一次确认，随后写提示词。
- 再调用 workshop_get_shot_refs 读取当前真实 videoReferenceBindings、referenceSignature 和素材顺序；不得猜测 @图片N，也不得增删参考素材。
- 只使用 sourceExcerpt、description、dialogue、atomicAction、entryState、exitState、transitionPlan 和已关联资产中的事实，不得新增剧情、人物、对白、道具或场景。
- 非 H3 模型遵守当前项目模板和导演级 single-timeline 规则；有效模型为 MiniMax H3 时，必须完整执行下方 H3 专用契约，按关键节拍写清表演、必要口型、摄影机、物理反馈、声音和动态连续性；普通过渡允许自然插值，不要机械逐项打卡。

${MINIMAX_H3_VIDEO_PROMPT_BRIEF}
${i2vaBoundaryRule ? `${i2vaBoundaryRule}
` : ''}${miniMaxH3TaskPromptRule(h3Task)}
${h3PromptWritingSkillForTask(h3Task ?? 'fl2va')}

完成后调用 workshop_set_prompts，参数只包含当前镜头：{ items: [{ shotNo: "${shotNo}", videoPrompt: "完整重写后的提示词", expectedRefSignature: "刚读取的签名" }] }。工具返回后立即结束；检查警告只汇报，不要再次调用任何工具，禁止自动重试或循环。`;
}

/** Refresh shot reference bindings only; never rewrite prompt prose or generate media. */
export function buildRefreshShotReferencesPrompt(): string {
  return `请刷新当前工坊项目所有分镜的参考资产绑定，不要重写任何提示词，不要生成图片或视频。

${REFERENCE_ASSET_PLANNING_RULES}

对每一镜执行：
1. 读取该镜的 entryState、description、exitState、sceneId、characterIds、propIds、assetPropIds、incidentalObjects、extraRefImages 和现有 referenceSignature。
2. 根据 0.00 秒首帧实际可见内容匹配角色资产、场景资产、道具资产；区分物理空间实体人物与电视/屏幕/照片等媒介画面人物，所有首帧可见人物都可作为生图参考。
3. 根据辨识价值选择本镜真正需要的道具参考，不把普通物件升级成参考图，不自动加入资产库里所有同名物品。保留用户明确指定的参考；只有发现绑定与事实或已选参考需求不一致时，才使用 workshop_update_shot_refs 的 set_character_ids、set_prop_ids 或其它对应字段一次性校正；没有变化的镜头不要写入。
4. 场景多视角按项目现有启用状态保留，不删除有效场景角度。
5. 每次更新后重新调用 workshop_get_shot_refs，校验本机文件存在、referenceSignature 和图片顺序；按真实绑定重排已有提示词中的 @图片N，但不得新增、删改提示词语义。
6. 汇报每个发生变化的镜头及最终参考顺序；没有变化的镜头只报告“已核对，无需更新”。

严格禁止：调用 workshop_set_prompts、改写 imagePrompt/videoPrompt/startFramePrompt/endFramePrompt、修改 description/dialogue/entryState/exitState/actionTimeline、生成或覆盖任何媒体。`;
}

/** 单条分镜 AI 写配音提示词 */
export function buildAudioPromptsPrompt(shotNo: string): string {
  return `请为工坊分镜 ${shotNo} 编写台词配音提示词（audioPrompts）：

1. 先 workshop_get_state（detail:"step"）查看该分镜数据：对白(dialogue)、角色列表(characterIds)、画面描述(description)、情绪(mood)、videoPrompt
2. 根据对白内容，为每个出场角色拆分各自的配音提示词

配音提示词写作规则（Doubao Seed-Audio-1.0）：
- 每个角色一条 audioPrompt，写成可直接交给语音合成模型的完整指令
- 只有本镜 voiceCharacterIds 已显式启用该角色音色时，才在开头写「用@音频N的音色」（N 按本镜已启用音色资产排序）；不要因为角色库有 voicePath 就自动使用
- 如果角色没有音色：开头用自然语言描述声线特征（如「用沙哑中年男声」「用清脆少女声线」），根据角色 personality/appearance 推断
- 台词内容用引号包裹
- 可加表演指令控制语气节奏，如：（压低音量，唏嘘口吻）、（语速放慢）、（前留0.3秒停顿）、（哽咽）、（怒吼）
- 根据分镜 mood 和上下文情绪自动添加合适的表演指令
- 如果对白中该角色没有台词但出场了，可以写呼吸声、叹息等非语言声音，或跳过该角色
- 总配音时长需控制在模型上限内（Seedance 2.0 限 15 秒、2.5 限 30 秒），每条台词建议 2-8 秒

3. 调用 workshop_set_prompts 写入该分镜的 audioPrompts：
   items: [{ shotNo: "${shotNo}", audioPrompts: [{ characterId: "xxx", prompt: "..." }, ...] }]

4. 完成后简述写了什么`;
}

/** 批量 AI 写配音提示词 */
export function buildBatchAudioPromptsPrompt(): string {
  return `请为工坊所有有对白的分镜编写台词配音提示词（audioPrompts）：

1. 先 workshop_get_state（detail:"step"）查看全部分镜数据
2. 筛选有 dialogue（对白）且有 characterIds 的分镜
3. 为每条分镜的每个出场角色编写配音提示词

配音提示词写作规则（Doubao Seed-Audio-1.0）：
- 每个角色一条 audioPrompt，写成可直接交给语音合成模型的完整指令
- 只有本镜 voiceCharacterIds 已显式启用该角色音色时，才在开头写「用@音频N的音色」（N 按本镜已启用音色资产排序）；不要因为角色库有 voicePath 就自动使用
- 如果角色没有音色：用自然语言描述声线特征（根据角色 personality/appearance 推断）
- 台词内容用引号包裹
- 根据分镜 mood 和上下文自动添加表演指令：（压低音量）、（语速放慢）、（哽咽）、（怒吼）等
- 如果对白中该角色没有台词但出场了，可写呼吸声/叹息，或跳过
- 总配音时长需控制在模型上限内（Seedance 2.0 限 15 秒、2.5 限 30 秒）

4. 调用 workshop_set_prompts 批量写入（每批 ≤15 条）：
   items: [{ shotNo: "1", audioPrompts: [...] }, { shotNo: "2", audioPrompts: [...] }, ...]

5. 完成后汇报写了几条分镜的配音提示词`;
}

/** AI 分析角色特征，生成音色描述 */
export function buildVoiceDescPrompt(characterId: string, speaker = 'dylan'): string {
  return `请为工坊角色（id: ${characterId}）生成 Qwen3-TTS-12Hz-1.7B-CustomVoice 的风格指令。
当前基础预设音色为 ${speaker}。CustomVoice 在已有预设上控制说话风格，不是按文字创建任意新声线，也不做声音克隆。
1. 读取角色的 name、personality、appearance 和适用的 lifecycleStages，已有上下文足够时不要重复读取。
2. 根据剧情气质描述语速、咬字、力度、停顿和情绪，正常对话保持自然。避免互相矛盾的声线要求、持续吼叫或强行拖慢语速。不要要求模仿真人或具体配音演员。
3. 输出约 40–100 字的中文风格描述，不包含试听台词、不用“用某声音说：”拼接句式；台词会通过独立 text 字段传入。
只回复风格描述，不调用音频生成工具。`;
}

/**
 * 工坊自动流程的通用执行纪律。
 * 放在每段提示词末尾：小模型对长提示词的尾部指令服从度更高，而中段容易被忽略。
 */
export const WORKSHOP_TOOL_DISCIPLINE = `【执行纪律：先落库，再汇报】
- 本轮必须用 workshop_* 工具把结果写进项目。只在对话里输出文本等于没做，一律视为任务失败。
- 禁止用 bash、project_get_paths、glob_search、grep_search、list_directory、write_file 去探索工程目录或代替工具写入；项目状态只能通过 workshop_get_state 和 workshop_read_source 读取。
- 读取剧本正文是唯一例外：workshop_read_source 只返回源文件的绝对路径，拿到路径后用 read_file 读正文（docx/pdf 走对应解析工具）。每个源文件只读一次，读完立即进入审核与拆解，不要反复读取或扫描目录。
- 工具返回 error 时按提示修正参数后重试；同一个工具连续失败 2 次就停止并如实汇报，不要换别的工具绕路。
- 目标工具写入成功后立即结束本轮，不要重复读取确认，不要自动重试或循环。`;

const AUTO_RUN_PROMPTS_STEP_BODY = `第④步 提示词：
- workshop_set_prompts 为全部分镜写 imagePrompt + videoPrompt；H3 镜头还必须同时写 startFramePrompt 和 endFramePrompt。startFramePrompt 是首帧生图专用提示词：必须先通读本镜完整 videoPrompt（尤其是 integrated_multimodal_description 与 entryState）理解全镜，再基于资产和当前镜头 0.0 秒状态推导首帧画面；当 0.0 秒静止信息稀少时依托整镜理解补足首帧可见的环境、人物、道具、光线与构图，但不得把中段动作、后续人物或结束状态提前画进首帧。有上一镜时必须先描述并继承上一镜尾帧中所有可见资产、人物、位置、道具状态、光线和摄影机状态，再叠加当前镜头 0.0 秒开场状态。startFramePrompt 不得包含完整动作时间轴、未来动作、本镜结束状态，也不得原样粘贴 videoPrompt 或 integrated_multimodal_description。endFramePrompt 必须理解完整 integrated_multimodal_description 的因果后只描述结束时刻，二者都继承本集详细剧本、人物身份尺度、相对场景锚点、朝向、构图和画幅，但不得冻结剧情允许的走位。videoPrompt 必须使用官方 h3-prompt-writing 结构；fl2va/i2va/t2va 不写素材编号，ref2va 才按真实 reference order 使用 <Picture N>。imagePrompt 中文并按 imageReferenceOrder 引用资产；非 H3 视频提示词继续遵循当前模板。${PERFORMANCE_BRIEF}
${MINIMAX_H3_VIDEO_PROMPT_BRIEF}`;

const AUTO_RUN_GENERATE_STEP_BODY = `第⑤步 生成：
- workshop_generate（kind:"image", targets:"missing"）生成分镜图，再 workshop_generate（kind:"video", targets:"missing"）生成视频，等待我确认`;

const AUTO_RUN_REF2VA_GENERATE_BODY = `第⑤步 生成（ref2va）：
- 当前 H3 输入方式是 ref2va（参考素材 + 提示词）。分镜图不是视频生成的前置条件，不能因为缺少 imagePath 就先生成“分镜图”。先核对本镜实际参考素材与 videoPrompt；确认后直接 workshop_generate（kind:"video", targets:"missing"）。不要调用 kind:"image"，不要把分镜图当作 ref2va 的输入。`;

/**
 * 旧版单轮全流程提示词：一次把 ②–⑤ 步压进一条指令。
 * 实测该形态会让模型在读完状态后进入探索循环并停手（读不到拆解写入），
 * 因此应用侧已改用 {@link buildAutoRunSteps} 按步下发；此函数保留给
 * 无队列的脚本化调用（例如 scripts/pipeline-probe）作为对照基线。
 */
export function buildAutoRunPrompt(): string {
  return `请对当前工坊项目执行一键全流程（从拆解到生成）。按顺序完成，每步完成后调用 workshop_set_step_status 标记 done 再进入下一步：

第②步 拆解：${'\n'}- workshop_read_source 读剧本 → workshop_set_breakdown 写梗概/分集/角色/场景 → workshop_set_shots 写分镜表（分批 ≤15 镜）

第③步 资产：
- 为每个角色/场景 workshop_set_asset_prompt 编写提示词（统一画风）
- workshop_generate（kind:"asset"）生成资产图，等待我确认

${AUTO_RUN_PROMPTS_STEP_BODY}

${AUTO_RUN_GENERATE_STEP_BODY}

注意：生成步骤是花钱操作会弹确认；任何一步出错先向我汇报再继续。现在开始第②步。`;
}

export interface WorkshopAutoRunStep {
  id: 'breakdown' | 'assets' | 'prompts' | 'generate';
  label: string;
  prompt: string;
}

function needsAdBriefCreation(data: WorkshopData | undefined, hasSourceFiles = false): boolean {
  if (!data || data.creativeSpec?.workKind !== 'product-ad' || hasSourceFiles) return false;
  const revisions = data.scriptRevisions ?? [];
  const current = revisions.find(revision => revision.id === data.currentScriptRevisionId) ?? revisions[revisions.length - 1];
  return !data.currentScriptRevisionId && !current?.content?.trim();
}

/** Deterministic preflight: do not queue model work with no usable creative input. */
export function validateAutoRunInput(data: WorkshopData, hasSourceFiles: boolean): string | null {
  if (!needsAdBriefCreation(data, hasSourceFiles)) return null;
  if (!data.ideaDraft?.trim()) return '请先填写广告创意 brief，或上传正式剧本，再开始一键全流程。';
  if (!data.creativeSpec?.adSpec?.productName?.trim()) return '请先填写产品 / 品牌，再开始广告创作。';
  return null;
}

export interface AutoRunStepOptions {
  projectData?: WorkshopData;
  hasSourceFiles?: boolean;
  /**
   * 第④步必须知道项目实际选的模板，否则「继续遵循当前模板」这句话对模型没有信息量。
   * 缺省 legacy 与 `buildShotPromptsPrompt` 的默认值一致。
   */
  videoPromptTemplate?: 'legacy' | 'universal';
  /** 项目里真的有 MiniMax H3 镜头时才传；传了才会带上 H3 任务规则。 */
  h3Task?: SglangH3Task;
}

/**
 * 一键全流程的按步下发版本。
 *
 * 每一步都是一条自包含指令，由 WorkshopChatPanel 的串行队列依次执行；
 * 每步开头带前置校验，上一步没有真正落库时本步会停止并汇报，而不是继续往下跑。
 * 拆成多步同时把单轮请求体从「全流程 + 全部提示词契约」降到单步规模，
 * 减少本地模型的 prefill 压力。
 */
export function buildAutoRunSteps(styleSection = '', options: AutoRunStepOptions = {}): WorkshopAutoRunStep[] {
  const inputError = options.projectData ? validateAutoRunInput(options.projectData, Boolean(options.hasSourceFiles)) : null;
  if (inputError) throw new Error(inputError);
  const createAd = needsAdBriefCreation(options.projectData, options.hasSourceFiles);
  const adCreationPrompt = createAd ? `【一键全流程 · 第 1/4 步：广告创作与拆解】
[工坊任务:breakdown]
本轮从用户 brief 完成产品广告调研、方案、正式剧本与分镜落库。由 DSH 根据资料与实际回执自主推进；没有上传剧本不是阻塞原因。
不要生成任何图片或视频。后续资产提示词、分镜提示词和生成仍由原有队列处理，本轮不提前执行。
${buildProductAdPrompt(options.projectData!.ideaDraft!, options.projectData!.creativeSpec!.adSpec!)}

${styleSection}` : '';
  const templateRule = shotPromptTemplateRule(options.videoPromptTemplate ?? 'legacy');
  const h3Rule = options.h3Task ? miniMaxH3TaskPromptRule(options.h3Task) : '';
  const h3Skill = options.h3Task ? h3PromptWritingSkillForTask(options.h3Task) : '';
  return [
    {
      id: 'breakdown',
      label: '② 剧本拆解',
      prompt: adCreationPrompt || `【一键全流程 · 第 1/4 步：剧本拆解】
本步只做第②步拆解。不要写资产提示词、不要写分镜提示词、不要生成任何图片或视频。
前置校验：调用 workshop_get_state 后，若项目没有剧本源文件（sources 为空且没有已导入的剧本正文），立即停止并告诉用户先上传剧本，或先用「用 Idea 生成故事规划」生成结构，不要自行虚构剧本。

${buildBreakdownPrompt(styleSection)}`,
    },
    {
      id: 'assets',
      label: '③ 资产提示词',
      prompt: `【一键全流程 · 第 2/4 步：资产提示词】
本步只写角色/场景/道具的资产图提示词。
前置校验：调用 workshop_get_state 后，若 characters 与 scenes 都为空，说明上一步拆解没有真正落库，立即停止并如实汇报，不要自行补写拆解。
本步不要调用 workshop_generate，也不要询问用户是否立即生成——生成统一由第 4 步处理。

${buildAssetPromptsPrompt(styleSection)}

${WORKSHOP_TOOL_DISCIPLINE}`,
    },
    {
      id: 'prompts',
      label: '④ 分镜提示词',
      prompt: `【一键全流程 · 第 3/4 步：分镜提示词】
本步只为已有分镜编写提示词。
前置校验：调用 workshop_get_state 后，若 shots 为空，立即停止并汇报，不要自行生成分镜结构。
本步不要调用 workshop_generate。

${AUTO_RUN_PROMPTS_STEP_BODY}

${templateRule}
${h3Rule ? `${h3Rule}\n` : ''}
${h3Skill}
${styleSection}
${WORKSHOP_TOOL_DISCIPLINE}`,
    },
    {
      id: 'generate',
      label: '⑤ 生成',
      prompt: `【一键全流程 · 第 4/4 步：生成】
前置校验：调用 workshop_get_state 后，若 shots 为空或提示词为空，立即停止并汇报，不要跳过提示词直接生成。
本步是花钱操作：提交前先用 ask_user_question 向我确认范围，得到确认后再提交。

${options.h3Task === 'ref2va' ? AUTO_RUN_REF2VA_GENERATE_BODY : AUTO_RUN_GENERATE_STEP_BODY}

${WORKSHOP_TOOL_DISCIPLINE}`,
    },
  ];
}
