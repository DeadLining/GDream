# Streaming Script Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream a readable MiniMax-generated script into the AI editor, preserve it locally, and require a manual parse action before creating structured storyboard data.

**Architecture:** Add a FastAPI SSE endpoint backed by a MiniMax streaming generator and a reusable trusted project-context builder. Add a small browser stream client that parses SSE frames, while `ScriptImportWorkspace` owns abort, resume, persistence, stale-stream protection, and the transition from brief to editable draft. Structured parsing continues through the existing script-import API using automatic recognition.

**Tech Stack:** FastAPI `StreamingResponse`, HTTPX streaming, MiniMax Anthropic-compatible SSE, React, TypeScript, localStorage, Vitest, Pytest, Playwright.

---

### Task 1: Reuse trusted project context

**Files:**
- Modify: `services/api/comic_studio/services/script_imports.py`
- Test: `services/api/tests/test_script_import_parsing.py`

- [ ] Extract a `build_script_project_context(project)` function that returns project canon, full character constraints/reference summaries, and existing episode/scene continuity.
- [ ] Write a failing test that calls the helper directly and verifies the same fields currently passed to `parse_script_import`.
- [ ] Update `ScriptImportParserService` to use the helper without changing its existing context contract.
- [ ] Run `cd services/api && uv run pytest -q tests/test_script_import_parsing.py`.

### Task 2: Add MiniMax readable-script streaming

**Files:**
- Modify: `services/api/comic_studio/providers/minimax.py`
- Create: `services/api/comic_studio/services/script_generation.py`
- Modify: `services/api/comic_studio/main.py`
- Test: `services/api/tests/providers/test_minimax.py`
- Create: `services/api/tests/test_script_generation_stream.py`

- [ ] Add a failing provider test for an Anthropic-compatible `stream: true` request and `content_block_delta` text extraction.
- [ ] Implement `MiniMaxProvider.stream_script(context)` using `httpx.AsyncClient.stream`, a 240-second read budget, and safe provider errors.
- [ ] Add `POST /api/projects/{project_id}/script-generation/stream` returning `text/event-stream` frames for `chunk`, `done`, and redacted `error` events.
- [ ] Load the project aggregate with characters, references, episodes, and scenes before opening the stream.
- [ ] Ensure disconnect cancellation closes the upstream response and no credentials appear in frames or logs.
- [ ] Run `cd services/api && uv run pytest -q tests/providers/test_minimax.py tests/test_script_generation_stream.py`.

### Task 3: Add the browser SSE client and editor state machine

**Files:**
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/components/ScriptImportWorkspace.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/tests/script-import.test.tsx`

- [ ] Write failing component tests for incremental chunks, stop, resume, manual parsing, overwrite confirmation, localStorage restoration, and stale project streams.
- [ ] Implement `streamScriptGeneration(projectId, request, handlers, signal)` using `fetch`, `ReadableStreamDefaultReader`, `TextDecoder`, and SSE frame parsing.
- [ ] Replace the AI mode submit behavior with `开始 AI 创作`; append chunks to the textarea and persist each settled draft update per project.
- [ ] Show `停止生成` while active, `继续生成` after an interrupted partial draft, `重新生成` for completed drafts, and `解析并预览` only when a non-empty draft is available.
- [ ] Parse manually by creating an existing `auto` script import from the edited draft, then invoking the existing strict parser.
- [ ] Abort and ignore stale streams when the project changes, mode changes, or the component unmounts.
- [ ] Clear local draft state only after successful import confirmation.
- [ ] Run `npm test --workspace @comic-studio/web -- --run tests/script-import.test.tsx`.

### Task 4: Verify the complete workflow

**Files:**
- Modify: `apps/web/e2e/production-flow.spec.ts` only for route-mocked streaming coverage.

- [ ] Add a browser route that returns delayed SSE chunks and verify the textarea visibly grows before completion.
- [ ] Verify parsing is not called until `解析并预览` is clicked.
- [ ] Run API and Web full test suites.
- [ ] Run the Next.js production build.
- [ ] Run a live MiniMax stream against the current project without confirming the resulting draft.
- [ ] Capture desktop/mobile screenshots and check for overflow or layout shift.
- [ ] Run `git diff --check` and commit only streaming-script files.

