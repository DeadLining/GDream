# pipeline-probe — 工坊流水线模块化实测

用**桌面应用同源**的提示词、工具 schema 与校验器，在 Node 里直连本地推理服务，
逐个模块打真实请求，定位「剧本 → 拆镜 → 生成图片」卡在哪一层。

## 为什么这么做

手写一份提示词副本去测，测出来的结论不算数。这里用 esbuild 把仓库里真实的模块
打包成可执行 bundle，保证：

- 提示词就是应用在用的那份
- 工具 schema 就是应用下发给模型的那份（含 `resolveDefinition()` 的运行期解析）
- 拆解的通过/不通过，由应用自己的 `validateBreakdownInput()` 判定
- 报错文案与应用 `workshopTools.ts` 一致，模型看到的反馈同源

## 文件

| 文件 | 作用 |
|---|---|
| `entry.ts` | 声明要从 `src/` 打包进来的模块 |
| `build.mjs` | esbuild 打包，处理 Vite 的 `?raw` 导入、桩掉浏览器专用库 |
| `preload.mjs` | Node 下的 `window` / `document` / `navigator` / `localStorage` 垫片 |
| `run.mjs` | 主测试脚本：多轮 Agent 循环 + 桩执行器 + 逐模块报告 |
| `storecheck.mjs` | **工具实现层校验**：直接调真实 `tool.execute()`，核对桩与产品是否逐点一致 |
| `.gen/` | 产物目录（已 gitignore，含 6MB bundle、报告、生成图） |

## 用法

```bash
node scripts/pipeline-probe/build.mjs              # 先打包

# 密钥只走环境变量，不写文件、不进日志
PROBE_KEY=sk-xxx node scripts/pipeline-probe/run.mjs all
PROBE_KEY=sk-xxx node scripts/pipeline-probe/run.mjs probe      # 连通性 + 请求体规模
PROBE_KEY=sk-xxx node scripts/pipeline-probe/run.mjs script     # 剧本生成
PROBE_KEY=sk-xxx node scripts/pipeline-probe/run.mjs breakdown  # 拆解（专用提示词）
PROBE_KEY=sk-xxx node scripts/pipeline-probe/run.mjs autorun    # 一键全流程
PROBE_KEY=sk-xxx node scripts/pipeline-probe/run.mjs shots      # 分镜表
PROBE_KEY=sk-xxx node scripts/pipeline-probe/run.mjs image      # 图片服务
```

无需密钥的**工具实现层校验**（直接跑真实 `tool.execute()`，不经过桩）：

```bash
npm run probe:storecheck        # = build.mjs + storecheck.mjs
```

它校验三件事：真实实现是否真的写进 store；桩的契约复现是否与真实实现逐点一致；
把 `run.mjs shotprompts` 产出的**真实提示词原文**回放进真实 `workshop_set_prompts`，
核对「桩放行」是否等于「产品放行」。任一对照点不一致即退出码非 0。

可覆盖的环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PROBE_BASE` | `http://127.0.0.1:30377` | 服务地址 |
| `PROBE_MODEL` | `deepseek-v4-flash-0731` | 模型名 |
| `PROBE_TURNS` | `8` | Agent 循环最大轮数 |
| `PROBE_TIMEOUT_MS` | `180000` | 单轮请求超时 |

## 产物

- `.gen/report.json` — 结构化报告（各模块 pass/detail）
- `.gen/artifacts/<模块>.json` — 完整请求、响应、逐轮耗时、工具调用（含 `messages`，可还原模型工具调用原文）
- `.gen/results/storecheck.json` — 工具实现层校验的逐项结果与回放结论
- `.gen/output/image-step-proof.jpg` — 图片模块的真实生成结果

## 已知局限

1. 桩执行器只实现了工坊读写相关工具；`bash`、`project_get_paths` 等返回"未实现"。
   这会**低估**真机上模型的探索循环长度（真机 bash 可用）。
2. 桩执行器**不发出**真实实现的检查警告（`imagePrompt 缺少表演瞬间`、
   `单个镜头疑似包含多种运镜`、`出现内部切镜/换场信号` 等）。`storecheck.mjs`
   的 C2 回放会把真实警告打出来，跑完 ④ 后建议顺手看一眼。
3. `storecheck.mjs` 只覆盖 `workshop_set_asset_prompt` / `workshop_set_prompts` /
   `workshop_set_breakdown` 三条写入路径；其余工具仍是「桩已复现、未与真实实现逐点核对」。
4. 测试用的一次性密钥不要提交到仓库。

### DSH Gateway regression

- `npm run test:dsh-provider`: offline integration against the real `DshBridge`; verifies that tool execution receives the selected provider and model (including legacy DeepSeek defaults).
- `npm run test:dsh-gateway`: opt-in live test. Supply `GDREAM_DSH_LLM_API_KEY`, `GDREAM_SMOKE_BASE_URL`, and `GDREAM_SMOKE_MODEL` through the process environment, never command-line arguments or committed files. Requires Cargo and the bundled runtime. Uses the production Rust `build_dsh_config`, an isolated temporary HOME/session directory, and only a `probe_echo` tool. Asserts actual dispatch, result refeed, normal ACP completion, and tool/usage observer events. Does not restart GDream or write its settings. The model request may incur normal API usage charges.

This proves the Gateway/ACP/runtime path, not installed desktop UI acceptance. Direct Anthropic-compatible routes requiring an additional Bearer header currently fail closed and can fall back to the same provider/model in built-in mode; credentials must not be embedded in Cordis configuration.

### Native multimodal input (GDream-owned adapter, DSH remains rc.6)

`image_recognition` is no longer registered in the agent tool list. `read_image` only retrieves image bytes; browser screenshots return `ToolResult.media` directly. `web_fetch` includes a bounded image URL/alt index so the current model can choose which images to read. No secondary vision model is invoked by these tools. Separate director-panel analysis remains a separate UI feature, not an agent tool.

The bundled `gdream-acp-native.mjs` adapter admits native ACP images into DSH's durable attachment store. The `gdream-native-images.mjs` post-execute plugin preserves MCP image results instead of letting the upstream text renderer discard them. Both input and tool images reach the selected pi-ai model as native content. DSH upstream dependencies remain unmodified and pinned. PNG/JPEG/GIF/WebP are admitted with byte/count/MIME/full-decode checks; native video/audio are explicitly rejected by this transport. Ordinary-mode image requests also preserve the selected model and cannot silently retry as text or change providers.

- `npm run test:native-media`: actual frontend tools with mocked Tauri IO; verifies registry removal, image retrieval, screenshot media, HTML image indexes and strict ordinary-mode behavior.
- `npm run test:dsh-native-wire`: provider-free end-to-end runtime test using production Rust config and a local mocked OpenAI SSE server; asserts the exact input/tool image bytes reach the same model in two requests.
- `npm run test:dsh-gateway`: optional live test; `GDREAM_SMOKE_IMAGE` and `GDREAM_SMOKE_TOOL_IMAGE` can supply PNG fixtures, `SMOKE_PROMPT` supplies the question and `GDREAM_SMOKE_EXPECT` supplies comma-separated assertions (not sent to the model). Normal model API charges apply. `GDREAM_SMOKE_EXPORTER` may point to a freshly built Rust test binary to skip repeated Cargo resource staging; omit it for a fresh build.

These checks do not imply live GUI acceptance or universal website accessibility. No running GDream application is restarted or its settings rewritten.

### Tavily search (official remote MCP)

`web_search` now calls the official Tavily remote MCP through GDream's existing tool bridge; DSH and the ordinary engine share the same tool and `webSearchEnabled` gate. No additional DSH plugin, second tool catalog, or upstream runtime modification is required. There is no DMXAPI/other-provider fallback.

Configure a dedicated credential in Settings → API credentials (base URL `https://mcp.tavily.com/mcp/`) and select it under “Tavily 联网搜索”. Only `credentialRefs.tavily` is used. The runtime endpoint is fixed; authentication uses a Bearer header, never a query parameter, model argument or Cordis config. Credential connection testing performs one basic search and may consume Tavily credits. Normal searches request images, not generated answers or image descriptions. Search output retains bounded source summaries and image URL lists; `read_image` retrieves selected originals for the current model. Search results are untrusted evidence, not instructions.

`npm run test:tavily` runs pure MCP contract/error/cancellation tests plus the production registry/tool with mocked Tauri IO. It verifies the gate, credential isolation, source/image retention and absence of DMX fallback. Real MCP authentication/search must be checked separately. HTTP calls time out after 30 seconds each; cancellation returns promptly and suppresses later calls/results, but does not claim to cancel a request already accepted by the remote server.

Keys belong only in the private settings credential registry and are excluded from settings exports. External edits to the on-disk settings file do not hot-update a running WebView: its localStorage remains authoritative. Desktop configuration/UI acceptance must therefore be checked separately from an isolated API test.

### Product-ad research and image design

The product-ad entry now has an explicit online/provided-only choice, a Tavily enable control, and an upload area for up to four product/packaging/software UI images. Uploads are validated (supported native image formats, 5 MiB each) and copied into the project's `assets/ad-materials` folder. User-authorized chat attachments can be bound with `workshop_set_ad_product_images`; arbitrary chat inspiration images are not silently treated as product identity.

`workshop_prepare_ad_materials` reads the actual user product images, searches via the same gated Tavily tool, saves source snippets/URLs and up to two readable search images, and returns native media to the selected model. Search-image failures are disclosed; unreadable user product images and search failures fail preparation. Provided-only mode explicitly states that no web verification occurred. Search images remain inspiration, not accepted product identities or licensed publishing assets. No separate vision model is used.

An input-fingerprinted receipt gates ad breakdown/shot writes and paid workshop generation. Changing the product/spec or product images invalidates the receipt. `workshopStore` copies the authoritative product identity paths onto shot reference snapshots; the shared image/storyboard/video reference builder consumes them, including consumers that pass minimal reference contexts. Changing images remaps reference numbers and marks affected prompts stale. Video engines still obey their original capability projections (e.g. H3 frame conditions); this is not a claim that every video provider receives arbitrary extra images.

`npm run test:ad-materials` checks the production registry/tools/stores and reference builders with mocked IO: image bytes, source persistence, ordinary-mode shared attachment preparation, gating, offline choice, failed search/image/disk writes, updated identity refs, cancellation and project switching. It never calls an image/video generator. Passing this suite is not installed-app or creative-quality acceptance. Advertising claims still require source verification and human approval where appropriate.
