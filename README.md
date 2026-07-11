# AI Comic Studio v0.2.0

Local production workspace for serialized Chinese dynamic comics.

The v0.2 workspace uses persisted projects and episodes. Creators can plan an episode, edit shots and dialogue, generate panel versions and speech, review assets, render the episode, and download the verified MP4 from the local web interface.

## Model Stack

- Planning: MiniMax Anthropic API, model `MiniMax-M3`
- Images: internal GPT Image API, model `gpt-image-2`
- Speech: Qwen3-TTS service on A800_94, model `Qwen3-TTS-12Hz-1.7B-CustomVoice`
- Composition: Remotion and FFmpeg

No API key is stored in source code, SQLite, browser storage, or generated metadata.

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
npm run render:fixture --workspace @comic-studio/compositor
```

The generated fixture is written to `packages/compositor/out/fixture.mp4` and must contain H.264 video and AAC audio streams.

## Production Flow

1. Create a project and enter its story bible and visual style.
2. Create an episode brief and generate scenes, shots, and dialogue with MiniMax-M3.
3. Select a shot to edit duration, composition, camera motion, prompts, and review state.
4. Generate immutable panel versions with `gpt-image-2` and activate the preferred version.
5. Edit dialogue performance instructions and synthesize playable Qwen3-TTS audio.
6. Approve required shots, render the episode, and download the MP4 from the toolbar.

Provider and render operations are persisted jobs. Failed jobs remain visible and can be retried without losing project edits.

## A800_94 Operations Warning

The TTS service is active on port `18080`. The server currently has insufficient `/boot` space to generate the pending `5.15.0-185` initrd, so `dpkg` may report a pending failure. Do not delete the running `5.15.0-181` initrd or perform kernel cleanup without an explicit maintenance window.
