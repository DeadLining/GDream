from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from io import BytesIO
from pathlib import PurePath

from charset_normalizer import from_bytes
from docx import Document
from pypdf import PdfReader


MAX_SCRIPT_SOURCE_BYTES = 20 * 1024 * 1024
SUPPORTED_EXTENSIONS = {".txt": "txt", ".docx": "docx", ".pdf": "pdf"}


class ScriptSourceError(ValueError):
    def __init__(self, category: str):
        self.category = category
        super().__init__(category)


@dataclass(frozen=True)
class ExtractedScript:
    text: str
    source_format: str
    filename: str
    checksum: str


def _normalize_text(value: str) -> str:
    value = value.removeprefix("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.strip() for line in value.split("\n")]
    normalized = "\n".join(lines)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized).strip()
    if not normalized:
        raise ScriptSourceError("empty_source")
    return normalized


def _safe_filename(filename: str) -> str:
    normalized = filename.replace("\\", "/")
    return PurePath(normalized).name[:255]


def _result(text: str, source_format: str, filename: str, content: bytes) -> ExtractedScript:
    return ExtractedScript(
        text=_normalize_text(text),
        source_format=source_format,
        filename=filename,
        checksum=hashlib.sha256(content).hexdigest(),
    )


def extract_pasted_text(text: str) -> ExtractedScript:
    content = text.encode("utf-8")
    if len(content) > MAX_SCRIPT_SOURCE_BYTES:
        raise ScriptSourceError("source_too_large")
    return _result(text, "paste", "", content)


def extract_generation_brief(text: str) -> ExtractedScript:
    brief = text.strip()
    content = brief.encode("utf-8")
    if len(content) > MAX_SCRIPT_SOURCE_BYTES:
        raise ScriptSourceError("source_too_large")
    return ExtractedScript(
        text=brief,
        source_format="generated",
        filename="",
        checksum=hashlib.sha256(content).hexdigest(),
    )


def _extract_txt(content: bytes) -> str:
    for encoding in ("utf-8", "gb18030"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            pass
    match = from_bytes(content).best()
    if match is None:
        raise ScriptSourceError("malformed_document")
    return str(match)


def _extract_docx(content: bytes) -> str:
    try:
        document = Document(BytesIO(content))
        values = [paragraph.text for paragraph in document.paragraphs]
        for table in document.tables:
            for row in table.rows:
                values.extend(cell.text for cell in row.cells)
        return "\n".join(values)
    except Exception as exc:
        raise ScriptSourceError("malformed_document") from exc


def _extract_pdf(content: bytes) -> str:
    try:
        reader = PdfReader(BytesIO(content))
        text = "\n\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception as exc:
        raise ScriptSourceError("malformed_document") from exc
    if not text.strip():
        raise ScriptSourceError("ocr_required")
    return text


def extract_uploaded_script(filename: str, content: bytes) -> ExtractedScript:
    if len(content) > MAX_SCRIPT_SOURCE_BYTES:
        raise ScriptSourceError("source_too_large")
    safe_filename = _safe_filename(filename)
    extension = PurePath(safe_filename).suffix.lower()
    source_format = SUPPORTED_EXTENSIONS.get(extension)
    if source_format is None:
        raise ScriptSourceError("unsupported_format")

    extractors = {"txt": _extract_txt, "docx": _extract_docx, "pdf": _extract_pdf}
    text = extractors[source_format](content)
    return _result(text, source_format, safe_filename, content)
