# Grid Panel Generation Prompt

This skill produces the prompt for a 2x2 grid image that contains multiple
shots from the same scene. Use Python `str.format` placeholders; unknown
placeholders are left untouched.

## Available variables

- `{visual_style}` — project-level visual style directive
- `{scene_location}` — scene location string
- `{scene_summary}` — scene narrative summary
- `{panel_descriptions}` — pre-rendered numbered list of shot descriptions
- `{character_rules}` — pre-rendered bullet list of characters + appearance bible
- `{negative_constraints}` — combined negative constraints for all shots

## Template

Create a 2x2 vertical comic grid with no captions, no text, and no speech bubbles.
All four panels must share the same consistent visual style, lighting, and
character designs so they read as sequential shots from the same scene.

Series visual style: {visual_style}
Scene: {scene_location}; {scene_summary}

Characters (keep consistent across all panels):
{character_rules}

Panels (read left-to-right, top-to-bottom):
{panel_descriptions}

Negative constraints: {negative_constraints}
