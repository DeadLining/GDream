"""Tests for the M3.6 automatic provider registry.

Verifies that:

1. ``ProviderRegistry.discover_default()`` auto-discovers the 4 builtin providers
   purely by scanning ``comic_studio.providers`` — no manual imports needed.
2. Adding a new provider module is sufficient to register it.
3. The registry honors explicit ``register()`` overrides.
4. ``ProviderFactory`` picks up registry overrides for capabilities not explicitly
   passed to its constructor.
5. The ``from_channel`` classmethod produces an instance equivalent to the legacy
   positional constructor.
6. ``get()`` raises a stable error for unknown capabilities.
"""

from __future__ import annotations

import sys
import textwrap
from pathlib import Path
from types import ModuleType

import pytest
from pydantic import SecretStr

from comic_studio.model_runtime.adapters import (
    ProviderRegistry,
    register_capability,
)
from comic_studio.model_runtime.contracts import Capability
from comic_studio.provider_channels import (
    ProviderChannel,
    ProviderChannels,
    ProviderChannelStore,
)
from comic_studio.provider_factory import ProviderFactory


def _channel(*, enabled=True, api_key="secret"):
    return ProviderChannel(
        name="X",
        enabled=enabled,
        base_url="https://example.com",
        model="x-model",
        api_key=SecretStr(api_key) if api_key else None,
    )


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


def test_discover_default_registers_all_builtin_providers():
    registry = ProviderRegistry.discover_default()
    discovered = {reg.capability for reg in registry.registrations()}
    assert discovered == {
        Capability.TEXT,
        Capability.IMAGE,
        Capability.SPEECH,
        Capability.VIDEO,
    }
    # And each maps to the expected provider class.
    from comic_studio.providers.gpt_image import GPTImageProvider
    from comic_studio.providers.minimax import MiniMaxProvider
    from comic_studio.providers.minimax_video import MiniMaxVideoProvider
    from comic_studio.providers.qwen_tts import QwenTTSProvider

    assert registry.get(Capability.TEXT) is MiniMaxProvider
    assert registry.get(Capability.IMAGE) is GPTImageProvider
    assert registry.get(Capability.SPEECH) is QwenTTSProvider
    assert registry.get(Capability.VIDEO) is MiniMaxVideoProvider


def test_discover_default_is_idempotent():
    a = ProviderRegistry.discover_default()
    b = ProviderRegistry.discover_default()
    assert {reg.capability for reg in a.registrations()} == {
        reg.capability for reg in b.registrations()
    }


def test_explicit_register_overrides_discovery():
    registry = ProviderRegistry()
    registry.register(Capability.TEXT, object_factory := type("X", (), {}))
    assert registry.get(Capability.TEXT) is object_factory


def test_clear_overrides_returns_to_discovered():
    registry = ProviderRegistry()
    registry.register(Capability.TEXT, type("X", (), {}))
    registry.override(Capability.TEXT, override := type("Y", (), {}))
    assert registry.get(Capability.TEXT) is override
    registry.clear_overrides()
    assert registry.get(Capability.TEXT) is not override


def test_get_raises_for_unknown_capability():
    registry = ProviderRegistry()
    with pytest.raises(LookupError, match="No provider registered"):
        registry.get(Capability.IMAGE)


def test_from_channel_matches_legacy_positional_constructor():
    from comic_studio.providers.gpt_image import GPTImageProvider

    channel = ProviderChannel(
        name="GPT Image",
        enabled=True,
        base_url="https://image.example/v1",
        model="image-model",
        api_key=SecretStr("image-secret"),
    )
    via_factory = GPTImageProvider.from_channel(channel)
    via_legacy = GPTImageProvider(channel.api_key_value, model=channel.model, base_url=channel.base_url)
    assert (via_factory.api_key, via_factory.model, via_factory.base_url) == (
        via_legacy.api_key,
        via_legacy.model,
        via_legacy.base_url,
    )


def test_tts_from_channel_evaluates_ssh_predicate():
    from comic_studio.providers.qwen_tts import QwenTTSProvider

    channel = ProviderChannel(
        name="Qwen TTS",
        enabled=True,
        base_url="https://tts.example/v1",
        model="tts-model",
        ssh_host="owned-host",
    )
    owned = QwenTTSProvider.from_channel(channel, prefer_ssh_for_host=lambda host: host == "owned-host")
    unowned = QwenTTSProvider.from_channel(channel, prefer_ssh_for_host=lambda host: host == "other")
    failing = QwenTTSProvider.from_channel(
        channel,
        prefer_ssh_for_host=lambda host: (_ for _ in ()).throw(RuntimeError("nope")),
    )
    assert owned.prefer_ssh is True
    assert unowned.prefer_ssh is False
    assert failing.prefer_ssh is False  # predicate errored → fail closed


def test_factory_uses_registry_when_no_class_override_supplied(tmp_path):
    """Factory should construct providers from the auto-discovered registry."""
    store = ProviderChannelStore(tmp_path / "channels.json", _channels())
    store.load()
    factory = ProviderFactory(store)

    image = factory.create_image()
    tts = factory.create_tts()
    llm = factory.create_llm()

    from comic_studio.providers.gpt_image import GPTImageProvider
    from comic_studio.providers.minimax import MiniMaxProvider
    from comic_studio.providers.qwen_tts import QwenTTSProvider

    assert isinstance(image, GPTImageProvider)
    assert isinstance(tts, QwenTTSProvider)
    assert isinstance(llm, MiniMaxProvider)


def test_factory_registry_override_used_when_class_override_absent(tmp_path):
    store = ProviderChannelStore(tmp_path / "channels.json", _channels())
    store.load()
    sentinel_llm = type("SentinelLLM", (), {"from_channel": classmethod(lambda cls, *a, **kw: ("llm", a, kw))})
    registry = ProviderRegistry()
    registry.register(Capability.TEXT, sentinel_llm)
    factory = ProviderFactory(store, registry=registry)

    result = factory.create_llm()
    assert result[0] == "llm"


def test_factory_explicit_class_override_beats_registry(tmp_path):
    store = ProviderChannelStore(tmp_path / "channels.json", _channels())
    store.load()

    class CapturingFromChannel:
        constructed = None

        @classmethod
        def from_channel(cls, channel, **kwargs):
            CapturingFromChannel.constructed = ("from_channel", channel, kwargs)
            return cls()

    # Register something else, but explicit override should win.
    other = type("Other", (), {})
    registry = ProviderRegistry()
    registry.register(Capability.IMAGE, other)
    factory = ProviderFactory(store, registry=registry, image_provider_class=CapturingFromChannel)

    factory.create_image()
    assert CapturingFromChannel.constructed is not None
    assert CapturingFromChannel.constructed[0] == "from_channel"


def test_drop_in_module_is_auto_discovered(monkeypatch, tmp_path):
    """A brand-new provider module added under comic_studio.providers should be
    discoverable without editing any import tables."""
    # Build a throwaway stub provider package and inject a new module.
    import comic_studio.providers as pkg

    stub_src = textwrap.dedent(
        """
        class StubProvider:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

            @classmethod
            def from_channel(cls, channel, **kwargs):
                return cls(channel=channel, **kwargs)
        """
    )
    stub_module = ModuleType("comic_studio.providers._stub_test_provider")
    exec(stub_src, stub_module.__dict__)
    stub_module.PROVIDER_CAPABILITY = register_capability(Capability.TEXT, provider_class="StubProvider")
    monkeypatch.setitem(sys.modules, stub_module.__name__, stub_module)

    # Make pkgutil see the new module.
    real_iter_modules = __import__("pkgutil").iter_modules

    def patched_iter_modules(path):
        for entry in real_iter_modules(path):
            yield entry
        # Synthesize a module-info entry for the stub.
        import types as _types

        info = _types.SimpleNamespace(name="_stub_test_provider", ispkg=False)
        yield info

    monkeypatch.setattr("pkgutil.iter_modules", patched_iter_modules)

    registry = ProviderRegistry.discover_default()
    assert Capability.TEXT in registry
    # The stub is auto-discovered alongside the real MiniMax provider. With
    # multi-provider support, the first registered provider remains the primary
    # default while the stub is still visible in the registry.
    from comic_studio.providers._stub_test_provider import StubProvider

    text_registrations = [
        r for r in registry.registrations() if r.capability is Capability.TEXT
    ]
    assert any(
        r.provider_class is StubProvider
        and r.module_name == "comic_studio.providers._stub_test_provider"
        for r in text_registrations
    )
