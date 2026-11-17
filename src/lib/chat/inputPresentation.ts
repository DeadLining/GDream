export interface InputPresentation { fullText: string; userText: string; context: string; generated: boolean; summary: string; }
/** Only recognized system envelopes are separated; freeform user prose is never rewritten. */
export function presentInput(fullText: string): InputPresentation {
  let userText = fullText;
  let context = '';
  const envelopePrefix = /^\s*(\[(?:工坊上下文[：:]|用户正在|用户附加了以下文件|你是一个有审美态度的视频特效设计师)[\s\S]*?\]\s*\n\n)/;
  // Advertising requests carry a long, persisted policy block after the
  // opening marker. It is execution context, not the user's task. Keep it in
  // the collapsible context section; otherwise every continuation run renders
  // the same research rules as if they were a new task.
  const adContextPrefix = /^\s*(\[广告任务上下文[：:][^\n]*\][\s\S]*?\n\n)/;
  while (true) {
    const match = userText.match(envelopePrefix) ?? userText.match(adContextPrefix);
    if (!match) break;
    context += match[1]; userText = userText.slice(match[0].length);
  }
  const generated = /^\s*(?:\[(?:一键全流程|工坊任务|广告任务|episode-screenwriter)|【(?:一键全流程|继续一键全流程|工坊任务|广告任务|episode-screenwriter))/.test(userText)
    || /^请对当前工坊项目执行/.test(userText);
  const summary = userText.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 3).map((s) => s.slice(0, 110)).join('\n');
  return { fullText, userText, context, generated, summary };
}
