import getpass
from pathlib import Path

from comic_studio.config import ROOT_ENV_FILE, Settings


def test_relative_storage_paths_resolve_from_repository_root():
    settings = Settings(
        database_url="sqlite:///./relative/studio.db",
        data_root="relative/data",
        _env_file=None,
    )

    root = ROOT_ENV_FILE.parent
    assert settings.data_root == (root / "relative/data").resolve()
    assert settings.database_url == f"sqlite:///{(root / 'relative/studio.db').resolve()}"


def test_hostbridge_daemon_socket_defaults_to_current_runtime_path():
    settings = Settings(_env_file=None)

    assert settings.hostbridge_daemon_socket == (
        Path("/private/tmp") / f"hostbridge-{getpass.getuser()}" / "daemon.sock"
    ).resolve()


def test_hostbridge_daemon_socket_accepts_unprefixed_environment_override(
    monkeypatch, tmp_path
):
    socket_path = tmp_path / "runtime/daemon.sock"
    monkeypatch.setenv("HOSTBRIDGE_DAEMON_SOCKET", str(socket_path))

    settings = Settings(_env_file=None)

    assert settings.hostbridge_daemon_socket == socket_path.resolve()


def test_hostbridge_daemon_socket_expands_prefixed_tilde_override(monkeypatch):
    monkeypatch.setenv(
        "AI_COMIC_HOSTBRIDGE_DAEMON_SOCKET", "~/.hostbridge/custom.sock"
    )

    settings = Settings(_env_file=None)

    assert settings.hostbridge_daemon_socket == (
        Path.home() / ".hostbridge/custom.sock"
    ).resolve()


def test_qwen_narrator_speaker_accepts_environment_override(monkeypatch):
    monkeypatch.setenv("QWEN_TTS_NARRATOR_SPEAKER", "vivian")

    settings = Settings(_env_file=None)

    assert settings.qwen_tts_narrator_speaker == "vivian"
