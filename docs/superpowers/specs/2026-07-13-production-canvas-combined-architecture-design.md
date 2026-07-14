# Production Canvas Combined Architecture Design

## Objective

Build a coherent episode-production system by combining proven ideas from three codebases without merging their frameworks or allowing multiple sources of business truth.

- `ai-comic-studio` remains the authoritative product and domain layer.
- `LocalMiniDrama-main` is the primary source for main-canvas graph, layout, and persistence behavior.
- `Toonflow-app-master` informs episode aggregation, agent-operated workspace commands, asset fan-out, and the local image-editing subcanvas.
- ComfyUI is a media execution engine behind approved workflow bindings.

The system must distinguish the authoritative episode dependency graph from user-editable media-processing graphs.

## Core Decision

Use a layered combination rather than copying one reference application wholesale.

```text
authoritative domain data
  -> episode production graph aggregator
  -> episode main canvas
      -> node inspector and commands
      -> production agent change proposals
      -> image-processing subcanvas
          -> current providers or ComfyUI
          -> output ingestion, versioning, and review
```

Only `ai-comic-studio` domain records are authoritative. Canvas nodes and edges are projections of that data, except inside a versioned media-processing workflow where users are explicitly editing an execution graph.

## Source Responsibilities

### ai-comic-studio

Preserve and extend the existing domains for:

- Projects, volumes, episodes, scenes, and peer shots.
- Character, scene, prop, outfit, age, injury, expression, and other asset variants.
- Explicit asset inheritance and episode-specific overrides.
- Asset-to-shot usage records.
- Panel, speech, video, review, version, lineage, and audit records.
- Production runs, items, retries, cancellation, readiness, and blockers.
- Provider and model-runtime contracts.

No imported canvas implementation may bypass these records by storing alternative business state in an opaque graph JSON document.

### LocalMiniDrama-main

Use as the primary migration source for framework-independent main-canvas behavior:

- Stable node ID conventions.
- Domain-to-graph adaptation.
- Node and edge state mapping.
- Scene grouping and peer-shot placement.
- Graph layout merge and viewport persistence.
- Workflow-group normalization where it applies to media chains.
- Task status synchronization and stop-on-failure behavior.
- Association highlighting and layout restoration.

Vue components are not imported. Pure algorithms are mechanically adapted to typed TypeScript, while the visual layer is rebuilt with `@xyflow/react`.

### Toonflow-app-master

Use as a product and protocol reference for:

- Loading a complete episode workspace in one request.
- Returning parent assets, derived variants, shots, and asset-to-shot associations together.
- Letting an agent read selected workspace slices before proposing changes.
- Narrow agent tools for creating variants, generating assets, and adding shots.
- Streaming agent progress and separating decision, execution, and supervision roles.
- Opening an image-processing subcanvas from a panel or asset version.
- Saving a local graph of image inputs, masks, prompts, generators, and candidate outputs.
- Returning generated outputs to the parent production workspace.

Do not copy Toonflow's untyped `nodes + edges` persistence, opaque episode JSON, or compiled Vue frontend artifact. The reference repository is Apache-2.0; copied or substantially derived source requires its license, NOTICE obligations, and modified-file notices.

## Canvas Boundary

### Episode Main Canvas

The main canvas represents product-level production state for one episode.

- Every shot is a peer node.
- Scenes are visual group frames only.
- Shared assets fan out to every authoritative shot usage.
- Selecting a shot expands its local `panel -> speech/video -> review` chain.
- Solid edges are production dependencies.
- Dashed edges are inheritance, version origin, or shot order.
- Users cannot create arbitrary business edges.
- Node movement and expansion are layout state, not domain state.
- Edges are always regenerated from current domain records.

### Image-Processing Subcanvas

The subcanvas is opened from one panel, panel version, or image asset and represents a versioned execution workflow.

Initial node types:

- `image-input`: current panel, asset version, uploaded image, or previous candidate.
- `asset-reference`: character, outfit, expression, injury, scene, or prop reference.
- `annotation-mask`: circle, brush mask, bounding region, or point annotation.
- `instruction`: conversational or manually edited change request.
- `image-generator`: approved provider or ComfyUI workflow binding.
- `candidate-output`: generated image with provenance and task state.
- `approval-output`: selected result to send into review or replace the active version.

Users may connect compatible ports inside the subcanvas. These edges are execution inputs and never become episode dependency edges.

### Relationship Between Canvases

The main canvas stores only a reference to a subcanvas workflow and its latest execution/result status. The subcanvas returns asset IDs and provenance records, never raw business-state mutations.

```text
panel node
  -> open workflow revision
  -> execute image workflow
  -> ingest candidate asset version
  -> review
  -> approve as active panel version
  -> refresh main-canvas node
```

## Episode Aggregation Contract

Add one aggregation endpoint that returns normalized episode data rather than persisted UI nodes:

```text
GET /api/episodes/{episode_id}/production-graph
```

The response contains:

- Episode and project identity.
- Ordered scenes and peer shots.
- Effective asset variants and inheritance summaries.
- Asset-to-shot usage lists.
- Active panel, speech, video, and review state.
- Latest production run and items.
- Bound media workflow metadata.
- Readiness, blocked inputs, stale dependencies, and sanitized errors.

The frontend graph adapter converts this response into React Flow nodes and edges. Layout is loaded and persisted separately.

## Agent Interaction Model

The Production Agent does not mutate arbitrary canvas JSON. It operates through typed domain commands.

### Read tools

- Read episode summary, scenes, and shots.
- Read effective asset variants and inheritance.
- Read asset usages for selected shots.
- Read production readiness and failed tasks.
- Read the selected node and its upstream/downstream dependencies.
- Read image-workflow inputs and prior candidate outputs.

### Proposal tools

- Propose a shot addition, edit, reorder, or deletion.
- Propose binding or replacing an asset variant on one or more shots.
- Propose creating an episode-specific asset variant.
- Propose generating or regenerating a panel, speech item, or video.
- Propose a local image-edit instruction from conversation and annotations.

Structural proposals produce a preview containing affected records, dependency impact, and reversible operations. They require user confirmation before execution. Non-structural generation commands may run directly only when the existing permission and confirmation rules allow them.

### Progress Model

Agent and generation progress is emitted as typed events:

```text
proposal-created
proposal-approved
command-started
command-progress
candidate-created
review-required
command-failed
command-cancelled
```

The event stream updates the task drawer and node presentation without changing manual layout positions.

## Workflow Persistence

### Main-canvas layout

Persist per episode and user:

- Versioned viewport.
- Stable node positions.
- Expanded and pinned shots.
- Collapsed scene groups.
- Updated timestamp.

Never persist generated business edges as authority.

### Image workflow

Persist a versioned workflow definition:

```json
{
  "schema_version": 1,
  "workflow_id": "uuid",
  "revision": 3,
  "source_asset_id": "asset-id",
  "nodes": [],
  "edges": [],
  "viewport": {"x": 0, "y": 0, "zoom": 0.8},
  "created_from_revision": 2
}
```

Every node and edge uses discriminated schemas. References point to immutable asset/version IDs. Workflow revisions are append-only after execution; editing an executed workflow creates a new revision.

## ComfyUI Boundary

ComfyUI is one implementation of `image-generator` or video execution.

- Store approved workflow template ID and version.
- Store an input-mapping version separate from the ComfyUI JSON version.
- Resolve asset references, masks, prompts, dimensions, and guidance at execution time.
- Submit, monitor, cancel, and retrieve output through a dedicated adapter.
- Ingest outputs into existing asset/version/provenance records.
- Translate errors into the existing model-runtime error contract.

The full ComfyUI frontend is not embedded in the episode main canvas. Advanced workflow editing is isolated behind a dedicated command and permission boundary.

## Error and Recovery Rules

- Aggregation failure shows a scoped main-canvas error and preserves the last local layout.
- Unsupported layout versions fall back to auto-layout without deleting stored data.
- Missing authoritative inputs produce blocked ports or explicit missing-input state.
- Invalid image-workflow edges are rejected before persistence and execution.
- Deleted or inaccessible asset versions leave a resolvable broken-reference node.
- Agent proposals are idempotent and carry a base revision to prevent stale writes.
- Failed media tasks preserve workflow revision, inputs, sanitized error, and retryability.
- Candidate ingestion is idempotent by provider execution ID and output index.

## Testing Strategy

### Main canvas

- Stable node IDs and peer-shot hierarchy.
- Shared asset fan-out and no invented cross-shot dependency.
- Edge handle geometry through drag, resize, pan, zoom, and responsive changes.
- Layout merge, undo, persistence, and new-node placement.
- Existing production command payload regression tests.

### Agent protocol

- Typed read and proposal schemas.
- Confirmation requirement for structural mutations.
- Base-revision conflict and idempotency behavior.
- Progress event ordering, cancellation, and stale episode isolation.

### Image subcanvas

- Node and port compatibility validation.
- Versioned save/load and immutable executed revisions.
- Annotation and reference serialization.
- Candidate ingestion, review, replacement, and rollback.
- No leakage of subcanvas execution edges into the episode graph.

### ComfyUI adapter

- Workflow and input-mapping validation.
- Submission, websocket progress, history fallback, cancellation, and timeout.
- Output ingestion and duplicate-event handling.
- Sanitized provider failures.

## Delivery Decomposition

This architecture is intentionally divided into independently testable projects.

### Project 1: Episode Production Main Canvas

Deliver the approved episode-level React Flow canvas, aggregation endpoint, layout persistence, inspector, task drawer, workflow-binding metadata, and current production commands. This is covered by the existing production dependency canvas specification and plan.

### Project 2: Production Agent Command Protocol

Add typed read tools, proposal schemas, confirmation flow, impact preview, event streaming, idempotency, and domain-command execution. The Agent may operate the main canvas only through these contracts.

### Project 3: Conversational Image Repair Subcanvas

Add image workflow models, versioned node/edge persistence, annotation tools, conversation-to-instruction nodes, candidate outputs, review, and replacement. Initially execute through current image providers.

### Project 4: ComfyUI Execution Adapter

Add workflow-template storage, input mapping, submission, progress, cancellation, history retrieval, output ingestion, and permission-isolated advanced editing.

Projects are delivered in this order. Project 1 remains useful without Projects 2-4; Project 3 remains usable with existing providers before Project 4 is complete.

Implementation plans:

- Project 1: `docs/superpowers/plans/2026-07-13-production-dependency-canvas.md`
- Project 2: `docs/superpowers/plans/2026-07-13-production-agent-command-protocol.md`
- Project 3: `docs/superpowers/plans/2026-07-13-conversational-image-repair-subcanvas.md`
- Project 4: `docs/superpowers/plans/2026-07-13-comfyui-execution-adapter.md`

## Non-Goals

- Replacing `ai-comic-studio` domain tables with Toonflow's opaque episode JSON.
- Importing Vue components or compiled frontend bundles.
- Allowing Agent-generated arbitrary business edges.
- Mixing episode dependency edges with image-processing workflow edges.
- Embedding a complete ComfyUI clone in the production page.
- Building a general-purpose node programming environment.
- Requiring mobile freeform workflow editing in the first release.

## Acceptance Criteria

- Users can understand one episode from the main canvas without exposing low-level execution graphs.
- Every main-canvas edge is traceable to authoritative domain data.
- Shared assets visibly fan out to all real shot usages.
- Agent actions preview structural impact and require confirmation before mutation.
- Users can open one panel into a separate conversational image-repair workflow.
- Circle/brush/region annotations and text instructions become explicit workflow inputs.
- Candidate outputs return through version, review, provenance, and rollback systems.
- ComfyUI can later replace or supplement the current execution provider without changing the main-canvas model.
- LocalMiniDrama and Toonflow-derived work retains the required MIT and Apache-2.0 attribution respectively.
