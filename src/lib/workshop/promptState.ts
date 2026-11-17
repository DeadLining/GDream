import type { WorkshopData, WsShot } from './types.ts';
const episodeKey = (value: string) => value.trim().replace(/^0+(?=\d)/u, '');
export function selectPromptShots(data: Pick<WorkshopData, 'shots'>, shotNo = '', episode = ''): WsShot[] {
  if (shotNo) return data.shots.filter((shot) => shot.shotNo === shotNo);
  if (episode) return data.shots.filter((shot) => episodeKey(shot.episode || shot.shotNo.match(/^(\d+)-/u)?.[1] || '') === episodeKey(episode));
  return data.shots;
}
/** Explicit prompt-writing facts. Production history belongs to section generate. */
export function promptShotFacts(shot: WsShot, full: boolean) {
  return {
    shotNo: shot.shotNo, episode: shot.episode, sceneId: shot.sceneId,
    description: shot.description, narrativeBeat: shot.narrativeBeat, atomicAction: shot.atomicAction,
    continuityMode: shot.continuityMode, entryState: shot.entryState, exitState: shot.exitState,
    transitionPlan: shot.transitionPlan, sourceExcerpt: shot.sourceExcerpt, sourceScriptRevisionId: shot.sourceScriptRevisionId,
    dialogue: shot.dialogue, shotType: shot.shotType, camera: shot.camera, mood: shot.mood,
    soundIntent: shot.soundIntent, durationSec: shot.durationSec,
    spatialStaging: shot.spatialStaging, actionTimeline: shot.actionTimeline,
    characterIds: shot.characterIds, voiceCharacterIds: shot.voiceCharacterIds, propIds: shot.propIds,
    assetPropIds: shot.assetPropIds, incidentalObjects: shot.incidentalObjects,
    videoRatio: shot.videoRatio, videoModel: shot.videoModel, videoPromptTemplate: shot.videoPromptTemplate,
    shotPlanningMode: shot.shotPlanningMode, promptNeedsRefresh: shot.promptNeedsRefresh,
    referenceRevision: shot.referenceRevision ?? 0,
    imagePrompt: full ? shot.imagePrompt : undefined,
    videoPrompt: full ? shot.videoPrompt : undefined,
    universalVideoPrompt: full ? shot.universalVideoPrompt : undefined,
    audioPrompts: full ? shot.audioPrompts : undefined,
    imagePromptLength: shot.imagePrompt?.length ?? 0,
    videoPromptLength: shot.videoPrompt?.length ?? 0,
    universalVideoPromptLength: shot.universalVideoPrompt?.length ?? 0,
  };
}
