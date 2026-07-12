# Lightweight 3D Director Design

## Goal

Version `v0.6.0` adds a lightweight 3D director workspace that turns existing scenes and shots into spatial staging and camera decisions. Users arrange characters, props, backgrounds, and simple lights once per scene, then save a distinct camera setup for each shot. Confirmed camera decisions can update the shot composition, camera motion, and image-prompt draft without replacing production data silently.

This release is a usable 3D previsualization tool, not a complete animation package. Skeletal posing, keyframe animation, material authoring, physics, collaborative editing, and final-quality 3D rendering remain out of scope.

## Product Decisions

- One `DirectorStage` belongs to one existing `Scene` and is shared by all shots in that scene.
- Every shot has its own `ShotCamera`, camera motion, framing guides, and optional shot-level object overrides.
- The main editing target is the current shot, while scene staging remains visible and reusable.
- Three.js placeholder geometry is always available; missing GLB or image resources never produce a blank stage.
- AI staging and composition are suggestions. They create a draft that the user must accept.
- Camera preview images are references for storyboard production, not final panels.
- Desktop supports full spatial editing. Mobile supports preview, shot switching, and numeric parameter adjustment, but not complex drag manipulation.

## User Workflow

The user opens the director workspace from an existing storyboard shot. The workspace loads the shot's scene stage, scene objects, all shot cameras in the scene, current character state, and available character references.

The user may:

1. add or select scene objects;
2. move, rotate, scale, hide, or duplicate objects;
3. switch between world view and the current shot camera;
4. set focal length, framing, target, and camera movement;
5. switch shots through the bottom shot strip without rebuilding the stage;
6. ask AI for an initial stage or composition suggestion;
7. capture a camera preview;
8. save the stage and shot camera;
9. review generated composition and prompt changes;
10. explicitly apply selected changes to the existing shot.

Switching shots autosaves pending camera changes. Switching scenes autosaves both stage and camera changes. A failed save blocks navigation and offers retry.

## Workspace Layout

The desktop workspace has five stable regions:

- top command bar: scene/shot identity, undo, redo, camera preview, and save;
- left object tree: background, characters, props, lights, and add-object command;
- center Three.js stage: world/camera views, transform controls, framing guides, and resource fallbacks;
- right inspector: selected-object transform and state, plus current-camera parameters;
- bottom shot strip: all shots in scene with current camera summary and selection.

The stage is the dominant surface. Side panels remain operational and compact. The UI uses existing studio colors and icon conventions instead of introducing a separate game-editor theme.

## Architecture

```text
Scene
  -> DirectorStage
       -> DirectorObject[]
       -> ShotCamera[] -> Shot
       -> DirectorRevision[]

DirectorStage + current ShotCamera
  -> Three.js runtime state
  -> preview capture
  -> composition suggestion
  -> user confirmation
  -> Shot patch
```

The frontend uses `three`, `@react-three/fiber`, and `@react-three/drei`. Three.js runtime objects are derived from API data; raw Three.js instances are not stored in React application state or sent to the API.

The backend owns canonical stage state, optimistic version numbers, camera state, saved preview assets, and apply history. Existing shot records remain the production source of truth until a director suggestion is applied.

## Data Model

### DirectorStage

- `id`, `scene_id`
- `version`
- `environment`: background color/image, ground style, ambient light
- `created_at`, `updated_at`

There is at most one stage per scene. `version` increments on every successful stage mutation and is required for optimistic writes.

### DirectorObject

- `id`, `stage_id`
- `kind`: `character`, `prop`, `background`, `light`, or `primitive`
- `source_type`: `placeholder`, `character_reference`, `asset`, or `model`
- `source_id`
- `label`, `position`
- `transform`: position, rotation, and scale vectors
- `appearance`, `metadata`, `visible`
- `created_at`, `updated_at`

Character objects may reference existing characters and their active reference assets. The first release renders character references as camera-facing planes or geometric stand-ins. GLB support is optional per object and never required for a valid stage.

### ShotCamera

- `id`, `stage_id`, `shot_id`
- `version`
- `position`, `target`, `rotation`
- `focal_length_mm`, `near`, `far`
- `shot_size`, `camera_motion`
- `framing_guides`, `object_overrides`
- `preview_asset_id`
- `created_at`, `updated_at`

There is one active camera record per shot. `object_overrides` contains only shot-specific visibility, transform, facing, and state overrides; shared object state stays on `DirectorObject`.

### DirectorRevision

- `id`, `stage_id`, `shot_camera_id`
- `stage_snapshot`, `camera_snapshot`
- `reason`: `manual_save`, `ai_suggestion`, `preview_capture`, or `shot_apply`
- `created_at`

Revisions provide bounded undo/redo and recovery. The backend retains the latest 50 revisions per stage, pruning only after a new revision commits successfully.

### DirectorSuggestion

- `id`, `stage_id`, `shot_id`
- `kind`: `stage_layout` or `shot_composition`
- `status`, `request_context`, `suggested_patch`
- `error_category`, `error`
- `created_at`, `applied_at`

Suggestions remain separate from canonical stage and shot records until accepted.

## API Design

- `GET /api/scenes/{scene_id}/director-stage`
- `POST /api/scenes/{scene_id}/director-stage`
- `PATCH /api/director-stages/{stage_id}`
- `POST /api/director-stages/{stage_id}/objects`
- `PATCH /api/director-objects/{object_id}`
- `DELETE /api/director-objects/{object_id}`
- `GET /api/director-stages/{stage_id}/shots`
- `PUT /api/director-stages/{stage_id}/shots/{shot_id}/camera`
- `POST /api/director-stages/{stage_id}/shots/{shot_id}/preview`
- `POST /api/director-stages/{stage_id}/suggestions`
- `POST /api/director-suggestions/{suggestion_id}/apply`
- `POST /api/director-stages/{stage_id}/shots/{shot_id}/apply-to-shot`
- `GET /api/director-stages/{stage_id}/revisions`
- `POST /api/director-stages/{stage_id}/revisions/{revision_id}/restore`

Stage and camera mutations include `expected_version`. Stale versions return `409 director_version_conflict` with the latest canonical state. Apply-to-shot accepts explicit fields so the user may apply composition without applying prompt or camera motion.

## AI And Model Requirements

No new model provider is required for `v0.6.0`.

The configured MiniMax LLM receives trusted project, scene, character, shot, and existing stage context. It returns a strict layout or composition patch with object identifiers, transforms, camera settings, rationale, and warnings. It never returns executable Three.js code.

The configured image model remains available for character and environment references through existing asset flows. It is not called automatically when the director workspace opens.

Future versions may require:

- 3D asset generation or retrieval for GLB models;
- pose or motion generation;
- depth estimation or image-to-3D reconstruction.

Those integrations are not prerequisites for this release.

## Preview And Shot Application

Camera preview uses the active Three.js camera and a bounded render target. The browser uploads a PNG preview through a director-specific endpoint; the backend stores it below the project data root and registers an `Asset` linked to the shot camera.

The composition suggestion contains proposed values for:

- `composition`;
- `camera_motion`;
- `image_prompt`;
- optional `negative_prompt` additions.

The UI displays a field-level diff. Applying selected fields creates a director revision and updates the shot in one transaction. Existing generated panel and video assets are not deleted or regenerated automatically.

## Error Handling

- WebGL initialization failure shows a diagnostic state and keeps numeric camera/object editing available.
- Failed textures or models render deterministic placeholders and identify the failed resource in the inspector.
- Save conflicts preserve local edits and offer reload or save-as-new-revision.
- AI suggestion failure leaves canonical stage and camera data unchanged.
- Preview upload failure does not roll back stage or camera saves.
- Unsafe preview paths are rejected through the existing data-root containment pattern.
- Scene or shot deletion cascades director records and removes registered preview assets through explicit cleanup.
- Provider errors and filesystem paths are redacted from API responses.

## Testing

Backend tests cover migrations, one-stage-per-scene constraints, object CRUD, camera uniqueness, optimistic conflicts, revision pruning, suggestion validation, transactional shot application, deletion cascades, preview containment, and legacy project compatibility.

Frontend tests cover object selection, transform editing, world/camera switching, shot switching, autosave, blocked navigation, undo/redo, suggestion review, field-level application, WebGL failure, and resource fallback.

Playwright tests run desktop and mobile workflows. Desktop canvas verification checks nonblank pixels, framing, camera movement, object manipulation, screenshot output, and absence of UI overlap. Mobile verifies preview, shot switching, and numeric controls without enabling unsupported drag interactions.

Real runtime verification opens an existing project, stages a real scene, saves multiple shot cameras, captures a preview, applies selected composition fields, and confirms that existing production assets remain intact.

## Acceptance Criteria

- A storyboard shot can open its scene in the 3D director workspace.
- Scene objects persist and are shared across shots in the same scene.
- Each shot persists an independent camera and shot-level object overrides.
- The stage remains usable with no external 3D model assets.
- AI layout and composition suggestions require explicit acceptance.
- Camera previews persist as project assets and survive reload.
- Applying a director suggestion updates only selected shot fields.
- Existing panel, video, speech, and render assets are not regenerated automatically.
- Save conflicts, WebGL failures, and resource failures produce recoverable visible states.
- API, component, Playwright, pixel, build, and real-runtime checks pass before release `v0.6.0`.
