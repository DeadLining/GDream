# Frontend / Backend Contract Gaps

## Scope

The unified frontend is organized around:

`Project -> Volume -> Episode -> Scene -> Shot`

Storylines cross episode boundaries without changing the stable volume and episode order. Asset lineage and review records must remain traceable to the exact project, episode, scene, shot, asset, and generated version that consumed them.

## 1. Volumes And Episode Ordering

Current state:

- Projects own episodes directly.
- Episode ordering is derived from creation time.
- The product overview and storyline canvas currently render placeholder volume groupings.

Required persistence:

- `volumes`: project, stable integer position, title, summary.
- `episodes.volume_id`: optional during migration, required for newly organized work.
- `episodes.position`: stable position inside the volume.

Required API:

- `POST /api/projects/{project_id}/volumes`
- `GET /api/projects/{project_id}/volumes`
- `PATCH /api/volumes/{volume_id}`
- `POST /api/volumes/{volume_id}/episodes`
- `PATCH /api/episodes/{episode_id}` supports `volume_id` and `position`.

Rules:

- Volume positions are unique inside a project.
- Episode positions are unique inside a volume.
- Cross-project moves are rejected.
- Existing episodes remain readable after migration.

## 2. Storylines

Current state:

- `StorylineCanvas` contains hard-coded events and relationships.
- Storyline tags do not persist and cannot be linked to real scenes or shots.

Required persistence:

- `storylines`: project, title, kind, color, description.
- `storyline_events`: storyline, episode, optional scene/shot, stable position, stage, title, description, setup/payoff links, metadata.

Required API:

- `POST /api/projects/{project_id}/storylines`
- `GET /api/projects/{project_id}/storylines`
- `PATCH /api/storylines/{storyline_id}`
- `POST /api/storylines/{storyline_id}/events`
- `PATCH /api/storyline-events/{event_id}`
- `DELETE /api/storyline-events/{event_id}`

Rules:

- All linked resources must belong to the storyline project.
- A linked shot must belong to the linked scene and episode.
- Setup and payoff links cannot cross projects.
- Deleting an episode preserves the storyline but removes its episode-bound events.

## 3. Asset Variants And Inheritance

Current state:

- Character references persist, but the asset lineage canvas uses placeholder variants and usage nodes.
- `assets.parent_asset_id` records generation ancestry, not semantic character inheritance.

Required persistence:

- `asset_variants`: character, optional episode, parent variant, kind, label, inherited fields, overrides, version, review status.
- `asset_variant_states`: variant, state kind, label, overrides, version.
- `asset_variant_usages`: variant/state, shot, optional generated asset, usage kind.

Required API:

- CRUD and lineage endpoints under `/api/characters/{character_id}/variants`.
- Impact endpoint returning affected shots, videos, and release candidates.

Rules:

- Parent variants must belong to the same character.
- Inheritance cycles are rejected.
- Episode variants must belong to the character project.
- Overrides are structured JSON with an explicit whitelist of supported keys.

## 4. Visual Annotations And Conversations

Current state:

- Annotation pins, conversations, modification scope, locks, and candidate V5 are frontend placeholders.

Required persistence:

- `visual_review_threads`: shot, source asset/version, title, status, modification scope, author kind.
- `visual_annotations`: thread, shape kind, normalized geometry, color, label.
- `visual_review_messages`: thread, author kind, content, created time.
- `visual_review_candidates`: thread, generated asset, status, generation metadata.

Required API:

- Thread, annotation, message, candidate generation, accept, and reject endpoints.

Rules:

- Geometry is normalized to `[0, 1]` and validated by shape kind.
- Candidate assets must belong to the same project and shot generation chain.
- `master` scope requires an explicit downstream impact response before generation.
- User text is stored as plain text and never rendered as raw HTML.

## 5. Review Threads And Publishing

Current state:

- The final review timeline and publish gate derive blockers from production readiness.
- Review comments and publishing actions are not persisted.

Required persistence:

- `review_threads`: episode/shot, timecode, severity, status, title.
- `review_messages`: thread, author kind, content.
- `release_candidates`: episode, version, render asset/path, QC snapshot, status.
- `publication_records`: candidate, platform, external reference, status, published time.

Required API:

- Review thread CRUD and resolve/reopen endpoints.
- Release candidate create/check/approve/publish endpoints.

Rules:

- Publishing is rejected while production readiness or critical review threads are unresolved.
- The server computes the gate; the client cannot override it.
- Publishing requests are idempotent per candidate and platform.
- External provider errors are sanitized before persistence and response.

## Delivery Order

1. Volumes and storylines.
2. Asset inheritance.
3. Visual annotations and conversations.
4. Review and publishing.
5. Replace frontend placeholder data with API-backed state.

## Verification Gates

- Alembic upgrades fresh and legacy SQLite databases without data loss.
- API tests cover create, list, patch, delete, ownership validation, and invalid transitions.
- Pydantic request models forbid unexpected fields and bound text/collection sizes.
- Full API test suite passes.
- Full Web test suite and production build pass after frontend integration.
- Browser workflow verifies persistence after reload at 1440px, 1024px, and 768px.
