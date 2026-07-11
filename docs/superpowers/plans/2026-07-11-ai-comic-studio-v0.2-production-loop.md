# AI Comic Studio v0.2 Production Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static demo workspace with a persisted, review-driven production workflow from project creation through verified MP4 download.

**Architecture:** Extend the existing FastAPI repositories with explicit list, patch, asset-version, and retry contracts. Build a typed React API boundary and a workspace controller that owns selections and persisted job polling while focused components render and edit individual domains.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy, Pydantic, SQLite, Next.js 16, React 19, TypeScript, Vitest, Testing Library, Playwright, Remotion, FFmpeg.

---

## File Map

- `services/api/comic_studio/schemas.py`: patch schemas, project-with-episodes, and asset response contracts.
- `services/api/comic_studio/repositories.py`: update operations and ordered episode/asset queries.
- `services/api/comic_studio/routes/projects.py`: project and character updates plus episode-inclusive project loading.
- `services/api/comic_studio/routes/episodes.py`: episode listing/update and shot/dialogue updates.
- `services/api/comic_studio/routes/assets.py`: panel version listing and active-version selection.
- `services/api/comic_studio/routes/jobs.py`: supported failed-job retry dispatch.
- `apps/web/lib/types.ts`: complete API resource and mutation types.
- `apps/web/lib/api.ts`: typed endpoint functions and normalized API errors.
- `apps/web/lib/jobs.ts`: persisted polling with backoff and timeout.
- `apps/web/components/Workspace.tsx`: resource orchestration and selection state.
- `apps/web/components/ProjectNavigator.tsx`: real project/episode selection and creation forms.
- `apps/web/components/Storyboard.tsx`: loading, empty, planned, and generation states.
- `apps/web/components/Inspector.tsx`: editable shot/dialogue fields, panels, speech, and retry.
- `apps/web/components/AppToolbar.tsx`: provider health and render lifecycle.
- `apps/web/app/page.tsx`: mount the real workspace without demo episode props.

### Task 1: Version and Read Models

**Files:**
- Modify: `package.json`
- Modify: `apps/web/package.json`
- Modify: `packages/compositor/package.json`
- Modify: `services/api/pyproject.toml`
- Modify: `services/api/comic_studio/schemas.py`
- Modify: `services/api/comic_studio/repositories.py`
- Modify: `services/api/comic_studio/routes/projects.py`
- Test: `services/api/tests/test_projects_api.py`

- [x] **Step 1: Write failing project-with-episodes contract test**

Add a test that creates two episodes, requests `GET /api/projects/{id}`, and asserts `episodes` is ordered by creation and excludes scene payloads.

```python
response = client.get(f"/api/projects/{project_id}")
assert response.status_code == 200
assert [episode["title"] for episode in response.json()["episodes"]] == ["第一集", "第二集"]
assert "scenes" not in response.json()["episodes"][0]
```

- [x] **Step 2: Run the focused test and confirm the missing field**

Run: `cd services/api && uv run pytest tests/test_projects_api.py -q`
Expected: FAIL because `ProjectDetail` has no `episodes` field.

- [x] **Step 3: Add eager episode loading and response schema**

Add `episodes: list[EpisodeRead] = []` to `ProjectDetail`, and eager-load `Project.episodes` alongside characters in `ProjectRepository.get()`.

- [x] **Step 4: Set all source manifest versions to 0.2.0**

Set the root package, web package, compositor package, and Python project versions to `0.2.0`. Run `npm install --package-lock-only` so the lockfile versions match.

- [x] **Step 5: Run the focused and full API suites**

Run: `cd services/api && uv run pytest tests/test_projects_api.py -q && uv run pytest -q`
Expected: all tests pass.

- [x] **Step 6: Commit read models and version**

```bash
git add package.json package-lock.json apps/web/package.json packages/compositor/package.json services/api/pyproject.toml services/api/comic_studio services/api/tests/test_projects_api.py
git commit -m "feat: expose v0.2 project production data"
```

### Task 2: Editable Resource Contracts

**Files:**
- Modify: `services/api/comic_studio/schemas.py`
- Modify: `services/api/comic_studio/repositories.py`
- Modify: `services/api/comic_studio/routes/projects.py`
- Modify: `services/api/comic_studio/routes/episodes.py`
- Test: `services/api/tests/test_resource_updates.py`

- [x] **Step 1: Write failing patch-route tests**

Cover project, character, episode, shot, and dialogue updates. Verify omitted fields remain unchanged and unknown fields return HTTP 422.

```python
response = client.patch(f"/api/shots/{shot_id}", json={"duration_seconds": 7.5, "review_status": "approved"})
assert response.status_code == 200
assert response.json()["duration_seconds"] == 7.5
assert response.json()["review_status"] == "approved"
```

- [x] **Step 2: Run the new test and verify the routes return 404/405**

Run: `cd services/api && uv run pytest tests/test_resource_updates.py -q`
Expected: FAIL because PATCH routes do not exist.

- [x] **Step 3: Define strict patch schemas**

Create `ProjectPatch`, `CharacterPatch`, `EpisodePatch`, `ShotPatch`, and `DialoguePatch` with `ConfigDict(extra="forbid")`. Use the same field validation bounds as create schemas and restrict review status to `draft`, `needs_changes`, or `approved`.

- [x] **Step 4: Implement a shared repository patch helper**

Apply only `model_dump(exclude_unset=True)` values, commit once, refresh the model, and return `None` for missing IDs. Keep provider-owned asset IDs outside user patch schemas.

- [x] **Step 5: Add PATCH routes with typed responses**

Expose:

```text
PATCH /api/projects/{project_id}
PATCH /api/characters/{character_id}
PATCH /api/episodes/{episode_id}
PATCH /api/shots/{shot_id}
PATCH /api/dialogue/{dialogue_id}
```

Return HTTP 404 with a resource-specific message when absent.

- [x] **Step 6: Run update and regression tests**

Run: `cd services/api && uv run pytest tests/test_resource_updates.py tests/test_episode_graph.py tests/test_projects_api.py -q`
Expected: all tests pass.

- [x] **Step 7: Commit editable resource contracts**

```bash
git add services/api/comic_studio services/api/tests/test_resource_updates.py
git commit -m "feat: add production resource editing"
```

### Task 3: Panel Versions and Stable Media URLs

**Files:**
- Modify: `services/api/comic_studio/schemas.py`
- Modify: `services/api/comic_studio/repositories.py`
- Modify: `services/api/comic_studio/routes/assets.py`
- Modify: `services/api/comic_studio/routes/renders.py`
- Test: `services/api/tests/test_panel_versions.py`
- Test: `services/api/tests/test_render_manifest.py`

- [x] **Step 1: Write failing asset listing and activation tests**

Generate two panel assets for one shot, then assert listing is newest-first and activation changes only `Shot.active_panel_asset_id`.

```python
versions = client.get(f"/api/shots/{shot_id}/panels").json()
assert [item["generation_attempt"] for item in versions] == [2, 1]
selected = client.put(f"/api/shots/{shot_id}/panels/{versions[1]['id']}/active")
assert selected.json()["active_panel_asset_id"] == versions[1]["id"]
```

- [x] **Step 2: Run the panel tests and confirm missing GET/PUT routes**

Run: `cd services/api && uv run pytest tests/test_panel_versions.py -q`
Expected: FAIL with HTTP 405 or 404.

- [x] **Step 3: Add sanitized asset responses**

Define `AssetRead` with ID, kind, media URL, media type, provider, model, generation attempt, review status, dimensions, duration, and created timestamp. Do not return raw request metadata or filesystem paths.

- [x] **Step 4: Implement panel queries and activation validation**

Query panel assets by `request_metadata["shot_id"]` using a portable in-memory filter after project-scoped selection. Reject assets that are not panel assets for the requested shot.

- [x] **Step 5: Return stable media paths in job results**

Panel, speech, and render success metadata must include `/media/<relative-path>` as `media_url`; raw relative paths may remain server-internal but must not be required by the web client.

- [x] **Step 6: Run asset, speech, render, and redaction suites**

Run: `cd services/api && uv run pytest tests/test_panel_versions.py tests/test_dialogue_speech.py tests/test_render_manifest.py tests/test_redaction.py -q`
Expected: all tests pass and no response contains configured API keys.

- [x] **Step 7: Commit asset version APIs**

```bash
git add services/api/comic_studio services/api/tests
git commit -m "feat: expose panel versions and media URLs"
```

### Task 4: Retryable Persisted Jobs

**Files:**
- Modify: `services/api/comic_studio/jobs.py`
- Modify: `services/api/comic_studio/routes/jobs.py`
- Modify: `services/api/comic_studio/routes/episodes.py`
- Modify: `services/api/comic_studio/routes/assets.py`
- Modify: `services/api/comic_studio/routes/speech.py`
- Modify: `services/api/comic_studio/routes/renders.py`
- Test: `services/api/tests/test_job_transitions.py`
- Test: `services/api/tests/test_job_retry_api.py`

- [x] **Step 1: Write failing retry API tests**

Verify only failed jobs can retry, retry increments `retry_count`, clears error/result metadata, and dispatches the original supported operation.

```python
response = client.post(f"/api/jobs/{failed_job_id}/retry")
assert response.status_code == 202
assert response.json()["status"] == "queued"
assert response.json()["retry_count"] == 1
```

- [x] **Step 2: Run tests and confirm retry endpoint is absent**

Run: `cd services/api && uv run pytest tests/test_job_retry_api.py -q`
Expected: FAIL with HTTP 405.

- [x] **Step 3: Extract operation dispatch functions**

Expose one dispatcher per operation that accepts `app`, `job_id`, and `target_id`. Reuse the existing planning, panel, speech, and render runners without duplicating provider construction.

- [x] **Step 4: Implement retry transition and route**

Accept only `plan_episode`, `generate_panel`, `synthesize_dialogue`, and `render_episode`. Return HTTP 409 for non-failed jobs and HTTP 422 for unsupported operations. Queue the dispatcher through `BackgroundTasks`.

- [x] **Step 5: Run job and full API tests**

Run: `cd services/api && uv run pytest tests/test_job_transitions.py tests/test_job_retry_api.py -q && uv run pytest -q`
Expected: all tests pass.

- [x] **Step 6: Commit retryable jobs**

```bash
git add services/api/comic_studio services/api/tests
git commit -m "feat: retry failed production jobs"
```

### Task 5: Typed Web API and Job Polling

**Files:**
- Modify: `apps/web/lib/types.ts`
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/lib/jobs.ts`
- Create: `apps/web/tests/api.test.ts`
- Create: `apps/web/tests/jobs.test.ts`

- [x] **Step 1: Write failing API error and polling tests**

Mock fetch to verify structured errors, queued/running/succeeded polling, one-to-three-second backoff, and ten-minute timeout.

```typescript
await expect(apiRequest('/api/projects')).rejects.toMatchObject({status: 422, detail: 'invalid'});
await expect(pollJob('job-1', {sleep: async () => {}})).resolves.toMatchObject({status: 'succeeded'});
```

- [x] **Step 2: Run the focused Vitest suite and confirm missing contracts**

Run: `npm test --workspace @comic-studio/web -- --run tests/api.test.ts tests/jobs.test.ts`
Expected: FAIL because `ApiError` and `pollJob` do not exist.

- [x] **Step 3: Complete TypeScript resource types**

Define `Project`, `ProjectDetail`, `Character`, `EpisodeSummary`, `EpisodeDetail`, `Scene`, `Shot`, `DialogueLine`, `Asset`, `Job`, `ProviderHealth`, and patch input types with required fields matching Pydantic responses.

- [x] **Step 4: Implement endpoint functions**

Add typed functions for every list, create, patch, generation, activation, health, retry, and render endpoint. Encode query parameters with `URLSearchParams` and construct media URLs through one helper.

- [x] **Step 5: Implement persisted job polling**

`pollJob` repeatedly calls `getJob`, returns terminal jobs, uses one-second delay for attempts 1-10 and three seconds afterward, accepts an `AbortSignal`, and throws `JobPollingTimeoutError` after ten minutes.

- [x] **Step 6: Run web tests and typecheck**

Run: `npm test --workspace @comic-studio/web && npm run build --workspace @comic-studio/web`
Expected: tests and Next.js TypeScript build pass.

- [x] **Step 7: Commit the web data boundary**

```bash
git add apps/web/lib apps/web/tests
git commit -m "feat: add typed production API client"
```

### Task 6: Real Project and Episode Workspace

**Files:**
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/components/Workspace.tsx`
- Modify: `apps/web/components/ProjectNavigator.tsx`
- Modify: `apps/web/components/Storyboard.tsx`
- Create: `apps/web/components/CreateProjectDialog.tsx`
- Create: `apps/web/components/CreateEpisodeDialog.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/tests/workspace.test.tsx`

- [x] **Step 1: Replace demo assertions with failing persisted-workspace tests**

Test loading projects, no-project state, project selection, episode creation, empty episode planning, and successful episode graph refresh using mocked API functions.

```typescript
render(<Workspace />);
expect(await screen.findByText('新建第一个项目')).toBeInTheDocument();
await user.click(screen.getByRole('button', {name: '生成剧本与分镜'}));
expect(await screen.findByText('场景 1')).toBeInTheDocument();
```

- [x] **Step 2: Run workspace tests and confirm prop/API mismatch**

Run: `npm test --workspace @comic-studio/web -- --run tests/workspace.test.tsx`
Expected: FAIL because `Workspace` still requires `initialEpisode` and renders demo navigation.

- [x] **Step 3: Mount an API-backed workspace**

Remove `demoEpisode` from `page.tsx`. On mount, load projects, restore a valid selected project/episode ID, and represent loading, empty, connectivity failure, and selected states explicitly.

- [x] **Step 4: Implement creation dialogs**

Project fields: title, logline, story bible, visual style, aspect ratio. Episode fields: title, premise, target duration. Disable submit while saving and preserve entered values on errors.

- [x] **Step 5: Connect planning job lifecycle**

Create an episode, launch planning, show queued/running progress, reload the episode after success, and expose retry after failure. Prevent duplicate planning commands for the same episode.

- [x] **Step 6: Preserve responsive production layout**

Keep the three-column desktop grid and mobile storyboard/inspector tabs. Empty and loading states occupy the storyboard content region without card nesting.

- [x] **Step 7: Run component, build, and desktop/mobile E2E smoke tests**

Run: `npm test --workspace @comic-studio/web && npm run build --workspace @comic-studio/web && npm run test:e2e --workspace @comic-studio/web`
Expected: all deterministic tests pass.

- [x] **Step 8: Commit real workspace navigation**

```bash
git add apps/web
git commit -m "feat: connect projects and episodes to workspace"
```

### Task 7: Shot, Panel, Dialogue, and Speech Production

**Files:**
- Modify: `apps/web/components/ShotCard.tsx`
- Modify: `apps/web/components/Inspector.tsx`
- Create: `apps/web/components/JobStatus.tsx`
- Create: `apps/web/components/PanelVersions.tsx`
- Create: `apps/web/components/DialogueEditor.tsx`
- Modify: `apps/web/components/Workspace.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/tests/workspace.test.tsx`
- Create: `apps/web/tests/inspector.test.tsx`

- [x] **Step 1: Write failing inspector production tests**

Verify explicit save, unsaved edit preservation after failure, panel generation and version activation, speech generation and audio player display, review status update, duplicate-job prevention, and failed-job retry.

- [x] **Step 2: Run inspector tests and confirm controls are read-only**

Run: `npm test --workspace @comic-studio/web -- --run tests/inspector.test.tsx`
Expected: FAIL because inspector fields and production actions are not connected.

- [x] **Step 3: Add reusable job status presentation**

Render queued/running progress, succeeded state, sanitized failure text, and retry command. Use icons and progress semantics; do not display provider payloads.

- [x] **Step 4: Implement shot editing and refresh**

Edit duration, composition, camera motion, prompts, and review status in local form state. Save through `updateShot`; after success replace the shot in the current episode graph without resetting selection.

- [x] **Step 5: Implement panel generation and version selection**

Load versions for the selected shot, launch generation with `activate=true`, poll the job, refresh versions and episode graph, and activate older versions through the PUT endpoint.

- [x] **Step 6: Implement dialogue editing and speech**

Render each dialogue line with text, subtitle, emotion, and performance instruction fields. Save through `updateDialogue`; synthesize through the job API and display an `<audio controls>` element from the returned media URL.

- [x] **Step 7: Run component, API-mock, and responsive E2E tests**

Run: `npm test --workspace @comic-studio/web && npm run test:e2e --workspace @comic-studio/web`
Expected: all tests pass with no browser console errors.

- [x] **Step 8: Commit shot production tools**

```bash
git add apps/web
git commit -m "feat: add shot panel and speech production"
```

### Task 8: Render Lifecycle, Release Verification, and Documentation

**Files:**
- Modify: `apps/web/components/AppToolbar.tsx`
- Modify: `apps/web/components/Workspace.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/e2e/production-flow.spec.ts`
- Modify: `README.md`
- Modify: `.env.example`
- Test: `services/api/tests/test_provider_health.py`

- [ ] **Step 1: Write failing render lifecycle E2E assertions**

Use deterministic API fixtures to plan an episode, generate a panel and speech, render it, observe progress, and assert the MP4 download link appears only after a successful job.

- [ ] **Step 2: Run E2E and verify render controls are static**

Run: `npm run test:e2e --workspace @comic-studio/web`
Expected: FAIL because toolbar render and provider health controls are not connected.

- [ ] **Step 3: Connect provider health and rendering**

Load sanitized provider health on demand, show per-provider status, launch one render per episode, poll the job, display FFmpeg metadata, and expose a download link with `download` attribute.

- [ ] **Step 4: Update local operation documentation**

Document the v0.2 workflow, dynamic development URLs, HostBridge `ai-comic-tts` prerequisite, model health checks, deterministic tests, opt-in live checks, render output, and the A800_94 `/boot` package-state warning.

- [ ] **Step 5: Run full verification**

```bash
cd services/api && uv run pytest -q
cd ../.. && npm test --workspaces --if-present
npm run build --workspaces --if-present
npm run test:e2e --workspace @comic-studio/web
npm run render:fixture --workspace @comic-studio/compositor
ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_name,width,height,sample_rate,channels -of json packages/compositor/out/fixture.mp4
git diff --check
```

Expected: API, web, compositor, build, E2E, render, codec, and whitespace checks all pass.

- [ ] **Step 6: Run opt-in live provider smoke tests**

Verify MiniMax planning, GPT Image generation, Qwen TTS synthesis through `ai-comic-tts`, and a local render using generated assets. Record only model names, timings, dimensions, durations, and checksums; never record keys.

- [ ] **Step 7: Commit v0.2 release workflow**

```bash
git add apps/web README.md .env.example
git commit -m "feat: complete v0.2 production workflow"
```

- [ ] **Step 8: Audit release requirements**

Confirm every release gate in `docs/superpowers/specs/2026-07-11-ai-comic-studio-v0.2-production-loop-design.md` has direct test, runtime, or artifact evidence. Mark this plan complete only after the audit finds no missing evidence.
