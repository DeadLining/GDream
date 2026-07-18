from comic_studio.services.director_generation import sanitize_director_generation_snapshot


def test_generation_snapshot_keeps_blocking_and_camera_but_drops_performance_detail():
    sanitized = sanitize_director_generation_snapshot(
        {
            "stage_id": "stage-1",
            "stage_version": 7,
            "environment": {"weather": "rain"},
            "objects": [
                {
                    "id": "object-1",
                    "kind": "character",
                    "source_type": "character_reference",
                    "source_id": "character-1",
                    "label": "林夏",
                    "transform": {
                        "position": [2, 0, -1],
                        "rotation": [0, 0.5, 0],
                        "scale": [1.8, 1.8, 1.8],
                    },
                    "appearance": {
                        "pose_preset": "action",
                        "facial_expression": "happy",
                        "animation_clip": "walk",
                        "gaze_target": [4, 1.8, 3],
                    },
                    "visible": True,
                }
            ],
            "camera": {
                "id": "camera-1",
                "version": 9,
                "position": [1, 2, 6],
                "target": [0, 1, 0],
                "rotation": [0, 0, 0],
                "focal_length_mm": 85,
                "shot_size": "close_up",
                "camera_motion": "static",
                "framing_guides": {"thirds": True},
                "object_overrides": {"object-1": {"pose_preset": "action"}},
                "preview_asset_id": "preview-1",
                "guidance_asset_ids": {"depth": "depth-1"},
            },
        }
    )

    assert sanitized == {
        "environment": {"weather": "rain"},
        "objects": [
            {
                "id": "object-1",
                "kind": "character",
                "source_type": "character_reference",
                "source_id": "character-1",
                "label": "林夏",
                "transform": {
                    "position": [2, 0, -1],
                    "rotation": [0, 0.5, 0],
                },
                "visible": True,
            }
        ],
        "camera": {
            "position": [1, 2, 6],
            "target": [0, 1, 0],
            "rotation": [0, 0, 0],
            "focal_length_mm": 85,
            "shot_size": "close_up",
            "camera_motion": "static",
            "framing_guides": {"thirds": True},
            "preview_asset_id": "preview-1",
            "guidance_asset_ids": {"depth": "depth-1"},
        },
    }
