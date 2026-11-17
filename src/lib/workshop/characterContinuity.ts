import type { WorkshopData } from './types.ts';

export interface CharacterHandoffIssue {
  handoffId: string;
  message: string;
}

function normalized(value: string | undefined): string {
  return value?.trim() ?? '';
}

export function validateCharacterHandoffs(data: Pick<WorkshopData, 'episodes' | 'characters' | 'shots' | 'characterHandoffs'>): CharacterHandoffIssue[] {
  const episodeOrder = new Map(data.episodes.map((episode, index) => [normalized(episode.no), index]));
  const characterIds = new Set(data.characters.map((character) => character.id));
  // Accept either the durable shot id or the human shotNo. Models naturally
  // reference "02-01" while the store keys on an opaque id; supporting both
  // avoids spurious "未找到绑定镜头" failures on otherwise-correct handoffs.
  const shotById = new Map<string, (typeof data.shots)[number]>();
  for (const shot of data.shots) {
    if (shot.id) shotById.set(shot.id, shot);
    shotById.set(shot.shotNo, shot);
  }
  const seen = new Set<string>();
  const issues: CharacterHandoffIssue[] = [];
  for (const handoff of data.characterHandoffs ?? []) {
    const id = normalized(handoff.id) || '(unknown)';
    const source = normalized(handoff.sourceEpisode);
    const target = normalized(handoff.targetEpisode);
    const key = `${handoff.characterId}|${source}|${target}`;
    if (seen.has(key)) issues.push({ handoffId: id, message: '同一角色的同一跨集 handoff 重复。' });
    seen.add(key);
    if (!characterIds.has(handoff.characterId)) issues.push({ handoffId: id, message: `引用了不存在的角色 ${handoff.characterId}。` });
    if (!episodeOrder.has(source) || !episodeOrder.has(target)) issues.push({ handoffId: id, message: 'sourceEpisode/targetEpisode 必须引用已存在的分集编号。' });
    else if ((episodeOrder.get(source) ?? 0) >= (episodeOrder.get(target) ?? 0)) issues.push({ handoffId: id, message: 'sourceEpisode 必须严格早于 targetEpisode。' });
    if (!normalized(handoff.inheritedState) || !normalized(handoff.intendedChange)) issues.push({ handoffId: id, message: '必须明确 inheritedState 和 intendedChange，不能让系统猜测跨集状态。' });
    // shotIds 必须绑定“目标集里该角色出场的镜头”（交接的落点），不是源集的
    // 最后一镜。模型经常绑成源集尾镜，所以错误信息要直接给出合法候选。
    // Prefer the human shotNo in the hint: opaque ids (shot-proj-…-uuid) are
    // unreadable and prone to copy errors, while shotNo is what authors use.
    const validTargetShotIds = data.shots
      .filter((shot) => normalized(shot.episode) === target && (shot.characterIds ?? []).includes(handoff.characterId))
      .map((shot) => `${shot.shotNo}${shot.id ? `(id:${shot.id})` : ''}`);
    const validTargetHint = validTargetShotIds.length > 0
      ? `targetEpisode ${target} 中该角色可用镜头：${validTargetShotIds.slice(0, 8).join('、')}${validTargetShotIds.length > 8 ? ' 等' : ''}。`
      : `targetEpisode ${target} 中当前还没有该角色出场的镜头，请先补齐目标集分镜再写 handoff。`;
    if (handoff.shotIds.length === 0) {
      issues.push({ handoffId: id, message: `至少绑定一个 targetEpisode ${target} 中出现该角色的镜头。${validTargetHint}` });
    }
    // A handoff may legitimately reference the source tail shot AND the target
    // landing shot. What matters is that the target landing is actually
    // recorded, so we require >=1 target shot but tolerate source shots.
    let hasTargetShot = false;
    for (const shotId of handoff.shotIds) {
      const shot = shotById.get(shotId);
      if (!shot) {
        issues.push({ handoffId: id, message: `未找到绑定镜头 ${shotId}。${validTargetHint}` });
        continue;
      }
      const shotEpisode = normalized(shot.episode);
      const referencesCharacter = (shot.characterIds ?? []).includes(handoff.characterId);
      if (shotEpisode !== source && shotEpisode !== target) {
        issues.push({
          handoffId: id,
          message: `镜头 ${shot.shotNo} 属于 episode ${shotEpisode || '(未标注)'}，既不是 sourceEpisode ${source} 也不是 targetEpisode ${target}。${validTargetHint}`,
        });
      } else if (!referencesCharacter) {
        issues.push({ handoffId: id, message: `镜头 ${shot.shotNo} 没有引用角色 ${handoff.characterId}。${validTargetHint}` });
      } else if (shotEpisode === target) {
        hasTargetShot = true;
      }
    }
    if (handoff.shotIds.length > 0 && !hasTargetShot) {
      issues.push({
        handoffId: id,
        message: `shotIds 目前只绑定了源集镜头，缺少 targetEpisode ${target} 的落点镜头。请至少加入一个目标集里该角色出场的镜头。${validTargetHint}`,
      });
    }
    const visual = handoff.visualHandoff;
    if (visual?.mode === 'preserve' && visual.sourceVariantId !== visual.targetVariantId) issues.push({ handoffId: id, message: 'visualHandoff=preserve 时 sourceVariantId 与 targetVariantId 必须一致。' });
    if (visual?.mode === 'change' && (!visual.sourceVariantId || !visual.targetVariantId || visual.sourceVariantId === visual.targetVariantId || !normalized(visual.changeReason))) issues.push({ handoffId: id, message: 'visualHandoff=change 必须使用不同变体并填写 changeReason。' });
    if (handoff.identityHandoff?.mode === 'change' && !normalized(handoff.identityHandoff.changeReason)) issues.push({ handoffId: id, message: 'identityHandoff=change 必须填写 changeReason。' });
  }
  return issues;
}

export function characterHandoffsAreValid(data: Pick<WorkshopData, 'episodes' | 'characters' | 'shots' | 'characterHandoffs'>): boolean {
  return validateCharacterHandoffs(data).length === 0;
}
