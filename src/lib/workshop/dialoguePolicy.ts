/**
 * dialoguePolicy — 让“本项目/本镜有没有对白”在写提示词之前就成为明确规则。
 *
 * 背景：无对白剧本会把 WsShot.dialogue 全部留空。提示词阶段如果仍然鼓励
 * “对话镜头要有表演节奏、台词写在 {} 内”，模型就会给纯动作镜头配台词，随后
 * 被事实锁整批否决——模型没有任何办法事先知道这是不被允许的。
 *
 * 这里把该事实显式化：无对白时，禁止任何台词/VO/旁白，改用可见表演、环境声
 * 与屏幕信息承载戏剧性。
 */
import type { WsShot } from './types.ts';

export interface DialoguePolicy {
  /** 项目内是否存在任何带对白的镜头。 */
  hasAnyDialogue: boolean;
  /** 传入范围的分镜对白字段是否全空；不证明源剧本无对白（保留字段名兼容调用方）。 */
  isDialogueFree: boolean;
  /** 传入范围内带对白的镜号，便于按集提示。 */
  dialogueShotNos: string[];
}

export function resolveDialoguePolicy(shots: readonly Pick<WsShot, 'shotNo' | 'dialogue'>[]): DialoguePolicy {
  const dialogueShotNos = shots
    .filter((shot) => (shot.dialogue ?? '').trim().length > 0)
    .map((shot) => shot.shotNo);
  return {
    hasAnyDialogue: dialogueShotNos.length > 0,
    isDialogueFree: shots.length > 0 && dialogueShotNos.length === 0,
    dialogueShotNos,
  };
}

/**
 * 对白字段全空时的来源核验指令；有对白时不推断全片策略。
 */
export function dialoguePolicyDirective(policy: DialoguePolicy): string {
  if (!policy.isDialogueFree) return '';
  return `【当前分镜对白字段为空 —— 先核对来源，再执行事实锁】
- 当前传入范围内全部已列分镜的 dialogue 为空，仅代表没有已登记的对白；不能据此断言本片无对白，也不能排除拆解漏填。
- 用本轮已读取的 currentScriptRevision、sourceExcerpt 或对应剧本段落核对说话人和台词；不重复遍历或循环读取。若原文有对应台词，报告原文、镜号和漏填项，先按事实修复流程补齐 dialogue，再继续该镜提示词；没有修复权限时明确指出阻塞，不能擅自在提示词中加入。
- 仅在原文明确无台词、用户明确要求无对白，或已核对该段确实无对白时，保留无对白。来源不足则报告尚未核验，不能宣称已确认无对白。
- 在对白事实尚未修复前，绝对禁止：人物台词、对话、VO、画外音、内心独白、旁白、解说的自行编造。不要为了增加信息密度新增台词。
- 已确认无对白的镜头仍需有具体表情、人物间反应、视线、姿态、环境声与动作拟音；不把“无台词”写成整张脸冻结，不擅自添加可读文字或用欲言又止代替原有对白。`;
}

/**
 * 角色具名规则：只有本镜 characterIds 里的角色可以使用具体姓名。
 * 这避免模型把同场但不在本镜出场集合内的角色写成具名主体。
 */
export function characterNamingDirective(): string {
  return `【角色具名规则 —— 硬性事实锁】
- 只有本镜 characterIds 中列出的角色，才可以用**具体姓名/角色名**出现在提示词里（也应正常引用其参考图）。
- 本镜 characterIds 之外的任何角色：不得写出其姓名。若画面确实需要出现其人，请用无名的描述性称谓（如“身后的队友”“穿队服的身影”“只露出剪影的教练”），或干脆不写。
- 不要在提示词里把不在本镜出场集合的角色写成主体、说话人或特写对象。`;
}
