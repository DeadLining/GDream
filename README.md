# AI Comic Studio v0.4.0

Local production workspace for serialized Chinese dynamic comics.

The v0.4 workspace adds reviewed script imports, versioned character references, reference-aware panel generation, and MiniMax image-to-video production. Existing v0.3 projects and production runs are upgraded in place through Alembic migrations.

## Interface Workflow

The studio opens on an overview-first episode cockpit. The overview summarizes shot, panel, speech, and approval progress, keeps readiness blockers visible, and links directly to the affected shot or work area.

Desktop work includes these primary areas:

- `总览` tracks episode progress and render readiness.
- `剧本导入` accepts pasted text, TXT, DOCX, and text PDFs, then previews the graph before transactional confirmation.
- `角色` manages approved active reference images used by panel generation.
- `分镜` presents stable shot cards for selecting and comparing the episode sequence.
- `生产` runs and monitors persisted panel, speech, and video batches, including readable per-item failures and selective retries.
- `审核` collects only shots that still need a panel or approval and routes them back to the shared shot context.

The shot inspector remains visible beside the desktop work area. Selection is shared across overview, storyboard, production, and review, so switching areas does not lose the active shot. Use the inspector to edit shot details, generate or activate panel versions, update review state, and manage dialogue and speech.

Use the global toolbar `模型中心` command to manage all text, image, speech, and video capabilities. This platform page is independent of the active project and combines live capability health, infrastructure state, recent invocation history, retryable failures, provider configuration, and Mock SSH controls.

On mobile, the same workflow is exposed as four equal navigation areas: `总览`, `分镜`, `生产`, and `检查器`. Selecting a shot opens its inspector while preserving selection when moving between tabs.

## Model Stack

- Planning: MiniMax Anthropic API, model `MiniMax-M3`
- Images: internal GPT Image API, model `gpt-image-2`
- Speech: Qwen3-TTS service on A800_94, model `Qwen3-TTS-12Hz-1.7B-CustomVoice`
- Video: MiniMax image-to-video, default model `MiniMax-Hailuo-02`
- Composition: Remotion and FFmpeg

No API key is stored in source code, SQLite, browser storage, or generated metadata.

## Provider Channel Configuration

Open `模型中心` from the top toolbar to manage planning, image, speech, and video providers at runtime. The backend owns this configuration; the browser receives only redacted key status and never stores provider keys.

All model configuration, health checks, and invocations pass through the internal Model Runtime. Existing provider and production endpoints remain compatible, but delegate to the same typed text, image, speech, and video capability boundary. Text streams synchronously; image, speech, and video work is persisted as background jobs with sanitized invocation history and retry metadata.

On the first startup without `data/provider-channels.json`, provider values are bootstrapped from `.env`. Once the JSON file exists, it is authoritative across API restarts even if `.env` changes. The file is written atomically with owner-only `0600` permissions and is ignored by Git. Do not copy it into logs, screenshots, bug reports, or source control.

Saving a channel uses these API key semantics:

- Leave the replacement field empty to preserve the current key.
- Enter a new value to replace the current key; after saving, the UI clears the field and reloads only a redacted mask.
- Use `清除 API Key` to remove the key. An enabled planning or image channel cannot be saved without a key.

`测试连接` checks the current draft without saving it. Planning and speech tests use bounded, low-cost provider checks; image testing does not request generated media. A failed test leaves the active configuration unchanged. A successful save affects only new planning, image, and speech operations; already-running jobs keep the provider snapshot they started with.

To recover the environment defaults, stop the API, securely remove `data/provider-channels.json`, and restart. The next startup bootstraps from `.env` again. Deleting the file while the API is running does not reset the active in-memory snapshot.

## Setup

```bash
cp .env.example .env
cd services/api && uv sync
cd ../.. && npm install
```

Set `MINIMAX_API_KEY`, `GPT_IMAGE_KEY`, and `MINIMAX_VIDEO_API_KEY` in `.env`. Confirm the trusted LAN can reach `QWEN_TTS_BASE_URL`.

### Managed Mock SSH bridge

Mock SSH requires HostBridge CLI `2.0.0` to be installed and configured with the target host before the Studio starts. Install and pin that prerequisite yourself: the application does not verify the installed version and never installs or upgrades HostBridge silently. It uses `hostbridge` from `PATH` by default; set `AI_COMIC_HOSTBRIDGE_EXECUTABLE` to an explicit executable path when the API service has a different `PATH`. To share the daemon and host configuration from CS Bridge, set it to the absolute `<repo>/scripts/hostbridge-cs-bridge` path instead. That compatibility launcher uses `/Applications/CS Bridge.app/Contents/Resources/vendor/hostbridge` by default; set `CS_BRIDGE_HOSTBRIDGE_ROOT` only if the vendored runtime is elsewhere.

`AI_COMIC_HOSTBRIDGE_DAEMON_SOCKET` must identify the HostBridge daemon that owns the configured hosts. On macOS the standard HostBridge runtime uses `/private/tmp/hostbridge-<user>/daemon.sock`; replace `USER` in `.env` with the current account name. The API expands `~`, resolves the path to an absolute location, and passes that value to the managed HostBridge child as `HOSTBRIDGE_DAEMON_SOCKET`.

Open `模型中心` and use `Mock SSH 桥接` when the Mac cannot route directly to the TTS service. The manager stores desired lifecycle state in `mock-ssh.json` and bounded sanitized output in `mock-ssh.log` under `AI_COMIC_DATA_ROOT`. A successful start persists `desired_running=true`; on API startup the manager reuses the exact owned process or restores the requested bridge. An explicit `停止 Mock SSH` persists `desired_running=false`, prevents automatic restart, and stops only a process whose command identity and private owner token both match. Existing SSH configuration is preserved; the application does not rewrite unrelated aliases or terminate unowned HostBridge processes.

The toolbar `检测模型服务` command performs live provider checks. This is separate from whether a channel configuration was saved successfully: an enabled and valid configuration can still fail a live check. Checks use minimal bounded provider work; the TTS connection test calls the service `/health` endpoint and does not trigger audio generation. When the manager owns the active TTS SSH alias, TTS uses that bridge immediately and skips the failed LAN-direct attempt and repeated connection path.

After an API restart, check the Mock SSH status in `模型中心`: desired-running bridges are recovered, while explicitly stopped bridges remain stopped. If recovery fails, verify `hostbridge --version` reports `2.0.0`, the configured executable is runnable by the API user, the target appears in `hostbridge hosts list`, the SSH alias matches the speech channel, and `hostbridge daemon status` is checking the same socket configured for the Studio. A wrong daemon socket can still allow the listener to start and simple commands to appear normal while daemon-backed requests or stdin forwarding time out. Check the socket path and daemon ownership carefully, then inspect `mock-ssh.log` under the data root; do not expose provider keys, private host credentials, or other secrets in configuration, command output, logs, or bug reports.

## Run

```bash
./scripts/dev.sh
```

The script prints the selected workspace and API URLs. It starts from ports `3000` and `8000` and automatically selects the next free ports when either is already in use.

The API runs without code reload by default so background model jobs are not interrupted. Set `AI_COMIC_API_RELOAD=1 ./scripts/dev.sh` only during API development.

## Verification

```bash
cd services/api && uv run pytest -q
cd ../.. && npm test --workspaces --if-present
npm run build --workspaces --if-present
npm run test:e2e --workspace @comic-studio/web
npm run render:fixture --workspace @comic-studio/compositor
```

The generated fixture is written to `packages/compositor/out/fixture.mp4` and must contain H.264 video and AAC audio streams.

## Production Flow

1. Create a project and enter its story bible and visual style.
2. Import a script or story, review the structured characters and episodes, then confirm it into the project graph.
3. Upload or generate a primary character reference, approve it, and activate it before generating panels containing that character.
4. Select a shot to edit duration, composition, camera motion, prompts, and review state.
5. Open the production view and select panel generation, speech synthesis, video generation, or a custom combination.
6. Choose bounded concurrency from 1 to 4. By default, approved panels and completed speech are recorded as skipped; enable regeneration only when replacing existing assets intentionally.
7. Start the persisted run. Each item completes independently, so one provider failure does not stop later eligible work.
8. Pause to stop new claims while already-running items finish. Continue is idempotent, and an interrupted running process is recovered as paused on API startup.
9. Filter the queue, select failed items, and retry only those targets. The run keeps succeeded and skipped history intact.
10. Clear all readiness blockers: every shot needs an active panel and approval, and every dialogue line needs positive-duration speech audio.
11. Render the episode and download the verified MP4 from the toolbar.

The current production run ID is stored per episode in local browser storage and reloaded after refresh. Run and item state remains authoritative in SQLite. Provider and render operations are persisted jobs, and errors are redacted before storage.

## Batch Semantics

- Eligibility is snapshotted deterministically in scene, shot, and dialogue order when a run is created.
- Only one active production run is allowed per episode.
- `pause` prevents new items from starting; it does not cancel provider calls already in progress.
- API restart recovery moves interrupted runs to `paused` and their interrupted items back to `queued`.
- Terminal runs may be `completed` or `completed_with_failures`; selected failed items can be returned to the queue without regenerating successful work.
- The render command remains disabled until `/api/episodes/{episode_id}/production-readiness` reports no missing panels, unapproved shots, or missing speech.

## A800_94 Operations Warning

The TTS service is active on port `18080`. The server currently has insufficient `/boot` space to generate the pending `5.15.0-185` initrd, so `dpkg` may report a pending failure. Do not delete the running `5.15.0-181` initrd or perform kernel cleanup without an explicit maintenance window.
