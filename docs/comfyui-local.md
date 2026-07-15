# Local ComfyUI

AI Comic Studio embeds the official ComfyUI frontend as a separate local service.

Current implementation status: [comfyui-integration-status.md](./comfyui-integration-status.md)

- Upstream: `https://github.com/Comfy-Org/ComfyUI`
- Pinned runtime: `v0.27.0`
- License: GPL-3.0
- Public URL: `http://comfyui.localhost:3000/`
- Internal listener: loopback-only, automatically selected from port `7898`
- Runtime directory: `.runtime/ComfyUI` (not committed)

## Integrated start and stop

```bash
./scripts/dev.sh
```

The development launcher owns the Web, API, and ComfyUI processes. Stopping the
launcher stops all three. ComfyUI binds to loopback only and is exposed through
the main Web port using the `comfyui.localhost` host name.

The Web app uses `NEXT_PUBLIC_COMFYUI_URL` when set and otherwise loads
`http://comfyui.localhost:3000/`.

For standalone diagnostics, `./scripts/comfyui.sh` can still start and stop the
internal ComfyUI process directly. Its default internal port is `7898`.

## Models

The ComfyUI source and Python dependencies do not include generation models.
Place checkpoints, VAE, ControlNet, LoRA, and related files in the matching
directories below `.runtime/ComfyUI/models/`, or configure ComfyUI model paths.

## Internal port conflicts

The integrated launcher automatically selects an unused internal port starting
from `7898`. It does not modify Clash Verge or other existing listeners.
