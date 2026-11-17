/**
 * Returns whether a named character is being described as a visible physical
 * participant in a prompt. Mentions in dialogue, future-story hooks, or
 * negative instructions are not visual appearances and must not force a
 * character reference binding.
 */
export function promptHasVisibleCharacterMention(prompt: string, characterName: string): boolean {
  const name = characterName.trim();
  if (!prompt || !name) return false;

  // Dialogue text can name another character without putting that person in
  // the shot. Keep the speaker label, but remove the spoken payload itself.
  const visualText = prompt
    .replace(/<d\b[^>]*>[\s\S]*?<\/d>/giu, '')
    .replace(/<dialogue\b[^>]*>[\s\S]*?<\/dialogue>/giu, '')
    .replace(/(?:对白|台词|spoken\s+line|dialogue)\s*[：:]\s*[“"「][\s\S]*?[”"」]/giu, '')
    .replace(/[“"「][^”"」]*[”"」]/gu, '');

  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const namePattern = new RegExp(escapedName, 'u');
  const chunks = visualText.split(/[\n。！？!?；;：:]/u);

  return chunks.some((rawChunk) => {
    const chunk = rawChunk.trim();
    if (!namePattern.test(chunk)) return false;

    // These are references to a story fact or a future/remote cue, not a
    // visible body that can be grounded by a character asset in this shot.
    if (/(?:名字|名号|点名|提到|提及|称作|称为|命令.*(?:派|调)|军令.*(?:提|点)|下一(?:镜|场|集)|后续|之后|随后才|将要|即将|赶来|传来|远处.*(?:声音|军令|人影)|不在画面|画外|画外音|只闻其声|不可见|不出现|不要出现|不得出现|不入画|仅作背景信息)/u.test(chunk)) {
      return false;
    }

    // A named character must be accompanied by a visual/staging claim. This
    // avoids treating a plot summary, relationship note, or quoted text as an
    // additional on-screen cast member.
    return /(?:角色|人物|主体|出镜|入画|画面|镜头|前景|背景|左侧|右侧|中央|身旁|身后|对面|站|立|坐|走|跑|冲|跃|落|进入|离开|出现|可见|身影|剪影|轮廓|脸|目光|看向|盯着|握|持|挥|对峙|交战|战斗|攻击|拦住|逼近|靠近|转身|移动|倒下|被击|骑|跟随|位于|悬在|踏|落在)/u.test(chunk);
  });
}
