from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from tempfile import NamedTemporaryFile
from uuid import uuid4


class ScriptFilePathError(ValueError):
    pass


@dataclass(frozen=True)
class SavedScriptFile:
    relative_path: str
    checksum: str


class ScriptFileStore:
    def __init__(self, data_root: Path):
        self.data_root = data_root.resolve()

    def resolve_relative(self, relative_path: str) -> Path:
        raw = Path(relative_path)
        if raw.is_absolute():
            raise ScriptFilePathError("unsafe_script_path")
        candidate = (self.data_root / raw).resolve()
        if candidate == self.data_root or self.data_root not in candidate.parents:
            raise ScriptFilePathError("unsafe_script_path")
        return candidate

    def persist_upload(
        self,
        project_id: str,
        document_id: str,
        original_filename: str,
        content: bytes,
    ) -> SavedScriptFile:
        suffix = Path(original_filename).suffix.lower()
        if suffix not in {".txt", ".docx", ".pdf"}:
            suffix = ".bin"
        relative = Path("projects") / project_id / "scripts" / document_id / f"{uuid4()}{suffix}"
        destination = self.resolve_relative(relative.as_posix())
        destination.parent.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile(dir=destination.parent, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(content)
            handle.flush()
        try:
            temporary.replace(destination)
        except Exception:
            temporary.unlink(missing_ok=True)
            raise
        return SavedScriptFile(
            relative_path=relative.as_posix(),
            checksum=sha256(content).hexdigest(),
        )

    def remove(self, relative_path: str) -> None:
        target = self.resolve_relative(relative_path)
        target.unlink(missing_ok=True)
        parent = target.parent
        while parent != self.data_root and self.data_root in parent.parents:
            try:
                parent.rmdir()
            except OSError:
                break
            parent = parent.parent
