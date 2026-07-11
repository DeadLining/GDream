# AI Comic Studio UI Redesign Design

## Goal

Redesign the local AI Comic Studio web application as a modern creative studio for episode production. The redesign should improve hierarchy, navigation, production visibility, and daily editing efficiency without changing backend models or provider integrations.

The selected direction is a bright, restrained creative SaaS workspace with balanced information density. It should feel professional and production-focused rather than decorative or marketing-oriented.

## Product Structure

The application becomes an episode cockpit with persistent project context and switchable work areas.

```text
Global toolbar
├── Project and episode breadcrumb
├── Provider health
├── Batch production
└── Render

Workspace
├── Left navigation: project, episodes, project resources
├── Center work area
│   ├── Overview
│   ├── Storyboard
│   ├── Production
│   └── Review
└── Right inspector: selected shot and dialogue context
```

The first screen is the episode overview, not a landing page. It combines episode metadata, readiness, production progress, review progress, and a compact shot overview.

## Visual Direction

- Use a cool neutral application background with white tool surfaces.
- Keep dark charcoal for the brand mark and primary text.
- Reserve red for primary commands, active navigation, and urgent failures.
- Use green for completed or ready states, amber for review blockers, and teal for informational progress.
- Use subtle borders and restrained shadows to separate operational surfaces.
- Keep corners at 4-8 pixels and avoid oversized cards or nested card layouts.
- Let real panel images provide the strongest color in the interface.
- Use compact typography suited to repeated scanning; no viewport-scaled text or negative letter spacing.

## Desktop Layout

The desktop application keeps a three-column operational layout.

### Toolbar

The toolbar shows the brand, current project and episode breadcrumb, provider status, refresh, batch production, and render. Icon-only utilities use Lucide icons and tooltips. The render command remains visually primary and reflects readiness.

### Left Navigation

The left navigation contains:

- the current project selector;
- episode list with position and status;
- project resources such as characters and story bible;
- creation commands at the bottom of the relevant sections.

The active episode uses a quiet filled background and a red selection marker.

### Center Work Area

The center contains a compact episode header and four tabs:

- `总览`: production metrics, blockers, and shot overview;
- `分镜`: full storyboard grouped by scene;
- `生产`: batch options, progress, filters, and item queue;
- `审核`: shots requiring approval or changes.

The work area changes without losing the selected shot.

### Inspector

The inspector remains visible on desktop and follows the selected shot. It groups identity and status, timing and camera controls, prompt editing, panel versions, dialogue, and generation commands. Section hierarchy should make the primary action obvious without placing cards inside cards.

## Episode Overview

The overview combines `EpisodeDetail` and `ProductionReadiness` into a derived view model. It includes:

- episode title, premise, status, target duration, and calculated shot duration;
- shot, dialogue, panel, speech, and approval counts;
- progress bars for panels, speech, and review;
- exact readiness blockers;
- compact shot thumbnails that select the shot and open the inspector;
- direct commands to open production, review blockers, or render when ready.

The overview does not introduce a new API. It uses existing episode and readiness responses.

## Storyboard

The storyboard preserves scene grouping but improves scanning:

- scene headers remain compact and sticky within the scrolling area where practical;
- shot cards use a stable image aspect ratio and fixed metadata regions;
- status appears as small icon-backed badges rather than large labels;
- selected, missing, failed, and approved states are visually distinct;
- cards do not resize when status or loading state changes;
- repeated actions remain in the inspector instead of crowding every card.

## Production And Review

The production area retains all v0.3 behavior: stage selection, concurrency 1-4, regeneration options, start, pause, continue, counters, filters, selected retry, persistence, and readiness refresh.

The redesign changes presentation and navigation only. Production items become compact rows with recognizable stage and state icons, target context, attempt count, and inline errors.

The review area derives its contents from the episode graph and readiness blockers. It supports selecting a blocked shot, changing review status through the existing inspector, and returning to overview without losing context.

## Mobile Layout

Mobile uses a single-column workspace with stable navigation:

- a compact sticky toolbar contains brand, project context, and the render command;
- project and episode selectors remain directly below the toolbar;
- a segmented workspace control exposes `总览`, `分镜`, `生产`, and `检查器`;
- the inspector replaces the center view instead of overlapping it;
- all controls remain reachable within the viewport and no toolbar content overlaps;
- shot cards use two columns on standard phones and one column only when width requires it.

## Component Changes

Create or substantially revise the following frontend boundaries:

- `EpisodeOverview`: derives and renders episode production status.
- `WorkspaceTabs`: desktop and mobile work-area navigation.
- `StatusMetric`: reusable compact progress metric.
- `ReadinessBlockers`: exact blocker summary with navigation actions.
- `AppToolbar`: clearer global command hierarchy.
- `ProjectNavigator`: project resources and improved episode state.
- `Storyboard` and `ShotCard`: stable, image-first scanning.
- `Inspector`: grouped operational sections.
- `ProductionPanel` and `ProductionItemRow`: modern queue presentation.

`Workspace` remains the orchestration boundary for loaded project, episode, selected shot, current work area, and readiness refresh.

## Data Flow

1. `Workspace` loads projects, the selected project, and the selected episode.
2. Episode loading also requests production readiness.
3. `Workspace` derives overview metrics from the episode graph and readiness response.
4. Selecting a shot from overview, storyboard, production, or review updates one shared selected-shot ID.
5. Manual shot edits and terminal production runs refresh episode and readiness state.
6. Render availability is derived only from the latest readiness response.

No new persistence or backend endpoint is required.

## Error And Empty States

- API connectivity errors appear near the affected work area and preserve the last usable state.
- Empty projects and episodes use focused creation states with one primary command.
- Provider failures remain attached to production items and jobs.
- Missing assets and review blockers link to the affected shot.
- Loading uses stable skeleton regions or fixed-height status indicators to prevent layout movement.
- Disabled commands include concise tooltips explaining the blocker.

## Accessibility

- Preserve semantic buttons, headings, labels, progress elements, and form controls.
- All icon-only commands have accessible names and visible tooltips.
- Keyboard focus uses a clear high-contrast ring.
- Status is communicated by text or icon as well as color.
- Text and controls meet practical contrast requirements across light surfaces.

## Testing And Verification

### Component Tests

- overview metric and blocker derivation;
- workspace tab switching and shot selection persistence;
- render readiness state;
- production run restoration and retry readiness refresh;
- review filtering and inspector navigation;
- empty and connectivity states.

### End-To-End

- desktop overview to storyboard, production, review, and inspector workflow;
- mobile navigation between all four work areas;
- production retry enabling render;
- shot selection from overview and production opening the same inspector context.

### Visual Verification

- production build and TypeScript check;
- Playwright screenshots at desktop, tablet, and phone widths;
- checks for overflow, text clipping, toolbar overlap, blank media, and unstable card dimensions;
- retain the existing deterministic API and compositor test suites.

## Non-Goals

- Backend API or database changes.
- Timeline editing.
- New model providers.
- Multi-episode scheduling.
- Automatic visual approval.
- A marketing landing page.
