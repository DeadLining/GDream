# AI Script Creation Workflow Design

## Goal

Replace the format-oriented script import modes with a smooth AI-first creation workflow. The workspace becomes "剧本创作" and exposes only two modes: "AI生成" and "自动识别".

## User Experience

### AI生成

AI生成 is the default mode. It does not require pasted text or an uploaded file. The user may optionally enter "本次创作要求" and start generation immediately.

The model receives the complete project context available at request time:

- project title, logline, story bible, visual style, and aspect ratio;
- characters, including appearance, personality, continuity, negative constraints, voice settings, and available reference summaries;
- existing episode titles, premises, status, and continuity-relevant scene summaries;
- the optional request-specific creation brief.

The result is a draft, not an immediate database mutation.

### 自动识别

自动识别 accepts pasted text or TXT, DOCX, and PDF uploads. The model determines whether the content is a screenplay, novel, outline, or story fragment. The user no longer selects screenplay or prose manually.

### Shared Preview

Both modes produce the same editable draft structure and use the same preview and confirmation workflow. The preview shows:

- characters;
- enabled episodes;
- scene and shot totals per episode;
- episode title, premise, target duration, and enabled state.

The user may edit the draft, save changes, and explicitly confirm it. Only confirmation writes characters, episodes, scenes, shots, and dialogue to the project.

## Data Flow

```text
AI生成 -> project context + optional brief -> MiniMax -> ScriptImportDraft
自动识别 -> extracted source text + project context -> MiniMax -> ScriptImportDraft
ScriptImportDraft -> preview/edit -> confirm -> project records
```

The existing script-import draft schema remains the shared contract. A new generation source mode is added while legacy `screenplay` and `prose` values remain readable for existing records but are no longer offered by the UI.

## Relationship To Storyboards

Confirmed drafts already contain scenes, shots, and dialogue. Therefore confirmation is considered the initial storyboard creation for those episodes.

The storyboard workspace must distinguish between an empty episode and an episode that already has shots:

- empty episode: show "生成剧本与分镜";
- populated episode: show "重新生成分镜" only as an explicit replacement action;
- replacement requires a confirmation warning that existing scenes, shots, dialogue, and their generated production associations may be replaced.

The standard navigation after confirmation opens the newly created or updated episode without automatically running another planning job.

## API Design

The script creation API supports two current modes:

- `generate`: create a draft from project context and an optional brief;
- `auto`: parse pasted or uploaded content with automatic source recognition.

Generation remains asynchronous through the existing parse job boundary. The backend builds trusted project context; the browser sends only the mode and optional brief or source content.

Legacy `screenplay` and `prose` modes remain accepted for persisted historical records and API compatibility but are deprecated.

## States And Errors

The UI exposes stable states for creating, parsing, previewing, saving, confirming, and failure. Commands are disabled while their request is active to prevent duplicate submissions.

Provider failures keep the last valid draft intact. Errors are redacted by the existing provider error boundary. A retry repeats the same mode and input without creating duplicate applied records.

## Testing

Coverage includes:

- AI生成 is the default and does not require source text or a file;
- 自动识别 supports paste and file inputs without format selectors;
- generation requests use current project context and the optional brief;
- both modes return the same editable draft contract;
- confirmation persists the complete hierarchy exactly once;
- populated episodes use replacement wording and require confirmation before replanning;
- legacy import modes remain readable;
- loading, failure, retry, and duplicate-click behavior remain deterministic.

## Acceptance Criteria

- The mode selector contains only "AI生成" and "自动识别".
- No screenplay or novel mode selector remains visible.
- A project with sufficient existing information can generate a draft with no pasted source.
- Automatic recognition requires only source content, not a declared format.
- Both paths share preview, editing, and confirmation.
- Confirmed generated shots are not silently overwritten by normal storyboard navigation.
- Existing imported records using legacy modes continue to load.
