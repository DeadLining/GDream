# Character Reference Set Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-click generation of a seven-image, identity-consistent character reference set through the native GPT Image 2 generation and edit APIs.

**Architecture:** A focused `CharacterReferenceSetService` serially generates a set around one approved active identity anchor and emits durable progress snapshots. Model Runtime stores those snapshots in the existing job, preserves them across retry, and exposes them through existing polling. The React workspace starts one batch job and renders live progress while refreshing completed versions.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy, Pillow, httpx, pytest, React, TypeScript, Vitest, Testing Library, Next.js.

---

## File Structure

- Create `services/api/comic_studio/services/character_reference_sets.py` for ordered orchestration, anchor selection, progress, and resume.
- Create `services/api/tests/test_character_reference_sets.py` for consistency and partial-failure tests.
- Modify `services/api/comic_studio/services/character_references.py` to expose anchor-aware primitives.
- Modify `services/api/comic_studio/jobs.py` for running progress updates and resumable requeue.
- Modify Model Runtime contracts, service, route, and tests to support `mode="reference_set"`.
- Modify Web API, polling, types, workspace, and tests for one-click progress UI.

### Task 1: Persist resumable job progress

**Files:**
- Modify: `services/api/comic_studio/jobs.py`
- Test: `services/api/tests/test_jobs.py`

- [ ] **Step 1: Write failing tests**

```python
def test_running_job_can_persist_batch_progress(db_session):
    store = JobStore(db_session)
    job = store.create("runtime_image", "character", "c1", {"capability": "image"})
    store.transition(job.id, "running", progress=5)
    updated = store.update_progress(
        job.id, progress=29,
        result_metadata={"current_type": "front", "completed_types": ["primary"]},
    )
    assert updated.progress == 29
    assert updated.result_metadata["completed_types"] == ["primary"]


def test_failed_batch_requeues_without_losing_completed_types(db_session):
    store = JobStore(db_session)
    job = store.create("runtime_image", "character", "c1", {"capability": "image"})
    store.transition(job.id, "running", progress=29)
    store.transition(job.id, "failed", error="timeout", result_metadata={"completed_types": ["primary"]})
    retried = store.requeue(job.id, preserve_result_metadata=True)
    assert retried.status == "queued"
    assert retried.retry_count == 1
    assert retried.result_metadata["completed_types"] == ["primary"]
```

- [ ] **Step 2: Verify the tests fail**

Run: `cd services/api && uv run pytest tests/test_jobs.py -q`

Expected: FAIL because `update_progress` and `requeue` do not exist.

- [ ] **Step 3: Implement the methods**

```python
def update_progress(self, job_id, *, progress, result_metadata):
    job = self.get(job_id)
    if job is None:
        raise KeyError(job_id)
    if job.status != "running":
        raise InvalidJobTransition("Only running jobs can update progress")
    job.progress = max(0, min(99, progress))
    job.result_metadata = redact(result_metadata)
    self.session.commit()
    self.session.refresh(job)
    return job

def requeue(self, job_id, *, preserve_result_metadata=False):
    job = self.get(job_id)
    if job is None or job.status != "failed":
        raise InvalidJobTransition("Only failed jobs can be requeued")
    job.status = "queued"
    job.retry_count += 1
    job.error = ""
    if not preserve_result_metadata:
        job.progress = 0
        job.result_metadata = {}
    self.session.commit()
    self.session.refresh(job)
    return job
```

- [ ] **Step 4: Run tests and commit**

Run: `cd services/api && uv run pytest tests/test_jobs.py -q`

Expected: PASS.

```bash
git add services/api/comic_studio/jobs.py services/api/tests/test_jobs.py
git commit -m "feat: persist resumable runtime job progress"
```

### Task 2: Expose anchor-aware image primitives

**Files:**
- Modify: `services/api/comic_studio/services/character_references.py`
- Test: `services/api/tests/test_character_references.py`

- [ ] **Step 1: Write failing tests**

Test that `find_identity_anchor` returns only an approved active primary/front, `generate_primary` calls native generation, and `generate_from_anchor` calls native edit with the explicitly supplied anchor, `768x1024`, and `quality="low"`.

```python
anchor_reference, anchor_asset = service.find_identity_anchor(character.id)
generated, generated_asset = await service.generate_from_anchor(
    character.id, "side", "\u4fa7\u9762", provider, anchor_reference, anchor_asset
)
assert provider.edit_calls[0].size == "768x1024"
assert provider.edit_calls[0].quality == "low"
assert generated_asset.parent_asset_id == anchor_asset.id
```

- [ ] **Step 2: Verify failure**

Run: `cd services/api && uv run pytest tests/test_character_references.py -q`

Expected: FAIL because these methods do not exist.

- [ ] **Step 3: Implement the primitives**

Add `find_identity_anchor`, `generate_primary`, `generate_from_anchor`, and `approve_and_activate`. Extract `_prompt(character, reference_type)` and lock identity using `appearance_bible`, `continuity_rules`, and `negative_constraints`. Keep `generate` as a compatibility wrapper. Generation must call `provider.generate`; variants must call `provider.edit` using the same supplied anchor. Do not add chat endpoints or alternate model IDs.

- [ ] **Step 4: Run tests and commit**

Run: `cd services/api && uv run pytest tests/test_character_references.py tests/providers/test_gpt_image.py -q`

Expected: PASS, including native edit multipart, `quality=low`, and 256-pixel preparation tests.

```bash
git add services/api/comic_studio/services/character_references.py services/api/tests/test_character_references.py
git commit -m "refactor: expose anchored character image generation"
```

### Task 3: Orchestrate the seven-image set

**Files:**
- Create: `services/api/comic_studio/services/character_reference_sets.py`
- Create: `services/api/tests/test_character_reference_sets.py`

- [ ] **Step 1: Write failing orchestration tests**

Use the exact order:

```python
REFERENCE_SET_TYPES = (
    "primary", "front", "three_quarter", "side", "back", "expression", "outfit"
)
```

Tests must prove: a missing anchor is generated then automatically approved/activated; an existing anchor is reused; all six variants receive the same anchor asset; progress is emitted after each committed item; a failure on `side` preserves prior IDs; resume skips completed types and reuses the recorded anchor.

- [ ] **Step 2: Verify failure**

Run: `cd services/api && uv run pytest tests/test_character_reference_sets.py -q`

Expected: collection FAIL because the service does not exist.

- [ ] **Step 3: Implement the orchestrator**

```python
class CharacterReferenceSetError(RuntimeError):
    def __init__(self, metadata, cause):
        super().__init__(str(cause))
        self.metadata = metadata


class CharacterReferenceSetService:
    async def generate(self, character_id, provider, *, on_progress, resume):
        # Load and validate the recorded anchor or find the active approved anchor.
        # Generate/approve/activate primary only when no anchor exists.
        # Skip completed types from resume metadata.
        # Generate every remaining type from the same anchor.
        # Emit {mode,current_type,current_index,total,completed_types,references,anchor_*}.
        # Wrap a provider failure with failed_type and all completed metadata.
```

The resume loader must validate reference and asset ownership through database relationships; it must never accept a path from job metadata.

- [ ] **Step 4: Run tests and commit**

Run: `cd services/api && uv run pytest tests/test_character_reference_sets.py tests/test_character_references.py -q`

Expected: PASS.

```bash
git add services/api/comic_studio/services/character_reference_sets.py services/api/tests/test_character_reference_sets.py
git commit -m "feat: generate consistent character reference sets"
```

### Task 4: Integrate set mode with Model Runtime

**Files:**
- Modify: `services/api/comic_studio/model_runtime/contracts.py`
- Modify: `services/api/comic_studio/model_runtime/service.py`
- Modify: `services/api/comic_studio/routes/model_runtime.py`
- Modify: `services/api/tests/test_model_runtime_api.py`
- Modify: `services/api/tests/test_model_runtime_service.py`

- [ ] **Step 1: Write failing API tests**

```python
response = client.post("/api/model-runtime/image", json={
    "target_type": "character", "target_id": "c1", "mode": "reference_set"
})
assert response.status_code == 202
assert runtime.created[3]["mode"] == "reference_set"
```

Also assert `mode="reference_set"` with `target_type="shot"` returns 422.

- [ ] **Step 2: Write failing Runtime tests**

Verify the Runtime persists every progress callback, uses set metadata as the terminal result, merges `failed_type` with classified error fields, redacts provider errors, and preserves metadata only when retrying a reference-set job.

- [ ] **Step 3: Verify failure**

Run: `cd services/api && uv run pytest tests/test_model_runtime_api.py tests/test_model_runtime_service.py -q`

Expected: FAIL because the request mode and batch dispatch are absent.

- [ ] **Step 4: Implement validated mode and dispatch**

```python
class ImageRuntimeRequest(BaseModel):
    target_type: Literal["shot", "character"]
    target_id: str
    activate: bool = True
    reference_type: str = "primary"
    label: str = ""
    mode: Literal["single", "reference_set"] = "single"

    @model_validator(mode="after")
    def validate_mode_target(self):
        if self.mode == "reference_set" and self.target_type != "character":
            raise ValueError("reference_set mode requires a character target")
        return self
```

Pass `mode` through the route. In `run_media_job`, create an async progress callback that opens a fresh session and calls `JobStore.update_progress`. Catch `CharacterReferenceSetError` before generic classification and merge its metadata with `error_code` and `retryable`. On retry call `requeue(..., preserve_result_metadata=True)` only for reference-set jobs.

- [ ] **Step 5: Run tests and commit**

Run: `cd services/api && uv run pytest tests/test_model_runtime_api.py tests/test_model_runtime_service.py tests/test_model_runtime_repository.py -q`

Expected: PASS.

```bash
git add services/api/comic_studio/model_runtime/contracts.py services/api/comic_studio/model_runtime/service.py services/api/comic_studio/routes/model_runtime.py services/api/tests/test_model_runtime_api.py services/api/tests/test_model_runtime_service.py
git commit -m "feat: run character reference sets in model runtime"
```

### Task 5: Add the one-click Web workflow

**Files:**
- Modify: `apps/web/lib/types.ts`
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/lib/jobs.ts`
- Modify: `apps/web/components/CharacterWorkspace.tsx`
- Modify: `apps/web/tests/api.test.ts`
- Modify: `apps/web/tests/jobs.test.ts`
- Modify: `apps/web/tests/character-references.test.tsx`

- [ ] **Step 1: Write failing client and polling tests**

```typescript
await generateCharacterReferenceSet('character-1');
expect(fetchMock).toHaveBeenCalledWith('/api/model-runtime/image',expect.objectContaining({
  method:'POST',
  body:JSON.stringify({target_type:'character',target_id:'character-1',mode:'reference_set',activate:true}),
}));
```

Add `pollJob` coverage proving `onUpdate` receives running and terminal jobs.

- [ ] **Step 2: Write failing workspace tests**

Assert one `\u4e00\u952e\u751f\u6210\u6574\u5957` button starts the batch independently of the selected filter, shows `\u6b63\u5728\u751f\u6210 3/7：\u56db\u5206\u4e4b\u4e09`, refreshes when completed count increases, disables duplicate clicks, and shows `\u4fa7\u9762生成失败：image provider timed out` from terminal metadata.

- [ ] **Step 3: Verify failure**

Run: `cd apps/web && npm test -- --run tests/api.test.ts tests/jobs.test.ts tests/character-references.test.tsx`

Expected: FAIL because the helper, callback, and UI do not exist.

- [ ] **Step 4: Implement typed API and polling updates**

```typescript
export const generateCharacterReferenceSet=(id:string)=>apiRequest<ModelRuntimeJob>(
  '/api/model-runtime/image',
  json('POST',{target_type:'character',target_id:id,mode:'reference_set',activate:true}),
);
```

Add typed metadata fields: `mode`, `current_type`, `current_index`, `total`, `completed_types`, `references`, optional `failed_type`, `error_code`, and `retryable`. Extend `PollOptions` with `onUpdate?: (job:Job)=>void` and invoke it after every load.

- [ ] **Step 5: Implement the workspace UI**

Keep filters for browsing and uploads. Replace the filtered generate action with `\u4e00\u952e\u751f\u6210\u6574\u5957`. Track the latest job, refresh references when completed count grows, render step labels from the existing type map, and use `retryModelRuntimeJob` to resume retryable partial failures.

- [ ] **Step 6: Run tests and commit**

Run: `cd apps/web && npm test -- --run tests/api.test.ts tests/jobs.test.ts tests/character-references.test.tsx`

Expected: PASS.

```bash
git add apps/web/lib/types.ts apps/web/lib/api.ts apps/web/lib/jobs.ts apps/web/components/CharacterWorkspace.tsx apps/web/tests/api.test.ts apps/web/tests/jobs.test.ts apps/web/tests/character-references.test.tsx
git commit -m "feat: add one-click character reference set generation"
```

### Task 6: Full and live verification

**Files:** Modify only if verification exposes a defect in files above.

- [ ] **Step 1: Run full automated verification**

```bash
cd services/api && uv run pytest -q
cd ../../apps/web && npm test && npm run build
```

Expected: all tests pass; build exits 0; only the existing Starlette warning remains.

- [ ] **Step 2: Restore generated Next type path if needed**

If `apps/web/next-env.d.ts` changed to `.next/dev/types/routes.d.ts`, restore `.next/types/routes.d.ts` using `apply_patch` and confirm there is no diff.

- [ ] **Step 3: Restart local services**

API from repository root:

```bash
services/api/.venv/bin/uvicorn comic_studio.main:app --app-dir services/api --host 127.0.0.1 --port 8100
```

Web from `apps/web`:

```bash
AI_COMIC_API_PROXY_TARGET=http://127.0.0.1:8100 npm run dev -- --hostname 127.0.0.1 --port 3100
```

- [ ] **Step 4: Verify native provider health and start a real batch**

Confirm `/api/model-runtime/health` reports image model `gpt-image-2`. Do not inspect or print the key. POST this through port 3100:

```json
{"target_type":"character","target_id":"<existing-character-id>","mode":"reference_set","activate":true}
```

Expected: immediate HTTP 202 with a job ID.

- [ ] **Step 5: Poll and inspect results**

Poll `/api/jobs/<job_id>` to terminal. On success, verify all seven ordered types and request every media URL through port 3100. Validate each response is an image and visually inspect face, hair, body proportions, costume structure, palette, and accessories for consistency.

On failure report job ID, status, failed type, error code, and sanitized original error. Re-read the native GPT Image documentation before changing parameters; never repeat an invalid request unchanged.

- [ ] **Step 6: Check the final diff**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and no unrelated changes; preserve the pre-existing untracked `data/`.
