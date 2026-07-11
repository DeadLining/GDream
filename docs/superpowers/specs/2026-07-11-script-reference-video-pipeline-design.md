# Script Import, Character Reference, And Image-To-Video Pipeline Design

## Goal

Extend AI Comic Studio from an outline-to-static-comic workflow into a production pipeline that can:

1. import complete scripts or prose from pasted text, TXT, DOCX, and PDF;
2. preview and confirm structured characters, episodes, scenes, shots, and dialogue;
3. manage immutable character reference images and active reference versions;
4. use approved character references when generating comic panels;
5. generate, review, version, and batch-produce image-to-video clips;
6. render an episode from generated video clips with static-panel fallback.

The application remains a local single-user Web application backed by SQLite and local asset files.

## Delivery Order

The feature is delivered in three dependent phases:

```text
Script import and preview
  -> confirmed project graph
Character reference assets
  -> reference-aware panel generation
Image-to-video channel and production stage
  -> video-aware episode rendering
```

Each phase remains usable before the next phase is complete.

## 1. Script Import

### Supported Inputs

- pasted UTF-8 text;
- `.txt`, with charset detection and UTF-8 normalization;
- `.docx`, using paragraph and table text extraction;
- text-based `.pdf`, using page-order extraction;
- maximum source size of 20 MiB.

Scanned PDFs without extractable text are rejected with an actionable `ocr_required` error. OCR is not silently attempted because it would add a large local runtime and uncertain text quality.

### Import Modes

- `screenplay`: preserve supplied scene and dialogue structure where present;
- `prose`: treat the source as a novel or story and generate episode/script structure;
- `auto`: classify the source, then use one of the above modes.

### Safety Boundary

Import is a two-stage operation:

```text
upload/paste -> extract -> AI structure -> preview/edit -> confirm -> database apply
```

Parsing never writes Characters, Episodes, Scenes, Shots, or DialogueLines directly. It creates a persisted import draft that the user reviews first.

### ScriptImport Model

Add `ScriptImport`:

- `id`, `project_id`;
- `status`: `uploaded`, `parsing`, `ready`, `applying`, `applied`, `failed`;
- `mode`: `auto`, `screenplay`, `prose`;
- `source_format`: `paste`, `txt`, `docx`, `pdf`;
- original filename, checksum, extracted text, structured draft JSON;
- sanitized error, created/updated/applied timestamps.

Only one parsing/applying operation runs for one import at a time. Interrupted `parsing` or `applying` imports recover to `failed` with a retryable interruption category on API startup.

### Structured Draft

The strict draft contains:

- project metadata suggestions;
- characters with stable draft IDs, aliases, visual descriptions, personality, continuity, voice instructions;
- episodes with title, premise, target duration;
- ordered scenes, shots, and dialogue;
- warnings for unresolved speakers, duplicate names, duration overflow, or empty scenes.

Dialogue references draft character IDs, not invented database IDs.

### Confirmation Semantics

Confirmation is transactional:

- merge characters by normalized name or explicit user mapping;
- create missing characters;
- append new episodes in draft order;
- never overwrite an existing episode automatically;
- map every dialogue line to a real Character ID or `null` when explicitly marked narration;
- roll back the entire apply if any graph node fails validation.

The user can disable individual draft episodes before confirmation. Reconfirming an applied import returns HTTP 409.

### Import API

```text
POST   /api/projects/{project_id}/script-imports
GET    /api/script-imports/{import_id}
POST   /api/script-imports/{import_id}/parse
PATCH  /api/script-imports/{import_id}/draft
POST   /api/script-imports/{import_id}/confirm
POST   /api/script-imports/{import_id}/retry
```

The create endpoint accepts multipart upload or JSON pasted text through distinct content types, not base64 embedded in JSON.

### Planning Provider

Extend the LLM planning protocol with `parse_script_import(context)`. The context includes source mode, normalized text, project style, existing character names, desired episode duration, and the strict output schema.

The provider gets one validation-repair attempt. Schema-invalid responses fail the import without mutating the project.

## 2. Character Reference Assets

### Model

Add `CharacterReference` as a relationship between Character and immutable Asset:

- `id`, `character_id`, `asset_id`;
- `reference_type`: `primary`, `front`, `three_quarter`, `side`, `back`, `expression`, `outfit`;
- label and position;
- `is_active`;
- review status: `draft`, `needs_changes`, `approved`;
- created timestamp.

The Asset stores bytes, checksum, provider, model, dimensions, prompt metadata, and optional parent asset. Activating a reference never deletes an older version.

There may be one active reference per character and reference type. Service-level transactions enforce this consistently in SQLite.

### Upload And Generation

Users can:

- upload PNG, JPEG, or WebP up to 15 MiB;
- generate a primary/front reference from the character appearance bible;
- generate side/back/expression/outfit variants from an approved primary reference;
- approve, request changes, activate, deactivate, and label versions.

Uploaded files are decoded and validated before storage. Dimensions and media type come from decoded content, not request headers.

### Image Provider Reference Support

Extend the image-provider protocol:

```python
generate(prompt, size, quality) -> ImageResult
edit(prompt, references, size, quality) -> ImageResult
```

`GPTImageProvider.edit()` uses the configured endpoint's OpenAI-compatible `/v1/images/edits` multipart contract. When references exist, panel generation must use `edit`; it must not silently fall back to text-only generation because that would violate character consistency.

If a configured endpoint does not support edits, the item fails with a sanitized `reference_edit_unsupported` category.

### Reference-Aware Panel Generation

Panel generation loads active approved references for characters actually present in the shot. Presence comes from dialogue Character IDs plus `shot.character_state` character IDs.

The request uses:

- primary/front reference first;
- current outfit reference when present;
- at most four reference files per request;
- text continuity rules and negative constraints.

The Asset request metadata stores reference Asset IDs, never raw bytes or secrets.

### Character Reference API

```text
GET    /api/characters/{character_id}/references
POST   /api/characters/{character_id}/references/upload
POST   /api/characters/{character_id}/references/generate
PATCH  /api/character-references/{reference_id}
PUT    /api/characters/{character_id}/references/{reference_id}/active
DELETE /api/character-references/{reference_id}
```

DELETE removes only the relationship and local file when no other record references the Asset. Active references must be deactivated or replaced first.

### Character UI

Add a real `角色设定` workspace:

- character list and editor;
- reference-type segmented filter;
- stable image grid with active/approved status;
- upload and generate commands;
- comparison and activation;
- exact warnings when a speaking character lacks an approved primary reference.

## 3. Image-To-Video

### Provider Channel

Add a fourth fixed provider-channel kind: `video`.

Default environment bootstrap:

```text
MINIMAX_VIDEO_BASE_URL=https://api.minimaxi.com
MINIMAX_VIDEO_MODEL=MiniMax-Hailuo-02
MINIMAX_VIDEO_API_KEY=<blank or shared configured key>
```

The saved local provider-channel JSON becomes authoritative after the first UI save, consistent with existing LLM/image/TTS behavior.

The settings workspace adds `视频生成` with enabled, name, Base URL, model, masked key, save, and connection test.

### Video Provider

Create `MiniMaxVideoProvider` with an injected HTTP client and explicit asynchronous task protocol:

```python
submit_image_to_video(prompt, image_bytes, image_media_type, duration) -> task_id
get_task(task_id) -> queued | processing | succeeded | failed
download_result(task) -> VideoResult
```

The adapter targets the configured MiniMax video-generation API and keeps endpoint paths in one provider module. It validates returned MP4 bytes and sanitizes provider errors.

Connection testing checks authenticated model/endpoint reachability without generating a video when possible. If the provider has no free capability endpoint, it reports `check_scope: endpoint` rather than spending credits.

### Shot And Asset Model

Extend Shot with:

- `video_prompt`;
- `negative_video_prompt`;
- `active_video_asset_id`;
- `video_render_status`.

Video versions remain immutable Assets with:

- `kind = video:{shot_id}`;
- `media_type = video/mp4`;
- parent Asset ID set to the source panel;
- provider task ID, prompt, duration, source panel ID, and model in request metadata;
- probed width, height, duration, and codec.

### Video Generation Rules

A shot is eligible when:

- it has an active panel;
- the panel/shot is approved;
- it has no active video, or regeneration is requested.

The provider input uses the approved active panel as first frame. Prompt composition combines scene summary, shot composition, camera motion, character action, `video_prompt`, and negative constraints.

The generated clip duration defaults to the shot duration and is clamped to provider-supported values. The resulting Asset is activated only when requested; generation does not imply review approval.

### Batch Production

Extend production stages:

```text
panels | speech | videos
```

Add `regenerate_videos`. Video items use `stage = video`, target the Shot, and run through the existing bounded coordinator.

Video provider tasks may outlive one HTTP request, but coordinator execution owns submit/poll/download within one item attempt. Pause prevents new video items; running provider tasks finish or fail normally. Startup interruption returns running video items to queued and the run to paused, consistent with existing recovery.

Item metadata stores the provider task ID so retry diagnostics remain inspectable. Errors and remote URLs are sanitized before persistence.

### Video API

```text
POST /api/shots/{shot_id}/videos
GET  /api/shots/{shot_id}/videos
PUT  /api/shots/{shot_id}/videos/{asset_id}/active
```

The single-shot route uses the existing Job contract. Batch generation uses ProductionRun.

### Readiness

Extend readiness with video coverage:

- ready video count;
- `missing_videos` shot IDs;
- video-generation eligibility blockers.

Video coverage does not make static rendering invalid. Existing `ready` continues to mean panel, approval, and speech readiness. Add `video_ready` to indicate every shot has an active approved video.

The UI distinguishes:

- `静态成片可渲染`;
- `动态成片可渲染`;
- `缺少视频 N`.

### Inspector And Production UI

Inspector adds `视频生成` after panel versions:

- video prompt and negative prompt;
- source panel indicator;
- generate command;
- video versions with playback, metadata, activation, and review state.

Production adds the video stage checkbox, regeneration toggle, video counters, filters, and item icons without changing pause/retry semantics.

## 4. Video-Aware Composition

Extend the compositor manifest Shot:

- `videoPath?: string`;
- `panelPath` remains required as fallback;
- `videoDurationSeconds?: number`.

When `videoPath` exists, Remotion uses `<Video muted>` fitted to the full frame. Dialogue audio, subtitles, and any additional soundtrack remain separate layers. When no active video exists, the current panel motion treatment remains unchanged.

The render-manifest service copies active video files into the compositor job bundle and validates codec/duration with ffprobe. A broken active video fails manifest creation with an exact blocker rather than silently falling back.

## 5. Data Migration

The project currently creates schema through SQLAlchemy metadata and has no migration framework. Introduce Alembic before adding these tables/columns.

Migration sequence:

1. establish an Alembic baseline for the current schema;
2. add ScriptImport and CharacterReference;
3. add Shot video fields;
4. preserve all existing SQLite data.

Fresh databases still initialize through migrations. Tests use isolated migrated SQLite databases.

## 6. Error Handling And Security

- Reject unsupported file extensions, oversize uploads, archives, and empty extraction.
- Normalize filenames and never use them as filesystem paths.
- Do not render imported HTML or PDF markup in the browser.
- Recursively redact provider errors and request metadata.
- Never store API keys in SQLite, jobs, imports, assets, browser storage, URLs, or process arguments.
- Validate decoded image and video content.
- Prevent asset paths from escaping the data root.
- Preserve the previous import draft, active reference, panel, or video when a replacement operation fails.

## 7. Testing

### Script Import

- pasted/TXT/DOCX/PDF extraction;
- invalid extension, oversize file, scanned PDF, malformed DOCX;
- strict LLM draft validation and one repair;
- preview edit validation;
- transactional confirmation and rollback;
- character merge and dialogue mapping;
- interrupted import recovery;
- no graph mutation before confirmation.

### Character References

- upload validation and path safety;
- generated primary and reference-based variants;
- one active version per type;
- immutable version history;
- reference-aware panel provider request;
- unsupported edit endpoint failure;
- no silent text-only fallback.

### Video

- provider submit/poll/download and sanitized failures;
- video channel persistence, redaction, hot reload, and connection test;
- single-shot job and batch stage;
- eligibility, skip, retry, pause, recovery, and concurrency;
- MP4 validation and metadata;
- readiness static/video distinction;
- compositor video-first and panel fallback behavior.

### End-To-End

1. import a DOCX fixture;
2. preview characters and two episodes;
3. confirm the import;
4. upload or generate a character primary reference;
5. generate a reference-aware panel;
6. generate a video clip;
7. batch retry one failed video;
8. render a mixed episode containing active video and static fallback shots.

## 8. Release Gates

The feature is complete when:

- all four source forms produce previewable imports;
- confirmation creates a correct graph without overwriting existing episodes;
- character references are versioned, reviewed, activated, and used by panel generation;
- the runtime-editable video channel drives real image-to-video generation;
- video production supports pause, recovery, concurrency, and retry;
- inspector and production UI expose video versions and state;
- mixed video/static rendering produces a verified H.264/AAC MP4;
- existing projects and v0.3 production runs remain valid;
- API, Web, compositor, migrations, E2E, security audit, and live provider smoke pass.

## Non-Goals

- OCR for scanned PDFs in the first release;
- arbitrary visual node graphs;
- automatic publishing to short-drama platforms;
- multi-user permissions or cloud collaboration;
- training custom image or video models;
- lip-sync replacement beyond existing dialogue audio and subtitles.
