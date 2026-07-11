from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

import pytest

from comic_studio.services.script_extraction import (
    MAX_SCRIPT_SOURCE_BYTES,
    ScriptSourceError,
    extract_pasted_text,
    extract_uploaded_script,
)


def _docx_bytes() -> bytes:
    document_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:r><w:t>第一场 天台</w:t></w:r></w:p>
        <w:tbl><w:tr><w:tc><w:p><w:r><w:t>林夏</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>别回头。</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      </w:body>
    </w:document>"""
    content_types = """<?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>"""
    relationships = """<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>"""
    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", relationships)
        archive.writestr("word/document.xml", document_xml)
    return buffer.getvalue()


def _pdf_bytes(text: str | None) -> bytes:
    stream = b"" if text is None else f"BT /F1 14 Tf 72 720 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(output))
        output.extend(f"{index} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode())
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode())
    output.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode()
    )
    return bytes(output)


def test_extracts_and_normalizes_pasted_text():
    result = extract_pasted_text("\ufeff第一场\r\n\r\n  林夏：你好。  \r\n")

    assert result.source_format == "paste"
    assert result.text == "第一场\n\n林夏：你好。"
    assert len(result.checksum) == 64


def test_extracts_gb18030_txt_and_normalizes_filename():
    result = extract_uploaded_script("../秘密 剧本.TXT", "序章\r\n雨夜。".encode("gb18030"))

    assert result.source_format == "txt"
    assert result.filename == "秘密 剧本.TXT"
    assert result.text == "序章\n雨夜。"


def test_extracts_docx_paragraphs_and_table_cells():
    result = extract_uploaded_script("episode.docx", _docx_bytes())

    assert result.source_format == "docx"
    assert result.text.splitlines() == ["第一场 天台", "林夏", "别回头。"]


def test_extracts_text_pdf_in_page_order():
    result = extract_uploaded_script("episode.pdf", _pdf_bytes("ROOFTOP SCENE"))

    assert result.source_format == "pdf"
    assert result.text == "ROOFTOP SCENE"


def test_rejects_scanned_pdf_without_extractable_text():
    with pytest.raises(ScriptSourceError, match="ocr_required") as error:
        extract_uploaded_script("scan.pdf", _pdf_bytes(None))

    assert error.value.category == "ocr_required"


@pytest.mark.parametrize(
    ("filename", "content", "category"),
    [
        ("script.md", b"hello", "unsupported_format"),
        ("broken.docx", b"not a zip", "malformed_document"),
        ("broken.pdf", b"not a pdf", "malformed_document"),
        ("empty.txt", b"  \r\n", "empty_source"),
    ],
)
def test_rejects_invalid_uploaded_sources(filename, content, category):
    with pytest.raises(ScriptSourceError, match=category) as error:
        extract_uploaded_script(filename, content)

    assert error.value.category == category


def test_rejects_oversize_source_before_parsing():
    with pytest.raises(ScriptSourceError, match="source_too_large"):
        extract_uploaded_script("huge.txt", b"x" * (MAX_SCRIPT_SOURCE_BYTES + 1))
