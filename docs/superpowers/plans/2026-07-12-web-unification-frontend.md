# Web Unification Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Execute inline with test-first checkpoints because the current worktree contains unrelated user changes.

**Goal:** Rebuild the existing Web frontend around the approved production-workbench designs while preserving working data flows and deferring backend changes until the frontend is complete.

**Architecture:** Keep `Workspace` as the data-loading coordinator, introduce a consistent global navigation shell, and compose existing feature components into stage-specific work areas. Shared controls and layout rules live in focused components and the existing token layer; new canvas-oriented views remain frontend-only until their backend contracts are audited.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Testing Library, Playwright, React Three Fiber, Lucide.

---

### Task 1: Global Product Shell

**Files:**
- Modify: `apps/web/components/AppToolbar.tsx`
- Modify: `apps/web/components/WorkspaceTabs.tsx`
- Modify: `apps/web/components/Workspace.tsx`
- Modify: `apps/web/components/ProjectNavigator.tsx`
- Modify: `apps/web/app/globals.css`
- Test: `apps/web/tests/app-toolbar.test.tsx`
- Test: `apps/web/tests/workspace.test.tsx`

- [ ] Add failing tests for the five global navigation destinations and contextual inspector visibility.
- [ ] Run the focused tests and confirm they fail for the missing shell behavior.
- [ ] Implement the global navigation and stage tabs without changing API calls.
- [ ] Make the right inspector conditional on storyboard/director review context.
- [ ] Run focused tests and the full Web test suite.

### Task 2: Episode Production Views

**Files:**
- Modify: `apps/web/components/EpisodeOverview.tsx`
- Modify: `apps/web/components/Storyboard.tsx`
- Modify: `apps/web/components/ProductionPanel.tsx`
- Modify: `apps/web/components/ReviewPanel.tsx`
- Create: `apps/web/components/SceneWorkspace.tsx`
- Create: `apps/web/components/VisualReviewWorkspace.tsx`
- Test: `apps/web/tests/episode-overview.test.tsx`
- Test: `apps/web/tests/storyboard.test.tsx`
- Test: `apps/web/tests/production-panel.test.tsx`
- Create: `apps/web/tests/scene-workspace.test.tsx`
- Create: `apps/web/tests/visual-review-workspace.test.tsx`

- [ ] Add tests for scene selection, storyboard density, queue state, and annotation-to-conversation selection.
- [ ] Implement each production stage using current episode, scene, shot, asset, and job data.
- [ ] Preserve existing generation, approval, retry, and rendering actions.
- [ ] Verify desktop and compact layouts in Playwright.

### Task 3: Script and Asset Workspaces

**Files:**
- Modify: `apps/web/components/ScriptLibrary.tsx`
- Modify: `apps/web/components/CharacterWorkspace.tsx`
- Create: `apps/web/components/AssetCatalog.tsx`
- Create: `apps/web/components/canvas/AssetLineageCanvas.tsx`
- Create: `apps/web/components/canvas/StorylineCanvas.tsx`
- Test: `apps/web/tests/script-library.test.tsx`
- Test: `apps/web/tests/character-references.test.tsx`
- Create: `apps/web/tests/asset-catalog.test.tsx`
- Create: `apps/web/tests/canvas-workspaces.test.tsx`

- [ ] Add tests for stable volume ordering, storyline tags, inherited variants, overrides, and downstream references.
- [ ] Build the catalog view from existing character/reference data.
- [ ] Build frontend canvas interactions for pan, zoom, selection, search, scope, and node inspection.
- [ ] Keep unsupported persistence actions disabled and clearly labeled until backend contracts exist.

### Task 4: Review, Model Center, and Responsive States

**Files:**
- Modify: `apps/web/components/ReviewPanel.tsx`
- Modify: `apps/web/components/ModelCenter.tsx`
- Modify: `apps/web/app/globals.css`
- Create: `apps/web/tests/responsive-shell.test.tsx`
- Create: `apps/web/e2e/production-workflow.spec.ts`

- [ ] Add tests for time-linked review comments, publish gating, masked model credentials, overlay drawers, and tablet review mode.
- [ ] Implement the approved review/publish and model-center layouts using current APIs.
- [ ] Add responsive shell behavior for 1440px, 1024px, and 768px widths.
- [ ] Run unit tests, build, type checking, and Playwright screenshots.

### Task 5: Backend Contract Audit

**Files:**
- Create: `docs/frontend-backend-contract-gaps.md`
- Modify only the required files under `services/api/` after the frontend behavior is verified.

- [ ] Inventory frontend actions that lack persistent backend support.
- [ ] Define contracts for volumes, storylines, asset inheritance, visual annotations, and review threads.
- [ ] Add backend tests before each endpoint or schema change.
- [ ] Implement and verify the backend in a separate phase without rewriting working providers or job flows.
