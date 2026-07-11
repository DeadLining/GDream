# AI Comic Studio Compact Overview Design

## Goal

Replace the current sparse episode overview with a compact production dashboard that brings episode identity, progress, blockers, and the shot wall into the first viewport.

## Layout

The overview uses four vertical regions:

1. A compact 104px episode header with episode number, status, target duration, title, premise, and two commands.
2. One row of three equal progress metrics for panels, speech, and review.
3. A short blocker strip using compact status labels.
4. A dense shot wall that fills the remaining space and opens the shared inspector.

The primary commands are `打开生产` and `处理阻塞项`. The first opens production. The second follows the existing responsive review behavior: desktop opens review, while mobile selects the first blocked shot and opens the inspector.

## Visual Treatment

- Remove the oversized title and large unused vertical gaps.
- Replace browser-default progress appearance with a consistent custom track and fill.
- Keep metric surfaces shallow and equal in height.
- Use real shot images as the strongest visual signal.
- Show shot number and review/readiness state over the image without resizing the card.
- Keep shot metadata to one compact row and a two-line description.
- Use existing studio tokens, contrast rules, focus styles, and 4-8px corner radii.

## Responsive Behavior

- Desktop: three metrics in one row and up to six compact shot cards in the first viewport.
- Tablet: three metrics remain in one row; shot count adapts through the existing minmax grid.
- Mobile: header actions wrap, metrics stack or scroll without horizontal overflow, and shot cards retain the existing two-column/one-column breakpoints.

## Data And Components

No API changes are required. Continue using `EpisodeDetail`, `ProductionReadiness`, and `deriveEpisodeOverview`.

Revise:

- `EpisodeOverview` for the new vertical hierarchy and commands.
- `StatusMetric` for custom visual progress while preserving semantic progress behavior and the zero-total empty state.
- `ReadinessBlockers` for a compact blocker strip.
- overview-specific CSS only.

Do not change Workspace state, production behavior, review routing, ShotCard, or Inspector.

## Testing

- Component tests verify compact episode metadata, three metrics, blocker commands, and shot selection.
- Zero-total metrics remain semantically accurate.
- Desktop, tablet, and mobile screenshots verify first-viewport shot visibility, no overlap, no horizontal overflow, and readable labels.
- Existing Web tests, production build, and responsive E2E remain green.
