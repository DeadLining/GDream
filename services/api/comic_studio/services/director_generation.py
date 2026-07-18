from typing import Any


def _generation_transform(value: Any) -> dict[str, Any]:
    transform = value if isinstance(value, dict) else {}
    return {
        "position": transform.get("position", [0, 0, 0]),
        "rotation": transform.get("rotation", [0, 0, 0]),
    }


def sanitize_director_generation_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    objects = []
    for raw in snapshot.get("objects", []):
        if not isinstance(raw, dict):
            continue
        objects.append(
            {
                "id": raw.get("id"),
                "kind": raw.get("kind"),
                "source_type": raw.get("source_type"),
                "source_id": raw.get("source_id"),
                "label": raw.get("label"),
                "transform": _generation_transform(raw.get("transform")),
                "visible": bool(raw.get("visible", True)),
            }
        )

    raw_camera = snapshot.get("camera")
    camera = None
    if isinstance(raw_camera, dict):
        camera = {
            key: raw_camera.get(key)
            for key in (
                "position",
                "target",
                "rotation",
                "focal_length_mm",
                "shot_size",
                "camera_motion",
                "framing_guides",
                "preview_asset_id",
                "guidance_asset_ids",
            )
        }

    return {
        "environment": snapshot.get("environment", {}),
        "objects": objects,
        "camera": camera,
    }
