# M1 — P0 Foundations

本 milestone 聚焦三项立即落地能力：

1. 章节事件图谱
2. Post-render 自审门
3. 工作流整组重跑

它们分别补齐 ai-comic-studio 的上游长文本处理、下游渲染质量闭环、以及中游生产返工体验。

---

## M1.1 章节事件图谱

### 动机

当前 `ScriptDocument` / `ScriptRevision` 偏向整篇文本管理。长篇中文连载常见 50 章以上，如果后续剧本改写或分集规划直接喂全文，LLM 会出现上下文衰减、人物事件错漏、前后伏笔断裂。

Toonflow 的 `o_novel.chapterIndex` 证明：章节事件图谱是长篇小说改编的核心基础设施。

### 借鉴来源

- Toonflow：章节事件提取 + 章节级事件索引。
- ai-comic-studio 现有：`Storyline` / `StorylineEvent` 可承接章节事件与跨集追踪。

### 数据模型变更

新增 Alembic 迁移：

- `services/api/alembic/versions/20260714_15_chapter_events.py`

新增表 `script_chapters`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | str | 主键 |
| `script_document_id` | FK | 关联 `script_documents.id` |
| `chapter_index` | int | 章节序号 |
| `title` | str nullable | 章节标题 |
| `source_text` | text | 原始章节文本 |
| `event_summary` | JSON | 结构化事件摘要 |
| `character_ids` | JSON | 提及角色 ID 列表 |
| `scene_ids` | JSON | 关联场景 ID 列表 |
| `created_at` | datetime | 创建时间 |

建议 `event_summary` 结构：

```json
{
  "beats": [
    {"order": 1, "summary": "主角发现线索", "characters": ["..."], "stakes": "..."}
  ],
  "conflicts": ["..."],
  "open_threads": ["..."],
  "payoff_candidates": ["..."]
}
```

### 后端改动

新增 service：

- `services/api/comic_studio/services/chapter_events.py`

职责：

1. `split_chapters(text: str) -> list[ChapterDraft]`
2. `extract_events(script_document_id: str) -> list[ScriptChapter]`
3. `events_for_episode(episode_id: str) -> list[ScriptChapter]`

修改：

- `services/api/comic_studio/services/script_extraction.py`
  - 导入时按 `第N章`、`Chapter N`、明显场景分隔符切分。
  - 预览结果中可返回章节数量和前几章标题。

新增路由：

- `services/api/comic_studio/routes/chapters.py`

API：

- `GET /scripts/{script_document_id}/chapters`
- `POST /scripts/{script_document_id}/chapters/extract`
- `GET /episodes/{episode_id}/chapter-events`

### 前端改动

新增组件：

- `apps/web/components/ChapterTimeline.tsx`

展示：

- 章节列表
- 章节事件摘要
- 角色/场景引用
- 与 StorylineEvent 的链接入口

接入位置：

- `ScriptLibrary.tsx` 或 `ScriptEditor.tsx` 的侧栏标签页。

### 测试

新增：

- `services/api/tests/test_chapter_events.py`

覆盖：

1. 中文章节标题切分。
2. 英文 Chapter 标题切分。
3. 无章节标题时按长度/场景分隔回退。
4. Mock `ModelRuntime.TEXT` 后写入 `script_chapters`。
5. `GET /scripts/{id}/chapters` 返回稳定顺序。

### 验收标准

- 导入 50 章文本后能看到章节时间线。
- 每章有结构化事件摘要。
- 后续剧本改写可按 episode 只注入相关章节事件，而非全文。

### 风险与回滚

- 风险：章节切分误判。
- 缓解：允许用户手动编辑章节边界；首次版本只做保守切分。
- 回滚：删除路由和 service，Alembic downgrade 删除 `script_chapters`。

---

## M1.2 Post-render 自审门

### 动机

现有 `ReadinessService` 只检查渲染前 blocker：panel、approved、speech、videos。渲染完成后 MP4 是否有黑帧、静音、字幕缺失、编码异常，目前没有自动检查。

OpenMontage 的 post-render self-review 适合直接借鉴。

### 数据模型变更

新增迁移：

- `services/api/alembic/versions/20260714_16_render_review.py`

新增表 `render_review_records`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | str | 主键 |
| `episode_version_id` | FK nullable | 关联发布版本 |
| `render_path` | str | MP4 路径 |
| `ffprobe_json` | JSON | ffprobe 原始摘要 |
| `black_frame_positions` | JSON | 黑帧位置 |
| `silence_ranges` | JSON | 静音片段 |
| `subtitle_present` | bool | 是否检测到字幕或对白轨迹 |
| `overall_pass` | bool | 总体是否通过 |
| `created_at` | datetime | 创建时间 |

### 后端改动

新增：

- `services/api/comic_studio/services/render_review.py`

核心方法：

- `probe_video(path: Path) -> dict`
- `sample_frames(path: Path, positions: list[float]) -> list[FrameStats]`
- `detect_black_frames(stats) -> list[float]`
- `inspect_audio(ffprobe_json) -> list[dict]`
- `review_render(render_path, episode_version_id=None) -> RenderReviewRecord`

依赖：

- `ffprobe` / `ffmpeg`
- PIL（当前环境已存在）

接入：

- `services/api/comic_studio/services/rendering.py`
  - 渲染完成后调用 `RenderReviewService.review_render()`。
  - 若失败，保留 MP4，但标记为 `review_failed`。

### 前端改动

修改：

- `apps/web/components/VersionHistory.tsx`
- `apps/web/components/ExportDelivery.tsx`

展示：

- 自审状态徽章：`passed` / `warning` / `failed`
- 展开可见 ffprobe 摘要、黑帧、静音片段。

### 测试

新增：

- `services/api/tests/test_render_review.py`

覆盖：

1. 正常 fixture MP4 通过。
2. 人工构造黑色视频失败。
3. 无音轨视频失败或 warning。
4. ffprobe 不存在时返回可解释错误。

### 验收标准

- 所有渲染产物都有 review record。
- UI 能显示 review 结果。
- failed 产物不能默认标记为可发布。

---

## M1.3 工作流整组重跑

### 动机

当前 `ProductionRun` 粒度偏整集。审核退回少量 shot 时，用户需要一种"框选一组镜头 → 只补跑这些镜头"的能力。

LocalMiniDrama 的 `workflow_groups` 提供了直接产品参考。

### 数据模型变更

新增迁移：

- `services/api/alembic/versions/20260714_17_run_scope.py`

修改 `production_runs`：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `scope_type` | str | `episode` | `episode` 或 `shot_group` |
| `shot_ids` | JSON nullable | null | shot group 范围 |

### 后端改动

修改：

- `services/api/comic_studio/services/production_runs.py`

行为：

1. 创建 run 时允许传 `shot_ids`。
2. `shot_ids` 非空时 `scope_type=shot_group`。
3. 资格快照仅包含指定 shot 及其 dialogue。
4. 原有"每集单 active run"约束调整为：
   - episode-scope run 每集最多一个 active。
   - shot-group run 可并存，但不能重复包含同一正在运行的 shot。

修改 schema：

- `services/api/comic_studio/schemas.py`
  - `ProductionRunCreate` 增加 `shot_ids?: list[str]`。

### 前端改动

修改：

- `apps/web/components/production-canvas/ProductionCanvas.tsx`
- `apps/web/components/production-canvas/ProductionRunControls.tsx`
- `apps/web/components/production-canvas/ProductionCanvasToolbar.tsx`

交互：

1. React Flow 框选 shot node。
2. Toolbar 出现"创建补跑"按钮。
3. 用户选择 stages：panels / speech / videos。
4. 创建 shot_group run。

### 测试

扩展：

- `services/api/tests/test_production_run_creation.py`

新增用例：

- `test_create_shot_group_run`
- `test_shot_group_run_only_snapshots_selected_shots`
- `test_episode_run_conflict_does_not_block_shot_group_run_when_shots_do_not_overlap`

前端测试：

- `apps/web/tests/production-canvas.test.tsx`
  - 选中多个 shot 后按钮可见。
  - 提交 payload 包含 `shot_ids`。

### 验收标准

- 在 ProductionCanvas 框选 5 个 shot 后只创建这 5 个 shot 的 ProductionItem。
- 已成功的其他 shot 不被重跑。
- 主 run 状态不被补跑破坏。
