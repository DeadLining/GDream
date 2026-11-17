import type { WsCharacter, WsNarrativeBeat, WsProp, WsScene } from './types.ts';

export interface BreakdownInput {
  creativeSpec?: { workKind?: string };
  synopsis?: string;
  episodes?: Array<{ no?: string; title?: string; sceneList?: string }>;
  narrativeBeats?: WsNarrativeBeat[];
  characters?: WsCharacter[];
  scenes?: WsScene[];
  props?: WsProp[];
}

export const ALLOWED_BEAT_PURPOSES = ['信息', '关系', '情绪', '不可逆动作'] as const;
const allowedBeatPurposes = new Set<string>(ALLOWED_BEAT_PURPOSES);

function duplicateIds(items: Array<{ id?: string }>, label: string): string[] {
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const item of items) {
    const id = item.id?.trim() ?? '';
    if (!id) errors.push(`${label}缺少 id`);
    else if (seen.has(id)) errors.push(`${label} id 重复：${id}`);
    else seen.add(id);
  }
  return errors;
}

export function validateBreakdownInput(input: BreakdownInput, requireFullStructure = true): string[] {
  const errors: string[] = [];
  if (!input.synopsis?.trim()) errors.push('缺少非空 synopsis');
  const episodes = input.episodes ?? [];
  const scenes = input.scenes ?? [];
  const beats = input.narrativeBeats ?? [];
  const characters = input.characters ?? [];
  const props = input.props ?? [];

  if (requireFullStructure) {
    if (episodes.length === 0) errors.push('至少需要一个 episode');
    if (scenes.length === 0) errors.push('至少需要一个 Scene');
    if (beats.length === 0) errors.push('至少需要一个 Narrative Beat');
    if (characters.length === 0 && !(input.creativeSpec?.workKind === 'product-ad' && Array.isArray(input.characters))) errors.push('至少需要一个角色；纯环境故事也应明确写入空角色说明');
  }
  const episodeNos = new Set<string>();
  for (const episode of episodes) {
    const no = episode.no?.trim() ?? '';
    if (!no || !episode.title?.trim() || !episode.sceneList?.trim()) errors.push(`episode ${no || '(未知)'} 缺少 no/title/sceneList`);
    if (no && episodeNos.has(no)) errors.push(`episode 编号重复：${no}`);
    if (no) episodeNos.add(no);
  }
  errors.push(...duplicateIds(scenes, 'Scene'));
  errors.push(...duplicateIds(beats, 'Narrative Beat'));
  errors.push(...duplicateIds(characters, '角色'));
  errors.push(...duplicateIds(props, '道具'));

  const sceneIds = new Set(scenes.map((scene) => scene.id?.trim()).filter(Boolean));
  for (const scene of scenes) {
    if (!scene.name?.trim() || !scene.description?.trim()) errors.push(`Scene ${scene.id || '(未知)'} 缺少 name/description`);
  }
  for (const beat of beats) {
    if (!sceneIds.has(beat.sceneId?.trim())) errors.push(`Narrative Beat ${beat.id || '(未知)'} 引用了不存在的 Scene：${beat.sceneId || '(空)'}`);
    if (!beat.title?.trim() || !beat.purpose?.trim()) errors.push(`Narrative Beat ${beat.id || '(未知)'} 缺少 title/purpose`);
    if (beat.purpose?.trim() && !allowedBeatPurposes.has(beat.purpose.trim())) {
      errors.push(`Narrative Beat ${beat.id || '(未知)'} 的 purpose 必须是信息/关系/情绪/不可逆动作之一`);
    }
  }
  for (const character of characters) {
    if (!character.name?.trim() || !character.appearance?.trim()) errors.push(`角色 ${character.id || '(未知)'} 缺少 name/appearance`);
  }
  return [...new Set(errors)];
}
