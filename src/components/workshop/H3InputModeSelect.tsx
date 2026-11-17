import { useEffect, useRef, useState } from 'react';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveWorkshopH3Task } from '@/lib/workshop/h3InputMode';
import type { SglangH3Task } from '@/lib/canvasGen/sglangH3';

export function useWorkshopH3Task() {
  const projectMode = useWorkshopStore((s) => s.data?.h3InputMode);
  const fallback = useSettingsStore((s) => s.customVideoGenericH3Task);
  return resolveWorkshopH3Task({ h3InputMode: projectMode }, fallback);
}

/** Both authoring and generation edit the same persisted project field. */
export default function H3InputModeSelect() {
  const task = useWorkshopH3Task();
  const setTask = useWorkshopStore((s) => s.setH3InputMode);
  const projectId = useWorkshopStore((s) => s.data?.projectId);
  useEffect(() => {
    // Also pins projects already open during hot reload; settings are only a default.
    if (projectId && !useWorkshopStore.getState().data?.h3InputMode) setTask(task);
  }, [projectId, task, setTask]);
  return <label className="block min-w-[180px]">
    <span className="mb-1 block text-[10px] text-[var(--canvas-text-3)]">H3 输入方式 · 当前项目</span>
    <select value={task} onChange={(e) => setTask(e.target.value as SglangH3Task)}
      className="h-9 w-full rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] px-3 text-[11px] text-[var(--canvas-text-1)]"
      title="决定视频提示词使用的 skill 和实际提交素材。切换保留原文，需按新模式更新视频提示词。">
      <option value="ref2va">参考素材 + 提示词</option>
      <option value="i2va">首帧 + 提示词</option>
      {(task === 'fl2va' || task === 't2va') && <option value={task}>{task === 'fl2va' ? '首尾帧 + 提示词（已有配置）' : '纯文本 + 提示词（已有配置）'}</option>}
    </select>
  </label>;
}

/** Explicit video-only rewrite: leaves image prompts, timelines and storyboard intact. */
export function H3ModeChangeNotice() {
  const shots = useWorkshopStore((s) => s.data?.shots);
  const projectId = useWorkshopStore((s) => s.data?.projectId);
  const task = useWorkshopH3Task();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const stale = (shots ?? []).filter((shot) => shot.h3VideoPromptModeStale);
  if (!stale.length && !busy && !error) return null;
  const rewrite = async () => {
    if (!projectId || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const { rewriteWorkshopShotVideo } = await import('@/lib/workshop/rewriteShotVideo');
      for (const shot of stale) {
        const current = useWorkshopStore.getState();
        if (current.data?.projectId !== projectId || current.getH3InputMode() !== task) throw new Error('项目或输入方式已变化，停止后续重写。');
        await rewriteWorkshopShotVideo(projectId, shot.shotNo);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return <div className="my-3 rounded-lg border border-amber-500/30 p-3 text-xs text-amber-300">
    <p>H3 输入方式已切换，{stale.length} 镜视频提示词待更新。原文、动作时间轴、高清故事板与已有媒体均保留。</p>
    <button disabled={busy || !stale.length} onClick={() => void rewrite()} className="mt-2 rounded border border-amber-500/40 px-3 py-1.5 disabled:opacity-40">{busy ? '正在按当前模式重写…' : '仅更新待适配的视频提示词'}</button>
    {error && <p className="mt-2">{error} 已成功保存的镜头不会重复重写。</p>}
  </div>;
}
