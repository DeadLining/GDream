# Provider Channel Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local, runtime-editable LLM, image, and TTS channel configuration persisted in a secure local JSON file and managed through the modern Studio UI.

**Architecture:** A strict `ProviderChannelStore` bootstraps from existing environment settings, owns one immutable snapshot, and atomically persists `data/provider-channels.json`. A runtime `ProviderFactory` creates providers from the current snapshot for each new operation, while fixed REST endpoints expose redacted configuration, update, and low-cost connection testing. The frontend adds a settings workspace that never persists secrets in browser storage.

**Tech Stack:** Python 3.12, FastAPI, Pydantic, pathlib/os atomic file APIs, httpx, Next.js 16, React 19, TypeScript, Vitest, Testing Library, Playwright.

---

### Task 1: Strict Channel Domain And Local Store

**Files:**
- Create: `services/api/comic_studio/provider_channels.py`
- Create: `services/api/tests/test_provider_channel_store.py`
- Modify: `services/api/comic_studio/config.py`
- Modify: `.gitignore`

- [x] **Step 1: Write failing store tests**

Cover environment bootstrap, strict schema validation, JSON authority, permissions, and snapshot preservation:

```python
store = ProviderChannelStore(path=tmp_path / "provider-channels.json", defaults=defaults)
snapshot = store.load()
assert snapshot.llm.model == "MiniMax-M3"

store.save(snapshot.model_copy(update={"llm": updated_llm}))
assert stat.S_IMODE(store.path.stat().st_mode) == 0o600
assert json.loads(store.path.read_text())["llm"]["model"] == "MiniMax-M3"
```

Simulate `os.replace` failure and assert both the previous file bytes and `store.snapshot` remain unchanged. Assert unknown JSON fields and invalid enabled channels are rejected.

- [x] **Step 2: Run focused tests and confirm missing store**

```bash
cd services/api && uv run pytest tests/test_provider_channel_store.py -q
```

Expected: FAIL because `ProviderChannelStore` and channel schemas do not exist.

- [x] **Step 3: Add channel schemas and environment defaults**

Implement:

```python
ChannelKind = Literal["llm", "image", "tts"]

class ProviderChannel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    enabled: bool = True
    base_url: AnyHttpUrl
    model: str = Field(min_length=1, max_length=200)
    api_key: str = ""
    ssh_host: str = ""

class ProviderChannels(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1] = 1
    llm: ProviderChannel
    image: ProviderChannel
    tts: ProviderChannel
```

Add `provider_channels_path` to `Settings`, defaulting to `data/provider-channels.json`, resolved relative to the repository root. Add a helper that converts existing MiniMax, GPT Image, and Qwen settings into a `ProviderChannels` bootstrap value.

- [x] **Step 4: Implement atomic store persistence**

`ProviderChannelStore.load()` returns JSON when present and valid, otherwise bootstrap defaults when absent. `save()` writes a same-directory temporary file, sets `0600`, flushes, calls `os.fsync`, atomically replaces, attempts parent-directory `fsync`, then publishes the new snapshot.

Use a thread lock around load/save/snapshot access. Return immutable deep copies so callers cannot mutate active state.

- [x] **Step 5: Ignore the local configuration file**

Add:

```gitignore
data/provider-channels.json
data/provider-channels.json.*.tmp
```

Do not ignore all source-controlled fixture data.

- [x] **Step 6: Run tests and commit**

```bash
cd services/api && uv run pytest tests/test_provider_channel_store.py tests/test_config.py -q
cd ../.. && git diff --check
git add .gitignore services/api/comic_studio/config.py services/api/comic_studio/provider_channels.py services/api/tests/test_provider_channel_store.py
git commit -m "feat: persist local provider channels"
```

### Task 2: Runtime Provider Factory

**Files:**
- Create: `services/api/comic_studio/provider_factory.py`
- Create: `services/api/tests/test_provider_factory.py`
- Modify: `services/api/comic_studio/main.py`
- Modify: `services/api/comic_studio/routes/episodes.py`
- Modify: `services/api/comic_studio/routes/assets.py`
- Modify: `services/api/comic_studio/routes/speech.py`
- Modify: `services/api/comic_studio/routes/providers.py`

- [x] **Step 1: Write failing factory and hot-reload tests**

Use fake provider constructors to assert:

```python
first = factory.create_llm()
store.save(updated_snapshot)
second = factory.create_llm()
assert first.model == "MiniMax-M3"
assert second.model == "MiniMax-M3-new"
```

Assert the first provider retains its captured endpoint after save. Assert disabled or incomplete channels raise a stable `ProviderConfigurationError` with no key material.

- [x] **Step 2: Run focused tests and confirm missing factory**

```bash
cd services/api && uv run pytest tests/test_provider_factory.py -q
```

Expected: FAIL because `ProviderFactory` does not exist.

- [x] **Step 3: Implement provider creation**

Expose:

```python
class ProviderFactory:
    def create_llm(self) -> MiniMaxProvider: ...
    def create_image(self) -> GPTImageProvider: ...
    def create_tts(self) -> QwenTTSProvider: ...
```

Each method reads one snapshot, validates `enabled`, captures the channel values, and creates one provider. Do not pass the store into provider instances.

- [x] **Step 4: Wire routes and production workers**

Initialize `ProviderChannelStore` and `ProviderFactory` in `create_app()`. Replace direct `Settings` provider construction in planning, panel, speech, and production coordinator workers with factory calls.

Update provider health to read the current redacted snapshot so reported host/model/status matches actual routing.

- [x] **Step 5: Run focused and full API tests, then commit**

```bash
cd services/api && uv run pytest tests/test_provider_factory.py tests/test_provider_health.py tests/test_episode_planning.py tests/test_panel_versions.py tests/test_dialogue_speech.py tests/test_production_coordinator.py -q
uv run pytest -q
cd ../.. && git diff --check
git add services/api/comic_studio services/api/tests/test_provider_factory.py services/api/tests/test_provider_health.py
git commit -m "feat: route operations through provider channels"
```

### Task 3: Redacted Channel Management API

**Files:**
- Create: `services/api/comic_studio/routes/provider_channels.py`
- Create: `services/api/tests/test_provider_channels_api.py`
- Modify: `services/api/comic_studio/schemas.py`
- Modify: `services/api/comic_studio/main.py`

- [x] **Step 1: Write failing read and update API tests**

Cover:

```python
response = client.get("/api/provider-channels")
assert response.json()["llm"]["api_key_configured"] is True
assert response.json()["llm"]["api_key_masked"].endswith("8adr")
assert "full-secret" not in response.text
```

PUT tests must verify blank/omitted key preserves, non-empty key replaces, `clear_api_key` removes, and replacement plus clear returns HTTP 422. Assert disabled channels may omit credentials while enabled LLM/image channels may not.

- [x] **Step 2: Run tests and confirm routes are absent**

```bash
cd services/api && uv run pytest tests/test_provider_channels_api.py -q
```

Expected: FAIL with HTTP 404.

- [x] **Step 3: Add strict read/update schemas**

Define separate secret-free read contracts and update contracts:

```python
class ProviderChannelUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    enabled: bool
    base_url: AnyHttpUrl
    model: str
    api_key: str = ""
    clear_api_key: bool = False
    ssh_host: str = ""
```

Validate `api_key` and `clear_api_key` mutual exclusivity. Read schemas contain only `api_key_configured` and `api_key_masked`.

- [x] **Step 4: Implement GET and PUT**

`GET /api/provider-channels` returns all redacted slots, file path relative to repository/data root, persistence status, and reload timestamp.

`PUT /api/provider-channels/{kind}` merges secret semantics into a complete snapshot and calls one atomic `store.save()`. Return the updated redacted channel.

Map schema/configuration errors to HTTP 422 and file write errors to sanitized HTTP 500 responses.

- [x] **Step 5: Run focused/full tests and commit**

```bash
cd services/api && uv run pytest tests/test_provider_channels_api.py tests/test_redaction.py -q
uv run pytest -q
cd ../.. && git diff --check
git add services/api/comic_studio/routes/provider_channels.py services/api/comic_studio/schemas.py services/api/comic_studio/main.py services/api/tests/test_provider_channels_api.py
git commit -m "feat: expose provider channel configuration API"
```

### Task 4: Low-Cost Connection Tests

**Files:**
- Create: `services/api/comic_studio/services/provider_channel_testing.py`
- Create: `services/api/tests/test_provider_channel_testing.py`
- Modify: `services/api/comic_studio/routes/provider_channels.py`
- Modify: `services/api/comic_studio/schemas.py`

- [x] **Step 1: Write failing connection-test service tests**

Inject fake providers/clients and assert:

- unsaved form values are used;
- blank key resolves to stored key;
- configuration is not persisted;
- no job or asset rows are created;
- LLM uses a minimal deterministic request;
- image performs a non-generation reachability/capability check;
- TTS validates and discards a short WAV response;
- errors are sanitized;
- elapsed time and model/host are returned.

- [x] **Step 2: Run focused tests and confirm service is missing**

```bash
cd services/api && uv run pytest tests/test_provider_channel_testing.py -q
```

Expected: FAIL because the test service and endpoint do not exist.

- [x] **Step 3: Implement connection testing**

Create `ProviderChannelTestingService.test(kind, candidate)` with injected clock and provider/client factories. Use strict connect/total timeouts. Never call `AssetStore`, `JobStore`, or `ProviderChannelStore.save()`.

For image endpoints without a capabilities route, perform a sanitized HTTP reachability check and return `check_scope: "endpoint"` rather than generating an image.

- [x] **Step 4: Add the test endpoint**

```text
POST /api/provider-channels/{kind}/test
```

Return HTTP 200 with `status: ok|failed`; transport/provider failure is represented as a sanitized failed result rather than an unhandled 500. Invalid input remains HTTP 422.

- [x] **Step 5: Run tests and commit**

```bash
cd services/api && uv run pytest tests/test_provider_channel_testing.py tests/test_provider_channels_api.py -q
uv run pytest -q
cd ../.. && git diff --check
git add services/api/comic_studio/services/provider_channel_testing.py services/api/comic_studio/routes/provider_channels.py services/api/comic_studio/schemas.py services/api/tests/test_provider_channel_testing.py services/api/tests/test_provider_channels_api.py
git commit -m "feat: test provider channel connections"
```

### Task 5: Typed Web Client And Settings Workspace

**Files:**
- Modify: `apps/web/lib/types.ts`
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/components/ProviderSettings.tsx`
- Create: `apps/web/components/ProviderChannelSection.tsx`
- Create: `apps/web/tests/provider-settings.test.tsx`
- Modify: `apps/web/components/Workspace.tsx`
- Modify: `apps/web/components/ProjectNavigator.tsx`
- Modify: `apps/web/components/WorkspaceTabs.tsx`

- [x] **Step 1: Write failing client and settings tests**

Test request bodies and UI behavior:

```tsx
expect(await screen.findByRole('heading', {name: '模型渠道'})).toBeVisible();
expect(screen.getByDisplayValue('MiniMax-M3')).toBeVisible();
expect(screen.queryByDisplayValue('full-secret')).not.toBeInTheDocument();
await userEvent.click(screen.getByRole('button', {name: '测试剧本规划连接'}));
expect(await screen.findByText(/连接成功/)).toBeVisible();
```

Cover dirty state, preserve/replace/clear key controls, TTS SSH Host, enabled validation, test failure, save/reload, and navigation confirmation.

- [x] **Step 2: Run tests and confirm exports/components are absent**

```bash
npm test --workspace @comic-studio/web -- --run tests/provider-settings.test.tsx
```

Expected: FAIL because channel types, API functions, and settings components do not exist.

- [x] **Step 3: Add typed API functions**

Add `ProviderChannelKind`, redacted read types, update types, and test-result types. Implement:

```ts
getProviderChannels()
updateProviderChannel(kind, update)
testProviderChannel(kind, candidate)
```

Do not place keys in URLs or logs.

- [x] **Step 4: Build the settings components**

`ProviderSettings` loads all channels, owns dirty state, saves changed sections deterministically, and reloads the redacted snapshot. `ProviderChannelSection` renders the fixed fields, masked key state, replace/clear controls, enabled toggle, connection test, and TTS-only SSH Host.

Use semantic forms, labels, switches/checkboxes, accessible inline status, and stable dimensions. Never write key input values to local storage.

- [x] **Step 5: Integrate a real settings work area**

Add `settings` to the desktop and mobile `WorkArea` contract. Add a `模型渠道` navigation command in `ProjectNavigator` or toolbar that selects this work area. Ensure every rendered tab/control has valid `aria-controls`/tabpanel behavior and responsive normalization.

- [x] **Step 6: Run tests/build and commit**

```bash
npm test --workspace @comic-studio/web -- --run tests/provider-settings.test.tsx tests/workspace.test.tsx
npm test --workspace @comic-studio/web
npm run build --workspace @comic-studio/web
git diff --check
git add apps/web
git commit -m "feat: add provider channel settings workspace"
```

### Task 6: Settings Visual System And Responsive Behavior

**Files:**
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/tests/provider-settings.test.tsx`
- Modify: `apps/web/e2e/production-flow.spec.ts`

- [x] **Step 1: Add failing responsive and layout assertions**

Component tests assert the three fixed channel sections and connection-result regions have stable structure. Add Playwright flow for desktop and mobile:

```ts
await page.getByRole('button', {name: '模型渠道'}).click();
await expect(page.getByRole('heading', {name: '模型渠道'})).toBeVisible();
await expect(page.getByLabel('LLM Base URL')).toBeInViewport();
```

Assert no horizontal overflow at 1440, 1024, 390, and 360 pixels; save/test controls fit and do not overlap.

- [x] **Step 2: Run focused tests and confirm layout contract fails**

```bash
npm test --workspace @comic-studio/web -- --run tests/provider-settings.test.tsx
E2E_PORT=3100 npm run test:e2e --workspace @comic-studio/web -- --grep "provider channel settings"
```

Expected: FAIL on missing final layout and responsive styling.

- [x] **Step 3: Add Studio settings CSS**

Implement a two-column settings workspace on desktop and one-column channel sections on mobile. Use existing Studio tokens, 4-8px corners, no gradients, no nested cards, strong focus states, contrast-compliant status colors, fixed control heights, and truncation/wrapping for long model names and endpoints.

- [x] **Step 4: Run focused/full verification and commit**

```bash
npm test --workspace @comic-studio/web
npm run build --workspace @comic-studio/web
E2E_PORT=3100 npm run test:e2e --workspace @comic-studio/web -- --grep "provider channel settings"
git diff --check
git add apps/web/app/globals.css apps/web/tests/provider-settings.test.tsx apps/web/e2e/production-flow.spec.ts
git commit -m "feat: style provider channel settings"
```

### Task 7: End-To-End Persistence And Release Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-11-provider-channel-configuration.md`

- [ ] **Step 1: Add deterministic settings E2E**

Mock redacted GET, test connection, PUT save, and post-save reload. Assert the full API key is never rendered after reload and the updated model is used by a subsequent mocked planning/provider operation.

- [ ] **Step 2: Update operations documentation**

Document JSON authority, `.env` bootstrap, permissions, key semantics, connection testing, immediate effect on new operations, and deletion recovery.

- [ ] **Step 3: Run full deterministic verification sequentially**

```bash
cd services/api && uv run pytest -q
cd ../.. && npm test --workspaces --if-present
npm run build --workspaces --if-present
E2E_PORT=3100 npm run test:e2e --workspace @comic-studio/web
git diff --check
```

Run Playwright against the worktree server, not the main checkout on port 3000.

- [ ] **Step 4: Run a local persistence smoke without real provider cost**

Use a temporary data root/config path to:

- bootstrap from `.env`-style defaults;
- save one changed model and masked key;
- restart the test app;
- confirm the JSON configuration remains authoritative;
- confirm key material does not appear in GET output or logs.

- [ ] **Step 5: Security and artifact audit**

```bash
npm audit --omit=dev --registry=https://registry.npmjs.org || true
git diff | rg 'sk-[A-Za-z0-9_-]{12,}' && exit 1 || true
find data -name 'provider-channels.json*' -print
git status --short
```

Confirm no real channel file, key, screenshot, `.superpowers` content, or temporary config is staged. Record the existing Next/PostCSS advisory if unchanged.

- [ ] **Step 6: Mark all plan steps complete and commit**

```bash
git add README.md docs/superpowers/plans/2026-07-11-provider-channel-configuration.md services/api apps/web .gitignore
git commit -m "feat: complete local provider channel configuration"
```
