# AI Comic Studio Compact Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sparse episode overview with a compact production dashboard that shows progress, blockers, and the shot wall in the first viewport.

**Architecture:** Preserve existing Workspace state, APIs, review routing, and shared shot selection. Recompose `EpisodeOverview`, `StatusMetric`, and `ReadinessBlockers`, then add narrowly scoped overview CSS and screenshot verification.

**Tech Stack:** React 19, TypeScript, Lucide React, CSS, Vitest, Testing Library, Playwright.

---

### Task 1: Compact Overview Composition

**Files:**
- Modify: `apps/web/components/EpisodeOverview.tsx`
- Modify: `apps/web/components/StatusMetric.tsx`
- Modify: `apps/web/components/ReadinessBlockers.tsx`
- Modify: `apps/web/tests/episode-overview.test.tsx`
- Modify: `apps/web/app/globals.css`

- [x] **Step 1: Write failing compact-layout component tests**

Assert the overview renders episode sequence/status/target duration, two commands, exactly three metrics, compact blockers, and shot buttons:

```tsx
expect(screen.getByText('第 01 集')).toBeVisible();
expect(screen.getByText('目标 60 秒')).toBeVisible();
expect(screen.getByRole('button', {name: '打开生产'})).toBeVisible();
expect(screen.getByRole('button', {name: '处理阻塞项'})).toBeVisible();
expect(screen.getAllByRole('progressbar')).toHaveLength(3);
expect(screen.getByRole('button', {name: /镜头 2/})).toBeVisible();
```

Retain the zero-total assertion that no false progressbar is exposed.

- [x] **Step 2: Run focused tests and confirm RED**

```bash
npm test --workspace @comic-studio/web -- --run tests/episode-overview.test.tsx
```

Expected: FAIL because the compact header and command labels do not exist.

- [x] **Step 3: Implement the compact composition**

Use this hierarchy:

```tsx
<main className="episode-overview compact-overview">
  <header className="overview-identity">...</header>
  <section className="overview-metrics">...</section>
  <ReadinessBlockers compact ... />
  <section className="overview-shot-wall">...</section>
</main>
```

Add an optional `compact` presentation prop to `ReadinessBlockers` only if needed. Preserve its callbacks. Keep `StatusMetric` semantic `<progress>` for positive totals and its non-progress zero-total state.

- [x] **Step 4: Add overview-only CSS**

Create fixed, responsive tracks for the 104px identity region, equal metric row, blocker strip, and remaining shot wall. Use custom progress appearance with existing success/warning tokens. Do not modify global Workspace, ShotCard, Inspector, or Production layout rules.

- [x] **Step 5: Run focused/full tests and build**

```bash
npm test --workspace @comic-studio/web -- --run tests/episode-overview.test.tsx tests/workspace.test.tsx
npm test --workspace @comic-studio/web
npm run build --workspace @comic-studio/web
git diff --check
```

- [x] **Step 6: Commit**

```bash
git add apps/web/components/EpisodeOverview.tsx apps/web/components/StatusMetric.tsx apps/web/components/ReadinessBlockers.tsx apps/web/tests/episode-overview.test.tsx apps/web/app/globals.css docs/superpowers/plans/2026-07-11-ai-comic-studio-compact-overview.md
git commit -m "feat: compact the episode overview"
```

### Task 2: Visual And Responsive Verification

**Files:**
- Modify: `apps/web/e2e/production-flow.spec.ts` only if an acceptance assertion is missing
- Modify: `docs/superpowers/plans/2026-07-11-ai-comic-studio-compact-overview.md`

- [x] **Step 1: Add first-viewport acceptance assertions**

At 1440x900 and 1024x768, verify at least one shot card is visible in the viewport without scrolling. At 390x844, verify no horizontal overflow and the overview commands and metrics fit.

- [x] **Step 2: Run isolated E2E on the worktree server**

```bash
E2E_PORT=3100 npm run test:e2e --workspace @comic-studio/web
```

Expected: all applicable desktop/mobile cases pass; cross-project skips remain intentional.

- [x] **Step 3: Capture and inspect screenshots**

Capture desktop 1440x900, tablet 1024x768, and mobile 390x844 under `output/compact-overview/`. Confirm the title region is compact, all three metrics align, blockers remain readable, shot content enters the first viewport, and no content overlaps or clips.

- [x] **Step 4: Run final web verification and commit**

```bash
npm test --workspace @comic-studio/web
npm run build --workspace @comic-studio/web
git diff --check
git add apps/web docs/superpowers/plans/2026-07-11-ai-comic-studio-compact-overview.md
git commit -m "test: verify compact episode overview"
```
