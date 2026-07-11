# Provider Channel Configuration Design

## Goal

Add local, runtime-editable provider channel configuration for the three existing AI capabilities: episode planning, image generation, and speech synthesis.

The first version supports exactly one channel per capability. It does not add provider priority routing, multiple active channels, or automatic provider fallback between different vendors.

## Configuration Ownership

Provider configuration is persisted in:

```text
data/provider-channels.json
```

The file is local-only, excluded from Git, and created with user-only permissions (`0600`). The backend is the sole reader and writer. The browser never accesses the file directly.

When the file does not exist, the backend imports the current `.env` provider values into an initial configuration snapshot. After the JSON file exists, it becomes authoritative. Deleting it restores `.env` bootstrap behavior on the next startup.

## Channel Model

The file contains three fixed slots:

```json
{
  "version": 1,
  "llm": {
    "name": "MiniMax",
    "enabled": true,
    "base_url": "https://api.minimaxi.com/anthropic",
    "model": "MiniMax-M3",
    "api_key": "secret"
  },
  "image": {
    "name": "Internal GPT Image",
    "enabled": true,
    "base_url": "http://192.168.18.80:14000",
    "model": "gpt-image-2",
    "api_key": "secret"
  },
  "tts": {
    "name": "A800_94",
    "enabled": true,
    "base_url": "http://192.168.18.94:18080",
    "model": "Qwen3-TTS-12Hz-1.7B-CustomVoice",
    "api_key": "",
    "ssh_host": "ai-comic-tts"
  }
}
```

Shared fields are `name`, `enabled`, `base_url`, `model`, and `api_key`. `ssh_host` is valid only for TTS.

## Persistence

`ProviderChannelStore` owns validation, snapshots, and persistence.

Writes use this sequence:

1. Validate the full new configuration.
2. Serialize to a temporary file in the same directory.
3. Set temporary-file permissions to `0600`.
4. Flush and `fsync` the file.
5. Atomically replace `provider-channels.json`.
6. `fsync` the parent directory where supported.
7. Publish the new immutable in-memory snapshot.

If serialization or writing fails, the previous file and in-memory snapshot remain active.

On startup, invalid JSON or invalid fields do not silently fall back to empty configuration. The backend reports a configuration error and keeps the last valid in-memory snapshot when one exists.

## Secret Semantics

Read APIs never return full keys. They return:

- `api_key_configured`: boolean;
- `api_key_masked`: a short mask such as `sk-••••8adr`.

Update requests use explicit secret operations:

- omitted or blank `api_key`: preserve the current key;
- non-empty `api_key`: replace the key;
- `clear_api_key: true`: remove the key.

Replacement and clearing are mutually exclusive. Errors, logs, job records, and API responses continue to use recursive secret redaction.

## API

### Read All Channels

```text
GET /api/provider-channels
```

Returns the three redacted channel configurations plus configuration-file status and last reload time.

### Update One Channel

```text
PUT /api/provider-channels/{kind}
```

`kind` is `llm`, `image`, or `tts`. The request contains the full non-secret channel fields and the secret operation fields. Saving one channel validates and atomically writes the complete three-channel document.

### Test Unsaved Configuration

```text
POST /api/provider-channels/{kind}/test
```

The request accepts the same form values as update. It resolves a blank key against the existing stored key but never persists changes.

The response contains:

- `status`: `ok` or `failed`;
- model;
- sanitized endpoint host;
- elapsed milliseconds;
- sanitized error when failed.

## Connection Tests

Connection tests minimize external cost:

- LLM: send a minimal deterministic text request with a tiny token budget.
- Image: validate the configured model endpoint or capabilities without generating an image when the provider supports it. If no non-generation endpoint exists, report that only configuration reachability was checked rather than incurring image cost.
- TTS: synthesize a very short fixed phrase, validate WAV bytes, and discard the response without registering an asset.

Test requests use strict timeouts and never create jobs, assets, or production items.

## Runtime Provider Factory

Routes and production workers no longer instantiate providers directly from process-startup `Settings`. A `ProviderFactory` reads the current `ProviderChannelStore` snapshot and creates:

- `MiniMaxProvider` for planning;
- `GPTImageProvider` for panels;
- `QwenTTSProvider` for speech.

Each operation captures one snapshot and one provider instance at start. Saving configuration affects subsequent operations only; running operations do not switch endpoints or credentials midway.

Disabled or incomplete channels fail before job execution with a stable, sanitized configuration error.

The existing provider health API reads the same current snapshot so its model, host, and status match actual runtime routing.

## Settings UI

The modern Studio adds a `模型渠道` settings workspace accessible from a real toolbar or navigation command.

The page contains three fixed channel sections:

- `剧本规划` for LLM;
- `画面生成` for image;
- `语音合成` for TTS.

Each section contains:

- enabled toggle;
- channel name;
- Base URL;
- model;
- masked API Key field with replace and explicit clear behavior;
- `测试连接` command and inline result;
- TTS-only SSH Host.

The page has one `保存全部更改` command. Dirty state is visible, navigation away with unsaved changes requires confirmation, and successful save refreshes displayed masks and provider status.

Connection results appear inside the affected channel section. They show success or sanitized failure and do not block editing other channels.

## Frontend Data Flow

1. Settings workspace loads `GET /api/provider-channels`.
2. The browser stores editable non-secret fields and secret operation state locally in React state.
3. `测试连接` posts the current unsaved section values.
4. `保存全部更改` updates only changed channel sections in a deterministic order.
5. After save, the page reloads the redacted server snapshot.
6. Provider health in the toolbar refreshes to reflect the new runtime configuration.

The frontend never stores API keys in `localStorage`, logs, URLs, or query parameters.

## Validation And Errors

- Enabled channels require a valid HTTP or HTTPS Base URL and non-empty model.
- Enabled LLM and image channels require a configured API Key.
- TTS may omit API Key for trusted local service operation.
- TTS SSH Host is optional.
- Unknown JSON fields are rejected to prevent stale configuration drift.
- File permission errors, malformed JSON, and connection failures are shown with actionable local messages.
- A failed save leaves the form dirty and preserves the previous active snapshot.
- A failed connection test never changes the active configuration.

## Testing

### Backend

- bootstrap from `.env` when the JSON file is absent;
- JSON becomes authoritative after creation;
- strict schema validation;
- atomic write and `0600` permissions;
- write failure preserves the previous snapshot and file;
- read responses mask keys;
- blank key preserves, replacement changes, explicit clear removes;
- connection tests do not persist or create assets/jobs;
- ProviderFactory hot reload affects new operations only;
- running operations retain their captured provider;
- health output matches the current snapshot;
- recursive error redaction.

### Frontend

- loading and unavailable states;
- editing all shared fields and TTS SSH Host;
- key preserve, replace, and clear controls;
- enabled validation;
- connection success and sanitized failure;
- dirty state and navigation confirmation;
- save and redacted reload;
- toolbar health refresh.

### End-To-End

- open model-channel settings;
- edit a channel without exposing its key in the DOM after reload;
- test connection;
- save;
- refresh the page and confirm persistence;
- start a mocked subsequent provider operation using the updated channel snapshot.

## Migration And Compatibility

Existing `.env` deployments continue working without user action. The first read creates an in-memory imported snapshot; the first UI save persists JSON. No database migration is required.

The existing environment variables remain supported as bootstrap defaults and operational recovery. They are not modified by the UI.

## Non-Goals

- Multiple channels per capability.
- Priority routing or cross-vendor fallback.
- Cloud secret storage or account synchronization.
- Editing the main project `.env` file.
- Video-generation channel configuration.
- Automatic provider discovery or model catalog synchronization.
