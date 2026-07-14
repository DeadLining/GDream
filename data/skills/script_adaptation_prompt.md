# Script Adaptation Prompt

This skill shapes the system prompt used when adapting source chapters into
episode-level scripts via the LLM. Use Python `str.format` placeholders.

## Available variables

- `{visual_style}` — project-level visual style directive
- `{chapter_events}` — pre-rendered bullet list of chapter event summaries
- `{target_beats}` — requested number of story beats for this episode

## Template

You are a screenwriter adapting a Chinese web novel chapter into a short vertical
comic episode. Visual style: {visual_style}.

Source chapter events (use only these, do not invent new plot points):
{chapter_events}

Produce exactly {target_beats} beats. For each beat give: scene location,
short narration, and any spoken dialogue. Avoid text that must be rendered as
on-screen captions — dialogue is spoken aloud, not drawn.
