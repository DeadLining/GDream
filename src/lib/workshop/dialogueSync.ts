import { dialogueSupportedByScreenplay as supported } from './breakdownWrite.ts';

/** One source-sync operation: fill blanks, replace stale lines, preserve valid ones. */
export function planDialogueSync(previous: string, next: string, source: string, explicitReplacement = false): { kind: 'fill' | 'replace' | 'supplement' | 'unchanged'; error?: string } {
  if (!supported(next, source)) return { kind: 'replace', error: '新对白必须逐字来自当前正式正文并保持原文顺序，不能编造。请核对原文的表达方式：键入、屏幕文字、字幕或书面引文不等于人物口播，不得添加“人物名：”把它变成对白；这类内容应保留在镜头 description 的动作/画面描述中，无口播则保留 dialogue 为空。若确为口播，逐字复制原文说话人及台词；不要仅改说话人标签重复提交相同失败内容。' };
  if (previous === next) return { kind: 'unchanged' };
  if (!previous.trim()) return { kind: 'fill' };
  if (supported(previous, next)) return { kind: 'supplement' };
  // Replacing stale content does not authorize dropping other, still-valid lines.
  const validOldLines = previous.split(/\r?\n/).filter((line) => line.trim() && supported(line, source));
  if (!explicitReplacement && validOldLines.some((line) => !supported(line, next))) {
    return { kind: 'replace', error: '旧对白中仍符合当前正文的台词不能随冲突内容一起删除；请保留有效台词，只替换不一致部分。' };
  }
  return { kind: 'replace' };
}
