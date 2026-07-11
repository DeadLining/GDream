# AI Script Creation Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace format-specific script import modes with an AI-first script creation workspace that generates drafts from full project context or automatically recognizes supplied source text.

**Architecture:** Keep `ScriptImportDraft` as the single preview and confirmation contract. Add a `generate` creation mode whose source is an optional brief, enrich parser context from the authoritative project aggregate, and retain legacy mode values for persisted data compatibility. The web workspace exposes only AI generation and automatic recognition, while populated storyboard episodes require explicit confirmation before replacement planning.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy, MiniMax Anthropic-compatible API, React 19, Next.js, TypeScript, Vitest, Testing Library, Pytest.

---

### Task 1: Add the project-context generation API contract

**Files:**
- Modify: `services/api/comic_studio/script_imports.py`
- Modify: `services/api/comic_studio/routes/script_imports.py`
- Test: `services/api/tests/test_script_import_api.py`

- [ ] **Step 1: Write failing API tests**

Add tests that post `{"mode":"generate","text":""}` and `{"mode":"generate","text":"聚焦角色冲突"}`. Assert both create a record with mode `generate`, source format `generated`, and the optional brief stored as extracted text. Retain tests proving `screenplay` and `prose` records remain readable.

- [ ] **Step 2: Run the focused test**

Run: `cd services/api && uv run pytest -q tests/test_script_import_api.py -k generate`

Expected: FAIL because `generate` is rejected and empty text is invalid.

- [ ] **Step 3: Implement the generation request contract**

Extend current mode validation to `Literal["generate", "auto", "screenplay", "prose"]`. Allow empty text only for `generate`. In the JSON route, create a deterministic generated source object with `source_format="generated"`, an empty filename, the brief as text, and a SHA-256 checksum of the brief.

- [ ] **Step 4: Verify API contract tests**

Run: `cd services/api && uv run pytest -q tests/test_script_import_api.py`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/comic_studio/script_imports.py services/api/comic_studio/routes/script_imports.py services/api/tests/test_script_import_api.py
git commit -m "feat: add AI script generation mode"
```

### Task 2: Build full trusted project context for generation

**Files:**
- Modify: `services/api/comic_studio/services/script_imports.py`
- Modify: `services/api/comic_studio/providers/minimax.py`
- Test: `services/api/tests/test_script_import_parsing.py`
- Test: `services/api/tests/providers/test_minimax.py`

- [ ] **Step 1: Write failing context tests**

Create a project fixture with character continuity data and existing episodes/scenes. Capture the planner context and assert generation includes project metadata, complete character fields, existing episode summaries, `mode="generate"`, and `creation_brief`. Assert auto mode still includes source text.

- [ ] **Step 2: Run context tests**

Run: `cd services/api && uv run pytest -q tests/test_script_import_parsing.py -k 'generation or context'`

Expected: FAIL because the parser currently sends only character names and omits existing episodes.

- [ ] **Step 3: Implement eager loading and context assembly**

Load project characters plus episodes and their scenes in `ScriptImportParserService`. Build a JSON-safe context with project title, logline, story bible, visual style, aspect ratio, character appearance/personality/continuity/negative/voice fields, and existing episode title/premise/status/scene summaries. For `generate`, expose `creation_brief` and omit a source-document interpretation instruction; for all other modes expose `text`.

- [ ] **Step 4: Update MiniMax prompt semantics**

Make `parse_script_import` select a generation instruction when `mode == "generate"`: create a coherent serialized dynamic-comic draft using project canon and avoid duplicating existing episodes. Keep automatic source recognition for `auto`. Both paths validate against `ScriptImportDraft` and retain the existing correction retry.

- [ ] **Step 5: Verify provider and parser tests**

Run: `cd services/api && uv run pytest -q tests/test_script_import_parsing.py tests/providers/test_minimax.py`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/api/comic_studio/services/script_imports.py services/api/comic_studio/providers/minimax.py services/api/tests/test_script_import_parsing.py services/api/tests/providers/test_minimax.py
git commit -m "feat: generate script drafts from project context"
```

### Task 3: Replace the format selector with the AI-first workspace

**Files:**
- Modify: `apps/web/components/ScriptImportWorkspace.tsx`
- Modify: `apps/web/components/WorkspaceTabs.tsx`
- Modify: `apps/web/components/ProjectNavigator.tsx`
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/lib/types.ts`
- Modify: `apps/web/tests/script-import.test.tsx`
- Modify: `apps/web/e2e/production-flow.spec.ts`

- [ ] **Step 1: Write failing component tests**

Assert the workspace title is `剧本创作`, AI generation is selected by default, only `AI生成` and `自动识别` mode controls exist, and `剧本`/`小说` controls do not exist. Verify AI generation can submit an empty brief, an optional brief is sent with mode `generate`, and auto recognition still requires pasted text or a file.

- [ ] **Step 2: Run the component tests**

Run: `npm test --workspace @comic-studio/web -- --run tests/script-import.test.tsx`

Expected: FAIL on the old three-mode UI.

- [ ] **Step 3: Implement mode-specific source panels**

Use `ScriptImportMode = "generate" | "auto" | "screenplay" | "prose"` for compatibility, but render only `generate` and `auto`. Default to `generate`. Render an optional `本次创作要求` textarea and `生成并预览` command for generation. Render paste/file inputs and `解析并预览` only for auto recognition. Keep the existing shared draft preview, save, confirm, retry, and error states.

- [ ] **Step 4: Rename navigation labels**

Change user-facing `剧本导入` labels in workspace tabs and project navigation to `剧本创作`. Preserve internal work-area value `import` to avoid unrelated navigation migration.

- [ ] **Step 5: Update browser flow coverage**

Keep an E2E automatic-recognition flow and add route assertions that AI generation posts `{mode:"generate", text:""}` before parsing the created draft.

- [ ] **Step 6: Verify web tests**

Run: `npm test --workspace @comic-studio/web -- --run tests/script-import.test.tsx tests/workspace.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/ScriptImportWorkspace.tsx apps/web/components/WorkspaceTabs.tsx apps/web/components/ProjectNavigator.tsx apps/web/lib/api.ts apps/web/lib/types.ts apps/web/tests/script-import.test.tsx apps/web/e2e/production-flow.spec.ts
git commit -m "feat: add AI-first script creation workspace"
```

### Task 4: Protect generated storyboards from silent replacement

**Files:**
- Modify: `apps/web/components/Storyboard.tsx`
- Modify: `apps/web/components/Workspace.tsx`
- Test: `apps/web/tests/workspace.test.tsx`

- [ ] **Step 1: Write failing replacement tests**

For an empty episode, assert the command remains `生成剧本与分镜`. For a populated episode, expose `重新生成分镜`; canceling `window.confirm` must not call `startPlanning`, while confirming must call it once.

- [ ] **Step 2: Run replacement tests**

Run: `npm test --workspace @comic-studio/web -- --run tests/workspace.test.tsx -t '重新生成|replacement'`

Expected: FAIL because populated episodes currently provide no explicit replanning command.

- [ ] **Step 3: Implement the guarded command**

Render a compact `重新生成分镜` command for populated episodes. Before invoking the existing planning callback, show: `重新生成会替换当前场景、镜头和对白，并可能使已有生产素材失效。确定继续吗？` Do not modify the backend planning replacement semantics.

- [ ] **Step 4: Verify replacement tests**

Run: `npm test --workspace @comic-studio/web -- --run tests/workspace.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/Storyboard.tsx apps/web/components/Workspace.tsx apps/web/tests/workspace.test.tsx
git commit -m "fix: guard storyboard regeneration"
```

### Task 5: Verify the complete workflow

**Files:**
- Modify only if verification reveals a defect in files already listed above.

- [ ] **Step 1: Run API tests**

Run: `cd services/api && uv run pytest -q`

Expected: all tests pass.

- [ ] **Step 2: Run Web tests and build**

Run: `npm test --workspace @comic-studio/web && npm run build --workspace @comic-studio/web`

Expected: all tests pass and Next.js production build succeeds.

- [ ] **Step 3: Run browser workflow**

Run: `npm run test:e2e --workspace @comic-studio/web -- --grep "script"`

Expected: AI generation and automatic recognition flows pass.

- [ ] **Step 4: Check repository integrity**

Run: `git diff --check && git status --short --branch`

Expected: no whitespace errors; only intentional concurrent user changes remain outside the task commits.

