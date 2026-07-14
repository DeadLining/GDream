# M4 — P3 Optional Enhancements

M4 是可选增强集合，适合在 M1-M3 稳定后推进。

---

## M4.1 预算治理

### 动机

连载动态漫一集可能包含 100+ shot，多 provider 生图、生视频、TTS 调用容易成本失控。OpenMontage 的 estimate / reserve / reconcile 可以借鉴。

### 数据模型

新增迁移：

- `20260716_20_production_budget.py`

修改 `production_runs`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `budget_cap_usd` | numeric nullable | 本 run 成本上限 |
| `spent_usd` | numeric default 0 | 已花费估算 |
| `budget_mode` | str default `observe` | observe / warn / cap |

### 后端

新增：

- `services/api/comic_studio/services/budgeting.py`

方法：

- `estimate_run_cost(run_id)`
- `reserve_invocation(invocation_plan)`
- `reconcile_invocation(model_invocation_id)`
- `should_pause_run(run_id)`

接入：

- `ModelRuntimeService` 调用前后更新 run 成本。

### 验收

- `budget_mode=cap` 且即将超出预算时，run 自动 pause。
- UI 能显示预算进度。

---

## M4.2 Provider 7 维评分

### 动机

当前 provider 数量少，默认配置即可。未来接入 Meshy、Tripo、Hunyuan3D、TRELLIS、更多图像/视频 provider 后，需要自动选择策略。

### 后端

新增：

- `services/api/comic_studio/services/provider_selector.py`

评分维度：

| 维度 | 权重 |
|---|---|
| Task fit | 30% |
| Output quality | 20% |
| Control features | 15% |
| Reliability | 15% |
| Cost efficiency | 10% |
| Latency | 5% |
| Continuity | 5% |

输出写入 M3.4 的 `decision_log`。

### 测试

新增：

- `services/api/tests/test_provider_selector.py`

覆盖：

- 分数排序稳定。
- provider 缺 key 时被排除。
- continuity 权重影响角色一致场景。

---

## M4.3 CLI 形态

### 动机

MoneyPrinterTurbo 提供 CLI，方便无头批量生成和 CI。ai-comic-studio 可补一个最小 CLI，用于渲染、检查 readiness、导出工程。

### 新入口

- `services/api/comic_studio/cli.py`

命令：

```bash
python -m comic_studio.cli readiness --episode-id EPISODE_ID
python -m comic_studio.cli render --episode-id EPISODE_ID
python -m comic_studio.cli export-project --project-id PROJECT_ID
```

### 测试

新增：

- `services/api/tests/test_cli.py`

覆盖：

- readiness 命令返回 JSON。
- 参数缺失时退出码非 0。

---

## M4.4 图片代理缓存

### 动机

当前项目以本地资产为主。若未来引入 OSS/S3 或签名 URL，则 URL 失效会影响渲染和审核。LocalMiniDrama 的 image_proxy_cache 可借鉴。

### 数据模型

新增迁移：

- `20260716_21_image_proxy_cache.py`

新增表 `image_proxy_cache`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `url_hash` | str | 主键 |
| `source_url` | text | 原始 URL |
| `local_path` | text | 本地缓存路径 |
| `expires_at` | datetime nullable | 过期时间 |
| `created_at` | datetime | 创建时间 |

### 后端

新增：

- `services/api/comic_studio/services/image_proxy_cache.py`

方法：

- `resolve_image(url) -> local_path`
- `refresh_if_expired(url)`

### 验收

- 远程图片 URL 过期后，系统可自动使用本地缓存。
- 渲染不依赖临时签名 URL。

---

## M4.5 编码器自动回退

### 动机

MoneyPrinterTurbo 在视频导出时会自动从 GPU 编码回退到 CPU 编码，提升跨平台稳定性。

### 适用场景

ai-comic-studio 当前主要由 Remotion + FFmpeg 负责合成。未来如果引入 Python 侧后处理或 FFmpeg 直出，可实现：

1. 优先硬件编码。
2. 失败后自动 fallback 到 `libx264`。
3. 记录 fallback 到 render review。

### 建议落点

- `services/api/comic_studio/services/rendering.py`
- `services/api/comic_studio/services/render_review.py`

### 验收

- 硬件编码不可用时用户仍能拿到 MP4。
- fallback 行为在 UI 自审详情中可见。

---

## 推进建议

M4 中最值得优先的是：

1. **CLI 形态**：实现成本最低，对 CI 和批处理价值高。
2. **预算治理**：一旦单集批量视频生成开始频繁使用，应尽早启用。
3. **Provider 评分**：等 3D provider 真正接入后再做，避免过早抽象。
4. **图片代理缓存**：等对象存储或团队协作上线前做。
