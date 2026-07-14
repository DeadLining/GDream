# Speech Synthesis Prompt

This skill shapes the instruction passed alongside the dialogue text to the TTS provider.
Use Python `str.format` placeholders.

## Available variables

- `{text}` — the dialogue line text (already redacted)
- `{character_name}` — speaking character name
- `{emotion}` — emotional cue (free text, may be empty)
- `{locale}` — target locale code (e.g. "zh-CN")

## Template

Speak the following line in character as {character_name}.
Emotion: {emotion}
Locale: {locale}

Line:
{text}
