import type { ToolResult } from '../types';

/** Run-local circuit breaker. Reads and changed arguments cannot reset a failed write. */
export class RepeatedToolFailureGuard {
  private failures = new Map<string, Map<string, number>>();

  observe(name: string, result: ToolResult): string | undefined {
    if (result.success) {
      this.failures.delete(name);
      return undefined;
    }
    const reason = (result.error || result.output || '工具未返回成功回执').trim();
    const errors = this.failures.get(name) ?? new Map<string, number>();
    const count = (errors.get(reason) ?? 0) + 1;
    errors.set(reason, count);
    this.failures.set(name, errors);
    if (count >= 2) return `工具 ${name} 重复失败，已停止本轮执行，保留已保存成果；不会自动重放任务。原因：${reason}`;
    return undefined;
  }
}
