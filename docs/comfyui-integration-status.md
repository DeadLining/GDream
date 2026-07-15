# ComfyUI and Production Canvas Status

Last verified: 2026-07-14

This document records the current implementation state. A visible control or
node must not be treated as complete unless it is listed as usable below.

## Verified runtime

- Official upstream: `Comfy-Org/ComfyUI`
- Pinned version: `v0.27.0`
- Frontend version: `1.45.20`
- Python: `3.12.5`
- PyTorch: `2.13.0`
- Device: Apple MPS
- Web embedding: real ComfyUI iframe, not a simulated node graph
- Public entry: `http://comfyui.localhost:3000/`
- Lifecycle: started and stopped by `scripts/dev.sh` with Web and API
- Proxy: HTTP and WebSocket verified through the main Web port
- API verification: `/system_stats`, `/object_info`, `/prompt`, and `/history`
- Execution smoke test: `EmptyImage -> SaveImage` completed successfully

## Production canvas capability matrix

| Area | Status | Current behavior |
|---|---|---|
| Pan, zoom, minimap | Usable | React Flow navigation works. |
| Node movement | Usable | Node positions are saved to the episode canvas layout. |
| Auto layout and undo | Usable | Layout can be recalculated and reverted once. |
| Fit episode and focus shot | Usable | Viewport fits the episode or selected shot chain. |
| Scene collapse and expand | Usable | Scene children can be hidden and restored. |
| Node selection and inspector | Usable | Selecting a node opens its current metadata. |
| Pin selected shot | Usable | Pinned state is saved in the canvas layout. |
| Dark and cream themes | Usable | Theme is persisted in browser local storage. |
| Production settings and batch run | Usable | Connected to the production-run backend. |
| Pause, resume, queue, retry | Usable | Connected to real production-run APIs. |
| Official ComfyUI editor | Usable with dependencies | Real canvas, node editing, queue, API, and history are available. |
| Public asset dock | Display only | Shows graph assets and scenes; items cannot be dragged or bound. |
| Automatic asset binding | Not implemented | The current label is aspirational and must not imply completion. |
| Reconnect production dependency nodes | Not implemented | Production React Flow uses `nodesConnectable={false}`. |
| Edit production-node parameters | Partial | Inspector displays metadata but does not edit most node inputs. |
| Image annotation and mask drawing | Not implemented | The visible annotation is static. |
| Conversational repair execution | Not implemented | The form currently prevents submission and calls no backend. |
| Generate repair branch | Not implemented | No mask, prompt rewrite, inpainting, or comparison branch is created. |
| Load a shot workflow into ComfyUI | Not implemented | The selected shot is not synchronized into the iframe. |
| Save a ComfyUI workflow to a shot | Not implemented | Workflow JSON is not imported, versioned, or bound back to the shot. |
| Stream ComfyUI progress into production graph | Not implemented | Queue and history are not reflected in production nodes. |
| Import ComfyUI output as a panel asset | Not implemented | Output files are not registered in the project asset store. |
| Local checkpoint generation | Blocked by model setup | No checkpoint, VAE, ControlNet, or LoRA model is installed. |
| Custom ComfyUI nodes | Not installed | Only the official runtime and bundled nodes are available. |

## Current blocker

### Models and disk

No reusable local model files were found. The machine has 16 GB unified memory
and approximately 23 GB free disk space at the time of verification. Model
selection must account for both limits; a large Flux installation must not be
downloaded implicitly.

## Required work for an end-to-end ComfyUI chain

1. Select and install an Apple-Silicon-compatible image model.
2. Define versioned panel and repair workflow JSON files.
3. Map project assets, prompts, continuity inputs, and shot settings to workflow inputs.
4. Submit workflows through `/prompt` and track progress over `/ws` and `/history`.
5. Register generated files as project assets and activate the selected result.
6. Implement real annotation masks and conversational repair branch creation.
7. Reflect queue, failures, outputs, and retries in the production canvas.

## Related plans

- `docs/superpowers/plans/2026-07-13-comfyui-execution-adapter.md`
- `docs/superpowers/plans/2026-07-13-conversational-image-repair-subcanvas.md`
- `docs/superpowers/plans/2026-07-13-production-agent-command-protocol.md`
