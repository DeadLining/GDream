import errno
import json
import os
import stat
import threading
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
        "video": channel_payload(name="MiniMax Video", model="MiniMax-Hailuo-02"),
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
    assert defaults.llm.api_key_value == "llm-key"
    assert defaults.image.api_key_value == "image-key"
    assert defaults.llm.model == "llm-model"
    assert defaults.image.model == "image-model"
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


def test_video_channel_may_be_enabled_without_api_key():
    channels = make_channels(
        video=channel_payload(
            name="Wan2.2 Local",
            base_url="http://192.168.18.94:18081",
            model="Wan-AI/Wan2.2-TI2V-5B",
            api_key=None,
        )
    )

    assert channels.video.enabled is True
    assert channels.video.api_key_value is None


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


def test_api_key_is_masked_in_repr_and_validation_errors():
    secret = "do-not-leak-this-key"
    channel = ProviderChannel.model_validate(channel_payload(api_key=secret))

    assert secret not in repr(channel)
    assert channel.api_key_value == secret

    invalid = channels_payload(
        llm=channel_payload(api_key=secret, ssh_host="invalid-for-llm")
    )
    with pytest.raises(ValidationError) as exc_info:
        ProviderChannels.model_validate(invalid)

    assert secret not in str(exc_info.value)
    assert secret not in repr(exc_info.value)


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


def test_update_after_runtime_file_deletion_uses_active_snapshot(tmp_path):
    path = tmp_path / "provider-channels.json"
    defaults = make_channels()
    active = make_channels(
        image=channel_payload(name="Active Image", model="active-image"),
        tts=channel_payload(
            name="Active TTS",
            model="active-tts",
            api_key=None,
            ssh_host="active-host",
        ),
    )
    store = ProviderChannelStore(path, defaults)
    store.save(active)
    path.unlink()

    state = store.update(
        lambda snapshot: snapshot.model_copy(
            update={
                "llm": snapshot.llm.model_copy(update={"model": "updated-llm"})
            }
        )
    )

    assert state.channels.image.model == "active-image"
    assert state.channels.tts.model == "active-tts"
    assert json.loads(path.read_text(encoding="utf-8"))["image"]["model"] == (
        "active-image"
    )


def test_save_is_atomic_private_and_updates_snapshot(tmp_path):
    path = tmp_path / "nested/provider-channels.json"
    store = ProviderChannelStore(path, make_channels())
    store.load()
    updated = make_channels(
        llm=channel_payload(name="Updated LLM", model="updated-model")
    )

    saved = store.save(updated)

    assert path.stat().st_mode & 0o777 == 0o600
    assert json.loads(path.read_text(encoding="utf-8"))["llm"]["api_key"] == (
        "secret"
    )
    assert saved == updated
    assert saved is not updated
    assert store.snapshot == updated
    assert list(path.parent.glob("provider-channels.json.*.tmp")) == []


def test_concurrent_updates_serialize_read_modify_save_without_lost_changes(tmp_path):
    path = tmp_path / "provider-channels.json"
    first_store = ProviderChannelStore(path, make_channels())
    second_store = ProviderChannelStore(path, make_channels())
    first_store.save(make_channels())
    first_entered = threading.Event()
    release_first = threading.Event()
    second_entered = threading.Event()
    failures = []

    def update_llm(snapshot):
        first_entered.set()
        assert release_first.wait(timeout=2)
        return snapshot.model_copy(
            update={"llm": snapshot.llm.model_copy(update={"model": "llm-concurrent"})}
        )

    def update_image(snapshot):
        second_entered.set()
        return snapshot.model_copy(
            update={
                "image": snapshot.image.model_copy(update={"model": "image-concurrent"})
            }
        )

    def run_update(store, mutator):
        try:
            store.update(mutator)
        except Exception as error:
            failures.append(error)

    first = threading.Thread(target=run_update, args=(first_store, update_llm))
    second = threading.Thread(target=run_update, args=(second_store, update_image))
    first.start()
    assert first_entered.wait(timeout=2)
    second.start()
    assert not second_entered.wait(timeout=0.1)
    release_first.set()
    first.join(timeout=2)
    second.join(timeout=2)

    assert not first.is_alive()
    assert not second.is_alive()
    assert failures == []
    assert second_entered.is_set()
    assert second_store.snapshot.llm.model == "llm-concurrent"
    assert second_store.snapshot.image.model == "image-concurrent"
    persisted = json.loads(path.read_text(encoding="utf-8"))
    assert persisted["llm"]["model"] == "llm-concurrent"
    assert persisted["image"]["model"] == "image-concurrent"


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


@pytest.mark.parametrize("failure_errno", [errno.EINVAL, errno.ENOTSUP])
def test_unsupported_parent_directory_open_does_not_rollback_successful_save(
    tmp_path, monkeypatch, failure_errno
):
    path = tmp_path / "provider-channels.json"
    defaults = make_channels()
    store = ProviderChannelStore(path, defaults)
    real_open = os.open

    def unsupported_parent_open(target, flags, *args, **kwargs):
        if Path(target) == path.parent:
            raise OSError(failure_errno, "directory open unsupported")
        return real_open(target, flags, *args, **kwargs)

    monkeypatch.setattr(os, "open", unsupported_parent_open)

    saved = store.save(defaults)

    assert saved == defaults
    assert store.snapshot == defaults
    assert path.exists()


def test_unsupported_parent_directory_fsync_does_not_rollback_successful_save(
    tmp_path, monkeypatch
):
    path = tmp_path / "provider-channels.json"
    defaults = make_channels()
    store = ProviderChannelStore(path, defaults)
    real_fsync = os.fsync

    def unsupported_directory_fsync(file_descriptor):
        if stat.S_ISDIR(os.fstat(file_descriptor).st_mode):
            raise OSError(errno.EINVAL, "directory fsync unsupported")
        return real_fsync(file_descriptor)

    monkeypatch.setattr(os, "fsync", unsupported_directory_fsync)

    saved = store.save(defaults)

    assert saved == defaults
    assert store.snapshot == defaults
    assert path.exists()


def test_fchmod_falls_back_to_path_chmod_when_unsupported(tmp_path, monkeypatch):
    path = tmp_path / "provider-channels.json"
    defaults = make_channels()
    store = ProviderChannelStore(path, defaults)
    chmod_calls = []
    real_chmod = os.chmod

    def unsupported_fchmod(file_descriptor, mode):
        raise NotImplementedError("fchmod unsupported")

    def record_chmod(target, mode):
        chmod_calls.append((Path(target), mode))
        return real_chmod(target, mode)

    monkeypatch.setattr(os, "fchmod", unsupported_fchmod)
    monkeypatch.setattr(os, "chmod", record_chmod)

    store.save(defaults)

    assert chmod_calls
    assert chmod_calls[0][1] == 0o600
    assert path.stat().st_mode & 0o777 == 0o600


def test_store_instances_for_same_resolved_path_share_save_lock(tmp_path, monkeypatch):
    path = tmp_path / "nested/../provider-channels.json"
    defaults = make_channels()
    first_store = ProviderChannelStore(path, defaults)
    second_store = ProviderChannelStore(path.resolve(), defaults)
    first_in_parent_fsync = threading.Event()
    release_first = threading.Event()
    second_finished = threading.Event()
    real_first_fsync_parent = first_store._fsync_parent

    def block_first_parent_fsync():
        first_in_parent_fsync.set()
        assert release_first.wait(timeout=2)
        real_first_fsync_parent()

    monkeypatch.setattr(first_store, "_fsync_parent", block_first_parent_fsync)

    first_thread = threading.Thread(target=first_store.save, args=(defaults,))
    second_thread = threading.Thread(
        target=lambda: (
            second_store.save(defaults),
            second_finished.set(),
        )
    )
    first_thread.start()
    assert first_in_parent_fsync.wait(timeout=2)
    second_thread.start()

    assert not second_finished.wait(timeout=0.1)
    release_first.set()
    first_thread.join(timeout=2)
    second_thread.join(timeout=2)

    assert not first_thread.is_alive()
    assert not second_thread.is_alive()
    assert second_finished.is_set()


def test_save_and_rollback_failures_are_reported_together(tmp_path, monkeypatch):
    path = tmp_path / "provider-channels.json"
    defaults = make_channels()
    store = ProviderChannelStore(path, defaults)
    store.save(defaults)

    def fail_parent_fsync():
        raise OSError("save durability failed")

    def fail_rollback(previous_bytes, previous_mode):
        raise OSError("rollback failed")

    monkeypatch.setattr(store, "_fsync_parent", fail_parent_fsync)
    monkeypatch.setattr(store, "_rollback_file", fail_rollback)

    with pytest.raises(ExceptionGroup) as exc_info:
        store.save(defaults)

    messages = [str(error) for error in exc_info.value.exceptions]
    assert messages == ["save durability failed", "rollback failed"]


def test_store_refuses_symlink_config_file_without_modifying_target(tmp_path):
    target = tmp_path / "secret-target.json"
    target.write_text(json.dumps(channels_payload()), encoding="utf-8")
    original_bytes = target.read_bytes()
    linked_parent = tmp_path / "linked-parent"
    real_parent = tmp_path / "real-parent"
    real_parent.mkdir()
    linked_parent.symlink_to(real_parent, target_is_directory=True)
    config_path = linked_parent / "provider-channels.json"
    config_path.symlink_to(target)
    defaults = make_channels()
    store = ProviderChannelStore(config_path, defaults)
    previous_snapshot = store.snapshot

    with pytest.raises(ValueError, match="must not be a symlink"):
        store.load()
    with pytest.raises(ValueError, match="must not be a symlink"):
        store.save(defaults)

    assert target.read_bytes() == original_bytes
    assert config_path.is_symlink()
    assert store.snapshot == previous_snapshot
