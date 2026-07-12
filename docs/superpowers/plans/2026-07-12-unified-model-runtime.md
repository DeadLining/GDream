# Unified Model Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route all model configuration, health diagnostics, and text/image/speech/video invocation through one internal Model Runtime, then expose a global full-width Model Center in the Web application.

**Architecture:** Add a bounded `model_runtime` backend package containing stable contracts, error classification, adapter resolution, invocation persistence, and job execution. Existing provider implementations remain vendor adapters, while every business workflow calls `app.state.model_runtime`; legacy provider-channel and domain endpoints remain compatible by delegating to the runtime. The Web application gets a top-toolbar platform route that combines runtime overview, capability configuration, recent invocations, and infrastructure state.

**Tech Stack:** FastAPI, Pydantic v2, SQLAlchemy, Alembic, SQLite, httpx, React 19, Next.js 16, TypeScript, Vitest, Testing Library, Playwright.

---

## File Structure

Backend files created by this plan:

- `services/api/comic_studio/model_runtime/contracts.py`: capability names, normalized requests/responses, health states, and runtime error payloads.
- `services/api/comic_studio/model_runtime/errors.py`: provider exception classification and redaction-safe runtime exceptions.
- `services/api/comic_studio/model_runtime/adapters.py`: registry that maps capabilities to existing provider implementations.
- `services/api/comic_studio/model_runtime/repository.py`: invocation history and stale-job recovery.
- `services/api/comic_studio/model_runtime/service.py`: the only application-facing model invocation boundary.
- `services/api/comic_studio/routes/model_runtime.py`: typed configuration, health, invocation, job, and history endpoints.
- `services/api/alembic/versions/20260712_03_model_runtime.py`: invocation history table and job metadata columns.

Frontend files created by this plan:

- `apps/web/components/ModelCenter.tsx`: full-width platform page and data orchestration.
- `apps/web/components/ModelRuntimeOverview.tsx`: four capability status summaries.
- `apps/web/components/ModelInvocationList.tsx`: recent invocation outcomes and retry controls.
- `apps/web/components/RuntimeInfrastructure.tsx`: API, Mock SSH, queue, and persistence diagnostics.
- `apps/web/tests/model-center.test.tsx`: Model Center interaction tests.

Existing `ProviderSettings` and `ProviderChannelSection` stay responsible for channel editing; they are embedded into Model Center rather than duplicated.

## Task 1: Define Runtime Contracts And Error Taxonomy

**Files:**
- Create: `services/api/comic_studio/model_runtime/__init__.py`
- Create: `services/api/comic_studio/model_runtime/contracts.py`
- Create: `services/api/comic_studio/model_runtime/errors.py`
- Test: `services/api/tests/test_model_runtime_contracts.py`

- [ ] **Step 1: Write failing contract tests**

```python
from comic_studio.model_runtime.contracts import Capability, RuntimeJobRead
from comic_studio.model_runtime.errors import RuntimeErrorCode, classify_provider_error
from comic_studio.providers.base import ProviderError


def test_runtime_job_contract_uses_capability_names():
    result = RuntimeJobRead(job_id="job-1", capability=Capability.IMAGE, status="queued")
    assert result.model_dump(mode="json") == {
        "job_id": "job-1",
        "capability": "image",
        "status": "queued",
    }


def test_provider_timeout_is_retryable_and_sanitized():
    error = classify_provider_error(TimeoutError("secret request payload"), Capability.IMAGE)
    assert error.code is RuntimeErrorCode.PROVIDER_TIMEOUT
    assert error.retryable is True
    assert "secret request payload" not in error.message


def test_invalid_provider_response_is_not_reported_as_connectivity():
    error = classify_provider_error(ProviderError("GPT Image returned no image data"), Capability.IMAGE)
    assert error.code is RuntimeErrorCode.INVALID_RESPONSE
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
cd services/api && uv run pytest tests/test_model_runtime_contracts.py -q
```

Expected: collection fails because `comic_studio.model_runtime` does not exist.

- [ ] **Step 3: Implement normalized contracts**

```python
# services/api/comic_studio/model_runtime/contracts.py
from enum import StrEnum
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class Capability(StrEnum):
    TEXT = "text"
    IMAGE = "image"
    SPEECH = "speech"
    VIDEO = "video"


class RuntimeJobRead(BaseModel):
    model_config = ConfigDict(extra="forbid")
    job_id: str
    capability: Capability
    status: Literal["queued", "running", "succeeded", "failed"]


class RuntimeErrorRead(BaseModel):
    code: str
    message: str
    retryable: bool
    capability: Capability
    provider: str


class TextStreamRequest(BaseModel):
    context: dict
    purpose: Literal["script_generation", "script_import", "episode_planning"]


class ImageRuntimeRequest(BaseModel):
    target_type: Literal["shot", "character"]
    target_id: str
    activate: bool = True
    reference_type: str = "primary"
    label: str = ""


class SpeechRuntimeRequest(BaseModel):
    dialogue_id: str


class VideoRuntimeRequest(BaseModel):
    shot_id: str
    activate: bool = True
```

- [ ] **Step 4: Implement stable error classification**

```python
# services/api/comic_studio/model_runtime/errors.py
from dataclasses import dataclass
from enum import StrEnum
import httpx
from comic_studio.model_runtime.contracts import Capability
from comic_studio.provider_factory import ProviderConfigurationError
from comic_studio.providers.base import ProviderError


class RuntimeErrorCode(StrEnum):
    CONFIGURATION_ERROR = "configuration_error"
    PROVIDER_UNAVAILABLE = "provider_unavailable"
    PROVIDER_TIMEOUT = "provider_timeout"
    INVALID_RESPONSE = "invalid_response"
    RUNTIME_INTERRUPTED = "runtime_interrupted"


@dataclass(frozen=True)
class ModelRuntimeError(Exception):
    code: RuntimeErrorCode
    message: str
    retryable: bool
    capability: Capability
    provider: str = ""


def classify_provider_error(error: Exception, capability: Capability, provider: str = "") -> ModelRuntimeError:
    if isinstance(error, ProviderConfigurationError):
        return ModelRuntimeError(RuntimeErrorCode.CONFIGURATION_ERROR, f"{capability.value} capability is not configured", False, capability, provider)
    if isinstance(error, (TimeoutError, httpx.TimeoutException)):
        return ModelRuntimeError(RuntimeErrorCode.PROVIDER_TIMEOUT, f"{capability.value} provider timed out", True, capability, provider)
    if isinstance(error, (httpx.TransportError, ConnectionError, OSError)):
        return ModelRuntimeError(RuntimeErrorCode.PROVIDER_UNAVAILABLE, f"{capability.value} provider is unavailable", True, capability, provider)
    if isinstance(error, ProviderError):
        return ModelRuntimeError(RuntimeErrorCode.INVALID_RESPONSE, f"{capability.value} provider returned an invalid response", False, capability, provider)
    return ModelRuntimeError(RuntimeErrorCode.PROVIDER_UNAVAILABLE, f"{capability.value} invocation failed", True, capability, provider)
```

- [ ] **Step 5: Run tests and commit**

```bash
cd services/api && uv run pytest tests/test_model_runtime_contracts.py -q
cd ../.. && git add services/api/comic_studio/model_runtime services/api/tests/test_model_runtime_contracts.py
git commit -m "feat: define model runtime contracts"
```

Expected: contract tests pass and the commit contains only Task 1 files.

## Task 2: Persist Invocation History And Recover Interrupted Jobs

**Files:**
- Modify: `services/api/comic_studio/models.py`
- Modify: `services/api/comic_studio/jobs.py`
- Create: `services/api/comic_studio/model_runtime/repository.py`
- Create: `services/api/alembic/versions/20260712_03_model_runtime.py`
- Modify: `services/api/tests/test_migrations.py`
- Test: `services/api/tests/test_model_runtime_repository.py`

- [ ] **Step 1: Write failing persistence and recovery tests**

```python
from comic_studio.jobs import JobStore
from comic_studio.model_runtime.contracts import Capability
from comic_studio.model_runtime.repository import InvocationRepository


def test_records_sanitized_terminal_invocation(session):
    record = InvocationRepository(session).start(Capability.TEXT, "minimax", "MiniMax-M3", "project", "p1")
    finished = InvocationRepository(session).finish(record.id, status="succeeded", elapsed_ms=1250)
    assert finished.capability == "text"
    assert finished.elapsed_ms == 1250
    assert finished.error_code == ""


def test_recovers_running_runtime_jobs_as_interrupted(session):
    job = JobStore(session).create("runtime_image", "shot", "s1", {"capability": "image"})
    JobStore(session).transition(job.id, "running")
    recovered = InvocationRepository(session).recover_running_jobs()
    assert recovered == [job.id]
    interrupted = JobStore(session).get(job.id)
    assert interrupted.status == "failed"
    assert interrupted.result_metadata["error_code"] == "runtime_interrupted"
    assert interrupted.result_metadata["retryable"] is True
```

- [ ] **Step 2: Run tests and verify RED**

```bash
cd services/api && uv run pytest tests/test_model_runtime_repository.py tests/test_migrations.py -q
```

Expected: tests fail because `ModelInvocation` and the runtime repository do not exist.

- [ ] **Step 3: Add the invocation model and migration**

```python
# append to models.py
class ModelInvocation(Base):
    __tablename__ = "model_invocations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    capability: Mapped[str] = mapped_column(String(24), index=True)
    provider: Mapped[str] = mapped_column(String(80))
    model: Mapped[str] = mapped_column(String(120))
    target_type: Mapped[str] = mapped_column(String(40), default="")
    target_id: Mapped[str] = mapped_column(String(36), default="", index=True)
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(24), index=True)
    elapsed_ms: Mapped[int] = mapped_column(Integer, default=0)
    error_code: Mapped[str] = mapped_column(String(64), default="")
    retryable: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
```

The Alembic revision must create `model_invocations` with indexes on `capability`, `status`, `target_id`, and `job_id`, and downgrade by dropping those indexes and the table.

- [ ] **Step 4: Add a forced failure transition and repository**

```python
# jobs.py
def interrupt_running(self, job_id: str) -> Job:
    job = self.get(job_id)
    if job is None or job.status != "running":
        raise InvalidJobTransition("Only running jobs can be interrupted")
    job.status = "failed"
    job.error = "Model runtime was interrupted"
    job.result_metadata = {"error_code": "runtime_interrupted", "retryable": True}
    self.session.commit()
    self.session.refresh(job)
    return job
```

```python
# model_runtime/repository.py
from sqlalchemy import select
from comic_studio import models
from comic_studio.jobs import JobStore


class InvocationRepository:
    def __init__(self, session): self.session = session

    def start(self, capability, provider, model, target_type="", target_id="", job_id=None):
        item = models.ModelInvocation(capability=capability.value, provider=provider, model=model, target_type=target_type, target_id=target_id, job_id=job_id, status="running")
        self.session.add(item); self.session.commit(); self.session.refresh(item); return item

    def finish(self, invocation_id, *, status, elapsed_ms, error_code="", retryable=False):
        item = self.session.get(models.ModelInvocation, invocation_id)
        item.status, item.elapsed_ms, item.error_code, item.retryable = status, elapsed_ms, error_code, retryable
        self.session.commit(); self.session.refresh(item); return item

    def recover_running_jobs(self):
        jobs = list(self.session.scalars(select(models.Job).where(models.Job.status == "running", models.Job.operation.like("runtime_%"))))
        for job in jobs: JobStore(self.session).interrupt_running(job.id)
        return [job.id for job in jobs]
```

- [ ] **Step 5: Verify migration, tests, and commit**

```bash
cd services/api
uv run alembic upgrade head
uv run pytest tests/test_model_runtime_repository.py tests/test_migrations.py -q
cd ../..
git add services/api/comic_studio/models.py services/api/comic_studio/jobs.py services/api/comic_studio/model_runtime/repository.py services/api/alembic/versions/20260712_03_model_runtime.py services/api/tests/test_model_runtime_repository.py services/api/tests/test_migrations.py
git commit -m "feat: persist model runtime invocations"
```

Expected: migration and repository tests pass.

## Task 3: Build Adapter Registry And ModelRuntimeService

**Files:**
- Create: `services/api/comic_studio/model_runtime/adapters.py`
- Create: `services/api/comic_studio/model_runtime/service.py`
- Modify: `services/api/comic_studio/main.py`
- Test: `services/api/tests/test_model_runtime_service.py`

- [ ] **Step 1: Write failing service tests with fake adapters**

```python
import pytest
from comic_studio.model_runtime.contracts import Capability
from comic_studio.model_runtime.errors import ModelRuntimeError, RuntimeErrorCode
from comic_studio.model_runtime.service import ModelRuntimeService


@pytest.mark.asyncio
async def test_stream_text_uses_registered_text_adapter(runtime_store, session_factory):
    adapter = FakeTextAdapter(chunks=["A", "B"])
    runtime = ModelRuntimeService(runtime_store, session_factory, adapters={Capability.TEXT: lambda: adapter})
    request = TextStreamRequest(purpose="script_generation", context={})
    assert [chunk async for chunk in runtime.stream_text(request)] == ["A", "B"]


@pytest.mark.asyncio
async def test_media_failure_is_classified_and_persisted(runtime_store, session_factory):
    runtime = ModelRuntimeService(runtime_store, session_factory, adapters={Capability.IMAGE: lambda: FailingAdapter(TimeoutError())})
    with pytest.raises(ModelRuntimeError) as raised:
        await runtime.execute_image("shot", "s1", {"activate": True})
    assert raised.value.code is RuntimeErrorCode.PROVIDER_TIMEOUT
```

- [ ] **Step 2: Run tests and verify RED**

```bash
cd services/api && uv run pytest tests/test_model_runtime_service.py -q
```

Expected: import fails because adapters and service are absent.

- [ ] **Step 3: Implement adapter registry around existing providers**

```python
# model_runtime/adapters.py
class CapabilityAdapterRegistry:
    def __init__(self, provider_factory): self.provider_factory = provider_factory
    def create(self, capability):
        return {
            Capability.TEXT: self.provider_factory.create_llm,
            Capability.IMAGE: self.provider_factory.create_image,
            Capability.SPEECH: self.provider_factory.create_tts,
            Capability.VIDEO: self.provider_factory.create_video,
        }[capability]()
```

- [ ] **Step 4: Implement the runtime service boundary**

`ModelRuntimeService` must provide these methods with the exact signatures used by later tasks. Implement the shared invocation bookkeeping once and keep domain asset persistence in the existing services:

```python
async def stream_text(self, request: TextStreamRequest):
    provider = self.adapters.create(Capability.TEXT)
    with self.session_factory() as session:
        invocation = InvocationRepository(session).start(Capability.TEXT, "minimax", provider.model)
    started = perf_counter()
    try:
        async for chunk in provider.stream_script(request.context):
            yield chunk
        with self.session_factory() as session:
            InvocationRepository(session).finish(invocation.id, status="succeeded", elapsed_ms=round((perf_counter() - started) * 1000))
    except Exception as error:
        runtime_error = classify_provider_error(error, Capability.TEXT, "minimax")
        with self.session_factory() as session:
            InvocationRepository(session).finish(invocation.id, status="failed", elapsed_ms=round((perf_counter() - started) * 1000), error_code=runtime_error.code.value, retryable=runtime_error.retryable)
        raise runtime_error from error

async def plan_episode(self, context: dict):
    return await self.adapters.create(Capability.TEXT).plan_episode(context)

async def parse_script_import(self, context: dict):
    return await self.adapters.create(Capability.TEXT).parse_script_import(context)

async def execute_image(self, target_type: str, target_id: str, request_payload: dict):
    provider = self.adapters.create(Capability.IMAGE)
    with self.session_factory() as session:
        if target_type == "shot":
            return await PanelService(session, self.data_root, provider).generate_panel(target_id, activate=bool(request_payload.get("activate", True)))
        return await CharacterReferenceService(session, self.data_root).generate(
            target_id,
            str(request_payload.get("reference_type", "primary")),
            str(request_payload.get("label", "")),
            provider,
        )

async def execute_speech(self, dialogue_id: str):
    with self.session_factory() as session:
        return await SpeechService(session, self.data_root, self.adapters.create(Capability.SPEECH)).synthesize_dialogue(dialogue_id)

async def execute_video(self, shot_id: str, activate: bool):
    with self.session_factory() as session:
        return await VideoService(session, self.data_root, self.adapters.create(Capability.VIDEO)).generate(shot_id, activate=activate)

def create_media_job(self, capability: Capability, target_type: str, target_id: str, request_payload: dict):
    with self.session_factory() as session:
        return JobStore(session).create(f"runtime_{capability.value}", target_type, target_id, {"capability": capability.value, **request_payload})

async def run_media_job(self, job_id: str):
    with self.session_factory() as session:
        store = JobStore(session)
        job = store.transition(job_id, "running", progress=5)
        capability = Capability(job.request_payload["capability"])
    try:
        if capability is Capability.IMAGE:
            result = await self.execute_image(job.target_type, job.target_id, job.request_payload)
        elif capability is Capability.SPEECH:
            result = await self.execute_speech(job.target_id)
        else:
            result = await self.execute_video(job.target_id, bool(job.request_payload.get("activate", True)))
        self.finish_media_job(job_id, capability, result)
    except Exception as error:
        self.fail_media_job(job_id, classify_provider_error(error, capability))
```

The service must open its own SQLAlchemy session for invocation records, use `PanelService`, `CharacterReferenceService`, `SpeechService`, or `VideoService` for domain asset persistence, and call `classify_provider_error` before transitioning a job to failed.

- [ ] **Step 5: Wire one runtime instance into FastAPI startup**

```python
provider_factory = ProviderFactory(
    provider_channel_store,
    prefer_ssh_for_host=lambda ssh_host: app.state.mock_ssh_manager.owns_running_alias(ssh_host),
)
app.state.model_runtime = ModelRuntimeService(
    provider_channel_store,
    session_factory,
    settings.data_root,
    CapabilityAdapterRegistry(provider_factory),
)
```

Call `InvocationRepository(session).recover_running_jobs()` during lifespan startup after migrations.

- [ ] **Step 6: Run tests and commit**

```bash
cd services/api && uv run pytest tests/test_model_runtime_service.py tests/test_model_runtime_repository.py -q
cd ../.. && git add services/api/comic_studio/model_runtime services/api/comic_studio/main.py services/api/tests/test_model_runtime_service.py
git commit -m "feat: add model runtime service"
```

Expected: service tests pass without live model calls.

## Task 4: Add Typed Runtime HTTP Endpoints

**Files:**
- Create: `services/api/comic_studio/routes/model_runtime.py`
- Modify: `services/api/comic_studio/main.py`
- Modify: `services/api/comic_studio/schemas.py`
- Test: `services/api/tests/test_model_runtime_api.py`

- [ ] **Step 1: Write failing API contract tests**

```python
def test_image_runtime_returns_normalized_accepted_job(client, fake_runtime):
    fake_runtime.create_media_job.return_value = FakeJob(id="job-1", status="queued")
    response = client.post("/api/model-runtime/image", json={"target_type": "shot", "target_id": "s1", "activate": True})
    assert response.status_code == 202
    assert response.json() == {"job_id": "job-1", "capability": "image", "status": "queued"}


def test_runtime_error_uses_stable_error_envelope(client, fake_runtime):
    fake_runtime.create_media_job.side_effect = ModelRuntimeError(RuntimeErrorCode.CONFIGURATION_ERROR, "image capability is not configured", False, Capability.IMAGE, "gpt-image")
    response = client.post("/api/model-runtime/image", json={"target_type": "shot", "target_id": "s1"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "configuration_error"


def test_runtime_health_separates_infrastructure(client):
    response = client.get("/api/model-runtime/health")
    assert set(response.json()) == {"capabilities", "infrastructure", "checked_at"}
```

- [ ] **Step 2: Run tests and verify RED**

```bash
cd services/api && uv run pytest tests/test_model_runtime_api.py -q
```

Expected: 404 responses for runtime routes.

- [ ] **Step 3: Implement `/api/model-runtime` router**

The router must expose:

```python
router = APIRouter(prefix="/api/model-runtime", tags=["model-runtime"])

@router.get("/channels")
def channels(request: Request):
    return request.app.state.model_runtime.read_channels()

@router.put("/channels/{capability}")
def update_channel(capability: Capability, update: ProviderChannelUpdate, request: Request):
    return request.app.state.model_runtime.update_channel(capability, update)

@router.post("/channels/{capability}/test")
async def test_channel(capability: Capability, update: ProviderChannelUpdate, request: Request):
    return await request.app.state.model_runtime.test_channel(capability, update)

@router.get("/health")
async def health(request: Request):
    return await request.app.state.model_runtime.health()

@router.get("/invocations")
def invocations(request: Request, limit: int = Query(default=50, ge=1, le=200)):
    return request.app.state.model_runtime.list_invocations(limit)

@router.post("/text/stream")
def text_stream(payload: TextStreamRequest, request: Request):
    return StreamingResponse(request.app.state.model_runtime.stream_sse(payload), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@router.post("/image", status_code=202)
def image(payload: ImageRuntimeRequest, request: Request, background_tasks: BackgroundTasks):
    request_payload = {"activate": payload.activate, "reference_type": payload.reference_type, "label": payload.label}
    job = request.app.state.model_runtime.create_media_job(Capability.IMAGE, payload.target_type, payload.target_id, request_payload)
    background_tasks.add_task(request.app.state.model_runtime.run_media_job, job.id)
    return RuntimeJobRead(job_id=job.id, capability=Capability.IMAGE, status=job.status)

@router.post("/speech", status_code=202)
def speech(payload: SpeechRuntimeRequest, request: Request, background_tasks: BackgroundTasks):
    job = request.app.state.model_runtime.create_media_job(Capability.SPEECH, "dialogue", payload.dialogue_id, {})
    background_tasks.add_task(request.app.state.model_runtime.run_media_job, job.id)
    return RuntimeJobRead(job_id=job.id, capability=Capability.SPEECH, status=job.status)

@router.post("/video", status_code=202)
def video(payload: VideoRuntimeRequest, request: Request, background_tasks: BackgroundTasks):
    job = request.app.state.model_runtime.create_media_job(Capability.VIDEO, "shot", payload.shot_id, {"activate": payload.activate})
    background_tasks.add_task(request.app.state.model_runtime.run_media_job, job.id)
    return RuntimeJobRead(job_id=job.id, capability=Capability.VIDEO, status=job.status)

@router.get("/jobs/{job_id}")
def job(job_id: str, request: Request):
    return request.app.state.model_runtime.get_job(job_id)

@router.post("/jobs/{job_id}/retry", status_code=202)
def retry(job_id: str, request: Request, background_tasks: BackgroundTasks):
    job = request.app.state.model_runtime.retry_job(job_id)
    background_tasks.add_task(request.app.state.model_runtime.run_media_job, job.id)
    return RuntimeJobRead(job_id=job.id, capability=Capability(job.request_payload["capability"]), status=job.status)
```

Use a router-level exception handler helper that maps `configuration_error` to 422, `provider_unavailable` and `provider_timeout` to 503, `invalid_response` to 502, and `runtime_interrupted` to 409.

- [ ] **Step 4: Include the router and run API tests**

```bash
cd services/api && uv run pytest tests/test_model_runtime_api.py tests/test_provider_channel_testing.py tests/test_provider_health.py -q
```

Expected: new and existing provider tests pass.

- [ ] **Step 5: Commit**

```bash
cd ../..
git add services/api/comic_studio/routes/model_runtime.py services/api/comic_studio/main.py services/api/comic_studio/schemas.py services/api/tests/test_model_runtime_api.py
git commit -m "feat: expose model runtime API"
```

## Task 5: Migrate Text Workflows To Runtime

**Files:**
- Modify: `services/api/comic_studio/routes/script_imports.py`
- Modify: `services/api/comic_studio/routes/episodes.py`
- Modify: `services/api/comic_studio/services/script_imports.py`
- Test: `services/api/tests/test_script_imports.py`
- Test: `services/api/tests/test_script_generation_stream.py`
- Test: `services/api/tests/test_episode_planning.py`

- [ ] **Step 1: Add failing delegation assertions**

```python
def test_script_stream_delegates_to_model_runtime(client, app, fake_runtime):
    response = client.post("/api/projects/p1/script-generation/stream", json={"brief": "new episode", "existing_draft": ""})
    assert response.status_code == 200
    fake_runtime.stream_text.assert_called_once()


def test_episode_planning_uses_runtime_planner(client, fake_runtime, episode):
    response = client.post(f"/api/episodes/{episode.id}/plan")
    assert response.status_code == 202
    assert fake_runtime.created_capability == "text"
```

- [ ] **Step 2: Verify tests fail because routes still use `provider_factory`**

```bash
cd services/api && uv run pytest tests/test_script_generation_stream.py tests/test_script_imports.py tests/test_episode_planning.py -q
```

- [ ] **Step 3: Replace direct text provider construction**

Use:

```python
async for chunk in request.app.state.model_runtime.stream_text(
    TextStreamRequest(purpose="script_generation", context=context)
):
    yield _sse("chunk", {"text": chunk})
```

Pass `app.state.model_runtime` as the planner dependency for episode planning and script import parsing. Preserve domain validation and existing SSE event names.

- [ ] **Step 4: Run text workflow tests and commit**

```bash
cd services/api && uv run pytest tests/test_script_generation_stream.py tests/test_script_imports.py tests/test_episode_planning.py -q
cd ../.. && git add services/api/comic_studio/routes/script_imports.py services/api/comic_studio/routes/episodes.py services/api/comic_studio/services/script_imports.py services/api/tests/test_script_generation_stream.py services/api/tests/test_script_imports.py services/api/tests/test_episode_planning.py
git commit -m "refactor: route text workflows through model runtime"
```

## Task 6: Migrate Image Workflows And Compatibility Endpoints

**Files:**
- Modify: `services/api/comic_studio/routes/assets.py`
- Modify: `services/api/comic_studio/routes/character_references.py`
- Modify: `services/api/comic_studio/services/character_references.py`
- Modify: `services/api/comic_studio/routes/provider_channels.py`
- Modify: `services/api/comic_studio/routes/providers.py`
- Test: `services/api/tests/test_panel_versions.py`
- Test: `services/api/tests/test_character_references.py`
- Test: `services/api/tests/test_provider_health.py`

- [ ] **Step 1: Add failing image delegation tests**

```python
def test_panel_endpoint_creates_runtime_image_job(client, fake_runtime, shot):
    response = client.post(f"/api/shots/{shot.id}/panels?activate=true")
    assert response.status_code == 202
    fake_runtime.create_media_job.assert_called_once_with(Capability.IMAGE, "shot", shot.id, {"activate": True})


def test_character_reference_generation_uses_image_runtime(client, fake_runtime, character):
    response = client.post(f"/api/characters/{character.id}/references/generate", json={"reference_type": "primary", "label": ""})
    assert response.status_code == 202
    assert fake_runtime.last_image_target == ("character", character.id)
```

- [ ] **Step 2: Verify RED**

```bash
cd services/api && uv run pytest tests/test_panel_versions.py tests/test_character_references.py tests/test_provider_health.py -q
```

- [ ] **Step 3: Delegate image routes and compatibility routes**

Replace route-local `run_panel_job` provider creation with `app.state.model_runtime.run_media_job(job_id)`. Keep existing response shapes for domain callers. Change `/api/provider-channels/*` and `/api/providers/health` handlers to call the runtime channel and health services while retaining their existing schemas.

- [ ] **Step 4: Run tests and commit**

```bash
cd services/api && uv run pytest tests/test_panel_versions.py tests/test_character_references.py tests/test_provider_health.py tests/test_provider_channel_testing.py -q
cd ../.. && git add services/api/comic_studio/routes/assets.py services/api/comic_studio/routes/character_references.py services/api/comic_studio/services/character_references.py services/api/comic_studio/routes/provider_channels.py services/api/comic_studio/routes/providers.py services/api/tests/test_panel_versions.py services/api/tests/test_character_references.py services/api/tests/test_provider_health.py
git commit -m "refactor: route image workflows through model runtime"
```

## Task 7: Migrate Speech, Video, Batch Production, And Retry Dispatch

**Files:**
- Modify: `services/api/comic_studio/routes/speech.py`
- Modify: `services/api/comic_studio/routes/videos.py`
- Modify: `services/api/comic_studio/routes/jobs.py`
- Modify: `services/api/comic_studio/main.py`
- Modify: `services/api/comic_studio/services/production_coordinator.py`
- Test: `services/api/tests/test_speech.py`
- Test: `services/api/tests/test_video_generation.py`
- Test: `services/api/tests/test_job_retry.py`
- Test: `services/api/tests/test_production_runs.py`

- [ ] **Step 1: Add failing delegation and recovery tests**

```python
def test_speech_endpoint_creates_runtime_speech_job(client, fake_runtime, dialogue):
    response = client.post(f"/api/dialogue/{dialogue.id}/speech")
    assert response.status_code == 202
    fake_runtime.create_media_job.assert_called_once_with(Capability.SPEECH, "dialogue", dialogue.id, {})


def test_video_retry_dispatches_runtime_job(client, failed_runtime_video_job, fake_runtime):
    response = client.post(f"/api/jobs/{failed_runtime_video_job.id}/retry")
    assert response.status_code == 202
    assert fake_runtime.dispatched_job_id == failed_runtime_video_job.id
```

- [ ] **Step 2: Verify RED**

```bash
cd services/api && uv run pytest tests/test_speech.py tests/test_video_generation.py tests/test_job_retry.py tests/test_production_runs.py -q
```

- [ ] **Step 3: Replace speech/video provider construction and production callbacks**

All media dispatchers must call:

```python
await app.state.model_runtime.run_media_job(job_id)
```

Production coordinator callbacks must call `execute_image`, `execute_speech`, or `execute_video` on the runtime rather than creating providers. Extend retry dispatch for `runtime_image`, `runtime_speech`, and `runtime_video`; keep legacy operation names supported until old jobs age out.

- [ ] **Step 4: Run backend suite and commit**

```bash
cd services/api && uv run pytest -q
cd ../.. && git add services/api/comic_studio/routes/speech.py services/api/comic_studio/routes/videos.py services/api/comic_studio/routes/jobs.py services/api/comic_studio/main.py services/api/comic_studio/services/production_coordinator.py services/api/tests/test_speech.py services/api/tests/test_video_generation.py services/api/tests/test_job_retry.py services/api/tests/test_production_runs.py
git commit -m "refactor: unify media jobs in model runtime"
```

Expected: full API suite passes and `rg "provider_factory\.create_" services/api/comic_studio/routes services/api/comic_studio/services` returns no business-workflow matches.

## Task 8: Add Model Center API Client, Types, And Page Components

**Files:**
- Modify: `apps/web/lib/types.ts`
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/components/ModelCenter.tsx`
- Create: `apps/web/components/ModelRuntimeOverview.tsx`
- Create: `apps/web/components/ModelInvocationList.tsx`
- Create: `apps/web/components/RuntimeInfrastructure.tsx`
- Modify: `apps/web/components/ProviderSettings.tsx`
- Test: `apps/web/tests/model-center.test.tsx`

- [ ] **Step 1: Write failing Model Center tests**

```tsx
it('separates capability health from infrastructure failures', async () => {
  mocks.getModelRuntimeHealth.mockResolvedValue({
    capabilities: {text: healthyText, image: healthyImage, speech: degradedSpeech, video: disabledVideo},
    infrastructure: {api: {status: 'healthy'}, mock_ssh: {status: 'unavailable', message: 'Mock SSH stopped'}, queue: {queued: 0, running: 1}, persistence: {status: 'saved'}},
    checked_at: '2026-07-12T00:00:00Z',
  });
  render(<ModelCenter onBack={() => {}}/>);
  expect(await screen.findByText('画面生成')).toBeVisible();
  expect(screen.getByText('Mock SSH stopped')).toBeVisible();
  expect(screen.getByText('基础设施异常')).toBeVisible();
});


it('retries a retryable recent invocation', async () => {
  render(<ModelCenter onBack={() => {}}/>);
  await userEvent.click(await screen.findByRole('button', {name: '重试图片任务'}));
  expect(mocks.retryModelRuntimeJob).toHaveBeenCalledWith('job-1');
});
```

- [ ] **Step 2: Verify RED**

```bash
npm test --workspace @comic-studio/web -- --run tests/model-center.test.tsx
```

- [ ] **Step 3: Add typed client functions**

```ts
export const getModelRuntimeChannels = () => apiRequest<ModelRuntimeChannels>('/api/model-runtime/channels');
export const getModelRuntimeHealth = () => apiRequest<ModelRuntimeHealth>('/api/model-runtime/health');
export const listModelInvocations = () => apiRequest<ModelInvocation[]>('/api/model-runtime/invocations');
export const retryModelRuntimeJob = (jobId: string) => apiRequest<RuntimeJob>(`/api/model-runtime/jobs/${jobId}/retry`, json('POST', {}));
```

Define `ModelCapability`, `CapabilityHealth`, `RuntimeInfrastructureHealth`, `ModelRuntimeHealth`, `ModelInvocation`, and `RuntimeJob` in `types.ts` using exact backend field names.

- [ ] **Step 4: Build the full-width Model Center**

`ModelCenter` loads health, channels, and recent invocations concurrently; it renders:

```tsx
<main className="model-center">
  <header className="model-center-heading">
    <div><span>平台运行时</span><h1>模型中心</h1><p>统一管理配置、健康状态和调用任务</p></div>
    <div><button onClick={reload}>检测全部</button><button onClick={onBack}>返回工作台</button></div>
  </header>
  <ModelRuntimeOverview health={health.capabilities}/>
  <div className="model-center-columns">
    <ProviderSettings embedded onSaved={reload}/>
    <ModelInvocationList items={invocations} onRetry={retry}/>
  </div>
  <RuntimeInfrastructure value={health.infrastructure}/>
</main>
```

Add an `embedded?: boolean` prop to `ProviderSettings` so it can omit its old page heading while retaining dirty-state, test, save, secret, and Mock SSH behavior.

- [ ] **Step 5: Run tests and commit**

```bash
npm test --workspace @comic-studio/web -- --run tests/model-center.test.tsx tests/provider-settings.test.tsx
git add apps/web/lib/types.ts apps/web/lib/api.ts apps/web/components/ModelCenter.tsx apps/web/components/ModelRuntimeOverview.tsx apps/web/components/ModelInvocationList.tsx apps/web/components/RuntimeInfrastructure.tsx apps/web/components/ProviderSettings.tsx apps/web/tests/model-center.test.tsx
git commit -m "feat: add model center page"
```

## Task 9: Add Global Entry, Remove Project-Level Settings Tab, And Verify E2E

**Files:**
- Modify: `apps/web/components/AppToolbar.tsx`
- Modify: `apps/web/components/Workspace.tsx`
- Modify: `apps/web/components/WorkspaceTabs.tsx`
- Modify: `apps/web/components/ProjectNavigator.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/tests/app-toolbar.test.tsx`
- Modify: `apps/web/tests/workspace.test.tsx`
- Modify: `apps/web/e2e/production-flow.spec.ts`
- Modify: `scripts/dev.sh`
- Modify: `README.md`

- [ ] **Step 1: Write failing global navigation tests**

```tsx
it('opens Model Center from the global toolbar and returns to the workspace', async () => {
  render(<Workspace/>);
  await userEvent.click(await screen.findByRole('button', {name: '模型中心'}));
  expect(screen.getByRole('heading', {name: '模型中心'})).toBeVisible();
  expect(screen.queryByRole('tab', {name: '模型渠道'})).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', {name: '返回工作台'}));
  expect(screen.getByRole('tab', {name: '总览'})).toBeVisible();
});
```

- [ ] **Step 2: Verify RED**

```bash
npm test --workspace @comic-studio/web -- --run tests/app-toolbar.test.tsx tests/workspace.test.tsx
```

- [ ] **Step 3: Add the top-toolbar entry and platform-page state**

Add a `modelCenterOpen` boolean in `Workspace`. Pass `onModelCenter={() => setModelCenterOpen(true)}` to `AppToolbar`. When open, render the toolbar and `<ModelCenter onBack={() => setModelCenterOpen(false)}/>` without project tabs, navigator, or inspector. Remove `settings` from `WorkArea`, `WorkspaceTabs`, and `ProjectNavigator` after Model Center owns configuration.

Use the Lucide `Cpu` or `Waypoints` icon with an accessible name `模型中心`; keep the button compact and global in the toolbar.

- [ ] **Step 4: Stabilize the default development API process**

Change `scripts/dev.sh` so the default API command omits `--reload`. Support explicit reload only through `AI_COMIC_API_RELOAD=1`:

```bash
API_ARGS=(comic_studio.main:app --host 127.0.0.1 --port "$API_PORT")
if [[ "${AI_COMIC_API_RELOAD:-0}" == "1" ]]; then API_ARGS+=(--reload); fi
uv run uvicorn "${API_ARGS[@]}"
```

Document that real model jobs require stable mode and that reload mode interrupts in-flight work.

- [ ] **Step 5: Add E2E coverage**

Extend Playwright fixtures to mock `/api/model-runtime/health`, `/channels`, `/invocations`, and retry. Verify opening Model Center, viewing a speech infrastructure failure, editing a channel, returning to the workspace, and preserving the selected episode.

- [ ] **Step 6: Run complete verification**

```bash
cd services/api && uv run pytest -q
cd ../..
npm test --workspace @comic-studio/web
AI_COMIC_API_PROXY_TARGET=http://127.0.0.1:8100 npm run build --workspace @comic-studio/web
npm run test:e2e --workspace @comic-studio/web
rg "provider_factory\.create_" services/api/comic_studio/routes services/api/comic_studio/services
```

Expected:

- API suite passes.
- Web unit suite passes.
- Production build completes.
- E2E suite passes.
- `rg` reports no direct business-workflow provider construction; construction remains only inside the runtime adapter registry.

- [ ] **Step 7: Commit final integration**

```bash
git add apps/web/components/AppToolbar.tsx apps/web/components/Workspace.tsx apps/web/components/WorkspaceTabs.tsx apps/web/components/ProjectNavigator.tsx apps/web/app/globals.css apps/web/tests/app-toolbar.test.tsx apps/web/tests/workspace.test.tsx apps/web/e2e/production-flow.spec.ts scripts/dev.sh README.md
git commit -m "feat: add global model center entry"
```

## Final Manual Runtime Verification

- [ ] Start the API in stable mode and Web UI through `./scripts/dev.sh`.
- [ ] Open `http://127.0.0.1:<web-port>/` and enter Model Center from the toolbar.
- [ ] Confirm configuration and health load without direct browser access to the API port.
- [ ] Confirm text and image capabilities are reported separately from Mock SSH infrastructure.
- [ ] Run one explicitly approved real image generation and verify the invocation record contains provider, model, elapsed time, and success without a stored prompt or key.
- [ ] Stop the API during a fake media job, restart it, and verify the job reads `runtime_interrupted` and exposes retry.
- [ ] Confirm video remains `disabled` when no key is configured rather than `unavailable`.
