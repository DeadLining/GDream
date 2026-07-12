# Lightweight 3D Director Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent lightweight 3D director workspace where scene objects are shared across shots, each shot owns an independent camera, AI suggestions remain reviewable drafts, and selected composition changes can be applied safely to existing shots.

**Architecture:** FastAPI and SQLAlchemy own canonical stage, object, camera, revision, suggestion, and preview records with optimistic versions. React Three Fiber derives a runtime scene from API DTOs, provides deterministic placeholder rendering and camera controls, and uploads bounded PNG previews. Existing scene and shot records remain authoritative until an explicit field-level apply operation commits director output.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2, Alembic, SQLite, Pydantic, pytest, Next.js 16, React 19, TypeScript, Three.js, React Three Fiber, Drei, Vitest, Playwright.

---

## File Map

- Create `services/api/alembic/versions/20260712_02_director_stage.py`: director schema and downgrade.
- Modify `services/api/comic_studio/models.py`: stage, objects, cameras, revisions, suggestions, and relationships.
- Create `services/api/comic_studio/director.py`: strict API DTOs and transform/camera validation.
- Create `services/api/comic_studio/services/director_stages.py`: stage/object/camera/revision operations and conflicts.
- Create `services/api/comic_studio/services/director_previews.py`: contained PNG persistence and asset registration.
- Create `services/api/comic_studio/services/director_suggestions.py`: trusted context, LLM validation, apply, and shot patching.
- Create `services/api/comic_studio/routes/director.py`: director REST endpoints.
- Modify `services/api/comic_studio/main.py`: register director routes.
- Create `services/api/tests/test_director_models.py`: constraints, migration, cascade, and revision behavior.
- Create `services/api/tests/test_director_api.py`: CRUD, camera, conflict, restore, and shot application routes.
- Create `services/api/tests/test_director_previews.py`: PNG validation, containment, cleanup, and asset linkage.
- Create `services/api/tests/test_director_suggestions.py`: model context, strict patches, failures, and apply transaction.
- Modify `apps/web/package.json` and `package-lock.json`: add `three`, `@react-three/fiber`, `@react-three/drei`, and Three.js types.
- Modify `apps/web/lib/types.ts`: director DTOs and vector/transform types.
- Modify `apps/web/lib/api.ts`: director API clients and preview upload.
- Create `apps/web/lib/director-state.ts`: immutable editor state, dirty tracking, and bounded undo/redo.
- Create `apps/web/components/director/DirectorWorkspace.tsx`: workspace orchestration and navigation blocking.
- Create `apps/web/components/director/DirectorCanvas.tsx`: full-size Three.js scene and camera/world modes.
- Create `apps/web/components/director/DirectorObject.tsx`: placeholders, planes, resource fallback, and selection.
- Create `apps/web/components/director/DirectorObjectTree.tsx`: scene object hierarchy and object commands.
- Create `apps/web/components/director/DirectorInspector.tsx`: transform, character state, and camera controls.
- Create `apps/web/components/director/DirectorShotStrip.tsx`: scene shot switching and camera summary.
- Create `apps/web/components/director/DirectorSuggestionDialog.tsx`: AI diff and selective application.
- Create `apps/web/components/director/DirectorFallback.tsx`: WebGL and resource failure states.
- Modify `apps/web/components/WorkspaceTabs.tsx`, `Workspace.tsx`, `Storyboard.tsx`, and `ShotCard.tsx`: director entry and work area.
- Modify `apps/web/app/globals.css`: director layout, controls, overlays, and mobile preview mode.
- Create `apps/web/tests/director-state.test.ts`: reducer, dirty state, undo/redo, and conflict tests.
- Create `apps/web/tests/director-workspace.test.tsx`: orchestration, autosave, suggestions, and failure states.
- Create `apps/web/tests/director-canvas.test.tsx`: scene derivation, placeholders, modes, and screenshot contract.
- Modify `apps/web/e2e/production-flow.spec.ts`: desktop/mobile director workflow and canvas pixel checks.
- Modify version files and create `docs/release-audits/2026-07-12-v0.6.0.md` after complete verification.

### Task 1: Add Director Schema and Constraints

**Files:**
- Modify: `services/api/comic_studio/models.py`
- Create: `services/api/alembic/versions/20260712_02_director_stage.py`
- Create: `services/api/tests/test_director_models.py`
- Modify: `services/api/tests/test_migrations.py`

- [ ] **Step 1: Write failing schema tests**

```python
stage = models.DirectorStage(scene_id=scene.id, version=1, environment={})
camera = models.ShotCamera(
    stage=stage, shot_id=shot.id, version=1,
    position=[0, 1.6, 5], target=[0, 1.2, 0], rotation=[0, 0, 0],
    focal_length_mm=50, near=0.1, far=1000,
    shot_size="medium", camera_motion="static",
)
session.add(camera)
session.commit()
assert stage.shot_cameras == [camera]
```

Assert unique `scene_id`, unique `(stage_id, shot_id)`, cascade from scene/shot, JSON defaults, and migration table/column presence.

- [ ] **Step 2: Verify RED**

Run: `cd services/api && uv run pytest -q tests/test_director_models.py tests/test_migrations.py -k director`

Expected: model and table failures because director schema is absent.

- [ ] **Step 3: Implement ORM models**

Add `DirectorStage`, `DirectorObject`, `ShotCamera`, `DirectorRevision`, and `DirectorSuggestion` with named unique constraints and relationships. Store vectors as three-number JSON arrays; validate shape in Pydantic/service boundaries rather than custom SQL types.

- [ ] **Step 4: Implement additive migration**

Create tables in stage/object/camera/revision/suggestion order with indexes on scene, stage, shot, status, and created time. Downgrade reverses dependency order.

- [ ] **Step 5: Verify GREEN and commit**

Run: `cd services/api && uv run pytest -q tests/test_director_models.py tests/test_migrations.py`

```bash
git add services/api/comic_studio/models.py services/api/alembic/versions/20260712_02_director_stage.py services/api/tests/test_director_models.py services/api/tests/test_migrations.py
git commit -m "feat: add director stage schema"
```

### Task 2: Implement Stage, Object, Camera, and Revision Services

**Files:**
- Create: `services/api/comic_studio/director.py`
- Create: `services/api/comic_studio/services/director_stages.py`
- Modify: `services/api/tests/test_director_models.py`
- Create: `services/api/tests/test_director_api.py`

- [ ] **Step 1: Write failing service tests**

Cover idempotent stage creation, default cameras for all scene shots, object CRUD, version increments, stale version conflicts, one camera per shot, manual revisions, restore, and pruning to 50 revisions.

```python
updated = service.update_camera(
    stage.id, shot.id, expected_version=1,
    patch=ShotCameraPatch(focal_length_mm=85),
)
assert updated.version == 2
with pytest.raises(DirectorVersionConflict):
    service.update_camera(stage.id, shot.id, expected_version=1, patch=patch)
```

- [ ] **Step 2: Verify RED**

Run: `cd services/api && uv run pytest -q tests/test_director_api.py -k service`

- [ ] **Step 3: Define strict DTOs**

Define `Vector3`, `Transform`, `DirectorEnvironment`, create/patch/read models, allowed kinds/source types, camera ranges (`focal_length_mm` 12-300, positive near/far with far greater than near), and explicit extra-field rejection.

- [ ] **Step 4: Implement transactional services**

Expose:

```python
get_or_create_stage(scene_id)
update_stage(stage_id, expected_version, patch)
create_object(stage_id, expected_version, data)
update_object(object_id, expected_version, patch)
delete_object(object_id, expected_version)
update_camera(stage_id, shot_id, expected_version, patch)
list_revisions(stage_id)
restore_revision(stage_id, revision_id, expected_version)
```

Create a snapshot before each canonical mutation, increment version once, commit once, then prune surplus revisions.

- [ ] **Step 5: Verify and commit**

Run: `cd services/api && uv run pytest -q tests/test_director_models.py tests/test_director_api.py -k service`

```bash
git add services/api/comic_studio/director.py services/api/comic_studio/services/director_stages.py services/api/tests/test_director_models.py services/api/tests/test_director_api.py
git commit -m "feat: manage director stages and cameras"
```

### Task 3: Expose Director CRUD and Conflict APIs

**Files:**
- Create: `services/api/comic_studio/routes/director.py`
- Modify: `services/api/comic_studio/main.py`
- Modify: `services/api/tests/test_director_api.py`

- [ ] **Step 1: Write failing route tests**

```python
created = client.post(f"/api/scenes/{scene_id}/director-stage")
assert created.status_code == 201
saved = client.put(
    f"/api/director-stages/{created.json()['id']}/shots/{shot_id}/camera",
    json={"expected_version": 1, "focal_length_mm": 85},
)
assert saved.json()["focal_length_mm"] == 85
```

Assert 404 ownership failures, 409 conflict payload with latest state, validation errors, object deletion, shot list, revisions, and restore.

- [ ] **Step 2: Verify RED**

Run: `cd services/api && uv run pytest -q tests/test_director_api.py -k route`

- [ ] **Step 3: Implement router and error mapping**

Register all stage/object/camera/revision endpoints from the spec. Return `director_version_conflict` as structured detail and never expose internal filesystem paths.

- [ ] **Step 4: Verify and commit**

Run: `cd services/api && uv run pytest -q tests/test_director_api.py tests/test_episode_graph.py`

```bash
git add services/api/comic_studio/routes/director.py services/api/comic_studio/main.py services/api/tests/test_director_api.py
git commit -m "feat: expose director stage api"
```

### Task 4: Persist Camera Preview Assets Safely

**Files:**
- Create: `services/api/comic_studio/services/director_previews.py`
- Modify: `services/api/comic_studio/routes/director.py`
- Create: `services/api/tests/test_director_previews.py`

- [ ] **Step 1: Write failing preview tests**

Test valid PNG upload, MIME/signature mismatch, size limit, path containment, asset metadata, old-preview replacement, commit failure cleanup, and scene/shot deletion cleanup.

```python
preview = service.save(camera.id, png_bytes)
assert preview.kind == f"director_preview:{camera.id}"
assert (data_root / preview.local_path).read_bytes().startswith(b"\x89PNG")
```

- [ ] **Step 2: Verify RED**

Run: `cd services/api && uv run pytest -q tests/test_director_previews.py`

- [ ] **Step 3: Implement contained persistence and endpoint**

Store under `projects/{project_id}/director/{stage_id}/{camera_id}.png` using atomic replacement and the existing resolved-path containment rule. Register an `Asset` only after image verification succeeds.

- [ ] **Step 4: Verify and commit**

Run: `cd services/api && uv run pytest -q tests/test_director_previews.py tests/test_episode_deletion.py`

```bash
git add services/api/comic_studio/services/director_previews.py services/api/comic_studio/routes/director.py services/api/tests/test_director_previews.py
git commit -m "feat: persist director camera previews"
```

### Task 5: Add AI Stage and Composition Suggestions

**Files:**
- Create: `services/api/comic_studio/services/director_suggestions.py`
- Modify: `services/api/comic_studio/routes/director.py`
- Modify: `services/api/comic_studio/providers/base.py`
- Modify: `services/api/comic_studio/providers/minimax.py`
- Create: `services/api/tests/test_director_suggestions.py`
- Modify: `services/api/tests/providers/test_minimax.py`

- [ ] **Step 1: Write failing suggestion tests**

Assert trusted context includes project/scene/characters/shot/current stage, strict identifiers, finite vectors, provider redaction, canonical state unchanged before apply, and selected-field shot application.

```python
suggestion = await service.create(stage.id, shot.id, "shot_composition")
assert suggestion.status == "ready"
assert shot.composition == original_composition
applied = service.apply_to_shot(suggestion.id, fields={"composition", "camera_motion"})
assert applied.image_prompt == original_prompt
```

- [ ] **Step 2: Verify RED**

Run: `cd services/api && uv run pytest -q tests/test_director_suggestions.py tests/providers/test_minimax.py -k director`

- [ ] **Step 3: Implement provider contract and service**

Add `suggest_director(context) -> DirectorSuggestionPatch` to the provider protocol. MiniMax receives JSON schema plus trusted context and retries one invalid response. The service stores request context without secrets and applies stage/camera patches only through existing versioned services.

- [ ] **Step 4: Implement field-level shot application**

Allow only `composition`, `camera_motion`, `image_prompt`, and `negative_prompt`. Create a `shot_apply` revision and update selected fields in one transaction; do not touch asset IDs or generation status.

- [ ] **Step 5: Verify and commit**

Run: `cd services/api && uv run pytest -q tests/test_director_suggestions.py tests/providers/test_minimax.py tests/test_redaction.py`

```bash
git add services/api/comic_studio/services/director_suggestions.py services/api/comic_studio/routes/director.py services/api/comic_studio/providers/base.py services/api/comic_studio/providers/minimax.py services/api/tests/test_director_suggestions.py services/api/tests/providers/test_minimax.py
git commit -m "feat: add ai director suggestions"
```

### Task 6: Add Web Director Types, API, and Editor State

**Files:**
- Modify: `apps/web/package.json`
- Modify: `package-lock.json`
- Modify: `apps/web/lib/types.ts`
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/lib/director-state.ts`
- Create: `apps/web/tests/director-state.test.ts`
- Modify: `apps/web/tests/api.test.ts`

- [ ] **Step 1: Install Three.js dependencies**

Run: `npm install --workspace apps/web three @react-three/fiber @react-three/drei && npm install --workspace apps/web -D @types/three`

- [ ] **Step 2: Write failing state and client tests**

Test exact endpoints, optimistic payloads, multipart preview, selection, dirty flags, immutable transform updates, 50-entry undo history, redo invalidation, and conflict state.

```typescript
const next=directorReducer(initial,{type:'object.transform',id:'o1',transform});
expect(next.objects.o1.transform).toEqual(transform);
expect(next.dirty.stage).toBe(true);
expect(initial.objects.o1.transform).not.toBe(transform);
```

- [ ] **Step 3: Verify RED**

Run: `npm --workspace apps/web test -- --run tests/director-state.test.ts tests/api.test.ts`

- [ ] **Step 4: Implement DTOs, clients, and reducer**

Match backend snake_case at API boundaries. Keep runtime `THREE.Object3D` references in component refs, not reducer state. Export pure selectors for current object, camera, and pending apply diff.

- [ ] **Step 5: Verify and commit**

Run: `npm --workspace apps/web test -- --run tests/director-state.test.ts tests/api.test.ts && npm --workspace apps/web run build`

```bash
git add apps/web/package.json package-lock.json apps/web/lib/types.ts apps/web/lib/api.ts apps/web/lib/director-state.ts apps/web/tests/director-state.test.ts apps/web/tests/api.test.ts
git commit -m "feat: add director web state and api"
```

### Task 7: Build and Verify the Three.js Stage

**Files:**
- Create: `apps/web/components/director/DirectorCanvas.tsx`
- Create: `apps/web/components/director/DirectorObject.tsx`
- Create: `apps/web/components/director/DirectorFallback.tsx`
- Create: `apps/web/tests/director-canvas.test.tsx`

- [ ] **Step 1: Write failing canvas tests**

Mock React Three Fiber only for component tests. Assert deterministic primitives, character planes when references exist, placeholder fallback on texture/model error, world/camera mode, transform callbacks, framing guides, and preview callback dimensions.

- [ ] **Step 2: Verify RED**

Run: `npm --workspace apps/web test -- --run tests/director-canvas.test.tsx`

- [ ] **Step 3: Implement full-bleed scene**

Use a single `<Canvas>` filling its parent, `OrbitControls` in world mode, `TransformControls` for the selected object, a perspective camera derived from millimeters, grid/ground, ambient/directional lights, and deterministic box/capsule/plane fallbacks. Dispose generated textures and geometries on unmount.

- [ ] **Step 4: Implement capture and pixel contract**

Render at bounded maximum 1600x900, convert canvas to PNG Blob, and reject all-transparent/all-background captures before upload.

- [ ] **Step 5: Verify and commit**

Run: `npm --workspace apps/web test -- --run tests/director-canvas.test.tsx && npm --workspace apps/web run build`

```bash
git add apps/web/components/director/DirectorCanvas.tsx apps/web/components/director/DirectorObject.tsx apps/web/components/director/DirectorFallback.tsx apps/web/tests/director-canvas.test.tsx
git commit -m "feat: render director threejs stage"
```

### Task 8: Build the Director Workspace and Storyboard Entry

**Files:**
- Create: `apps/web/components/director/DirectorWorkspace.tsx`
- Create: `apps/web/components/director/DirectorObjectTree.tsx`
- Create: `apps/web/components/director/DirectorInspector.tsx`
- Create: `apps/web/components/director/DirectorShotStrip.tsx`
- Modify: `apps/web/components/WorkspaceTabs.tsx`
- Modify: `apps/web/components/Workspace.tsx`
- Modify: `apps/web/components/Storyboard.tsx`
- Modify: `apps/web/components/ShotCard.tsx`
- Modify: `apps/web/app/globals.css`
- Create: `apps/web/tests/director-workspace.test.tsx`
- Modify: `apps/web/tests/storyboard.test.tsx`

- [ ] **Step 1: Write failing workflow tests**

Cover opening from selected shot, stage creation, object selection, numeric transforms, camera settings, shot switching with autosave, blocked navigation on failure, undo/redo, mobile read-only drag mode, WebGL fallback, and preview upload.

- [ ] **Step 2: Verify RED**

Run: `npm --workspace apps/web test -- --run tests/director-workspace.test.tsx tests/storyboard.test.tsx`

- [ ] **Step 3: Implement workspace regions**

Add `director` to `WorkArea`. `Workspace` passes selected shot and scene; `DirectorWorkspace` owns reducer/network orchestration. Child components receive narrow data/callback contracts. Flush pending saves before shot, scene, project, or tab changes.

- [ ] **Step 4: Implement responsive operational layout**

Desktop uses `190px minmax(0,1fr) 230px` with a fixed shot strip. Mobile renders canvas preview above tabbed objects/camera parameters, disables transform drag, and preserves 44px minimum touch controls. No nested page cards.

- [ ] **Step 5: Verify and commit**

Run: `npm --workspace apps/web test -- --run tests/director-workspace.test.tsx tests/storyboard.test.tsx tests/workspace.test.tsx && npm --workspace apps/web run build`

```bash
git add apps/web/components/director apps/web/components/WorkspaceTabs.tsx apps/web/components/Workspace.tsx apps/web/components/Storyboard.tsx apps/web/components/ShotCard.tsx apps/web/app/globals.css apps/web/tests/director-workspace.test.tsx apps/web/tests/storyboard.test.tsx
git commit -m "feat: add 3d director workspace"
```

### Task 9: Add Suggestion Review, Shot Apply, and E2E Verification

**Files:**
- Create: `apps/web/components/director/DirectorSuggestionDialog.tsx`
- Modify: `apps/web/components/director/DirectorWorkspace.tsx`
- Modify: `apps/web/tests/director-workspace.test.tsx`
- Modify: `apps/web/e2e/production-flow.spec.ts`

- [ ] **Step 1: Write failing suggestion and browser tests**

Assert canonical data remains unchanged before accept, field checkboxes default safely, apply sends only selected fields, stale suggestions show conflict, and production asset IDs remain unchanged. Browser checks desktop object manipulation, camera switching, nonblank canvas pixels, preview upload, shot apply, reload persistence, and mobile numeric controls.

- [ ] **Step 2: Verify RED**

Run: `npm --workspace apps/web test -- --run tests/director-workspace.test.tsx && npm --workspace apps/web run test:e2e -- --grep director`

- [ ] **Step 3: Implement diff dialog and selective apply**

Render current/proposed values for composition, camera motion, image prompt, and negative prompt. Require at least one checked field. After apply, refresh shot and stage but preserve current scene/object selection.

- [ ] **Step 4: Complete real-browser canvas checks**

Use Playwright `page.evaluate` to sample canvas pixels and assert nonblank variance. Capture 1440x900 and 390x844 screenshots and assert no overlap through bounding-box checks.

- [ ] **Step 5: Verify and commit**

Run: `npm --workspace apps/web test && npm --workspace apps/web run test:e2e && npm --workspace apps/web run build`

```bash
git add apps/web/components/director/DirectorSuggestionDialog.tsx apps/web/components/director/DirectorWorkspace.tsx apps/web/tests/director-workspace.test.tsx apps/web/e2e/production-flow.spec.ts
git commit -m "feat: apply director compositions to shots"
```

### Task 10: Release v0.6.0 and Verify the Real Runtime

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `apps/web/package.json`
- Modify: `services/api/pyproject.toml`
- Modify: `services/api/uv.lock`
- Create: `docs/release-audits/2026-07-12-v0.6.0.md`

- [ ] **Step 1: Run complete verification**

Run: `cd services/api && uv run pytest -q`

Run: `npm test && npm run build && npm --workspace apps/web run test:e2e`

Expected: all API, Web, Compositor, build, browser, and canvas-pixel checks pass.

- [ ] **Step 2: Run production dependency audits**

Run: `npm audit --omit=dev`

Run: `cd services/api && uv export --no-dev --format requirements-txt --no-hashes | uv run --with pip-audit pip-audit -r /dev/stdin`

Document exact upstream findings; do not suppress high or critical issues.

- [ ] **Step 3: Bump versions**

```bash
npm version 0.6.0 --no-git-tag-version
npm --workspace apps/web version 0.6.0 --no-git-tag-version
cd services/api && uv version 0.6.0
```

- [ ] **Step 4: Start isolated services and verify a real project**

Run `./scripts/dev.sh` on available ports. Open an existing episode, stage a real scene, save at least two shot cameras, capture a PNG preview, request an AI composition, apply only composition/camera motion, reload, and confirm panel/video/speech asset IDs did not change.

- [ ] **Step 5: Record evidence and commit release**

Write test counts, build results, ports, migration revision, screenshot paths, pixel statistics, audit output, and known v0.7 exclusions to the release audit.

```bash
git diff --check
git add package.json package-lock.json apps/web/package.json services/api/pyproject.toml services/api/uv.lock docs/release-audits/2026-07-12-v0.6.0.md
git commit -m "chore: release v0.6.0"
```
