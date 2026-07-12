# Unified Model Runtime Design

## Objective

Create an internal platform-level Model Center that owns model configuration, health diagnostics, and provider invocation for text, image, speech, and video capabilities. Business workflows must depend on one stable runtime contract instead of constructing MiniMax, GPT Image, Qwen TTS, or MiniMax Video providers directly.

The first version is internal to AI Comic Studio. It does not expose a shared local gateway or OpenAI-compatible public API.

## Product Decisions

- Entry: a global `Model Center` command in the top application toolbar.
- Page: an independent full-width platform page, not a project or episode workspace tab.
- Scope: configuration, health checks, model invocation, task status, recent calls, and runtime infrastructure diagnostics.
- API shape: typed endpoints per capability rather than one generic invoke endpoint.
- Execution: synchronous configuration and health operations, streaming text, and background jobs for image, speech, and video.
- Deployment: the runtime remains a bounded module inside the existing FastAPI service for the first version.

## Architecture

```text
Model Center Web UI
    |
    +-- configuration and health
    |      +-- /api/model-runtime/channels
    |      +-- /api/model-runtime/health
    |
    +-- capability invocation
           +-- /api/model-runtime/text/stream
           +-- /api/model-runtime/image
           +-- /api/model-runtime/speech
           +-- /api/model-runtime/video
                         |
                         v
                 ModelRuntimeService
                         |
              Capability Adapter Registry
              +-- text   -> MiniMax adapter
              +-- image  -> GPT Image adapter
              +-- speech -> Qwen TTS adapter
              +-- video  -> MiniMax Video adapter
```

`ModelRuntimeService` is the only application-facing model boundary. It resolves the configured adapter, validates the request, assigns timeouts, classifies errors, records invocation metadata, and creates background jobs when required.

The capability adapter registry owns provider-specific construction. Existing provider implementations remain reusable, but callers outside the runtime may not instantiate them directly.

## Module Boundaries

### ModelRuntimeService

Responsibilities:

- Accept normalized capability requests.
- Resolve a configured and enabled capability adapter.
- Start streaming text or create a persistent media job.
- Apply capability-specific timeout and retry policy.
- Convert provider exceptions into the runtime error taxonomy.
- Record sanitized invocation timing and outcome metadata.

Dependencies:

- Provider channel store.
- Capability adapter registry.
- Existing job store and database session factory.
- Runtime infrastructure status providers such as Mock SSH.

### Capability Adapters

Each adapter exposes only the operation required by its capability:

- Text: stream generated text from a structured prompt request.
- Image: generate or edit one image from prompt and optional references.
- Speech: synthesize WAV audio from text, speaker, language, and instruction.
- Video: submit image-to-video work, poll the provider task, and download MP4 output.

Provider-specific URLs, authentication headers, response parsing, and fallback behavior remain inside adapters.

### Invocation Repository

The existing `jobs` table remains authoritative for image, speech, and video execution. Runtime-specific metadata records capability, provider, model, elapsed time, retryability, and sanitized failure code. Secrets, full prompts, provider response bodies, and credentials are not stored in diagnostic metadata.

Text streaming records a lightweight terminal invocation result after the stream completes or fails. It does not create a polling job for the first version.

## HTTP Contract

### Configuration And Diagnostics

```text
GET  /api/model-runtime/channels
PUT  /api/model-runtime/channels/{capability}
POST /api/model-runtime/channels/{capability}/test
GET  /api/model-runtime/health
GET  /api/model-runtime/invocations
```

Supported capability path values are `text`, `image`, `speech`, and `video`. API responses use capability names; provider names remain implementation metadata.

Health checks verify configuration, authentication, endpoint reachability, and required infrastructure. They do not run a full image, speech, or video generation. Last real invocation latency is displayed separately from health-check latency.

### Invocation

```text
POST /api/model-runtime/text/stream
POST /api/model-runtime/image
POST /api/model-runtime/speech
POST /api/model-runtime/video
GET  /api/model-runtime/jobs/{job_id}
POST /api/model-runtime/jobs/{job_id}/retry
```

Text uses server-sent events and preserves the existing chunk, done, and error event semantics.

Media operations return HTTP 202 with a normalized body:

```json
{
  "job_id": "6f1d463f-727f-43ea-a68b-5e194fb75513",
  "capability": "image",
  "status": "queued"
}
```

Business endpoints may continue to return domain-specific responses, but they must call `ModelRuntimeService` and link their domain operation to the runtime job.

## Error Contract

All runtime failures use this response structure:

```json
{
  "error": {
    "code": "provider_timeout",
    "message": "Image generation timed out",
    "retryable": true,
    "capability": "image",
    "provider": "gpt-image"
  }
}
```

The stable error codes are:

- `configuration_error`: the capability is disabled or incompletely configured.
- `provider_unavailable`: the endpoint, authentication, or required infrastructure is unavailable.
- `provider_timeout`: the provider did not complete within the capability deadline.
- `invalid_response`: the provider returned unusable content or an unsupported response shape.
- `runtime_interrupted`: the API process stopped while a background task was running.

Messages are user-readable and sanitized. The runtime never returns API keys, authorization headers, raw provider response bodies, SSH credentials, full prompts, or local exception traces.

## Task Lifecycle And Recovery

Image, speech, and video calls use the existing persistent job lifecycle: `queued`, `running`, `succeeded`, and `failed`. Interrupted work is represented by a failed job whose stable error code is `runtime_interrupted` and whose retryability is true.

At API startup, runtime recovery changes stale `running` media jobs to interrupted. It does not automatically repeat billable model calls because the provider may have completed work before the local interruption. Users explicitly retry from the Model Center or the domain workflow.

Development startup must not run the stable API with automatic source reload while real model jobs are active. Model Center infrastructure diagnostics expose API process mode, task counts, Mock SSH state, and persisted configuration state so a process restart is distinguishable from a provider failure.

## Model Center UI

The top toolbar contains a global Model Center command. Activating it opens an independent full-width page and preserves the current project workspace state for return navigation.

The page contains four sections:

1. Runtime overview: one status summary for text, image, speech, and video, including configured model, health state, health latency, and last real invocation latency.
2. Capability channels: editable channel configuration with enable state, base URL, model, protected credential replacement, test, and save controls.
3. Recent invocations: capability, status, elapsed time, error category, retry eligibility, and a link back to the originating domain target.
4. Runtime infrastructure: API process state, Mock SSH state, queued/running task counts, and configuration persistence status.

Status language distinguishes `healthy`, `degraded`, `unavailable`, and `disabled`. A slow successful invocation is not displayed as an unavailable provider. Infrastructure failures are shown separately from provider failures.

## Migration

The existing `provider-channels.json` format and secret persistence remain unchanged in the first version.

Migration proceeds capability by capability:

1. Add runtime contracts, adapters, error mapping, invocation records, and recovery behavior.
2. Add Model Center API routes and UI.
3. Change script creation and episode planning to call the text runtime.
4. Change panel and character reference generation to call the image runtime.
5. Change dialogue synthesis to call the speech runtime.
6. Change shot video generation to call the video runtime.
7. Keep existing `/api/provider-channels/*` routes as compatibility adapters that delegate to the runtime.
8. Remove direct `ProviderFactory` use from business services after all capabilities are migrated.

Mock SSH is an infrastructure dependency of the speech adapter. It is displayed and diagnosed by Model Center, but it is not stored as an arbitrary field on non-speech channels.

## Testing

### Runtime Unit Tests

- Capability selection and disabled-channel validation.
- Provider exception to stable error-code mapping.
- Capability-specific timeout behavior.
- Retryable versus non-retryable classification.
- Secret and request-data redaction.
- Stale running-job recovery.

### API Contract Tests

- Channel read, update, and test endpoints.
- Health response status separation between provider and infrastructure.
- Streaming text frames and sanitized stream errors.
- HTTP 202 media job responses.
- Job status and explicit retry endpoints.
- Compatibility routes delegate to the runtime.

### Web Tests

- Global toolbar entry and return navigation.
- Runtime overview state rendering.
- Capability configuration save and dirty-state protection.
- Health diagnostics and infrastructure distinction.
- Recent invocation status and retry controls.
- Long-running action and recoverable error states.

### End-To-End Tests

- Configure a capability, test it, invoke it, and inspect the invocation record.
- Stream a text result through the runtime.
- Complete a deterministic fake image job and display its asset.
- Interrupt a running fake media job and retry it after API startup.

Live provider verification remains an explicit manual or sandbox command. It is not part of the default test suite because it consumes provider capacity and depends on external infrastructure.

## Acceptance Criteria

- Application business code does not construct provider classes directly.
- All model configuration and diagnostics are accessible from the global Model Center.
- Text calls stream through the runtime; image, speech, and video return persistent jobs.
- Provider, infrastructure, timeout, invalid-response, and process-interruption failures are distinguishable to users.
- API restarts cannot leave media jobs indefinitely marked as running.
- Existing provider configuration remains readable without credential migration.
- Existing provider-channel HTTP routes remain temporarily compatible through runtime delegation.
- Automated tests do not call live billable providers.
