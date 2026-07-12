# Character Reference Set Generation Design

Date: 2026-07-12

## Goal

Replace per-view character image generation with one background action that creates a complete, visually consistent reference set. The set must use GPT Image 2 through its native media APIs and preserve completed results when a later view fails.

## User Experience

The character workspace exposes one primary command: `一键生成整套`. A run creates these seven reference types in order:

1. `primary`
2. `front`
3. `three_quarter`
4. `side`
5. `back`
6. `expression`
7. `outfit`

The UI shows the current item and total progress, for example `正在生成 3/7：四分之三`. Each completed reference becomes visible immediately. Existing references are never overwritten; a new run creates new versions.

If a run fails, the UI displays the failed reference type and the persisted provider error. References completed before the failure remain available. The same command can continue the unfinished reference types without regenerating successful types from that run.

## Consistency Strategy

Every generated set has exactly one identity anchor.

- If the character already has an approved, active `primary` or `front` reference, the run uses it as the anchor.
- Otherwise, the run creates a `primary` reference first, automatically approves it, and activates it.
- All remaining views are edits of that same anchor. A generated variant never becomes the input for another variant, avoiding cumulative identity drift.

Prompts lock the character's face, hairstyle, age, body proportions, costume construction, palette, accessories, and distinctive continuity details. View prompts may change only camera angle, pose, expression sheet content, or outfit presentation required by the target type. Outputs use a plain neutral background and contain no text.

## Provider Contract

The only model ID is `gpt-image-2` at the configured GPT Image base URL. The API key is read from the existing provider configuration or environment and is never included in responses, task metadata, logs, or source code.

Native endpoints are used directly:

- Primary generation: `POST /v1/images/generations` with JSON.
- Anchored variants: `POST /v1/images/edits` with multipart form data.

The implementation must not route image work through Chat Completions, Responses, Anthropic Messages, Gemini, or another gateway translation endpoint.

Edit inputs are downscaled to a maximum dimension of 256 pixels before upload. Edits use `quality=low` to stay within the provider's reliable latency range. HTTP status errors and business error fields are parsed into a provider error without exposing credentials. Provider failures retain the runtime job ID, terminal status, failed reference type, and original sanitized error.

## Backend Architecture

A character reference set is one durable Runtime image job with a batch payload. The worker executes reference types serially to limit provider load and keep progress deterministic.

The job metadata records:

- ordered reference types;
- completed reference types and their reference or asset IDs;
- current reference type and current index;
- anchor reference and asset IDs;
- failed reference type and sanitized provider error when applicable.

The service commits each completed reference before starting the next provider request. Progress advances after every committed item. Retry resumes from the first incomplete type and reuses the original anchor.

The existing single-reference generation service remains the low-level operation. A batch orchestration service owns ordering, anchor selection, progress persistence, automatic primary approval and activation, and resume behavior.

## API Contract

The Web client starts the batch through the unified model Runtime image endpoint using a character target and a set-generation mode. The endpoint returns `202 Accepted` with a Runtime job ID immediately.

Polling continues through the existing job endpoint. Result metadata includes the current step and completed references so the UI can render useful progress without a separate transient state store.

Single-reference upload, approval, activation, and version browsing remain supported. The old per-filter generate action is removed from the main workflow.

## Failure Semantics

- Missing character: fail before provider invocation.
- Provider configuration unavailable: fail before creating image assets.
- Primary generation failure: fail with no automatic approval or activation.
- Variant failure: preserve the anchor and all completed variants.
- Persistence failure after provider success: do not report the item as completed; retry may generate that item again.
- Retry: skip completed reference types recorded by the job and continue with the same anchor.

No automatic rollback deletes useful generated images.

## Testing

Backend tests cover:

- creating and auto-activating a primary anchor when none exists;
- reusing an approved active anchor;
- sending every variant through the native edit provider;
- stable serial ordering and progress metadata;
- partial failure persistence and retry from the first incomplete type;
- provider error sanitization;
- no credential exposure in job metadata or API responses.

Frontend tests cover:

- the one-click batch request payload;
- immediate queued/running state;
- current-step progress text;
- incremental reference refresh;
- partial failure details and retry behavior;
- prevention of duplicate clicks while a batch is active.

An end-to-end verification must start a real batch through port 3100, confirm an immediate `202`, poll it to a terminal state, and verify that all seven media URLs return valid images with consistent character identity.

## Out of Scope

- Parallel variant generation.
- Automatic replacement or deletion of previous reference versions.
- User-configurable reference type sets.
- Additional image providers or model IDs.
- Automatic approval of variants; only a newly generated primary anchor is approved and activated automatically.
