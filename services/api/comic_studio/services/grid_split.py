"""Split a grid-style image into individual panel cells."""

from io import BytesIO

from PIL import Image


def split_grid_image(
    content: bytes,
    rows: int = 2,
    columns: int = 2,
) -> list[bytes]:
    """Crop ``content`` into ``rows x columns`` equal cells.

    Cells are returned in left-to-right, top-to-bottom order. If the image
    dimensions are not evenly divisible, the last row/column crops to the
    remaining pixels so no image data is dropped.
    """
    if rows <= 0 or columns <= 0:
        raise ValueError("rows and columns must be positive")
    with Image.open(BytesIO(content)) as image:
        width, height = image.size
        cell_width = width // columns
        cell_height = height // rows
        cells: list[bytes] = []
        for row in range(rows):
            y0 = row * cell_height
            y1 = height if row == rows - 1 else (row + 1) * cell_height
            for col in range(columns):
                x0 = col * cell_width
                x1 = width if col == columns - 1 else (col + 1) * cell_width
                cell = image.crop((x0, y0, x1, y1))
                buffer = BytesIO()
                cell.save(buffer, format="PNG")
                cells.append(buffer.getvalue())
        return cells
