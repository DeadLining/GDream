# AI Comic Studio

Local production workspace for serialized Chinese dynamic comics.

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

## Run

```bash
./scripts/dev.sh
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). FastAPI documentation is available at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

## Verification

```bash
cd services/api && uv run pytest -q
cd ../.. && npm test --workspaces --if-present
npm run build --workspaces --if-present
npm run render:fixture --workspace @comic-studio/compositor
```

The generated fixture is written to `packages/compositor/out/fixture.mp4` and must contain H.264 video and AAC audio streams.
