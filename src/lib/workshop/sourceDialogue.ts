/** Conservative extraction: only explicit speaker: quoted speech, never arbitrary quotes. */
export interface SourceDialogueLine { speaker: string; text: string; sourceLine: string }
export function explicitSourceDialogue(source: string): SourceDialogueLine[] {
  const lines: SourceDialogueLine[] = [];
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([^：:\n]{1,40})[：:]\s*[“「"]([^”」"\n]+)[”」"]/u);
    if (match) lines.push({ speaker: match[1].trim(), text: match[2], sourceLine: match[0].trim() });
  }
  return lines;
}
const normalize = (text: string) => text.normalize('NFKC').replace(/[\s“”「」"，。！？、；：:,.!?;…—_-]+/gu, '');
/** Ordered occurrence matching preserves repeated lines; not a semantic quality score. */
export function missingSourceDialogue(source: string, dialogues: readonly string[]): SourceDialogueLine[] {
  const saved = normalize(dialogues.join('\n'));
  let cursor = 0;
  return explicitSourceDialogue(source).filter((line) => {
    const text = normalize(line.text);
    if (!text) return false;
    const at = saved.indexOf(text, cursor);
    if (at < 0) return true;
    cursor = at + text.length;
    return false;
  });
}
