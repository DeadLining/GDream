/** A scoped DSH task, not a full breakdown or media-generation request. */
export function buildSynopsisRewritePrompt(): string {
  return `重写故事梗概，仅更新当前项目顶层 synopsis，约300–500字中文。
先读取当前 synopsis、用户 brief、作品与受众设置以及必要的已保存事实。广告从梗概阶段设计一条连贯主线、段落推进和共享资产关系，不把功能目录直接拆成孤立片段；无需提前锁死镜头数量。复用同一产品、空间与业务资料，区分同一资产状态变化与不同产物的来源关系；未确认型号、授权、真实界面仍标明待确认，不虚构产品能力或全自动业务链。
优先按用户原始要求和可靠资料创作，已有资产仅作为复用条件，不强迫新梗概迁就旧的七镜结构。
本次不修改 episodes（含本集梗概和正式剧本）、narrativeBeats、角色、场景、道具、分镜、提示词、候选或剪辑；不生成任何媒体，不采用候选，不启动一键全流程，不标记下游已完成。
已有拆解使用 workshop_set_breakdown，mode:"merge"，仅提交 synopsis；其他字段省略，绝不能传空数组或 mode:"replace"。以工具实际 schema 和写入回执为准，若工具不支持安全局部保存，返回新版文本并明确未保存，不绕过工具写文件。随后只回读 synopsis 核对保存文本。说明原有下游内容仍是旧版，列出后续需要对齐的范围，但本轮不要执行对齐。
最终回复展示完整新版梗概、保存结果和仍待确认的事实。`;
}
