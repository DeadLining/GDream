# Script Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent project-level script library with autosaved revisions, retained uploads, AI stream recovery, structured parsing, and episode provenance for release `v0.5.0`.

**Architecture:** Add `ScriptDocument`, `ScriptRevision`, and `ScriptImportEpisode` above the existing `ScriptImport` pipeline. A focused document service manages revision state and optimistic saves, a file store owns data-root-contained uploads, and existing parsing/confirmation services consume a specific finalized revision. The React workspace becomes a two-pane library whose editor persists to the API and retains local storage only as an explicit recovery source.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2, Alembic, SQLite, Pydantic, pytest, Next.js 16, React 19, TypeScript, Vitest Testing Library, Playwright, SSE.

---

## File Map

- Create `services/api/alembic/versions/20260712_01_script_library.py`: additive script-library schema and downgrade.
- Modify `services/api/comic_studio/models.py`: document, revision, import provenance relationships and constraints.
- Create `services/api/comic_studio/script_library.py`: Pydantic request/response contracts.
- Create `services/api/comic_studio/services/script_documents.py`: document CRUD, working revision, finalization, restore, and delete rules.
- Create `services/api/comic_studio/services/script_files.py`: atomic upload persistence and contained cleanup.
- Create `services/api/comic_studio/routes/scripts.py`: project script, revision, upload, generation, and parse endpoints.
- Modify `services/api/comic_studio/services/script_imports.py`: parse a linked revision and create episode provenance atomically.
- Modify `services/api/comic_studio/routes/script_imports.py`: retain legacy endpoints while returning linked revision data.
- Modify `services/api/comic_studio/script_imports.py`: expose nullable revision/provenance fields.
- Modify `services/api/comic_studio/main.py`: register script routes and recover interrupted generation state.
- Create `services/api/tests/test_script_documents.py`: model, service, route, conflicts, restore, and deletion tests.
- Create `services/api/tests/test_script_files.py`: upload containment, checksum, cleanup, and extraction tests.
- Modify `services/api/tests/test_script_generation_stream.py`: persisted partial stream, continue, and failure tests.
- Modify `services/api/tests/test_script_import_confirmation.py`: revision-to-episode provenance tests.
- Modify `services/api/tests/test_migrations.py`: migration upgrade/downgrade assertions.
- Modify `apps/web/lib/types.ts`: script document, revision, conflict, and provenance types.
- Modify `apps/web/lib/api.ts`: script library CRUD/upload/restore/stream/parse clients.
- Create `apps/web/components/ScriptLibrary.tsx`: selected document, list loading, create, delete, and recovery orchestration.
- Create `apps/web/components/ScriptList.tsx`: project script list and responsive selection surface.
- Create `apps/web/components/ScriptEditor.tsx`: source editor, autosave state, generation, parse, and upload commands.
- Create `apps/web/components/ScriptRevisionPanel.tsx`: history, preview, and restore UI.
- Modify `apps/web/components/ScriptImportWorkspace.tsx`: retain structured preview as a child flow driven by a script revision.
- Modify `apps/web/components/Workspace.tsx`: mount the library and refresh project/episode navigation after confirmation.
- Modify `apps/web/app/globals.css`: dense two-pane studio layout and narrow-screen drawer behavior.
- Create `apps/web/tests/script-library.test.tsx`: library, autosave, conflicts, revisions, upload, and recovery tests.
- Modify `apps/web/tests/script-import.test.tsx`: revision-driven parse/confirm compatibility tests.
- Modify `apps/web/e2e/production-flow.spec.ts`: persistent script-to-episode browser workflow.
- Modify `package.json`, `apps/web/package.json`, and `services/api/pyproject.toml`: bump release version to `0.5.0` after verification.
- Create `docs/release-audits/2026-07-12-v0.5.0.md`: commands, outcomes, and known limits.

### Task 1: Add Script Library Schema and Migration

**Files:**
- Modify: `services/api/comic_studio/models.py`
- Create: `services/api/alembic/versions/20260712_01_script_library.py`
- Modify: `services/api/tests/test_migrations.py`
- Create: `services/api/tests/test_script_documents.py`

- [ ] **Step 1: Write failing model and migration tests**

Add tests that create one project, one document, one working revision, one finalized revision, one linked import, and one linked episode. Assert revision numbering, the single-working-revision constraint, foreign keys, and downgrade removal.

```python
document = models.ScriptDocument(project_id=project.id, title="雨夜", source_type="ai")
session.add(document)
session.flush()
revision = models.ScriptRevision(
    document_id=document.id,
    revision_number=1,
    status="working",
    content="第一集",
    checksum=sha256(b"第一集").hexdigest(),
    creation_method="ai",
)
session.add(revision)
session.commit()
assert revision.document_id == document.id
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `cd services/api && uv run pytest -q tests/test_script_documents.py tests/test_migrations.py -k 'script or revision'`

Expected: failures because the models and migration do not exist.

- [ ] **Step 3: Add ORM models and relationships**

Add `Project.scripts`, `ScriptDocument.revisions`, `ScriptRevision.imports`, `ScriptImport.script_revision`, and `ScriptImportEpisode` relationships. Use named constraints so migration and SQLite tests can inspect them.

```python
class ScriptDocument(Base):
    __tablename__ = "script_documents"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    source_type: Mapped[str] = mapped_column(String(24), index=True)
    status: Mapped[str] = mapped_column(String(32), default="draft", index=True)
    current_revision_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

class ScriptRevision(Base):
    __tablename__ = "script_revisions"
    __table_args__ = (UniqueConstraint("document_id", "revision_number", name="uq_script_revision_number"),)
```

Use a partial unique index in the migration for one `working` revision per document:

```python
op.create_index(
    "uq_script_revision_working",
    "script_revisions",
    ["document_id"],
    unique=True,
    sqlite_where=sa.text("status = 'working'"),
)
```

- [ ] **Step 4: Implement additive migration and downgrade**

Create tables in dependency order, add nullable `script_revision_id` to `script_imports`, and create `script_import_episodes` with unique `episode_id`. Downgrade drops the association, removes the linked column through batch mode, then drops revisions and documents.

- [ ] **Step 5: Run migration and model tests**

Run: `cd services/api && uv run pytest -q tests/test_script_documents.py tests/test_migrations.py`

Expected: all tests pass.

- [ ] **Step 6: Commit schema**

```bash
git add services/api/comic_studio/models.py services/api/alembic/versions/20260712_01_script_library.py services/api/tests/test_script_documents.py services/api/tests/test_migrations.py
git commit -m "feat: add script library schema"
```

### Task 2: Implement Script Files and Document Revision Service

**Files:**
- Create: `services/api/comic_studio/services/script_files.py`
- Create: `services/api/comic_studio/services/script_documents.py`
- Create: `services/api/tests/test_script_files.py`
- Modify: `services/api/tests/test_script_documents.py`

- [ ] **Step 1: Write failing file-store and revision tests**

Cover atomic writes, generated storage names, path containment, checksum equality, cleanup after a simulated commit failure, title rename, autosave conflict, finalization, restore, ordered list, and deletion blocked by provenance.

```python
saved = store.persist_upload(project.id, document.id, "../story.docx", payload)
assert saved.relative_path.startswith(f"projects/{project.id}/scripts/{document.id}/")
assert (data_root / saved.relative_path).read_bytes() == payload
assert saved.checksum == sha256(payload).hexdigest()

with pytest.raises(ScriptRevisionConflict):
    service.save(document.id, "changed", expected_checksum="stale")
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd services/api && uv run pytest -q tests/test_script_files.py tests/test_script_documents.py -k 'store or save or restore or delete'`

Expected: import failures for the new services.

- [ ] **Step 3: Implement contained atomic file storage**

`ScriptFileStore.persist_upload()` writes to a sibling temporary file, fsyncs, then replaces the generated destination. `resolve_relative()` must reject absolute paths, `..`, symlink escapes, and the data root itself.

```python
candidate = (self.data_root / relative_path).resolve()
root = self.data_root.resolve()
if candidate == root or root not in candidate.parents:
    raise ScriptFilePathError("unsafe_script_path")
```

- [ ] **Step 4: Implement document and revision state transitions**

Expose focused methods:

```python
create(project_id, title, source_type, content, creation_method, upload=None)
list_for_project(project_id)
get(document_id)
rename(document_id, title)
save(document_id, content, expected_checksum)
finalize(document_id)
restore(document_id, revision_id)
delete(document_id)
```

`save()` updates the current working revision or creates the next numbered working revision after a finalized current revision. `finalize()` computes checksum and changes only `working -> finalized`. `restore()` copies finalized content into a new finalized revision and updates `current_revision_id`. `delete()` returns a typed conflict containing episode IDs/titles when associations exist.

- [ ] **Step 5: Run service tests and verify GREEN**

Run: `cd services/api && uv run pytest -q tests/test_script_files.py tests/test_script_documents.py`

Expected: all tests pass.

- [ ] **Step 6: Commit services**

```bash
git add services/api/comic_studio/services/script_files.py services/api/comic_studio/services/script_documents.py services/api/tests/test_script_files.py services/api/tests/test_script_documents.py
git commit -m "feat: persist script documents and revisions"
```

### Task 3: Expose Script Library CRUD, Upload, and Revision APIs

**Files:**
- Create: `services/api/comic_studio/script_library.py`
- Create: `services/api/comic_studio/routes/scripts.py`
- Modify: `services/api/comic_studio/main.py`
- Modify: `services/api/tests/test_script_documents.py`
- Modify: `services/api/tests/test_script_files.py`

- [ ] **Step 1: Write failing route contract tests**

Assert list ordering, create/paste, upload retention, detail, title rename, optimistic autosave, conflict payload, history, restore, delete, unknown IDs, and cross-project isolation.

```python
created = client.post(f"/api/projects/{project_id}/scripts", json={
    "title": "雨夜", "source_type": "paste", "content": "第一集"
})
assert created.status_code == 201
script_id = created.json()["id"]
saved = client.patch(f"/api/scripts/{script_id}", json={
    "content": "第一集\n场景一", "expected_checksum": created.json()["current_revision"]["checksum"]
})
assert saved.status_code == 200
```

- [ ] **Step 2: Run route tests and verify RED**

Run: `cd services/api && uv run pytest -q tests/test_script_documents.py tests/test_script_files.py -k route`

Expected: all new paths return `404`.

- [ ] **Step 3: Define strict request and response contracts**

Include `ScriptDocumentSummary`, `ScriptDocumentRead`, `ScriptRevisionRead`, `ScriptCreate`, `ScriptPatch`, `ScriptDeleteConflict`, and `ScriptRestoreRequest`. Limit titles to 200 characters and source text to 500,000 characters. Responses expose relative media metadata but no absolute paths.

- [ ] **Step 4: Implement routes and register the router**

Map typed service errors to `404`, `409 revision_conflict`, `409 script_has_episodes`, `413 source_too_large`, and `422 unsafe_script_path`. Upload extraction reuses `extract_uploaded_script()` and persists original bytes before creating the document.

```python
@router.get("/api/projects/{project_id}/scripts", response_model=list[ScriptDocumentSummary])
def list_scripts(project_id: str, request: Request): ...

@router.post("/api/scripts/{script_id}/revisions/{revision_id}/restore", response_model=ScriptDocumentRead)
def restore_script(script_id: str, revision_id: str, request: Request): ...
```

- [ ] **Step 5: Run route and existing import regressions**

Run: `cd services/api && uv run pytest -q tests/test_script_documents.py tests/test_script_files.py tests/test_script_import_api.py`

Expected: all tests pass.

- [ ] **Step 6: Commit API surface**

```bash
git add services/api/comic_studio/script_library.py services/api/comic_studio/routes/scripts.py services/api/comic_studio/main.py services/api/tests/test_script_documents.py services/api/tests/test_script_files.py
git commit -m "feat: expose script library api"
```

### Task 4: Persist AI Generation Streams

**Files:**
- Modify: `services/api/comic_studio/routes/scripts.py`
- Modify: `services/api/comic_studio/main.py`
- Modify: `services/api/tests/test_script_generation_stream.py`

- [ ] **Step 1: Write failing persisted-stream tests**

Cover creation before provider invocation, chunk persistence, stop/disconnect, redacted failure, continuation from the same revision, finalization, stale revision rejection, and startup recovery of `generating` documents.

```python
events = list(stream_response.iter_lines())
detail = client.get(f"/api/scripts/{script_id}").json()
assert detail["current_revision"]["content"] == "第一集：雨夜\n场景一"
assert detail["current_revision"]["status"] == "finalized"
assert detail["status"] == "ready"
```

- [ ] **Step 2: Run stream tests and verify RED**

Run: `cd services/api && uv run pytest -q tests/test_script_generation_stream.py`

Expected: failures because generation still uses the legacy project endpoint and does not persist chunks.

- [ ] **Step 3: Implement revision-bound SSE generation**

`POST /api/scripts/{script_id}/generation/stream` accepts `brief` and `expected_revision_id`. Before streaming, finalize any prior edit checkpoint, create or reuse the working AI revision, and set document status to `generating`. Buffer chunks and persist after a bounded character/time threshold; flush in `finally`.

```python
yield _sse("chunk", {
    "text": chunk,
    "revision_id": revision.id,
    "persisted_length": persisted_length,
})
```

On completion finalize and emit the complete document. On provider failure retain the working revision, set `generation_failed`, and emit a redacted error. On client cancellation retain `draft` without logging it as provider failure.

- [ ] **Step 4: Recover interrupted generation at startup**

Add `recover_script_generations()` beside import recovery. It changes `generating` to `generation_failed` without modifying content and records no provider detail.

- [ ] **Step 5: Run stream and redaction tests**

Run: `cd services/api && uv run pytest -q tests/test_script_generation_stream.py tests/test_redaction.py`

Expected: all tests pass.

- [ ] **Step 6: Commit streaming persistence**

```bash
git add services/api/comic_studio/routes/scripts.py services/api/comic_studio/main.py services/api/tests/test_script_generation_stream.py
git commit -m "feat: persist script generation streams"
```

### Task 5: Link Parsing and Confirmed Episodes to Revisions

**Files:**
- Modify: `services/api/comic_studio/services/script_imports.py`
- Modify: `services/api/comic_studio/routes/scripts.py`
- Modify: `services/api/comic_studio/routes/script_imports.py`
- Modify: `services/api/comic_studio/script_imports.py`
- Modify: `services/api/tests/test_script_import_parsing.py`
- Modify: `services/api/tests/test_script_import_confirmation.py`
- Modify: `services/api/tests/test_script_import_api.py`

- [ ] **Step 1: Write failing revision parse and provenance tests**

Assert parse finalizes the current working revision, copies its source snapshot into `ScriptImport.extracted_text`, links `script_revision_id`, does not mutate source content, detects stale previews, and creates one association for each enabled confirmed episode.

```python
parsed = client.post(f"/api/scripts/{script_id}/parse")
assert parsed.status_code == 200
assert parsed.json()["script_revision_id"] == revision_id

confirmed = client.post(f"/api/script-imports/{import_id}/confirm", json={"character_mappings": {}})
links = session.scalars(select(models.ScriptImportEpisode).where(
    models.ScriptImportEpisode.script_import_id == import_id
)).all()
assert len(links) == enabled_episode_count
```

- [ ] **Step 2: Run parsing tests and verify RED**

Run: `cd services/api && uv run pytest -q tests/test_script_import_parsing.py tests/test_script_import_confirmation.py tests/test_script_import_api.py`

Expected: linked revision fields and provenance rows are missing.

- [ ] **Step 3: Add revision-driven parse creation**

`POST /api/scripts/{script_id}/parse` finalizes the current revision, creates `ScriptImport(mode="auto", source_format=source_type, script_revision_id=revision.id, extracted_text=revision.content)`, then invokes the existing parser. Keep legacy project import creation unchanged.

- [ ] **Step 4: Create provenance in the confirmation transaction**

After each enabled draft episode is flushed, add:

```python
self.session.add(models.ScriptImportEpisode(
    script_import_id=script_import.id,
    episode_id=episode.id,
    draft_episode_id=draft_episode.draft_id,
))
```

Do this before the single existing commit so hierarchy and provenance succeed or roll back together.

- [ ] **Step 5: Expose linked fields and stale-preview metadata**

Add nullable `script_revision_id` and `generated_episode_ids` to `ScriptImportRead`. The script detail response reports whether its latest import revision differs from `current_revision_id`.

- [ ] **Step 6: Run all script-import tests**

Run: `cd services/api && uv run pytest -q tests/test_script_import_api.py tests/test_script_import_parsing.py tests/test_script_import_confirmation.py tests/test_script_generation_stream.py`

Expected: all tests pass, including legacy mode compatibility.

- [ ] **Step 7: Commit parsing provenance**

```bash
git add services/api/comic_studio/services/script_imports.py services/api/comic_studio/routes/scripts.py services/api/comic_studio/routes/script_imports.py services/api/comic_studio/script_imports.py services/api/tests/test_script_import_parsing.py services/api/tests/test_script_import_confirmation.py services/api/tests/test_script_import_api.py
git commit -m "feat: trace episodes to script revisions"
```

### Task 6: Add Frontend Script Library API Contracts

**Files:**
- Modify: `apps/web/lib/types.ts`
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/tests/api.test.ts`
- Create: `apps/web/tests/script-library.test.tsx`

- [ ] **Step 1: Write failing client tests**

Mock `fetch` and assert exact paths, methods, multipart upload, optimistic checksum payloads, revision restore, delete conflict propagation, and SSE event decoding.

```typescript
await saveScript('script-1', {content:'第一集', expected_checksum:'abc'});
expect(fetchMock).toHaveBeenCalledWith(
  expect.stringContaining('/api/scripts/script-1'),
  expect.objectContaining({method:'PATCH', body:JSON.stringify({content:'第一集', expected_checksum:'abc'})}),
);
```

- [ ] **Step 2: Run frontend client tests and verify RED**

Run: `npm --workspace apps/web test -- --run tests/api.test.ts tests/script-library.test.tsx`

Expected: missing exported types and client functions.

- [ ] **Step 3: Add frontend types**

Define `ScriptDocumentSummary`, `ScriptDocument`, `ScriptRevision`, `ScriptSaveState`, `ScriptDeleteConflict`, and extend `ScriptImport` with nullable provenance fields. Match backend snake_case exactly at the API boundary.

- [ ] **Step 4: Add API functions**

Export `listScripts`, `createScript`, `uploadScript`, `getScript`, `patchScript`, `deleteScript`, `listScriptRevisions`, `restoreScriptRevision`, `parseScript`, and `streamScript`. Reuse `ApiError`; attach parsed conflict detail so the UI can show episode names.

- [ ] **Step 5: Run client tests and verify GREEN**

Run: `npm --workspace apps/web test -- --run tests/api.test.ts tests/script-library.test.tsx`

Expected: all focused tests pass.

- [ ] **Step 6: Commit frontend contracts**

```bash
git add apps/web/lib/types.ts apps/web/lib/api.ts apps/web/tests/api.test.ts apps/web/tests/script-library.test.tsx
git commit -m "feat: add script library web api"
```

### Task 7: Build the Two-Pane Library and Autosaving Editor

**Files:**
- Create: `apps/web/components/ScriptLibrary.tsx`
- Create: `apps/web/components/ScriptList.tsx`
- Create: `apps/web/components/ScriptEditor.tsx`
- Modify: `apps/web/components/Workspace.tsx`
- Modify: `apps/web/components/ScriptImportWorkspace.tsx`
- Modify: `apps/web/tests/script-library.test.tsx`
- Modify: `apps/web/tests/script-import.test.tsx`

- [ ] **Step 1: Write failing library and autosave component tests**

Cover empty state, ordered list, selection, immediate server creation, rename, 600ms debounced save, flush on selection change, saved/failed states, retry, revision conflict, stale response guard, delete success, and delete conflict episode links.

```typescript
await user.type(screen.getByLabelText('剧本正文'),'场景一');
expect(screen.getByText('正在保存')).toBeVisible();
await vi.advanceTimersByTimeAsync(600);
await waitFor(()=>expect(mocks.patchScript).toHaveBeenCalledWith(
  'script-1', expect.objectContaining({expected_checksum:'old-checksum'})
));
expect(await screen.findByText('已保存')).toBeVisible();
```

- [ ] **Step 2: Run component tests and verify RED**

Run: `npm --workspace apps/web test -- --run tests/script-library.test.tsx tests/script-import.test.tsx`

Expected: new components are missing.

- [ ] **Step 3: Implement library orchestration**

`ScriptLibrary` owns list/detail loading, selected ID, request generations, creation, deletion, local recovery prompt, and parse-preview state. It passes narrow callbacks and data to child components instead of moving script state into `Workspace`.

- [ ] **Step 4: Implement list and editor controls**

Use lucide icons for add, upload, history, rename, delete, retry, stop, and parse. Keep visible commands compact. `ScriptEditor` maintains an editor buffer plus the server checksum token; it never changes the displayed save state to `saved` until the API response returns.

Autosave behavior:

```typescript
useEffect(()=>{
  if (buffer === serverContent) return;
  setSaveState('saving');
  const timer = window.setTimeout(()=>void save(buffer), 600);
  return ()=>window.clearTimeout(timer);
}, [buffer, serverContent, save]);
```

Use a ref-backed `flushPendingSave()` before selecting another document or starting parse.

- [ ] **Step 5: Adapt structured preview to a selected import**

Refactor `ScriptImportWorkspace` so source creation controls move into `ScriptLibrary`, while preview/edit/save/confirm can render for a supplied `ScriptImport`. Preserve legacy tests through a small compatibility wrapper only if another route still calls the old component contract.

- [ ] **Step 6: Run component tests and verify GREEN**

Run: `npm --workspace apps/web test -- --run tests/script-library.test.tsx tests/script-import.test.tsx tests/workspace.test.tsx`

Expected: all focused tests pass.

- [ ] **Step 7: Commit library UI**

```bash
git add apps/web/components/ScriptLibrary.tsx apps/web/components/ScriptList.tsx apps/web/components/ScriptEditor.tsx apps/web/components/Workspace.tsx apps/web/components/ScriptImportWorkspace.tsx apps/web/tests/script-library.test.tsx apps/web/tests/script-import.test.tsx
git commit -m "feat: add persistent script library workspace"
```

### Task 8: Add Streaming, Upload, Revision History, and Local Recovery UI

**Files:**
- Modify: `apps/web/components/ScriptLibrary.tsx`
- Modify: `apps/web/components/ScriptEditor.tsx`
- Create: `apps/web/components/ScriptRevisionPanel.tsx`
- Modify: `apps/web/tests/script-library.test.tsx`

- [ ] **Step 1: Write failing interaction tests**

Cover incremental chunks, persisted positions, stop, continue, provider failure with partial text, upload appearing immediately, history ordering, preview, restore confirmation, restore refresh, stale parse warning, and one-time `localStorage` recovery.

```typescript
localStorage.setItem('ai-comic-script-draft:p1', JSON.stringify({brief:'三集', draft:'第一集'}));
render(<ScriptLibrary projectId="p1" onConfirmed={vi.fn()}/>);
await user.click(await screen.findByRole('button',{name:'恢复为剧本'}));
expect(mocks.createScript).toHaveBeenCalledWith('p1', expect.objectContaining({content:'第一集'}));
expect(localStorage.getItem('ai-comic-script-draft:p1')).toBeNull();
```

- [ ] **Step 2: Run interaction tests and verify RED**

Run: `npm --workspace apps/web test -- --run tests/script-library.test.tsx`

Expected: streaming/history/recovery controls are missing.

- [ ] **Step 3: Wire streaming to the server-backed document**

Append chunks only for the active script/request generation. Update checksum/detail from persisted events or reload after completion. Stop aborts the request but keeps the buffer. Continue sends the active revision ID; a stale response cannot append after project/script selection changes.

- [ ] **Step 4: Add upload and revision panel**

Upload creates and selects the returned document. `ScriptRevisionPanel` is a modal or side panel with a stable list; restoring requires confirmation and returns focus to the trigger. Do not nest history cards inside the editor surface.

- [ ] **Step 5: Add explicit local-draft recovery**

Offer recovery only when the project key exists and no server document has identical content checksum. Remove the local key only after successful server creation; dismissing leaves it intact for the next visit.

- [ ] **Step 6: Run interaction tests and verify GREEN**

Run: `npm --workspace apps/web test -- --run tests/script-library.test.tsx tests/script-import.test.tsx`

Expected: all tests pass.

- [ ] **Step 7: Commit advanced script interactions**

```bash
git add apps/web/components/ScriptLibrary.tsx apps/web/components/ScriptEditor.tsx apps/web/components/ScriptRevisionPanel.tsx apps/web/tests/script-library.test.tsx
git commit -m "feat: add script revisions and stream recovery"
```

### Task 9: Finish Responsive Studio Styling and End-to-End Flow

**Files:**
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/e2e/production-flow.spec.ts`
- Modify: `apps/web/tests/script-library.test.tsx`

- [ ] **Step 1: Add failing structural/style and browser tests**

Assert a bounded two-column desktop layout, stable toolbar/editor dimensions, narrow-screen list-to-editor transition, no white-on-white destructive text, and the full create-save-reload-parse-confirm-provenance-restore flow.

```typescript
await page.getByRole('button',{name:'新建剧本'}).click();
await page.getByLabel('剧本正文').fill('第一集：雨夜\n场景一');
await expect(page.getByText('已保存')).toBeVisible();
await page.reload();
await expect(page.getByLabel('剧本正文')).toHaveValue(/第一集：雨夜/);
```

- [ ] **Step 2: Run E2E and verify RED**

Run: `npm --workspace apps/web run test:e2e -- --grep "script library"`

Expected: the new browser scenario fails before final styling and route mocks are complete.

- [ ] **Step 3: Add responsive styles**

Desktop uses a fixed `minmax(220px, 280px)` script rail and `minmax(0, 1fr)` editor. Mobile shows one surface at a time with a back icon. Use `min-width: 0`, fixed icon-button dimensions, textarea `resize: vertical`, and explicit overflow containers. Cards remain at or below 8px radius and no page section becomes a decorative floating card.

- [ ] **Step 4: Complete Playwright route fixtures and assertions**

Mock every new API path deterministically, record save/parse/confirm requests, and test desktop plus mobile projects. Verify source remains unchanged after parsing and provenance links select the generated episode.

- [ ] **Step 5: Run frontend unit, E2E, and build checks**

Run: `npm --workspace apps/web test`

Expected: all Vitest tests pass.

Run: `npm --workspace apps/web run test:e2e`

Expected: all Playwright tests pass.

Run: `npm --workspace apps/web run build`

Expected: Next.js production build succeeds with no type errors.

- [ ] **Step 6: Commit UI completion**

```bash
git add apps/web/app/globals.css apps/web/e2e/production-flow.spec.ts apps/web/tests/script-library.test.tsx
git commit -m "feat: complete script library experience"
```

### Task 10: Verify Release and Bump to v0.5.0

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `apps/web/package.json`
- Modify: `services/api/pyproject.toml`
- Modify: `services/api/uv.lock`
- Create: `docs/release-audits/2026-07-12-v0.5.0.md`

- [ ] **Step 1: Run the complete backend suite before version changes**

Run: `cd services/api && uv run pytest -q`

Expected: all API tests pass.

- [ ] **Step 2: Run complete workspace tests and build**

Run: `npm test`

Expected: all workspace tests pass.

Run: `npm run build`

Expected: all workspace builds pass.

- [ ] **Step 3: Run dependency audits**

Run: `npm audit --omit=dev`

Expected: no high or critical production vulnerabilities.

Run: `cd services/api && uv export --no-dev --format requirements-txt --no-hashes | uv run --with pip-audit pip-audit -r /dev/stdin`

Expected: no known vulnerabilities, or exact upstream findings documented without suppressing them.

- [ ] **Step 4: Bump versions to 0.5.0**

Use package-manager commands so lockfiles stay consistent:

```bash
npm version 0.5.0 --no-git-tag-version
npm --workspace apps/web version 0.5.0 --no-git-tag-version
cd services/api && uv version 0.5.0
```

- [ ] **Step 5: Re-run migration, tests, and builds after version changes**

Run: `cd services/api && uv run alembic upgrade head && uv run pytest -q`

Expected: migration succeeds against the worktree database and all API tests pass.

Run: `npm test && npm run build`

Expected: all frontend/compositor tests and builds pass.

- [ ] **Step 6: Write release audit with exact evidence**

Record commit, migration revision, test counts, build results, audit results, manual browser URL, and these known limits: no legacy import auto-promotion, no collaborative editing, no provenance detach command, no infinite canvas.

- [ ] **Step 7: Review diff and commit release metadata**

Run: `git diff --check && git status --short && git diff --stat`

Expected: no whitespace errors and only intended files changed.

```bash
git add package.json package-lock.json apps/web/package.json services/api/pyproject.toml services/api/uv.lock docs/release-audits/2026-07-12-v0.5.0.md
git commit -m "chore: release v0.5.0"
```

### Task 11: Final Runtime Verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Start the isolated worktree services**

Run: `./scripts/dev.sh`

Expected: API and Web start on available local ports without modifying the existing dirty `ui-redesign` runtime.

- [ ] **Step 2: Verify the real browser workflow**

Using Playwright against the running services, create an actual local project/script, save and reload it, run AI generation with the configured provider, parse manually, confirm one episode, return to the script, and restore a prior revision. Do not use production credentials in screenshots or logs.

- [ ] **Step 3: Inspect persisted state**

Verify the SQLite document/revision/import/provenance rows and retained upload path under the worktree `data_root`. Confirm all paths remain inside the configured project directory and no API response exposes an absolute path.

- [ ] **Step 4: Record final verification and branch state**

Append runtime ports and outcomes to the release audit, run `git diff --check`, and commit only if the audit changed.

```bash
git add docs/release-audits/2026-07-12-v0.5.0.md
git commit -m "docs: record v0.5.0 runtime verification"
```
