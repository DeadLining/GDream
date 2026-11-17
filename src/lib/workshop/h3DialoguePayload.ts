/** Strip wrapping quotation marks only; punctuation inside the utterance is immutable. */
export function unquoteH3Dialogue(value: string): string {
  const text = value.trim();
  const pairs: Record<string, string> = { '“': '”', '‘': '’', '"': '"', "'": "'", '「': '」', '『': '』' };
  return text.length > 1 && pairs[text[0]] === text[text.length - 1] ? text.slice(1, -1).trim() : text;
}

/**
 * Submission safety net, independent of a supplied script whitelist. Remove only
 * verbatim tagged copies outside the authoritative action section. Repeated
 * utterances inside that section may be intentional, so preserve them all.
 * Prompts without the workshop section structure (including Ref2VA) are untouched.
 */
export function deduplicateH3SectionDialogue(prompt: string): string {
  const start = prompt.indexOf('[ACTION_ENGINE]');
  const end = prompt.indexOf('[DIALOGUE]', start + 1);
  if (start < 0 || end <= start) return prompt;
  const tags = [...prompt.matchAll(/<d\s*>\s*(\[[^\]\r\n]+\])?\s*([\s\S]*?)<\/d\s*>/giu)];
  const key = (match: RegExpMatchArray) => `${(match[1] ?? '').toLowerCase()}\u0000${unquoteH3Dialogue(match[2])}`;
  const inside = (match: RegExpMatchArray) => (match.index ?? 0) >= start && (match.index ?? 0) + match[0].length <= end;
  const spoken = new Set(tags.filter(inside).map(key));
  let result = prompt;
  for (const tag of tags.filter((tag) => !inside(tag) && spoken.has(key(tag))).reverse()) {
    const index = tag.index ?? 0;
    result = result.slice(0, index) + '(speech specified in the action timeline)' + result.slice(index + tag[0].length);
  }
  return result;
}
