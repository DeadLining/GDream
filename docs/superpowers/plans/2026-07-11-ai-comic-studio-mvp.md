# AI Comic Studio MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local web workspace that turns an episode brief into editable comic shots, generated panels, character dialogue, and a verified Remotion MP4 using the approved real model stack.

**Architecture:** A Next.js workspace calls a FastAPI service backed by SQLite and a local asset directory. FastAPI persists domain objects and jobs, integrates MiniMax-M3, GPT Image 2, and a remote Qwen3-TTS service, then launches a Remotion compositor whose output is verified by FFmpeg.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, Lucide, FastAPI, SQLAlchemy 2, Pydantic 2, SQLite, httpx, pytest, Vitest, Playwright, Remotion, FFmpeg, uv, npm workspaces.

---

## File Map

```text
ai-comic-studio/
├── package.json                         npm workspace and root commands
├── .env.example                         server-side configuration contract
├── .gitignore
├── apps/web/                            Next.js production workspace
│   ├── app/page.tsx                     first-screen workspace
│   ├── app/globals.css                  design tokens and responsive layout
│   ├── components/                      navigator, storyboard, inspector, toolbar
│   ├── lib/api.ts                       typed FastAPI client
│   └── tests/                           Vitest component and state tests
├── services/api/
│   ├── pyproject.toml                   Python dependencies and test config
│   ├── comic_studio/main.py             FastAPI composition root
│   ├── comic_studio/config.py           environment settings
│   ├── comic_studio/db.py               engine and session lifecycle
│   ├── comic_studio/models.py           SQLAlchemy persistence models
│   ├── comic_studio/schemas.py          API and LLM schemas
│   ├── comic_studio/repositories.py     transactional data access
│   ├── comic_studio/jobs.py             persisted background job state machine
│   ├── comic_studio/providers/          MiniMax, GPT Image, Qwen TTS adapters
│   ├── comic_studio/services/           planning, assets, speech, rendering
│   ├── comic_studio/routes/              HTTP endpoints grouped by resource
│   └── tests/                            unit, API, and provider contract tests
├── packages/compositor/
│   ├── src/manifest.ts                  render manifest schema
│   ├── src/ComicEpisode.tsx             Remotion composition
│   ├── src/index.ts                     Remotion registration
│   ├── scripts/render.mjs               stable CLI render entrypoint
│   └── tests/manifest.test.ts            manifest validation tests
└── deploy/qwen3-tts/
    ├── app.py                            HTTP service contract
    ├── requirements.txt                 pinned runtime dependencies
    ├── qwen3-tts.service                systemd unit template
    └── README.md                         A800_94 deployment and health checks
```

### Task 1: Repository And API Skeleton

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `services/api/pyproject.toml`
- Create: `services/api/comic_studio/__init__.py`
- Create: `services/api/comic_studio/config.py`
- Create: `services/api/comic_studio/main.py`
- Test: `services/api/tests/test_health.py`

- [ ] **Step 1: Write the failing health test**

```python
from fastapi.testclient import TestClient
from comic_studio.main import create_app


def test_health_reports_service_name():
    response = TestClient(create_app()).get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "ai-comic-studio"}
```

- [ ] **Step 2: Verify the test fails because the application package does not exist**

Run: `cd services/api && uv run pytest tests/test_health.py -q`
Expected: import failure for `comic_studio.main`.

- [ ] **Step 3: Implement settings and the health endpoint**

```python
from fastapi import FastAPI


def create_app() -> FastAPI:
    app = FastAPI(title="AI Comic Studio")

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "ai-comic-studio"}

    return app


app = create_app()
```

- [ ] **Step 4: Run the health test and full API test suite**

Run: `cd services/api && uv run pytest -q`
Expected: one passing test.

- [ ] **Step 5: Commit the skeleton**

```bash
git add package.json .gitignore .env.example services/api
git commit -m "chore: scaffold comic studio services"
```

### Task 2: Domain Persistence And Project API

**Files:**
- Create: `services/api/comic_studio/db.py`
- Create: `services/api/comic_studio/models.py`
- Create: `services/api/comic_studio/schemas.py`
- Create: `services/api/comic_studio/repositories.py`
- Create: `services/api/comic_studio/routes/projects.py`
- Modify: `services/api/comic_studio/main.py`
- Test: `services/api/tests/test_projects_api.py`

- [ ] **Step 1: Write failing project and character persistence tests**

```python
def test_project_and_characters_survive_new_request(client):
    project = client.post("/api/projects", json={
        "title": "霓虹夜行",
        "logline": "失忆侦探寻找被删除的城市记忆",
        "story_bible": "近未来重庆，记忆可以买卖。",
        "visual_style": "Chinese noir comic, cyan and red accents",
        "aspect_ratio": "9:16",
    }).json()
    character = client.post(f"/api/projects/{project['id']}/characters", json={
        "name": "林默",
        "role": "protagonist",
        "appearance_bible": "27-year-old Chinese man, black coat, silver left eye",
        "personality": "quiet, observant, distrustful",
        "continuity_rules": "Always wears the black coat outdoors",
        "voice_speaker": "Dylan",
        "voice_instruction": "冷静、低声、略带疲惫",
    }).json()
    loaded = client.get(f"/api/projects/{project['id']}").json()
    assert loaded["title"] == "霓虹夜行"
    assert loaded["characters"][0]["id"] == character["id"]
```

- [ ] **Step 2: Run the test and confirm missing routes fail**

Run: `cd services/api && uv run pytest tests/test_projects_api.py -q`
Expected: HTTP 404 for `/api/projects`.

- [ ] **Step 3: Implement SQLAlchemy models, repositories, schemas, and routes**

Implement UUID string IDs, UTC timestamps, project ownership foreign keys, cascade deletes, and a transaction per request. Character voice fields must be server validated and API secrets must not appear in any model.

- [ ] **Step 4: Run persistence tests with a temporary SQLite database**

Run: `cd services/api && uv run pytest tests/test_projects_api.py -q`
Expected: project and character tests pass.

- [ ] **Step 5: Commit domain persistence**

```bash
git add services/api
git commit -m "feat: add project and character persistence"
```

### Task 3: Episode, Scene, Shot, Dialogue, Asset, And Job Models

**Files:**
- Modify: `services/api/comic_studio/models.py`
- Modify: `services/api/comic_studio/schemas.py`
- Modify: `services/api/comic_studio/repositories.py`
- Create: `services/api/comic_studio/routes/episodes.py`
- Create: `services/api/comic_studio/jobs.py`
- Test: `services/api/tests/test_episode_graph.py`
- Test: `services/api/tests/test_job_transitions.py`

- [ ] **Step 1: Write failing episode graph ordering test**

```python
def test_episode_graph_returns_scenes_shots_and_dialogue_in_order(client, seeded_project):
    episode = client.post(f"/api/projects/{seeded_project}/episodes", json={
        "title": "失窃的雨夜", "premise": "林默追查一段被盗记忆", "target_duration_seconds": 60
    }).json()
    graph = client.get(f"/api/episodes/{episode['id']}").json()
    assert graph["scenes"] == []
    assert graph["status"] == "draft"
```

- [ ] **Step 2: Write failing legal job transition tests**

```python
def test_job_rejects_transition_from_succeeded_to_running(job_store):
    job = job_store.create("plan_episode", "episode", "ep-1", {})
    job_store.transition(job.id, "running")
    job_store.transition(job.id, "succeeded")
    with pytest.raises(InvalidJobTransition):
        job_store.transition(job.id, "running")
```

- [ ] **Step 3: Verify both tests fail for missing models and state machine**

Run: `cd services/api && uv run pytest tests/test_episode_graph.py tests/test_job_transitions.py -q`
Expected: missing episode routes and `InvalidJobTransition`.

- [ ] **Step 4: Implement ordered graph persistence and job states**

Allowed job transitions are `queued -> running`, `running -> succeeded`, `running -> failed`, and `failed -> queued`. Store progress from 0 through 100 and sanitized error text.

- [ ] **Step 5: Run API and state-machine tests**

Run: `cd services/api && uv run pytest -q`
Expected: all API tests pass.

- [ ] **Step 6: Commit episode graph and jobs**

```bash
git add services/api
git commit -m "feat: model episode production graph and jobs"
```

### Task 4: MiniMax-M3 Structured Planning

**Files:**
- Create: `services/api/comic_studio/providers/base.py`
- Create: `services/api/comic_studio/providers/minimax.py`
- Create: `services/api/comic_studio/services/planning.py`
- Create: `services/api/comic_studio/routes/jobs.py`
- Modify: `services/api/comic_studio/routes/episodes.py`
- Test: `services/api/tests/providers/test_minimax.py`
- Test: `services/api/tests/test_episode_planning.py`

- [ ] **Step 1: Write failing Anthropic request contract test**

```python
async def test_minimax_uses_m3_and_never_logs_api_key(http_fake, minimax_provider):
    http_fake.post("/v1/messages", json={"content": [{"type": "text", "text": VALID_PLAN_JSON}]})
    plan = await minimax_provider.plan_episode(PLANNING_CONTEXT)
    request = http_fake.last_request
    assert request.json()["model"] == "MiniMax-M3"
    assert request.headers["anthropic-version"] == "2023-06-01"
    assert plan.scenes[0].shots[0].dialogue[0].character_id == "char-1"
```

- [ ] **Step 2: Verify the provider test fails because no adapter exists**

Run: `cd services/api && uv run pytest tests/providers/test_minimax.py -q`
Expected: missing `providers.minimax`.

- [ ] **Step 3: Implement strict planning schemas and MiniMax adapter**

The prompt contains the story bible, characters, episode brief, continuity constraints, and exact JSON shape. Strip optional Markdown fences, parse once, validate with Pydantic, and retry once with validation errors.

- [ ] **Step 4: Implement planning job persistence transaction**

Persist the entire generated scene graph only after validation succeeds. A failed retry marks the job failed and leaves the existing episode graph unchanged.

- [ ] **Step 5: Run provider and planning integration tests**

Run: `cd services/api && uv run pytest tests/providers/test_minimax.py tests/test_episode_planning.py -q`
Expected: request contract, retry, rollback, and graph creation tests pass.

- [ ] **Step 6: Commit MiniMax planning**

```bash
git add services/api
git commit -m "feat: generate structured episodes with MiniMax M3"
```

### Task 5: GPT Image 2 Assets And Versioning

**Files:**
- Create: `services/api/comic_studio/assets.py`
- Create: `services/api/comic_studio/providers/gpt_image.py`
- Create: `services/api/comic_studio/services/panels.py`
- Create: `services/api/comic_studio/routes/assets.py`
- Test: `services/api/tests/providers/test_gpt_image.py`
- Test: `services/api/tests/test_panel_versions.py`

- [ ] **Step 1: Write failing generation contract and immutable version tests**

```python
async def test_generate_panel_uses_gpt_image_2(gpt_image_provider, image_http_fake):
    image_http_fake.post("/v1/images/generations", json={"data": [{"b64_json": PNG_BASE64}]})
    result = await gpt_image_provider.generate("comic panel", "1024x1536")
    assert image_http_fake.last_request.json()["model"] == "gpt-image-2"
    assert result.media_type == "image/png"


def test_rejected_panel_version_does_not_replace_active_asset(panel_service, shot):
    first = panel_service.register_version(shot.id, b"first", activate=True)
    second = panel_service.register_version(shot.id, b"second", activate=False)
    assert panel_service.get_shot(shot.id).active_panel_asset_id == first.id
    assert first.id != second.id
```

- [ ] **Step 2: Run tests and confirm missing provider and asset store failures**

Run: `cd services/api && uv run pytest tests/providers/test_gpt_image.py tests/test_panel_versions.py -q`
Expected: imports fail for the new provider and service.

- [ ] **Step 3: Implement safe local asset storage and GPT Image adapter**

Use `GPT_IMAGE_BASE_URL`, `GPT_IMAGE_KEY`, and `GPT_IMAGE_MODEL`. Decode base64 or download returned URLs, calculate SHA-256, probe PNG dimensions, and write with an atomic temporary-file rename under the project directory.

- [ ] **Step 4: Implement panel prompt construction and version activation**

Combine visual style, character appearance bibles, continuity constraints, shot composition, camera language, and negative constraints. Store the sanitized request metadata with every asset.

- [ ] **Step 5: Run image and versioning tests**

Run: `cd services/api && uv run pytest -q`
Expected: all API tests pass without real provider calls.

- [ ] **Step 6: Commit panel generation**

```bash
git add services/api
git commit -m "feat: add GPT Image panel generation and versions"
```

### Task 6: Qwen3-TTS Service And Speech Adapter

**Files:**
- Create: `deploy/qwen3-tts/app.py`
- Create: `deploy/qwen3-tts/requirements.txt`
- Create: `deploy/qwen3-tts/qwen3-tts.service`
- Create: `deploy/qwen3-tts/README.md`
- Create: `services/api/comic_studio/providers/qwen_tts.py`
- Create: `services/api/comic_studio/services/speech.py`
- Test: `services/api/tests/providers/test_qwen_tts.py`
- Test: `services/api/tests/test_dialogue_speech.py`

- [ ] **Step 1: Write failing TTS HTTP contract test**

```python
async def test_qwen_tts_sends_character_performance(qwen_provider, tts_http_fake):
    tts_http_fake.post("/v1/audio/speech", content=WAV_BYTES, headers={"content-type": "audio/wav"})
    audio = await qwen_provider.synthesize(
        text="别回头。", speaker="Dylan", language="Chinese", instruction="低声、紧张、快速"
    )
    request = tts_http_fake.last_request.json()
    assert request["model"] == "Qwen3-TTS-12Hz-1.7B-CustomVoice"
    assert request["speaker"] == "Dylan"
    assert audio.startswith(b"RIFF")
```

- [ ] **Step 2: Verify the speech tests fail before implementation**

Run: `cd services/api && uv run pytest tests/providers/test_qwen_tts.py tests/test_dialogue_speech.py -q`
Expected: missing Qwen provider.

- [ ] **Step 3: Implement the remote service contract**

Expose `/health`, `/v1/voices`, and `/v1/audio/speech`. Load `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice` once on startup using bfloat16, reject unsupported speakers, synthesize WAV into memory, and return `audio/wav`.

- [ ] **Step 4: Deploy to A800_94 through HostBridge**

Upload deployment files to `/opt/ai-comic-studio/qwen3-tts`, create a Python 3.12 uv environment, install requirements, download the ModelScope weights, configure a systemd service bound to an allowlisted port, and verify `/health`, `/v1/voices`, and a Chinese synthesis request.

- [ ] **Step 5: Implement dialogue audio storage and duration probing**

Merge character defaults with line instructions, store WAV assets immutably, use `ffprobe` for duration, and warn when speech exceeds shot duration.

- [ ] **Step 6: Run speech contract tests and live smoke test**

Run: `cd services/api && uv run pytest tests/providers/test_qwen_tts.py tests/test_dialogue_speech.py -q`
Expected: contract tests pass.

Run: `AI_COMIC_LIVE_TESTS=1 uv run pytest tests/live/test_qwen_tts_live.py -q`
Expected: one playable nonempty WAV is returned from A800_94.

- [ ] **Step 7: Commit TTS deployment and adapter**

```bash
git add deploy services/api
git commit -m "feat: deploy Qwen3 TTS and synthesize dialogue"
```

### Task 7: Remotion Manifest And Verified Rendering

**Files:**
- Create: `packages/compositor/package.json`
- Create: `packages/compositor/tsconfig.json`
- Create: `packages/compositor/src/manifest.ts`
- Create: `packages/compositor/src/ComicEpisode.tsx`
- Create: `packages/compositor/src/index.ts`
- Create: `packages/compositor/scripts/render.mjs`
- Create: `packages/compositor/tests/manifest.test.ts`
- Create: `services/api/comic_studio/services/rendering.py`
- Create: `services/api/comic_studio/routes/renders.py`
- Test: `services/api/tests/test_render_manifest.py`

- [ ] **Step 1: Write failing render manifest tests**

```typescript
it('rejects a shot without an approved panel', () => {
  expect(() => parseManifest({episode: baseEpisode, shots: [{...baseShot, panelPath: ''}]})).toThrow();
});
```

```python
def test_render_manifest_uses_only_active_approved_assets(render_service, approved_episode):
    manifest = render_service.build_manifest(approved_episode.id)
    assert all(shot["panel_path"] for shot in manifest["shots"])
    assert all(shot["review_status"] == "approved" for shot in manifest["shots"])
```

- [ ] **Step 2: Run TypeScript and Python tests and confirm failure**

Run: `npm test --workspace @comic-studio/compositor`
Expected: missing manifest module.

Run: `cd services/api && uv run pytest tests/test_render_manifest.py -q`
Expected: missing rendering service.

- [ ] **Step 3: Implement manifest validation and composition**

Render fixed-size portrait or landscape frames. Use stable shot durations, panel motion presets, subtitle-safe regions, dialogue bubbles, audio sequences, and restrained transitions. Dimensions must not change based on loading or text length.

- [ ] **Step 4: Implement render launcher and FFmpeg verification**

Launch Remotion with a JSON manifest path. Verify file existence, video and audio streams, dimensions, H.264-compatible video, AAC audio, positive duration, and nonzero frame count before marking the job succeeded.

- [ ] **Step 5: Run a deterministic smoke render**

Run: `npm run render:fixture --workspace @comic-studio/compositor`
Expected: `packages/compositor/out/fixture.mp4` exists and `ffprobe` reports video and audio streams.

- [ ] **Step 6: Commit compositor and rendering API**

```bash
git add packages/compositor services/api
git commit -m "feat: render verified dynamic comic episodes"
```

### Task 8: Next.js Production Workspace

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/app/layout.tsx`
- Create: `apps/web/app/page.tsx`
- Create: `apps/web/app/globals.css`
- Create: `apps/web/components/AppToolbar.tsx`
- Create: `apps/web/components/ProjectNavigator.tsx`
- Create: `apps/web/components/Storyboard.tsx`
- Create: `apps/web/components/ShotCard.tsx`
- Create: `apps/web/components/Inspector.tsx`
- Create: `apps/web/components/JobStatus.tsx`
- Create: `apps/web/lib/api.ts`
- Create: `apps/web/lib/types.ts`
- Test: `apps/web/tests/workspace.test.tsx`

- [ ] **Step 1: Write failing workspace behavior tests**

```tsx
it('selects a shot and exposes generation controls in the inspector', async () => {
  render(<Workspace initialEpisode={fixtureEpisode} />);
  await userEvent.click(screen.getByRole('button', {name: /镜头 2/}));
  expect(screen.getByRole('heading', {name: '镜头 2'})).toBeVisible();
  expect(screen.getByRole('button', {name: '生成画面'})).toBeEnabled();
});
```

- [ ] **Step 2: Run the test and confirm the workspace is missing**

Run: `npm test --workspace @comic-studio/web`
Expected: missing workspace component.

- [ ] **Step 3: Implement the dense production layout**

Use a 52px top toolbar, 248px left navigator, flexible storyboard center, and 320px inspector. Use Lucide icons for icon actions with tooltips, 6px card radii, neutral surfaces plus distinct success/warning/error accents, and stable shot-card aspect ratios.

- [ ] **Step 4: Implement mobile behavior**

Below 900px, use a two-view segmented control for storyboard and inspector; the project navigator becomes a drawer. Keep the selected shot and active job visible without overlapping controls.

- [ ] **Step 5: Connect project, episode, generation, speech, job, and render APIs**

All mutations show pending, succeeded, and failed states. Poll active jobs with bounded intervals and stop polling on terminal states.

- [ ] **Step 6: Run component tests and production build**

Run: `npm test --workspace @comic-studio/web && npm run build --workspace @comic-studio/web`
Expected: tests and Next.js build exit successfully.

- [ ] **Step 7: Commit the production workspace**

```bash
git add apps/web package.json
git commit -m "feat: add dynamic comic production workspace"
```

### Task 9: Provider Health, Security, And Local Startup

**Files:**
- Create: `services/api/comic_studio/routes/providers.py`
- Create: `services/api/comic_studio/redaction.py`
- Create: `scripts/dev.sh`
- Create: `README.md`
- Test: `services/api/tests/test_provider_health.py`
- Test: `services/api/tests/test_redaction.py`

- [ ] **Step 1: Write failing secret redaction and health tests**

```python
def test_redacts_api_keys_from_nested_provider_errors():
    data = {"error": "Authorization Bearer sk-secret-value", "request": {"api_key": "sk-other"}}
    assert redact(data) == {"error": "Authorization Bearer [REDACTED]", "request": {"api_key": "[REDACTED]"}}


def test_provider_health_returns_models_without_credentials(client):
    payload = client.get("/api/providers/health").json()
    assert payload["llm"]["model"] == "MiniMax-M3"
    assert payload["image"]["model"] == "gpt-image-2"
    assert "api_key" not in str(payload).lower()
```

- [ ] **Step 2: Verify tests fail for missing redaction and route**

Run: `cd services/api && uv run pytest tests/test_provider_health.py tests/test_redaction.py -q`
Expected: missing functions and HTTP 404.

- [ ] **Step 3: Implement sanitized provider checks and local startup**

Health checks report configured status, model, endpoint host, latency, and sanitized error. `scripts/dev.sh` starts API and web processes, traps signals, and prints local URLs.

- [ ] **Step 4: Run security and full test suites**

Run: `cd services/api && uv run pytest -q`
Expected: all Python tests pass.

Run: `npm test --workspaces --if-present`
Expected: all TypeScript tests pass.

- [ ] **Step 5: Commit operations support**

```bash
git add services/api scripts README.md
git commit -m "feat: add provider diagnostics and local startup"
```

### Task 10: End-To-End Verification

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/production-flow.spec.ts`
- Create: `services/api/tests/live/test_model_stack_live.py`
- Modify: `README.md`

- [ ] **Step 1: Write the deterministic Playwright workflow**

The test creates a project, adds two characters, creates an episode, loads a seeded planned graph, selects a shot, generates a deterministic test panel and dialogue asset, approves the shot, starts a fixture render, and confirms the MP4 link appears.

- [ ] **Step 2: Run Playwright against desktop and mobile viewports**

Run: `npm run test:e2e --workspace @comic-studio/web`
Expected: Chromium desktop and mobile projects pass with no overlap screenshots.

- [ ] **Step 3: Run opt-in live provider smoke tests**

Run: `AI_COMIC_LIVE_TESTS=1 cd services/api && uv run pytest tests/live/test_model_stack_live.py -q`
Expected: MiniMax returns valid structured JSON, GPT Image returns a decodable PNG, and Qwen3-TTS returns a playable WAV.

- [ ] **Step 4: Run full verification**

Run: `cd services/api && uv run pytest -q`

Run: `npm test --workspaces --if-present`

Run: `npm run build --workspaces --if-present`

Run: `npm run test:e2e --workspace @comic-studio/web`

Run: `git diff --check && git status --short`

Expected: all tests and builds exit 0, the app is reachable locally, generated media probes successfully, and only intentional files remain uncommitted.

- [ ] **Step 5: Commit end-to-end coverage**

```bash
git add apps/web services/api README.md
git commit -m "test: verify the comic production workflow"
```
