from pathlib import Path

import pytest

from comic_studio.db import create_session_factory, create_tables
from comic_studio.model_runtime.contracts import Capability, TextStreamRequest
from comic_studio.model_runtime.errors import ModelRuntimeError, RuntimeErrorCode
from comic_studio.model_runtime.service import ModelRuntimeService


class FakeTextAdapter:
    model = "fake-text"

    def __init__(self, chunks=None, error=None):
        self.chunks = chunks or []
        self.error = error

    async def stream_script(self, _context):
        if self.error:
            raise self.error
        for chunk in self.chunks:
            yield chunk


class FakeRegistry:
    def __init__(self, adapter):
        self.adapter = adapter

    def create(self, capability):
        assert capability is Capability.TEXT
        return self.adapter


def runtime(tmp_path: Path, adapter: FakeTextAdapter) -> ModelRuntimeService:
    session_factory = create_session_factory(f"sqlite:///{tmp_path / 'runtime.db'}")
    create_tables(session_factory)
    return ModelRuntimeService(
        channel_store=None,
        session_factory=session_factory,
        data_root=tmp_path,
        adapters=FakeRegistry(adapter),
    )


@pytest.mark.anyio
async def test_stream_text_uses_registered_text_adapter(tmp_path):
    service = runtime(tmp_path, FakeTextAdapter(chunks=["A", "B"]))
    request = TextStreamRequest(purpose="script_generation", context={})

    assert [chunk async for chunk in service.stream_text(request)] == ["A", "B"]
    assert service.list_invocations(10)[0].status == "succeeded"


@pytest.mark.anyio
async def test_stream_failure_is_classified_and_persisted(tmp_path):
    service = runtime(tmp_path, FakeTextAdapter(error=TimeoutError("secret")))
    request = TextStreamRequest(purpose="script_generation", context={})

    with pytest.raises(ModelRuntimeError) as raised:
        [chunk async for chunk in service.stream_text(request)]

    assert raised.value.code is RuntimeErrorCode.PROVIDER_TIMEOUT
    invocation = service.list_invocations(10)[0]
    assert invocation.error_code == "provider_timeout"
    assert invocation.retryable is True
