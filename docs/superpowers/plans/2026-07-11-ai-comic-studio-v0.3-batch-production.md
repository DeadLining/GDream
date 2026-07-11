# AI Comic Studio v0.3 Batch Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persisted, bounded-concurrency episode production runs with pause, continue, partial failure, retry, readiness reporting, and a usable web production panel.

**Architecture:** Persist `ProductionRun` and `ProductionItem` separately from single-operation jobs. An in-process coordinator claims deterministic queued items and invokes existing panel and speech services, while the browser polls run snapshots and controls scheduling through explicit APIs.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy, SQLite, asyncio, Pydantic, Next.js 16, React 19, TypeScript, Vitest, Testing Library, Playwright, Remotion, FFmpeg.

---

### Task 1: Versioned Production Run Domain

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `apps/web/package.json`
- Modify: `packages/compositor/package.json`
- Modify: `services/api/pyproject.toml`
- Modify: `services/api/comic_studio/models.py`
- Modify: `services/api/comic_studio/schemas.py`
- Create: `services/api/comic_studio/production.py`
- Create: `services/api/tests/test_production_state.py`

- [x] **Step 1: Write failing run and item state tests**

```python
run = store.create_run(episode.id, stages=["panels", "speech"], concurrency=2)
assert run.status == "queued"
item = store.add_item(run.id, "panel", "shot", shot.id, position=1)
store.transition_item(item.id, "running")
store.transition_item(item.id, "failed", error="Bearer sk-secret")
assert store.get_item(item.id).error == "Bearer [REDACTED]"
```

Verify run transitions reject `completed -> running` and item uniqueness rejects duplicate `(run_id, stage, target_id)`.

- [x] **Step 2: Run the state test and confirm missing models/store**

Run: `cd services/api && uv run pytest tests/test_production_state.py -q`
Expected: FAIL because production domain types do not exist.

- [x] **Step 3: Add ProductionRun and ProductionItem models**

Use string UUIDs, JSON stage configuration, counters, pause flag, deterministic `position`, unique constraint on run/stage/target, and cascade delete from run to items.

- [x] **Step 4: Implement ProductionStore transitions and counter refresh**

Provide create/get/list/add/transition/pause/continue/retry methods. Redact errors with the existing recursive redactor before persistence. Derive counters from item statuses in one query per refresh.

- [x] **Step 5: Add strict Pydantic contracts**

Define `ProductionRunCreate`, `ProductionRunRead`, `ProductionItemRead`, `ProductionRetry`, and literal status/stage types. Reject extra fields and concurrency outside 1-4.

- [x] **Step 6: Set manifests and lockfile to 0.3.0**

Update all source manifests and run `npm install --package-lock-only`.

- [x] **Step 7: Run focused and full API tests, then commit**

```bash
cd services/api && uv run pytest tests/test_production_state.py -q && uv run pytest -q
cd ../.. && git add . && git commit -m "feat: add v0.3 production run domain"
```

### Task 2: Readiness and Eligibility Snapshot

**Files:**
- Create: `services/api/comic_studio/services/readiness.py`
- Create: `services/api/comic_studio/routes/production.py`
- Modify: `services/api/comic_studio/main.py`
- Create: `services/api/tests/test_production_readiness.py`

- [x] **Step 1: Write failing readiness tests**

Cover missing panel, unapproved shot, missing speech, completed speech, and fully ready episodes.

```python
report = client.get(f"/api/episodes/{episode.id}/production-readiness").json()
assert report["ready"] is False
assert report["blockers"]["missing_panels"] == [shot.id]
assert report["blockers"]["missing_speech"] == [line.id]
```

- [x] **Step 2: Run and verify HTTP 404**

Run: `cd services/api && uv run pytest tests/test_production_readiness.py -q`
Expected: FAIL because the readiness route is absent.

- [x] **Step 3: Implement ReadinessService**

Load the ordered episode graph and return total/ready counts plus blocker ID lists. Treat speech as ready only when `audio_asset_id` exists and duration is positive.

- [x] **Step 4: Add the readiness API and missing episode handling**

Return HTTP 404 for missing episodes and a typed response for valid episodes.

- [x] **Step 5: Run focused and regression tests, then commit**

```bash
cd services/api && uv run pytest tests/test_production_readiness.py tests/test_render_manifest.py -q
cd ../.. && git add services/api && git commit -m "feat: report episode production readiness"
```

### Task 3: Deterministic Run Creation and Eligibility

**Files:**
- Create: `services/api/comic_studio/services/production_runs.py`
- Modify: `services/api/comic_studio/routes/production.py`
- Create: `services/api/tests/test_production_run_creation.py`

- [x] **Step 1: Write failing run creation tests**

Seed mixed ready and missing assets. Assert deterministic item order, approved panel skip, completed speech skip, regeneration inclusion, and HTTP 409 for a second active run.

- [x] **Step 2: Run tests and confirm creation endpoint is absent**

Run: `cd services/api && uv run pytest tests/test_production_run_creation.py -q`
Expected: FAIL with HTTP 404/405.

- [x] **Step 3: Implement eligibility snapshot creation**

Create one item per requested target. Persist `skipped` items with reason `already_ready`; queue eligible items. Order panels by scene/shot and speech by scene/shot/dialogue.

- [x] **Step 4: Add run create/get/items routes**

Expose POST episode run, GET run, and GET items endpoints. Return HTTP 409 when an active run already exists for the episode.

- [x] **Step 5: Run creation and full API tests, then commit**

```bash
cd services/api && uv run pytest tests/test_production_run_creation.py -q && uv run pytest -q
cd ../.. && git add services/api && git commit -m "feat: create deterministic production runs"
```

### Task 4: Coordinator, Pause, Continue, and Retry

**Files:**
- Create: `services/api/comic_studio/services/production_coordinator.py`
- Modify: `services/api/comic_studio/routes/production.py`
- Modify: `services/api/comic_studio/main.py`
- Create: `services/api/tests/test_production_coordinator.py`
- Create: `services/api/tests/test_production_controls.py`

- [x] **Step 1: Write failing coordinator tests**

Use injected async workers that record active count. Assert maximum concurrency, deterministic claims, later items continue after one failure, and terminal status is `completed_with_failures`.

- [x] **Step 2: Write failing pause/continue/retry tests**

Assert pause blocks new claims, running work finishes, continue is idempotent, retry resets only selected failed items, and startup recovery changes running runs/items to paused/queued.

- [x] **Step 3: Run focused tests and confirm coordinator is missing**

Run: `cd services/api && uv run pytest tests/test_production_coordinator.py tests/test_production_controls.py -q`
Expected: FAIL on missing coordinator and routes.

- [x] **Step 4: Implement the bounded coordinator**

Use `asyncio.Semaphore(run.concurrency)` and a fresh SQLAlchemy session per item. Re-check readiness at claim time. Panel workers call `PanelService`; speech workers call `SpeechService`. Persist each terminal state independently.

- [x] **Step 5: Implement control routes and startup recovery**

Add pause, continue, and retry endpoints with HTTP 409 transition errors. During lifespan startup, recover interrupted running state to paused and queued.

- [x] **Step 6: Run coordinator, control, and full API tests, then commit**

```bash
cd services/api && uv run pytest tests/test_production_coordinator.py tests/test_production_controls.py -q && uv run pytest -q
cd ../.. && git add services/api && git commit -m "feat: coordinate recoverable batch production"
```

### Task 5: Typed Web Production API and Polling

**Files:**
- Modify: `apps/web/lib/types.ts`
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/lib/production.ts`
- Create: `apps/web/tests/production-api.test.ts`

- [x] **Step 1: Write failing web API and polling tests**

Verify request bodies, structured run/item types, terminal polling, paused polling stop, and AbortSignal cancellation.

- [x] **Step 2: Run focused tests and confirm exports are missing**

Run: `npm test --workspace @comic-studio/web -- --run tests/production-api.test.ts`
Expected: FAIL because production API and poller do not exist.

- [x] **Step 3: Add production types and API functions**

Implement readiness, create/get/list, pause, continue, retry, and run polling through `apiRequest`.

- [x] **Step 4: Implement `pollProductionRun`**

Poll at one second while queued/running, stop for paused or terminal states, accept abort, and return the last persisted snapshot.

- [x] **Step 5: Run web tests and build, then commit**

```bash
npm test --workspace @comic-studio/web && npm run build --workspace @comic-studio/web
git add apps/web && git commit -m "feat: add batch production web client"
```

### Task 6: Production Panel and Workspace Integration

**Files:**
- Create: `apps/web/components/ProductionPanel.tsx`
- Create: `apps/web/components/ProductionItemRow.tsx`
- Modify: `apps/web/components/AppToolbar.tsx`
- Modify: `apps/web/components/Workspace.tsx`
- Modify: `apps/web/components/ShotCard.tsx`
- Modify: `apps/web/app/globals.css`
- Create: `apps/web/tests/production-panel.test.tsx`
- Modify: `apps/web/tests/workspace.test.tsx`

- [ ] **Step 1: Write failing production panel tests**

Cover readiness blockers, default options, concurrency stepper, start, counters, pause, continue, filters, selected retry, and item-to-shot selection.

- [ ] **Step 2: Run tests and confirm panel is absent**

Run: `npm test --workspace @comic-studio/web -- --run tests/production-panel.test.tsx`
Expected: FAIL because components do not exist.

- [ ] **Step 3: Implement production panel controls and rows**

Use checkboxes for stages, toggles for regeneration, numeric stepper 1-4, progress semantics, filter tabs, and compact item rows. Keep stable dimensions across state changes.

- [ ] **Step 4: Integrate a third workspace view**

Toolbar opens production. Desktop uses the center region; mobile adds a `生产` segmented tab. Selecting an item selects its target shot. Persist current run ID per episode in local storage and reload it after refresh.

- [ ] **Step 5: Gate render by readiness**

Disable render with a tooltip while blockers remain. Refresh readiness after run terminal states and manual asset edits.

- [ ] **Step 6: Run component tests, build, and E2E smoke, then commit**

```bash
npm test --workspace @comic-studio/web
npm run build --workspace @comic-studio/web
npm run test:e2e --workspace @comic-studio/web
git add apps/web && git commit -m "feat: add episode production panel"
```

### Task 7: Release Verification and Documentation

**Files:**
- Modify: `apps/web/e2e/production-flow.spec.ts`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-11-ai-comic-studio-v0.3-batch-production.md`

- [ ] **Step 1: Add deterministic mixed-run E2E**

Fixture a run with skipped, succeeded, and failed items; retry selected failures; assert readiness becomes true and render enables on desktop and mobile.

- [ ] **Step 2: Update README operations**

Document batch eligibility, concurrency, pause semantics, restart recovery, retry, readiness, and unchanged A800_94 warning.

- [ ] **Step 3: Run full deterministic verification**

```bash
cd services/api && uv run pytest -q
cd ../.. && npm test --workspaces --if-present
npm run build --workspaces --if-present
npm run test:e2e --workspace @comic-studio/web
npm run render:fixture --workspace @comic-studio/compositor
ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_name,width,height,sample_rate,channels -of json packages/compositor/out/fixture.mp4
git diff --check
```

- [ ] **Step 4: Run opt-in live smoke**

Use one short episode to create a panel+speech run with concurrency 1, verify persisted item states, and confirm render readiness. Record model names and artifact metadata only.

- [ ] **Step 5: Audit release gates and commit**

Confirm every design gate has direct evidence, mark every plan checkbox complete, then:

```bash
git add .
git commit -m "feat: complete v0.3 batch production"
```
