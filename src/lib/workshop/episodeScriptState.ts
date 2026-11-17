import type { WorkshopData } from './types.ts';
import { hasEpisodeScript } from './episodeScriptTask.ts';

/** Separate screenplay facts from the much larger storyboard/production state. */
export function buildEpisodeScriptState(data: WorkshopData, episodeNo = '') {
  const scriptProgress = data.episodes.map((episode) => ({
    no: episode.no, title: episode.title, scriptStatus: episode.scriptStatus ?? 'planned',
    hasScript: hasEpisodeScript(episode), scriptChars: episode.script?.length ?? 0,
    shotCount: data.shots.filter((shot) => shot.episode === episode.no).length,
  }));
  if (!episodeNo) {
    return {
      projectId: data.projectId, synopsis: data.synopsis,
      currentScriptRevisionId: data.currentScriptRevisionId,
      currentScriptRevision: data.scriptRevisions?.find((revision) => revision.id === data.currentScriptRevisionId),
      scriptReview: data.scriptReview, creativeSpec: data.creativeSpec, bibles: data.bibles,
      // Whole-season planning is needed once, not all completed scripts/prompts/assets' candidates.
      episodes: data.episodes.map(({ script: _script, characterAssetNotes: _notes, ...plan }) => plan),
      characters: data.characters.map(({ id, name, personality, appearance, lifecycleStages }) => ({ id, name, personality, appearance, lifecycleStages })),
      scenes: data.scenes.map(({ id, name, description }) => ({ id, name, description })),
      props: data.props.map(({ id, name, description }) => ({ id, name, description })),
      scriptProgress,
      next: '按集读取 section:"episode-script", episode:"集号"；每集保存成功后转下一集，不反复读取全季正文。',
    };
  }
  const index = data.episodes.findIndex((episode) => episode.no === episodeNo);
  if (index < 0) throw new Error(`未找到第 ${episodeNo} 集，请使用 scriptProgress 中的真实集号。`);
  const beats = (data.narrativeBeats ?? []).filter((beat) => beat.episode === episodeNo);
  const sceneIds = new Set(beats.map((beat) => beat.sceneId));
  const previous = data.episodes[index - 1];
  return {
    projectId: data.projectId, currentScriptRevisionId: data.currentScriptRevisionId,
    episode: data.episodes[index],
    previousEpisode: previous ? { no: previous.no, endingState: previous.endingState, script: previous.script, scriptStatus: previous.scriptStatus } : null,
    narrativeBeats: beats,
    scenes: data.scenes.filter((scene) => sceneIds.has(scene.id)).map(({ id, name, description }) => ({ id, name, description })),
    characterHandoffs: (data.characterHandoffs ?? []).filter((handoff) => handoff.targetEpisode === episodeNo || handoff.sourceEpisode === episodeNo),
    scriptProgress,
    sourceRule: '共同源文、人物和资产事实来自本轮已读取的 episode-script 全局页；若上下文已丢失或 revision 已改变，恢复全局页后再写。',
  };
}
