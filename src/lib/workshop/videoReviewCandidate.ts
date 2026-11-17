/** Reviewing a candidate does not require (or create) an accepted binding. */
export function selectVideoReviewCandidate<T extends { path: string }>(
  shot: { videoPath?: string; videoCandidates?: T[] }, candidatePath?: string,
): T {
  const candidates = shot.videoCandidates ?? [];
  if (candidatePath !== undefined) {
    const candidate = candidates.find(item => item.path === candidatePath);
    if (!candidate) throw new Error('指定路径不属于该镜头已保存的视频候选，不能读取');
    return candidate;
  }
  const bound = candidates.find(item => item.path === shot.videoPath);
  if (bound) return bound;
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) throw new Error('存在多个未绑定候选，请从审核清单选择 candidate_path，不自动采用');
  throw new Error('分镜没有已保存的视频候选，请核对生成回执；不要反复读取或扫描目录');
}
