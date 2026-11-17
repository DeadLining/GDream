# GDream优化完成度审计

审计日期：2026-08-30  
审计分支：`codex/atomic-shot-continuity`  
规范来源：`docs/适配GDreamAPP的优化目标与开发规范文档（Codex开发执行完整版）.md`

## 一、审计口径

本审计不以“代码中出现了相关字段或按钮”作为完成依据，而是分别检查：

1. 生产代码是否存在对应行为；
2. 自动测试是否覆盖关键成功和失败路径；
3. UI 是否具备可操作入口和明确状态；
4. 是否仍依赖真实桌面环境、外部审核服务或付费媒体服务验证；
5. 是否存在会泄露凭证、重复付费或错误复用历史审核的反例。

状态说明：

- **自动验证通过**：核心行为有直接自动测试；
- **实现完成，原生冒烟待验**：代码和纯函数测试存在，但 Tauri 桌面交互尚未实操；
- **外部条件待验**：需要当前不可用的审核服务或用户授权的真实模型；
- **未完成**：缺少必要实现或证据。

## 二、A01–A30 逐项审计

| 编号 | 状态 | 代码证据 | 测试或检查证据 | 尚需验证 |
| --- | --- | --- | --- | --- |
| A01 | 自动验证通过，真实文本模型待验 | `StepScript.tsx` 将 Idea 送入GDream文案工作室文本模型 Agent；`promptBridge.ts` 跨视图挂载可靠保存请求；`storyDirectorPrompt.ts` 固化生成协议，不依赖 Codex 常驻 | `storyDirectorPrompt.test.ts`、`promptBridge.test.ts` 3 项 | 在 Tauri 中实际选择文本模型、生成并导入一次 |
| A02 | 自动验证通过 | `src/lib/workshop/shotPlanning.ts`、`src/lib/workshop/breakdownValidation.ts` 生成 Scene、Beat、Atomic Shot、首尾状态并控制过度拆镜 | `shotPlanning.test.ts`、`breakdownValidation.test.ts` | 用真实长剧本人工抽检镜头数量和节奏 |
| A03 | 自动验证通过 | `src/lib/workshop/shotContinuity.ts` 建立 `exit_state → entry_state` 和道具单向状态账本 | `shotContinuity.test.ts`、`characterContinuity.test.ts` | 用实际项目检查复杂交接、破损和超自然召回 |
| A04 | 自动验证通过，原生冒烟待验 | `StepGenerate.tsx` 冻结项目 ID 与稳定镜头 ID；`workshopStore.updateShotById()` 只更新目标镜头并丢弃项目切换、镜头删除后的迟到结果 | `shotMutation.test.ts` 4 项、TypeScript 检查 | 桌面端点击一次并确认其他镜头字节级不变 |
| A05 | 实现完成，原生冒烟待验 | `StepGenerate.tsx` 提供完整提示词、H3 实际提交快照和生产输入包展开 | 构建和 TypeScript 检查 | 桌面端检查长文本展开、滚动和复制 |
| A06 | 自动验证通过 | `buildShotStartFramePrompt()` 使用上一镜尾帧可见状态、资产继承、当前 0.0 秒开场状态和真实参考输入，不注入完整时间轴或结束状态 | `shotContinuity.test.ts`、`imageReferencePolicy.test.ts` | 真实生图效果需用户授权后抽检 |
| A07 | 自动验证通过 | `buildShotEndFramePrompt()` 使用完整时间轴、最后节拍、尾帧验收、首帧和必要资产 | `shotContinuity.test.ts`、`imageReferencePolicy.test.ts` | 真实生图效果需用户授权后抽检 |
| A08 | 自动验证通过 | 边界帧签名包含模型、提示词与实际参考输入；审核回执绑定输入签名 | `qualityReview.test.ts`、`productionAudit.test.ts` | 桌面端切换模型后的三态提示 |
| A09 | 自动验证通过 | `workshopStore.ts` 最多三次按问题目标重绘，随后置 `qualityReviewRequiresManualReview` | `qualityReview.test.ts` 覆盖第 1/2/3 次和重绘计划 | 真实审核服务恢复后的端到端循环 |
| A10 | 自动验证通过 | `src/lib/canvasGen/sglangH3.ts` 强制 `fl2va` 恰好包含首帧 `0` 和尾帧 `-1` 两个 keyframe，文本提示词始终保留 | `sglangH3.test.ts` | 真实 H3 服务协议冒烟 |
| A11 | 自动验证通过 | `ref2va` 只接受 `role=reference` 的实际图片、音频和视频，不混入当前镜首尾帧 | `sglangH3.test.ts`、`providerCapabilities.test.ts` | 真实 H3 服务协议冒烟 |
| A12 | 自动验证通过 | 空 `ref2va conditions` 在创建远端任务前抛错 | `sglangH3.test.ts`、`providerCapabilities.test.ts` | UI 错误文案桌面冒烟 |
| A13 | 自动验证通过 | Provider 投影在提交前检查图片、音频和视频上限并返回明确数量 | `providerCapabilities.test.ts`、`imageReferencePolicy.test.ts` | 各真实 Provider 最新限制需上线前复核 |
| A14 | 自动验证通过 | H3 前台和后台均为 10 秒轮询；后台网络异常不因固定次数终止，保留原任务 ID | `recoveryPolicy.test.ts`、`sglangH3.test.ts` | 长时间真实排队任务观察 |
| A15 | 自动验证通过，原生重启待验 | `CanvasTask.workshopProductionPacket` 持久化本任务独立生产包；恢复优先按任务输入指纹写回对应候选 | `productionPacket.test.ts` 直接覆盖后续尝试覆盖 `lastProductionPacket` 的反例 | Tauri 进程退出重启后的完整恢复 |
| A16 | 自动验证通过 | 正式候选采用和交付以候选自身冻结包为权威，不读取后续失败尝试包 | `productionLifecycle.test.ts`、`productionAudit.test.ts`、`deliveryManifest.test.ts` | 桌面端制造一次失败的新尝试 |
| A17 | 自动验证通过 | 视频终审与候选路径、checksum、输入指纹绑定；未通过不能采用或交付 | `qualityReview.test.ts`、`productionLifecycle.test.ts`、`deliveryManifest.test.ts` | 真实审核服务失败回执 UI |
| A18 | 实现完成，原生冒烟待验 | `StepGenerate.tsx` 提供播放、下载、删除、采用；采用后保留下载入口；候选绑定独立生产包 | `productionLifecycle.test.ts`、`deliveryManifest.test.ts` | Tauri 文件保存/删除对话框实操 |
| A19 | 自动验证通过，原生写盘待验 | `planCredentialClear()` 区分无绑定、独占凭证和被其他能力/生图槽位共享的凭证；浏览器只读冒烟确认新建凭证页包含名称、Base URL、完整 API Key 输入和显示密钥控件 | `credentials.test.ts` 覆盖四类清除路径；本地开发页 DOM 冒烟 | Tauri 设置页保存与清除后的 0600 文件和共享绑定实操 |
| A20 | 自动验证通过，原生导出待验 | 设置导出只有无密钥模式；`sanitizeSettingsExportPayload()` 移除凭证注册表、引用、旧平铺 Key、内联槽位和 token/secret 字段；项目 ZIP 写入层递归剥离敏感 JSON 字段，且敏感路径不进入资产扫描；浏览器只读冒烟确认备份页明确写明“不导出任何 API 密钥”且只有一个“导出设置”入口 | `settingsTransfer.test.ts`；`project_archive::tests` 4 项；静态搜索与本地开发页 DOM 冒烟 | 在 Tauri 中导出真实设置和项目 ZIP 后做离线内容扫描 |
| A21 | 自动验证通过，原生打开待验 | `normalizeLegacyWorkshopData()` 补默认字段、资产候选和唯一镜头 ID，同时保留旧提示词、素材、视频候选并防止伪造指纹 | `legacyMigration.test.ts` 3 项、`productionPacket.test.ts`；5 份本机真实项目临时副本往返验证，8 月 24 日和 8 月 26 日项目触发迁移，镜头数量、提示词、资产路径、正式视频和候选均保持，迁移后 ID 唯一 | 在 Tauri 中打开迁移后的旧项目并检查界面展示 |
| A22 | 自动验证通过 | `deliveryManifest.ts` 输出候选、生产包、任务、运行、剧本修订、校验和及文件状态 | `deliveryManifest.test.ts` | 真实项目生成一份交付清单并人工阅读 |
| A23 | 实现完成，原生冒烟待验 | 镜头分别保存首帧/尾帧实际参考路径与标签快照；`StepGenerate.tsx` 展示缩略图、编号、用途并支持放大 | `imageReferencePolicy.test.ts`、`shotRefs.test.ts` | 桌面端检查裁剪后的图片编号和放大弹窗 |
| A24 | 自动验证通过 | 审核回执绑定非密钥 reviewer fingerprint；Base URL 或模型变化后旧回执保留但失效，门禁不再接受 | `qualityReview.test.ts`、`productionAudit.test.ts`、`deliveryManifest.test.ts` | 设置页修改服务后的 UI 三态冒烟 |
| A25 | 自动验证通过 | `qualityStats.ts` 对当前和历史回执去重，统计总数、通过率、平均分、类型、人工复盘和高频问题 | `qualityStats.test.ts` | 交付页真实项目展示布局 |
| A26 | 自动验证通过，原生冒烟待验 | 单镜重写、列表键、批量选择和 store 更新均使用稳定镜头 ID；重复 `shotNo` 不会批量覆盖 | `shotMutation.test.ts` 4 项 | 桌面端构造重复显示编号并重写其中一个镜头 |
| A27 | 自动验证通过，原生文件操作待验 | `videoCandidateDeletionGuard()` 阻断正式候选和不存在候选，只放行存在且未采用的待选候选 | `productionLifecycle.test.ts` 8 项中含删除门禁反例 | 桌面端分别尝试删除待选和正式候选 |
| A28 | 自动验证通过，原生重启待验 | `persistedCanvasTask()` 对 workshop/storyboard 任务保留完整提示词并清除旧截断标记；通用长任务只保存带 `promptTruncated=true` 的 4000 字符摘要 | `taskPersistence.test.ts` 4 项、H3 超长提示词测试、构建和 TypeScript 检查 | 执行应用重启并在任务详情中查看全文 |
| A29 | 自动验证通过 | 设置导出和项目 ZIP 分别在 TypeScript 与 Rust 写盘边界剥离凭证、引用、Key、Secret、Authorization 和 token | `settingsTransfer.test.ts`、`project_archive::tests` 4 项 | 对真实导出文件做离线关键词扫描 |
| A30 | 自动验证通过，原生冒烟待验 | `planCredentialClear()` 识别共享凭证并仅解除审核能力绑定，不删除仍被使用的注册表项 | `credentials.test.ts` 共享 capability 与 image-slot 用例 | 设置页绑定共享凭证后执行清除 |

## 三、本轮新增安全与恢复修复

### 3.1 设置导出不再允许明文密钥

此前设置页存在“导出（含密钥）”，与规范“设置导出不含凭证”冲突。现已：

1. 删除含密钥导出入口；
2. 所有导出统一经过 `sanitizeSettingsExportPayload()`；
3. 排除凭证注册表、凭证引用、所有 `*ApiKey`、`*SecretId`、`*SecretKey`、token 字段、Provider Key 表及带内联 Key 的生图槽位；
4. 保留导入旧备份能力，避免用户历史迁移文件无法恢复；
5. 增加直接单元测试，确认序列化结果不包含测试密钥文本。

### 3.2 审核凭证清除不破坏共享凭证

凭证清除决策已提取为 `planCredentialClear()`：

- 未绑定：只清空输入；
- 当前能力独占：解绑并删除注册表凭证；
- 被其他 capability 或生图槽位共享：只解绑当前审核能力。

### 3.3 恢复任务不再借用“最近一次生产包”

每个工坊视频后台任务现在持久化自己的 `workshopProductionPacket`。恢复候选时：

1. 优先使用任务自身生产包；
2. 只接受与任务 `inputFingerprint` 一致的包；
3. 仅在旧任务没有独立包时，才允许使用同指纹的镜头最近包；
4. 后续失败或重新生成覆盖 `lastProductionPacket` 时，旧任务仍能恢复到自己的候选和生产世系；
5. 指纹不匹配时拒绝伪造或错误绑定生产证据。

### 3.4 项目 ZIP 增加凭证剥离硬门禁

项目归档不再假设“项目数据天然不会混入凭证”。所有工坊和画布 JSON 在写入 ZIP 前递归删除 API Key、Secret、Authorization、token、凭证注册表和凭证引用字段；资产路径扫描同样跳过这些字段。JSON 无法解析时导出直接失败，避免历史污染数据以原文进入归档。

### 3.5 旧项目基础迁移可直接回归

`normalizeLegacyWorkshopData()` 现在以纯函数形式验证旧项目：

- 缺失的新数组和镜头字段补安全默认值；
- 只有 `assetImagePath` 的角色、场景、道具和色卡补候选记录；
- 缺少或重复的镜头 ID 生成稳定且唯一的迁移 ID；
- 原提示词、素材路径、正式视频和候选不丢失；
- 不完整生产包只做防御性归一化，不生成有效输入指纹。

### 3.6 Idea 文案提示词跨视图可靠投递

Idea 生成不再依赖“切换到文案视图后等待固定 450ms”的时序假设。`promptBridge.ts` 在文案面板尚未挂载时保存请求，面板订阅后再消费；若面板在消费前卸载，请求会放回队列。该桥只传递本地提示词，不调用 Codex，也不自行访问模型；实际生成仍由GDream当前配置的文本模型 Agent 完成。

### 3.7 正式候选删除增加生命周期门禁

候选删除不再仅依赖界面确认。`videoCandidateDeletionGuard()` 在文件操作前统一判断候选是否存在、是否已被采用为正式视频；正式候选和不存在候选均阻断，只有存在且未采用的待选候选可以删除。采用后继续保留播放、下载和生产包追溯。

### 3.8 单镜重写改为稳定 ID 隔离

“AI 重写本镜”不再依赖可能重复的显示编号。调用开始时冻结项目 ID 和稳定镜头 ID，返回时再次确认目标仍属于当前项目；项目切换、镜头删除或身份不匹配时丢弃迟到结果。镜头列表 React key 和批量选择 ID 同步改用稳定镜头 ID。

## 四、当前外部未验证项

1. `http://127.0.0.1:30377` 当前已恢复可达：根路由返回 New API 页面，`GET /v1/models` 无令牌返回 401“未提供令牌”，`POST /v1/chat/completions` 使用无效占位令牌返回 401“无效的令牌”。地址、路由和 Bearer 鉴权入口已验证，但真实凭证、模型目录和多模态 JSON 响应仍待验证；
2. 浏览器只读冒烟已确认设置导航、API 凭证单一事实源、新建凭证的完整 Key 输入/显示控件，以及“导出设置不包含任何 API 密钥”的唯一导出入口；但浏览器不具备 Tauri 文件系统、0600 私有写盘、原生对话框和原生 HTTP 桥，不能代替桌面端原生冒烟；
3. 未经用户明确授权，不调用真实付费生图、视频或配音服务，因此模型画面质量、口型、声音身份和长任务排队仍需用户样例验收；
4. A01、A04、A05、A18、A23 及部分设置交互需要在 Tauri 桌面端逐项点击确认；当前 macOS 锁屏，Computer Use 无法读取或操作应用窗口；

## 五、结论

当前没有证据支持把整个优化目标标记为“全部完成”：核心协议、数据模型、安全门禁和自动测试已大范围落地，但真实审核服务、Tauri 原生交互、历史项目迁移样本以及付费模型成片质量仍缺少权威证据。后续应先完成非付费桌面冒烟和旧项目副本迁移，再在审核服务恢复后验证非付费模型目录与最小审核请求；只有用户明确授权后才能执行真实付费媒体抽检。
