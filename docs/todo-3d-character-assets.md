# TODO: 3D Character Assets and Director Integration

## Status

- Priority: Active
- Current state: The director uses a visible standard-humanoid skeleton and low-poly body proxy by default, supports persistent proxy body proportions plus shot-scoped pose and procedural animation controls, loads validated GLB character and prop assets as optional upgrades, resolves master, episode-variant, and shot-state models deterministically, and persists transforms and cameras. Backgrounds may remain images.
- Shot binding traceability: Each `AssetVariantUsage` persists its effective variant, state, 3D representation and version, linked director object, resolution status, and refresh timestamp. Mutation paths refresh these bindings when lineage, models, or director objects change.
- Current generation path: `model3d` jobs use the hosted fal.ai TripoSR adapter. Local references are uploaded to fal CDN over HTTP, generated GLBs are downloaded and validated, and candidates require explicit approval before activation.
- Remaining boundary: AI generation currently uses one selected reference image. Rig repair, multi-view reconstruction, decimation, texture optimization, and editable state-level material or geometry overrides remain open.

## Goal

Connect character assets to the 3D director through a reusable 3D representation while preserving the existing lineage:

`Project master -> Episode variant -> State -> Shot/director instance`

The first target is composition-quality proxy characters, not final cinematic models. The director should provide reliable scale, blocking, pose, occlusion, camera, and framing data for downstream image generation.

## Recommended Pipeline

```text
Character text and reference images
-> front/side/back views
-> generated or uploaded 3D mesh
-> validation, repair, and decimation
-> skeleton/rig
-> GLB or VRM export
-> character asset representation
-> episode variant and state overrides
-> director scene instance
-> preview/depth/pose guidance for image generation
```

Candidate generation services and models to evaluate:

- Meshy API
- Tripo AI API
- Hyper3D Rodin
- Tencent Hunyuan3D for self-hosting
- Microsoft TRELLIS for self-hosted research and prototyping
- Stable Fast 3D or TripoSR for lightweight proxy generation
- Mixamo or AccuRIG for automatic human rigging

Exact versions, API contracts, licensing, prices, and output quality must be verified before provider integration.

## Phase 1: Upload and Proxy Characters

- [x] Define a dedicated `Character3DRepresentation` persistence model instead of storing the complete representation in variant JSON overrides.
- [x] Link a representation to a character master and optionally to an episode variant or state.
- [x] Support GLB upload first; evaluate VRM as an additional character-specific format.
- [x] Validate media type, file signature, size, geometry complexity, external resource references, and archive/path safety.
- [ ] Store model dimensions, bounding box, scale, skeleton status, material summary, checksum, version, and preview asset.
- [x] Add a standard low-poly humanoid proxy when no generated or uploaded model exists.
- [x] Add 3D representation controls to the character asset workspace.
- [x] Add a browser model preview with loading, error, and fallback states.
- [ ] Preserve model references through recycle-bin restore and block unsafe permanent deletion.

Acceptance criteria:

- A character can have a project-level GLB representation.
- The asset page can preview it.
- The director can instantiate it at the correct scale.
- Missing or invalid models fall back to a visible proxy without breaking the scene.

## Phase 2: Lineage and Director Instances

- [x] Allow episode variants to inherit or replace the master representation.
- [ ] Allow states to override materials, accessories, injury markers, visibility, and proportions where supported.
- [x] Extend shot usages to record the effective character variant, state, representation version, and director object.
- [ ] Add an asset picker when inserting a character into a director stage.
- [x] Replace primitive character rendering in `DirectorObject` with cached GLTF/GLB loading.
- [x] Support translate, rotate, and scale transform modes.
- [ ] Add rename, visibility, duplicate, and delete operations.
- [ ] Surface downstream impact when a representation or inherited variant changes.
- [x] Keep placeholder objects available for props and unfinished assets.

Acceptance criteria:

- A shot can reference an episode-specific character state.
- The director resolves the effective inherited model deterministically.
- Updating a model reports every affected scene and shot.
- Existing director stages continue to load after the migration.

## Phase 3: Rig, Pose, and Camera Controls

- [ ] Detect and describe skeletons and animation clips during upload processing.
- [x] Define a normalized humanoid bone mapping for supported models.
- [x] Provide a reusable pose library.
- [x] Add an animation clip picker for the standard humanoid proxy.
- [ ] Complete animation timeline scrubbing and explicit reset; pose application plus playback and pause are available for the standard proxy.
- [ ] Add basic facial expression or blend-shape controls when available.
- [ ] Add gaze target and head direction controls.
- [x] Expand camera editing to position, target, rotation, focal length, clipping range, shot size, and motion metadata.
- [ ] Add environment, background, ground, and light controls.
- [x] Connect the existing director undo/redo state to the actual workspace.
- [ ] Expose revision history, restore, and optimistic-lock conflict handling in the UI.

Acceptance criteria:

- Users can block multiple rigged characters and apply poses.
- Camera and object edits are persisted and recoverable.
- Revision restore creates a new state without silently overwriting current work.

## Phase 4: Downstream Image Guidance

- [x] Include the selected character variant and state in panel-generation context.
- [x] Capture a clean director composition preview without editor overlays.
- [ ] Generate optional depth, silhouette, object-mask, and skeleton-pose guidance images.
- [x] Translate camera parameters and object positions into structured generation metadata.
- [x] Continue passing approved 2D character references for identity and visual-style consistency.
- [x] Store the director stage and representation versions used by every generated panel.
- [ ] Mark panels stale when relevant director or character inputs change.

Acceptance criteria:

- Panel generation receives both 2D identity references and 3D composition guidance.
- Generated assets record enough provenance to reproduce or audit the result.
- Model updates do not silently change already approved panels.

## Optional Phase 5: AI 3D Generation

- [x] Add a `model3d` model-runtime capability and provider contract.
- [x] Implement at least one hosted provider adapter before considering self-hosting.
- [ ] Support image-to-3D generation from approved multi-view character references.
- [x] Persist asynchronous generation jobs, progress, retryability, provider metadata, and sanitized failures.
- [x] Validate and normalize generated outputs before they become selectable assets.
- [ ] Add repair, decimation, texture optimization, and thumbnail processing.
- [x] Require explicit user approval before replacing an active character representation or project prop model.

This phase is optional because uploaded models and standard proxies are sufficient for the initial director workflow.

## Expected Code Areas

Backend:

- `services/api/comic_studio/models.py`
- `services/api/comic_studio/schemas.py`
- `services/api/comic_studio/routes/assets.py`
- `services/api/comic_studio/routes/asset_lineage.py`
- `services/api/comic_studio/routes/director.py`
- `services/api/comic_studio/services/asset_lineage.py`
- `services/api/comic_studio/services/director_stages.py`
- `services/api/comic_studio/services/panels.py`
- `services/api/comic_studio/model_runtime/`
- `services/api/alembic/versions/`

Frontend:

- `apps/web/components/CharacterWorkspace.tsx`
- `apps/web/components/canvas/AssetLineageCanvas.tsx`
- `apps/web/components/director/DirectorObject.tsx`
- `apps/web/components/director/DirectorCanvas.tsx`
- `apps/web/components/director/DirectorWorkspace.tsx`
- `apps/web/components/director/DirectorInspector.tsx`
- `apps/web/lib/api.ts`
- `apps/web/lib/types.ts`
- `apps/web/lib/director-state.ts`

## Test Requirements

- [x] Database migration and relationship tests.
- [x] Upload validation and malicious-file tests.
- [x] Asset inheritance and effective-representation resolution tests.
- [ ] Reference impact, recycle-bin restore, and permanent-delete protection tests.
- [x] GLB loading, cache, fallback, and disposal tests.
- [x] Director transform, pose, camera, and undo/redo tests.
- [ ] Director optimistic-lock conflict and revision-restore tests.
- [ ] Panel-generation context and provenance tests.
- [x] Desktop and mobile browser acceptance checks.
- [x] WebGL screenshots and nonblank canvas pixel checks at representative viewports.
- [ ] Performance checks with multiple characters and bounded model complexity.

## Decisions Needed Before Implementation

- [x] GLB only for the first release; VRM remains deferred.
- [x] Hosted fal.ai TripoSR generation plus manual upload for the first release.
- [x] Enforce 50 MiB, 2,000,000 triangles, 1,000 nodes, 200 meshes, and 200 materials; texture-specific limits remain open.
- [x] Standard humanoid skeleton definition and reusable pose mapping.
- [ ] Supported non-human character policy and quadruped/bird rig templates.
- [ ] Whether episode variants replace complete models or primarily apply materials/accessories.
- [x] Treat current 3D output as composition and camera guidance, not final rendered footage.
