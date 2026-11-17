import { mergeBreakdownRecords, type BreakdownWriteMode } from './breakdownWrite.ts';
import type { WorkshopData, WsCharacter } from './types.ts';

export const CHARACTER_IDENTITY_RULE = '角色身份按全剧统一：已有角色必须逐字复用真实 ID，不得因跨集、分批、重试或修正 ID 拼写而新建同一人的档案。同名但确属不同人的角色须在档案中明确区分；工具返回角色 ID 归并映射时，后续引用使用归并后的 ID。';

type CharacterPatch = Partial<WsCharacter> & Pick<WsCharacter, 'id'>;
const normalized = (value?: string) => (value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ');

// Names alone are not identities: homonyms, costume variants and unnamed extras
// must survive. Only collapse positively matching, non-empty character profiles.
function sameCharacter(a: WsCharacter, b: CharacterPatch): boolean {
  if (!normalized(a.name) || normalized(a.name) !== normalized(b.name)) return false;
  if (!normalized(a.appearance) || !normalized(a.personality)) return false;
  return normalized(a.appearance) === normalized(b.appearance)
    && normalized(a.personality) === normalized(b.personality)
    && JSON.stringify(a.lifecycleStages ?? []) === JSON.stringify(b.lifecycleStages ?? [])
    && !(a.voicePath && b.voicePath && a.voicePath !== b.voicePath);
}

function combineAssets(keep: WsCharacter, duplicate: WsCharacter): WsCharacter {
  const result = { ...duplicate, ...keep };
  for (const key of Object.keys(duplicate) as (keyof WsCharacter)[]) {
    if (result[key] === undefined || result[key] === '') {
      Object.assign(result, { [key]: duplicate[key] });
    }
  }
  // A duplicate can already have paid images. Keep all candidates and receipts,
  // including an old selected image that was never added to candidate history.
  const candidates = [...(keep.candidates ?? []), ...(duplicate.candidates ?? [])];
  for (const item of [keep, duplicate]) {
    if (item.assetImagePath && !candidates.some((c) => c.path === item.assetImagePath)) {
      candidates.push({ path: item.assetImagePath, source: 'upload', createdAt: 0 });
    }
  }
  if (candidates.length) result.candidates = candidates.filter((c, i) => candidates.findIndex((other) => JSON.stringify(other) === JSON.stringify(c)) === i);
  const reviews = [...(keep.assetReviews ?? []), ...(duplicate.assetReviews ?? [])];
  if (reviews.length) result.assetReviews = reviews.filter((r, i) => reviews.findIndex((other) => JSON.stringify(other) === JSON.stringify(r)) === i);
  // A production binding must belong to the retained selected image.
  result.assetProductionBinding = [keep.assetProductionBinding, duplicate.assetProductionBinding]
    .find((binding) => binding?.path === result.assetImagePath);
  result.id = keep.id;
  return result;
}

const characterIdArrays = new Set(['characterIds', 'physicalCharacterIds', 'visibleCharacterIds', 'screenCharacterIds', 'voiceCharacterIds']);
const frozenFields = new Set(['lastProductionPacket', 'productionPacket', 'videoCandidates', 'imageCandidates', 'audioCandidates', 'audioReviews', 'audioProductionBinding', 'videoReviews', 'videoProductionBinding']);

/** Resolve only structured live references; never replace names, dialogue, paths,
 * prompt text, or historical provider packets/fingerprints. */
export function remapCharacterReferences<T>(value: T, aliases: Record<string, string> = {}): T {
  if (!Object.keys(aliases).length) return value;
  const resolve = (id: string): string => {
    const visited = new Set<string>();
    while (Object.prototype.hasOwnProperty.call(aliases, id) && !visited.has(id)) {
      visited.add(id);
      id = aliases[id];
    }
    return id;
  };
  const walk = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(walk);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.entries(item).map(([key, field]) => {
      if (frozenFields.has(key)) return [key, field];
      if (key === 'visibleCharacters' && Array.isArray(field)) {
        const mapped = field.map((entry) => entry && typeof entry === 'object' && typeof entry.id === 'string'
          ? { ...entry, id: resolve(entry.id) } : entry);
        return [key, mapped.filter((entry, index) => !entry?.id || mapped.findIndex((other) => other?.id === entry.id && other?.presence === entry.presence) === index)];
      }
      if (characterIdArrays.has(key) && Array.isArray(field)) {
        return [key, [...new Set(field.map((id) => typeof id === 'string' ? resolve(id) : id))]];
      }
      if ((key === 'characterId' || key === 'holder' || (key === 'subject' && (item as { track?: string }).track !== 'prop')) && typeof field === 'string') {
        return [key, resolve(field)];
      }
      return [key, walk(field)];
    }));
  };
  const result = walk(value) as T;
  return JSON.stringify(result) === JSON.stringify(value) ? value : result;
}

/** Shared by AI writes, manual upserts and old-project migration. */
export function reconcileCharacterIdentity(
  data: WorkshopData,
  incoming: readonly CharacterPatch[] = [],
  mode: BreakdownWriteMode = 'merge',
): { data: WorkshopData; changed: boolean } {
  const aliases = { ...(data.characterIdAliases ?? {}) };
  const resolve = (id: string): string => {
    const seen = new Set<string>();
    while (Object.prototype.hasOwnProperty.call(aliases, id) && !seen.has(id)) { seen.add(id); id = aliases[id]; }
    return id;
  };
  const characters: WsCharacter[] = [];
  for (const item of data.characters ?? []) {
    const matches = characters.filter((c) => c.id === item.id || sameCharacter(c, item));
    const match = matches.length === 1 ? matches[0] : undefined;
    if (!match) { characters.push(item); continue; }
    characters[characters.indexOf(match)] = combineAssets(match, item);
    if (item.id !== match.id) aliases[item.id] = match.id;
  }
  const patches: CharacterPatch[] = [];
  // Include earlier items from this same write so batched duplicates are caught.
  const identities = [...characters];
  for (const item of incoming) {
    const id = resolve(item.id);
    const knownAlias = id !== item.id;
    const matches = identities.filter((c) => sameCharacter(c, item));
    const match = identities.find((c) => c.id === id) ?? (matches.length === 1 ? matches[0] : undefined);
    if (match) {
      if (item.id !== match.id) aliases[item.id] = match.id;
      // AI re-submission under another ID may not replace selected assets.
      const patch = item.id === match.id || knownAlias
        ? { ...item, id: match.id }
        : combineAssets(match, { ...item, id: match.id } as WsCharacter);
      patches.push(patch);
      identities[identities.indexOf(match)] = { ...match, ...patch };
    } else {
      patches.push(item);
      identities.push(item as WsCharacter);
    }
  }
  const nextCharacters = mergeBreakdownRecords(characters, patches, mode);
  const liveIds = new Set(nextCharacters.map((c) => c.id));
  for (const id of Object.keys(aliases)) {
    const target = resolve(id);
    if (id === target || liveIds.has(id) || !liveIds.has(target)) delete aliases[id];
    else aliases[id] = target;
  }
  const shots = (data.shots ?? []).map((shot) => {
    const next = remapCharacterReferences(shot, aliases);
    return next === shot ? shot : { ...next, promptNeedsRefresh: true };
  });
  const next: WorkshopData = {
    ...data,
    characters: nextCharacters,
    ...(Object.keys(aliases).length || data.characterIdAliases ? { characterIdAliases: aliases } : {}),
    shots,
    ...(data.characterHandoffs ? { characterHandoffs: remapCharacterReferences(data.characterHandoffs, aliases) } : {}),
    ...(data.bibles ? { bibles: remapCharacterReferences(data.bibles, aliases) } : {}),
  };
  const changed = JSON.stringify(next) !== JSON.stringify(data);
  return { data: changed ? next : data, changed };
}
