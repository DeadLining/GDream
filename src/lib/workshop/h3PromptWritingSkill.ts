import { H3_REF2VA_SKILL } from './h3Ref2vaPrompt.ts';
import { H3_DIALOGUE_STAGING_POLICY, H3_DIRECTING_POLICY, H3_I2VA_BOUNDARY_COMPOSITION_RULE_EN } from './h3DirectingPolicy.ts';
import { H3_SHOT_CONTRACT_AUTHORING_EN } from './h3ShotContract.ts';
import type { SglangH3Task } from '../canvasGen/sglangH3.ts';
import { BASE_EN, REF_EN, SKILL } from './h3PromptWritingSkillContent.ts';
import { h3FormatAuthoringContract } from './h3PromptFormat.ts';

/**
 * Complete MiniMax H3 h3-prompt-writing skill text, bundled with the app.
 *
 * The workshop text model cannot read a user-specific ~/.codex skill path, so
 * the checked-in copy under skills/h3-prompt-writing is injected verbatim.
 */
export const H3_PROMPT_WRITING_SKILL = SKILL;
export const H3_PROMPT_WRITING_BASE_GUIDE = BASE_EN;
export const H3_PROMPT_WRITING_REF_GUIDE = REF_EN;

export function h3PromptWritingSkillForTask(task: SglangH3Task): string {
  if (task === 'ref2va') return H3_REF2VA_SKILL;
  const mode = task === 'fl2va'
      ? '当前使用官方 FL2VA 写法：首帧是 0.00 秒起点，尾帧是结束状态，正文重点是两帧之间的连续路径。'
      : task === 'i2va'
        ? '当前使用官方 I2VA 写法：Picture 1 是 0.00 秒首帧，只锁定开场身份、空间、构图和状态；正文从该首帧连续向前发展到提示词定义的结束状态。'
      : '当前使用官方 T2VA 写法：没有参考素材，所有视觉信息必须用文字直接表达。';
  const referenceGuide = `## Complete Base Mode Guide\n${H3_PROMPT_WRITING_BASE_GUIDE}`;
  const boundaryRule = task === 'i2va' ? `\n${H3_I2VA_BOUNDARY_COMPOSITION_RULE_EN}` : '';
  return `${H3_PROMPT_WRITING_SKILL}\n\n${referenceGuide}\n【当前模式】${mode}
【调用层与表达边界】本次最终提示词采用 Layer 2。已有 actionTimeline、对白、情绪与摄影决策必须保留，不把 Physical-Action-First 误解成只写肢体动作：同时表达可见表情、听者反应、说话语气和同步声音。原有切镜按指南 Shots and Cuts 写明，不因连续性要求删除；I2VA 只锁开场状态，不自动等于一镜到底。本次工坊调用明确授权补充不改变剧情事实的自然表演、节拍细分和缺省摄影设计；这些属于表达细化，不得覆盖已有明确摄影决策，不需另起规划任务或索要授权。
${H3_DIRECTING_POLICY}${boundaryRule}
${H3_SHOT_CONTRACT_AUTHORING_EN}
${H3_DIALOGUE_STAGING_POLICY}`;
}

export function h3OfficialOutputContract(task: SglangH3Task, durationSeconds: number): string {
  const duration = Math.min(15, Math.max(4, Math.round(durationSeconds || 5))).toFixed(2);
  const integratedTemplate = `integrated_multimodal_description: [Shot 1] Describe the opening, unfolding audiovisual event and planned ending in meaningful timed paragraphs.

overall_soundscape: Relevant whole-clip ambience and physical sound.

non_diegetic_music: The chosen score, or none.`;
  if (task === 'ref2va') {
    return `${h3FormatAuthoringContract(true)}
正文使用英文；原始对白保留原文和语言，以 <d>[语言] ...</d> 放在实际发生的段落中。参考编号必须来自实际输入清单，身份与素材只绑定一次，不按时长凑字符数。`;
  }
  const format = h3FormatAuthoringContract(false);
  if (task === 'fl2va') {
    return `保留以下对齐说明与三个封装字段的顺序；正文子标题可选，不输出 Markdown 代码围栏：
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the ${duration}-second mark of the target video.

${integratedTemplate}
${format}

正文使用英文；原始中文对白保持中文，并写在 <d>[Chinese] ...</d> 中。Picture 1 是实际首帧，Picture 2 是实际尾帧；必须描述从首帧状态经过连续可见变化并在 ${duration} 秒准确抵达尾帧状态。`;
  }
  if (task === 'i2va') {
    return `保留以下对齐说明与三个封装字段的顺序；正文子标题可选，不输出 Markdown 代码围栏：
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

${integratedTemplate}
${format}

正文使用英文；原始中文对白保持中文，并写在 <d>[Chinese] ...</d> 中。Picture 1 是实际首帧，只约束 0.00 秒开场状态；必须从它连续向前发展，不得把后续动作冻结成首帧姿势。`;
  }
  return `保留以下三个封装字段的顺序；正文子标题可选，不输出 Markdown 代码围栏：
${integratedTemplate}
${format}

正文使用英文；原始中文对白保持中文，并写在 <d>[Chinese] ...</d> 中。当前没有任何参考图片、视频或音频，不得生成引用标签。`;
}
