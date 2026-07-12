# Episode Deletion Design

## Goal

Allow users to permanently delete an episode from the studio while keeping project navigation coherent and removing the episode's database records and generated local media.

## User Experience

- Each episode row in the project navigator exposes a trash icon with an accessible `删除剧集` label and tooltip.
- Clicking the icon does not select the episode. It opens a confirmation dialog for that episode.
- The dialog names the episode and reports the number of scenes, shots, dialogue lines, and local media assets that will be deleted.
- The primary destructive action is labeled `永久删除`. Canceling makes no changes.
- While deletion is running, both dialog actions are disabled and the destructive action shows progress.
- API failures keep the dialog open and show a concise error. A media cleanup warning does not restore the deleted episode; it is shown as a non-blocking warning.

## Navigation Rules

- Deleting the selected episode selects the next episode in the project's current ordering.
- If there is no next episode, the previous episode is selected.
- If no episodes remain, the studio enters its existing empty-project work area with no selected episode.
- Deleting an episode that is not selected leaves the current work area and selection unchanged.
- The project detail is reloaded after successful deletion so every consumer sees the authoritative episode list.

## API

Add `DELETE /api/episodes/{episode_id}`.

The successful response contains:

```json
{
  "deleted_episode_id": "episode-id",
  "deleted": {
    "scenes": 2,
    "shots": 12,
    "dialogue_lines": 18,
    "assets": 10
  },
  "cleanup_warnings": []
}
```

- A missing episode returns `404`.
- IDs are resolved through the ORM; no user value is interpolated into SQL.
- The endpoint is scoped to the local single-user application and follows the project's current lack of authentication.

## Deletion Service

Introduce a focused episode deletion service rather than putting filesystem work in the route.

1. Load the episode with scenes, shots, dialogue lines, and assets associated with those production targets.
2. Count the affected records and collect media paths before deleting database rows.
3. Delete the episode in one database transaction. Existing ORM/database cascades remove scenes, shots, dialogue lines, jobs, production runs, production items, and associated asset records where relationships require explicit handling.
4. Commit the database transaction.
5. Delete collected local files after commit.
6. Return paths that could not be removed as redacted cleanup warnings.

Database deletion is authoritative. A filesystem failure must not roll the database back after commit.

## Media Path Safety

- Only files whose resolved path is inside the configured `data_root` may be removed.
- Absolute paths, parent traversal, symlink escapes, and paths outside `data_root` are rejected and returned as cleanup warnings.
- Missing files are treated as already cleaned.
- Empty directories may be removed only when they remain inside `data_root` and are empty.
- API responses never expose absolute local filesystem paths.

## Frontend Integration

- Add `deleteEpisode(id)` to the API client.
- `ProjectNavigator` receives an `onDeleteEpisode` callback and renders the icon command without nesting interactive controls.
- `Workspace` owns confirmation-dialog state because it controls project and episode selection.
- The dialog first uses already loaded episode detail for visible counts. If exact asset counts require an API preview, the delete response remains authoritative; deletion does not require a separate mutable preview token in this version.
- After success, `Workspace` reloads the project and applies the navigation rules above.

## Error Handling

- A failed API request leaves all local frontend state unchanged.
- A stale deletion response is ignored if the user has navigated to another project while the request was active.
- Repeated clicks cannot start concurrent deletions for the same dialog.
- Cleanup warnings are distinguishable from deletion failures.

## Tests

### API

- Deletes an episode and its scenes, shots, and dialogue lines.
- Deletes associated asset records and local media files.
- Returns accurate deletion counts.
- Returns `404` for an unknown episode.
- Refuses to remove files outside `data_root` and returns a redacted warning.
- Treats missing media files as successful cleanup.
- Rolls back database changes when the database deletion fails before commit.

### Web unit tests

- Opens the confirmation dialog for the requested episode without selecting it.
- Cancel leaves the episode list unchanged.
- Deleting the selected episode chooses next, then previous, then empty state.
- Deleting an unselected episode preserves the current selection.
- API failure keeps the dialog open and displays the error.
- Cleanup warnings are displayed without restoring the episode.

### Browser test

- Delete an episode through the navigator, confirm the destructive dialog, and verify the removed episode disappears while the expected adjacent episode becomes active.

## Out of Scope

- Trash or restore support.
- Bulk episode deletion.
- Deleting an entire project.
- Remote object-store cleanup.
- Automatic cleanup of unrelated orphan files already present on disk.
