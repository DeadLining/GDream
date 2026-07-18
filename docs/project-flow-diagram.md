# AI Comic Studio · 项目功能流程图（索引）

> 配套可视化：[`project-flow-diagram.svg`](./project-flow-diagram.svg)（同目录，浏览器直接打开）
>
> 本文档是图的**文字索引**，每个节点/边/回环都落到具体的 API、服务文件、表名，方便检索。
> 基于清理后的当前代码库，2026-07-18 更新。

## 一、主链路 · 剧本 → 成片（10 步，承重）

蓝色为用户可见步骤，深蓝为数据产出节点。这 10 步是 README 定义的 Production Flow 主轴，**不能拆**。

| # | 步骤 | 入口 API | 承重服务 | 数据落点 |
|---|------|----------|----------|----------|
| 1 | 项目创建 | `POST /api/projects` | `projects.py` | `projects` 表 |
| 2 | 剧本导入 | `POST /api/scripts/*`、`/api/script-imports/*` | `script_documents.py`、`script_imports.py` | `script_documents`、`script_revisions` |
| 3 | 结构提取 | （剧本保存触发） | `script_extraction.py` | `episodes`、`scenes`、`shots`、`dialogue_lines` |
| 4 | 资产需求 | `GET /api/projects/{id}/asset-requirements` | `asset_requirements.py`（`AssetRequirementService`） | `asset_requirements` |
| 5 | 角色参考 | `POST /api/characters/{id}/references` | `character_references.py`、`character_reference_sets.py` | `character_references`、`library_assets` |
| 6 | 分镜编辑 | `PATCH /api/shots/{id}` | 前端 `Storyboard` + `Inspector` | `shots`（prompt/时长/运镜/composition） |
| 7 | **出图 panels** | `POST /api/shots/{id}/panels`、`POST /api/model-runtime/image` | `panels.py`（`PanelService`）→ `shot_inputs.py`（`ShotInputCompiler`） | `assets`（kind=panel） |
| 8 | **配音 speech** | `POST /api/dialogue/{id}/speech` | `speech.py`（`SpeechService`） | `assets`（kind=speech） |
| 9 | **出视频 video** | `POST /api/shots/{id}/videos` | `videos.py`（`VideoService`） | `assets`（kind=video） |
| 10 | 合成渲染 | `POST /api/episodes/{id}/render` | `packages/compositor`（Remotion） | MP4 文件 |

### 主线后段：审核 + 发布（成片门禁，主线必经）

| # | 步骤 | 入口 API | 服务 | 数据落点 |
|---|------|----------|------|----------|
| 11 | 审核 | `POST /api/episodes/{id}/render-review`、视觉审阅线程 | `review_publication.py`、`visual_review.py` | `review_threads`、`visual_review_*` |
| 12 | 发布 | `POST /api/release-candidates/{id}/publish` | `review_publication.py`（`release_candidate → release_gate → published`） | `release_candidates`、`publication_records` |

---

## 二、一键 AI 编排（EpisodeAIRun）

**一条命令自动跑完主线 4→12 步**。这是主线的"自动挡"，与手动挡（逐步调 API）平行存在。

- 入口：`POST /api/episode-ai-runs` → `orchestrator.run`
- 12 stage 严格顺序执行（定义：`services/episode_ai_runs.py:10-21`）：

```
scripting → structuring → references → panels → panel_review →
speech → videos → rendering → quality_review → release_candidate →
release_gate → published
```

- **跳过项**：`scripting` / `structuring` 默认 skipped（剧本由用户导入，不走 AI 生成）。
- **暂停条件**：handler 抛 `EpisodeAIStageNeedsReview` → run 置 `needs_review` 暂停，等人工 review 后 `/continue`。
- **跳过决策**：`automation_policy` 决定某个 stage 是 `skipped` 还是正常执行。
- **中断恢复**：`orchestrator.recover_interrupted` 会把中断时 `status=running` 的 stage 标记为 `api_interrupted`（retryable）。

---

## 三、分支 · 旁支功能（主线不强依赖）

虚线岔出，每个分支独立闭环，不被主链路调用（或仅弱引用）。

| 分支 | 岔出自主线 | 服务/组件 | 主线依赖 | 备注 |
|------|------------|-----------|----------|------|
| 作品总览 / 故事线 / 卷宗 | #1 项目创建 | `narrative.py`、前端 `ProductOverview` | **零**（后端无引用） | **孤岛域**，3 张表 |
| 章节事件图谱 | #2 剧本导入 | `chapters.py`、`script_chapters` | 弱 | 辅助剧本结构化 |
| 资产谱系画布 | #4 资产需求 | `asset_lineage.py`、前端 `AssetLineageCanvas` | 弱 | variant → state → usage 四层 |
| 角色工作台 | #5 角色参考 | 前端 `CharacterWorkspace` | 中（generation 回跳） | 图片参考、`body_plan` 与变体/状态连续性 |
| 提示词建议 | #6 分镜编辑 | `prompt_suggestions.py` | 弱（可选 LLM 辅助） | 调用 `ShotInputCompiler` |
| **ComfyUI 画布** | #7 出图 | `production_canvas.py`、前端 `ProductionCanvas` | **零**（纯只读） | 点节点只 `onSelectShot`，不触发生成 |
| **视觉审阅** | #11 审核 | `visual_review.py`、前端 `VisualReviewWorkspace` | 中 | 圈点/候选/对话，驳回可触发重生 |

---

## 四、回环 · 反馈 / 重试 / 驳回 / 阻塞

红色虚线绕回主线对应节点。共 5 条回环。

### L1 · 失败重试
- **触发条件**：`production_run.status ∈ {completed_with_failures, paused}`，只重置 `failed` item 为 `queued`。
- **入口**：`POST /api/production-runs/{run_id}/retry`（`routes/production.py:75`），body 可指定 `item_ids` 否则全失败 item。
- **行为**：**用户手动触发，不自动重试**。coordinator 把 failed→queued 后由 `/continue` 或后台 `coordinator.run` 重新消费。
- **绕回到**：#7/#8/#9（出图/配音/视频）。

### L2 · 暂停 / 续跑
- **触发条件**：运行中 `run.pause_requested=True` 或 budget cap 触发暂停。
- **入口**：`POST /api/production-runs/{id}/pause`（:52）、`POST /api/production-runs/{id}/continue`（:62）。
- **幂等性**：`coordinator.run` 只取 `status==queued` 的 item（`production_coordinator.py:31`），跳过已 succeeded。
- **重启行为**：**无自动恢复**（paused 状态保留在 DB，需手动 `/continue`）。EpisodeAI 侧有 `recover_interrupted`，production_runs 侧无。
- **绕回到**：#7 出图。

### L3 · 审核驳回 → 重生
- **触发条件**：注解/线程把 `shot.review_status` 置为 `needs_changes`（`visual_review.py:349`），并把 `video_render_status=pending` 作废。
- **入口**：
  - `POST /api/visual-review-threads/{thread_id}/generate`（`routes/visual_review.py:124`）→ model_runtime IMAGE job
  - 或 `POST /api/shots/{shot_id}/panels`（`routes/assets.py:70`）→ `PanelService.generate_panel`
- **行为**：**驳回不自动重生**，用户在 visual-review thread 点 generate 重新出图。
- **绕回到**：#7 出图（重生 panels）。

### L4 · 就绪门阻塞
- **触发条件**：shot 缺 background/character/prop 资产 → `readiness["ready"]=False`。
- **入口**：`POST /api/model-runtime/image`（`routes/model_runtime.py:140`）捕获 `ShotGenerationNotReady` 抛 **HTTP 409**（`asset_requirements.py:357`），body 带 `blockers` 列表。
- **行为**：**硬拒绝**，不路由用户去补资产。用户自行补齐后重新 POST 触发生成。
- **绕回到**：#4 资产需求（补齐后重新满足就绪门）。

### L5 · AI 编排暂停（NeedsReview）
- **触发条件**：stage handler 抛 `EpisodeAIStageNeedsReview`（如 panels stage 遇到 shot 未就绪）。
- **入口**：`orchestrator.run` 捕获后把 run 置 `needs_review`，写 `metadata.blocked_shots`。
- **行为**：暂停等待人工 review（补资产/改分镜），用户处理后 `/continue` 续跑。
- **绕回到**：#6 分镜编辑（人工介入）。

---

## 五、模型能力侧栏（Capability）

定义在 `model_runtime/service.py` 与 `providers/`。当前共有 **4 项运行能力**。

| 能力 | Provider | 用途 | 主线调用点 |
|------|----------|------|------------|
| **TEXT** | `MiniMaxProvider`（M3） | 剧本生成、提示词建议 | #3 结构提取（可选）、提示词建议分支 |
| **IMAGE** | `GPTImageProvider`（gpt-image-2） | 出图 | #7 出图 panels |
| **SPEECH** | `QwenTTSProvider`（经 SSH→A800_94） | 配音 | #8 配音 speech |
| **VIDEO** | `MiniMaxVideoProvider` + `WanVideoProvider`（双 adapter） | 出视频 | #9 出视频 video |

- 持久化：`data/provider-channels.json`
- 健康检查：`GET /api/model-runtime/health`、`GET /api/providers/health`

---

## 六、数据域侧栏（45 张当前 ORM 表，按业务域分组）

### 主线域（25 张）
- 项目/元数据（3）：`projects`、`project_members`、`production_workflow_bindings`
- 剧本域（6）：`script_documents`、`script_revisions`、`script_chapters`、`script_imports`、`script_import_episodes`、`asset_requirements`
- 集/分镜/对白（4）：`episodes`、`scenes`、`shots`、`dialogue_lines`
- 角色/资产库（4）：`characters`、`library_assets`、`library_asset_scene_bindings`、`character_references`
- 资产变体谱系（4）：`asset_variants`、`asset_variant_states`、`asset_variant_usages`、`assets`
- 生产运行（2）：`production_runs`、`production_items`
- Episode AI（2）：`episode_ai_runs`、`episode_ai_run_stages`
- 基础设施（4）：`jobs`、`model_invocations`、`trash_items`、`image_proxy_cache`

### 审阅/发布域（9 张，成片后门禁）
- 视觉审阅（4）：`visual_review_threads`、`visual_annotations`、`visual_review_messages`、`visual_review_candidates`
- 最终审核/发布（4）：`review_threads`、`review_messages`、`release_candidates`、`publication_records`
- 渲染审阅（1）：`render_review_records`

### 旁支域（8 张）
- 叙事/卷宗（3）：`volumes`、`storylines`、`storyline_events` —— **后端零引用，孤岛**
- 运营/交付（3）：`production_tasks`、`episode_versions`、`delivery_packages`
- 画布布局（1）：`production_canvas_layouts`
- 图片代理缓存（1）：`image_proxy_cache`（已计入基础设施）

---

## 七、配置 · 运维 · 平台页（前端 PlatformPage / GlobalSection）

与主流程平行的前端入口，不参与主链路数据流。

### 配置类
- **模型中心**（`models` PlatformPage）：渠道配置、健康检查、`ProviderChannelSection`、`ProviderHealthStatus`
- **作品设置**（`settings` PlatformPage）：项目元数据、`ProjectImportExport`
- **SSH 桥接配置**：`MockSshControl` 组件，SPEECH/VIDEO 经 SSH→A800_94 时启用
- **项目导入导出**：`projects_portability.py` + 前端 `ProjectImportExport`

### 运维类（只读 PlatformPage）
- **任务中心**（`tasks`）：`TaskCenter`，聚合 `production_tasks`
- **版本历史**（`versions`）：`VersionHistory`，回溯 `episode_versions`
- **回收站**（`trash`）：`RecycleBin`，软删恢复 `trash_items`
- **交付导出**（`export`）：`ExportDelivery`，打包 `delivery_packages`

---

## 八、关键观察（图之外的话）

1. **当前 ORM 共 45 张表**：退役的 6 张 3D Director/角色模型表已由前向迁移 `20260729_37` 删除；历史迁移保持不变。
2. **二维生成语义保持独立**：镜头 `composition`、`camera_motion`、提示词、深度/站位约束、`body_plan`、连续性、变体/状态和图片参考仍进入生成上下文。
3. **叙事/卷宗域是真孤岛**：后端非路由代码零引用，与"剧本→分镜→成片"无数据流关系。
4. **ComfyUI Production Canvas 是纯只读视图**：点击节点不会触发生成，实际生成仍走主线 `model-runtime` / `production-runs`。
5. **回环都是"半自动"**：5 条回环里只有 L4（就绪门阻塞）是系统自动拒绝，其余 4 条都需要用户手动触发重试/续跑/重生。

---

## 看图顺序建议

1. 先看**中间蓝色主轴**（10 步 + 右下审核/发布 2 步）—— 这是产品骨架。
2. 再看**下方紫色 AI 编排带** —— 这是主线的"自动挡"覆盖层。
3. 然后看**上方橙色分支** —— 这些是岔出去的旁支功能。
4. 最后看**下方红色回环** —— 这些是反馈/重试/驳回的绕回路。
5. 左侧紫色栏 = 模型能力，右侧绿色栏 = 数据域，作为参考索引。
