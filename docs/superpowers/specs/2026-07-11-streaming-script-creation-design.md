# Streaming Script Creation Design

## Goal

Turn AI script creation into a visible two-stage workflow: stream a readable script into the editor, then let the user edit it and manually request structured parsing and storyboard preview.

## User Flow

### Initial State

The AI mode shows the label `本次创作要求（可选）`, an optional brief textarea, and the command `开始 AI 创作`.

### Streaming State

Starting creation sends the current project context and optional brief to a backend streaming endpoint. The textarea is cleared and becomes the live output surface. Generated text is appended as chunks arrive.

The UI shows `正在创作` and exposes `停止生成`. Stopping aborts the browser stream but keeps all received text.

### Draft State

After the first content chunk, the textarea label becomes `AI 剧本草稿`. When streaming finishes, the primary command becomes `解析并预览`. The user may edit the text before parsing.

`重新生成` asks for confirmation before replacing a non-empty draft. A stopped or disconnected stream may be resumed with `继续生成`; the backend receives the existing draft and is instructed to continue without repeating it.

### Parsing State

`解析并预览` creates a script-import source from the current editor text and invokes the existing strict `ScriptImportDraft` parser. It does not automatically run when streaming ends. The existing preview, editing, save, and confirmation workflow remains unchanged.

## Persistence

The browser stores the current AI script draft and original brief per project in local storage. Draft state is restored when the page reloads or the user returns to the project. A successful confirmed import clears the saved draft. Switching to automatic recognition does not delete the AI draft.

## API

Add `POST /api/projects/{project_id}/script-generation/stream`.

The JSON request contains:

- `brief`: optional creation direction;
- `existing_draft`: text already received when continuing.

The backend loads trusted project context, creates the MiniMax streaming request, and returns Server-Sent Events:

- `event: chunk` with JSON `{ "text": "..." }`;
- `event: done` with JSON `{ "finish_reason": "stop" }`;
- `event: error` with a redacted user-safe message.

The browser never receives or submits provider credentials.

## Model Prompt

The streaming prompt asks for a readable Chinese dynamic-comic script rather than JSON. It incorporates project title, logline, story bible, visual style, aspect ratio, character canon, reference summaries, existing episode continuity, the optional brief, and any existing partial draft.

The output should use readable episode, scene, action, speaker, and dialogue headings so the existing automatic-recognition parser can structure it reliably.

## Error Handling

- Local API interruption keeps received content and shows a retryable status.
- Upstream failure is converted to a redacted SSE error event.
- User cancellation is not presented as an error.
- A stale stream must not append text after the project or mode changes.
- Only one stream may be active in the workspace at a time.

## Testing

- API tests verify project context, MiniMax streaming headers and chunks, redaction, cancellation cleanup, and missing-project handling.
- Component tests verify chunk appending, stop, resume, manual parsing, overwrite confirmation, project-scoped local storage, and stale-stream protection.
- Browser tests verify visible incremental output at desktop and mobile sizes without layout shift or text overflow.

## Acceptance Criteria

- Clicking `开始 AI 创作` visibly streams readable text into the textarea.
- Streaming completion never automatically triggers structured parsing.
- The user can edit the draft and manually click `解析并预览`.
- Stopping or losing the connection preserves received text.
- Reloading restores the draft for the same project.
- Confirming an imported draft clears the saved streaming draft.
