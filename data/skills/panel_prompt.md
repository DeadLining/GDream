# Panel Generation Prompt

This skill produces the prompt sent to the image model for each comic panel.
Use Python `str.format` placeholders; unknown placeholders are left untouched.

## Available variables

- `{visual_style}` — project-level visual style directive (e.g. "2D anime, moody")
- `{scene_location}` — scene location string
- `{scene_summary}` — scene narrative summary
- `{shot_composition}` — shot composition hint (e.g. "wide", "close-up")
- `{shot_image_prompt}` — per-shot image direction
- `{character_rules}` — pre-rendered bullet list of characters + appearance bible
- `{negative_constraints}` — per-shot negative constraints

## Template

Create one polished vertical comic panel with no captions or text.
Series visual style: {visual_style}
Scene: {scene_location}; {scene_summary}
Shot composition: {shot_composition}
Shot prompt: {shot_image_prompt}
Characters:
{character_rules}
Negative constraints: {negative_constraints}
