# M2 — P1 Experience and Maturity

M2 在 M1 基础上继续补强用户体验、prompt 可运营性、工程可移植性和动态漫质量风险评估。

---

## M2.1 Skill 文件化 + 热加载

### 动机

当前 prompt 逻辑较多沉淀在 service 代码中。要调优 panel、speech、video、script adaptation prompt 时，需要改代码并重启服务。

Toonflow 和 Huobao 都证明：把 prompt 方法论外化为 Markdown skill，能显著提升迭代速度。

### 新目录

```text
data/skills/
├── panel_prompt.md
├── speech_prompt.md
├── video_prompt.md
└── script_adaptation_prompt.md
```

### 后端改动

新增：

- `services/api/comic_studio/services/skill_loader.py`

职责：

- 从 `AI_COMIC_DATA_ROOT/skills` 或 repo 内 `data/skills` 加载 Markdown。
- 支持 fallback 默认文本。
- 支持 mtime 检查式热加载；首版不必引入常驻 watcher。
- 提供 `get_skill(name: str) -> str`。

修改：

- `services/api/comic_studio/services/panels.py`
- `services/api/comic_studio/services/videos.py`
- `services/api/comic_studio/services/script_extraction.py`

将硬编码 prompt 改为 skill 模板 + 变量组装。

### 前端改动

新增：

- `apps/web/components/SkillEditor.tsx`

可放在 `ModelCenter` 或 `RuntimeInfrastructure` 入口下。

功能：

- 列出 skill 文件。
- 编辑 Markdown。
- 保存后显示最后更新时间。
- 保存时不触碰 provider key。

### 测试

新增：

- `services/api/tests/test_skill_loader.py`

覆盖：

- 缺文件 fallback。
- 修改文件后重新读取。
- 不允许路径穿越。

### 验收标准

- 修改 `panel_prompt.md` 后，不重启 API 即能影响下一次 panel 生成。
- 默认 skill 文件缺失时系统仍可运行。

---

## M2.2 三层 Agent 契约

### 动机

当前生产调度是 service 化设计，工程上清晰，但缺少 Toonflow 那种"决策 / 执行 / 监督"契约。随着 ProductionRun、render review、budget、provider selector 复杂化，边界会越来越重要。

### 文件改动

新增：

- `services/api/comic_studio/services/production_decision.py`
- `services/api/comic_studio/services/production_supervisor.py`
- `docs/agent-contract.md`

保留：

- `services/api/comic_studio/services/production_runs.py` 作为执行层。

### 分层职责

| 层 | 文件 | 职责 | 禁止事项 |
|---|---|---|---|
| Decision | `production_decision.py` | 校验 scope、stage、预算、冲突 | 不读取重型 workspace 数据 |
| Execution | `production_runs.py` | 创建 run/item/task，推进状态机 | 不自行改变策略 |
| Supervision | `production_supervisor.py` | 汇总 review、render、visual blockers | 不接管失败重跑 |

### 测试

新增：

- `services/api/tests/test_production_decision.py`
- `services/api/tests/test_production_supervisor.py`

覆盖：

- 决策层只依赖轻量输入。
- 执行失败后 supervisor 只产出建议，不自动接管。

### 验收标准

- 创建 ProductionRun 的入口先通过 decision object。
- run 完成后 supervisor 能产出结构化总结。

---

## M2.3 工程 ZIP 导入导出

### 动机

`DeliveryPackage` 面向发布产物，不等价于完整工程备份。连载动态漫需要跨机器迁移、团队交接、长期归档。

LocalMiniDrama 的工程 ZIP 导入导出可直接借鉴。

### 新增 service

- `services/api/comic_studio/services/project_portability.py`

核心方法：

- `export_project(project_id: str) -> Path`
- `import_project(zip_path: Path) -> str`

### ZIP 结构

```text
project-export.zip
├── manifest.json
├── database.json
└── assets/
    └── ...
```

`manifest.json`：

```json
{
  "schema": "ai-comic-studio-project-export/v1",
  "alembic_revision": "...",
  "project_id": "...",
  "exported_at": "..."
}
```

### 路由

新增：

- `services/api/comic_studio/routes/projects_portability.py`

API：

- `POST /projects/{project_id}/export`
- `POST /projects/import`

### 前端

新增：

- `apps/web/components/ProjectImportExport.tsx`

接入：

- `ProjectSettings.tsx`

### 测试

新增：

- `services/api/tests/test_project_portability.py`

覆盖：

- 导出 manifest。
- 导入后新 project id 不冲突。
- 资产文件存在。
- Alembic revision 不兼容时拒绝导入或 warning。

### 验收标准

- 一个项目可导出 ZIP 并重新导入为新项目。
- 关键实体（episode、shot、asset、variant、review）数量一致。

---

## M2.4 Slideshow Risk 评分

### 动机

动态漫最大质量风险是最终视频像 PPT：画面几乎不动、镜头缺少运动意图、字幕占比过高。

OpenMontage 的 Slideshow Risk gate 可作为动态漫专用质量门。

### 接入点

在 M1.2 的 `render_review.py` 中新增：

- `score_slideshow_risk(render_path, episode_id) -> dict`

### 评分维度

| 维度 | 方法 | 权重 |
|---|---|---|
| 相邻帧变化 | PIL 抽帧差异 | 30% |
| 静态 panel 比例 | video 缺失 fallback 比例 | 20% |
| camera_motion 多样性 | Shot.camera_motion 分布 | 15% |
| 字幕占比 | frame 中文字/对白区域估计 | 10% |
| 镜头时长单调性 | duration 方差 | 10% |
| 重复画面 | perceptual hash | 15% |

等级：

- `ok`: < 0.4
- `warning`: 0.4 - 0.7
- `critical`: > 0.7

### 前端

修改：

- `apps/web/components/EpisodeOverview.tsx`
- `apps/web/components/VersionHistory.tsx`

显示：

- Slideshow Risk badge
- 触发维度列表

### 测试

扩展：

- `services/api/tests/test_render_review.py`

新增：

- 静态图长视频风险高。
- 多镜头运动视频风险低。

### 验收标准

- 渲染完成后自审结果包含 slideshow risk。
- critical 风险不能默认进入发布推荐。
