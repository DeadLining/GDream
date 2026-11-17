interface RewriteSnapshot {
  projectId: string | null;
  data: string;
  prompt: string;
}
/** Compare both persisted node state and its currently visible unsaved draft. */
export function assertRewriteSnapshot(before: RewriteSnapshot, now: {
  projectId: string | null;
  data?: string;
  prompt?: string;
  switching: boolean;
  aborted: boolean;
}): void {
  if (now.aborted || now.switching || before.projectId !== now.projectId)
    throw new Error('改写已取消或项目已切换，未写入结果');
  if (now.data !== before.data || (now.prompt !== undefined && now.prompt !== before.prompt))
    throw new Error('原节点或提示词已修改，未覆盖新内容；请重新优化');
}
