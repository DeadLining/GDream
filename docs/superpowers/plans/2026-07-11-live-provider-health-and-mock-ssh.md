# Live Provider Health And Mock SSH Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add truthful live provider checks and a manually controlled, restart-restored HostBridge Mock SSH bridge to the Model Channels workspace.

**Architecture:** A focused `MockSshManager` owns lifecycle state, subprocess identity, bounded logs, persistence, and restart restoration. FastAPI routes expose narrow lifecycle commands and aggregate provider tests concurrently; React components consume those APIs, display detailed live status, and never receive credentials or arbitrary command controls.

**Tech Stack:** Python 3.12, FastAPI, Pydantic, asyncio, subprocess, atomic JSON persistence, React 19, Next.js 16, TypeScript, Vitest, Testing Library, Playwright.

---

## File Map

- Create `services/api/comic_studio/services/mock_ssh.py`: process lifecycle, persistence, parsing, ownership verification, and host listing.
- Create `services/api/comic_studio/routes/mock_ssh.py`: validated HTTP lifecycle surface.
- Create `services/api/tests/test_mock_ssh_manager.py`: unit coverage for lifecycle and persistence.
- Create `services/api/tests/test_mock_ssh_api.py`: API and lifespan restoration coverage.
- Modify `services/api/comic_studio/config.py`: lifecycle state and log paths plus HostBridge executable setting.
- Modify `services/api/comic_studio/schemas.py`: Mock SSH and live health response models.
- Modify `services/api/comic_studio/main.py`: manager construction, router registration, restore, and owned shutdown behavior.
- Modify `services/api/comic_studio/routes/providers.py`: concurrent live provider checks.
- Modify `services/api/comic_studio/services/provider_channel_testing.py`: direct SSH preference for an active owned bridge.
- Modify `services/api/comic_studio/providers/qwen_tts.py`: explicit SSH-first synthesis entrypoint without putting secrets in argv.
- Modify `services/api/tests/test_provider_health.py`: real aggregate health behavior.
- Modify `services/api/tests/test_provider_channel_testing.py`: active-bridge TTS routing behavior.
- Create `apps/web/components/MockSshControl.tsx`: Model Channels lifecycle UI.
- Create `apps/web/components/ProviderHealthStatus.tsx`: toolbar trigger and accessible result panel.
- Create `apps/web/tests/mock-ssh-control.test.tsx`: lifecycle UI tests.
- Create `apps/web/tests/provider-health-status.test.tsx`: real health UI tests.
- Modify `apps/web/components/ProviderSettings.tsx`: mount the bridge control as an un-nested section.
- Modify `apps/web/components/AppToolbar.tsx`: replace configuration counter with live status component.
- Modify `apps/web/lib/api.ts`: Mock SSH and live health client functions.
- Modify `apps/web/lib/types.ts`: typed lifecycle and health contracts.
- Modify `apps/web/app/globals.css`: compact operational status styling.
- Modify `apps/web/e2e/production-flow.spec.ts`: route-backed end-to-end interaction coverage.
- Modify `README.md` and `.env.example`: runtime requirements and optional executable override.

Because the worktree contains unrelated active edits, every implementation task must re-read the named file before editing and stage only the task's intended hunks.

### Task 1: Define Persistent Mock SSH Contracts

**Files:**
- Modify: `services/api/comic_studio/config.py`
- Modify: `services/api/comic_studio/schemas.py`
- Test: `services/api/tests/test_mock_ssh_manager.py`

- [ ] **Step 1: Write failing path and schema tests**

```python
def test_settings_resolve_mock_ssh_files_under_data_root(tmp_path, monkeypatch):
    monkeypatch.setenv("AI_COMIC_DATA_ROOT", str(tmp_path / "data"))
    get_settings.cache_clear()
    settings = get_settings()
    assert settings.mock_ssh_state_path == tmp_path / "data/mock-ssh.json"
    assert settings.mock_ssh_log_path == tmp_path / "data/mock-ssh.log"


def test_mock_ssh_start_rejects_unsafe_alias():
    with pytest.raises(ValidationError):
        MockSshStart(host_id="a800_94", alias="bad alias; rm -rf")
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `cd services/api && uv run pytest -q tests/test_mock_ssh_manager.py -k 'settings or unsafe_alias'`

Expected: FAIL because the settings and schemas do not exist.

- [ ] **Step 3: Add settings and Pydantic contracts**

Add settings resolved relative to `data_root`:

```python
mock_ssh_state_path: Path = Path("mock-ssh.json")
mock_ssh_log_path: Path = Path("mock-ssh.log")
hostbridge_executable: str = "hostbridge"
```

Add schemas with conservative identifiers:

```python
SafeIdentifier = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9._-]{1,64}$")]

class MockSshStart(BaseModel):
    host_id: SafeIdentifier
    alias: SafeIdentifier

class MockSshHostRead(BaseModel):
    id: str
    name: str
    type: str

class MockSshStatusRead(BaseModel):
    desired_running: bool
    state: Literal["stopped", "starting", "running", "stopping", "failed"]
    host_id: str = ""
    alias: str = ""
    port: int | None = None
    error: str | None = None
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `cd services/api && uv run pytest -q tests/test_mock_ssh_manager.py -k 'settings or unsafe_alias'`

Expected: PASS.

- [ ] **Step 5: Commit only Task 1**

```bash
git add services/api/comic_studio/config.py services/api/comic_studio/schemas.py services/api/tests/test_mock_ssh_manager.py
git commit -m "feat: define mock ssh lifecycle contracts"
```

### Task 2: Build The Owned Mock SSH Manager

**Files:**
- Create: `services/api/comic_studio/services/mock_ssh.py`
- Test: `services/api/tests/test_mock_ssh_manager.py`

- [ ] **Step 1: Write failing lifecycle tests**

Cover host listing, successful output parsing, duplicate start reuse, bounded logs, explicit stop, early exit, missing alias/port, concurrent start serialization, and PID identity rejection. Use an injected `process_factory`, `runner`, `clock`, and `pid_identity` so tests never launch HostBridge.

```python
def test_start_parses_alias_and_port_and_reuses_owned_child(manager, fake_process):
    fake_process.feed("listening on ssh://127.0.0.1:2230\nssh host alias: ai-comic-tts\n")
    first = manager.start("a800_94", "ai-comic-tts")
    second = manager.start("a800_94", "ai-comic-tts")
    assert first.state == "running"
    assert first.port == 2230
    assert second.reused is True
    assert manager.process_factory.calls == 1


def test_stop_rejects_reused_pid_with_wrong_owner_identity(manager):
    manager.seed_running_state(pid=4242, owner_token="expected")
    manager.pid_identity.return_value = "different-command"
    result = manager.stop()
    assert result.state == "failed"
    manager.terminator.assert_not_called()
```

- [ ] **Step 2: Run manager tests and verify RED**

Run: `cd services/api && uv run pytest -q tests/test_mock_ssh_manager.py`

Expected: FAIL because `MockSshManager` is missing.

- [ ] **Step 3: Implement minimal manager**

The manager constructor accepts `state_path`, `log_path`, `executable`, `process_factory`, `runner`, `clock`, `pid_identity`, and `terminator`. It initializes a `threading.RLock`, loads persisted state, and exposes these exact public methods: `list_hosts()`, `status()`, `start(host_id, alias)`, `stop()`, `restore()`, and `owns_running_alias(alias)`.

Spawn arguments must be an argv list, never a shell string:

```python
[
    executable,
    "mock-ssh", "start", host_id,
    "--ssh-host-alias", alias,
    "--connect-timeout", "120",
    "--command-timeout", "300",
]
```

Persist JSON with a `0600` atomic replace. Store desired state before spawn and before stop. Parse both `listening on ssh://...:<port>` and `ssh host alias: <alias>` within a bounded startup deadline. Redact errors before returning or writing state.

- [ ] **Step 4: Run manager tests and verify GREEN**

Run: `cd services/api && uv run pytest -q tests/test_mock_ssh_manager.py`

Expected: all manager tests PASS.

- [ ] **Step 5: Commit only Task 2**

```bash
git add services/api/comic_studio/services/mock_ssh.py services/api/tests/test_mock_ssh_manager.py
git commit -m "feat: manage owned hostbridge mock ssh process"
```

### Task 3: Expose Lifecycle API And Restore Desired State

**Files:**
- Create: `services/api/comic_studio/routes/mock_ssh.py`
- Create: `services/api/tests/test_mock_ssh_api.py`
- Modify: `services/api/comic_studio/main.py`

- [ ] **Step 1: Write failing API tests**

```python
def test_mock_ssh_lifecycle_endpoints(client, fake_mock_ssh_manager):
    assert client.get("/api/mock-ssh/hosts").status_code == 200
    started = client.post("/api/mock-ssh/start", json={"host_id": "a800_94", "alias": "ai-comic-tts"})
    assert started.json()["state"] == "running"
    stopped = client.post("/api/mock-ssh/stop")
    assert stopped.json()["state"] == "stopped"


def test_lifespan_restores_desired_bridge(monkeypatch):
    manager = Mock(spec=MockSshManager)
    manager.restore.return_value = MockSshStatusRead(
        desired_running=True, state="running", host_id="a800_94",
        alias="ai-comic-tts", port=2230,
    )
    with TestClient(create_app(mock_ssh_manager=manager)):
        manager.restore.assert_called_once_with()
```

- [ ] **Step 2: Run API tests and verify RED**

Run: `cd services/api && uv run pytest -q tests/test_mock_ssh_api.py`

Expected: FAIL with missing routes and app state.

- [ ] **Step 3: Add router and lifespan integration**

```python
router = APIRouter(prefix="/api/mock-ssh", tags=["mock-ssh"])

@router.get("/hosts", response_model=list[MockSshHostRead])
def hosts(request: Request):
    return request.app.state.mock_ssh_manager.list_hosts()

@router.get("/status", response_model=MockSshStatusRead)
def status(request: Request):
    return request.app.state.mock_ssh_manager.status()

@router.post("/start", response_model=MockSshStatusRead)
def start(payload: MockSshStart, request: Request):
    return request.app.state.mock_ssh_manager.start(payload.host_id, payload.alias)

@router.post("/stop", response_model=MockSshStatusRead)
def stop(request: Request):
    return request.app.state.mock_ssh_manager.stop()
```

Construct the manager in `create_app`, call `restore()` during lifespan startup, and register the router. Do not blindly stop a desired-running bridge on normal API shutdown; retain ownership metadata so the next process can verify and reuse or replace it.

- [ ] **Step 4: Run API tests and the existing API suite**

Run: `cd services/api && uv run pytest -q tests/test_mock_ssh_api.py && uv run pytest -q`

Expected: all tests PASS.

- [ ] **Step 5: Commit only Task 3**

```bash
git add services/api/comic_studio/routes/mock_ssh.py services/api/comic_studio/main.py services/api/tests/test_mock_ssh_api.py
git commit -m "feat: expose mock ssh lifecycle api"
```

### Task 4: Route TTS Directly Through An Active Bridge

**Files:**
- Modify: `services/api/comic_studio/providers/qwen_tts.py`
- Modify: `services/api/comic_studio/services/provider_channel_testing.py`
- Modify: `services/api/tests/providers/test_qwen_tts.py`
- Modify: `services/api/tests/test_provider_channel_testing.py`

- [ ] **Step 1: Write failing SSH-first tests**

```python
@pytest.mark.anyio
async def test_tts_uses_ssh_first_when_owned_bridge_is_active():
    direct = RecordingClient(fail_if_called=True)
    provider = QwenTTSProvider(
        client=direct,
        ssh_host="ai-comic-tts",
        prefer_ssh=True,
        ssh_executor=lambda command, payload: base64.b64encode(WAV),
    )
    assert await provider.synthesize("测试", "Dylan") == WAV
    assert direct.requests == []
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd services/api && uv run pytest -q tests/providers/test_qwen_tts.py tests/test_provider_channel_testing.py -k ssh_first`

Expected: FAIL because `prefer_ssh` is unsupported.

- [ ] **Step 3: Implement explicit SSH-first behavior**

Add `prefer_ssh: bool = False`. At the start of `synthesize`, when `prefer_ssh` and `ssh_host` are set, call `_synthesize_via_ssh` through `asyncio.to_thread` before creating or using the HTTP client.

Inject `prefer_ssh` from `ProviderChannelTestingService` and `ProviderFactory` only when `mock_ssh_manager.owns_running_alias(channel.ssh_host)` returns true. Preserve the existing direct-then-fallback behavior for independently managed aliases.

- [ ] **Step 4: Run provider tests and API suite**

Run: `cd services/api && uv run pytest -q tests/providers/test_qwen_tts.py tests/test_provider_channel_testing.py && uv run pytest -q`

Expected: all tests PASS.

- [ ] **Step 5: Commit only Task 4**

```bash
git add services/api/comic_studio/providers/qwen_tts.py services/api/comic_studio/services/provider_channel_testing.py services/api/tests/providers/test_qwen_tts.py services/api/tests/test_provider_channel_testing.py
git commit -m "perf: use active mock ssh bridge for tts"
```

### Task 5: Replace Configuration Health With Concurrent Live Checks

**Files:**
- Modify: `services/api/comic_studio/routes/providers.py`
- Modify: `services/api/comic_studio/schemas.py`
- Modify: `services/api/tests/test_provider_health.py`

- [ ] **Step 1: Write failing aggregate tests**

```python
@pytest.mark.anyio
async def test_provider_health_runs_enabled_checks_concurrently(async_client, monkeypatch):
    active = 0
    peak = 0
    async def fake_test(self, kind, channel):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.01)
        active -= 1
        return ProviderChannelTestRead(
            status="ok", model=channel.model, host="provider.example",
            elapsed_ms=10, check_scope="model", error=None,
        )
    monkeypatch.setattr(ProviderChannelTestingService, "test", fake_test)
    response = await async_client.get("/api/providers/health")
    assert response.status_code == 200
    assert set(response.json()) == {"llm", "image", "tts", "video"}
    assert all(item["status"] == "ok" for item in response.json().values())
    assert peak > 1


def test_provider_health_returns_disabled_without_testing(client):
    store = client.app.state.provider_channel_store
    store.update(lambda channels: channels.model_copy(
        update={"video": channels.video.model_copy(update={"enabled": False})}
    ))
    response = client.get("/api/providers/health")
    assert response.json()["video"]["status"] == "disabled"
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cd services/api && uv run pytest -q tests/test_provider_health.py`

Expected: FAIL because health returns `configured` synchronously.

- [ ] **Step 3: Implement concurrent live health**

Use `asyncio.gather` with one coroutine per enabled channel. Reuse `ProviderChannelTestingService`; choose the TTS timeout already defined for individual testing. Return `ProviderChannelTestRead`-compatible fields plus `disabled` state.

```python
@router.get("/health", response_model=dict[ProviderChannelKind, ProviderHealthRead])
async def provider_health(request: Request):
    async def check(kind, channel):
        if not channel.enabled:
            return ProviderHealthRead.disabled(channel)
        return ProviderHealthRead.from_test(await service_for(kind).test(kind, channel))
    return dict(zip(kinds, await asyncio.gather(*(check(k, getattr(snapshot, k)) for k in kinds))))
```

- [ ] **Step 4: Run health tests and API suite**

Run: `cd services/api && uv run pytest -q tests/test_provider_health.py && uv run pytest -q`

Expected: all tests PASS.

- [ ] **Step 5: Commit only Task 5**

```bash
git add services/api/comic_studio/routes/providers.py services/api/comic_studio/schemas.py services/api/tests/test_provider_health.py
git commit -m "feat: run live provider health checks"
```

### Task 6: Add Mock SSH Controls To Model Channels

**Files:**
- Create: `apps/web/components/MockSshControl.tsx`
- Create: `apps/web/tests/mock-ssh-control.test.tsx`
- Modify: `apps/web/components/ProviderSettings.tsx`
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/lib/types.ts`
- Modify: `apps/web/app/globals.css`

- [ ] **Step 1: Write failing component tests**

```tsx
it('starts and stops a selected HostBridge bridge', async () => {
  mocks.listMockSshHosts.mockResolvedValue([{id:'a800_94', name:'A800_94服务器', type:'ssh'}]);
  mocks.getMockSshStatus.mockResolvedValue(stopped);
  mocks.startMockSsh.mockResolvedValue({...running, alias:'ai-comic-tts', port:2230});
  render(<MockSshControl/>);
  await userEvent.click(await screen.findByRole('button', {name:'启动 Mock SSH'}));
  expect(await screen.findByText('ai-comic-tts :2230')).toBeVisible();
  expect(screen.getByRole('button', {name:'停止 Mock SSH'})).toBeEnabled();
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test --workspace @comic-studio/web -- --run tests/mock-ssh-control.test.tsx`

Expected: FAIL because the component and API clients are missing.

- [ ] **Step 3: Implement types, clients, and control component**

Add typed clients:

```ts
export const listMockSshHosts = () => apiRequest<MockSshHost[]>('/api/mock-ssh/hosts');
export const getMockSshStatus = () => apiRequest<MockSshStatus>('/api/mock-ssh/status');
export const startMockSsh = (host_id:string, alias:string) => apiRequest<MockSshStatus>('/api/mock-ssh/start', json('POST',{host_id,alias}));
export const stopMockSsh = () => apiRequest<MockSshStatus>('/api/mock-ssh/stop', json('POST',{}));
```

Render a compact operational section with a select, alias input, status indicator, and separate start/stop icon-plus-text commands. Disable duplicate actions while pending. Mount it after the provider sections, not inside another card.

- [ ] **Step 4: Run component tests and Web build**

Run: `npm test --workspace @comic-studio/web -- --run tests/mock-ssh-control.test.tsx && npm run build --workspace @comic-studio/web`

Expected: PASS and successful build.

- [ ] **Step 5: Commit only Task 6**

```bash
git add apps/web/components/MockSshControl.tsx apps/web/tests/mock-ssh-control.test.tsx apps/web/components/ProviderSettings.tsx apps/web/lib/api.ts apps/web/lib/types.ts apps/web/app/globals.css
git commit -m "feat: add model channel mock ssh controls"
```

### Task 7: Show Real Health Results In The Toolbar

**Files:**
- Create: `apps/web/components/ProviderHealthStatus.tsx`
- Create: `apps/web/tests/provider-health-status.test.tsx`
- Modify: `apps/web/components/AppToolbar.tsx`
- Modify: `apps/web/lib/types.ts`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/tests/workspace.test.tsx`

- [ ] **Step 1: Write failing UI tests**

```tsx
it('shows live progress and detailed partial failure', async () => {
  const pending = deferred<ProviderHealth>();
  mocks.getProviderHealth.mockReturnValue(pending.promise);
  render(<ProviderHealthStatus/>);
  await userEvent.click(screen.getByRole('button', {name:'检测模型服务'}));
  expect(screen.getByText('检测中')).toBeVisible();
  pending.resolve({llm:ok(120), image:ok(80), tts:failed(16000), video:disabled()});
  expect(await screen.findByText('2/3 正常')).toBeVisible();
  expect(screen.getByText('语音合成')).toBeVisible();
  expect(screen.getByText('Connection timed out')).toBeVisible();
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test --workspace @comic-studio/web -- --run tests/provider-health-status.test.tsx`

Expected: FAIL because live health UI is missing.

- [ ] **Step 3: Implement live trigger and accessible details**

`ProviderHealthStatus` owns loading, result, error, open/closed detail state, and generation guards. The denominator counts enabled results (`ok` plus `failed`) and excludes `disabled`. The toolbar button text transitions through `检测服务`, `检测中`, and `N/M 正常`.

Use an accessible popover-like region controlled by the button; do not use nested cards. Each row shows provider label, status, elapsed time, and sanitized error. Duplicate clicks are disabled while pending.

- [ ] **Step 4: Run component tests, workspace tests, and build**

Run: `npm test --workspace @comic-studio/web -- --run tests/provider-health-status.test.tsx tests/workspace.test.tsx && npm run build --workspace @comic-studio/web`

Expected: PASS and successful build. If the existing unrelated roving-tab test still fails, isolate and report it without changing keyboard navigation as part of this task.

- [ ] **Step 5: Commit only Task 7**

```bash
git add apps/web/components/ProviderHealthStatus.tsx apps/web/tests/provider-health-status.test.tsx apps/web/components/AppToolbar.tsx apps/web/lib/types.ts apps/web/app/globals.css apps/web/tests/workspace.test.tsx
git commit -m "feat: display live provider health status"
```

### Task 8: End-To-End Verification And Operations Documentation

**Files:**
- Modify: `apps/web/e2e/production-flow.spec.ts`
- Modify: `README.md`
- Modify: `.env.example`

- [ ] **Step 1: Add route-backed E2E coverage**

Test the Model Channels bridge section and toolbar health details with deterministic mocked routes:

```ts
await page.route('**/api/mock-ssh/status', route => route.fulfill({json:runningStatus}));
await page.route('**/api/providers/health', route => route.fulfill({json:liveHealth}));
await page.getByRole('button', {name:'检测模型服务'}).click();
await expect(page.getByText('3/3 正常')).toBeVisible();
await page.getByRole('tab', {name:'模型渠道'}).click();
await expect(page.getByText('ai-comic-tts :2230')).toBeVisible();
```

- [ ] **Step 2: Document runtime behavior**

Document HostBridge 2.0.0 as a prerequisite, the optional `AI_COMIC_HOSTBRIDGE_EXECUTABLE` override, persistent desired state, explicit stop semantics, and the distinction between live health and configuration.

- [ ] **Step 3: Run complete automated verification**

Run:

```bash
cd services/api && uv run pytest -q
cd ../.. && npm test --workspaces --if-present
npm run build --workspaces --if-present
npm run test:e2e --workspace @comic-studio/web
git diff --check
```

Expected: all feature tests and builds PASS. Record any unrelated pre-existing failure separately with its exact test name.

- [ ] **Step 4: Run live HostBridge and provider verification**

From the Model Channels page:

1. Start `a800_94` as `ai-comic-tts` and confirm running alias/port.
2. Run live provider health and record statuses and elapsed milliseconds without credentials.
3. Run a second TTS check while the bridge remains active; confirm it skips the direct LAN timeout and repeated HostBridge setup.
4. Stop the bridge from the page.
5. Verify unrelated HostBridge listeners and processes remain running.
6. Restart the API once with desired state running and confirm automatic restoration; then explicitly stop it so the final local state is intentional.

- [ ] **Step 5: Review diff and commit Task 8**

```bash
git diff --check
git status --short
git add apps/web/e2e/production-flow.spec.ts README.md .env.example
git commit -m "docs: verify live health and mock ssh workflow"
```

## Completion Gate

Before reporting completion, run the fresh full verification commands from Task 8, inspect the live provider response, inspect the owned Mock SSH status, and confirm no command sessions remain unintentionally active. Do not claim the latency improvement from unit tests alone; use two consecutive live TTS checks through the page and report the measured times.
