"""Tests for M3.1 grid image splitting."""

from io import BytesIO

import pytest
from PIL import Image, ImageDraw

from comic_studio.services.grid_split import split_grid_image


def _make_grid(width: int, height: int, rows: int, columns: int) -> bytes:
    image = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(image)
    cell_w = width // columns
    cell_h = height // rows
    colors = [
        (255, 0, 0),
        (0, 255, 0),
        (0, 0, 255),
        (255, 255, 0),
        (255, 0, 255),
        (0, 255, 255),
    ]
    for row in range(rows):
        for col in range(columns):
            x0 = col * cell_w
            y0 = row * cell_h
            x1 = width if col == columns - 1 else (col + 1) * cell_w
            y1 = height if row == rows - 1 else (row + 1) * cell_h
            color = colors[(row * columns + col) % len(colors)]
            draw.rectangle([x0, y0, x1, y1], fill=color)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.mark.parametrize(("rows", "columns"), [(2, 2), (1, 2), (2, 3)])
def test_split_grid_image_returns_expected_cells(rows, columns):
    width, height = 200 * columns, 200 * rows
    content = _make_grid(width, height, rows, columns)
    cells = split_grid_image(content, rows=rows, columns=columns)
    assert len(cells) == rows * columns
    expected_w = width // columns
    expected_h = height // rows
    for index, cell in enumerate(cells):
        with Image.open(BytesIO(cell)) as image:
            assert image.mode in {"RGB", "RGBA"}
            # Last row/column may absorb the remainder; all others are exact.
            is_last_row = index // columns == rows - 1
            is_last_col = index % columns == columns - 1
            if not is_last_col:
                assert image.width == expected_w
            if not is_last_row:
                assert image.height == expected_h


def test_split_grid_image_order_is_left_to_right_top_to_bottom():
    width, height = 400, 400
    content = _make_grid(width, height, rows=2, columns=2)
    cells = split_grid_image(content, rows=2, columns=2)
    assert len(cells) == 4
    with Image.open(BytesIO(cells[0])) as top_left:
        assert top_left.getpixel((0, 0))[:3] == (255, 0, 0)
    with Image.open(BytesIO(cells[1])) as top_right:
        assert top_right.getpixel((0, 0))[:3] == (0, 255, 0)
    with Image.open(BytesIO(cells[2])) as bottom_left:
        assert bottom_left.getpixel((0, 0))[:3] == (0, 0, 255)
    with Image.open(BytesIO(cells[3])) as bottom_right:
        assert bottom_right.getpixel((0, 0))[:3] == (255, 255, 0)


def test_split_grid_image_rejects_non_positive_dimensions():
    with pytest.raises(ValueError):
        split_grid_image(b"", rows=0, columns=2)
    with pytest.raises(ValueError):
        split_grid_image(b"", rows=2, columns=-1)
