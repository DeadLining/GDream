import type { WorkshopData, WorkshopEpisode } from './types.ts';

const SCRIPT_ACTION = /(?:补写|补齐|补全|续写|生成|撰写|编写|重写|扩写|写完整|写出|写一份)[^\n]{0,90}(?:剧本|对白)/u;
export function isEpisodeScriptRequest(input: string): boolean {
  if (/^\[episode-screenwriter/u.test(input.trim())) return true;
  const instruction = input.trim().split('\n')[0];
  return !/^(?:为什么|怎么|如何|请解释|你现在.*逻辑)/u.test(instruction)
    && /(?:第[\d一二三四五六七八九十百零〇两、至到和\s-]+集|分集|逐集|各集|剩余.*集)/u.test(instruction)
    && SCRIPT_ACTION.test(instruction);
}

function episodeNumber(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let result = 0;
  let digit = 0;
  for (const char of value) {
    if (char === '十' || char === '百') { result += (digit || 1) * (char === '十' ? 10 : 100); digit = 0; }
    else if (digits[char] !== undefined) digit = digits[char];
    else return NaN;
  }
  return result + digit;
}

export function hasEpisodeScript(episode: WorkshopEpisode): boolean {
  return Boolean(episode.script?.trim()) && (episode.scriptStatus === 'draft' || episode.scriptStatus === 'frozen');
}

export interface EpisodeScriptTask {
  projectId: string;
  targetEpisodeNos: string[];
  protectedEpisodeNos: string[];
  missingEpisodeNos: string[];
  /** Baseline used to distinguish a requested rewrite from an already-saved script. */
  baselineScripts: Record<string, string>;
  rewrite: boolean;
}

export function resolveEpisodeScriptTask(input: string, data: WorkshopData | null): EpisodeScriptTask | null {
  if (!data || !isEpisodeScriptRequest(input)) return null;
  const instruction = input.split('\n').find((line) => SCRIPT_ACTION.test(line)) ?? input;
  const rewrite = /重写|重新生成|重新编写/u.test(instruction) || /^\[episode-screenwriter/u.test(input.trim());
  const requested = new Set<number>();
  // The UI's explicit target wins over any episode numbers quoted in its source facts.
  const toolTarget = input.match(/episode_no\s*=\s*"([^"]+)"/u)?.[1];
  if (toolTarget) requested.add(episodeNumber(toolTarget));
  else {
    const num = '[\\d一二三四五六七八九十百零〇两]+';
    const ranges = new RegExp(`第\\s*(${num})\\s*(?:集)?\\s*(?:至|到|[-—~～])\\s*(?:第)?\\s*(${num})\\s*集`, 'gu');
    for (const match of instruction.matchAll(ranges)) {
      const start = episodeNumber(match[1]);
      const end = episodeNumber(match[2]);
      // Reject an implausible range rather than silently broadening the task.
      if (end < start || end - start > 200) return null;
      for (let no = start; no <= end; no++) requested.add(no);
    }
    for (const match of instruction.matchAll(new RegExp(`第\\s*(${num}(?:\\s*[、和,，]\\s*${num})*)\\s*集`, 'gu'))) {
      for (const value of match[1].split(/[、和,，]/u)) requested.add(episodeNumber(value.trim()));
    }
  }
  const selected = data.episodes.filter((ep) => requested.size === 0 || requested.has(episodeNumber(ep.no)));
  const protectedEpisodes = selected.filter((ep) => !rewrite && hasEpisodeScript(ep));
  const targets = selected.filter((ep) => rewrite || !hasEpisodeScript(ep));
  return {
    projectId: data.projectId,
    targetEpisodeNos: targets.map((ep) => ep.no),
    protectedEpisodeNos: protectedEpisodes.map((ep) => ep.no),
    missingEpisodeNos: [...requested].filter((no) => !data.episodes.some((ep) => episodeNumber(ep.no) === no)).map(String),
    baselineScripts: Object.fromEntries(targets.map((ep) => [ep.no, ep.script ?? ''])),
    rewrite,
  };
}

export function episodeScriptProgress(task: EpisodeScriptTask, data: WorkshopData | null) {
  const sameProject = task.projectId === data?.projectId;
  const saved = sameProject ? task.targetEpisodeNos.filter((no) => {
    const ep = data!.episodes.find((item) => item.no === no);
    return ep && hasEpisodeScript(ep) && (!task.rewrite || ep.script !== task.baselineScripts[no]);
  }) : [];
  return { saved, remaining: task.targetEpisodeNos.filter((no) => !saved.includes(no)), sameProject };
}

export function buildEpisodeScriptTaskContext(task: EpisodeScriptTask, data: WorkshopData | null): string {
  const progress = episodeScriptProgress(task, data);
  return `[分集剧本任务执行协议 — 只约束执行流程，不替代创作事实]
目标集号：${task.targetEpisodeNos.join('、') || '无待补写集'}。本轮已保存：${progress.saved.join('、') || '无'}。待保存：${progress.remaining.join('、') || '无'}。
已有完整剧本且应保留：${task.protectedEpisodeNos.join('、') || '无'}。未找到的集号：${task.missingEpisodeNos.join('、') || '无'}。
${progress.sameProject ? '' : '当前工坊项目已切换，停止写入原任务。'}
1. 先读取一次 workshop_get_state(detail:"step", section:"episode-script") 获取正式源文、审核记录、季纲、创作要求及真实资产。长返回按 next_call 读完；已在上下文中完整持有时复用，不反复读取全项目。
2. 按目标集顺序推进。需要本集 Beat、已保存正文或上一集实际正文时，调用 workshop_get_state(detail:"step", section:"episode-script", episode:"目标集号")，只读本集资料，不再读取全片分镜/提示词/生成任务。
3. 这是用户授权的剧本创作阶段，不是提示词改写。按已有季纲、角色关系和剧情走向展开完整场次、自然对白、表情、听者反应、声音与进入/离开状态；既有明确对白保留，不把故事规划误当成无对白约束。不要只输出季纲或分镜表。
   保存前自检对白密度：按每个 Scene 的戏剧功能、自然语速、呼吸停顿、话轮交接、必要动作与反应自适应安排台词。用户时长默认是参考，容量不足可延长并汇报预计实际时长；只有明确精确卡时才按硬约束处理。以人物交流推进的场景必须写出连续的多轮交锋，至少呈现立场/诉求、回应或阻力、信息或情绪变化和场景落点中的多个环节；不能只写一两句关键台词或用“双方争执”“人物开始慌乱”等概括代替对白。动作、观察、环境和慢剧留白场景可以减少对白，但不能让动作说明取代本应发生的交流；不能加速、删词或压掉反应来卡参考秒数。用户明确要求无对白、默片或极度留白时遵从用户要求。
4. 每完成一集先做保存前自检：逐场确认对白是否承担本场戏剧推进，人物诉求、回应/阻力、信息或情绪变化和结果落点是否完整，核心冲突是否有足够来回，而不是被旁白或动作直接跳过。若对白驱动场景只有一两句台词、刚提出问题就直接跳到结论，或动作说明挤掉了必要交锋，继续扩写或重排后再保存；不要把未达标的分场提纲当作完整剧本。通过自检后立即调用 workshop_set_episode_script 保存该集，再写下一集；成功回执就是该集检查点，不为确认同一次保存反复读取、审核或重写。已保存目标集直接跳过。不要先在聊天中输出四集长文再统一保存。
5. 保留未请求分集和全部已有镜头；不调用 workshop_set_shots、workshop_set_breakdown、媒体生成，不重建上游 revision，不把整个第②步标记完成。
6. 全部目标集保存后汇报并结束；未找到的集号说明实际缺失，不自行创建。不能把未保存内容说成已完成。`;
}

export function episodeScriptStopNotice(task: EpisodeScriptTask, data: WorkshopData | null, maxTurns: number, receipts?: ReadonlySet<string>): string {
  const progress = episodeScriptProgress(task, data);
  if (receipts) {
    progress.saved = progress.saved.filter((no) => receipts.has(no));
    progress.remaining = task.targetEpisodeNos.filter((no) => !progress.saved.includes(no));
  }
  return `[GDream] 分集剧本任务达到本轮 ${maxTurns} 轮执行上限，未全部完成。\n已保存的目标集：${progress.saved.join('、') || '无'}。\n仍待保存：${progress.remaining.join('、') || '无'}。\n${task.missingEpisodeNos.length ? `未找到的集号：${task.missingEpisodeNos.join('、')}。\n` : ''}已保存内容保留；再次补写同一范围时跳过已有完整剧本，仅处理未完成集。本轮未完成不等于整个第②步已完成。`;
}
