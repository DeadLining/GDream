# Video Generation Prompt

This skill produces the prompt sent to the video model for each shot motion.
Use Python `str.format` placeholders.

## Available variables

- `{scene_location}` — scene location string
- `{scene_summary}` — scene narrative summary
- `{shot_composition}` — shot composition hint
- `{shot_video_prompt}` — per-shot motion / camera direction
- `{duration_seconds}` — intended clip duration in seconds

## Template

Animate a short vertical comic clip, no captions or text overlays.
Scene: {scene_location}; {scene_summary}
Shot composition: {shot_composition}
Motion direction: {shot_video_prompt}
Target duration: {duration_seconds}s
