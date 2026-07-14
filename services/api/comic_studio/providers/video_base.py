from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class VideoTask:
    id: str
    status: Literal["queued", "processing", "succeeded", "failed"]
    file_id: str | None = None
    error: str = ""


@dataclass(frozen=True)
class VideoResult:
    content: bytes
    media_type: str = "video/mp4"
