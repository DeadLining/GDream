from __future__ import annotations


def _positions(count: int) -> list[list[float]]:
    if count <= 0:
        return []
    if count == 1:
        return [[0.0, 0.0, 0.0]]
    if count == 2:
        return [[-0.8, 0.0, 0.0], [0.8, 0.0, 0.0]]
    if count == 3:
        return [
            [-1.0, 0.0, 0.0],
            [0.0, 0.0, -0.6],
            [1.0, 0.0, 0.0],
        ]
    if count == 4:
        return [
            [-1.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [-0.6, 0.0, -0.8],
            [0.6, 0.0, -0.8],
        ]
    front_count = (count + 1) // 2
    back_count = count - front_count
    front_start = -0.7 * (front_count - 1)
    back_start = -0.7 * (back_count - 1)
    return [
        *[
            [front_start + 1.4 * index, 0.0, 0.0]
            for index in range(front_count)
        ],
        *[
            [back_start + 1.4 * index, 0.0, -0.9]
            for index in range(back_count)
        ],
    ]


def character_blocking_transform(index: int, count: int) -> dict[str, list[float]]:
    positions = _positions(count)
    if index < 0 or index >= len(positions):
        raise IndexError(index)
    return {
        "position": positions[index],
        "rotation": [0.0, 0.0, 0.0],
        "scale": [1.0, 1.0, 1.0],
    }
