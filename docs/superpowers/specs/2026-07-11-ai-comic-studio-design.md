# AI Comic Studio Design

## Product Goal

Build a local web application for producing serialized Chinese dynamic comics. The first release must let a creator manage a project and characters, turn an episode idea into structured scenes and shots, generate comic panels, assign character voices, review assets, and render a vertical video without requiring a cloud deployment.

The application is a production workspace, not a one-click black box. Every generated artifact remains inspectable and replaceable at the shot level.

## MVP Scope

The MVP supports this production path:

```text
Project and story bible
-> Character profiles
-> Episode brief
-> Structured script
-> Scenes and shots
-> Comic panel generation
-> Character dialogue audio
-> Shot review and regeneration
-> Remotion dynamic composition
-> MP4 export
```

The MVP includes:

- Local project creation and persistence.
- Story bible, visual style, and character profile management.
- Episode creation from a title, premise, target duration, and aspect ratio.
- MiniMax-M3 generation of structured scripts, scenes, dialogue, and shots.
- GPT Image 2 generation and editing for character references and shot panels.
- Qwen3-TTS speech generation through a service deployed on A800_94.
- Per-character voice assignment and per-line emotion instructions.
- Shot status, generation history, review state, and selective regeneration.
- Remotion composition with panel motion, dialogue bubbles, subtitles, transitions, music slots, and audio timing.
- Final FFmpeg-compatible MP4 output.
- A provider health screen that verifies configured services without exposing credentials.

The MVP excludes:

- Team accounts, authentication, permissions, and cloud deployment.
- Real-time collaborative editing.
- Full character animation or arbitrary body motion.
- A fake image-to-video capability through text-only chat endpoints.
- Automatic publishing to social platforms.
- A generalized plugin marketplace.

## Confirmed Model Stack

### Script and Story Planning

- Provider: MiniMax Anthropic-compatible API.
- Base URL: `https://api.minimaxi.com/anthropic`.
- Model: `MiniMax-M3`.
- Endpoint: `/v1/messages`.
- Responsibilities: story expansion, structured episode script, scene breakdown, shot planning, continuity review, and prompt generation.

The API adapter must request JSON matching application schemas. Invalid responses are retained for diagnostics and retried once with validation feedback.

### Image Generation and Editing

- Provider: internal GPT Image-compatible service.
- Base URL: `http://192.168.18.80:14000`.
- Model: `gpt-image-2`.
- Generation endpoint: `/v1/images/generations`.
- Editing endpoint: `/v1/images/edits`.

The application uses generation for character references and new panels. Editing is used for continuity corrections and targeted revisions. Inputs and outputs are copied into the project asset tree so the project does not depend on temporary remote URLs.

### Text to Speech

- Runtime host: HostBridge target `a800_94`.
- Primary model: `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice`.
- Planned extension: `Qwen/Qwen3-TTS-12Hz-1.7B-Base` for persistent cloned character voices.
- Service contract: HTTP API with health, speaker metadata, synthesis, and audio result endpoints.

The primary model provides Chinese voices and natural-language emotion control. Each character stores a stable speaker selection and default performance instruction. Each dialogue line can override emotion and delivery.

### Dynamic Video

Neither configured chat endpoint exposes an image-to-video model. The MVP therefore uses Remotion animation over generated comic panels. Supported motion includes camera push, pan, layered parallax, shake, focus changes, panel reveals, dialogue bubbles, subtitles, and transitions. FFmpeg handles probing, audio mixing, and final compatibility checks.

Image-to-video is a later provider interface, not an MVP dependency.

## Architecture

```text
Browser
  -> Next.js workspace
      -> FastAPI JSON API
          -> SQLite repositories
          -> Local asset store
          -> Generation job runner
              -> MiniMax-M3
              -> GPT Image 2
              -> Qwen3-TTS service
          -> Remotion render launcher
              -> FFmpeg verification
```

The repository is a monorepo with three executable boundaries:

```text
apps/web/               Next.js user interface
services/api/           FastAPI domain API and generation jobs
packages/compositor/    Remotion compositions and render entrypoint
```

Development uses SQLite and a filesystem asset store. Provider calls run as persisted jobs inside the FastAPI process for the MVP. The job contract is designed so a later worker and Redis queue can replace the in-process runner without changing UI APIs.

## Domain Model

### Project

Stores title, logline, story bible, visual style, default aspect ratio, language, and creation timestamps.

### Character

Stores project ownership, name, role, appearance bible, personality, continuity rules, negative constraints, reference images, TTS speaker, and default voice instruction.

### Episode

Stores project ownership, title, premise, target duration, status, source brief, structured script version, and render state.

### Scene

Stores episode ownership, order, location, time, summary, participating character IDs, continuity state, and estimated duration.

### Shot

Stores scene ownership, order, shot type, duration, composition, camera motion, character state, dialogue lines, image prompt, negative prompt, active panel asset, review status, and render status.

### Dialogue Line

Stores shot ownership, character ID, text, emotion, performance instruction, generated audio asset, timing, and subtitle text.

### Asset

Stores project ownership, asset kind, local path, MIME type, dimensions or duration, provider, model, request metadata, parent asset, generation attempt, checksum, and review state.

### Job

Stores operation type, target entity, status, progress, request payload, result metadata, error details, timestamps, and retry count.

## Filesystem Layout

Generated files live outside source directories:

```text
data/
├── studio.db
└── projects/<project-id>/
    ├── characters/<character-id>/
    ├── episodes/<episode-id>/
    │   ├── scripts/
    │   ├── panels/<shot-id>/
    │   ├── audio/<dialogue-id>/
    │   └── renders/
    └── imports/
```

No API key is stored in SQLite, generated metadata, browser storage, logs, or project files.

## API Boundaries

The FastAPI service exposes:

- `/api/health` and `/api/providers/health`.
- CRUD endpoints for projects, characters, episodes, scenes, and shots.
- Episode planning endpoint that creates a structured script and shot graph.
- Character reference and shot panel generation endpoints.
- Dialogue synthesis endpoints.
- Job inspection and retry endpoints.
- Episode render endpoint and render artifact download.

Mutation endpoints return persisted resources or jobs. Long-running generation never blocks an HTTP request until model completion.

## User Interface

The first screen is the production workspace, not a marketing page.

The desktop layout has:

- A narrow project and episode navigator on the left.
- A scene and shot timeline in the center.
- A context inspector on the right for the selected character, scene, shot, or dialogue line.
- A restrained top toolbar for project switching, provider health, generation, rendering, and settings.

Primary views:

1. Story: story bible, visual rules, and episode brief.
2. Characters: reference images, appearance constraints, voice assignment, and voice preview.
3. Script: scene structure and dialogue editor.
4. Shots: storyboard grid with generation, review, replacement, and regeneration controls.
5. Timeline: shot duration, dialogue timing, motion preset, transition, and audio overview.
6. Render: job progress, preview, verification report, and MP4 download.

The interface is optimized for repeated production work: compact typography, predictable navigation, keyboard-accessible selection, clear job status, and no decorative landing-page sections.

## Data Flow

### Episode Planning

1. User creates an episode brief.
2. API creates a planning job.
3. MiniMax-M3 receives the story bible, relevant characters, continuity summary, and the target JSON schema.
4. The response is validated and persisted as scenes, shots, and dialogue lines in one transaction.
5. Invalid output is retained in job diagnostics and retried once with validation errors.
6. The user reviews and edits the plan before generating assets.

### Panel Generation

1. The application builds a prompt from project style, character appearance rules, scene continuity, and shot composition.
2. Character references are attached when editing or multi-reference input is required.
3. GPT Image 2 generates or edits a panel.
4. The response is downloaded to the project asset store and registered as a new immutable asset version.
5. The user selects which version is active.

### Dialogue Generation

1. A dialogue job resolves the character speaker and combines default and line-specific performance instructions.
2. The Qwen3-TTS service synthesizes WAV audio.
3. The API stores the file, probes its duration, and updates the dialogue line.
4. Shot duration warnings appear when dialogue does not fit.

### Rendering

1. The API creates a stable render manifest from the current approved shots and assets.
2. The compositor renders a portrait or landscape Remotion composition.
3. FFmpeg probes the output for duration, streams, dimensions, codec, and playability.
4. The render job stores the verification report and exposes the output only when verification succeeds.

## Error Handling

- Provider timeouts and transport failures become failed jobs with sanitized error details.
- Authentication failures disable the related generation action and point to server-side environment configuration.
- Invalid structured LLM output is never partially persisted.
- Missing assets block render manifest creation with shot-specific errors.
- Failed generation attempts never replace the active asset.
- Render failures retain the manifest and logs for deterministic retry.
- The UI polls persisted job state, so browser refresh does not lose progress.

## Security

- All credentials come from server-side environment variables.
- API responses and logs redact authorization headers and known secret formats.
- Local asset paths are resolved under the configured data root to prevent traversal.
- Uploaded files are size-limited and validated by content type and media probing.
- Provider health checks return status and latency, never credentials.
- The local API binds to loopback by default.

## Testing Strategy

- Python unit tests cover domain validation, repositories, prompt construction, provider adapters, job transitions, and render manifest generation.
- API integration tests use temporary SQLite databases and asset directories.
- Provider contract tests use local HTTP fakes; a separate opt-in live test verifies configured real services.
- TypeScript tests cover workspace state, shot ordering, duration calculations, and API client behavior.
- Playwright covers the core workflow from project creation through storyboard review with deterministic test providers.
- Remotion tests validate manifest parsing and composition metadata; a smoke render verifies a nonblank playable MP4.

## Delivery Phases

### Phase 1: Production Skeleton

Create the monorepo, persistence, project and character management, episode/scene/shot models, job state machine, and workspace shell.

### Phase 2: Real Generation

Integrate MiniMax-M3, GPT Image 2, deploy Qwen3-TTS, and provide provider health and generation workflows.

### Phase 3: Dynamic Composition

Implement dialogue timing, motion presets, render manifests, Remotion composition, FFmpeg verification, and render UI.

### Phase 4: Workflow Hardening

Add generation history, selective retries, continuity review, end-to-end tests, provider diagnostics, and operational documentation.

## Acceptance Criteria

The MVP is accepted when a user can:

1. Start the application locally and open the production workspace.
2. Create a project, define at least two characters, and assign stable voices.
3. Create an episode brief and generate editable structured scenes, shots, and dialogue through MiniMax-M3.
4. Generate and review character references and shot panels through GPT Image 2.
5. Generate dialogue audio through the deployed Qwen3-TTS service.
6. Regenerate one failed or rejected shot without rebuilding the episode.
7. Render the approved shots into a playable vertical MP4 with motion, dialogue, and subtitles.
8. Refresh the browser without losing projects, assets, or job state.
9. Inspect provider, model, prompt metadata, generation versions, errors, and render verification without exposing secrets.
