from comic_studio.services.episode_ai_orchestrator import (
    shot_generation_needs_review,
)


def test_panel_stage_exposes_structured_generation_readiness():
    error = shot_generation_needs_review(
        {
            "shot-1": {
                "blockers": [
                    "missing_character_reference",
                    "missing_background",
                    "blocking_not_initialized",
                    "director_preview_missing",
                ],
                "requirement_ids": ["requirement-character", "requirement-scene"],
            }
        }
    )

    assert str(error) == "Shot generation is not ready"
    assert error.metadata["code"] == "shot_generation_not_ready"
    blocked = error.metadata["blocked_shots"]["shot-1"]
    assert blocked["blockers"] == [
        "missing_character_reference",
        "missing_background",
        "blocking_not_initialized",
        "director_preview_missing",
    ]
    assert len(blocked["requirement_ids"]) == 2
