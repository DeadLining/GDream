# AI Comic Studio v0.7.0 整集 AI 成片闭环实施计划

对应能力合同：`docs/superpowers/specs/2026-07-15-ai-comic-studio-v0.7-full-episode-loop.md`

## 交付目标

把现有分散的剧本、角色参考、画面、配音、视频、渲染和发布能力编排为一个持久化、可暂停、可恢复、默认由 AI 推进的整集生产流程。

## Task 1: 升级真实模型 E2E 合同

- [x] 将真实 E2E 从单镜头扩展为全部镜头。
- [x] 验证所有非空对白的 TTS 产物。
- [x] 验证整集 MP4、真实 Render Review、终审候选、门禁和发布登记。
- [x] 浏览器验证镜头视频与终审成片均可播放。
- [ ] 在真实渠道上完成一次多镜头、有对白的完整运行并保存审计结果。

## Task 2: 持久化整集编排模型

- [ ] 新增可逆 Alembic migration：`episode_ai_runs`、`episode_ai_run_stages`。
- [ ] 主流程状态包含 scripting、structuring、references、panels、panel_review、speech、videos、rendering、quality_review、release_candidate、release_gate、published。
- [ ] 每个阶段持久化状态、进度、输入实体、输出资产、错误、attempt、开始与结束时间。
- [ ] 为同一剧集建立单个活动整集 run 约束和幂等键。

验收：API 重启后可恢复 run；重复启动不会产生两套活动任务；旧项目无需迁移操作即可正常打开。

## Task 3: 整集 AI 编排服务与 API

- [ ] 新增 `EpisodeAIOrchestrator`，只负责依赖推进，不复制模型 provider 逻辑。
- [ ] 复用现有 script generation、script import、character reference、panel、speech、video、render review、release publication 服务。
- [ ] 提供创建、查询、暂停、继续、取消、重试失败阶段 API。
- [ ] 阶段失败时保留已完成资产，只失效并重跑必要下游。
- [ ] 所有返回错误经过现有 redaction，不暴露渠道密钥。

验收：无前端参与也能通过 API 完成整集流程；任一阶段失败后可以从该阶段恢复。

## Task 4: 默认 AI 审核策略

- [ ] 角色参考只有媒体有效且生成元数据完整时自动批准和激活。
- [ ] 画面自动审核检查空图、尺寸、参考绑定和连续性基础字段。
- [ ] 视频自动审核检查 MP4、时长、激活关系和生成错误。
- [ ] 关键审核失败进入 `needs_review`，不得继续生成终审候选。
- [ ] 人工要求修改继续复用视觉审阅候选，不自动采纳。

验收：AI 默认流畅推进，但任何关键失败都无法绕过最终门禁。

## Task 5: 现代创作 Studio 一键入口

- [ ] 在剧本创作/单集制作提供“AI 生成整集”主命令。
- [ ] 显示当前阶段、总进度、镜头进度、失败项、模型与耗时。
- [ ] 提供暂停、继续、重试、进入人工审阅和打开终审成片。
- [ ] 页面刷新、API 重启和 VPN 切换后仍能恢复状态。
- [ ] 桌面保持密集工作台布局；移动端使用纵向阶段列表，不出现横向内容覆盖。

验收：用户从主题输入开始，无需逐镜头点击即可到达审核发布页的终审成片。

## Task 6: 可观测性与成本边界

- [ ] 每个阶段记录 provider、model、调用次数、耗时和资产 ID。
- [ ] 复用预算服务支持 observe、warn、cap。
- [ ] Model Center 能从整集 run 追溯到具体模型调用。
- [ ] Mock SSH 断线时给出可恢复错误，恢复连接后允许继续。

验收：能够回答一次整集生成用了哪些模型、耗时多久、失败在哪里、生成了哪些资产。

## Task 7: v0.7.0 发布门

- [ ] API、Web、Compositor 全量测试通过。
- [ ] Playwright 桌面与移动端通过，无重叠、空白播放器或不可达操作。
- [ ] 真实模型 E2E 完整通过并保存结果、截图、阶段耗时和最终 MP4。
- [ ] `npm audit`、`pip audit` 和 secret scan 完成，已知风险写入发布审计。
- [ ] 统一更新 root、Web、Compositor、Python 和 lockfile 版本为 `0.7.0`。
- [ ] 创建 `docs/release-audits/2026-07-XX-v0.7.0.md`，验证后再合并和打 tag。

## 模型与技术需求

v0.7.0 第一阶段不需要新增模型 API：

- LLM：现有 MiniMax-M3，用于剧本与结构规划。
- 图片：现有 GPT Image 渠道，用于角色参考和镜头画面。
- TTS：现有 Qwen3-TTS 服务，继续支持 Mock SSH。
- 视频：现有 Wan2.2-TI2V-5B 渠道，继续支持 Mock SSH。
- 合成与 QC：本地 Compositor、FFmpeg/FFprobe、Render Review。

真正新增的是持久化编排层、自动审核策略和整集状态 UI，不是新的模型供应商。
