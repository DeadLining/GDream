# Script Library Design

## Goal

Version `v0.5.0` turns script creation from a temporary form into a persistent project asset workflow. AI-generated, pasted, and uploaded scripts are saved before parsing, remain editable after parsing, keep revision history, and retain a traceable relationship to the episodes created from them.

This release focuses on the script source of truth. Infinite canvas, 3D directing, cross-project asset libraries, and collaborative editing remain out of scope.

## Product Decisions

- A script is a project-level asset, not a one-time import task.
- Source text and structured parse results are separate records. Parsing never overwrites source text.
- Every completed generation, upload, restore, parse checkpoint, or closed editing session finalizes a revision; the document points at the current working or finalized revision.
- AI generation writes streamed text into a server-backed draft as chunks arrive, while local storage remains only a recovery fallback.
- Uploaded TXT, DOCX, and PDF files are retained under the configured project data root.
- Confirming a parse creates episodes and records exactly which script revision and import produced each episode.
- Restoring an old revision creates a new current revision with the restored content. Revision history is append-only.
- Deleting a script is blocked while it is the recorded source of existing episodes. The user must delete those episodes or detach provenance explicitly in a later feature.

## User Experience

### Script Library

The existing `剧本创作` work area becomes a two-pane script workspace:

- the left pane lists project scripts with title, source type, current state, updated time, and revision count;
- the main pane edits the selected script and exposes AI generation, upload, parse, revision history, rename, and delete commands;
- `新建剧本` starts with AI generation or automatic recognition without leaving the workspace.

The list is ordered by most recently updated. Empty projects show one direct creation action instead of an empty dashboard.

### Save States

Text edits use debounced autosave against one working revision and show one of `正在保存`, `已保存`, or `保存失败`. Parsing, restoring, or leaving the editing session finalizes that revision. A later edit starts a new working revision, so keystrokes do not create hundreds of history entries. Navigating to another script flushes and finalizes a pending save first. Failed saves keep the editor content and provide retry; they never pretend that local text reached the server.

AI streaming creates a document and initial revision before the provider request begins. Received chunks update a mutable stream buffer on the current revision through throttled saves. Successful completion finalizes that revision. Stopping or disconnecting preserves the received text and marks the document as `draft` or `generation_failed`, so it can be reopened and continued.

### Parse And Import

`解析并预览` always parses the selected current revision. The parse result is an independent `ScriptImport` linked to that revision. A newer source edit does not mutate an older preview; the UI marks that preview as stale and asks the user to parse the latest revision.

The editable preview remains the confirmation boundary. Only `确认导入` writes characters, episodes, scenes, shots, and dialogue. After confirmation, the script remains in the library and shows links to the generated episodes.

### Revision History

The history panel shows revision number, creation method, timestamp, text size, and parse/import state. The user may preview any revision and restore it. Restore copies the selected content into a new revision, preserving all intervening history and provenance.

## Architecture

The feature adds a durable script domain above the existing parse/import domain:

```text
Project
  -> ScriptDocument
       -> ScriptRevision (immutable source snapshots)
            -> ScriptImport (structured parse attempts)
                 -> ScriptImportEpisode -> Episode
```

`ScriptDocument` owns user-facing identity and current state. `ScriptRevision` owns source content and optional retained upload metadata. A working revision may be autosaved in place; once finalized it is immutable. `ScriptImport` continues to own parsing status, editable structured draft, and confirmation state. `ScriptImportEpisode` records confirmed episode provenance without coupling episode deletion to revision deletion.

Services are separated by responsibility:

- `ScriptDocumentService`: create, list, rename, autosave, restore, and delete documents;
- `ScriptFileStore`: validate and persist uploaded originals below `data/projects/{project_id}/scripts/{document_id}/`;
- `ScriptGenerationService`: stream provider output and persist partial progress;
- existing parser and confirmation services: accept a revision source and write structured project records;
- repository/API serializers: expose stable document, revision, and import contracts.

## Data Model

### ScriptDocument

- `id`, `project_id`, `title`
- `source_type`: `ai`, `paste`, or `upload`
- `status`: `draft`, `generating`, `generation_failed`, `ready`, or `archived`
- `current_revision_id`
- `created_at`, `updated_at`

`current_revision_id` is nullable only during the transaction that creates a document. Titles are user-editable and default from the uploaded filename, generated heading, or `未命名剧本`.

### ScriptRevision

- `id`, `document_id`, `revision_number`
- `content`, `checksum`, `creation_method`, `status`: `working` or `finalized`
- `original_filename`, `source_file_path`, `source_media_type`
- `generation_brief`, `generation_metadata`
- `created_at`

The pair `(document_id, revision_number)` is unique, and each document may have at most one `working` revision. Working revisions support optimistic autosave; finalized revisions reject source mutation. `source_file_path` stores a data-root-relative path, never an arbitrary absolute path. Upload bytes are written atomically, size-limited by the existing extraction boundary, and checksum-verified before the database transaction commits.

### ScriptImport Changes

- add nullable `script_revision_id` for backward compatibility;
- keep `extracted_text` as the immutable parse input snapshot for historical imports;
- keep parse status, errors, structured draft, and application timestamp;
- legacy imports remain readable but are not automatically promoted into library documents in `v0.5.0`.

### ScriptImportEpisode

- `script_import_id`, `episode_id`, `draft_episode_id`, `created_at`
- unique constraints on `(script_import_id, episode_id)` and `episode_id`

The association is created in the same transaction as confirmation. Deleting an episode cascades only its association. Deleting an unreferenced, unapplied script document cascades revisions, imports, and retained source files through an explicit service cleanup.

## API Design

Project-scoped document endpoints:

- `GET /api/projects/{project_id}/scripts`
- `POST /api/projects/{project_id}/scripts`
- `POST /api/projects/{project_id}/scripts/upload`
- `GET /api/scripts/{script_id}`
- `PATCH /api/scripts/{script_id}` for title and source autosave
- `DELETE /api/scripts/{script_id}`
- `GET /api/scripts/{script_id}/revisions`
- `POST /api/scripts/{script_id}/revisions/{revision_id}/restore`
- `POST /api/scripts/{script_id}/generation/stream`
- `POST /api/scripts/{script_id}/parse`

The streaming endpoint uses SSE as today, but each event also carries the persisted revision identifier and save position. The final event reports the finalized document and revision. Client reconnect/continue requests send the current revision identifier rather than resubmitting untrusted full project state.

Existing `script-imports` read, draft update, retry, and confirm endpoints remain available. New parses populate `script_revision_id`; old clients and existing records continue to work.

Mutation endpoints validate that the script belongs to the route project or selected workspace. Autosave uses an expected revision/checksum token and returns `409 revision_conflict` instead of silently overwriting a newer save.

## Migration And Compatibility

An Alembic migration creates the three new tables and adds `script_revision_id` to `script_imports`. SQLite foreign-key behavior and downgrade paths are covered by migration tests.

Existing `ScriptImport` records remain untouched. Existing browser local drafts are offered once for recovery: when a project has a local AI draft and no matching server document, the UI offers `恢复为剧本`; it does not upload silently. After successful recovery, the local key is removed.

No provider channel schema changes are required. Generation and parsing continue to use the configured script-planning LLM.

## Error Handling And Safety

- Upload filenames are normalized for display only; storage paths are generated IDs and checked to remain under `data_root`.
- TXT, DOCX, and PDF extraction limits remain enforced before persistence.
- A failed file write leaves no database record; a failed database commit removes the newly written file.
- Provider failures preserve partial generated text and expose a retry/continue action.
- Parse failures preserve the revision and any previous successful parse.
- Revision conflicts return the latest server revision so the UI can offer reload or save as a new revision.
- Delete returns a conflict with referencing episode summaries when provenance exists.
- API errors redact provider credentials and internal filesystem paths.

## Testing

Backend coverage includes:

- model constraints, migration upgrade/downgrade, and cascade behavior;
- document CRUD, ordered lists, revision numbering, restore, and conflict detection;
- TXT/DOCX/PDF persistence, path containment, checksum verification, and cleanup on failure;
- partial AI stream persistence, stop, failure, continue, and finalization;
- parsing a specific revision without modifying its source;
- atomic confirmation and episode provenance;
- deletion blocked by referenced episodes and allowed for unreferenced documents;
- legacy import compatibility and error redaction.

Frontend coverage includes:

- empty, loading, saving, saved, failed, conflict, streaming, stale preview, and delete-conflict states;
- project switching without cross-project draft leakage;
- reopen/edit/rename/delete and revision restore flows;
- uploaded source and AI generation appearing immediately in the library;
- manual parse and confirmation navigation to generated episodes;
- one-time local draft recovery;
- responsive two-pane behavior with a drawer/list transition on narrow screens.

Playwright verifies the complete path: create or upload a script, autosave, reload, parse, confirm, open a generated episode, return to the source script, restore a prior revision, and observe provenance without layout overlap at desktop and mobile widths.

## Acceptance Criteria

- AI-generated, pasted, and uploaded script content survives reload and application restart.
- Every script is visible in a project-level library and can be reopened, renamed, edited, and versioned.
- Autosave truthfully reports server persistence and never silently loses a newer revision.
- Original upload files are retained inside the configured project data directory.
- Parsing creates a linked structured draft without overwriting source content.
- Confirmed episodes identify their source script revision and import.
- Revision restore is non-destructive and creates a new revision.
- Referenced scripts cannot be deleted accidentally.
- Existing one-time imports and provider configuration continue to work.
- API, component, and end-to-end suites cover the new workflow before release `v0.5.0`.
