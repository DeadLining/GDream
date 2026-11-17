import type {
  ProductionBinding,
  ProductionCandidate,
  ProductionReviewReceipt,
} from '@/lib/production/lifecycle';
import type { ProductionRun } from '@/lib/production/run';
import type { QualityReviewReport } from '@/lib/workshop/qualityReview';
import type { QualityLearningState } from '@/lib/workshop/qualityLearning';
import type { AdCreativeSpec, WorkKind } from '@/lib/workshop/adSpec';
import type { AssetStyleReferences } from './stylePack';

/**
 * workshop — 创作工坊数据模型（小云雀/火山剧创式 6 步流水线）。
 *
 * 持久化在 ~/.gdream/aigc-memory/projects/<id>/workshop.json，
 * 复用 lib/aigc/projectStore 的目录与原子写。
 */

export type WorkshopStepId = 'script' | 'breakdown' | 'assets' | 'prompts' | 'generate' | 'handoff';

/** stale = 上游步骤在本步完成后被修改过，提示需要重做 */
export type StepStatus = 'pending' | 'in-progress' | 'done' | 'stale';

export const WORKSHOP_STEPS: { id: WorkshopStepId; label: string; hint: string }[] = [
  { id: 'script', label: '剧本', hint: '上传剧本/文档' },
  { id: 'breakdown', label: '拆解', hint: '梗概·分集分场·角色档案' },
  { id: 'assets', label: '资产', hint: '角色图·场景图（一致性锚定）' },
  { id: 'prompts', label: '提示词', hint: '分镜表 + 生图/视频提示词' },
  { id: 'generate', label: '生成', hint: '逐镜生成 · 可并行 · 可重做' },
  { id: 'handoff', label: '交付', hint: '导入画布 / 剪辑' },
];

/** 资产候选图：生成/上传/产物库/画布回流都 append，永不删除 */
export interface AssetCandidate {
  candidateId?: string;
  path: string;
  /** 文件内容 SHA-256；读取失败时保留候选但不宣称已校验。 */
  checksum?: string;
  source: 'generate' | 'upload' | 'artifact' | 'canvas' | 'external' | 'default';
  engineId?: string;
  prompt?: string;
  /** 生成候选时冻结的提示词、参考素材和运行参数指纹。 */
  inputFingerprint?: string;
  /** 视频候选成功时冻结的完整 Provider 提交包；用于恢复正式视频自身的世系。 */
  productionPacket?: ShotProductionPacket;
  /** 场景迭代标签，如 wide/medium/close/detail，便于多景别资产管理 */
  role?: string;
  /** 跨画布回传的幂等键；同一操作重试时不重复追加版本。 */
  clientToken?: string;
  originNodeId?: string;
  revision?: number;
  createdAt: number;
}

/** 资产候选的正式评审回执；只有 accepted 且指纹仍匹配时才能作为生产资产。 */
export interface AssetReviewReceipt {
  candidatePath: string;
  candidateFingerprint: string;
  verdict: 'accepted' | 'rejected';
  actor: string;
  note?: string;
  reviewedAt: number;
}

/** 当前正式资产绑定，记录采用的是哪一个候选版本。 */
export interface AssetProductionBinding {
  path: string;
  candidateFingerprint: string;
  reviewFingerprint: string;
  boundAt: number;
}

export type WorkshopAssetKind = 'character' | 'scene' | 'prop' | 'colorPalette';

export interface PaletteColor {
  hex: string;
  label: string;
}

export interface WsCharacter {
  id: string;
  name: string;
  personality: string;
  appearance: string;
  /** 全生命周期形象变化（年龄/服饰/面部特征按阶段） */
  lifecycleStages?: { stage: string; appearance: string }[];
  /** 当前选定的最终图（从 candidates 中选） */
  assetImagePath?: string;
  /** GPT 中文提示词（角色必须是三视图组合图格式）；MJ 英文提示词见 assetPromptMj */
  assetPrompt?: string;
  /** MJ 专用英文提示词（字符画短语式，不含 --ar 等后缀） */
  assetPromptMj?: string;
  candidates?: AssetCandidate[];
  assetReviews?: AssetReviewReceipt[];
  assetProductionBinding?: AssetProductionBinding;
  /** 生图引擎偏好：GPT、Seedream 或 Midjourney V8.2/V8.1。 */
  assetEngine?: string;
  /** 生图分辨率偏好：GPT=1k/2k/4k，Seedream=1k/2k */
  assetResolution?: string;
  /** 生图比例偏好 */
  assetAspectRatio?: string;
  /** 角色音色样本文件路径（上传/画布导入的 .mp3/.wav） */
  voicePath?: string;
  /** 音色来源 */
  voiceSource?: 'upload' | 'canvas' | 'tts';
  /** 音色引擎 id（如 minimax-speech） */
  voiceEngineId?: string;
  /** CustomVoice preset used to produce the selected sample. */
  voiceSpeaker?: string;
}

export interface WsScene {
  id: string;
  name: string;
  description: string;
  assetImagePath?: string;
  /** 多角度场景参考组：仅用户明确选择时启用；默认只使用 assetImagePath 这张最终场景资产 */
  selectedImagePaths?: string[];
  sceneReferenceMode?: 'multi';
  /** GPT 中文提示词；MJ 英文提示词见 assetPromptMj */
  assetPrompt?: string;
  assetPromptMj?: string;
  candidates?: AssetCandidate[];
  assetReviews?: AssetReviewReceipt[];
  assetProductionBinding?: AssetProductionBinding;
  assetEngine?: string;
  assetResolution?: string;
  assetAspectRatio?: string;
}

export interface WsProp {
  id: string;
  name: string;
  description: string;
  assetImagePath?: string;
  assetPrompt?: string;
  assetPromptMj?: string;
  candidates?: AssetCandidate[];
  assetReviews?: AssetReviewReceipt[];
  assetProductionBinding?: AssetProductionBinding;
  assetEngine?: string;
  assetResolution?: string;
  assetAspectRatio?: string;
}

export interface WsColorPalette {
  id: string;
  name: string;
  description?: string;
  /** 当前选定的色卡参考图 */
  assetImagePath?: string;
  /** 用于生成「色卡参考图」本身的提示词 */
  assetPrompt?: string;
  /** 用于后续分镜/视频生成时附加的色彩约束提示词 */
  usagePrompt?: string;
  candidates?: AssetCandidate[];
  assetReviews?: AssetReviewReceipt[];
  assetProductionBinding?: AssetProductionBinding;
  assetEngine?: string;
  assetResolution?: string;
  assetAspectRatio?: string;
  colors?: PaletteColor[];
  source?: 'default' | 'upload' | 'canvas' | 'generate' | 'custom';
  createdAt: number;
}

export type ShotGenStatus = 'idle' | 'queued' | 'generating' | 'done' | 'failed';

export type ShotContinuityMode = 'inherit' | 'scene-cut' | 'time-jump' | 'montage';
export type ShotPlanningMode = 'atomic' | 'single-timeline';

export type ShotTimelineTrack = 'body' | 'left-hand' | 'right-hand' | 'prop' | 'gaze' | 'emotion' | 'camera' | 'sound';

export interface ShotTimelineSegment {
  startSec: number;
  endSec: number;
  track: ShotTimelineTrack;
  label: string;
  /** 可选：该段作用于哪个人物或道具，便于多人镜头消歧。 */
  subject?: string;
}

export interface ShotMotionReview {
  version: 1;
  mode: 'visible-change' | 'intentional-hold';
  /** Creative judgment, not proof that the rendered video passed review. */
  reason: string;
  changes: Array<{ segmentLabel: string; visibleStart: string; visibleEnd: string }>;
  /** Set locally after validation; invalidated when shot facts or beats change. */
  basis?: string;
}

export interface ShotActionTimeline {
  durationSec: number;
  summary: string;
  segments: ShotTimelineSegment[];
  motionReview?: ShotMotionReview;
}

export type ShotWorldLayer = 'ground' | 'elevated' | 'aerial' | 'upper-architecture' | 'water-surface' | 'underwater' | 'other';

export interface ShotSpatialStaging {
  /** Each physical subject/group and the world support layer it occupies. */
  layers: Array<{
    subject: string;
    layer: ShotWorldLayer;
    /** Visible support or the reason the subject is airborne/elevated. */
    support: string;
    /** Vertical relation to another named subject/group, e.g. "above the lower subject or ground". */
    relativeTo?: string;
  }>;
  /** How the camera observes the vertical hierarchy, in world-space terms. */
  viewpoint: 'upward' | 'downward' | 'level' | 'mixed';
  /** Human-readable shot intent that preserves height separation and scale. */
  relation: string;
  /** Who holds spatial/dramatic dominance and what the audience should feel. */
  dramaticIntent?: string;
  /** Why this viewpoint serves the scene instead of being chosen from genre alone. */
  cameraMotivation?: string;
}

export type ShotTransitionKind = 'match-cut' | 'whip-pan' | 'occlusion' | 'light-flash' | 'dissolve' | 'morph';

export interface ShotTransitionPlan {
  /** 单个生成镜头内唯一允许的受控场景变化类型。 */
  kind: ShotTransitionKind;
  /** 画面内可见、可执行的转场触发物或动作。 */
  trigger: string;
  /** 转场结束后需要揭示的目标画面。 */
  target: string;
  /** 注入视频模型的导演约束，不得继续发展第二段剧情。 */
  prompt: string;
}

export interface ShotContinuityState {
  /** 剧情世界中的地点与稳定空间锚点，不使用画面左/右代替世界坐标。 */
  location: string;
  /** 连续时间或明确时间点。 */
  time: string;
  /** 人物位置、姿态、朝向、视线、服装和持有道具的合并状态。 */
  characters: string;
  /** 关键道具的持有人、位置、开合/损坏/消耗等状态。 */
  props: string;
  /** 天气、光源、门窗、烟雾、地面、背景活动等环境状态。 */
  environment: string;
}

export interface ShotContinuitySnapshot {
  sceneId?: string;
  framePath?: string;
  cameraSignature?: string;
  spatialAnchorSignature?: string;
  lightingSignature?: string;
  visibleCharacters?: Array<{ id: string; presence: 'physical' | 'screen' | 'reflection' | 'voice-only'; anchor?: string; facing?: string; posture?: string }>;
  props?: Array<{ id: string; state: string; holder?: string; anchor?: string; contact?: string }>;
}

export interface ShotPlanningReview {
  status: 'pass' | 'needs-repair';
  issues: string[];
  reviewedAt: number;
}

export interface DirectorReportCheck {
  status: 'pass' | 'warning' | 'blocked';
  summary: string;
  shotNos: string[];
}

export interface DirectorReport {
  generatedAt: number;
  status: 'pass' | 'needs-review';
  totalShots: number;
  totalDurationSec: number;
  hook: DirectorReportCheck;
  informationProgression: DirectorReportCheck;
  escalation: DirectorReportCheck;
  shotFocus: DirectorReportCheck;
  shotDensity: DirectorReportCheck;
  soundIntent: DirectorReportCheck;
}

/** 一个只承担单一叙事功能、可继续拆成多个原子镜头的中间节拍。 */
export interface WsNarrativeBeat {
  id: string;
  sceneId: string;
  episode?: string;
  title: string;
  purpose: string;
  sourceExcerpt?: string;
  shotNos?: string[];
}

export interface WsCharacterHandoff {
  id: string;
  characterId: string;
  sourceEpisode: string;
  targetEpisode: string;
  inheritedState: string;
  intendedChange: string;
  shotIds: string[];
  visualHandoff?: {
    mode: 'preserve' | 'change';
    sourceVariantId?: string;
    targetVariantId?: string;
    changeReason?: string;
  };
  identityHandoff?: {
    mode: 'preserve' | 'change';
    changeReason?: string;
  };
  createdAt: number;
}

export interface GeneratedAudio {
  characterId: string;
  characterName: string;
  path: string;
  duration: number;
  trimmedPath?: string;
  trimmedDuration?: number;
}

export interface ShotProductionPacket {
  packetVersion: 1;
  projectId: string;
  shotNo: string;
  /** 与持久化 CanvasTask/ProductionRun 的一对一关联。 */
  jobId?: string;
  productionRunId?: string;
  sourceScriptRevisionId?: string;
  model: string;
  engineId: string;
  prompt: string;
  referencePaths: string[];
  referenceLabels: string[];
  referenceSignature?: string;
  audioPaths: string[];
  videoPaths: string[];
  params: Record<string, unknown>;
  continuityMode?: ShotContinuityMode;
  previousTailPath?: string;
  startFramePath?: string;
  endFramePath?: string;
  /** 生成时冻结的镜头事实，供恢复与审计比较。 */
  actionTimeline?: WsShot['actionTimeline'];
  entryState?: WsShot['entryState'];
  exitState?: WsShot['exitState'];
  continuitySnapshot?: WsShot['continuitySnapshot'];
  inputFingerprint: string;
  createdAt: number;
}

/** 配音生成结果先进入候选库，采用后才成为本镜正式配音。 */
export interface AudioCandidate extends GeneratedAudio {
  candidateId: string;
  prompt?: string;
  engineId?: string;
  createdAt: number;
}

export interface AudioReviewReceipt {
  candidateId: string;
  candidateFingerprint: string;
  verdict: 'accepted' | 'rejected';
  actor: string;
  note?: string;
  reviewedAt: number;
}

export interface AudioProductionBinding {
  candidateId: string;
  candidateFingerprint: string;
  reviewFingerprint: string;
  boundAt: number;
}

export interface VideoReviewCriteria {
  continuity?: 'pass' | 'fail' | 'not-reviewed';
  visualIdentity?: 'pass' | 'fail' | 'not-reviewed';
  performance?: 'pass' | 'fail' | 'not-reviewed';
  pacing?: 'pass' | 'fail' | 'not-reviewed';
}

export interface VideoReviewReceipt {
  candidatePath: string;
  candidateFingerprint: string;
  verdict: 'accepted' | 'rejected';
  actor: string;
  note?: string;
  criteria?: VideoReviewCriteria;
  reviewedAt: number;
}

export interface VideoProductionBinding {
  path: string;
  candidateFingerprint: string;
  reviewFingerprint: string;
  boundAt: number;
}

export interface ScriptRevision {
  id: string;
  sourceNames: string[];
  sourceKind: 'file' | 'link' | 'copywriting' | 'manual' | 'idea';
  content?: string;
  fingerprint: string;
  createdAt: number;
}

export interface ScriptReviewReceipt {
  revisionId: string;
  status: 'passed' | 'needs-repair';
  sceneCount: number;
  beatCount: number;
  issues: string[];
  summary?: string;
  reviewedAt: number;
}

export interface StoryboardFrame {
  id: string;
  prompt: string;
  /** 该 prompt 写入时 @图片一/二/三... 对应的真实图片路径快照，用于参考图重排后稳定重编号 */
  refImagePaths?: string[];
  /** 是否在本格生成时追加导演约束卡。默认 false，避免旧项目和普通分镜被隐式改变。 */
  useDirectorConstraintCard?: boolean;
  /** 历史生成候选图。imagePath 是当前选定的最终图。 */
  candidates?: AssetCandidate[];
  panelReviews?: ProductionReviewReceipt[];
  panelProductionBinding?: ProductionBinding;
  imagePath?: string;
  selected?: boolean;
  status?: ShotGenStatus;
  error?: string;
  /** 每次提示词或候选版本写回递增，用于 Agent 冲突检测。 */
  revision?: number;
}

export interface StoryboardBoard {
  id: string;
  frameIds: string[];
  imagePath: string;
  createdAt: number;
  /** false 时仅保存为资产，不参与视频生成参考图传入 */
  useInVideo?: boolean;
  sourceCanvasNodeIds?: string[];
  layout?: string;
  fit?: 'contain' | 'cover';
  clientToken?: string;
}

/** 单镜导演约束卡：空间走位、机位和动作关系的可选参考资产。 */
export interface DirectorConstraintCard {
  id: string;
  imagePath: string;
  /** 生成或人工补充的约束说明，供 Agent 和提示词编排读取。 */
  prompt?: string;
  createdAt: number;
  source?: 'generate' | 'upload' | 'artifact' | 'canvas' | 'external';
  /** true 时作为视频生成参考图传入；默认 false。 */
  useInVideo?: boolean;
  /** 替换/重生成历史，当前 imagePath 仍是唯一生效版本。 */
  candidates?: AssetCandidate[];
}

export interface WsShot {
  /** Managed snapshot of project product identity refs; set by workshopStore, not the model. */
  productReferenceImages?: string[];
  /** 不随镜号、排序或标题修改而变化的内部身份；旧项目打开时自动补齐。 */
  id?: string;
  shotNo: string;
  episode?: string;
  sceneId?: string;
  /** 画面描述 */
  description: string;
  /** 所属叙事节拍：一个 beat 可以拆成多个原子镜头。 */
  narrativeBeat?: string;
  /** 本镜唯一主要动作目标和唯一核心状态变化。 */
  atomicAction?: string;
  /** 本镜世界层级、上下关系与视点方向；在分镜阶段确定，提示词只消费不得重判。 */
  spatialStaging?: ShotSpatialStaging;
  /** 第四阶段提示词生成前的结构化动作时间轴；通过 Schema 后才可作为提示词事实源。 */
  actionTimeline?: ShotActionTimeline;
  /** atomic 保持单一动作；single-timeline 允许在同一生成镜头内按时间轴呈现多个连续节拍。 */
  shotPlanningMode?: ShotPlanningMode;
  /** 与上一镜的连续性关系；inherit 时 entryState 由上一镜 exitState 自动覆盖。 */
  continuityMode?: ShotContinuityMode;
  /** 本镜开始时的剧情世界状态。 */
  entryState?: ShotContinuityState;
  /** 本镜结束时的剧情世界状态，供下一镜继承。 */
  exitState?: ShotContinuityState;
  /** 可选的单次受控转场；普通动作承接不得启用。 */
  transitionPlan?: ShotTransitionPlan;
  /** 最近一次原子镜头 Reviewer 结果。 */
  planningReview?: ShotPlanningReview;
  /** 该镜对应的剧本原文证据。用于事实锁，禁止提示词凭空补剧情。 */
  sourceExcerpt?: string;
  /** 生成该镜头时所绑定的剧本 revision，剧本换版后必须重新拆解/审核。 */
  sourceScriptRevisionId?: string;
  /** 对白 */
  dialogue?: string;
  /** 景别 */
  shotType?: string;
  /** 运镜 */
  camera?: string;
  /** 情绪 */
  mood?: string;
  /** 本镜声音意图：对白、环境声、拟音或音乐，供剧本和视频提示词共同继承。 */
  soundIntent?: string;
  /** 按剧情权重分配的镜头时长；单时间轴镜头不超过 shotTimingPolicy 的 SINGLE_TIMELINE_MAX_SEC。 */
  durationSec?: number;
  characterIds: string[];
  physicalCharacterIds?: string[];
  visibleCharacterIds?: string[];
  screenCharacterIds?: string[];
  propIds?: string[];
  /** Explicit visual-reference subset; [] disables separate prop pictures. */
  assetPropIds?: string[];
  /** Ordinary objects preserved as text, not individual reference assets. */
  incidentalObjects?: string[];
  continuitySnapshot?: ShotContinuitySnapshot;
  /** 单镜场景参考图覆盖；undefined=跟随场景参考组，[]=本镜不传场景参考 */
  sceneImagePaths?: string[];
  /** 场景参考图发生人工调整后，提示用户重新生成提示词以同步 @图片 顺序 */
  promptNeedsRefresh?: boolean;
  /** 最近一次确认的参考资产顺序版本。旧项目为空时按 0 处理。 */
  referenceRevision?: number;
  /** 额外参考图（手动添加的上传/产物库图，独立于场景/角色/道具资产） */
  extraRefImages?: string[];
    /** 单镜演出版本号，用于生产审计和并发写入冲突检测。 */
  shotRevision?: number;
  /** 视频生成比例（如 "16:9"），生成视频时必填 */
  videoRatio?: string;
  /** 单镜视频模型覆盖；undefined = 跟随全局 */
  videoModel?: string;
  /** 单镜视频提示词模板覆盖；undefined = 跟随项目全局 */
  videoPromptTemplate?: 'legacy' | 'universal';
  imagePrompt?: string;
  /** Seedance 视频提示词：遵守 aigc-memory/prompt-templates/seedance/README.md */
  videoPrompt?: string;
  /** Seedance 2.5 专用提示词。与普通视频提示词分开保存，切换模型时互不覆盖。 */
  seedance25VideoPrompt?: string;
  /** 新版提示词。保留 videoPrompt 的经典版，切换时互不覆盖。 */
  universalVideoPrompt?: string;
  h3VideoPromptTask?: import('../canvasGen/sglangH3').SglangH3Task;
  h3VideoPromptModeStale?: boolean;
  /** Actionable failure retained for the next user-triggered prompt rewrite. */
  promptRewriteDiagnostic?: import('./promptRewriteDiagnostic').PromptRewriteDiagnostic;
  /** 高清故事板：8 张独立电影分镜图提示词和生成结果 */
  storyboardFrames?: StoryboardFrame[];
  /** 高清故事板拼合资产：通常每 4 张拼成 1 张 2x2 分镜板 */
  storyboardBoards?: StoryboardBoard[];
  /** 可选导演约束卡，不参与普通生图；由单格或视频开关显式启用。 */
  directorConstraintCard?: DirectorConstraintCard;
  /** 单镜色卡覆盖；为空时使用全局色卡 */
  colorPaletteId?: string;
  /** 本镜显式启用的角色音色资产。只有这里列出的角色 voicePath 才会作为视频音频参考传入。 */
  voiceCharacterIds?: string[];
  imagePath?: string;
  /** MiniMax H3 视频生成的当前镜头首帧锚点。已有文件会复用，避免重试重复付费生图。 */
  videoStartFramePath?: string;
  /** 单镜显式选择：允许把上一镜已采用尾帧锁定为本镜 0.00 秒首帧（Ref2VA 中仍作为普通参考提交）。 */
  usePreviousTailAsFirstFrame?: boolean;
  /** Auto-bound accepted previous video's actual tail; explicit replacement paths take precedence. */
  videoStartFrameInheritance?: { shotNo: string; videoPath: string; framePath: string };
  /** Accepted-video tail capture provenance, separate from a planned/generated end image. */
  acceptedVideoTail?: { videoPath: string; framePath?: string; extractionId: string };
  /** 最近一次实际提交给生图模型的首帧完整提示词，供审计和界面查看。 */
  videoStartFramePrompt?: string;
  /** 第④步根据本集剧本、当前镜头和 H3 时间线预写的首帧画面提示词。 */
  plannedStartFramePrompt?: string;
  /** 最近一次首帧生图真正提交的有序参考图路径和标签。 */
  videoStartFrameReferencePaths?: string[];
  videoStartFrameReferenceLabels?: string[];
  /** MiniMax H3 视频生成的当前镜头尾帧锚点，同时供下一镜做连续性参考。 */
  videoEndFramePath?: string;
  /** 最近一次实际提交给生图模型的尾帧完整提示词，包含当次最小修复补丁。 */
  videoEndFramePrompt?: string;
  /** 第④步根据完整镜头因果和结束状态预写的尾帧画面提示词。 */
  plannedEndFramePrompt?: string;
  /** 最近一次尾帧生图真正提交的有序参考图路径和标签。 */
  videoEndFrameReferencePaths?: string[];
  videoEndFrameReferenceLabels?: string[];
  /** 首尾帧对应的提示词、资产和上一镜尾帧签名；变化时自动判旧并重新生成。 */
  videoBoundaryFrameSignature?: string;
  /** 最近一次首尾帧多模态审核结果；签名不一致时视为失效。 */
  boundaryFrameQualityReview?: QualityReviewReport;
  boundaryFrameQualityReviewSignature?: string;
  /** 历次图片/视频审核结果，保留用于缺陷归类和提示词规则沉淀。 */
  qualityReviewHistory?: QualityReviewReport[];
  /** 最近一次视频成片多模态终审。 */
  videoQualityReview?: QualityReviewReport;
  /** 首尾帧连续三次未通过时置为 true，要求人工复盘脚本、资产或空间设定。 */
  qualityReviewRequiresManualReview?: boolean;
  /** 最近一次真正提交给 Provider 的完整镜头输入包。 */
  lastProductionPacket?: ShotProductionPacket;
  videoPath?: string;
  /** 视频生成结果候选；Provider 成功后先入候选，用户采用后才写入 videoPath。 */
  videoCandidates?: AssetCandidate[];
  /** 用户明确删除过的候选产物路径；阻止已完成后台任务在恢复扫描时把它重新补回。 */
  deletedVideoCandidatePaths?: string[];
  /** 用户明确删除过的候选稳定 ID；防止同一后台任务换用供应商路径后重新恢复。 */
  deletedVideoCandidateIds?: string[];
  /** 用户明确删除过的画布来源节点；防止旧节点下次同步时换名回流。 */
  deletedVideoCandidateNodeIds?: string[];
  /** 视频候选的正式评审回执。 */
  videoReviews?: VideoReviewReceipt[];
  /** 当前正式视频的生产绑定，证明它来自已接受候选。 */
  videoProductionBinding?: VideoProductionBinding;
  /** 视频封面缩略图。它只用于生成页/列表展示，不作为视频参考资产传入。 */
  videoThumbPath?: string;
  genStatus?: ShotGenStatus;
  genError?: string;
  /** 首帧/尾帧/视频三阶段流水线的人类可读进度。 */
  genProgress?: string;
  /** 进行中任务 ID（取消用） */
  genTaskId?: string;
  /** 生成代次；镜头输入变化后递增，旧异步任务不得回填新输入。 */
  generationToken?: string;
  /** 同步到画布后对应的视频节点 ID */
  canvasNodeId?: string;
  /** 每个角色的台词配音提示词 */
  audioPrompts?: { characterId: string; prompt: string }[];
  /** 生成的配音文件 */
  generatedAudios?: GeneratedAudio[];
  /** 配音候选历史；Provider 成功只写入这里。 */
  audioCandidates?: AudioCandidate[];
  /** 配音候选的正式评审回执。 */
  audioReviews?: AudioReviewReceipt[];
  /** 当前正式配音的生产绑定。 */
  audioProductionBinding?: AudioProductionBinding;
  /** 配音是否已注入到 videoPrompt 的资产中 */
  audioInjected?: boolean;
}

export interface WorkshopStepState {
  status: StepStatus;
  updatedAt: number;
}

export interface WorkshopProjectBibles {
  /** 导演圣经：全片统一的镜头、光影、色彩、节奏和禁忌 */
  director?: {
    styleIntent: string;
    cameraRules: string[];
    lightingRules: string[];
    colorRules: string[];
    pacingRules: string[];
    forbidden: string[];
    updatedAt: number;
  };
  /** 角色圣经：角色不可漂移的外观、服装、声音、变化阶段 */
  character?: {
    rules: Array<{
      characterId: string;
      lockedAppearance: string;
      costumeRules: string[];
      voiceRules?: string;
      lifecycleRules?: string[];
    }>;
    globalRules: string[];
    updatedAt: number;
  };
  /** 场景圣经：空间、材质、光源方向、色温和可变边界 */
  scene?: {
    rules: Array<{
      sceneId: string;
      spatialLayout: string;
      lighting: string;
      palette: string;
      textureRules: string[];
    }>;
    globalRules: string[];
    updatedAt: number;
  };
  /** 连续性圣经：跨镜头必须保持一致的资产顺序、服化道、空间方向、光源和禁改项 */
  continuity?: {
    lockedItems: string[];
    /** Per act/scene world-space blocking baselines and explicit transition rules. */
    blockingContinuity?: Array<string | {
      scene?: string;
      anchor?: string;
      axis?: string;
      exits?: string;
      state?: string;
    }>;
    referenceOrderRules: string[];
    costumeContinuity: string[];
    propContinuity: string[];
    lightingContinuity: string[];
    editContinuity: string[];
    updatedAt: number;
  };
}

export interface WorkshopData {
  /** Project-scoped H3 mode shared by prompt writing and generation. */
  h3InputMode?: import('../canvasGen/sglangH3').SglangH3Task;
  /** 用户原始创意 / 广告 brief，独立于模型产出，按项目持久化。 */
  ideaDraft?: string;
  /** 可恢复的正文片段执行记录；非镜头质量验收。 */
  breakdownWork?: import('./breakdownQueue').BreakdownWorkLedger;
  projectId: string;
  currentStep: WorkshopStepId;
  steps: Record<WorkshopStepId, WorkshopStepState>;
  /** 故事梗概 */
  synopsis: string;
  /** 首次拆解时从源剧本逐字摘录的事实证据，用于阻止模型凭概括另写剧情。 */
  breakdownSourceEvidence?: string[];
  /** 驱动拆解的剧本版本快照；当前版本只允许作为正式生产输入。 */
  scriptRevisions?: ScriptRevision[];
  currentScriptRevisionId?: string;
  /** 当前剧本 revision 的 Draft Review 凭据；换版后必须重新审核。 */
  scriptReview?: ScriptReviewReceipt;
  /** Idea/小说进入剧本开发前的创作规模；字段为空时使用产品默认值。 */
  creativeSpec?: WorkshopCreativeSpec;
  /** 分集季纲与逐集详细剧本。 */
  episodes: WorkshopEpisode[];
  /** Scene 与 Atomic Shot 之间的显式叙事节拍层。 */
  narrativeBeats?: WsNarrativeBeat[];
  /** 跨集人物状态、造型变体和身份变化的作者确认记录。 */
  characterHandoffs?: WsCharacterHandoff[];
  /** 最近一次基于当前原子镜头集合生成的导演结构报告。 */
  directorReport?: DirectorReport;
  characters: WsCharacter[];
  /** Historical duplicate IDs resolve to one canonical role; retained for later AI writes. */
  characterIdAliases?: Record<string, string>;
  scenes: WsScene[];
  props: WsProp[];
  colorPalettes: WsColorPalette[];
  /** 一键用于所有画面的全局色卡；单镜 colorPaletteId 可覆盖 */
  globalColorPaletteId?: string;
  shots: WsShot[];
  /** 项目级 durable production run；每个提交任务通过 jobId 一对一关联。 */
  productionRuns?: ProductionRun[];
  /** 多模态审核持续沉淀的高分提示词与问题规避规则。 */
  qualityLearning?: QualityLearningState;
  renderCandidates?: ProductionCandidate[];
  renderReviews?: ProductionReviewReceipt[];
  renderProductionBinding?: ProductionBinding;
  style?: {
    keywords: string[];
    directorRef?: string;
    customText?: string;
    styleLibraryRef?: string;
    styleLibraryPrompt?: string;
    /** Per-asset visual style reference packs selected with the style. */
    assetStyleReferences?: AssetStyleReferences;
    library?: 'general' | 'midjourney';
    midjourneyStyleId?: string;
    midjourneyVersion?: string;
    midjourneyStylize?: number;
    midjourneyChaos?: number;
    midjourneyRaw?: boolean;
    midjourneyStyleWeight?: number;
    midjourneyImageWeight?: number;
    midjourneyWeird?: number;
  };
  /** 项目级导演/角色/场景/连续性圣经，后续拆解、提示词和生成必须继承 */
  bibles?: WorkshopProjectBibles;
  /** 全局视频比例（各分镜可单独覆盖） */
  videoRatio?: string;
  /** 全局视频模型：'seedance-2.0' | 'seedance-2.0-mini' | 'minimax-h3'，默认 'seedance-2.0' */
  videoModel?: string;
  /** 全局视频提示词模板；默认 legacy，分镜可单独覆盖。 */
  videoPromptTemplate?: 'legacy' | 'universal';
  /** 关联的画布项目（Adobe 式统一项目） */
  canvasProjectId?: string;
  /** 修改记录 */
  changelog: { at: number; step: WorkshopStepId; summary: string }[];
}

export interface WorkshopCreativeSpec {
  /**
   * 作品大类。短剧走故事链路；产品广告走传播策略链路（adSpec）。
   * 缺省视为 'drama'，保证旧项目不受影响。
   */
  workKind?: WorkKind;
  /** 仅 workKind === 'product-ad' 时使用；与短剧字段正交，互不污染。 */
  adSpec?: AdCreativeSpec;
  format: 'short-film' | 'short-series' | 'slow-drama' | 'series';
  episodeCount: number;
  episodeDurationSec: number;
  detailLevel: 'outline' | 'standard' | 'detailed';
  expansionPolicy: 'conservative' | 'balanced' | 'free';
  allowNewCharacters: boolean;
  allowSubplots: boolean;
  allowNewConflicts: boolean;
  /** Short-drama development preferences; optional for older projects. */
  genre?: string;
  audience?: string;
  tone?: string;
  endingType?: string;
  outputLanguage?: 'zh-CN' | 'en-US';
}

export interface WorkshopEpisode {
  no: string;
  title: string;
  sceneList: string;
  sourceScope?: string;
  synopsis?: string;
  openingState?: string;
  centralConflict?: string;
  climax?: string;
  cliffhanger?: string;
  endingState?: string;
  script?: string;
  scriptStatus?: 'planned' | 'draft' | 'frozen';
  characterAssetNotes?: string;
}

export function emptyWorkshopData(projectId: string): WorkshopData {
  const now = Date.now();
  const steps = {} as Record<WorkshopStepId, WorkshopStepState>;
  for (const s of WORKSHOP_STEPS) steps[s.id] = { status: 'pending', updatedAt: now };
  return {
    projectId,
    currentStep: 'script',
    steps,
    synopsis: '',
    scriptRevisions: [],
    episodes: [],
    narrativeBeats: [],
    characters: [],
    scenes: [],
    props: [],
    colorPalettes: [],
    shots: [],
    changelog: [],
  };
}

/** 步骤顺序索引，用于 invalidateDownstream */
export const STEP_ORDER: WorkshopStepId[] = WORKSHOP_STEPS.map((s) => s.id);
