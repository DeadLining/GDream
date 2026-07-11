# Script Import, Character Reference, And Image-To-Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a local production workflow that imports scripts, maintains approved character references, generates reference-aware panels and image-to-video clips, and renders mixed static/video episodes.

**Architecture:** Add Alembic-managed SQLite schema evolution, focused domain services for imports/references/videos, and extend the existing provider-channel, Job, ProductionRun, readiness, and Remotion boundaries. All generated assets remain immutable; active links, review state, and transactional confirmation control what enters production.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2, Alembic, Pydantic, HTTPX, Pillow, python-docx, pypdf, charset-normalizer, React 19, Next.js 16, Vitest, Playwright, Remotion, FFmpeg/ffprobe.

---

### Task 1: Alembic Baseline And Additive Schema

**Files:**
- Create: `services/api/alembic.ini`
- Create: `services/api/alembic/env.py`
- Create: `services/api/alembic/versions/20260711_01_baseline.py`
- Create: `services/api/alembic/versions/20260711_02_import_reference_video.py`
- Modify: `services/api/comic_studio/db.py`
- Modify: `services/api/comic_studio/models.py`
- Modify: `services/api/comic_studio/main.py`
- Modify: `services/api/pyproject.toml`
- Test: `services/api/tests/test_migrations.py`

- [ ] Write migration tests that create the legacy v0.3 schema with sample rows, run `upgrade head`, and assert the rows plus new tables and columns survive.
- [ ] Run `uv run pytest tests/test_migrations.py -q` and confirm it fails because no Alembic runner exists.
- [ ] Add Alembic configuration, a stamped baseline strategy for populated legacy databases, additive models for `ScriptImport` and `CharacterReference`, Shot video fields, and `ProductionRun.regenerate_videos`.
- [ ] Replace `create_all` startup with an idempotent migration runner while keeping isolated test database setup deterministic.
- [ ] Run the migration test and the full API suite, then commit `feat: add managed database migrations`.

### Task 2: Script Source Extraction

**Files:**
- Create: `services/api/comic_studio/services/script_extraction.py`
- Modify: `services/api/pyproject.toml`
- Test: `services/api/tests/test_script_extraction.py`
- Test fixtures: `services/api/tests/fixtures/script-imports/`

- [ ] Write tests for pasted text, UTF-8 and GB18030 TXT, DOCX paragraphs/tables, text PDF, scanned PDF, malformed documents, unsupported extension, empty content, and 20 MiB limit.
- [ ] Run the focused tests and confirm the expected missing-service failure.
- [ ] Implement decoded-content validation returning normalized text, source format, filename, and checksum; return stable `unsupported_format`, `source_too_large`, `empty_source`, `malformed_document`, and `ocr_required` errors.
- [ ] Run focused and API tests, then commit `feat: extract supported script sources`.

### Task 3: Strict Script Import Draft Parsing

**Files:**
- Create: `services/api/comic_studio/script_imports.py`
- Modify: `services/api/comic_studio/providers/minimax.py`
- Modify: `services/api/comic_studio/providers/base.py`
- Test: `services/api/tests/test_script_import_parsing.py`
- Test: `services/api/tests/providers/test_minimax.py`

- [ ] Write tests for the strict draft schema, auto/screenplay/prose contexts, existing-character context, one validation repair, sanitized provider failures, and no graph mutation.
- [ ] Run focused tests and confirm missing parser/protocol failures.
- [ ] Implement Pydantic draft models and `parse_script_import(context)` using MiniMax structured JSON with exactly one repair request.
- [ ] Persist `ready` or sanitized `failed` import state without touching project graph rows.
- [ ] Run focused and API tests, then commit `feat: parse script import drafts`.

### Task 4: Script Import API And Transactional Confirmation

**Files:**
- Create: `services/api/comic_studio/routes/script_imports.py`
- Create: `services/api/comic_studio/services/script_imports.py`
- Modify: `services/api/comic_studio/main.py`
- Modify: `services/api/comic_studio/schemas.py`
- Test: `services/api/tests/test_script_import_api.py`
- Test: `services/api/tests/test_script_import_confirmation.py`

- [ ] Write route tests for JSON paste and multipart upload, parse/retry, draft patch validation, and startup interruption recovery.
- [ ] Write confirmation tests for normalized-name merge, explicit mappings, disabled episodes, append-only ordering, narration, unresolved speaker rejection, rollback, and applied-import 409.
- [ ] Run focused tests and verify the new routes fail as absent.
- [ ] Implement repository/service transactions and all six import endpoints with sanitized errors.
- [ ] Run focused and API tests, then commit `feat: add transactional script imports`.

### Task 5: Script Import Workspace

**Files:**
- Create: `apps/web/components/ScriptImportWorkspace.tsx`
- Create: `apps/web/components/ScriptImportPreview.tsx`
- Modify: `apps/web/components/Workspace.tsx`
- Modify: `apps/web/components/WorkspaceTabs.tsx`
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/lib/types.ts`
- Modify: `apps/web/app/globals.css`
- Test: `apps/web/tests/script-import.test.tsx`
- E2E: `apps/web/e2e/script-import.spec.ts`

- [ ] Write UI tests for paste/upload, mode selection, parsing state, editable preview, episode disable, validation errors, confirmation, and project reload.
- [ ] Run the focused Vitest file and verify it fails because the workspace is absent.
- [ ] Implement the import workspace using native file input, segmented mode control, structured preview editor, and explicit confirmation.
- [ ] Run Vitest, build, and the import E2E test; commit `feat: add script import workspace`.

### Task 6: Character Reference Storage And API

**Files:**
- Create: `services/api/comic_studio/services/character_references.py`
- Create: `services/api/comic_studio/routes/character_references.py`
- Modify: `services/api/comic_studio/assets.py`
- Modify: `services/api/comic_studio/main.py`
- Modify: `services/api/comic_studio/schemas.py`
- Test: `services/api/tests/test_character_references.py`

- [ ] Write tests for PNG/JPEG/WebP decoding, 15 MiB limit, path safety, immutable versions, review updates, one active reference per type, active delete rejection, and orphan cleanup.
- [ ] Run focused tests and confirm route/service absence.
- [ ] Generalize asset storage for validated images and add list/upload/update/activate/delete reference APIs.
- [ ] Run focused and API tests, then commit `feat: manage character reference assets`.

### Task 7: Reference-Aware GPT Image Generation

**Files:**
- Modify: `services/api/comic_studio/providers/gpt_image.py`
- Modify: `services/api/comic_studio/services/panels.py`
- Modify: `services/api/comic_studio/services/character_references.py`
- Test: `services/api/tests/providers/test_gpt_image.py`
- Test: `services/api/tests/test_panel_versions.py`
- Test: `services/api/tests/test_character_reference_generation.py`

- [ ] Write provider tests for `/v1/images/edits` multipart fields, multiple references, decoded results, and unsupported edit errors.
- [ ] Write service tests proving approved active references are ordered, capped at four, recorded by asset ID, and never silently replaced with text generation.
- [ ] Run focused tests and confirm the missing `edit` behavior.
- [ ] Implement `GPTImageProvider.edit`, generated reference variants, and reference-aware panel requests.
- [ ] Run focused and API tests, then commit `feat: generate panels from character references`.

### Task 8: Character Reference Workspace

**Files:**
- Create: `apps/web/components/CharacterWorkspace.tsx`
- Create: `apps/web/components/CharacterReferenceGrid.tsx`
- Modify: `apps/web/components/Workspace.tsx`
- Modify: `apps/web/components/WorkspaceTabs.tsx`
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/lib/types.ts`
- Modify: `apps/web/app/globals.css`
- Test: `apps/web/tests/character-references.test.tsx`
- E2E: `apps/web/e2e/character-references.spec.ts`

- [ ] Write UI tests for character selection/editing, type filtering, upload, generation, approval, activation, comparison, and missing-primary warning.
- [ ] Run the focused test and confirm the workspace is absent.
- [ ] Implement the stable reference grid and commands without nesting cards or resizing controls.
- [ ] Run Vitest, build, and E2E; commit `feat: add character reference workspace`.

### Task 9: Video Provider Channel And MiniMax Adapter

**Files:**
- Create: `services/api/comic_studio/providers/minimax_video.py`
- Modify: `services/api/comic_studio/config.py`
- Modify: `services/api/comic_studio/provider_channels.py`
- Modify: `services/api/comic_studio/provider_factory.py`
- Modify: `services/api/comic_studio/services/provider_channel_testing.py`
- Modify: `apps/web/components/ProviderSettings.tsx`
- Modify: `apps/web/lib/types.ts`
- Test: `services/api/tests/providers/test_minimax_video.py`
- Test: `services/api/tests/test_provider_channels_api.py`
- Test: `apps/web/tests/provider-settings.test.tsx`

- [ ] Write tests for video defaults/persistence/redaction/hot reload and submit/poll/download/error sanitization.
- [ ] Run focused tests and confirm `video` is rejected by current fixed channel schema.
- [ ] Add the fourth channel and implement the asynchronous MiniMax adapter with injectable HTTP client and validated MP4 result.
- [ ] Add endpoint-scope connection testing and the `视频生成` settings section.
- [ ] Run API and Web focused tests, then commit `feat: add configurable video provider`.

### Task 10: Shot Video Versions And Jobs

**Files:**
- Create: `services/api/comic_studio/services/videos.py`
- Create: `services/api/comic_studio/routes/videos.py`
- Modify: `services/api/comic_studio/assets.py`
- Modify: `services/api/comic_studio/jobs.py`
- Modify: `services/api/comic_studio/schemas.py`
- Modify: `services/api/comic_studio/main.py`
- Test: `services/api/tests/test_shot_videos.py`
- Test: `services/api/tests/test_video_jobs.py`

- [ ] Write tests for eligibility, prompt composition, duration clamp, MP4 probing, immutable versions, parent panel linkage, activation, failed replacement preservation, and retry metadata.
- [ ] Run focused tests and confirm video endpoints are absent.
- [ ] Implement single-shot video Job execution and list/active routes using approved active panels.
- [ ] Run focused and API tests, then commit `feat: generate shot video versions`.

### Task 11: Video Production Stage And Readiness

**Files:**
- Modify: `services/api/comic_studio/services/production_runs.py`
- Modify: `services/api/comic_studio/services/production_coordinator.py`
- Modify: `services/api/comic_studio/services/readiness.py`
- Modify: `services/api/comic_studio/routes/production.py`
- Modify: `services/api/comic_studio/production.py`
- Test: `services/api/tests/test_production_run_creation.py`
- Test: `services/api/tests/test_production_coordinator.py`
- Test: `services/api/tests/test_production_readiness.py`

- [ ] Write tests for video item planning, regeneration, skip/eligibility, concurrency, pause, retry, startup recovery, provider task metadata, static readiness, and full `video_ready`.
- [ ] Run focused tests and confirm `videos` is rejected.
- [ ] Extend run creation/coordinator/recovery/readiness while preserving panel and speech semantics.
- [ ] Run focused and full API tests, then commit `feat: add video batch production`.

### Task 12: Video Inspector And Production UI

**Files:**
- Create: `apps/web/components/VideoVersions.tsx`
- Modify: `apps/web/components/Inspector.tsx`
- Modify: `apps/web/components/ProductionPanel.tsx`
- Modify: `apps/web/components/ProductionItemRow.tsx`
- Modify: `apps/web/components/ReadinessBlockers.tsx`
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/lib/types.ts`
- Modify: `apps/web/app/globals.css`
- Test: `apps/web/tests/inspector.test.tsx`
- Test: `apps/web/tests/production-panel.test.tsx`

- [ ] Write tests for prompt editing, generation, playback, version activation, video stage controls, counters, filters, and static/dynamic readiness labels.
- [ ] Run focused tests and verify missing UI behavior.
- [ ] Implement video controls with stable media dimensions and existing polling semantics.
- [ ] Run Web tests and build, then commit `feat: add video production controls`.

### Task 13: Mixed Static And Video Composition

**Files:**
- Modify: `services/api/comic_studio/services/rendering.py`
- Modify: `packages/compositor/src/manifest.ts`
- Modify: `packages/compositor/src/ComicEpisode.tsx`
- Modify: `packages/compositor/package.json`
- Test: `services/api/tests/test_render_manifest.py`
- Test: `packages/compositor/tests/manifest.test.ts`
- Create fixture: `packages/compositor/fixtures/mixed-episode/`

- [ ] Write manifest tests for optional video path, copied assets, codec/duration validation, exact broken-video blockers, and static fallback.
- [ ] Run API/compositor tests and confirm video fields are ignored or rejected.
- [ ] Add video-first Remotion rendering using `<Video muted>` while retaining dialogue audio, subtitles, and panel motion fallback.
- [ ] Render the mixed fixture and probe H.264/AAC output; commit `feat: render mixed video comic episodes`.

### Task 14: End-To-End And Release Audit

**Files:**
- Create: `apps/web/e2e/full-dynamic-production.spec.ts`
- Modify: `README.md`
- Modify: `.env.example`

- [ ] Add a deterministic E2E flow covering DOCX import, two-episode confirmation, primary reference, reference-aware panel, video generation, failed video retry, and mixed render.
- [ ] Run API tests, Web tests, compositor tests, migrations, builds, Playwright, `npm audit`, dependency audit, and `git diff --check`.
- [ ] Run live smoke checks for configured LLM, GPT Image edit, Qwen TTS, and MiniMax image-to-video without exposing credentials.
- [ ] Inspect the produced MP4 with ffprobe and review the final requirement checklist against the design release gates.
- [ ] Commit `test: verify dynamic comic production pipeline` only after every gate has current evidence.
