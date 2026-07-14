# M3 — P2 Consistency and Extensibility

M3 关注视觉一致性、风格资产化、provider 可扩展性和契约测试。

---

## M3.1 宫格图流程

### 动机

逐 shot 生图会导致跨镜头外观漂移。Huobao 的 grid prompt 做法可以一次生成多个镜头参考图，再切分为单镜，提升同一批镜头的风格一致性。

### 后端改动

新增：

- `services/api/comic_studio/services/grid_split.py`

方法：

- `split_grid(image_path, rows=2, cols=2) -> list[Path]`
- `assign_grid_cells_to_shots(grid_cells, shot_ids)`

Model Runtime 扩展：

- 可选新增 capability：`IMAGE_GRID`
- 首版也可复用 `IMAGE`，通过 prompt 要求模型输出 2x2 contact sheet。

修改：

- `services/api/comic_studio/services/panels.py`
- `services/api/comic_studio/services/production_runs.py`

新增参数：

- `panel_generation_mode`: `solo` / `grid`

### 前端

修改：

- `apps/web/components/ProductionPanel.tsx`
- `apps/web/components/production-canvas/ProductionRunControls.tsx`

新增选项：

- Panel generation mode：单镜 / 宫格。

### 测试

新增：

- `services/api/tests/test_grid_split.py`

覆盖：

- 2x2 图片正确切为 4 张。
- 切分结果与 shot 顺序一致。

---

## M3.2 尾帧衔接

### 动机

相邻镜头之间缺少视觉连接，会导致动态漫跳切感强。LocalMiniDrama 的 tailFrameLinkService 可借鉴。

### 数据模型

新增迁移：

- `20260715_18_shot_tail_links.py`

修改 `shots`：

- `previous_shot_tail_asset_id` nullable FK → `assets.id`

### 后端

修改：

- `services/api/comic_studio/services/panels.py`

生成 panel prompt 时：

- 如果存在 `previous_shot_tail_asset_id`，将其作为视觉参考。
- 明确要求保持构图连续，但允许情绪/动作推进。

### 前端

修改：

- `apps/web/components/Storyboard.tsx`
- `apps/web/components/ShotCard.tsx`

显示：

- 尾帧衔接标记
- "使用上一镜尾帧作为参考"开关

### 测试

- `services/api/tests/test_panel_versions.py` 扩展 prompt 构造测试。

---

## M3.3 画风库目录化

### 动机

Toonflow 的 art_skills 证明：画风不应只是一段 prompt，而应是可复用资产目录。

### 新目录

```text
data/art_styles/
├── 2d_anime/
│   ├── README.md
│   ├── prefix.md
│   ├── negative_prompt.md
│   └── images/
├── 3d_realistic/
├── chinese_guofeng/
├── comic_sketch/
└── watercolor/
```

### 后端

新增：

- `services/api/comic_studio/services/art_styles.py`

API：

- 列出画风
- 读取 prefix / negative_prompt
- 校验目录安全

### 前端

新增：

- `apps/web/components/ArtStylePicker.tsx`

接入：

- `CharacterWorkspace.tsx`
- `ProjectSettings.tsx`

### 测试

新增：

- `services/api/tests/test_art_styles.py`

---

## M3.4 Decision Audit Trail

### 动机

`ModelInvocation` 已记录调用，但没有记录为什么选择某个 provider。OpenMontage 的 decision_log 可让 provider 决策可审计。

### 数据模型

新增迁移：

- `20260715_19_model_invocation_decision_log.py`

修改 `model_invocations`：

- `decision_log` JSON nullable

### 后端

修改：

- `services/api/comic_studio/model_runtime/service.py`
- `services/api/comic_studio/model_runtime/repository.py`

写入：

```json
{
  "selected_provider": "minimax",
  "alternatives": [],
  "reason": "default configured channel",
  "scores": null
}
```

### 前端

修改：

- `apps/web/components/ModelInvocationList.tsx`

展开 invocation 时显示 decision log。

---

## M3.5 契约测试

### 动机

OpenMontage 的 contract tests 可无 API Key 验证 schema 稳定性。ai-comic-studio 已有 Pydantic schema，但缺少统一契约快照。

### 新增测试

- `services/api/tests/test_contracts.py`

覆盖：

- `schemas.py` 中关键 response/create/update schema 的 JSON schema dump。
- Render manifest schema。
- ModelRuntime contracts。

### 命令

新增 Makefile 或 package script：

```bash
make test-contracts
```

若项目暂未使用 Makefile，可先在 README 中记录命令：

```bash
cd services/api && uv run pytest tests/test_contracts.py -q
```

### 验收

- 无 API Key 可跑。
- schema 变更会产生明确测试 diff。

---

## M3.6 Adapter 自动注册

### 动机

Huobao 的 adapter registry 模式可以降低新增 provider 的改动面。当前 ai-comic-studio 的 adapter 注册集中在 `adapters.py`，加 provider 要修改注册表。

### 后端改动

修改：

- `services/api/comic_studio/model_runtime/adapters.py`

方案：

- 约定 provider 模块导出 `register(registry)` 或 `PROVIDER_ADAPTERS`。
- 使用 `importlib` 扫描 `services/api/comic_studio/providers/`。
- 保留显式注册 fallback，避免破坏现有 provider。

### 测试

新增：

- `services/api/tests/test_adapter_auto_registration.py`

覆盖：

- 现有 provider 均被发现。
- 无效 provider 文件不会导致服务启动失败。

### 验收

新增 provider 文件后不需要修改 `adapters.py` 主注册逻辑即可被发现。
