/** Narrow user consent: synchronise one episode's old shots to saved screenplay. */
export interface ShotSyncAuthorization { episode: string; request: string }
export function parseShotSyncAuthorization(text: string): ShotSyncAuthorization | undefined {
  if (/(?:不允许|不同意|不要|禁止|取消授权)/u.test(text)) return undefined;
  const episode = text.match(/第\s*(\d+)\s*集/u)?.[1];
  if (!episode || !/(?:授权|允许|同意)/u.test(text) || !/(?:修改|同步|修正)/u.test(text)
    || !/(?:镜头|分镜)/u.test(text) || !/(?:对白|动作)/u.test(text)) return undefined;
  return { episode: String(Number(episode)), request: text };
}
export function selectedShotSyncConsent(questions: Array<{ options: Array<{ label: string; disabled?: boolean }> }>, answers: Array<{ selected: string[]; freeText?: string }>): ShotSyncAuthorization | undefined {
  let consent: ShotSyncAuthorization | undefined;
  for (let i = 0; i < answers.length; i++) {
    const answer = answers[i];
    const labels = answer.selected.filter((label) => questions[i]?.options.some((option) => !option.disabled && option.label === label));
    // Only what the user actually selected/typed counts. Never include unselected options or question prose.
    for (const text of [...labels, answer.freeText ?? '']) consent = parseShotSyncAuthorization(text) ?? consent;
  }
  return consent;
}
const allowed = new Set(['dialogue', 'sourceExcerpt', 'description', 'atomicAction', 'actionTimeline', 'entryState', 'exitState', 'soundIntent', 'characterIds', 'voiceCharacterIds', 'propIds']);
export function permitsShotSync(consent: ShotSyncAuthorization | undefined, shot: { episode?: string; shotNo: string }, fields: string[]): boolean {
  const episode = String(Number(shot.episode || shot.shotNo.match(/^(\d+)-/u)?.[1]));
  return Boolean(consent && consent.episode === episode && fields.every((field) => allowed.has(field)));
}
