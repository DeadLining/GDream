import { breakdownContentFingerprint, pendingBreakdownUnits } from './breakdownQueue.ts';
import type { WorkshopData, WsShot } from './types.ts';
import { hasEpisodeScript } from './episodeScriptTask.ts';

const episodeKey = (value: string) => value.trim().replace(/^0+(?=\d)/, '');
export function shotEpisode(shot: WsShot): string {
  return episodeKey(shot.episode || shot.shotNo.match(/^(\d+)-/)?.[1] || '');
}

/** Work completeness only, never a shot quality/Beat acceptance gate. */
export function episodesWithoutShots(data: Pick<WorkshopData, 'episodes' | 'shots'>): string[] {
  const saved = new Set(data.shots.map(shotEpisode));
  return data.episodes.filter((episode) => !saved.has(episodeKey(episode.no))).map((episode) => episode.no);
}

/** Only the full breakdown action owns this continuation; batch repairs and inspections do not. */
export function isFullBreakdownExecution(request: string): boolean {
  return /(?:^|\n)(?:请对当前工坊项目执行剧本拆解|(?:请)?继续(?:完成)?(?:第②步|第二步|剧本拆解))/.test(request.trim())
    && !/(?:只|仅)(?:做)?(?:检查|核对|查看|读取|汇报)/.test(request);
}

/** Explicit rebuild owns a different completion road: an old `done` status must not short-circuit it. */
export function isBreakdownResplitExecution(request: string): boolean {
  return request.includes('[工坊任务:breakdown-resplit]')
    || /按(?:单镜|镜头)?(?:详细)?时间轴(?:重排|重新拆解)/.test(request)
    || /重新拆解[^\n]{0,24}(?:分镜|镜头|完整镜头表)/.test(request);
}

export function breakdownExecutionProgress(data: WorkshopData) {
  const missing = episodesWithoutShots(data);
  const ready = data.episodes.filter((episode) => missing.includes(episode.no) && hasEpisodeScript(episode)).map((episode) => episode.no);
  const scripts = data.episodes.filter((episode) => missing.includes(episode.no) && !hasEpisodeScript(episode)).map((episode) => episode.no);
  const reviewBlocked = Boolean(data.currentScriptRevisionId && data.scriptReview?.revisionId === data.currentScriptRevisionId && data.scriptReview.status === 'needs-repair');
  const finished = data.steps.breakdown.status === 'done' && data.shots.length > 0 && missing.length === 0 && (!data.breakdownWork || pendingBreakdownUnits(data).length === 0);
  // Stable factual checkpoint: UI timestamps/reads cannot buy extra retries.
  const key = breakdownContentFingerprint(JSON.stringify([data.episodes.map((e) => [e.no, e.script, e.scriptStatus]), data.shots.map((s) => [s.shotNo, s.episode, s.dialogue, s.description]), data.breakdownWork, data.bibles, data.narrativeBeats, data.currentScriptRevisionId, data.scriptReview], (field, value) => ['updatedAt', 'createdAt', 'reviewedAt'].includes(field) ? undefined : value));
  const next = ready.length
    ? `先完成第 ${ready[0]} 集：该集已有完整剧本，直接依据正文用 workshop_set_shots(mode:"merge") 分批保存缺失镜头。`
    : scripts.length
      ? `第 ${scripts[0]} 集尚无镜头和完整分集正文：读取该集已保存规划与当前正式剧本；若正式剧本已有内容直接拆镜，否则按既定剧情及创作设置展开并用 workshop_set_episode_script 保存，再拆镜。不重写已有镜头或完整剧本。`
      : '按已经读到的正式剧本继续尚未写完的镜头；若目标内容确已全部写入，调用 workshop_set_step_status 标记 breakdown done。不要仅凭镜头数量宣布全剧完成。';
  return { key, finished, reviewBlocked, missing, next };
}
