const REPAIRABLE_BREAKDOWN_MUTATIONS = new Set([
  'workshop_set_breakdown',
  'workshop_set_shots',
  'workshop_complete_breakdown_unit',
  'workshop_restore_shot_dialogue',
  'workshop_set_step_status',
]);

/**
 * Breakdown validation is allowed to feed a concrete error back to the agent
 * for a bounded repair. Other workshop mutations remain terminal on failure.
 */
export function canRetryWorkshopMutation(name: string, failureCount: number): boolean {
  return REPAIRABLE_BREAKDOWN_MUTATIONS.has(name) && failureCount <= 2;
}

/** Group retries by the concrete shot batch so one bad batch does not consume
 * the repair allowance of every later batch in a long script. */
export function workshopMutationRepairKey(name: string, params: Record<string, unknown>): string {
  if (name === 'workshop_restore_shot_dialogue') return `${name}:${String(params.shotNo)}`;
  if (name === 'workshop_complete_breakdown_unit') return `${name}:${String(params.workUnitId)}`;
  if (name !== 'workshop_set_shots' || !Array.isArray(params.shots)) return name;
  const shotNos = params.shots
    .map((shot) => shot && typeof shot === 'object' && typeof (shot as { shotNo?: unknown }).shotNo === 'string'
      ? (shot as { shotNo: string }).shotNo.trim()
      : '')
    .filter(Boolean)
    .sort();
  return `${name}:${String(params.mode ?? 'merge')}:${shotNos.join(',') || 'unknown-batch'}`;
}

/**
 * 重复写入判定：只有“此前已经成功落盘”的同一调用才算重复。
 *
 * 背景：失败的 workshop_set_shots 是整批事务回滚，什么都没写。修复协议要求
 * “用相同 mode 重提同一批”，若把失败调用也计入重复，就会在第二次重提时
 * 误报“已检测到重复调用”并终止整轮，用户永远修不完。
 */
export function isDuplicateWorkshopWrite(priorSuccessCount: number): boolean {
  return priorSuccessCount > 0;
}
