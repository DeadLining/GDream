import type { WorkshopProjectBibles, WsCharacter } from './types.ts';

type CharacterRule = NonNullable<WorkshopProjectBibles['character']>['rules'][number];

export interface NormalizedCharacterBibleRules {
  rules: CharacterRule[];
  globalRules: string[];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function reconstructIndexedString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .flatMap(([key, item]) => {
      const index = Number(key);
      return Number.isInteger(index) && index >= 0 && typeof item === 'string'
        ? [[index, item] as const]
        : [];
    })
    .sort(([a], [b]) => a - b);
  return entries.length > 1 ? entries.map(([, item]) => item).join('') : undefined;
}

function normalizedName(value: string): string {
  return value
    .replace(/[（(][^（）()]*[)）]/gu, '')
    .replace(/[\s·・]/gu, '')
    .trim();
}

function characterNameCandidates(character: WsCharacter): string[] {
  const names = new Set<string>();
  const full = normalizedName(character.name);
  if (full) names.add(full);
  // Rules often address a character by given name without the surname
  // (for example 宇智波佐助 -> 佐助). Prefer longer forms first when matching.
  if (/^[\u3400-\u9fff]{3,}$/u.test(full)) names.add(full.slice(-2));
  for (const match of character.name.matchAll(/[（(]([^（）()]+)[)）]/gu)) {
    const alias = normalizedName(match[1]);
    if (alias) names.add(alias);
  }
  return [...names];
}

function matchedCharacterIds(text: string, characters: readonly WsCharacter[]): string[] {
  return characters
    .map((character) => ({
      id: character.id,
      longestMatch: Math.max(0, ...characterNameCandidates(character)
        .filter((name) => name.length > 1 && text.includes(name))
        .map((name) => name.length)),
    }))
    .filter((entry) => entry.longestMatch > 0)
    .map((entry) => entry.id);
}

function isCharacterRule(value: unknown): value is CharacterRule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.characterId === 'string'
    && typeof record.lockedAppearance === 'string';
}

/**
 * Repair legacy character bible rules without changing their meaning.
 *
 * A previous serializer turned each rule string into an array entry indexed by
 * character (`{0:"二",1:"郎",...}`). Reconstruction preserves the exact text.
 * Reconstructed rules are bound only when exactly one canonical character is
 * named; otherwise they remain project-global rules.
 */
export function normalizeCharacterBibleRules(
  value: unknown,
  characters: readonly WsCharacter[] = [],
  existingGlobalRules: unknown = [],
): NormalizedCharacterBibleRules {
  const rules: CharacterRule[] = [];
  const globalRules = asStringArray(existingGlobalRules);

  if (Array.isArray(value)) {
    for (const rawRule of value) {
      if (isCharacterRule(rawRule)) {
        rules.push({
          characterId: rawRule.characterId,
          lockedAppearance: rawRule.lockedAppearance,
          costumeRules: asStringArray(rawRule.costumeRules),
          voiceRules: typeof rawRule.voiceRules === 'string' ? rawRule.voiceRules : undefined,
          lifecycleRules: rawRule.lifecycleRules
            ? asStringArray(rawRule.lifecycleRules)
            : undefined,
        });
        continue;
      }
      const reconstructed = reconstructIndexedString(rawRule);
      if (!reconstructed?.trim()) continue;
      const matched = matchedCharacterIds(reconstructed, characters);
      if (matched.length === 1) {
        rules.push({
          characterId: matched[0],
          lockedAppearance: reconstructed,
          costumeRules: [],
        });
      } else {
        globalRules.push(reconstructed);
      }
    }
  }

  return {
    rules: rules.filter((rule, index) => rules.findIndex((item) =>
      item.characterId === rule.characterId && item.lockedAppearance === rule.lockedAppearance) === index),
    globalRules: [...new Set(globalRules.filter(Boolean))],
  };
}
