from hashlib import sha256

import pytest

from comic_studio.services.script_files import ScriptFilePathError, ScriptFileStore


def test_script_file_store_persists_upload_under_generated_project_path(tmp_path):
    store = ScriptFileStore(tmp_path)
    payload = b"script payload"

    saved = store.persist_upload("project-1", "script-1", "../story.DOCX", payload)

    assert saved.relative_path.startswith("projects/project-1/scripts/script-1/")
    assert saved.relative_path.endswith(".docx")
    assert saved.checksum == sha256(payload).hexdigest()
    assert (tmp_path / saved.relative_path).read_bytes() == payload


def test_script_file_store_rejects_paths_outside_data_root(tmp_path):
    store = ScriptFileStore(tmp_path)

    with pytest.raises(ScriptFilePathError, match="unsafe_script_path"):
        store.resolve_relative("../outside.txt")


def test_script_file_store_removes_only_contained_files(tmp_path):
    store = ScriptFileStore(tmp_path)
    saved = store.persist_upload("project-1", "script-1", "story.txt", b"story")

    store.remove(saved.relative_path)

    assert not (tmp_path / saved.relative_path).exists()
    with pytest.raises(ScriptFilePathError, match="unsafe_script_path"):
        store.remove("/tmp/unrelated.txt")

