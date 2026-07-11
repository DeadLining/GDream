# Compact Script Mode Segment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stretched script creation mode control with a compact, responsive two-segment selector.

**Architecture:** Keep the existing React state and mode behavior. Add semantic mode-specific classes and a Lucide icon, then constrain the existing segmented-control CSS to two stable columns on desktop and full width only on mobile.

**Tech Stack:** React, TypeScript, Lucide React, CSS, Vitest, Testing Library, Playwright.

---

### Task 1: Lock the two-segment behavior

**Files:**
- Modify: `apps/web/tests/script-import.test.tsx`
- Modify: `apps/web/components/ScriptImportWorkspace.tsx`

- [ ] Add a failing test asserting the mode group has the compact selector class, contains exactly two buttons, and the AI mode includes a decorative icon without changing its accessible name.
- [ ] Run `npm test --workspace @comic-studio/web -- --run tests/script-import.test.tsx` and verify failure.
- [ ] Add `script-mode-segments` and `script-mode-segment` classes and render the existing `Sparkles` icon inside the AI button.
- [ ] Rerun the focused test and verify it passes.

### Task 2: Apply responsive Studio styling

**Files:**
- Modify: `apps/web/app/globals.css`
- Test: `apps/web/tests/script-import.test.tsx`

- [ ] Add a CSS assertion that the selector uses two columns, content-sized desktop width, 36px controls, an accent active state, and a mobile full-width override.
- [ ] Run the focused test and verify failure.
- [ ] Implement the scoped selector styles without changing other segmented controls.
- [ ] Run the complete Web tests and Next.js build.
- [ ] Verify at `http://127.0.0.1:3100/` with desktop and mobile Playwright screenshots.

