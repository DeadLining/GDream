# AI Comic Studio UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the existing local web interface as a modern episode cockpit with overview, storyboard, production, review, and persistent inspector workflows across desktop and mobile.

**Architecture:** Keep `Workspace` as the orchestration boundary for project, episode, selected shot, readiness, and active work area. Add focused derived-view components for overview metrics, workspace navigation, blockers, and review while preserving all existing API contracts and production behavior. Replace the current monolithic visual treatment with a tokenized light studio system and verify it with component tests, Playwright flows, and screenshots.

**Tech Stack:** Next.js 16, React 19, TypeScript, Lucide React, CSS, Vitest, Testing Library, Playwright.

---

### Task 1: Episode Overview View Model And Metrics

**Files:**
- Create: `apps/web/lib/episode-overview.ts`
- Create: `apps/web/components/StatusMetric.tsx`
- Create: `apps/web/components/ReadinessBlockers.tsx`
- Create: `apps/web/components/EpisodeOverview.tsx`
- Create: `apps/web/tests/episode-overview.test.tsx`

- [ ] **Step 1: Write failing overview derivation tests**

Test that the derived overview combines episode shots and readiness without a new API:

```tsx
const overview = deriveEpisodeOverview(episode, readiness);
expect(overview.shotCount).toBe(2);
expect(overview.dialogueCount).toBe(1);
expect(overview.durationSeconds).toBe(9);
expect(overview.panelProgress).toEqual({ready: 1, total: 2});
expect(overview.reviewProgress).toEqual({ready: 1, total: 2});
expect(overview.renderReady).toBe(false);
```

Render `EpisodeOverview` and assert that clicking a shot calls `onSelectShot('shot-2')`, while blocker actions call `onOpenReview()` or `onOpenProduction()`.

- [ ] **Step 2: Run the focused test and confirm missing modules**

Run:

```bash
npm test --workspace @comic-studio/web -- --run tests/episode-overview.test.tsx
```

Expected: FAIL because `deriveEpisodeOverview` and overview components do not exist.

- [ ] **Step 3: Implement the typed overview derivation**

Create this public shape in `episode-overview.ts`:

```ts
export type EpisodeOverviewData = {
  shotCount: number;
  dialogueCount: number;
  durationSeconds: number;
  panelProgress: {ready: number; total: number};
  speechProgress: {ready: number; total: number};
  reviewProgress: {ready: number; total: number};
  renderReady: boolean;
};

export function deriveEpisodeOverview(
  episode: EpisodeDetail,
  readiness: ProductionReadiness,
): EpisodeOverviewData {
  const shots = episode.scenes.flatMap(scene => scene.shots);
  return {
    shotCount: shots.length,
    dialogueCount: shots.flatMap(shot => shot.dialogue).length,
    durationSeconds: shots.reduce((sum, shot) => sum + shot.duration_seconds, 0),
    panelProgress: {ready: readiness.ready_counts.panels, total: readiness.totals.shots},
    speechProgress: {ready: readiness.ready_counts.speech, total: readiness.totals.dialogue},
    reviewProgress: {ready: readiness.ready_counts.approved, total: readiness.totals.shots},
    renderReady: readiness.ready,
  };
}
```

Implement `StatusMetric` with a label, numeric summary, and semantic `<progress>`. Implement `ReadinessBlockers` with exact blocker counts and navigation callbacks. Implement `EpisodeOverview` as an unframed work area with metrics and stable thumbnail cards.

- [ ] **Step 4: Run focused and full web tests**

```bash
npm test --workspace @comic-studio/web -- --run tests/episode-overview.test.tsx
npm test --workspace @comic-studio/web
```

Expected: all tests pass.

- [ ] **Step 5: Commit the overview unit**

```bash
git add apps/web/lib/episode-overview.ts apps/web/components/StatusMetric.tsx apps/web/components/ReadinessBlockers.tsx apps/web/components/EpisodeOverview.tsx apps/web/tests/episode-overview.test.tsx
git commit -m "feat: add episode production overview"
```

### Task 2: Workspace Navigation And Shared Selection Context

**Files:**
- Create: `apps/web/components/WorkspaceTabs.tsx`
- Modify: `apps/web/components/Workspace.tsx`
- Modify: `apps/web/tests/workspace.test.tsx`

- [ ] **Step 1: Write failing workspace navigation tests**

Extend `workspace.test.tsx` to verify:

```tsx
expect(await screen.findByRole('tab', {name: '总览'})).toHaveAttribute('aria-selected', 'true');
await userEvent.click(screen.getByRole('tab', {name: '分镜'}));
expect(screen.getByRole('heading', {name: episode.title})).toBeVisible();
await userEvent.click(screen.getByRole('tab', {name: '生产'}));
expect(screen.getByRole('heading', {name: '剧集生产队列'})).toBeVisible();
```

Also select a shot from overview, switch to storyboard, and assert the same shot remains selected and appears in the inspector.

- [ ] **Step 2: Run the workspace test and confirm missing tabs**

```bash
npm test --workspace @comic-studio/web -- --run tests/workspace.test.tsx
```

Expected: FAIL because the overview-first tab workflow does not exist.

- [ ] **Step 3: Implement `WorkspaceTabs`**

Use a typed work-area contract:

```ts
export type WorkArea = 'overview' | 'storyboard' | 'production' | 'review' | 'inspector';

export function WorkspaceTabs({value, onChange, mobile = false}: {
  value: WorkArea;
  onChange: (value: WorkArea) => void;
  mobile?: boolean;
}) { /* semantic tablist and tabs */ }
```

Desktop tabs expose overview, storyboard, production, and review. Mobile exposes overview, storyboard, production, and inspector.

- [ ] **Step 4: Refactor `Workspace` orchestration**

Add `workArea`, `readiness`, and one shared selected-shot ID. Render the center work area by typed branch:

```tsx
const center = workArea === 'overview'
  ? <EpisodeOverview ... />
  : workArea === 'production'
    ? <ProductionPanel ... />
    : workArea === 'review'
      ? <ReviewPanel ... />
      : <Storyboard ... />;
```

Refresh both episode and readiness after edits or terminal production states. Do not duplicate selection state inside child views.

- [ ] **Step 5: Run tests and build**

```bash
npm test --workspace @comic-studio/web -- --run tests/workspace.test.tsx tests/episode-overview.test.tsx
npm run build --workspace @comic-studio/web
```

Expected: tests and TypeScript build pass.

- [ ] **Step 6: Commit workspace navigation**

```bash
git add apps/web/components/WorkspaceTabs.tsx apps/web/components/Workspace.tsx apps/web/tests/workspace.test.tsx
git commit -m "feat: add episode cockpit navigation"
```

### Task 3: Modern Studio Shell And Navigation

**Files:**
- Modify: `apps/web/components/AppToolbar.tsx`
- Modify: `apps/web/components/ProjectNavigator.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/tests/workspace.test.tsx`
- Modify: `.gitignore`

- [ ] **Step 1: Write failing shell semantics tests**

Assert that the toolbar exposes a project/episode breadcrumb, accessible icon commands, and readiness-aware render title. Assert the navigator exposes `剧集` and `项目资料` groups and preserves the active episode.

```tsx
expect(screen.getByText('霓虹夜行 / 失窃的雨夜')).toBeVisible();
expect(screen.getByRole('button', {name: '批量生产'})).toBeVisible();
expect(screen.getByRole('button', {name: '渲染本集'})).toHaveAttribute('title', '素材未就绪');
```

- [ ] **Step 2: Run tests and confirm the new shell contract fails**

```bash
npm test --workspace @comic-studio/web -- --run tests/workspace.test.tsx
```

Expected: FAIL on breadcrumb and navigation group assertions.

- [ ] **Step 3: Refactor toolbar and navigator props**

Pass project and episode labels explicitly to `AppToolbar`. Use Lucide icons already installed; keep icon-only utilities at stable 34px dimensions with tooltips. Add project-resource navigation rows as non-destructive placeholders only when they map to existing content; do not create backend routes.

- [ ] **Step 4: Replace global tokens and shell CSS**

Define the light studio tokens at the top of `globals.css`:

```css
:root {
  --ink: #25282c;
  --muted: #747c83;
  --line: #dfe3e6;
  --app: #f4f6f7;
  --surface: #ffffff;
  --surface-subtle: #f8f9fa;
  --accent: #d94438;
  --success: #2f7557;
  --warning: #b47b20;
  --info: #2f6f7b;
  --focus: #246bce;
}
```

Rebuild toolbar, navigation, workspace grid, button, input, focus, loading, and empty-state styles. Keep surfaces unframed except repeated cards and dialogs. Add `.superpowers/` to `.gitignore` so visual-companion artifacts stay local.

- [ ] **Step 5: Run tests, build, and CSS checks**

```bash
npm test --workspace @comic-studio/web
npm run build --workspace @comic-studio/web
git diff --check
```

Expected: all pass with no CSS overflow-causing negative spacing.

- [ ] **Step 6: Commit the studio shell**

```bash
git add .gitignore apps/web/components/AppToolbar.tsx apps/web/components/ProjectNavigator.tsx apps/web/app/globals.css apps/web/tests/workspace.test.tsx
git commit -m "feat: redesign the studio application shell"
```

### Task 4: Storyboard And Inspector Redesign

**Files:**
- Modify: `apps/web/components/Storyboard.tsx`
- Modify: `apps/web/components/ShotCard.tsx`
- Modify: `apps/web/components/Inspector.tsx`
- Modify: `apps/web/components/PanelVersions.tsx`
- Modify: `apps/web/components/DialogueEditor.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/tests/inspector.test.tsx`
- Create: `apps/web/tests/storyboard.test.tsx`

- [ ] **Step 1: Write failing storyboard and inspector tests**

Verify stable shot metadata and status labels:

```tsx
expect(screen.getByRole('button', {name: /镜头 2/})).toHaveTextContent('近景');
expect(screen.getByRole('button', {name: /镜头 2/})).toHaveTextContent('5s');
expect(screen.getByText('待审核')).toBeVisible();
```

In inspector tests, assert grouped headings `镜头状态`, `构图与运动`, `生成提示`, `画面版本`, and `对白与配音`.

- [ ] **Step 2: Run focused tests and confirm the hierarchy is absent**

```bash
npm test --workspace @comic-studio/web -- --run tests/storyboard.test.tsx tests/inspector.test.tsx
```

Expected: FAIL on the new status and section hierarchy.

- [ ] **Step 3: Implement stable storyboard cards**

Use fixed card tracks: media, one metadata row, and a two-line description region. Use Lucide icons for duration, dialogue, missing media, and approval. Keep generation commands out of cards.

- [ ] **Step 4: Recompose the inspector**

Group existing controls into semantic `<section>` elements with compact headings. Keep all existing update, panel version, activation, speech, and audio behavior. Move the primary generation action near the relevant section and preserve accessible names used by tests and E2E.

- [ ] **Step 5: Apply storyboard and inspector CSS**

Use responsive `minmax()` grids, stable card aspect ratios, two-line clamping, fixed icon button sizes, and visible focus rings. Do not put section cards inside the inspector surface.

- [ ] **Step 6: Run focused tests, full tests, and build**

```bash
npm test --workspace @comic-studio/web -- --run tests/storyboard.test.tsx tests/inspector.test.tsx
npm test --workspace @comic-studio/web
npm run build --workspace @comic-studio/web
```

Expected: all pass.

- [ ] **Step 7: Commit storyboard and inspector**

```bash
git add apps/web/components/Storyboard.tsx apps/web/components/ShotCard.tsx apps/web/components/Inspector.tsx apps/web/components/PanelVersions.tsx apps/web/components/DialogueEditor.tsx apps/web/app/globals.css apps/web/tests/storyboard.test.tsx apps/web/tests/inspector.test.tsx
git commit -m "feat: redesign storyboard and shot inspector"
```

### Task 5: Production Queue And Review Workspace

**Files:**
- Create: `apps/web/components/ReviewPanel.tsx`
- Create: `apps/web/tests/review-panel.test.tsx`
- Modify: `apps/web/components/ProductionPanel.tsx`
- Modify: `apps/web/components/ProductionItemRow.tsx`
- Modify: `apps/web/tests/production-panel.test.tsx`
- Modify: `apps/web/app/globals.css`

- [ ] **Step 1: Write failing review and production presentation tests**

Review tests must show only blocker shots and route selection:

```tsx
expect(screen.getByRole('heading', {name: '审核队列'})).toBeVisible();
expect(screen.getByText('缺少画面')).toBeVisible();
await userEvent.click(screen.getByRole('button', {name: /镜头 2/}));
expect(onSelectShot).toHaveBeenCalledWith('shot-2');
```

Extend production tests to assert Chinese filter labels, stage icons with accessible names, failure text, and stable counters while retaining start, pause, continue, retry, restore, and readiness-refresh behavior.

- [ ] **Step 2: Run focused tests and confirm review/filter UI is absent**

```bash
npm test --workspace @comic-studio/web -- --run tests/review-panel.test.tsx tests/production-panel.test.tsx
```

Expected: FAIL because `ReviewPanel` and redesigned labels do not exist.

- [ ] **Step 3: Implement `ReviewPanel` from existing data**

Derive blocked shots from `missing_panels` and `unapproved_shots`. Render one compact row per affected shot with blocker labels and `onSelectShot`. Do not persist a separate review queue.

- [ ] **Step 4: Redesign production controls and rows**

Keep every v0.3 API call unchanged. Replace English filter text with `全部`, `进行中`, `失败`, and `已完成`. Use icons and status labels, preserve semantic checkboxes, and show errors in an inline failure region.

- [ ] **Step 5: Apply production and review CSS**

Use a compact option band, stable progress region, segmented filter control, and dense rows. Keep progress and counters from resizing the layout as states change.

- [ ] **Step 6: Run tests and build**

```bash
npm test --workspace @comic-studio/web -- --run tests/review-panel.test.tsx tests/production-panel.test.tsx
npm test --workspace @comic-studio/web
npm run build --workspace @comic-studio/web
```

Expected: all pass.

- [ ] **Step 7: Commit production and review**

```bash
git add apps/web/components/ReviewPanel.tsx apps/web/components/ProductionPanel.tsx apps/web/components/ProductionItemRow.tsx apps/web/tests/review-panel.test.tsx apps/web/tests/production-panel.test.tsx apps/web/app/globals.css
git commit -m "feat: redesign production and review workspaces"
```

### Task 6: Mobile Navigation And Responsive Layout

**Files:**
- Modify: `apps/web/components/Workspace.tsx`
- Modify: `apps/web/components/WorkspaceTabs.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/e2e/production-flow.spec.ts`

- [ ] **Step 1: Add failing mobile E2E navigation assertions**

Add a mobile-only flow:

```ts
await page.goto('/');
await page.getByRole('tab', {name: '分镜'}).click();
await page.getByRole('button', {name: /镜头 2/}).click();
await expect(page.getByRole('tab', {name: '检查器'})).toHaveAttribute('aria-selected', 'true');
await page.getByRole('tab', {name: '生产'}).click();
await expect(page.getByRole('heading', {name: '剧集生产队列'})).toBeVisible();
```

Also assert that toolbar, tabs, and main content bounding boxes do not overlap.

- [ ] **Step 2: Run mobile E2E and confirm failure**

```bash
npm run test:e2e --workspace @comic-studio/web -- --project=mobile
```

Expected: FAIL because the four-area mobile navigation and new layout are incomplete.

- [ ] **Step 3: Implement mobile work-area behavior**

When a shot is selected below 900px, set `workArea` to `inspector`. Desktop selection must not change the active work area. Preserve the selected shot while switching tabs.

- [ ] **Step 4: Complete responsive CSS**

At widths below 900px:

- collapse to one work-area column;
- keep toolbar and selectors sticky without overlap;
- expose four equal segmented tabs;
- use two-column shot grids down to 390px and one column below that when text cannot fit;
- hide the desktop inspector unless the inspector work area is active;
- keep all controls within viewport width.

- [ ] **Step 5: Run mobile and full E2E**

```bash
npm run test:e2e --workspace @comic-studio/web -- --project=mobile
npm run test:e2e --workspace @comic-studio/web
```

Expected: mobile tests pass; full suite passes with the existing expected skip only.

- [ ] **Step 6: Commit responsive behavior**

```bash
git add apps/web/components/Workspace.tsx apps/web/components/WorkspaceTabs.tsx apps/web/app/globals.css apps/web/e2e/production-flow.spec.ts
git commit -m "feat: add responsive studio navigation"
```

### Task 7: Visual Verification And Release Audit

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-11-ai-comic-studio-ui-redesign.md`

- [ ] **Step 1: Update README interface workflow**

Document the overview-first cockpit, four work areas, persistent inspector, review workflow, and mobile navigation. Do not change model or deployment documentation.

- [ ] **Step 2: Run complete deterministic verification sequentially**

```bash
cd services/api && uv run pytest -q
cd ../.. && npm test --workspaces --if-present
npm run build --workspaces --if-present
npm run test:e2e --workspace @comic-studio/web
npm run render:fixture --workspace @comic-studio/compositor
ffprobe -v error -show_entries format=duration,size \
  -show_entries stream=codec_name,width,height,sample_rate,channels \
  -of json packages/compositor/out/fixture.mp4
git diff --check
```

Expected: API, web, compositor, build, E2E, and fixture checks pass. If local Chrome context creation fails before page assertions, rerun Playwright alone before diagnosing production code.

- [ ] **Step 3: Capture browser screenshots**

Use Playwright against the running local app at:

- desktop: 1440x900;
- tablet: 1024x768;
- mobile: 390x844.

Verify visually and with bounding-box assertions:

- nonblank overview and shot media;
- no toolbar, tab, or inspector overlap;
- no clipped Chinese labels or button text;
- stable shot-card dimensions;
- production rows and failure text remain readable;
- mobile controls stay within viewport width.

- [ ] **Step 4: Run final security and repository checks**

```bash
npm audit --omit=dev --registry=https://registry.npmjs.org || true
git diff | rg 'sk-[A-Za-z0-9_-]{12,}' && exit 1 || true
git status --short
```

Record the known upstream Next.js/PostCSS advisory if it remains without a non-breaking update. Confirm no secrets or generated visual-companion files are staged.

- [ ] **Step 5: Mark all plan steps complete and commit**

```bash
git add README.md docs/superpowers/plans/2026-07-11-ai-comic-studio-ui-redesign.md apps/web
git commit -m "feat: complete modern studio UI redesign"
```
