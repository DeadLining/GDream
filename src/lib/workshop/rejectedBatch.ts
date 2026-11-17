/**
 * rejectedBatch — 失败分镜批次的读取与定向修复 prompt 构造。
 *
 * 背景：workshop_set_shots 是整批事务，任何一条 warning 都会让整批不落盘。
 * 工具会把失败批次写入 <项目>/breakdown/rejected-shots/*.json。这里提供：
 * - 解析落盘文件（不信任未知结构，逐字段校验）；
 * - 把原始 shots + 逐条错误构造成“只改错字段、原样重提同一批”的修复 prompt。
 *
 * 纯函数，便于单测；文件 IO 由调用方通过 projectStore 完成。
 */
import type { WsShot } from './types.ts';

export interface RejectedShotBatch {
  savedAt: string;
  mode: string;
  shotNos: string;
  error: string;
  shots: Array<Partial<WsShot>>;
}

/** 只接受结构完整的落盘文件；损坏或缺字段时返回 null，避免把脏数据喂给模型。 */
export function parseRejectedShotBatch(raw: string | null | undefined): RejectedShotBatch | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.shots) || record.shots.length === 0) return null;
  const shots = record.shots.filter(
    (shot): shot is Partial<WsShot> => Boolean(shot) && typeof shot === 'object' && !Array.isArray(shot),
  );
  if (shots.length === 0) return null;
  return {
    savedAt: typeof record.savedAt === 'string' ? record.savedAt : '',
    mode: typeof record.mode === 'string' ? record.mode : 'merge',
    shotNos: typeof record.shotNos === 'string' ? record.shotNos : '',
    error: typeof record.error === 'string' ? record.error : '',
    shots,
  };
}

/** 面板用的简短镜号摘要。 */
export function summarizeRejectedBatch(batch: RejectedShotBatch): string {
  const count = batch.shots.length;
  const nos = batch.shotNos.trim() || batch.shots
    .map((shot) => shot.shotNo)
    .filter((shotNo): shotNo is string => typeof shotNo === 'string' && shotNo.trim().length > 0)
    .join(',');
  return `${count} 镜${nos ? `（${nos}）` : ''}`;
}

/**
 * 构造定向修复 prompt：把失败批次的原始 shots 与工具逐条 error 原样带回，
 * 要求模型只改 error 指出的字段后，用相同 mode 重提同一批，禁止重造整批。
 */
export function buildRejectedBatchRepairPrompt(batch: RejectedShotBatch): string {
  return `请修复一批未写入的 Atomic Shot（第②步拆解）。

这批分镜上一次提交整批失败、尚未保存，工具已把原始 payload 与逐条错误落盘。下面是原始数据与错误原文，请**在此基础上做最小字段修复后重提同一批**：

【上一次工具返回的原始错误】
${batch.error || '（错误缺失，请以工作流规则重新校验）'}

【上一次提交的 mode】
${batch.mode}

【上一次提交的原始 shots（JSON）】
${JSON.stringify(batch.shots, null, 2)}

【操作对象与工具边界】
这里的 shots 是失败请求的原始数据，不是已经存在于分镜表的记录。修复只在这份 JSON 上完成，再由 workshop_set_shots 创建/合并落库。
- 尚未写入的镜号查不到是预期状态，不是资产丢失；禁止为这些待提交镜号调用 workshop_get_shot_refs、workshop_update_shot、workshop_update_shot_refs 或 workshop_set_prompts。
- 不生成参考图、首尾帧、视频、音频；不需要任何媒体才能写入 Atomic Shot。
- 如果误查镜号返回“不在已保存分镜表”，回到本文原始 shots 修正并重提，不要求用户手动创建镜头，也不重复查询。

【本轮唯一修复协议】
1. 先调用一次 workshop_get_state({ detail:"step", section:"breakdown" })，读取 idManifest（characters/scenes/props 的真实 ID）与 narrativeBeats；如有 next_call，按游标读完同一快照。剧情与对白以当前正式剧本为准，不能把资产 ID 清单当作完整剧情依据。
2. 只修改上面错误逐条指出的字段、状态或拆镜问题；其余镜头与字段保持原样，禁止重写整批、禁止新增/删除镜头、禁止改剧情对白。
3. 错误若涉及 characterIds/sceneId/propIds：一律改成 idManifest 中的真实 ID；若某真实出场人物不在角色表里，先用 workshop_set_breakdown(mode:"merge") 补入后再写。同时同步修正 entryState.characters/exitState.characters 中对应的角色引用，保证两者一致。
4. 错误若涉及 narrativeBeat：只允许改成该 sceneId 下已有 Beat 的 id 或精确 title。
5. 修复后以相同 mode（${batch.mode}）调用 workshop_set_shots 重提同一批；写入成功后汇报本批结果并结束，不自动扩展到后续批次或提示词生成。
6. 若同一错误再次出现且无法形成实质不同的 payload，立即停止并原样汇报，禁止无变化循环。`;
}
