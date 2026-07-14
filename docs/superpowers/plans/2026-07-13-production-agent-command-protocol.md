# Production Agent Command Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a typed Production Agent protocol that reads episode state, previews structural changes, requires confirmation, and executes idempotent domain commands while streaming progress.

**Architecture:** Extend the existing model-runtime text stream with a server-owned tool registry and persisted proposal records. The agent never writes canvas JSON; approved proposals call existing services for shots, asset usages, variants, and production jobs.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, Pydantic, existing model runtime, Server-Sent Events, Next.js, React, TypeScript, pytest, Vitest, Playwright

**Execution Constraint:** Do not commit unless explicitly requested. Preserve unrelated dirty-worktree changes.

---

## File Structure

- Create `services/api/alembic/versions/20260713_15_production_agent_protocol.py` for proposals, commands, and events.
- Create `services/api/comic_studio/services/production_agent.py` for reads, impact previews, approval, idempotency, and execution.
- Create `services/api/comic_studio/routes/production_agent.py` for conversation, proposal, approval, cancellation, and event endpoints.
- Create `services/api/comic_studio/production_agent/contracts.py` for discriminated command and event schemas.
- Create `services/api/tests/test_production_agent.py` for protocol and authorization behavior.
- Create `apps/web/components/production-agent/ProductionAgentPanel.tsx` for conversation and proposal cards.
- Create `apps/web/components/production-agent/ProposalImpactPreview.tsx` for affected-record previews.
- Modify `apps/web/lib/api.ts`, `apps/web/lib/types.ts`, and the production canvas composition.

### Task 1: Persist Proposals and Events

**Files:** migration, `models.py`, `schemas.py`, `test_migrations.py`, `test_production_agent.py`

- [ ] **Step 1: Write RED tests** requiring one idempotency key per episode and immutable ordered events.

```python
def test_agent_proposal_idempotency(db_session, seeded_episode):
    proposal = models.ProductionAgentProposal(
        episode_id=seeded_episode.id, user_id="local-user", base_revision=3,
        idempotency_key="req-1", status="pending", command={"type": "add_shot"}, impact={},
    )
    db_session.add(proposal); db_session.commit()
    db_session.add(models.ProductionAgentProposal(
        episode_id=seeded_episode.id, user_id="local-user", base_revision=3,
        idempotency_key="req-1", status="pending", command={}, impact={},
    ))
    with pytest.raises(IntegrityError): db_session.commit()
```

- [ ] **Step 2: Run** `cd services/api && pytest -q tests/test_production_agent.py tests/test_migrations.py`; expect missing-model failures.
- [ ] **Step 3: Add** `ProductionAgentProposal`, `ProductionAgentCommand`, and `ProductionAgentEvent` with UUID IDs, episode/user scope, base revision, JSON payloads, status, sequence, timestamps, and unique constraints on `(episode_id,idempotency_key)` and `(proposal_id,sequence)`.
- [ ] **Step 4: Create migration 14** with cascade deletion and indexes on episode, status, proposal, and event sequence.
- [ ] **Step 5: Rerun tests** and inspect the scoped diff.

### Task 2: Define Typed Commands

**Files:** create `production_agent/contracts.py`; modify `schemas.py`; test `test_production_agent.py`

- [ ] **Step 1: Write schema tests** rejecting unknown fields and arbitrary edge commands.
- [ ] **Step 2: Define a discriminated union:**

```python
class AddShotCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["add_shot"]
    scene_id: str
    after_shot_id: str | None = None
    shot_type: str
    duration_seconds: float = Field(gt=0, le=120)
    composition: str

class BindVariantCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["bind_variant"]
    variant_id: str
    state_id: str | None = None
    shot_ids: list[str] = Field(min_length=1)
    usage_kind: Literal["character", "outfit", "expression", "injury", "prop", "scene"]

ProductionAgentCommandPayload = Annotated[
    AddShotCommand | BindVariantCommand | CreateEpisodeVariantCommand |
    UpdateShotCommand | ReorderShotCommand | DeleteShotCommand |
    GeneratePanelCommand | GenerateSpeechCommand | GenerateVideoCommand,
    Field(discriminator="type"),
]
```

- [ ] **Step 3: Add event schemas** for `proposal-created`, `proposal-approved`, `command-started`, `command-progress`, `candidate-created`, `review-required`, `command-failed`, and `command-cancelled`.
- [ ] **Step 4: Run** `pytest -q tests/test_production_agent.py -k schema`; expect pass.

### Task 3: Build Read Tools and Impact Preview

**Files:** create `services/production_agent.py`; test `test_production_agent.py`

- [ ] **Step 1: Write RED tests** proving reads are episode-scoped and a bind proposal reports affected shots and downstream panels/videos.
- [ ] **Step 2: Implement read methods** `episode_summary`, `selected_node_context`, `asset_usages`, `production_failures`, and `image_workflow_context` using existing repositories/services.
- [ ] **Step 3: Implement `preview(command, episode_id, base_revision)`** returning:

```python
class ProposalImpact(BaseModel):
    affected_records: list[RecordRef]
    created_records: list[RecordRef]
    removed_records: list[RecordRef]
    stale_outputs: list[RecordRef]
    blockers: list[str]
    reversible: bool
```

- [ ] **Step 4: Reject** cross-episode IDs, deleted variants, missing scenes, and stale `base_revision` with explicit error codes.
- [ ] **Step 5: Run scoped service tests** and verify query counts do not grow per shot.

### Task 4: Add Proposal and Approval APIs

**Files:** create route file; modify `main.py`; test `test_production_agent.py`

- [ ] **Step 1: Write RED endpoint tests** for create, approve, reject, cancel, duplicate idempotency, and revision conflict.
- [ ] **Step 2: Add endpoints:**

```text
POST /api/episodes/{episode_id}/production-agent/proposals
GET  /api/episodes/{episode_id}/production-agent/proposals
POST /api/production-agent/proposals/{proposal_id}/approve
POST /api/production-agent/proposals/{proposal_id}/reject
POST /api/production-agent/proposals/{proposal_id}/cancel
GET  /api/production-agent/proposals/{proposal_id}/events
```

- [ ] **Step 3: Enforce state transitions** `pending -> approved|rejected`, `approved -> running -> completed|failed|cancelled`; repeated approve returns the existing command result.
- [ ] **Step 4: Run API tests**; expect 404 for cross-project access, 409 for stale revision, and 200 for idempotent repeats.

### Task 5: Execute Approved Domain Commands

**Files:** modify service; test `test_production_agent.py`

- [ ] **Step 1: Write RED tests** asserting structural commands do nothing before approval.
- [ ] **Step 2: Implement a closed dispatcher:**

```python
HANDLERS = {
    "add_shot": execute_add_shot,
    "update_shot": execute_update_shot,
    "reorder_shot": execute_reorder_shot,
    "delete_shot": execute_delete_shot,
    "bind_variant": execute_bind_variant,
    "create_episode_variant": execute_create_episode_variant,
    "generate_panel": execute_generate_panel,
    "generate_speech": execute_generate_speech,
    "generate_video": execute_generate_video,
}
```

- [ ] **Step 3: Route generation commands** through existing production/model-runtime services and structural commands through existing repositories in one transaction.
- [ ] **Step 4: Append ordered events** before and after each state transition; sanitize failures through `ModelRuntimeError`.
- [ ] **Step 5: Run all protocol tests** and verify rollback leaves no partial records.

### Task 6: Add Conversation Streaming

**Files:** modify route/service and `model_runtime/contracts.py`; test `test_production_agent.py`

- [ ] **Step 1: Write RED SSE tests** for text chunks, tool-read events, proposal event, done, error, and disconnect cancellation.
- [ ] **Step 2: Add** `POST /api/episodes/{episode_id}/production-agent/chat/stream` accepting message, selected node ID, conversation ID, and base revision.
- [ ] **Step 3: Give the model only read tools and `create_proposal`;** never expose raw SQL, arbitrary URL fetch, or direct mutation tools.
- [ ] **Step 4: Abort provider work on disconnect** and persist the final proposal before emitting `done`.
- [ ] **Step 5: Run SSE and model-runtime regression tests.**

### Task 7: Build the Agent Panel

**Files:** create frontend components; modify API/types/canvas; create `apps/web/tests/production-agent-panel.test.tsx`

- [ ] **Step 1: Write RED component tests** for streaming text, proposal impact, approve/reject, failed command retry, and episode switching.
- [ ] **Step 2: Add typed API clients** and an abortable SSE reader.
- [ ] **Step 3: Render conversation plus proposal cards**; structural actions expose `确认变更` and `拒绝`, while generation actions follow existing permission rules.
- [ ] **Step 4: Highlight affected canvas nodes** from the impact response without moving them.
- [ ] **Step 5: Run Vitest and build.**

### Task 8: Browser and Full Verification

**Files:** create `apps/web/e2e/production-agent.spec.ts`; modify docs architecture.

- [ ] **Step 1: Test** conversation -> proposal -> impact highlight -> approval -> graph refresh in Playwright.
- [ ] **Step 2: Test** rejected and stale proposals cause no domain mutation.
- [ ] **Step 3: Run** `npm test`, `npm run build`, targeted E2E, `pytest -q`, `git diff --check`, and `codegraph sync .`.
- [ ] **Step 4: Review** that no endpoint accepts arbitrary nodes, edges, SQL, provider URLs, or unconfirmed structural mutations.
