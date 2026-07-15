from dataclasses import dataclass


@dataclass(frozen=True)
class Model3DResult:
    content: bytes
    source_url: str
