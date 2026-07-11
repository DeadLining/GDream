import json
import os
import stat
from pathlib import Path

import pytest
from pydantic import ValidationError

from comic_studio.config import ROOT_ENV_FILE, Settings
from comic_studio.provider_channels import (
    ProviderChannel,
    ProviderChannels,
    ProviderChannelStore,
    provider_channel_defaults,
)


def channel_payload(**overrides):
    payload = {
        "name": "MiniMax",
        "enabled": True,
        "base_url": "https://api.example.com/v1",
        "model": "example-model",
        "api_key": "secret",
    }
    payload.update(overrides)
    return payload


def channels_payload(**overrides):
    payload = {
        "version": 1,
        "llm": channel_payload(name="MiniMax", model="MiniMax-M3"),
        "image": channel_payload(name="GPT Image", model="gpt-image-2"),
        "tts": channel_payload(
            name="Qwen TTS",
            model="Qwen3-TTS",
            api_key=None,
            ssh_host="ai-comic-tts",
        ),
    }
    payload.update(overrides)
    return payload


def make_channels(**overrides):
    return ProviderChannels.model_validate(channels_payload(**overrides))


def test_environment_settings_bootstrap_provider_channel_defaults(monkeypatch):
    monkeypatch.setenv("MINIMAX_BASE_URL", "https://llm.example.com/v1")
    monkeypatch.setenv("MINIMAX_API_KEY", "llm-key")
    monkeypatch.setenv("MINIMAX_MODEL", "llm-model")
    monkeypatch.setenv("GPT_IMAGE_BASE_URL", "https://image.example.com/v1")
    monkeypatch.setenv("GPT_IMAGE_KEY", "image-key")
    monkeypatch.setenv("GPT_IMAGE_MODEL", "image-model")
    monkeypatch.setenv("QWEN_TTS_BASE_URL", "https://tts.example.com/v1")
    monkeypatch.setenv("QWEN_TTS_MODEL", "tts-model")
    monkeypatch.setenv("QWEN_TTS_SSH_HOST", "tts-host")

    settings = Settings(_env_file=None)
    defaults = provider_channel_defaults(settings)

    assert settings.provider_channels_path == (
        ROOT_ENV_FILE.parent / "data/provider-channels.json"
    ).resolve()
    assert defaults.version == 1
    assert defaults.llm.model_dump(mode="json") == channel_payload(
        base_url="https://llm.example.com/v1",
        model="llm-model",
        api_key="llm-key",
        ssh_host=None,
    )
    assert defaults.image.model_dump(mode="json") == channel_payload(
        name="GPT Image",
        base_url="https://image.example.com/v1",
        model="image-model",
        api_key="image-key",
        ssh_host=None,
    )
    assert defaults.tts.model_dump(mode="json") == channel_payload(
        name="Qwen TTS",
        base_url="https://tts.example.com/v1",
        model="tts-model",
        api_key=None,
        ssh_host="tts-host",
    )


def test_bootstrap_disables_key_required_channels_when_legacy_keys_are_empty(
    monkeypatch,
):
    monkeypatch.setenv("MINIMAX_API_KEY", "")
    monkeypatch.setenv("GPT_IMAGE_KEY", "")
    settings = Settings(_env_file=None)

    defaults = provider_channel_defaults(settings)

    assert defaults.llm.enabled is False
    assert defaults.image.enabled is False
    assert defaults.tts.enabled is True


def test_existing_json_is_authoritative_over_bootstrap_defaults(tmp_path):
    path = tmp_path / "provider-channels.json"
    saved = channels_payload(
        llm=channel_payload(name="Saved LLM", model="saved-model")
    )
    path.write_text(json.dumps(saved), encoding="utf-8")
    defaults = make_channels(
        llm=channel_payload(name="Environment LLM", model="env-model")
    )

    loaded = ProviderChannelStore(path, defaults).load()

    assert loaded.llm.name == "Saved LLM"
    assert loaded.llm.model == "saved-model"


@pytest.mark.parametrize(
    "payload",
    [
        channels_payload(version=2),
        channels_payload(version="1"),
        {**channels_payload(), "video": channel_payload()},
        channels_payload(llm={**channel_payload(), "unexpected": True}),
        channels_payload(llm=channel_payload(enabled="true")),
        channels_payload(llm=channel_payload(base_url="not-a-url")),
        channels_payload(llm=channel_payload(api_key="")),
        channels_payload(image=channel_payload(model="")),
        channels_payload(tts=channel_payload(api_key=None, base_url="")),
        channels_payload(llm=channel_payload(ssh_host="not-valid-for-llm")),
        channels_payload(image=channel_payload(ssh_host="not-valid-for-image")),
    ],
)
def test_schema_rejects_invalid_provider_channels(payload):
    with pytest.raises(ValidationError):
        ProviderChannels.model_validate(payload)


def test_disabled_channel_may_omit_connection_fields():
    channel = ProviderChannel.model_validate(
        {
            "name": "Disabled",
            "enabled": False,
            "base_url": "",
            "model": "",
            "api_key": "",
        }
    )

    assert channel.enabled is False


def test_store_rejects_invalid_json_instead_of_using_defaults(tmp_path):
    path = tmp_path / "provider-channels.json"
    path.write_text("{invalid", encoding="utf-8")
    store = ProviderChannelStore(path, make_channels())

    with pytest.raises(ValueError, match="Invalid provider channel configuration"):
        store.load()


def test_missing_file_bootstraps_defaults_without_writing_and_returns_isolated_snapshots(
    tmp_path,
):
    path = tmp_path / "provider-channels.json"
    defaults = make_channels()
    store = ProviderChannelStore(path, defaults)

    first = store.load()
    second = store.snapshot

    assert not path.exists()
    assert first == defaults
    assert second == defaults
    assert first is not second
    assert first.llm is not second.llm
    with pytest.raises(ValidationError):
        first.llm.name = "Mutated"


def test_missing_file_reloads_constructor_defaults_after_previous_save(tmp_path):
    path = tmp_path / "provider-channels.json"
    defaults = make_channels()
    store = ProviderChannelStore(path, defaults)
    updated = make_channels(
        llm=channel_payload(name="Updated LLM", model="updated-model")
    )
    store.save(updated)
    path.unlink()

    loaded = store.load()

    assert loaded == defaults
    assert store.snapshot == defaults


def test_save_is_atomic_private_and_updates_snapshot(tmp_path):
    path = tmp_path / "nested/provider-channels.json"
    store = ProviderChannelStore(path, make_channels())
    store.load()
    updated = make_channels(
        llm=channel_payload(name="Updated LLM", model="updated-model")
    )

    saved = store.save(updated)

    assert path.stat().st_mode & 0o777 == 0o600
    assert json.loads(path.read_text(encoding="utf-8")) == updated.model_dump(
        mode="json"
    )
    assert saved == updated
    assert saved is not updated
    assert store.snapshot == updated
    assert list(path.parent.glob("provider-channels.json.*.tmp")) == []


def test_atomic_save_failure_preserves_file_snapshot_and_cleans_temp(
    tmp_path, monkeypatch
):
    path = tmp_path / "provider-channels.json"
    original = make_channels()
    store = ProviderChannelStore(path, original)
    store.save(original)
    original_bytes = path.read_bytes()
    previous_snapshot = store.snapshot
    updated = make_channels(
        llm=channel_payload(name="Updated LLM", model="updated-model")
    )

    def fail_replace(source, destination):
        assert os.path.basename(source).startswith("provider-channels.json.")
        raise OSError("replace failed")

    monkeypatch.setattr(os, "replace", fail_replace)

    with pytest.raises(OSError, match="replace failed"):
        store.save(updated)

    assert path.read_bytes() == original_bytes
    assert store.snapshot == previous_snapshot
    assert list(tmp_path.glob("provider-channels.json.*.tmp")) == []


def test_parent_open_failure_rolls_back_replaced_file_and_snapshot(
    tmp_path, monkeypatch
):
    path = tmp_path / "provider-channels.json"
    original = make_channels()
    store = ProviderChannelStore(path, original)
    store.save(original)
    original_bytes = path.read_bytes()
    previous_snapshot = store.snapshot
    updated = make_channels(
        llm=channel_payload(name="Updated LLM", model="updated-model")
    )
    real_open = os.open

    def fail_parent_open(target, flags, *args, **kwargs):
        if Path(target) == path.parent:
            raise OSError("parent open failed")
        return real_open(target, flags, *args, **kwargs)

    monkeypatch.setattr(os, "open", fail_parent_open)

    with pytest.raises(OSError, match="parent open failed"):
        store.save(updated)

    assert path.read_bytes() == original_bytes
    assert store.snapshot == previous_snapshot
    assert list(tmp_path.glob("provider-channels.json.*.tmp")) == []


def test_parent_fsync_failure_removes_new_file_and_preserves_snapshot(
    tmp_path, monkeypatch
):
    path = tmp_path / "provider-channels.json"
    defaults = make_channels()
    store = ProviderChannelStore(path, defaults)
    previous_snapshot = store.snapshot
    real_fsync = os.fsync

    def fail_directory_fsync(file_descriptor):
        if stat.S_ISDIR(os.fstat(file_descriptor).st_mode):
            raise OSError("parent fsync failed")
        return real_fsync(file_descriptor)

    monkeypatch.setattr(os, "fsync", fail_directory_fsync)

    with pytest.raises(OSError, match="parent fsync failed"):
        store.save(defaults)

    assert not path.exists()
    assert store.snapshot == previous_snapshot
    assert list(tmp_path.glob("provider-channels.json.*.tmp")) == []
