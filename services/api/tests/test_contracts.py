"""M2.5 / M3.5 — Contract tests.

Locks down the field-name contract of core Pydantic response/create schemas
so that any schema change produces an explicit test diff. This runs without
any API key and without a database, making it CI-friendly.

Philosophy: we assert the *set of field names* for each schema, not the full
JSON Schema dump. Field additions/removals are the most common breaking change
and produce a readable, focused diff. Type changes are caught by the regular
type-check + API tests.
"""

from __future__ import annotations

from comic_studio import schemas


# Each entry is (schema class, expected field-name set).
# When you intentionally add/remove a field, update the expected set here;
# the test failure will name the exact field that changed.
CONTRACTS: list[tuple[type, set[str]]] = [
    # --- Project / episode core ---
    (
        schemas.ProjectCreate,
        {"title", "logline", "story_bible", "visual_style", "aspect_ratio", "language"},
    ),
    (
        schemas.EpisodeCreate,
        {"title", "premise", "target_duration_seconds"},
    ),
    # --- Production run (M1.3 added shot_ids; M2.2 contract) ---
    (
        schemas.ProductionRunCreate,
        {
            "stages", "concurrency",
            "regenerate_panels", "regenerate_speech", "regenerate_videos",
            "panel_generation_mode", "budget_cap_usd", "budget_mode", "shot_ids",
        },
    ),
    (
        schemas.ProductionRunRead,
        {
            "id", "episode_id", "status", "stages", "concurrency",
            "scope_type", "shot_ids",
            "regenerate_panels", "regenerate_speech", "regenerate_videos", "panel_generation_mode",
            "budget_cap_usd", "spent_usd", "budget_mode", "pause_requested",
            "total_items", "queued_items", "running_items", "succeeded_items",
            "failed_items", "skipped_items", "summary_error",
            "created_at", "updated_at",
        },
    ),
    (
        schemas.ProductionItemRead,
        {
            "id", "run_id", "stage", "target_type", "target_id",
            "position", "status", "attempt_count", "result_metadata", "error",
            "created_at", "updated_at",
        },
    ),
    # --- Asset / character ---
    (
        schemas.AssetRead,
        {
            "id", "kind", "media_url", "media_type",
            "provider", "model", "generation_attempt", "review_status",
            "created_at", "duration_seconds", "height", "width",
            "is_stale", "stale_reason",
        },
    ),
    (
        schemas.CharacterCreate,
        {
            "name", "role", "appearance_bible", "personality",
            "continuity_rules", "negative_constraints",
            "voice_speaker", "voice_instruction",
            "art_style_id",
        },
    ),
    # --- Job / delivery ---
    (
        schemas.JobRead,
        {
            "id", "operation", "target_type", "target_id", "status",
            "progress", "result_metadata", "error", "retry_count",
            "created_at", "updated_at",
        },
    ),
    (
        schemas.EpisodeVersionRead,
        {
            "id", "episode_id", "version", "label", "source", "author",
            "snapshot", "restored_from_id", "created_at",
        },
    ),
    # --- Story ---
    (
        schemas.StorylineCreate,
        {"title", "kind", "color", "description"},
    ),
    (
        schemas.StorylineEventCreate,
        {
            "episode_id", "scene_id", "shot_id", "position", "stage",
            "title", "description", "setup_event_id",
            "metadata", "payoff_event_id",
        },
    ),
]


def test_contract_schema_field_names_stable():
    """Each schema's field-name set must match the locked contract."""
    failures: list[str] = []
    for schema_cls, expected in CONTRACTS:
        actual = set(schema_cls.model_fields.keys())
        if actual != expected:
            missing = expected - actual
            extra = actual - expected
            parts = [schema_cls.__name__]
            if missing:
                parts.append(f"missing={sorted(missing)}")
            if extra:
                parts.append(f"extra={sorted(extra)}")
            failures.append(" | ".join(parts))
    assert not failures, "Schema contract drift detected:\n" + "\n".join(failures)


def test_contract_schemas_are_pydantic_models():
    """All contracted schemas must be instantiable Pydantic BaseModel subclasses."""
    from pydantic import BaseModel

    for schema_cls, _ in CONTRACTS:
        assert issubclass(schema_cls, BaseModel), f"{schema_cls.__name__} is not a BaseModel"


def test_contract_list_is_not_empty():
    """Guard against accidentally clearing the CONTRACTS list."""
    assert len(CONTRACTS) >= 10, "CONTRACTS list shrank — did you mean to drop coverage?"


# --- JSON Schema dump (optional, for manual review / snapshot files) -------


def test_contract_json_schema_dump_is_valid_json():
    """Every contracted schema must produce a valid JSON Schema via model_json_schema().

    This catches malformed annotations (e.g. bad Field defaults) that would
    break OpenAPI generation at import time.
    """
    import json

    for schema_cls, _ in CONTRACTS:
        dump = schema_cls.model_json_schema()
        # Must round-trip through JSON without error.
        json.dumps(dump)
        assert isinstance(dump, dict)
        assert "properties" in dump, f"{schema_cls.__name__} has no properties"
