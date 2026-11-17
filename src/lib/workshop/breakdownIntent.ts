/** Natural-language resume must use the same execution path as the Step ② button. */
export function isBreakdownReconciliationRequest(request: string): boolean {
  if (/^(?:请)?(?:解释|说明|为什么|什么|是否)|(?:只|仅)(?:做)?(?:查看|检查|核对|汇报)|先不(?:要)?(?:执行|修改|写入)/u.test(request)) return false;
  return /(?:正文|剧本)片段/u.test(request)
    && /(?:镜头|分镜)/u.test(request)
    && /(?:继续(?:拆解|拆镜)|只补缺失|补齐缺失镜头)/u.test(request)
    && /(?:补(?:上)?登记|补(?:齐|上)(?:关联|完成)记录|登记完成|关联(?:完成)?记录|同步.*进度)/u.test(request)
    && !/(?:不要|不必|无需|禁止)\s*(?:补登记|登记完成|同步进度)/u.test(request);
}

export function buildBreakdownResumePrompt(): string {
  return '[工坊任务:breakdown]\n保留现有镜头。先核对它们与正文片段的对应关系，已完整覆盖的片段只补登记完成记录，不重写、不新增重复镜头；确实未覆盖的部分才继续拆解。不要仅因完成记录缺失就重新生成，也不要生成任何媒体。';
}
