/**
 * 重复读取短路。
 *
 * 动机（2026-09-15 端到端实测）：模型在工坊写入完成之后，仍会连续复读
 * `workshop_get_state` 3–6 轮才收尾。每一轮都是一次完整往返，既拖长耗时，
 * 也显著提高撞上流式看门狗的概率（`glmClient.ts`：首包 120s / 空闲 90s），
 * 最终表现为**数据已经落库、用户却看到报错**并可能重试（付费步骤会重复扣费）。
 *
 * 规则：同名 + 同参数（键序无关）的只读工具调用，若期间没有任何写入发生，
 * 第二次起直接返回一句「没有变化」的提示，不再真正读取。
 * 任何写入都会清空记忆，因此「写完再读一次确认」这类合法流程不受影响。
 *
 * workshop_get_state 不参与短路：成功执行不等于模型仍持有结果。分页恢复、
 * 上下文压缩后重读、快照过期重开，都需要真实数据，不能以成功的提示语替代。
 * 该工具由状态快照缓存复用结果；循环由运行预算约束，不牺牲读取正确性。
 */
import { isWorkshopMutationTool } from './workshopWriteGuard.ts';

/** 参与短路的只读工具 → 命中时回给模型的替代输出。 */
export const REPEAT_READ_SHORT_CIRCUIT: Record<string, string> = {
  workshop_get_production_audit:
    '生产审计结果没有变化：本次运行期间没有任何写入发生。请直接继续或结束本轮。',
};

/**
 * 会改变工坊数据的工具。命中后此前读到的状态一律视为过期。
 *
 * **必须与 `workshopWriteGuard.ts` 同源**：这里曾自己维护一条正则
 * `/^workshop_(set|update|clear|generate|remove|delete)(_|$)/`，于是
 * `workshop_upsert_assets`、`workshop_accept_video_candidate`、
 * `workshop_add_candidate`、`workshop_recover_storyboard_results`、
 * `workshop_render_export`、`workshop_mark_exported`、`workshop_refresh_ui`
 * 等 8 个真实写入被判成「不是写入」，写完再读会被错误地短路成「没有变化」。
 *
 * 判定口径只允许有一份：`workshop_` 前缀且不在 `WORKSHOP_READ_ONLY_TOOLS` 里。
 * 这条口径是**保守（fail-open）**的——即便某个工具实际不改数据（例如
 * `workshop_refresh_ui` 的 memory 模式只是落盘），多清一次记忆的代价只是
 * 少省一次读取；反过来漏判则会让模型拿着过期状态继续干活。
 */
export function isWorkshopWriteTool(name: string): boolean {
  return isWorkshopMutationTool(name);
}

/** 键序无关的指纹：模型两次调用即使参数键顺序不同也应视为同一次读取。 */
export function stableToolFingerprint(name: string, params: Record<string, unknown> | undefined): string {
  const source = params ?? {};
  const keys = Object.keys(source).sort();
  return `${name}|${JSON.stringify(keys.map((key) => [key, source[key]]))}`;
}

export class RepeatReadMemo {
  private served = new Set<string>();

  /**
   * 上次记录时的工坊数据快照标识。
   *
   * 为什么需要它：能改变工坊数据的**不只是** `workshop_*` 工具——用户在
   * StepAssets/StepGenerate 里直接改提示词、`workshop_refresh_ui` 从磁盘 reload、
   * 另一个会话或窗口写入，都会绕过工具层。只看「有没有工坊工具写入」会让这些
   * 改动之后的复读被错误短路成「没有变化」，而各步的前置校验正是靠它取真实状态。
   *
   * 快照标识由调用方提供（`ToolRegistry` 用工坊 store 的 data 引用），
   * 变了就清空全部记忆——口径与「写入让读到的状态过期」完全一致。
   */
  private snapshot: string | null = null;

  /** 命中则返回应当回给模型的替代输出（调用方据此跳过真实读取）；未命中返回 null。 */
  check(
    name: string,
    params: Record<string, unknown> | undefined,
    snapshot?: string | null,
  ): string | null {
    const notice = REPEAT_READ_SHORT_CIRCUIT[name];
    if (!notice) return null;
    // 快照变了：此前读到的状态一律视为过期，本次放行真实读取。
    if (snapshot != null && snapshot !== this.snapshot) return null;
    return this.served.has(stableToolFingerprint(name, params)) ? notice : null;
  }

  /** 工具执行后登记结果。只有成功且未短路时才有意义。 */
  record(
    name: string,
    params: Record<string, unknown> | undefined,
    success: boolean,
    snapshot?: string | null,
  ): void {
    if (isWorkshopWriteTool(name)) {
      // 写入让之前读到的状态全部过期。
      this.served.clear();
      if (snapshot != null) this.snapshot = snapshot;
      return;
    }
    if (!REPEAT_READ_SHORT_CIRCUIT[name] || !success) return;
    if (snapshot != null) {
      if (this.snapshot !== snapshot) {
        // 换了快照：旧记忆作废，本次读到的才算数。
        this.served.clear();
        this.snapshot = snapshot;
      }
    }
    this.served.add(stableToolFingerprint(name, params));
  }

  /** 一次运行结束时清空。 */
  reset(): void {
    this.served.clear();
    this.snapshot = null;
  }
}
