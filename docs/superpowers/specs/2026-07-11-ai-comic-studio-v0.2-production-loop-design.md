# AI Comic Studio v0.2 Production Loop Design

## Goal

Turn the v0.1 workspace from a visually verified demonstration into a usable local production application backed by the existing FastAPI, SQLite, MiniMax, GPT Image, Qwen3-TTS, Remotion, and FFmpeg services.

Version v0.2.0 must support a complete, review-driven path from project creation through MP4 export. It does not add authentication, collaboration, Redis, automatic publishing, or an image-to-video provider.

## User Workflow

The primary workflow is:

```text
Create or select project
-> maintain story and character data
-> create episode brief
-> run MiniMax episode planning
-> review generated scenes, shots, and dialogue
-> generate and select panel versions
-> generate dialogue speech
-> edit shot production settings
-> render episode
-> inspect and download MP4
```

Each generation stage remains an explicit user action. The application must surface job progress and failures without silently advancing to the next stage.

## Product Decisions

### Real Data First

The workspace loads projects and episodes from FastAPI. Demo content remains available only as an empty-state sample and is never treated as persisted production data.

The selected project and episode live in React state. The current selection may be retained in browser storage, but generated assets, scripts, job state, and provider configuration remain server-owned.

### Review Before Automation

v0.2.0 does not provide a one-click unattended production pipeline. Planning, panel generation, speech generation, and rendering are separate commands. This preserves shot-level review and makes failures recoverable.

### Poll Persisted Jobs

Long-running operations return persisted job resources. The web application polls the existing job endpoint while a job is queued or running, stops on success or failure, refreshes affected resources after success, and exposes a retry command for failed jobs.

Polling starts at one second and backs off to three seconds after ten attempts. A client-side timeout stops polling after ten minutes but does not mutate the server job.

## Frontend Architecture

### API Client

`apps/web/lib/api.ts` becomes the typed boundary for all workspace operations:

- list and create projects;
- load project details and characters;
- create episodes and load episode graphs;
- start planning, panel, speech, and render jobs;
- list panel versions and select the active asset;
- inspect and retry jobs;
- obtain render artifact URLs.

The client normalizes API errors into a message, HTTP status, and optional server detail. UI components do not construct endpoint URLs directly.

### Workspace Controller

`Workspace` owns the production selection and resource lifecycle:

- project list and selected project;
- episode list and selected episode graph;
- selected shot and dialogue line;
- loading, empty, and error states;
- active jobs keyed by operation and target ID;
- resource refresh after successful jobs.

Domain-specific controls remain in focused components. `Workspace` coordinates them but does not contain provider request details.

### Views

The desktop keeps the current three-column layout.

- Navigator: projects, episodes, creation commands, and planning status.
- Storyboard: scenes, shots, active panels, review state, and per-shot generation status.
- Inspector: shot settings, panel versions, dialogue lines, speech controls, and job errors.
- Toolbar: provider health, render command, render progress, and output download.

Mobile retains the storyboard/inspector segmented navigation. Project and episode selection remain accessible above the storyboard rather than becoming a permanently visible third pane.

## Backend Additions

The existing models and provider services remain authoritative. v0.2 adds only API capabilities required by the real workspace:

- list projects with their episodes;
- update project, character, episode, shot, and dialogue editable fields;
- list a shot's panel asset versions and activate a selected version;
- return render assets through stable `/media` URLs;
- retry supported failed jobs using their persisted operation and target;
- include enough job result metadata for the frontend to refresh the correct resource.

Update routes use explicit Pydantic patch schemas. Unknown fields are rejected. Provider secrets never enter response schemas or job payloads.

## Production Editing

v0.2 supports the fields needed to finish an episode without redesigning the domain model:

- Project: title, logline, story bible, visual style.
- Character: name, role, appearance bible, personality, continuity rules, negative constraints, TTS speaker, default voice instruction.
- Episode: title, premise, target duration, aspect ratio.
- Shot: duration, camera motion, composition, image prompt, negative prompt, review status.
- Dialogue: text, emotion, performance instruction, subtitle text.

Edits save explicitly. The UI displays saving and saved states and retains unsaved input after a failed request.

## Job Behaviour

Planning success reloads the episode graph and selects the first generated shot.

Panel generation success reloads the shot's asset versions and selects the newest active panel. Regeneration never overwrites an older asset.

Speech generation success reloads the dialogue line and exposes an audio player using the persisted media path.

Render success exposes the MP4 asset, FFmpeg verification metadata, and download action. Render failure keeps the episode editable and displays sanitized error text.

Only one active job of the same operation may be launched for the same target from the UI. The server remains responsible for authoritative job state.

## Error Handling

The application distinguishes:

- connectivity failure: API unavailable or request timed out;
- validation failure: editable fields remain visible with server detail;
- provider failure: job card displays the sanitized provider error and retry action;
- stale resource: reload the selected resource and notify the user;
- missing media: keep metadata visible and offer regeneration.

Errors appear near the command that caused them. A compact global status area is reserved for API connectivity and provider health, not ordinary form validation.

## Testing

### FastAPI

Add contract tests for list and patch routes, asset version activation, retry validation, render media metadata, and secret redaction. Existing provider contract tests remain unchanged unless an endpoint requires additional result metadata.

### React

Use Vitest and Testing Library for project loading, empty states, selection changes, job polling, successful refresh, failed-job retry, unsaved edit preservation, and render download visibility.

### End-to-End

Use Playwright with deterministic API fixtures for the complete production flow on desktop and the primary selection/edit flow on mobile. Live provider tests remain opt-in and must not run as part of ordinary E2E.

### Release Gates

v0.2.0 is ready when:

- a new local database can create a project and episode from the web UI;
- episode planning replaces the empty graph with persisted scenes and shots;
- a shot can generate multiple panel versions and activate one;
- a dialogue line can generate playable speech;
- a user can edit shot production settings and retain them after reload;
- rendering produces a verified downloadable MP4;
- queued, running, succeeded, and failed jobs are visible and recoverable;
- API tests, frontend tests, compositor tests, builds, E2E, and a deterministic render pass;
- source manifests report version `0.2.0` and no secret is committed.

## Non-Goals

- Automatic batch generation for an entire episode.
- Timeline drag-and-drop or multitrack editing.
- Character voice cloning with the Qwen Base model.
- Cloud deployment, accounts, or multi-user access.
- Social publishing.
- Arbitrary image-to-video generation.
