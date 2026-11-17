import type { ToolResult } from './types.ts';

/** Only for lookup/pre-write paths: no mutation or media request has occurred. */
export function missingPersistedShotResult(shotNo: string): ToolResult {
  return {
    success: false,
    output: '',
    recoverable: true,
    error: `分镜 ${shotNo} 不在当前已保存的分镜表中，本次未做任何修改。\n若正在修复被拒绝的批次，这是待提交数据，不是可直接编辑的已有镜头：请修改修复请求中携带的原始 shots，按原错误修正后用 workshop_set_shots 重提；不要再对这些待写入镜号调用 workshop_get_shot_refs、workshop_update_shot 或 workshop_update_shot_refs，也不需要先生成资产。\n若不是失败批次修复，请用 workshop_get_state 核对当前项目和真实镜号，不要凭空创建替代镜头。`,
  };
}
