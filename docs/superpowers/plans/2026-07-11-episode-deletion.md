# Episode Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add permanent episode deletion with an impact preview, safe local-media cleanup, and predictable selection after deletion.

**Architecture:** A focused `EpisodeDeletionService` discovers the episode graph and assets by their existing `kind` convention, deletes database records transactionally, then removes validated files below `data_root`. FastAPI exposes preview and delete endpoints; `Workspace` owns the confirmation state and navigation decision while `ProjectNavigator` only emits delete intent.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, pytest, Next.js/React, TypeScript, Vitest Testing Library, Playwright.

---

## File Map

- Create `services/api/comic_studio/services/episode_deletion.py`: impact discovery, transactional database deletion, safe post-commit file cleanup.
- Create `services/api/tests/test_episode_deletion.py`: service and HTTP behavior, counts, cascade, cleanup, rollback, and path safety.
- Modify `services/api/comic_studio/schemas.py`: deletion impact/result response models.
- Modify `services/api/comic_studio/routes/episodes.py`: preview and delete routes.
- Modify `apps/web/lib/types.ts`: frontend deletion response types.
- Modify `apps/web/lib/api.ts`: preview and delete clients.
- Create `apps/web/components/DeleteEpisodeDialog.tsx`: accessible destructive confirmation dialog.
- Modify `apps/web/components/ProjectNavigator.tsx`: separate episode selection and trash commands.
- Modify `apps/web/components/Workspace.tsx`: dialog orchestration, stale-response guard, and adjacent selection.
- Modify `apps/web/app/globals.css`: bounded episode row, icon, destructive dialog, warning, and mobile styles.
- Modify `apps/web/tests/workspace.test.tsx`: selection and failure behavior.
- Modify `apps/web/e2e/production-flow.spec.ts`: browser deletion flow.

### Task 1: Define Deletion Impact and Discover the Episode Graph

**Files:**
- Create: `services/api/comic_studio/services/episode_deletion.py`
- Test: `services/api/tests/test_episode_deletion.py`

- [ ] **Step 1: Write failing impact-discovery tests**

Create fixtures containing two scenes, multiple shots/dialogue lines, multiple panel/video/audio versions, one episode render job, and one unrelated episode. Assert that `preview(episode_id)` reports only the requested episode's counts and asset IDs.

```python
impact = EpisodeDeletionService(session, data_root).preview(episode.id)
assert impact.scenes == 2
assert impact.shots == 3
assert impact.dialogue_lines == 2
assert impact.assets == 6
assert unrelated_asset.id not in impact.asset_ids
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd services/api && uv run pytest -q tests/test_episode_deletion.py -k preview`

Expected: collection/import failure because `EpisodeDeletionService` does not exist.

- [ ] **Step 3: Implement minimal discovery types and queries**

Use one ORM-loaded episode graph and exact asset-kind matching:

```python
@dataclass(frozen=True)
class EpisodeDeletionImpact:
    episode_id: str
    scenes: int
    shots: int
    dialogue_lines: int
    assets: int
    shot_ids: tuple[str, ...]
    dialogue_ids: tuple[str, ...]
    asset_ids: tuple[str, ...]
    local_paths: tuple[str, ...]

shot_kinds = {f"panel:{shot_id}", f"video:{shot_id}" for shot_id in shot_ids}
dialogue_kinds = {f"dialogue:{line_id}" for line_id in dialogue_ids}
assets = session.scalars(
    select(models.Asset).where(models.Asset.kind.in_(shot_kinds | dialogue_kinds))
).all()
```

Build the kind set with separate comprehensions so the Python syntax is valid. Include episode render outputs only when they are registered as assets; do not infer arbitrary paths from job metadata.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `cd services/api && uv run pytest -q tests/test_episode_deletion.py -k preview`

Expected: preview tests pass.

- [ ] **Step 5: Commit discovery**

```bash
git add services/api/comic_studio/services/episode_deletion.py services/api/tests/test_episode_deletion.py
git commit -m "feat: inspect episode deletion impact"
```

### Task 2: Delete Database Records and Safely Clean Media

**Files:**
- Modify: `services/api/comic_studio/services/episode_deletion.py`
- Modify: `services/api/tests/test_episode_deletion.py`

- [ ] **Step 1: Write failing deletion tests**

Cover successful cascade, unrelated-record preservation, missing files, path traversal, symlink escape, and a forced `session.commit()` failure.

```python
result = EpisodeDeletionService(session, data_root).delete(episode.id)
assert session.get(models.Episode, episode.id) is None
assert session.get(models.Asset, panel_asset.id) is None
assert not (data_root / panel_asset.local_path).exists()
assert session.get(models.Episode, unrelated_episode.id) is not None
```

For rollback, assert the episode and asset remain when commit raises before the filesystem phase.

- [ ] **Step 2: Run deletion tests and verify RED**

Run: `cd services/api && uv run pytest -q tests/test_episode_deletion.py -k 'delete or rollback or path'`

Expected: failures because `delete()` and safe cleanup are missing.

- [ ] **Step 3: Implement transactional deletion**

In `delete()`:

```python
impact = self.preview(episode_id)
if impact is None:
    return None
episode = self.session.get(models.Episode, episode_id)
self.session.execute(delete(models.Asset).where(models.Asset.id.in_(impact.asset_ids)))
self.session.execute(
    delete(models.Job).where(
        or_(
            and_(models.Job.target_type == "episode", models.Job.target_id == episode_id),
            and_(models.Job.target_type == "shot", models.Job.target_id.in_(impact.shot_ids)),
            and_(models.Job.target_type == "dialogue", models.Job.target_id.in_(impact.dialogue_ids)),
        )
    )
)
self.session.delete(episode)
try:
    self.session.commit()
except Exception:
    self.session.rollback()
    raise
warnings = self._cleanup_files(impact.local_paths)
return EpisodeDeletionResult(impact=impact, cleanup_warnings=warnings)
```

Delete jobs whose targets are the episode, its shots, or its dialogue lines. Production runs/items are removed by the existing episode/run cascades. Clear no unrelated project assets.

- [ ] **Step 4: Implement safe cleanup**

Resolve every candidate and require containment:

```python
candidate = (self.data_root / relative_path).resolve()
if candidate == self.data_root or self.data_root not in candidate.parents:
    warnings.append("Skipped unsafe media path")
    continue
try:
    candidate.unlink(missing_ok=True)
except OSError:
    warnings.append("Could not remove one local media file")
```

Never return the relative or absolute path. Remove empty parent directories only while the parent remains below `data_root`.

- [ ] **Step 5: Run deletion tests and verify GREEN**

Run: `cd services/api && uv run pytest -q tests/test_episode_deletion.py`

Expected: all service tests pass.

- [ ] **Step 6: Run adjacent API regression tests**

Run: `cd services/api && uv run pytest -q tests/test_episode_graph.py tests/test_episode_planning.py tests/test_production_runs.py`

Expected: all pass.

- [ ] **Step 7: Commit deletion service**

```bash
git add services/api/comic_studio/services/episode_deletion.py services/api/tests/test_episode_deletion.py
git commit -m "feat: delete episode production data"
```

### Task 3: Expose Preview and Delete APIs

**Files:**
- Modify: `services/api/comic_studio/schemas.py`
- Modify: `services/api/comic_studio/routes/episodes.py`
- Modify: `services/api/tests/test_episode_deletion.py`

- [ ] **Step 1: Write failing route tests**

```python
preview = client.get(f"/api/episodes/{episode_id}/deletion-preview")
assert preview.status_code == 200
assert preview.json()["deleted"]["shots"] == 3

deleted = client.delete(f"/api/episodes/{episode_id}")
assert deleted.status_code == 200
assert deleted.json()["deleted_episode_id"] == episode_id
assert client.get(f"/api/episodes/{episode_id}").status_code == 404
```

Also assert both endpoints return `404` for an unknown ID.

- [ ] **Step 2: Run route tests and verify RED**

Run: `cd services/api && uv run pytest -q tests/test_episode_deletion.py -k route`

Expected: `404` for the new endpoint paths.

- [ ] **Step 3: Add response schemas**

```python
class EpisodeDeletionCounts(BaseModel):
    scenes: int
    shots: int
    dialogue_lines: int
    assets: int

class EpisodeDeletionPreview(BaseModel):
    episode_id: str
    title: str
    deleted: EpisodeDeletionCounts

class EpisodeDeletionRead(EpisodeDeletionPreview):
    deleted_episode_id: str
    cleanup_warnings: list[str]
```

Keep internal asset IDs and paths out of public schemas.

- [ ] **Step 4: Add routes using application settings**

Resolve `data_root` through the existing `request.app.state.settings.data_root` application state.

```python
@router.get("/api/episodes/{episode_id}/deletion-preview", response_model=schemas.EpisodeDeletionPreview)
def preview_episode_deletion(episode_id: str, request: Request, session: SessionDependency):
    impact = EpisodeDeletionService(session, request.app.state.settings.data_root).preview(episode_id)
    if impact is None:
        raise HTTPException(status_code=404, detail="Episode not found")
    return impact.to_preview_read()

@router.delete("/api/episodes/{episode_id}", response_model=schemas.EpisodeDeletionRead)
def delete_episode(episode_id: str, request: Request, session: SessionDependency):
    result = EpisodeDeletionService(session, request.app.state.settings.data_root).delete(episode_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Episode not found")
    return result.to_read()
```

- [ ] **Step 5: Run route and security tests**

Run: `cd services/api && uv run pytest -q tests/test_episode_deletion.py`

Expected: all pass, with no absolute path in any JSON response.

- [ ] **Step 6: Commit API surface**

```bash
git add services/api/comic_studio/schemas.py services/api/comic_studio/routes/episodes.py services/api/tests/test_episode_deletion.py
git commit -m "feat: expose episode deletion API"
```

### Task 4: Add the Navigator Command and Confirmation Dialog

**Files:**
- Modify: `apps/web/lib/types.ts`
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/components/DeleteEpisodeDialog.tsx`
- Modify: `apps/web/components/ProjectNavigator.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/tests/workspace.test.tsx`

- [ ] **Step 1: Add failing navigator/dialog tests**

Extend the API mock with `previewEpisodeDeletion` and `deleteEpisode`. Render two episodes and assert clicking `删除剧集：第二集` does not call `getEpisode('episode-2')`, opens a dialog, and renders all impact counts.

```typescript
await user.click(screen.getByRole('button',{name:'删除剧集：第二集'}));
expect(screen.getByRole('dialog',{name:'永久删除剧集'})).toBeVisible();
expect(screen.getByText('3 个分镜')).toBeVisible();
expect(mocks.getEpisode).not.toHaveBeenCalledWith('episode-2');
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test --workspace @comic-studio/web -- --run tests/workspace.test.tsx`

Expected: missing delete command/dialog.

- [ ] **Step 3: Add frontend types and API functions**

```typescript
export type EpisodeDeletionPreview={episode_id:string;title:string;deleted:{scenes:number;shots:number;dialogue_lines:number;assets:number}};
export type EpisodeDeletionResult=EpisodeDeletionPreview&{deleted_episode_id:string;cleanup_warnings:string[]};

export const previewEpisodeDeletion=(id:string)=>apiRequest<EpisodeDeletionPreview>(`/api/episodes/${id}/deletion-preview`);
export const deleteEpisode=(id:string)=>apiRequest<EpisodeDeletionResult>(`/api/episodes/${id}`,{method:'DELETE'});
```

- [ ] **Step 4: Implement accessible episode rows**

Replace the single full-row button with a non-interactive row wrapper containing two sibling buttons: the selection button and a `Trash2` icon button. Stop relying on nested buttons. Give the icon `aria-label={`删除剧集：${episode.title}`}` and a matching tooltip.

- [ ] **Step 5: Implement the focused dialog**

`DeleteEpisodeDialog` receives `episode`, `preview`, `busy`, `error`, `onCancel`, and `onConfirm`. It uses `role="dialog"`, `aria-modal="true"`, a literal `永久删除剧集` heading, count text, and destructive/cancel buttons. It displays cleanup warnings separately from blocking errors.

- [ ] **Step 6: Add compact, viewport-safe styles**

Use a stable two-column episode row (`minmax(0,1fr) 32px`), a 32px square icon command, an 8px-or-less dialog radius, wrapped count text, and full-width dialog actions below 600px. Do not introduce cards inside the dialog.

- [ ] **Step 7: Run the focused Web test and verify GREEN**

Run: `npm test --workspace @comic-studio/web -- --run tests/workspace.test.tsx`

Expected: navigator/dialog tests pass.

- [ ] **Step 8: Commit the UI shell**

```bash
git add apps/web/lib/types.ts apps/web/lib/api.ts apps/web/components/DeleteEpisodeDialog.tsx apps/web/components/ProjectNavigator.tsx apps/web/app/globals.css apps/web/tests/workspace.test.tsx
git commit -m "feat: add episode deletion dialog"
```

### Task 5: Implement Selection, Empty State, and Stale-Request Protection

**Files:**
- Modify: `apps/web/components/Workspace.tsx`
- Modify: `apps/web/tests/workspace.test.tsx`

- [ ] **Step 1: Write failing navigation tests**

Add independent tests for:

- selected first episode deletes to next;
- selected last episode deletes to previous;
- deleting the only episode clears `ai-comic-episode` and shows the no-episode storyboard state;
- deleting an unselected episode preserves selection;
- API failure keeps the dialog open;
- a completion from project A is ignored after navigation to project B;
- cleanup warnings appear after successful deletion.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test --workspace @comic-studio/web -- --run tests/workspace.test.tsx`

Expected: deletion behavior tests fail.

- [ ] **Step 3: Implement deletion orchestration in `Workspace`**

Capture the target project ID and a monotonically increasing deletion generation. Determine the preferred adjacent ID from the pre-delete `project.episodes` array before calling the API.

```typescript
const deletedIndex=project.episodes.findIndex(item=>item.id===target.id);
const adjacent=project.episodes[deletedIndex+1]??project.episodes[deletedIndex-1]??null;
const result=await deleteEpisode(target.id);
if(deletionGeneration.current!==generation||projectIdRef.current!==targetProjectId)return;
if(episode?.id===target.id){
  adjacent?localStorage.setItem('ai-comic-episode',adjacent.id):localStorage.removeItem('ai-comic-episode');
}
await loadProject(targetProjectId);
```

For non-selected deletion, preserve the selected episode ID in local storage before reload. Close the dialog only after authoritative reload succeeds.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test --workspace @comic-studio/web -- --run tests/workspace.test.tsx`

Expected: all workspace tests pass.

- [ ] **Step 5: Commit orchestration**

```bash
git add apps/web/components/Workspace.tsx apps/web/tests/workspace.test.tsx
git commit -m "feat: keep navigation stable after episode deletion"
```

### Task 6: Add Browser Coverage and Verify the Complete Feature

**Files:**
- Modify: `apps/web/e2e/production-flow.spec.ts`

- [ ] **Step 1: Add a failing route-mocked Playwright test**

Mock two episodes, the preview endpoint, and the DELETE endpoint. Assert the requested episode title/counts appear, cancel performs no DELETE, confirm performs one DELETE, the removed row disappears, and the adjacent episode becomes active.

- [ ] **Step 2: Run the browser test and verify behavior**

Run against the existing dev server to avoid Next.js lock conflicts:

```bash
E2E_PORT=3100 npm run test:e2e --workspace @comic-studio/web -- --grep "deletes an episode" --project=desktop
```

Expected: one Playwright test passes.

- [ ] **Step 3: Run complete verification**

```bash
cd services/api && uv run pytest -q
cd ../..
npm test --workspace @comic-studio/web
npm run build --workspace @comic-studio/web
git diff --check
```

Expected: zero failures, successful production build, and no whitespace errors. If unrelated dirty-worktree tests fail, rerun the deletion suites in a clean checkout and report the unrelated failures explicitly.

- [ ] **Step 4: Security review**

Confirm no absolute paths are returned, containment uses resolved paths, no user-controlled SQL is constructed, missing IDs return `404`, concurrent clicks are disabled, and only assets whose exact `kind` references the deleted graph are removed.

- [ ] **Step 5: Commit browser coverage**

```bash
git add apps/web/e2e/production-flow.spec.ts
git commit -m "test: cover episode deletion workflow"
```
