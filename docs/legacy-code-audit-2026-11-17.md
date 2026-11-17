# GDream 旧品牌与投流模块残留审计

日期：2026-11-17。检查对象：本地 `gdream-main` 的 CodeGraph 调用关系及 GitHub 发布副本。检查基线：`a9474e5`。

## 结论

当前 GDream 源码仍包含鲲鹏时期的投流功能、未挂载界面组件、旧用户数据兼容逻辑和历史文档。它不是“所有旧代码均已清除”的版本。此次在发布副本清理旧资料，未移除业务功能或修改原源码工作区。

发布版的投流工具、状态仓库、迁移代码与原始 `gdream-main` 对应文件逐项哈希相同；误入库文档也来自该源码目录。现有证据表明这些内容随 GDream 源码继承而来，不是本次合并 GitHub 目标仓库时意外混入。

## 发现与处理

| 类别 | 证据 | 当前状态与处理 |
| --- | --- | --- |
| 误入库的个人操作资料 | `src-tauri/~/Desktop/` 下的投流实测修复记录，日期为 2026-06-14，含广告账户标识与名称 | 从当前文件树移除；忽略字面量 `~/`、`Desktop/` 目录；不复述具体账户信息 |
| 旧版截图 | 原 `docs/images/` 的 16 张 PNG，README 主图明确显示“鲲鹏” | 16 张截图已移除；README 无引用；新截图需以实际 GDream 运行为准 |
| 仍可调用的广告投流功能 | `src/lib/agent/toolRegistry.ts:232,294` 导入并注册 7 个 `allTouliuTools`；`toolGating.ts:55` 对 `touliu_*` 返回 true | 保留，属于现有功能，不可称为无效文件；是否整体下线需按产品范围决定 |
| 内置投流技能 | `src/lib/skillLoader.ts:1434-1541` 和 `skills/ocean-engine-ad/SKILL.md` | 仍含巨量投流表单、提示词和工具入口，随功能保留 |
| 未接入界面的组件 | `src/components/touliu/TouliuDataPanel.tsx`、`MetricsChart.tsx` | CodeGraph 未发现实际依赖/挂载调用点；另有 barrel re-export；作为候选清理项列出，本次未删业务代码 |
| 数据迁移与兼容 | `legacyRenameBoot.ts`、`legacyRename.ts`、`src-tauri/src/commands.rs`、`project_archive.rs`、`historyPersistence.ts`、`artifacts/index.ts`、`safeStorage.ts`、Tauri scope | 保留，读取/迁移 `.kunpeng` 到 `.gdream`、兼容旧缓存/项目和素材，直接删除会破坏旧数据访问 |
| 过时架构说明 | 原架构总览标注旧分支、MIT 及历史实现 | 增加历史快照说明并指向当前许可与本报告；未把整篇历史文档当作当前架构验收 |

## “touliu”具体做什么

`touliu` 是“投流”的拼音，在这里指巨量引擎广告投放辅助。7 个工具是：

- `touliu_get_status`：查看投流账户与 Safari 页面状态。
- `touliu_open_safari`：打开巨量引擎页面。
- `touliu_get_metrics`：从 Safari 页面提取广告数据并写入状态仓库。
- `touliu_navigate`：导航 Safari 当前标签。
- `touliu_execute_js`：在 Safari 页面执行脚本。
- `touliu_suggest_keywords`：构建关键词建议上下文。
- `touliu_manage_account`：维护本机投流账户列表。

实际调用路径为：Agent 的工具注册表 → `allTouliuTools` → `touliuTools.ts` → Tauri `execute_command` → macOS `osascript` / Safari。账户与指标由 `touliuStore` 维护。这一路径依赖 macOS 桌面能力；改为 Web 不能照搬，需先决定是否纳入 Web 版，再设计服务端或浏览器授权执行方式。本次没有登录广告平台、读取实际账户或执行投放。

## 为什么不能把 kunpeng 全部删掉

前端在 `src/main.tsx` 最早导入 `legacyRenameBoot`，迁移 `kunpeng-*` 与 `kunpeng.*` localStorage 键；Rust 启动阶段执行 `migrate_legacy_data_dir()`，补缺迁移旧数据目录并保留旧目录。项目导入、聊天历史和素材库继续识别旧路径。名称命中不能单独证明代码失效。

## 验证与边界

- 通过 CodeGraph `explore` / `node` 检查工具注册、门控、技能、UI 调用点、启动迁移和素材路径。
- 使用 `git ls-files -z` 枚举发布文件；文本扫描显式绕过外层 `output/` 忽略规则，避免 `rg` 默认跳过整个发布副本。
- 删除旧文档后，对当前所有跟踪文件的原始字节检查其中已知的广告账户标识，未命中；异常目录与旧截图当前文件检查通过。
- 对个人 home 路径、wxid 和带明确字段名的数字广告账户标识做补充检查，剩余候选为通用路径匹配规则、示例和测试夹具，未将它们当作真实身份信息。
- `node --test src/lib/legacyRename.test.ts src/lib/legacyAssetScope.test.ts`：7 项通过。
- 对变更后目录再运行 Gitleaks 脱敏扫描：未检出凭证。
- 本次未执行原生桌面启动或真实广告平台验收，未证明投流功能目前可实际完成投放。

## Git 历史中的资料

删除当前文件不等于删除历史。先前提交仍保留旧截图和误入库记录，本次没有强推或重写历史；仓库保持私有。若需清除历史中的这些资料，需另行安排历史重写及协作者副本同步。
