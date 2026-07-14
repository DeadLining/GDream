# ComfyUI Execution Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute approved image and video workflow bindings through ComfyUI with versioned input mappings, progress, cancellation, history recovery, output ingestion, and sanitized errors.

**Architecture:** Add a provider adapter behind the existing model-runtime boundary. Product nodes reference approved workflow templates; a compiler maps domain assets and image-subcanvas inputs into ComfyUI prompt JSON without exposing low-level ComfyUI nodes on the episode canvas.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy, Alembic, httpx, WebSocket client, existing model runtime, pytest, Next.js, TypeScript

**Execution Constraint:** Do not embed or fork the ComfyUI frontend in this plan. Do not store API credentials in workflow JSON.

---

## File Structure

- Create migration `20260713_17_comfyui_workflows.py`.
- Create `model_runtime/comfyui/contracts.py`, `client.py`, `compiler.py`, and `provider.py`.
- Create workflow-template and input-mapping services/routes.
- Modify runtime provider registry, job cancellation, health, and invocation records.
- Add backend tests and workflow-binding UI tests.

### Task 1: Store Approved Templates and Mappings

**Files:** migration, `models.py`, `schemas.py`, tests

- [ ] **Step 1: Write RED tests** for unique template version and mapping version, disabled templates, and secret-field rejection.
- [ ] **Step 2: Add** `ComfyWorkflowTemplate` and `ComfyInputMapping` with project, capability, name, version, workflow JSON, mapping JSON, checksum, enabled, created_by, and timestamps.
- [ ] **Step 3: Create migration 16** with unique `(project_id,name,version)` and `(workflow_template_id,version)` constraints.
- [ ] **Step 4: Validate** workflow JSON contains no API keys, authorization headers, absolute local output paths, or unsupported remote URLs.
- [ ] **Step 5: Run model and migration tests.**

### Task 2: Define the Input-Mapping Contract

**Files:** create `comfyui/contracts.py`; tests

- [ ] **Step 1: Write RED tests** for missing node/input, type mismatch, unavailable asset, and invalid dimensions.
- [ ] **Step 2: Define mappings:**

```python
class ComfyInputBinding(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: Literal[
        "prompt", "negative_prompt", "width", "height", "seed",
        "source_image", "mask", "character_reference", "scene_reference",
        "asset_reference", "director_pose", "director_depth"
    ]
    node_id: str
    input_name: str
    required: bool = True
    index: int | None = None

class ComfyOutputBinding(BaseModel):
    node_id: str
    output_kind: Literal["image", "video"]
    index: int = 0
```

- [ ] **Step 3: Add a compiler result** containing prompt JSON, uploaded input manifest, output bindings, workflow checksum, and redacted audit summary.
- [ ] **Step 4: Run contract tests.**

### Task 3: Build the ComfyUI HTTP/WebSocket Client

**Files:** create `client.py`; tests with mocked transport

- [ ] **Step 1: Write RED tests** for `/prompt`, `/history/{prompt_id}`, `/queue`, `/interrupt`, `/upload/image`, websocket progress, reconnect, timeout, and malformed responses.
- [ ] **Step 2: Implement a bounded client** with configured base URL, optional auth header from environment/provider channel, connect/read timeouts, maximum upload size, and allowed content types.
- [ ] **Step 3: Normalize events** to queued, executing, progress, completed, failed, and cancelled.
- [ ] **Step 4: On websocket loss, poll history** with exponential backoff and a fixed deadline.
- [ ] **Step 5: Run client tests** without a live ComfyUI instance.

### Task 4: Compile Domain Inputs into Prompt JSON

**Files:** create `compiler.py`; tests

- [ ] **Step 1: Write RED fixtures** covering panel generation, image repair with mask, character references, scene reference, and video generation.
- [ ] **Step 2: Deep-copy the approved workflow JSON** and assign only mapped inputs; reject unmapped caller-provided node IDs.
- [ ] **Step 3: Resolve immutable asset versions** and upload local media through the client; never pass expiring app URLs as authoritative references.
- [ ] **Step 4: Return deterministic prompt JSON** for the same workflow, mapping, inputs, and seed.
- [ ] **Step 5: Run compiler tests.**

### Task 5: Add the Runtime Provider Adapter

**Files:** create `provider.py`; modify provider registry/runtime service/contracts; tests

- [ ] **Step 1: Write RED runtime tests** proving ComfyUI satisfies image/video capability and preserves existing provider behavior.
- [ ] **Step 2: Implement provider methods** `health`, `submit`, `events`, `cancel`, `history`, and `collect_outputs`.
- [ ] **Step 3: Store** prompt ID, template/mapping versions, checksums, uploaded input hashes, and selected output bindings in invocation metadata.
- [ ] **Step 4: Translate failures** to configuration error, provider unavailable, timeout, invalid response, or interrupted, with sanitized messages.
- [ ] **Step 5: Run complete model-runtime tests.**

### Task 6: Integrate Image Workflow Execution

**Files:** modify image-workflow service and tests

- [ ] **Step 1: Write RED tests** selecting a Comfy binding for an `image-generator` node and ingesting multiple output images.
- [ ] **Step 2: Resolve binding by exact template and mapping version** stored on the workflow revision; never silently upgrade an executed revision.
- [ ] **Step 3: Ingest each configured output** as a candidate version with prompt ID and output-node provenance.
- [ ] **Step 4: Preserve current providers** when a workflow node selects them instead of ComfyUI.
- [ ] **Step 5: Run workflow and runtime tests.**

### Task 7: Integrate Production Panel and Video Nodes

**Files:** production canvas service, runtime service, tests

- [ ] **Step 1: Write RED tests** for panel/video bindings, blocked missing references, retry, and stale binding warnings.
- [ ] **Step 2: Route only explicitly bound nodes** to ComfyUI; unbound nodes keep current image/video provider behavior.
- [ ] **Step 3: Emit progress** into production items and canvas node status without changing node positions.
- [ ] **Step 4: Ingest successful outputs** through existing panel/video version and review paths.
- [ ] **Step 5: Run production regression tests.**

### Task 8: Add Template and Mapping Administration

**Files:** create routes/service and admin UI; tests

- [ ] **Step 1: Write RED API/UI tests** for import, validate, version, enable/disable, bind, and dry-run compile.
- [ ] **Step 2: Add endpoints:**

```text
POST /api/projects/{project_id}/comfy-workflows/import
POST /api/comfy-workflows/{id}/versions
POST /api/comfy-workflows/{id}/validate
POST /api/comfy-workflows/{id}/dry-run
PUT  /api/comfy-workflows/{id}/enabled
PUT  /api/projects/{project_id}/production-workflows/{capability}/{name}
```

- [ ] **Step 3: Render template name, versions, checksum, validation result, mapping table, and binding target.** Do not build a low-level node editor.
- [ ] **Step 4: Require project administration permission** for import, mapping edits, and activation.
- [ ] **Step 5: Run API/UI tests and build.**

### Task 9: Security and Failure Recovery

**Files:** client/compiler/routes/tests/docs

- [ ] **Step 1: Test** SSRF-resistant base URL configuration, upload limits, MIME verification, secret redaction, path rejection, and hostile workflow JSON.
- [ ] **Step 2: Test** duplicate completion events, server restart during execution, history recovery, cancellation race, and output checksum mismatch.
- [ ] **Step 3: Make ingestion idempotent** by `(provider,prompt_id,output_node,index)`.
- [ ] **Step 4: Run `npm audit` and Python dependency audit if available;** document existing unrelated findings separately.

### Task 10: Live Acceptance and Full Verification

**Files:** integration tests and operations documentation

- [ ] **Step 1: Add an opt-in live test** using `COMFYUI_TEST_URL`; skip with an explicit reason when unset.
- [ ] **Step 2: Execute one image repair and one panel generation** against a configured ComfyUI instance, verifying websocket progress and ingested assets.
- [ ] **Step 3: Cancel one running job** and verify both ComfyUI queue state and local runtime state.
- [ ] **Step 4: Run** full pytest, web tests/build, targeted E2E, audits, `git diff --check`, and CodeGraph sync.
- [ ] **Step 5: Verify** no main-canvas component imports ComfyUI graph internals and no secret appears in database rows, logs, events, or browser payloads.
