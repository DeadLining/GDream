"""Tests for the M3.4 Decision Audit Trail.

The ``decision_log`` JSON column on :class:`ModelInvocation` records *why* a
particular provider was chosen for an invocation, including the list of
candidate providers known to the registry. This is the foundation for M4.2's
multi-provider scored selection.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from pydantic import SecretStr

from comic_studio.model_runtime.adapters import (
    CapabilityAdapterRegistry,
    ProviderRegistry,
    register_capability,
)
from comic_studio.model_runtime.contracts import Capability
from comic_studio.model_runtime.repository import InvocationRepository
from comic_studio.model_runtime.service import ModelRuntimeService
from comic_studio.provider_channels import (
    ProviderChannel,
    ProviderChannels,
)


class FakeAdapter:
    """Minimal adapter for testing — exposes ``model`` like real providers."""

    def __init__(self, model: str = "fake-model"):
        self.model = model


class _FakeAdapters:
    """Stands in for ``CapabilityAdapterRegistry``; exposes the registry link
    that ``ModelRuntimeService._build_decision_log`` introspects."""

    def __init__(self, adapter, registry):
        self._adapter = adapter
        # Mirror the real CapabilityAdapterRegistry attribute name.
        self.provider_factory = SimpleNamespace(_registry=registry)

    def create(self, capability):
        return self._adapter


def _channels():
    return ProviderChannels(
        llm=ProviderChannel(
            name="MiniMax",
            enabled=True,
            base_url="https://llm.example/v1",
            model="MiniMax-M3",
            api_key=SecretStr("llm-secret"),
        ),
        image=ProviderChannel(
            name="GPT Image",
            enabled=True,
            base_url="https://image.example/v1",
            model="image-model",
            api_key=SecretStr("image-secret"),
        ),
        tts=ProviderChannel(
            name="Qwen TTS",
            enabled=True,
            base_url="https://tts.example/v1",
            model="tts-model",
            api_key=SecretStr("tts-secret"),
            ssh_host="tts-host",
        ),
    )


def _make_service(session_factory, adapter=None, registry=None):
    """Build a ModelRuntimeService wired to a fake adapter/registry pair."""
    adapter = adapter or FakeAdapter("MiniMax-M3")
    registry = registry if registry is not None else ProviderRegistry.discover_default()
    adapters = _FakeAdapters(adapter, registry)
    store = SimpleNamespace(snapshot=_channels())
    return ModelRuntimeService(
        channel_store=store,
        session_factory=session_factory,
        data_root="/tmp",
        adapters=adapters,
    )


def test_repository_start_persists_decision_log(db_session):
    repo = InvocationRepository(db_session)
    payload = {
        "selected": {"provider": "minimax", "model": "MiniMax-M3"},
        "candidates": [
            {"provider": "minimax", "module": "comic_studio.providers.minimax", "selected": True}
        ],
        "reason": "single-registered-provider",
    }
    invocation = repo.start(
        Capability.TEXT,
        provider="minimax",
        model="MiniMax-M3",
        decision_log=payload,
    )
    db_session.refresh(invocation)
    assert invocation.decision_log == payload


def test_repository_start_decision_log_defaults_to_none(db_session):
    repo = InvocationRepository(db_session)
    invocation = repo.start(
        Capability.IMAGE,
        provider="gptimage",
        model="gpt-image-2",
    )
    db_session.refresh(invocation)
    assert invocation.decision_log is None


def test_build_decision_log_captures_selected_candidate_and_channel(db_session):
    """The service should populate selected/candidates/channel/reason."""
    fake_registry = ProviderRegistry()
    fake_registry.register(
        Capability.TEXT,
        type("MiniMaxProvider", (), {}),
        module_name="comic_studio.providers.minimax",
    )
    service = _make_service(
        session_factory=lambda: db_session,
        adapter=FakeAdapter("MiniMax-M3"),
        registry=fake_registry,
    )
    adapter = service.adapters.create(Capability.TEXT)
    log = service._build_decision_log(
        Capability.TEXT, adapter, service.channel_store.snapshot.llm
    )

    assert log["selected"] == {"provider": "fakeadapter", "model": "MiniMax-M3"}
    assert log["candidates"][0]["provider"] == "minimax"
    assert log["candidates"][0]["selected"] is False  # adapter class name differs
    assert log["reason"] == "single-registered-provider"
    assert log["channel"]["name"] == "MiniMax"
    assert log["channel"]["model"] == "MiniMax-M3"
    assert "decided_at" in log
    # JSON-serializable (it will be persisted via SQLAlchemy JSON column)
    json.dumps(log)


def test_build_decision_log_handles_missing_registry_gracefully(db_session):
    """If adapters.provider_factory lacks a _registry, the log degrades cleanly."""
    service = _make_service(
        session_factory=lambda: db_session,
        adapter=FakeAdapter("image-model"),
        registry=None,
    )
    # Force a registry-less adapter
    service.adapters.provider_factory = SimpleNamespace()

    log = service._build_decision_log(
        Capability.IMAGE,
        service.adapters.create(Capability.IMAGE),
        service.channel_store.snapshot.image,
    )
    assert log["candidates"] == []
    assert log["reason"] == "single-registered-provider"
    assert log["selected"] == {"provider": "fakeadapter", "model": "image-model"}


def test_build_decision_log_lists_multiple_candidates(db_session):
    """The registry currently holds at most one provider per capability slot,
    so ``candidates`` length matches what was registered (one). When M4.2
    introduces scored multi-provider selection, this test will expand to assert
    that all competing candidates appear.
    """
    registry = ProviderRegistry()
    registry.register(
        Capability.IMAGE,
        type("GPTImageProvider", (), {}),
        module_name="comic_studio.providers.gpt_image",
    )
    service = _make_service(
        session_factory=lambda: db_session,
        adapter=FakeAdapter("image-model"),
        registry=registry,
    )
    log = service._build_decision_log(
        Capability.IMAGE,
        service.adapters.create(Capability.IMAGE),
        service.channel_store.snapshot.image,
    )
    assert len(log["candidates"]) == 1
    assert log["candidates"][0]["provider"] == "gptimage"
    assert log["reason"] == "single-registered-provider"
