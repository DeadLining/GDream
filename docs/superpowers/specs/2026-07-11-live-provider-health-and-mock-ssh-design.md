# Live Provider Health And Mock SSH Design

## Goal

Replace the toolbar's configuration counter with real provider checks and add a manually controlled, persistent HostBridge Mock SSH bridge to the Model Channels workspace.

The feature must make service state truthful, reduce Qwen TTS latency caused by repeated HostBridge login automation, and keep process ownership narrow enough that AI Comic Studio cannot stop unrelated HostBridge processes.

## Current Problem

`GET /api/providers/health` currently reports only whether each channel is enabled. The toolbar previously counted `ok` results, which produced `0/3`, and now displays configuration state rather than actual availability.

Qwen TTS is deployed on GPU 0 of the A800_94 server. Measured generation time for a short request is about one second. The observed 16-second client latency is dominated by approximately 9.6 seconds of HostBridge connection setup plus the failed direct LAN attempt and request overhead.

## Scope

This change covers:

- Live checks for the LLM, image, TTS, and video channels exposed by the current provider registry.
- A Mock SSH control surface in the Model Channels workspace.
- Persistent desired state so a bridge explicitly left running is restored after an API restart.
- TTS routing that uses the running bridge directly instead of first attempting an unreachable LAN URL.

This change does not install or upgrade HostBridge, edit HostBridge host credentials, remove SSH config blocks, or manage Mock SSH processes owned by another application.

## Mock SSH User Experience

The Model Channels workspace gains an un-nested `Mock SSH Bridge` section below the provider sections. It contains:

- A HostBridge host selector populated from the configured HostBridge host registry.
- An SSH alias field, defaulting to `ai-comic-tts` for `a800_94`.
- Start and stop commands.
- Status text for stopped, starting, running, stopping, and failed states.
- The resolved SSH alias and local port while running.
- An actionable error when HostBridge is unavailable, the host is missing, startup exits early, or the alias and port cannot be parsed.

Starting an already-running bridge returns the existing state and does not spawn a duplicate. Stopping terminates only the child process identified by AI Comic Studio ownership metadata. The HostBridge-managed SSH config block remains in place.

Page refreshes and workspace navigation do not affect the bridge. The UI refreshes status on mount and after every lifecycle command.

## Lifecycle And Persistence

The API backend owns the Mock SSH child process and records desired state in a local file under the application's data directory. The record contains only non-secret lifecycle data:

- desired running state;
- HostBridge host ID;
- requested SSH alias;
- last known local port;
- owner token and child PID metadata needed for narrow ownership checks.

When the API starts and desired state is running, it restores the bridge. A restore failure leaves desired state intact, reports a failed status, and can be retried from the UI. An explicit stop changes desired state to stopped before terminating the owned process, preventing automatic restart.

PID reuse must not be trusted by itself. Before stopping or reusing a process, the backend verifies the owner token and expected command identity. It never uses broad `pkill` matching.

## HostBridge Execution

The implementation follows the CS Bridge lifecycle semantics while using the installed, pinned HostBridge 2.0.0 CLI available to this local Web application.

The backend starts Mock SSH as a long-lived child process, captures bounded stdout and stderr into a local log, and waits for both the listening port and SSH alias before reporting success. Startup without both values is a failure.

The backend lists configured HostBridge hosts through the HostBridge CLI rather than reading or editing `hosts.json` directly. User-supplied host IDs and aliases are passed as individual process arguments and validated against conservative character rules. No shell command interpolation is used.

## API Surface

The backend adds these endpoints:

- `GET /api/mock-ssh/hosts`: list configured HostBridge hosts without secrets.
- `GET /api/mock-ssh/status`: return desired and observed lifecycle state, host ID, alias, port, and a redacted error.
- `POST /api/mock-ssh/start`: start or reuse a bridge for a validated host ID and alias.
- `POST /api/mock-ssh/stop`: stop only the bridge owned by AI Comic Studio.

Lifecycle mutations are serialized with an in-process lock so concurrent start and stop requests cannot create duplicate children or corrupt persisted state.

## Live Provider Health

`GET /api/providers/health` becomes an asynchronous live check rather than a configuration summary. Enabled channels are checked concurrently using the same provider contracts as the individual Model Channels test buttons. Disabled channels return `disabled` without a network request.

Each result contains:

- provider kind;
- status: `ok`, `failed`, or `disabled`;
- model and redacted host;
- elapsed milliseconds;
- check scope;
- sanitized error.

The endpoint never returns credentials or raw provider response bodies. A failure in one provider does not prevent other results from returning.

The toolbar shows `检测中` while the request is active, then `N/M 正常`. It disables duplicate checks while one is running. A failed aggregate request displays a short error state and allows retry. Detailed per-provider results are exposed through an accessible status popover or panel so the count is not the only feedback.

The denominator is the number of enabled provider channels, not a hard-coded value. This accommodates the existing optional video channel.

## TTS Routing

When the TTS channel has an SSH alias and the matching AI Comic Studio Mock SSH bridge is running, TTS checks and synthesis use SSH immediately. They do not first spend the direct-connect timeout on the LAN Base URL.

When no owned bridge is running, existing behavior remains compatible: the provider may attempt the Base URL and use the configured SSH alias as a fallback if it is independently available.

This routing change targets connection overhead. It does not alter the Qwen model, GPU assignment, synthesis parameters, or WAV validation.

## Error Handling And Security

- Provider and process errors are normalized and recursively redacted before being returned or persisted.
- API keys never appear in process arguments, logs, SSH config, lifecycle state, or health responses.
- SSH stdin remains the transport for request payloads containing credentials.
- Host IDs and aliases are validated before process creation.
- Log size is bounded and log output is treated as untrusted text.
- The Web UI cannot request arbitrary executable paths or arbitrary HostBridge arguments.
- Stop and restart operations affect only the process proven to be owned by AI Comic Studio.

## Testing

Backend tests cover:

- Host listing and validation;
- start, duplicate-start reuse, stop, and status transitions;
- startup output parsing and early-exit failures;
- desired-state persistence and API restart restoration;
- ownership checks and PID reuse rejection;
- concurrent lifecycle requests;
- live provider checks running concurrently;
- disabled-channel behavior and partial failures;
- secret and URL redaction;
- direct SSH routing when the owned bridge is active.

Frontend tests cover:

- loading, running, stopped, and failed Mock SSH states;
- start and stop commands and duplicate-click prevention;
- live health loading, success, partial failure, and retry states;
- dynamic enabled-service denominator;
- accessible detailed status output.

Verification includes a live A800_94 bridge start, a real Qwen TTS request through the persistent alias, a second request demonstrating reduced connection overhead, bridge stop, and confirmation that unrelated HostBridge processes remain running.

## Success Criteria

- The toolbar count is based on real provider checks, not configuration state.
- A real check clearly identifies each failed provider without exposing secrets.
- Mock SSH remains running across browser refreshes and API restarts until explicitly stopped.
- Starting twice does not create duplicate listeners.
- Stopping cannot terminate a bridge not owned by AI Comic Studio.
- With the bridge already running, short Qwen TTS checks avoid the approximately 9.6-second HostBridge login setup and the direct LAN timeout.
