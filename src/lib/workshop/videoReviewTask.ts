import type { WsShot } from './types.ts';
import { boundVideoReview } from './productionLifecycle.ts';

export function needsVideoEvidenceReview(shot: WsShot): boolean {
  if (!shot.videoCandidates?.length) return false;
  const candidate = shot.videoCandidates.find(item => item.path === shot.videoPath);
  if (!candidate || !shot.videoProductionBinding) return true;
  const review = boundVideoReview(shot);
  return !review?.criteria || [review.criteria.continuity, review.criteria.visualIdentity, review.criteria.performance, review.criteria.pacing].some(value => value !== 'pass');
}

/** Review is a DSH task, never a blanket acceptance or a new generation request. */
export function buildVideoReviewTask(shotNos?: string[]): string {
  return `【集中审核已有视频候选】
范围：${shotNos?.length ? shotNos.join('、') : '当前项目所有尚未有效审核采用的视频候选'}。
仅做审核和正式绑定，不生成、重生成、改写提示词或删除素材。先调用 workshop_read_video_evidence（不传 shot_no）获取精简审核清单；已有匹配报告直接复用，不重复读取完整生成历史。具体镜头有待核实的事实时才按范围读取 workshop_get_state。
逐镜先调用 workshop_read_video_evidence，将真实视频采样帧送入当前 DSH 多模态模型；用 workshop_record_video_review 和 reading_id 保存真实四维结论与 observations。其他参考图用 read_image 读取；同时读取对应参考图，对照分镜和产品身份。不能凭文件名、模型成功回执或提示词声称看过视频。不能仅凭静帧声称音频、口播、动作连续性已通过；没有证据的维度必须标为 not-reviewed。
逐镜记录 continuity、visualIdentity、performance、pacing 的真实结论和观察依据。关键内容存在缺陷或证据不足时保留候选并汇总阻塞项，不自动重生成。抽帧审核不是完整视听终审，工具返回 partial-review-saved 时不要再次采用或标记交付完成；可以继续导出待审成片候选。仅满足完整采用要求时调用 workshop_accept_video_candidate，传入准确的 expected_fingerprint、criteria 和 note，写入实际审核依据，不让用户逐镜点击“通过”。若启用了独立终审门禁而尚无有效回执，应明确报告缺少的终审，不绕过门禁。
遵循现有工具权限；已授权的审核集中执行，仅在真正缺少权限或需要业务决定时询问一次具体范围。最后列出采用、未通过和证据不足的镜号，不把未检查的内容写为通过。`;
}
