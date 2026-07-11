import asyncio
from contextlib import nullcontext
from types import SimpleNamespace

import pytest
from pydantic import SecretStr

from comic_studio.provider_channels import (
    ProviderChannel,
    ProviderChannels,
    ProviderChannelStore,
)
from comic_studio.provider_factory import (
    ProviderConfigurationError,
    ProviderFactory,
)
from comic_studio.routes import assets, episodes, speech


class CapturingProvider:
    def __init__(self, *args, **kwargs):
        self.args = args
        if args:
            self.api_key = args[0]
        self.__dict__.update(kwargs)


def channels(*, llm_model="MiniMax-M3", llm_enabled=True):
    return ProviderChannels(
        llm=ProviderChannel(
            name="MiniMax",
            enabled=llm_enabled,
            base_url="https://llm.example/v1",
            model=llm_model,
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


def test_new_provider_uses_latest_snapshot_without_mutating_existing_provider(tmp_path):
    store = ProviderChannelStore(tmp_path / "channels.json", channels())
    store.load()
    factory = ProviderFactory(
        store,
        llm_provider_class=CapturingProvider,
        image_provider_class=CapturingProvider,
        tts_provider_class=CapturingProvider,
    )

    first = factory.create_llm()
    current = store.snapshot
    store.save(
        current.model_copy(
            update={
                "llm": current.llm.model_copy(
                    update={
                        "model": "MiniMax-M3-new",
                        "base_url": "https://new.example/v2",
                    }
                )
            }
        )
    )
    second = factory.create_llm()

    assert (first.model, first.base_url) == (
        "MiniMax-M3",
        "https://llm.example/v1",
    )
    assert (second.model, second.base_url) == (
        "MiniMax-M3-new",
        "https://new.example/v2",
    )
    assert first.api_key == "llm-secret"


def test_factory_maps_all_channel_values_to_provider_constructors(tmp_path):
    store = ProviderChannelStore(tmp_path / "channels.json", channels())
    store.load()
    factory = ProviderFactory(
        store,
        llm_provider_class=CapturingProvider,
        image_provider_class=CapturingProvider,
        tts_provider_class=CapturingProvider,
    )

    image = factory.create_image()
    tts = factory.create_tts()

    assert (image.api_key, image.model, image.base_url) == (
        "image-secret",
        "image-model",
        "https://image.example/v1",
    )
    assert (tts.api_key, tts.model, tts.base_url, tts.ssh_host) == (
        "tts-secret",
        "tts-model",
        "https://tts.example/v1",
        "tts-host",
    )


@pytest.mark.parametrize("kind", ["llm", "image", "tts"])
def test_disabled_channel_raises_stable_sanitized_error(tmp_path, kind):
    snapshot = channels()
    channel = getattr(snapshot, kind).model_copy(update={"enabled": False})
    snapshot = snapshot.model_copy(update={kind: channel})
    store = ProviderChannelStore(tmp_path / "channels.json", snapshot)
    store.load()
    factory = ProviderFactory(
        store,
        llm_provider_class=CapturingProvider,
        image_provider_class=CapturingProvider,
        tts_provider_class=CapturingProvider,
    )

    with pytest.raises(
        ProviderConfigurationError,
        match=rf"^{kind} provider channel is not configured$",
    ) as caught:
        getattr(factory, f"create_{kind}")()

    assert "secret" not in str(caught.value).lower()


def test_incomplete_channel_error_does_not_leak_values_or_repr():
    channel = SimpleNamespace(
        enabled=True,
        name="MiniMax",
        base_url="https://secret-host.example/hidden",
        model="",
        api_key_value="leak-me",
    )
    store = SimpleNamespace(snapshot=SimpleNamespace(llm=channel))
    factory = ProviderFactory(store, llm_provider_class=CapturingProvider)

    with pytest.raises(ProviderConfigurationError) as caught:
        factory.create_llm()

    assert str(caught.value) == "llm provider channel is not configured"
    assert "leak-me" not in repr(caught.value)
    assert "secret-host" not in repr(caught.value)


def test_app_startup_does_not_create_provider_channel_file(tmp_path, monkeypatch):
    from comic_studio.config import get_settings
    from comic_studio.main import create_app

    channel_path = tmp_path / "provider-channels.json"
    monkeypatch.setenv("AI_COMIC_DATABASE_URL", f"sqlite:///{tmp_path / 'db.sqlite'}")
    monkeypatch.setenv("AI_COMIC_DATA_ROOT", str(tmp_path / "data"))
    monkeypatch.setenv("AI_COMIC_PROVIDER_CHANNELS_PATH", str(channel_path))
    get_settings.cache_clear()

    app = create_app()

    assert app.state.provider_channel_store.snapshot.version == 1
    assert not channel_path.exists()
    get_settings.cache_clear()


class RecordingFactory:
    def __init__(self):
        self.calls = []

    def create_llm(self):
        self.calls.append("llm")
        return object()

    def create_image(self):
        self.calls.append("image")
        return SimpleNamespace(model="image-model")

    def create_tts(self):
        self.calls.append("tts")
        return SimpleNamespace(model="tts-model")


class FakeJobs:
    def __init__(self, session):
        pass

    def transition(self, *args, **kwargs):
        return None


@pytest.mark.parametrize(
    ("module", "runner_name", "service_name", "factory_call", "runner_args"),
    [
        (episodes, "run_planning_job", "PlanningService", "llm", ("episode-1",)),
        (assets, "run_panel_job", "PanelService", "image", ("shot-1", True)),
        (speech, "run_speech_job", "SpeechService", "tts", ("line-1",)),
    ],
)
def test_background_operation_uses_provider_factory_once(
    monkeypatch,
    tmp_path,
    module,
    runner_name,
    service_name,
    factory_call,
    runner_args,
):
    factory = RecordingFactory()
    captured = []

    class FakeService:
        def __init__(self, *args):
            captured.append(args[-1])

        async def plan_episode(self, target_id):
            return None

        async def generate_panel(self, target_id, activate):
            return SimpleNamespace(id="asset-1", local_path="panel.png")

        async def synthesize_dialogue(self, target_id):
            return SimpleNamespace(id="asset-1", local_path="speech.wav")

    monkeypatch.setattr(module, "JobStore", FakeJobs)
    monkeypatch.setattr(module, service_name, FakeService)
    app = SimpleNamespace(
        state=SimpleNamespace(
            session_factory=lambda: nullcontext(object()),
            settings=SimpleNamespace(data_root=tmp_path),
            provider_factory=factory,
        )
    )

    asyncio.run(getattr(module, runner_name)(app, "job-1", *runner_args))

    assert factory.calls == [factory_call]
    assert len(captured) == 1


def test_production_workers_use_provider_factory(client, monkeypatch):
    from comic_studio import main

    factory = RecordingFactory()
    captured = []

    class FakePanelService:
        def __init__(self, session, data_root, provider):
            captured.append(provider)

        async def generate_panel(self, target_id, activate):
            return SimpleNamespace(id="panel-asset", local_path="panel.png")

    class FakeSpeechService:
        def __init__(self, session, data_root, provider):
            captured.append(provider)

        async def synthesize_dialogue(self, target_id):
            return SimpleNamespace(id="speech-asset", local_path="speech.wav")

    monkeypatch.setattr(main, "PanelService", FakePanelService)
    monkeypatch.setattr(main, "SpeechService", FakeSpeechService)
    client.app.state.provider_factory = factory
    workers = client.app.state.production_coordinator.workers

    asyncio.run(workers["panel"](SimpleNamespace(target_id="shot-1")))
    asyncio.run(workers["speech"](SimpleNamespace(target_id="line-1")))

    assert factory.calls == ["image", "tts"]
    assert len(captured) == 2
