/**
 * 纯本地结构恢复：从已通过 Draft Review 的剧本正文里解析 Scene / Beat，
 * 补齐当前拆解缺失的 ID，不调用任何模型或工具。
 *
 * 背景：一次失败的 Agent 修复把审核通过的 27 个 Beat 截断成 4 个之后，
 * 写入工具会拒绝任何低于审核数量的结构（这是正确的保护），但模型每次
 * 重写都要重新读状态、重新生成整份结构，很容易超轮次或被门禁拦下。
 * 这里提供一条确定性通道：只解析正文里已经写明的 Scene/Beat 标题与动作，
 * 只补缺口，绝不覆盖已有记录。
 */
import type { WsNarrativeBeat, WsScene } from './types.ts';
import { sortNarrativeBeats } from './breakdownWrite.ts';

export interface ParsedRevisionScene {
  /** 正文里的 Scene 序号（1 起） */
  ordinal: number;
  title: string;
  fields: {
    location?: string;
    time?: string;
    entryState?: string;
    conflict?: string;
    actions?: string;
    exitState?: string;
  };
  /** 该 Scene 所属集号（正文里最近一个“第N集”标题） */
  episode?: string;
}

export interface ParsedRevisionBeat {
  sceneOrdinal: number;
  /** Beat 在 Scene 内的序号，用于生成 scene-NN-beat-MM */
  ordinal: number;
  title: string;
  action: string;
  episode?: string;
}

export interface ParsedRevisionStructure {
  scenes: ParsedRevisionScene[];
  beats: ParsedRevisionBeat[];
}

const SCENE_HEADING = /^Scene\s*(\d+)\s*[:：]\s*(.+?)\s*$/u;
const BEAT_HEADING = /^Beat\s*(\d+)\s*[.．]\s*(\d+)\s*(?:[“"「『]([^”"」』]+)[”"」』])?\s*[:：]?\s*(.*)$/u;
const EPISODE_HEADING = /^第\s*(\d+)\s*集/u;
const SCENE_FIELD_LABELS: ReadonlyArray<readonly [RegExp, keyof ParsedRevisionScene['fields']]> = [
  [/连续地点/u, 'location'],
  [/连续时间/u, 'time'],
  [/进入状态/u, 'entryState'],
  [/核心目标与冲突/u, 'conflict'],
  [/可拍动作/u, 'actions'],
  [/离开状态/u, 'exitState'],
];

function splitSceneFields(body: string): ParsedRevisionScene['fields'] {
  const fields: ParsedRevisionScene['fields'] = {};
  const matches: Array<{ index: number; label: string; key: keyof ParsedRevisionScene['fields']; end: number }> = [];
  for (const [pattern, key] of SCENE_FIELD_LABELS) {
    const match = pattern.exec(body);
    if (!match) continue;
    matches.push({ index: match.index, label: match[0], key, end: match.index + match[0].length });
  }
  matches.sort((a, b) => a.index - b.index);
  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i];
    const next = matches[i + 1];
    const value = body
      .slice(current.end, next ? next.index : body.length)
      .replace(/^[：:]\s*/u, '')
      .trim()
      .replace(/[。；;]\s*$/u, '');
    if (value) fields[current.key] = value;
  }
  return fields;
}

/** 解析剧本正文中的 Scene / Beat 骨架；无法识别的正文返回空结构，交给 Agent 处理。 */
export function parseRevisionStructure(content: string): ParsedRevisionStructure {
  const lines = (content ?? '').split(/\r?\n/u);
  const scenes: ParsedRevisionScene[] = [];
  const beats: ParsedRevisionBeat[] = [];
  let currentEpisode: string | undefined;
  let currentScene: ParsedRevisionScene | null = null;
  let sceneBody: string[] = [];

  const flushScene = () => {
    if (!currentScene) return;
    currentScene.fields = splitSceneFields(sceneBody.join('\n'));
    scenes.push(currentScene);
    currentScene = null;
    sceneBody = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const episodeMatch = EPISODE_HEADING.exec(line);
    if (episodeMatch) {
      flushScene();
      currentEpisode = episodeMatch[1];
      continue;
    }

    const sceneMatch = SCENE_HEADING.exec(line);
    if (sceneMatch) {
      flushScene();
      currentScene = { ordinal: Number(sceneMatch[1]), title: sceneMatch[2].trim(), fields: {}, episode: currentEpisode };
      continue;
    }

    const beatMatch = BEAT_HEADING.exec(line);
    if (beatMatch) {
      const sceneOrdinal = Number(beatMatch[1]);
      const title = (beatMatch[3] ?? '').trim();
      const action = (beatMatch[4] ?? '').trim();
      if (sceneOrdinal === currentScene?.ordinal && (title || action)) {
        beats.push({
          sceneOrdinal,
          ordinal: Number(beatMatch[2]),
          title: title || action.slice(0, 24),
          action: action || title,
          episode: currentEpisode,
        });
      }
      continue;
    }

    if (currentScene) sceneBody.push(line);
  }
  flushScene();
  return { scenes, beats };
}

const IRREVERSIBLE_CUES = [
  '裂开', '摘下', '放下', '摘下护腕', '击破', '夺冠', '晋级', '获胜', '胜利', '击败', '落地',
  '留在', '失去', '死亡', '签署', '摔碎', '撕', '燃烧', '砸', '交出', '让给', '移交',
] as const;
const RELATION_CUES = [
  '冲突', '分歧', '争执', '质问', '对峙', '不服', '信任', '联手', '反驳', '让位',
  '接受', '同意', '条件', '沟通', '回应', '拒绝',
] as const;
const EMOTION_CUES = [
  '沉默', '情绪', '麻木', '颤抖', '喘', '低头', '红了眼眶', '哭', '笑', '怔', '犹豫', '紧绷',
] as const;

/**
 * 从 Beat 标题与动作推断叙事功能。只做保守关键字判断，命中不到就落到“信息”。
 * 判定结果会在界面里标注为“自动推断”，作者可逐条改。
 */
export function inferBeatPurpose(title: string, action: string): string {
  const text = `${title} ${action}`;
  if (IRREVERSIBLE_CUES.some((cue) => text.includes(cue))) return '不可逆动作';
  if (RELATION_CUES.some((cue) => text.includes(cue))) return '关系';
  if (EMOTION_CUES.some((cue) => text.includes(cue))) return '情绪';
  return '信息';
}

export interface StructureRestorePlan {
  newScenes: WsScene[];
  newBeats: WsNarrativeBeat[];
  /** 合并后的完整 Scene 列表（可直接写入 store） */
  nextScenes: WsScene[];
  /** 合并并排序后的完整 Beat 列表（可直接写入 store） */
  nextBeats: WsNarrativeBeat[];
  /** 正文里解析到的 Beat 总数，用于判断解析是否可信 */
  parsedBeatCount: number;
  parsedSceneCount: number;
  /** 已有同标题 Beat 而被跳过的数量（避免同名重复写入） */
  skippedExistingTitles: string[];
}

export interface StructureRestoreInput {
  content: string;
  scenes: WsScene[];
  beats: WsNarrativeBeat[];
  /** 审核记录的期望数量；低于该数量时拒绝生成缺口，避免制造半截结构 */
  expectedSceneCount?: number;
  expectedBeatCount?: number;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function composeSceneDescription(parsed: ParsedRevisionScene): string {
  const { location, time, entryState, conflict, actions, exitState } = parsed.fields;
  const parts = [
    location ? `连续地点：${location}` : '',
    time ? `连续时间：${time}` : '',
    entryState ? `进入状态：${entryState}` : '',
    conflict ? `核心目标与冲突：${conflict}` : '',
    actions ? `可拍动作：${actions}` : '',
    exitState ? `离开状态：${exitState}` : '',
  ].filter(Boolean);
  return parts.join('\n') || parsed.title;
}

/**
 * 只根据正文补齐缺口：已有 Scene / Beat 原样保留，绝不覆盖；同名 Beat 不重复创建。
 */
export function planStructureRestore(input: StructureRestoreInput): StructureRestorePlan {
  const parsed = parseRevisionStructure(input.content);
  const existingSceneIds = new Set(input.scenes.map((scene) => scene.id));
  const existingBeatIds = new Set(input.beats.map((beat) => beat.id));
  const shotsByBeatTitle = new Map<string, string>();
  for (const beat of input.beats) {
    shotsByBeatTitle.set(`${beat.sceneId}::${beat.title.trim()}`, beat.id);
  }

  const sceneIdByOrdinal = new Map<number, string>();
  const newScenes: WsScene[] = [];
  for (const parsedScene of parsed.scenes) {
    const byName = input.scenes.find((scene) => scene.name.trim() === parsedScene.title);
    const byId = input.scenes.find((scene) => scene.id === `scene-${pad2(parsedScene.ordinal)}`);
    const resolved = byName ?? byId;
    if (resolved) {
      sceneIdByOrdinal.set(parsedScene.ordinal, resolved.id);
      continue;
    }
    const candidateId = `scene-${pad2(parsedScene.ordinal)}`;
    if (existingSceneIds.has(candidateId)) continue;
    const scene: WsScene = {
      id: candidateId,
      name: parsedScene.title,
      description: composeSceneDescription(parsedScene),
    };
    existingSceneIds.add(candidateId);
    sceneIdByOrdinal.set(parsedScene.ordinal, candidateId);
    newScenes.push(scene);
  }
  // 已有 Scene 若与正文序号解析不到（例如正文改用 1 起之外的编号），按顺序兜底匹配
  for (const parsedScene of parsed.scenes) {
    if (sceneIdByOrdinal.has(parsedScene.ordinal)) continue;
    const fallback = input.scenes[parsedScene.ordinal - 1];
    if (fallback) sceneIdByOrdinal.set(parsedScene.ordinal, fallback.id);
  }

  const newBeats: WsNarrativeBeat[] = [];
  const skippedExistingTitles: string[] = [];
  for (const parsedBeat of parsed.beats) {
    const sceneId = sceneIdByOrdinal.get(parsedBeat.sceneOrdinal);
    if (!sceneId) continue;
    const beatId = `${sceneId}-beat-${pad2(parsedBeat.ordinal)}`;
    if (existingBeatIds.has(beatId)) continue;
    const sameTitleId = shotsByBeatTitle.get(`${sceneId}::${parsedBeat.title.trim()}`);
    if (sameTitleId) {
      skippedExistingTitles.push(parsedBeat.title);
      continue;
    }
    const beat: WsNarrativeBeat = {
      id: beatId,
      sceneId,
      ...(parsedBeat.episode ? { episode: parsedBeat.episode } : {}),
      title: parsedBeat.title,
      purpose: inferBeatPurpose(parsedBeat.title, parsedBeat.action),
      sourceExcerpt: parsedBeat.action,
      shotNos: [],
    };
    existingBeatIds.add(beatId);
    shotsByBeatTitle.set(`${sceneId}::${beat.title.trim()}`, beatId);
    newBeats.push(beat);
  }

  const nextScenes: WsScene[] = [...input.scenes, ...newScenes];
  const nextBeats = sortNarrativeBeats([...input.beats, ...newBeats], nextScenes.map((scene) => scene.id));
  const empty: StructureRestorePlan = {
    newScenes: [],
    newBeats: [],
    nextScenes: input.scenes,
    nextBeats: input.beats,
    parsedBeatCount: parsed.beats.length,
    parsedSceneCount: parsed.scenes.length,
    skippedExistingTitles,
  };

  const expectedScenes = Math.max(0, input.expectedSceneCount ?? 0);
  const expectedBeats = Math.max(0, input.expectedBeatCount ?? 0);
  if (expectedScenes > 0 && nextScenes.length < expectedScenes) return empty;
  // 正文解析不够完整时，宁可不写，也不要把半截结构交给下游；Scene 补齐本身是安全的，可以单独保留
  if (expectedBeats > 0 && nextBeats.length < expectedBeats) {
    return { ...empty, newScenes, nextScenes };
  }

  return {
    newScenes,
    newBeats,
    nextScenes,
    nextBeats,
    parsedBeatCount: parsed.beats.length,
    parsedSceneCount: parsed.scenes.length,
    skippedExistingTitles,
  };
}
