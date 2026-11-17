import { useEffect, useState } from 'react';
import { Check, Loader2, AlertTriangle, RefreshCw, X } from 'lucide-react';
import { rewriteIsRunning, useWorkshopRewriteStore, type WorkshopRewriteTask } from '@/stores/workshopRewriteStore';

import { rewriteProgressRows } from '@/lib/workshop/rewriteProgress';

export default function WorkshopRewriteProgress({ tasks, onRetry }: { tasks: WorkshopRewriteTask[]; onRetry?: (task: WorkshopRewriteTask) => void }) {
  const dismiss = useWorkshopRewriteStore((state) => state.dismiss);
  const [now, setNow] = useState(Date.now());
  const running = tasks.some((task) => rewriteIsRunning(task.phase));
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return <div className="space-y-2" aria-live="polite">
    {tasks.map((task) => <div key={task.key} className="rounded-lg border border-[var(--canvas-border)] p-3 text-xs text-[var(--canvas-text-2)]">
      <div className="mb-2 flex items-center gap-2 font-medium">
        {rewriteIsRunning(task.phase) ? <Loader2 size={13} className="animate-spin" /> : task.phase === 'done' ? <Check size={13} /> : <AlertTriangle size={13} />}
        <span>{task.shotNo} · H3 视频提示词重写</span>
        <span className="ml-auto font-normal">{Math.max(0, Math.floor(((task.endedAt ?? now) - task.startedAt) / 1000))} 秒</span>
        {!rewriteIsRunning(task.phase) && (
          <button
            type="button"
            onClick={() => dismiss(task.key)}
            className="rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
            title="关闭这条重写记录"
            aria-label={`关闭 ${task.shotNo} 的重写记录`}
          >
            <X size={12} />
          </button>
        )}
      </div>
      {rewriteProgressRows(task).map(({ phase, label, status }) => (
        <div key={phase} className="flex gap-2 py-0.5 opacity-80">
          <span>{status === 'completed' ? '✓' : status === 'reused' ? '↪' : status === 'failed' ? '!' : status === 'running' ? '◉' : '·'}</span><span>{label}</span>
        </div>
      ))}
      {task.phase === 'planning' && <p className="mt-2 opacity-70">先确定动作、接触路径和结束状态；完成后才进入 H3 提示词重写。</p>}
      {task.phase === 'writing' && <p className="mt-2 opacity-70">正在等待模型返回；无需重复点击，不会提交视频生成。</p>}
      {task.phase === 'done' && <p className="mt-2 text-emerald-400">已保存。图片提示词和已有视频未修改。</p>}
      {task.phase === 'failed' && <>
        <p className="mt-2 whitespace-pre-wrap text-red-400">重写未完成：{task.error}</p>
        {onRetry && (
          <button
            type="button"
            onClick={() => onRetry(task)}
            className="mt-2 inline-flex items-center gap-1.5 rounded border border-red-400/40 px-2.5 py-1.5 text-red-300 transition-colors hover:bg-red-500/10"
          >
            <RefreshCw size={11} /> 再次重写
          </button>
        )}
      </>}
    </div>)}
  </div>;
}
