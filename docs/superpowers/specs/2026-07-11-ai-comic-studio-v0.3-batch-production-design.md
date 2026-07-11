# AI Comic Studio v0.3 Batch Production Design

## Goal

Version v0.3.0 adds a recoverable episode production queue on top of the review-driven v0.2 workflow. A creator can generate all missing panel and dialogue assets for one episode, observe item-level progress, pause scheduling, continue later, retry failures, and render only when the required assets are ready.

The system remains a local web application. It does not add Redis, cloud workers, accounts, social publishing, or unattended multi-episode scheduling.

## Product Workflow

```text
Open a planned episode
-> inspect production readiness
-> choose panel, speech, or both
-> start production run
-> process eligible items with bounded concurrency
-> pause or continue scheduling
-> inspect succeeded, skipped, and failed items
-> retry failed items
-> approve required panels
-> render episode
```

A production run never overwrites immutable assets. It creates missing panel or speech versions through the existing services and keeps item-level evidence for every decision.

## Eligibility Rules

### Panels

A shot is skipped as already ready when it has an active panel asset and the shot review status is `approved`.

A shot is eligible when it has no active panel, its current panel is not approved, or the user explicitly enables regeneration. Default batch production does not regenerate an approved shot.

Generated panels use `activate=true`, but the shot remains `draft` or `needs_changes` until the creator approves it. Asset generation does not imply visual approval.

### Speech

A dialogue line is skipped when it has an audio asset and a positive duration. It is eligible when either value is missing, or when explicit regeneration is enabled.

Speech success updates the dialogue line through the existing `SpeechService` contract.

### Rendering

An episode is render-ready only when every shot has an active panel, every shot is approved, and every non-empty dialogue line has playable audio. The readiness endpoint reports exact blockers instead of returning a single boolean.

## Domain Model

### ProductionRun

Represents one user-requested batch operation.

- `id`, `episode_id`, and `status`.
- requested stages: `panels`, `speech`, or both.
- `concurrency` from 1 through 4, default 2.
- regeneration flags for panels and speech.
- counters for total, queued, running, succeeded, failed, and skipped items.
- pause flag, timestamps, and sanitized summary error.

Run statuses are `queued`, `running`, `paused`, `completed`, and `completed_with_failures`. A run can move from queued/running to paused, paused to running, and terminal failure items can be retried by creating a new retry attempt inside the same run.

### ProductionItem

Represents one panel or speech operation.

- `id`, `run_id`, `stage`, `target_type`, and `target_id`.
- deterministic order based on scene, shot, and dialogue positions.
- status: `queued`, `running`, `succeeded`, `failed`, or `skipped`.
- attempt count, result metadata, sanitized error, and timestamps.

The database enforces one item per run, stage, and target. A retry resets only failed items and increments their attempt count.

## Execution Architecture

The FastAPI process owns a local `ProductionCoordinator`.

1. Creating a run performs a database snapshot of eligible and skipped items.
2. The run is persisted before any provider call starts.
3. A background coordinator claims queued items in deterministic order.
4. At most `concurrency` items run simultaneously.
5. Panel items call `PanelService.generate_panel(..., activate=True)`.
6. Speech items call `SpeechService.synthesize_dialogue(...)`.
7. Each item commits its own terminal state so one failure cannot roll back other items.
8. Run counters are derived from persisted items after every terminal transition.
9. The run becomes `completed` or `completed_with_failures` when no queued/running items remain.

The coordinator is intentionally in-process for v0.3. Persisted state makes runs inspectable after browser refresh. On API startup, runs left in `running` are changed to `paused`; the user must explicitly continue them. The application does not pretend to resume provider calls that were interrupted by process termination.

## Pause and Continue

Pause is cooperative. It prevents the coordinator from claiming new items but does not terminate provider requests already running. Those items are allowed to finish and persist their results.

Continue changes a paused run to running and schedules the coordinator again. Multiple continue requests are idempotent and must not start duplicate work for the same item.

## Failure and Retry

Provider and persistence failures are recorded on the affected item with recursively redacted errors. Remaining queued items continue.

The UI can filter to failed items and retry all or selected failures. Retry is accepted only for terminal runs and failed items. Successful and skipped items remain unchanged.

If a target was deleted after run creation, its item fails with a stable `target_missing` category. If the target already became ready through another action, the coordinator marks it skipped at claim time.

## API

```text
GET  /api/episodes/{episode_id}/production-readiness
POST /api/episodes/{episode_id}/production-runs
GET  /api/production-runs/{run_id}
GET  /api/production-runs/{run_id}/items
POST /api/production-runs/{run_id}/pause
POST /api/production-runs/{run_id}/continue
POST /api/production-runs/{run_id}/retry
```

Run creation accepts stages, concurrency, and regeneration flags. Retry accepts an optional list of failed item IDs; omission retries every failed item.

Run responses include counters and current status. Item responses include target labels needed by the UI but exclude provider request payloads, API keys, and raw filesystem paths.

## User Interface

The toolbar gains a production command distinct from final rendering. It opens an unframed production panel within the center workspace rather than a nested modal card.

The production panel contains:

- readiness summary for panels, speech, approvals, and render blockers;
- stage checkboxes;
- a concurrency stepper from 1 to 4;
- regeneration toggles defaulting off;
- start, pause, continue, and retry-failed commands;
- stable counters and a progress bar;
- filter tabs for all, running, failed, and completed items;
- compact rows showing scene/shot/dialogue position, stage, status, attempt, and error.

The storyboard remains usable while a run is active. Shot cards display panel/speech activity without changing size. Selecting an item in the production panel selects its shot in the existing workspace.

Mobile shows the production panel as another segmented workspace view alongside storyboard and inspector. Controls remain reachable without overlapping the toolbar.

## Error Handling

- API unavailable: keep the last run snapshot and show connectivity failure.
- Coordinator interrupted: mark the run paused on startup and require continue.
- Provider failure: fail only the affected item and continue scheduling.
- Invalid transition: return HTTP 409 with the current run state.
- Duplicate start: permit separate historical runs, but reject a new active run for the same episode with HTTP 409.
- Missing target: record item failure without exposing internal exceptions.
- Render attempted before ready: return HTTP 409 with structured blockers.

## Testing

### FastAPI

- eligibility and skip rules;
- deterministic item ordering;
- concurrency limit;
- partial failure continuation;
- cooperative pause and idempotent continue;
- startup recovery to paused;
- retry-all and selected retry;
- deleted-target handling;
- readiness blocker accuracy;
- active-run conflict and transition validation;
- secret redaction in item errors.

Provider calls use injected fakes for deterministic unit and integration tests. Live provider checks remain opt-in.

### React

- readiness loading and blocker display;
- production option defaults;
- start and progress polling;
- pause and continue commands;
- status filters and failed-item selection;
- retry-all and selected retry;
- selecting a production item selects the corresponding shot;
- render command disabled until readiness passes;
- mobile production view layout.

### End-to-End

Playwright uses deterministic API fixtures to validate a mixed run with skipped, succeeded, and failed items, followed by selected retry and render readiness. Desktop and mobile layouts are both checked.

## Release Gates

v0.3.0 is ready when:

- a planned episode can create a persisted production run;
- default runs skip approved panels and completed speech;
- configured concurrency is never exceeded;
- one failed item does not stop later items;
- pause stops new claims and continue resumes queued work;
- browser refresh reloads the current persisted run;
- failed items can be retried without rerunning successful items;
- readiness reports exact panel, approval, and speech blockers;
- render is blocked until readiness succeeds;
- manifests report version `0.3.0`;
- API, web, compositor, build, E2E, deterministic render, and opt-in live smoke checks pass;
- no secret is committed or returned by production APIs.

## Non-Goals

- Distributed workers or Redis queues.
- Multiple simultaneous active runs for one episode.
- Automatic approval of generated panels.
- Multi-episode or scheduled overnight production.
- Timeline drag-and-drop editing.
- Social publishing or cloud deployment.
