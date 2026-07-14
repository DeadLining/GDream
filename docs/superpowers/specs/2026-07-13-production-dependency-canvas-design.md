# Production Dependency Canvas Design

## Objective

Replace the current form-and-list production page with an episode-level dependency canvas based on the approved PNG layout and the proven canvas architecture in `LocalMiniDrama-main`.

The canvas must preserve the existing production APIs and add a visual representation of:

`asset inputs -> shot -> panel -> speech/video -> review`

ComfyUI is an execution engine bound to panel and video nodes. It does not replace the product-level canvas.

## Approved Product Model

- The canvas scope is one episode.
- Every shot is a peer at the same hierarchy level.
- Scenes are movable and collapsible visual group frames, not workflow levels.
- Solid edges represent real production dependencies.
- Dashed edges represent inheritance, version origin, or shot order and must be visually distinct.
- A selected shot expands its local production chain.
- Other shots remain compact and display four stage indicators: panel, speech, video, and review.
- Historical panel versions appear in the inspector, not as peer nodes mixed with other shots.
- Shared character, expression, outfit, injury, prop, and scene assets can fan out to multiple shots.
- Cross-shot edges are allowed only when the underlying data contains a real dependency.

## Layout

The page retains the approved three-column structure.

### Left navigation

- Volumes and episodes.
- Current episode selection and production status.
- Storyline labels with cross-episode counts.
- Collapse control.

### Center canvas

- Infinite pan-and-zoom surface.
- Select, pan, box-select, auto-layout, zoom, fit-view, and minimap controls.
- Shared assets placed to the left of scene groups.
- Scene group frames contain peer shot nodes.
- The selected shot expands panel, speech, video, and review nodes to its right.
- Compact shot nodes show thumbnail, duration, shot size, status, and stage indicators.
- Edges connect actual node ports and are recalculated by the canvas engine.

### Right inspector

The inspector changes according to node type and includes only available sections.

- Current status and latest update.
- Inheritance or version source.
- Input dependencies and readiness.
- Effective inherited and overridden fields.
- Downstream impact.
- Production task details, retryability, and sanitized errors.
- Panel or media version history.
- Bound ComfyUI workflow and workflow version.
- Open, retry, approve, restore, or replace commands where permitted.

## Reuse Strategy

`LocalMiniDrama-main` is MIT licensed and is the primary migration source for canvas behavior. The required copyright and license notice must be retained for copied or substantially derived code.

### Reuse with mechanical TypeScript adaptation

- Node ID conventions.
- Graph adapter concepts and graph-building rules.
- Auto-layout position rules.
- Canvas layout and viewport persistence format.
- Workflow group parsing, creation, deletion, and normalization.
- Asset-to-shot association highlighting.
- Storyboard media-chain construction.
- Generation task status mapping.
- Group execution and stop-on-failure behavior.

Relevant source files:

- `LocalMiniDrama-main/frontweb/src/utils/dramaCanvasAdapter.js`
- `LocalMiniDrama-main/frontweb/src/utils/canvasLayout.js`
- `LocalMiniDrama-main/frontweb/src/utils/canvasWorkflow.js`
- `LocalMiniDrama-main/frontweb/src/utils/storyboardMedia.js`
- `LocalMiniDrama-main/frontweb/src/composables/useCanvasWorkflowRunner.js`
- `LocalMiniDrama-main/frontweb/src/composables/useCanvasNodeStatus.js`

### Rebuild against the current frontend framework

Vue-specific components and composables cannot be imported directly into the React application. Their behavior will be translated to React components and hooks using `@xyflow/react`.

- `DramaCanvas.vue` becomes the production canvas composition component.
- Vue Flow node components become React Flow custom node components.
- Vue provide/inject context becomes a typed React context or narrow hooks.
- Element Plus dialogs and menus become existing project controls.
- Vue watchers become React effects or query/state subscriptions.

### Existing ai-comic-studio code to preserve

- Production run creation, pause, continue, retry, and polling.
- Production readiness and blockers.
- Asset lineage and shot usage records.
- Panel, video, speech, and review APIs.
- Global toolbar and project navigation.
- Design tokens and current visual system.

The existing `ProductionPanel` public behavior remains available during migration, but its list UI becomes a secondary task drawer.

## Canvas Technology

Use `@xyflow/react` for:

- Nodes and handles.
- Bezier edges.
- Pan, zoom, selection, and box selection.
- Fit view and viewport state.
- Minimap and controls.
- Drag updates.

Use an established graph layout engine for auto-layout. ELK is preferred for compound scene groups and multiple edge directions. Dagre is acceptable only if compound groups are deferred.

Do not implement node dragging, edge routing, viewport transforms, or selection mechanics manually.

## Graph Model

### Node types

- `episode-header`
- `asset-character`
- `asset-state`
- `asset-prop`
- `asset-scene`
- `scene-group`
- `shot`
- `panel`
- `speech-task`
- `video-task`
- `review`
- `workflow-summary`

### Stable node IDs

```text
episode:{episode_id}
asset-variant:{variant_id}
asset-state:{state_id}
scene:{scene_id}
shot:{shot_id}
panel:{shot_id}:{asset_id_or_pending}
speech:{shot_id}
video:{shot_id}
review:{shot_id}
```

### Edge types

- `dependency`: solid neutral edge.
- `selected-dependency`: highlighted solid edge.
- `inheritance`: dashed edge.
- `shot-order`: subtle dashed edge with no production semantics.
- `blocked`: danger-colored edge.
- `stale`: warning-colored edge.

Edges are derived from authoritative asset usages, active media, production items, and review state. Users cannot create arbitrary business edges in the first release.

## Expansion and Semantic Zoom

- At low zoom, show scene groups and compact shot summaries.
- At normal zoom, show shot thumbnails and four production-stage indicators.
- Selecting or double-clicking a shot expands its local downstream chain.
- Only selected, running, failed, or blocked shots expand automatically.
- Users can pin expanded shots.
- Fit view may target the whole episode, a scene group, or a selected shot chain.

This prevents a large episode from turning into an unreadable graph while preserving a real free canvas.

## Layout Persistence

Port the `LocalMiniDrama` layout model with explicit versioning:

```json
{
  "version": 1,
  "viewport": {"x": 0, "y": 0, "zoom": 0.75},
  "nodes": {
    "shot:shot-id": {"x": 360, "y": 144}
  },
  "expanded_shots": ["shot-id"],
  "pinned_shots": [],
  "updated_at": "ISO-8601"
}
```

Persistence rules:

- Save user movement with debounce.
- Never store generated edges as authoritative data.
- Rebuild edges from current domain state on load.
- Preserve positions for surviving stable node IDs.
- Auto-place new nodes without resetting existing manual positions.
- Auto-layout creates a new layout state and must be undoable before persistence.

## ComfyUI Integration

The production canvas remains a product-level graph. ComfyUI runs media workflows behind panel and video nodes.

Each executable media node may reference:

- Workflow template ID.
- Workflow version.
- Input mapping version.
- Provider/channel configuration.
- Last prompt/workflow execution ID.
- Output asset IDs.

Normal users execute approved workflow templates from the production node. An advanced command may open a dedicated ComfyUI workflow editor, but the full ComfyUI frontend is not embedded as the default production page.

Inputs may include:

- Character reference images.
- Effective episode variant and state.
- Scene references.
- Shot prompt and negative prompt.
- Director composition preview.
- Pose, depth, silhouette, or mask guidance.

Outputs must return to the existing asset version, review, provenance, and audit systems.

## Data Flow

1. Load the episode, scenes, shots, readiness, asset usages, active media, reviews, and latest production run.
2. Normalize them into framework-independent graph data.
3. Apply saved positions or automatic scene-group layout.
4. Render nodes and derived edges through React Flow.
5. Node selection drives the inspector and highlights upstream/downstream edges.
6. Production commands call existing APIs.
7. Persisted task updates refresh node state without rebuilding user positions.
8. Completed outputs update the corresponding media node and version history.

## Error Handling

- Failed graph data requests show a scoped canvas error without losing the current layout.
- Failed production nodes expose sanitized errors and retryability in the inspector.
- Missing assets render explicit missing-input nodes or blocked ports.
- Stale assets and workflows use warning edges and badges.
- Unsupported legacy layout versions fall back to auto-layout without deleting stored data.
- ComfyUI failures must be translated into the existing model-runtime error contract.

## Responsive Behavior

- Desktop is the primary editing surface.
- Narrow desktop may collapse the left navigation or right inspector.
- Tablet supports pan, zoom, selection, and inspector drawer.
- Mobile uses a read-only overview with tap-to-focus; arbitrary node editing is not required for the first release.
- No page-level horizontal overflow is allowed; overflow belongs inside the canvas viewport.

## Testing

### Pure graph tests

- Stable node IDs.
- Node generation for every domain state.
- Asset fan-out to multiple shots.
- No cross-shot media/version edges.
- Correct selected-shot expansion.
- Layout migration and persistence.
- Workflow group parsing and normalization.

### Component tests

- Node selection and inspector content.
- Expand, collapse, and pin behavior.
- Production commands preserve current API payloads.
- Running and failed items update node presentation.
- Missing assets and errors remain actionable.

### Browser tests

- Nonblank canvas pixel verification.
- Edges terminate at the correct handles after resize and zoom.
- Drag, pan, zoom, box-select, fit-view, and auto-layout.
- Desktop and tablet framing.
- No page-level overflow.
- Existing production start, pause, continue, and retry flows.

## Migration Stages

1. Port pure graph, layout, workflow-group, and status algorithms with tests.
2. Add React Flow and render a read-only episode graph using real API data.
3. Add selection, inspector, dependency highlighting, semantic zoom, and shot expansion.
4. Add layout persistence, drag, auto-layout, minimap, and controls.
5. Move existing production commands into nodes and the task drawer.
6. Bind panel and video nodes to versioned ComfyUI workflows.
7. Remove the old list-first production layout after browser acceptance.

## Non-Goals for the First Release

- Arbitrary user-created business edges.
- A complete ComfyUI clone.
- Editing low-level sampler or model nodes in the main canvas.
- Mobile freeform graph editing.
- Replacing the existing asset lineage, review, or audit domains.

## Acceptance Criteria

- The production page is an episode-level free canvas.
- All shots are peer nodes and scenes are visual groups.
- Shared assets fan out to every actual shot usage.
- Selecting a shot expands only that shot's production chain.
- Historical versions never connect to unrelated shots.
- Edges remain attached to handles through drag, resize, pan, and zoom.
- Existing production APIs and state transitions still work.
- Layout and viewport restore without overriding new domain data.
- Panel and video nodes can identify their bound ComfyUI workflow.
- The result follows the approved PNG composition while using real project data.
