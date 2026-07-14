# Conversational Image Repair Subcanvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users open a panel or image asset into a separate node canvas, combine references, image annotations, and conversation instructions, generate candidates, and return an approved version to the main production workflow.

**Architecture:** Store versioned, typed image-workflow revisions separately from the episode graph. The React Flow subcanvas allows compatible execution edges; executions use existing image providers first and ingest outputs through current asset version, lineage, and review services.

**Tech Stack:** React Flow, Next.js, TypeScript, FastAPI, SQLAlchemy, Alembic, existing image runtime, Canvas/Pointer Events, pytest, Vitest, Playwright

**Execution Constraint:** No commits unless requested. This plan does not add ComfyUI transport.

---

## File Structure

- Create migration `20260713_16_image_workflows.py`.
- Create backend `image_workflow/contracts.py`, `services/image_workflows.py`, and `routes/image_workflows.py`.
- Create frontend `components/image-workflow/ImageWorkflowCanvas.tsx`, typed nodes, toolbar, annotation editor, inspector, and candidate strip.
- Create `lib/image-workflow.ts` for validation, stable IDs, graph normalization, and layout merge.
- Add backend, component, model, and browser tests.

### Task 1: Add Versioned Workflow Models

**Files:** migration, `models.py`, `schemas.py`, migration and workflow tests

- [ ] **Step 1: Write RED tests** for unique workflow revision, immutable executed revisions, and source asset cascade behavior.
- [ ] **Step 2: Add models** `ImageWorkflow`, `ImageWorkflowRevision`, and `ImageWorkflowExecution` with project/source scope, schema version, revision number, graph JSON, viewport JSON, status, provider job ID, output asset IDs, and timestamps.
- [ ] **Step 3: Create migration 15** with unique `(workflow_id,revision)` and indexes on source asset, status, and provider job ID.
- [ ] **Step 4: Run migration/model tests.**

### Task 2: Define Typed Nodes, Ports, and Edges

**Files:** create `image_workflow/contracts.py`; test workflow schemas

- [ ] **Step 1: Write RED tests** rejecting unknown node types, output-to-output edges, missing nodes, and cycles into immutable inputs.
- [ ] **Step 2: Define discriminated nodes:**

```python
ImageWorkflowNode = Annotated[
    ImageInputNode | AssetReferenceNode | AnnotationMaskNode |
    InstructionNode | ImageGeneratorNode | CandidateOutputNode |
    ApprovalOutputNode,
    Field(discriminator="type"),
]

class ImageWorkflowEdge(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    source: str
    source_port: Literal["image", "mask", "instruction", "candidate"]
    target: str
    target_port: Literal["reference", "mask", "instruction", "candidate"]
```

- [ ] **Step 3: Implement `validate_graph`** with a port compatibility matrix, stable unique IDs, referenced immutable asset-version IDs, and maximum node/edge limits.
- [ ] **Step 4: Run schema tests.**

### Task 3: Add Workflow CRUD and Revision APIs

**Files:** service, route, `main.py`, backend tests

- [ ] **Step 1: Write RED tests** for create-from-panel, save draft, execute-lock, fork revision, broken reference, and cross-project rejection.
- [ ] **Step 2: Add endpoints:**

```text
POST /api/assets/{asset_id}/image-workflows
GET  /api/image-workflows/{workflow_id}
POST /api/image-workflows/{workflow_id}/revisions
PUT  /api/image-workflow-revisions/{revision_id}
POST /api/image-workflow-revisions/{revision_id}/fork
```

- [ ] **Step 3: Return resolved reference metadata** separately from stored immutable IDs so expired URLs are never persisted in graph JSON.
- [ ] **Step 4: Reject edits** after execution starts; `fork` copies the graph into the next draft revision.
- [ ] **Step 5: Run endpoint tests.**

### Task 4: Build Pure Frontend Graph Logic

**Files:** create `lib/image-workflow.ts`, types, API client, `tests/image-workflow-model.test.ts`

- [ ] **Step 1: Write RED tests** for stable IDs, compatible connections, candidate append, and saved layout merge.
- [ ] **Step 2: Export:**

```typescript
export function canConnect(source:WorkflowPort,target:WorkflowPort):boolean;
export function normalizeImageWorkflow(dto:ImageWorkflowRevisionRead):WorkflowGraph;
export function appendCandidate(graph:WorkflowGraph,candidate:CandidateRead):WorkflowGraph;
export function mergeWorkflowLayout(nodes:WorkflowNode[],saved:WorkflowViewport):WorkflowNode[];
```

- [ ] **Step 3: Port only generic interaction concepts** from Toonflow; do not copy compiled Vue code or persist media URLs.
- [ ] **Step 4: Run model tests.**

### Task 5: Build the Image Workflow Canvas

**Files:** create canvas, toolbar, inspector, node components, CSS, component tests

- [ ] **Step 1: Write RED component tests** for inputs, references, instructions, generator, candidate nodes, valid connection, invalid connection, save, and fork.
- [ ] **Step 2: Register custom React Flow nodes** with stable dimensions and typed handles.
- [ ] **Step 3: Provide controls** for select, pan, connect, delete execution edge, fit, zoom, undo/redo, save, and return to panel.
- [ ] **Step 4: Disable business operations** such as shot creation or arbitrary asset reassignment inside this canvas.
- [ ] **Step 5: Run component tests and build.**

### Task 6: Add Circle, Region, and Brush Annotation

**Files:** create `ImageAnnotationEditor.tsx`, `lib/image-annotations.ts`, tests

- [ ] **Step 1: Write RED tests** for normalized circle/rectangle/brush coordinates across image resize.
- [ ] **Step 2: Store annotations** in source-image coordinates:

```typescript
type AnnotationShape =
 | {type:'point';x:number;y:number;label:string}
 | {type:'ellipse';x:number;y:number;width:number;height:number;label:string}
 | {type:'rect';x:number;y:number;width:number;height:number;label:string}
 | {type:'brush';points:Array<{x:number;y:number}>;radius:number;label:string};
```

- [ ] **Step 3: Export a deterministic mask PNG** plus structured shapes; keep the structured representation authoritative for later editing.
- [ ] **Step 4: Create/update an `annotation-mask` node** when the user confirms annotation.
- [ ] **Step 5: Run geometry and component tests.**

### Task 7: Convert Conversation into Instructions

**Files:** integrate Production Agent panel and workflow service; tests

- [ ] **Step 1: Write RED tests** for “把圈中的袖子改成红色” producing a draft instruction linked to the active annotation node.
- [ ] **Step 2: Add a typed proposal command** `create_image_instruction` containing workflow revision, annotation node IDs, reference node IDs, text, and base revision.
- [ ] **Step 3: Show the instruction node preview** before saving; user may edit text or reject it.
- [ ] **Step 4: Run Agent and workflow regression tests.**

### Task 8: Execute with Existing Image Runtime

**Files:** workflow service/route, model-runtime contracts/service, backend tests

- [ ] **Step 1: Write RED tests** for resolved references, instruction/mask payload, asynchronous job, cancellation, and candidate ingestion.
- [ ] **Step 2: Add** `POST /api/image-workflow-revisions/{revision_id}/execute` and cancellation endpoint.
- [ ] **Step 3: Compile graph inputs** into the existing image runtime request; save immutable execution input metadata before dispatch.
- [ ] **Step 4: Ingest every result** as a candidate asset version with lineage to source asset, workflow revision, execution, provider invocation, and output index.
- [ ] **Step 5: Run runtime and workflow tests.**

### Task 9: Review, Approve, Replace, and Roll Back

**Files:** workflow service, visual review integration, candidate UI, tests

- [ ] **Step 1: Write RED tests** proving candidates never replace the active panel before approval.
- [ ] **Step 2: Add commands** `send-to-review`, `approve-and-activate`, `reject`, and `restore-previous` using existing review/version services.
- [ ] **Step 3: Refresh the main production graph** after activation without importing subcanvas edges.
- [ ] **Step 4: Run lineage, panel-version, visual-review, and workflow tests.**

### Task 10: Browser and Full Verification

**Files:** create `e2e/image-workflow.spec.ts`; update architecture docs

- [ ] **Step 1: Test** open panel -> circle region -> converse -> confirm instruction -> generate -> candidate -> review -> activate.
- [ ] **Step 2: Verify** handle geometry, mask alignment, undo/redo, resize, 1440/1024 viewports, and no page overflow.
- [ ] **Step 3: Verify** main graph contains only the candidate/active asset result, never image-workflow edges.
- [ ] **Step 4: Run** all web/API tests, builds, E2E, `git diff --check`, and CodeGraph sync.
