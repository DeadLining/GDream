import type { AgentUserContentBlock } from '../types.ts';
/** A bounded, tool-free ACP turn. No workshop recovery, provider fallback or replay. */
export interface TextRunClient {
  start(): Promise<void>;
  prompt(input: string, mediaBlocks?: AgentUserContentBlock[]): Promise<{ stopReason?: string }>;
  dispose(): Promise<void>;
}
export interface TextRunOptions {
  mediaBlocks?: AgentUserContentBlock[];
  signal?: AbortSignal;
  /** Absolute deadline, including connection and active output (default 15 minutes). */
  timeoutMs?: number;
  /** Maximum silence between model events (default 3 minutes). */
  idleTimeoutMs?: number;
  onProgress?: (status: string) => void;
}
export async function runDshText(
  create: (onText: (text: string) => void, onThinking: () => void) => TextRunClient,
  input: string,
  options: TextRunOptions = {},
): Promise<string> {
  if (options.signal?.aborted) throw new Error('已取消，原内容未修改');
  let active = true;
  let text = '';
  let thinking = false;
  let status = '';
  let phase = '正在连接 DSH';
  const positiveMs = (value: number | undefined, fallback: number) =>
    value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
  const totalMs = positiveMs(options.timeoutMs, 15 * 60_000);
  const idleMs = positiveMs(options.idleTimeoutMs, 180_000);
  const duration = (ms: number) => ms >= 60_000 ? `${Math.round(ms / 60_000)} 分钟` : `${ms / 1000} 秒`;
  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let rejectInterrupted: (error: Error) => void = () => {};
  const interrupt = (error: Error) => {
    if (!active) return;
    active = false;
    rejectInterrupted(error);
  };
  const resetIdle = () => {
    if (!active) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => interrupt(new Error(
      `DSH 文本任务无响应超时（连续 ${duration(idleMs)} 未收到模型进展；最后状态：${phase}），原内容未修改；未自动重试`,
    )), idleMs);
  };
  const progress = (next: string) => {
    if (!active || status === next) return;
    status = next; options.onProgress?.(next);
  };
  const client = create((delta) => {
    if (!active) return;
    if (!delta) return;
    phase = 'DSH 正在输出正文';
    resetIdle();
    text += delta; progress('DSH 正在输出');
  }, () => {
    if (!active) return;
    thinking = true;
    phase = 'DSH 正在思考';
    resetIdle();
    progress(phase);
  });
  let abort = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    rejectInterrupted = reject;
    abort = () => interrupt(new Error('已取消，原内容未修改'));
    options.signal?.addEventListener('abort', abort, { once: true });
    totalTimer = setTimeout(() => interrupt(new Error(
      `DSH 文本任务超过总时限（${duration(totalMs)}；最后状态：${phase}），尚未收到完整结束回执，原内容未修改；未自动重试`,
    )), totalMs);
    resetIdle();
    if (options.signal?.aborted) abort();
  });
  try {
    progress('正在连接 DSH');
    return await Promise.race([interrupted, (async () => {
      if (!active) throw new Error('已取消，原内容未修改');
      await client.start();
      if (!active || options.signal?.aborted) throw new Error('已取消，原内容未修改');
      phase = '已连接，等待模型响应';
      resetIdle();
      progress('DSH 正在处理');
      const result = await client.prompt(input, options.mediaBlocks);
      if (!active || options.signal?.aborted) throw new Error('已取消，原内容未修改');
      if (result.stopReason === 'max_tokens') {
        throw new Error(`DSH 达到输出 token 上限${thinking && !text.trim() ? '，仅返回思考过程、尚未生成正文' : '，正文未完整生成'}；原内容未修改。请调整模型的输出或思考预算后重试`);
      }
      if (result.stopReason !== 'end_turn') throw new Error(`DSH 未完整结束（${result.stopReason || '未知状态'}），原内容未修改`);
      if (!text.trim()) throw new Error(thinking
        ? 'DSH 仅返回思考过程，没有返回正文；原内容未修改。请检查模型服务的正文输出'
        : 'DSH 返回空内容，原内容未修改。请检查模型服务的正文输出');
      return text;
    })()]);
  } finally {
    active = false;
    clearTimeout(totalTimer);
    clearTimeout(idleTimer);
    options.signal?.removeEventListener('abort', abort);
    // Cleanup must not hold the UI hostage to a stalled IPC response.
    void client.dispose().catch(() => {});
  }
}
