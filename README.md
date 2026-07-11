# AI Comic Studio v0.3.0

Local production workspace for serialized Chinese dynamic comics.

The v0.3 workspace adds persisted episode production runs to the existing project, episode, review, and render workflow. Creators can batch eligible panel and speech work, pause scheduling, recover after restart, retry selected failures, and render only when the readiness report is clear.

## Interface Workflow

The studio opens on an overview-first episode cockpit. The overview summarizes shot, panel, speech, and approval progress, keeps readiness blockers visible, and links directly to the affected shot or work area.

Desktop work is organized into four areas:

- `总览` tracks episode progress and render readiness.
- `分镜` presents stable shot cards for selecting and comparing the episode sequence.
- `生产` runs and monitors persisted panel and speech batches, including readable per-item failures and selective retries.
- `审核` collects only shots that still need a panel or approval and routes them back to the shared shot context.

The shot inspector remains visible beside the desktop work area. Selection is shared across overview, storyboard, production, and review, so switching areas does not lose the active shot. Use the inspector to edit shot details, generate or activate panel versions, update review state, and manage dialogue and speech.

On mobile, the same workflow is exposed as four equal navigation areas: `总览`, `分镜`, `生产`, and `检查器`. Selecting a shot opens its inspector while preserving selection when moving between tabs.

## Model Stack

- Planning: MiniMax Anthropic API, model `MiniMax-M3`
- Images: internal GPT Image API, model `gpt-image-2`
- Speech: Qwen3-TTS service on A800_94, model `Qwen3-TTS-12Hz-1.7B-CustomVoice`
- Composition: Remotion and FFmpeg

No API key is stored in source code, SQLite, browser storage, or generated metadata.

## Provider Channel Configuration

Open `模型渠道` in the Studio to manage planning, image, and speech providers at runtime. The backend owns this configuration; the browser receives only redacted key status and never stores provider keys.

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

Set `MINIMAX_API_KEY` and `GPT_IMAGE_KEY` in `.env`. Confirm the trusted LAN can reach `QWEN_TTS_BASE_URL`.

When the Mac cannot route directly to A800_94, start the HostBridge SSH endpoint before the API:

```bash
hostbridge mock-ssh a800_94 --port 2244 --ssh-host-alias ai-comic-tts \
  --connect-timeout 120 --command-timeout 300
```

## Run

```bash
./scripts/dev.sh
```

The script prints the selected workspace and API URLs. It starts from ports `3000` and `8000` and automatically selects the next free ports when either is already in use.

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
2. Add each speaking character with a valid Qwen voice speaker before planning, so MiniMax can preserve real character IDs in dialogue.
3. Create an episode brief and generate scenes, shots, and dialogue with MiniMax-M3.
4. Select a shot to edit duration, composition, camera motion, prompts, and review state.
5. Open the production view and select panel generation, speech synthesis, or both.
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
