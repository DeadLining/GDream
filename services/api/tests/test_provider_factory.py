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


@pytest.mark.parametrize(
    ("predicate", "expected"),
    [
        (lambda alias: alias == "tts-host", True),
        (lambda alias: alias == "different-host", False),
    ],
)
def test_factory_enables_ssh_first_only_for_owned_active_tts_alias(
    tmp_path,
    predicate,
    expected,
):
    store = ProviderChannelStore(tmp_path / "channels.json", channels())
    store.load()
    factory = ProviderFactory(
        store,
        tts_provider_class=CapturingProvider,
        prefer_ssh_for_host=predicate,
    )

    provider = factory.create_tts()

    assert provider.prefer_ssh is expected


def test_factory_owned_alias_predicate_errors_fail_closed(tmp_path):
    store = ProviderChannelStore(tmp_path / "channels.json", channels())
    store.load()

    def raises(_alias):
        raise RuntimeError("manager unavailable")

    factory = ProviderFactory(
        store,
        tts_provider_class=CapturingProvider,
        prefer_ssh_for_host=raises,
    )

    assert factory.create_tts().prefer_ssh is False


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


class RecordingRuntime:
    def __init__(self):
        self.calls = []

    async def plan_episode(self, target_id):
        self.calls.append(("plan_episode", target_id))

    async def execute_image(self, target_type, target_id, options):
        self.calls.append(("execute_image", target_type, target_id, options))
        return SimpleNamespace(id="panel-asset", local_path="panel.png")

    async def execute_speech(self, target_id):
        self.calls.append(("execute_speech", target_id))
        return SimpleNamespace(id="speech-asset", local_path="speech.wav")


@pytest.mark.parametrize(
    ("module", "runner_name", "expected_call", "runner_args"),
    [
        (
            episodes,
            "run_planning_job",
            ("plan_episode", "episode-1"),
            ("episode-1",),
        ),
        (
            assets,
            "run_panel_job",
            ("execute_image", "shot", "shot-1", {"activate": True}),
            ("shot-1", True),
        ),
        (
            speech,
            "run_speech_job",
            ("execute_speech", "line-1"),
            ("line-1",),
        ),
    ],
)
def test_background_operation_uses_model_runtime_once(
    monkeypatch,
    tmp_path,
    module,
    runner_name,
    expected_call,
    runner_args,
):
    runtime = RecordingRuntime()

    monkeypatch.setattr(module, "JobStore", FakeJobs)
    if module is episodes:
        class FakePlanningService:
            def __init__(self, session, planner):
                assert planner is runtime
                self.planner = planner

            async def plan_episode(self, target_id):
                await self.planner.plan_episode(target_id)

        monkeypatch.setattr(module, "PlanningService", FakePlanningService)
    app = SimpleNamespace(
        state=SimpleNamespace(
            session_factory=lambda: nullcontext(object()),
            settings=SimpleNamespace(data_root=tmp_path),
            model_runtime=runtime,
        )
    )

    asyncio.run(getattr(module, runner_name)(app, "job-1", *runner_args))

    assert runtime.calls == [expected_call]


def test_production_workers_use_model_runtime(client):
    runtime = RecordingRuntime()
    client.app.state.model_runtime = runtime
    workers = client.app.state.production_coordinator.workers

    asyncio.run(workers["panel"](SimpleNamespace(target_id="shot-1")))
    asyncio.run(workers["speech"](SimpleNamespace(target_id="line-1")))

    assert runtime.calls == [
        ("execute_image", "shot", "shot-1", {"activate": True}),
        ("execute_speech", "line-1"),
    ]
