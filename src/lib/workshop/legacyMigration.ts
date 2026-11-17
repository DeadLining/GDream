import { normalizeCharacterBibleRules } from './bibleNormalization.ts';
import { reconcileCharacterIdentity } from './characterIdentity.ts';
import { normalizeShotProductionPacket } from './productionPacket.ts';
import { filterDeletedVideoCandidates } from './shotMutation.ts';
import {
  emptyWorkshopData,
  type AssetCandidate,
  type WorkshopData,
  type WsCharacter,
  type WsColorPalette,
  type WsProp,
  type WsScene,
  type WsShot,
} from './types.ts';

function asRecord(value: unknown): Partial<WorkshopData> {
  return value && typeof value === 'object' ? value as Partial<WorkshopData> : {};
}

function normalizeAsset<T extends WsCharacter | WsScene | WsProp | WsColorPalette>(
  item: T,
  now: number,
): { item: T; changed: boolean } {
  if (!item.assetImagePath || item.candidates?.length) return { item, changed: false };
  const candidate: AssetCandidate = {
    path: item.assetImagePath,
    source: 'source' in item && item.source === 'default' ? 'default' : 'upload',
    createdAt: 'createdAt' in item && typeof item.createdAt === 'number' ? item.createdAt : now,
  };
  return { item: { ...item, candidates: [candidate] }, changed: true };
}

function normalizeShots(
  shots: WsShot[],
  projectId: string,
): { shots: WsShot[]; changed: boolean } {
  const usedIds = new Set<string>();
  let changed = false;
  const normalized = shots.map((shot, index) => {
    let id = shot.id;
    if (!id || usedIds.has(id)) {
      let suffix = index + 1;
      id = `shot-${projectId}-legacy-${suffix}`;
      while (usedIds.has(id)) {
        suffix += 1;
        id = `shot-${projectId}-legacy-${suffix}`;
      }
      changed = true;
    }
    usedIds.add(id);
    if (!Array.isArray(shot.characterIds)
      || !Array.isArray(shot.propIds)
      || !Array.isArray(shot.voiceCharacterIds)
      || typeof shot.description !== 'string') {
      changed = true;
    }
    const lastProductionPacket = normalizeShotProductionPacket(
      shot.lastProductionPacket,
      { projectId, shotNo: shot.shotNo },
    );
    const rawVideoCandidates = filterDeletedVideoCandidates(
      shot.videoCandidates,
      shot.deletedVideoCandidatePaths,
      shot.deletedVideoCandidateIds,
      shot.deletedVideoCandidateNodeIds,
      shot.videoProductionBinding?.path === shot.videoPath ? shot.videoProductionBinding : undefined,
    );
    const videoCandidates = rawVideoCandidates?.map((candidate) => ({
      ...candidate,
      productionPacket: normalizeShotProductionPacket(
        candidate.productionPacket,
        { projectId, shotNo: shot.shotNo },
      ),
    }));
    if (JSON.stringify(lastProductionPacket) !== JSON.stringify(shot.lastProductionPacket)
      || JSON.stringify(videoCandidates) !== JSON.stringify(shot.videoCandidates)) {
      changed = true;
    }
    const cleanShot: WsShot = { ...shot };
    const legacyWhiteboxExtras = (shot.extraRefImages ?? []).filter((path) => /(?:white[_-]?model|whitebox|blender)/i.test(path));
    if (legacyWhiteboxExtras.length > 0) {
      cleanShot.extraRefImages = (shot.extraRefImages ?? []).filter((path) => !legacyWhiteboxExtras.includes(path));
    }
    for (const key of ['topologyImagePath', 'stageBImagePath', 'blendPath', 'topologyRevision', 'directorPrevisVideoPaths', 'directorDecisionRequired', 'directorDecision', 'firstFrameMode']) {
      if (key in cleanShot) {
        delete (cleanShot as unknown as Record<string, unknown>)[key];
        changed = true;
      }
    }
    if (legacyWhiteboxExtras.length > 0) changed = true;
    return {
      ...cleanShot,
      id,
      description: shot.description ?? '',
      characterIds: [...(shot.characterIds ?? [])],
      propIds: [...(shot.propIds ?? [])],
      voiceCharacterIds: [...(shot.voiceCharacterIds ?? [])],
      videoCandidates,
      lastProductionPacket,
    };
  });
  return { shots: normalized, changed };
}

export function normalizeLegacyWorkshopData(
  value: unknown,
  projectId: string,
  now = Date.now(),
): { data: WorkshopData; changed: boolean } {
  const input = asRecord(value);
  const defaults = emptyWorkshopData(projectId);
  let changed = !value || typeof value !== 'object' || input.projectId !== projectId;
  const requiredArrays: Array<keyof WorkshopData> = [
    'scriptRevisions', 'episodes', 'narrativeBeats', 'characters', 'scenes',
    'props', 'colorPalettes', 'shots', 'changelog',
  ];
  if (requiredArrays.some((key) => !Array.isArray(input[key]))) changed = true;
  if (!input.steps || typeof input.synopsis !== 'string' || !input.currentStep) changed = true;

  const normalizeAssets = <T extends WsCharacter | WsScene | WsProp | WsColorPalette>(items: T[]) => items.map((item) => {
    const result = normalizeAsset(item, now);
    changed ||= result.changed;
    return result.item;
  });
  const shotResult = normalizeShots((input.shots ?? []) as WsShot[], projectId);
  changed ||= shotResult.changed;

  const normalized = {
    changed,
    data: {
      ...defaults,
      ...input,
      projectId,
      currentStep: input.currentStep ?? defaults.currentStep,
      steps: { ...defaults.steps, ...(input.steps ?? {}) },
      synopsis: input.synopsis ?? '',
      scriptRevisions: input.scriptRevisions ?? [],
      episodes: input.episodes ?? [],
      narrativeBeats: input.narrativeBeats ?? [],
      characters: normalizeAssets((input.characters ?? []) as WsCharacter[]),
      scenes: normalizeAssets((input.scenes ?? []) as WsScene[]),
      props: normalizeAssets((input.props ?? []) as WsProp[]),
      colorPalettes: normalizeAssets((input.colorPalettes ?? []) as WsColorPalette[]),
      shots: shotResult.shots,
      changelog: input.changelog ?? [],
    },
  };
  const characterBible = normalized.data.bibles?.character;
  if (characterBible) {
    const normalizedRules = normalizeCharacterBibleRules(
      characterBible.rules as unknown,
      normalized.data.characters,
      characterBible.globalRules,
    );
    changed ||= JSON.stringify(normalizedRules.rules) !== JSON.stringify(characterBible.rules)
      || JSON.stringify(normalizedRules.globalRules) !== JSON.stringify(characterBible.globalRules);
    normalized.data.bibles = {
      ...normalized.data.bibles,
      character: {
        ...characterBible,
        rules: normalizedRules.rules,
        globalRules: normalizedRules.globalRules,
      },
    };
  }
  const identity = reconcileCharacterIdentity(normalized.data);
  return { data: identity.data, changed: changed || identity.changed };
}

