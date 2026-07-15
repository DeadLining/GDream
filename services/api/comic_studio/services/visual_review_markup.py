from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont, UnidentifiedImageError


_FONT_CANDIDATES = (
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)


def _font(size: int):
    for candidate in _FONT_CANDIDATES:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size=size)
    return ImageFont.load_default()


def _wrap(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> list[str]:
    lines: list[str] = []
    current = ""
    for character in text.strip():
        proposed = current + character
        if current and draw.textbbox((0, 0), proposed, font=font)[2] > max_width:
            lines.append(current)
            current = character
        else:
            current = proposed
    if current:
        lines.append(current)
    return lines[:4] or ["修改"]


def _bounds(kind: str, geometry: dict[str, Any], width: int, height: int):
    if kind == "circle":
        cx, cy = float(geometry["cx"]) * width, float(geometry["cy"]) * height
        rx, ry = float(geometry["rx"]) * width, float(geometry["ry"]) * height
        return (cx - rx, cy - ry, cx + rx, cy + ry)
    if kind == "rectangle":
        x, y = float(geometry["x"]) * width, float(geometry["y"]) * height
        return (
            x,
            y,
            x + float(geometry["width"]) * width,
            y + float(geometry["height"]) * height,
        )
    points = geometry.get("points", [])
    xs = [float(point[0]) * width for point in points]
    ys = [float(point[1]) * height for point in points]
    return (min(xs), min(ys), max(xs), max(ys))


def render_visual_review_markup(
    content: bytes,
    annotations: list[dict[str, Any]],
    messages: list[dict[str, Any]] | None = None,
) -> bytes:
    """Burn editable review marks into one PNG reference for image models."""
    try:
        with Image.open(BytesIO(content)) as source:
            canvas = source.convert("RGBA")
    except (UnidentifiedImageError, OSError, ValueError):
        return content

    width, height = canvas.size
    draw = ImageDraw.Draw(canvas, "RGBA")
    stroke = max(3, min(width, height) // 100)
    font = _font(max(14, min(width, height) // 32))
    badge_font = _font(max(12, min(width, height) // 28))
    margin = max(8, stroke * 2)
    color = (255, 59, 48, 255)

    for index, annotation in enumerate(annotations, start=1):
        kind = str(annotation.get("kind", "rectangle"))
        geometry = annotation.get("geometry") or {}
        try:
            left, top, right, bottom = _bounds(kind, geometry, width, height)
        except (KeyError, TypeError, ValueError):
            continue

        if kind == "circle":
            draw.ellipse((left, top, right, bottom), outline=color, width=stroke)
        elif kind == "rectangle":
            draw.rounded_rectangle(
                (left, top, right, bottom), radius=stroke * 2, outline=color, width=stroke
            )
        else:
            points = [
                (float(point[0]) * width, float(point[1]) * height)
                for point in geometry.get("points", [])
            ]
            if len(points) >= 2:
                draw.line(points, fill=color, width=stroke, joint="curve")

        label = str(annotation.get("label") or "修改")
        max_text_width = max(100, min(int(width * 0.28), 300))
        lines = _wrap(draw, f"{index:02d} {label}", font, max_text_width)
        line_height = draw.textbbox((0, 0), "测试", font=font)[3] + 4
        text_width = max(draw.textbbox((0, 0), line, font=font)[2] for line in lines)
        box_width = text_width + margin * 2
        box_height = line_height * len(lines) + margin
        place_right = right + margin * 3 + box_width <= width
        box_left = right + margin * 3 if place_right else max(0, left - margin * 3 - box_width)
        box_top = max(0, min(height - box_height, (top + bottom - box_height) / 2))
        anchor_x = right if place_right else left
        box_anchor_x = box_left if place_right else box_left + box_width
        anchor_y = max(0, min(height, (top + bottom) / 2))
        draw.line((anchor_x, anchor_y, box_anchor_x, box_top + box_height / 2), fill=color, width=stroke)
        draw.rounded_rectangle(
            (box_left, box_top, box_left + box_width, box_top + box_height),
            radius=stroke * 2,
            fill=(255, 255, 255, 235),
            outline=color,
            width=max(2, stroke // 2),
        )
        for line_index, line in enumerate(lines):
            draw.text(
                (box_left + margin, box_top + margin / 2 + line_index * line_height),
                line,
                fill=color,
                font=font,
            )

        badge_radius = max(11, stroke * 3)
        badge_x = max(badge_radius, min(width - badge_radius, right))
        badge_y = max(badge_radius, min(height - badge_radius, top))
        draw.ellipse(
            (
                badge_x - badge_radius,
                badge_y - badge_radius,
                badge_x + badge_radius,
                badge_y + badge_radius,
            ),
            fill=color,
            outline=(255, 255, 255, 255),
            width=max(1, stroke // 2),
        )
        badge_text = f"{index:02d}"
        badge_box = draw.textbbox((0, 0), badge_text, font=badge_font)
        draw.text(
            (
                badge_x - (badge_box[2] - badge_box[0]) / 2,
                badge_y - (badge_box[3] - badge_box[1]) / 2 - badge_box[1],
            ),
            badge_text,
            fill=(255, 255, 255, 255),
            font=badge_font,
        )

    global_notes = [
        str(item.get("content", "")).strip()
        for item in (messages or [])
        if item.get("author_kind") == "user" and str(item.get("content", "")).strip()
    ]
    if global_notes:
        note = "整图补充: " + "；".join(global_notes[-2:])
        lines = _wrap(draw, note, font, width - margin * 4)
        line_height = draw.textbbox((0, 0), "测试", font=font)[3] + 4
        box_height = line_height * len(lines) + margin * 2
        box_top = max(0, height - box_height - margin)
        draw.rounded_rectangle(
            (margin, box_top, width - margin, height - margin),
            radius=stroke * 2,
            fill=(15, 23, 42, 220),
            outline=color,
            width=max(2, stroke // 2),
        )
        for line_index, line in enumerate(lines):
            draw.text(
                (margin * 2, box_top + margin + line_index * line_height),
                line,
                fill=(255, 255, 255, 255),
                font=font,
            )

    output = BytesIO()
    canvas.convert("RGB").save(output, format="PNG", optimize=True)
    return output.getvalue()
