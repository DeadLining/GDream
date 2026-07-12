import json
import os
import queue
import subprocess
import stat
import sys
import threading
import time
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from comic_studio.config import Settings
from comic_studio.schemas import (
    MockSshHostRead,
    MockSshStart,
    MockSshStatusRead,
)
from comic_studio.services.mock_ssh import (
    OWNER_TOKEN_ENV,
    MockSshManager,
    _default_pid_identity,
    _matches_expected_argv,
    _parse_darwin_process_bytes,
    _parse_linux_process_bytes,
)


class FakeProcess:
    _next_pid = 8000

    def __init__(self, output: bytes, returncode: int | None = None):
        self.stdout = BytesIO(output)
        self.returncode = returncode
        self.pid = FakeProcess._next_pid
        FakeProcess._next_pid += 1
        self.argv: list[str] = []
        self.owner_token = ""
        self.terminate_calls = 0
        self.kill_calls = 0
        self.wait_calls: list[float | None] = []

    def poll(self):
        return self.returncode

    def terminate(self):
        self.terminate_calls += 1
        self.returncode = 0
        close = getattr(self.stdout, "finish", None)
        if close is not None:
            close()

    def kill(self):
        self.kill_calls += 1
        self.returncode = -9
        close = getattr(self.stdout, "finish", None)
        if close is not None:
            close()

    def wait(self, timeout=None):
        self.wait_calls.append(timeout)
        if self.returncode is None:
            raise subprocess.TimeoutExpired(self.argv, timeout)
        return self.returncode


class ProcessFactory:
    def __init__(self, *processes: FakeProcess):
        self.processes = list(processes)
        self._processes_seen: list[FakeProcess] = []
        self.calls: list[list[str]] = []
        self.envs: list[dict[str, str]] = []

    def __call__(self, argv: list[str], *, env: dict[str, str]):
        self.calls.append(argv)
        self.envs.append(env)
        process = self.processes.pop(0)
        self._processes_seen.append(process)
        process.argv = argv
        process.owner_token = env[OWNER_TOKEN_ENV]
        return process

    def identity(self, pid: int):
        for process in self.processes_seen:
            if process.pid == pid and process.poll() is None:
                return {"argv": process.argv, "owner_token": process.owner_token}
        return None

    @property
    def processes_seen(self):
        return self._processes_seen


class StreamingOutput:
    def __init__(self):
        self._lines: queue.Queue[bytes | None] = queue.Queue()

    def feed(self, line: bytes):
        self._lines.put(line)

    def readline(self):
        return self._lines.get()

    def finish(self):
        self._lines.put(None)


def manager(tmp_path: Path, **kwargs) -> MockSshManager:
    factory = kwargs.get("process_factory")
    if isinstance(factory, ProcessFactory) and "pid_identity" not in kwargs:
        kwargs["pid_identity"] = factory.identity
    kwargs.setdefault("listener_probe", lambda _port: True)
    return MockSshManager(
        state_path=tmp_path / "state.json",
        log_path=tmp_path / "mock-ssh.log",
        startup_timeout=0.03,
        **kwargs,
    )


def test_status_marks_running_process_failed_when_listener_is_gone(tmp_path: Path):
    factory = ProcessFactory(successful_process(port=2227))
    service = manager(
        tmp_path,
        process_factory=factory,
        listener_probe=lambda port: port != 2227,
    )
    assert service.start("gpu-1", "comic-tts").state == "running"

    status = service.status()

    assert status.state == "failed"
    assert status.port is None
    assert status.error == "Mock SSH listener is no longer reachable"


def successful_process(alias: str = "comic-tts", port: int = 2222) -> FakeProcess:
    output = (
        f"starting\nlistening on ssh://127.0.0.1:{port}\n"
        f"ssh host alias: {alias}\n"
    )
    return FakeProcess(output.encode())


def test_mock_ssh_paths_resolve_relative_to_data_root(tmp_path: Path):
    settings = Settings(
        _env_file=None,
        data_root=tmp_path / "data",
        mock_ssh_state_path="runtime/mock-ssh.json",
        mock_ssh_log_path="logs/mock-ssh.log",
    )

    assert settings.mock_ssh_state_path == (
        settings.data_root / "runtime/mock-ssh.json"
    ).resolve()
    assert settings.mock_ssh_log_path == (
        settings.data_root / "logs/mock-ssh.log"
    ).resolve()


def test_mock_ssh_absolute_paths_are_preserved(tmp_path: Path):
    state_path = tmp_path / "state.json"
    log_path = tmp_path / "manager.log"

    settings = Settings(
        _env_file=None,
        data_root=tmp_path / "data",
        mock_ssh_state_path=state_path,
        mock_ssh_log_path=log_path,
    )

    assert settings.mock_ssh_state_path == state_path
    assert settings.mock_ssh_log_path == log_path


def test_mock_ssh_settings_accept_prefixed_environment_overrides(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    monkeypatch.setenv("AI_COMIC_MOCK_SSH_STATE_PATH", "runtime/state.json")
    monkeypatch.setenv("AI_COMIC_MOCK_SSH_LOG_PATH", "runtime/manager.log")
    monkeypatch.setenv("AI_COMIC_HOSTBRIDGE_EXECUTABLE", "/opt/bin/hostbridge")

    settings = Settings(_env_file=None, data_root=tmp_path / "data")

    assert settings.mock_ssh_state_path == (
        settings.data_root / "runtime/state.json"
    ).resolve()
    assert settings.mock_ssh_log_path == (
        settings.data_root / "runtime/manager.log"
    ).resolve()
    assert settings.hostbridge_executable == "/opt/bin/hostbridge"


@pytest.mark.parametrize(
    "identifier",
    ["host-1", "alias.local", "under_score", "UPPER", "0" * 64],
)
def test_mock_ssh_contracts_accept_safe_identifiers(identifier: str):
    assert MockSshStart(host_id=identifier, alias=identifier).host_id == identifier
    assert MockSshHostRead(id=identifier, name="Local host", type="ssh").id == identifier


@pytest.mark.parametrize(
    "identifier",
    ["", "contains space", "slash/value", "shell;command", "x" * 65],
)
def test_mock_ssh_contracts_reject_unsafe_identifiers(identifier: str):
    with pytest.raises(ValidationError):
        MockSshStart(host_id=identifier, alias="valid-alias")

    with pytest.raises(ValidationError):
        MockSshStart(host_id="valid-host", alias=identifier)


def test_mock_ssh_status_serializes_defaults():
    status = MockSshStatusRead(desired_running=False, state="stopped")

    assert status.model_dump() == {
        "desired_running": False,
        "state": "stopped",
        "host_id": "",
        "alias": "",
        "port": None,
        "error": None,
        "reused": False,
    }


def test_mock_ssh_status_validates_state():
    with pytest.raises(ValidationError):
        MockSshStatusRead(desired_running=True, state="unknown")


@pytest.mark.parametrize("port", [0, -1, 65536])
def test_mock_ssh_status_rejects_invalid_ports(port: int):
    with pytest.raises(ValidationError):
        MockSshStatusRead(desired_running=True, state="running", port=port)


@pytest.mark.parametrize("port", [None, 1, 65535])
def test_mock_ssh_status_accepts_optional_and_boundary_ports(port: int | None):
    status = MockSshStatusRead(desired_running=True, state="running", port=port)

    assert status.port == port


def test_list_hosts_parses_safe_fields_and_omits_commands(tmp_path: Path):
    result = SimpleNamespace(
        returncode=0,
        stdout=json.dumps(
            [
                {
                    "id": "gpu-1",
                    "label": "Render GPU",
                    "ssh": {"host": "user:password@example.test"},
                },
                {
                    "id": "local",
                    "label": "Local Host",
                    "command": "secret command",
                    "args": [],
                },
            ]
        ),
        stderr="",
    )
    calls = []

    def runner(argv, **kwargs):
        calls.append((argv, kwargs))
        return result

    hosts = manager(tmp_path, executable="/opt/hostbridge", runner=runner).list_hosts()

    assert hosts == [
        MockSshHostRead(id="gpu-1", name="Render GPU", type="ssh"),
        MockSshHostRead(id="local", name="Local Host", type="command"),
    ]
    assert calls[0][0] == ["/opt/hostbridge", "hosts", "list"]
    assert calls[0][1]["shell"] is False
    assert calls[0][1]["env"]["HOSTBRIDGE_PYTHON"] == sys._base_executable
    assert "password" not in repr(hosts)


def test_list_hosts_rejects_invalid_hostbridge_json(tmp_path: Path):
    result = SimpleNamespace(returncode=0, stdout="not-json", stderr="")

    with pytest.raises(RuntimeError, match="Unable to list HostBridge hosts"):
        manager(tmp_path, runner=lambda argv, **kwargs: result).list_hosts()


def test_list_hosts_sanitizes_runner_errors(tmp_path: Path):
    def runner(argv, **kwargs):
        raise OSError("could not run ssh user:supersecret@example.test")

    with pytest.raises(RuntimeError, match="Unable to list HostBridge hosts") as exc:
        manager(tmp_path, runner=runner).list_hosts()

    assert "supersecret" not in str(exc.value)


def test_start_uses_exact_argv_daemon_socket_and_parses_output(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    factory = ProcessFactory(successful_process())
    daemon_socket = tmp_path / "hostbridge/daemon.sock"
    monkeypatch.setenv("UNRELATED_HOSTBRIDGE_VALUE", "preserved")
    service = manager(
        tmp_path,
        executable="hostbridge2",
        process_factory=factory,
        daemon_socket=daemon_socket,
    )

    status = service.start("gpu-1", "comic-tts")

    assert factory.calls == [[
        "hostbridge2", "mock-ssh", "start", "gpu-1",
        "--ssh-host-alias", "comic-tts", "--connect-timeout", "120",
        "--command-timeout", "300",
    ]]
    assert factory.envs[0]["HOSTBRIDGE_PYTHON"] == sys._base_executable
    assert factory.envs[0]["HOSTBRIDGE_DAEMON_SOCKET"] == str(
        daemon_socket.resolve()
    )
    assert factory.envs[0]["UNRELATED_HOSTBRIDGE_VALUE"] == "preserved"
    spawned = factory.processes_seen[0]
    assert spawned.owner_token
    assert "api_key" not in spawned.owner_token.lower()
    assert "password" not in spawned.owner_token.lower()
    assert "daemon.sock" not in json.dumps(
        json.loads((tmp_path / "state.json").read_text())
    )
    assert status == MockSshStatusRead(
        desired_running=True, state="running", host_id="gpu-1",
        alias="comic-tts", port=2222,
    )


def test_duplicate_start_reuses_owned_process(tmp_path: Path):
    factory = ProcessFactory(successful_process())
    service = manager(tmp_path, process_factory=factory)
    first = service.start("gpu-1", "comic-tts")

    second = service.start("gpu-1", "comic-tts")

    assert first.reused is False
    assert second.reused is True
    assert len(factory.calls) == 1
    assert service.owns_running_alias("comic-tts") is True
    assert service.status().reused is False
    assert "reused" not in json.loads((tmp_path / "state.json").read_text())


def test_conflicting_start_does_not_replace_running_process(tmp_path: Path):
    factory = ProcessFactory(successful_process())
    service = manager(tmp_path, process_factory=factory)
    service.start("gpu-1", "comic-tts")

    status = service.start("gpu-2", "other-alias")

    assert status.state == "failed"
    assert status.desired_running is True
    assert "already running" in (status.error or "").lower()
    assert len(factory.calls) == 1
    assert service.owns_running_alias("comic-tts") is True


@pytest.mark.parametrize(
    ("process", "error_fragment"),
    [
        (FakeProcess(b"fatal: token=supersecret\n", returncode=1), "exited"),
        (FakeProcess(b"listening on ssh://127.0.0.1:2222\n"), "alias"),
        (FakeProcess(b"ssh host alias: comic-tts\n"), "port"),
        (FakeProcess(b"still starting\n"), "timed out"),
    ],
)
def test_start_failures_are_actionable_and_redacted(
    tmp_path: Path, process: FakeProcess, error_fragment: str
):
    status = manager(
        tmp_path, process_factory=ProcessFactory(process)
    ).start("gpu-1", "comic-tts")

    assert status.state == "failed"
    assert error_fragment in (status.error or "").lower()
    assert "supersecret" not in (status.error or "")
    assert process.wait_calls


def test_live_startup_failure_terminates_and_reaps_spawned_child(tmp_path: Path):
    process = FakeProcess(b"ssh host alias: wrong-alias\nlistening on ssh://127.0.0.1:2222\n")

    status = manager(
        tmp_path, process_factory=ProcessFactory(process)
    ).start("gpu-1", "comic-tts")

    assert status.state == "failed"
    assert "unexpected" in (status.error or "").lower()
    assert process.terminate_calls == 1
    assert process.wait_calls


def test_cleanup_kills_child_when_terminate_does_not_finish(tmp_path: Path):
    class StubbornProcess(FakeProcess):
        def terminate(self):
            self.terminate_calls += 1

    process = StubbornProcess(b"ssh host alias: comic-tts\n")

    manager(tmp_path, process_factory=ProcessFactory(process)).start(
        "gpu-1", "comic-tts"
    )

    assert process.terminate_calls == 1
    assert process.kill_calls == 1
    assert len(process.wait_calls) >= 2


def test_failed_start_keeps_handle_when_child_exit_cannot_be_confirmed(
    tmp_path: Path,
):
    class UnstoppableProcess(FakeProcess):
        def terminate(self):
            self.terminate_calls += 1

        def kill(self):
            self.kill_calls += 1

    process = UnstoppableProcess(b"ssh host alias: comic-tts\n")
    service = manager(tmp_path, process_factory=ProcessFactory(process))

    status = service.start("gpu-1", "comic-tts")

    assert status.state == "failed"
    assert service._process is process
    persisted = json.loads((tmp_path / "state.json").read_text())
    assert persisted["pid"] == process.pid
    assert persisted["owner_token"]


def test_log_capture_is_bounded(tmp_path: Path):
    output = b"x" * 200_000 + b"\nlistening on ssh://127.0.0.1:2222\nssh host alias: comic-tts\n"
    service = manager(
        tmp_path,
        process_factory=ProcessFactory(FakeProcess(output)),
        max_log_bytes=4096,
    )

    assert service.start("gpu-1", "comic-tts").state == "running"
    assert (tmp_path / "mock-ssh.log").stat().st_size <= 4096


def test_lifetime_drainer_sanitizes_post_start_output_and_stops(tmp_path: Path):
    output = StreamingOutput()
    process = FakeProcess(b"")
    process.stdout = output
    factory = ProcessFactory(process)
    service = manager(tmp_path, process_factory=factory, max_log_bytes=2048)
    output.feed(b"listening on ssh://127.0.0.1:2222\n")
    output.feed(b"ssh host alias: comic-tts\n")

    assert service.start("gpu-1", "comic-tts").state == "running"
    for _ in range(2000):
        output.feed(
            b"diagnostic token=supersecret api_key=key123 "
            b"Authorization: Bearer bearer-secret\n"
        )
    deadline = time.monotonic() + 1
    while service._drainer.bytes_read < 100_000 and time.monotonic() < deadline:
        time.sleep(0.005)

    drainer = service._drainer
    assert service.stop().state == "stopped"
    log = (tmp_path / "mock-ssh.log").read_text()
    assert (tmp_path / "mock-ssh.log").stat().st_size <= 2048
    assert "supersecret" not in log
    assert "key123" not in log
    assert "bearer-secret" not in log
    assert drainer.is_alive is False
    assert service._drainer is None


def test_log_redacts_secrets_on_failed_start(tmp_path: Path):
    process = FakeProcess(
        b"token=supersecret api_key=key123 Authorization: Bearer bearer-secret\n",
        returncode=1,
    )

    manager(tmp_path, process_factory=ProcessFactory(process)).start(
        "gpu-1", "comic-tts"
    )

    log = (tmp_path / "mock-ssh.log").read_text()
    assert "supersecret" not in log
    assert "key123" not in log
    assert "bearer-secret" not in log


def test_state_is_atomic_private_and_contains_no_credentials(tmp_path: Path):
    service = manager(
        tmp_path, process_factory=ProcessFactory(successful_process())
    )
    service.start("gpu-1", "comic-tts")

    state_path = tmp_path / "state.json"
    payload = json.loads(state_path.read_text())
    assert stat.S_IMODE(state_path.stat().st_mode) == 0o600
    assert payload["desired_running"] is True
    assert payload["host_id"] == "gpu-1"
    persisted = state_path.read_text().lower()
    assert "api_key" not in persisted
    assert "password" not in persisted
    assert "credential" not in persisted
    assert list(tmp_path.glob("state.json.*.tmp")) == []


def test_state_destination_symlink_is_rejected(tmp_path: Path):
    target = tmp_path / "target.json"
    target.write_text("{}")
    (tmp_path / "state.json").symlink_to(target)
    with pytest.raises(ValueError, match="symlink"):
        manager(tmp_path, process_factory=ProcessFactory(successful_process()))


def test_atomic_state_replace_never_chmods_final_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    final_path = tmp_path / "state.json"
    real_chmod = os.chmod

    def guarded_chmod(path, mode):
        if Path(path) == final_path:
            raise AssertionError("final path chmod can follow a replaced symlink")
        return real_chmod(path, mode)

    monkeypatch.setattr(os, "chmod", guarded_chmod)

    status = manager(
        tmp_path, process_factory=ProcessFactory(successful_process())
    ).start("gpu-1", "comic-tts")

    assert status.state == "running"
    assert stat.S_IMODE(final_path.stat().st_mode) == 0o600


def test_load_repairs_valid_state_permissions_before_restore(tmp_path: Path):
    state_path = tmp_path / "state.json"
    state_path.write_text(json.dumps({
        "version": 1, "desired_running": False, "state": "stopped",
    }))
    state_path.chmod(0o644)

    service = manager(tmp_path, process_factory=ProcessFactory())

    assert stat.S_IMODE(state_path.stat().st_mode) == 0o600
    assert service.restore().state == "stopped"


def test_load_rejects_state_with_unsafe_permissions_when_repair_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    state_path = tmp_path / "state.json"
    state_path.write_text(json.dumps({"desired_running": False}))
    state_path.chmod(0o644)
    monkeypatch.setattr(os, "replace", lambda source, destination: (_ for _ in ()).throw(OSError()))

    with pytest.raises(ValueError, match="permissions"):
        manager(tmp_path, process_factory=ProcessFactory())


def test_log_destination_symlink_is_rejected(tmp_path: Path):
    target = tmp_path / "target.log"
    target.write_text("must remain")
    (tmp_path / "mock-ssh.log").symlink_to(target)
    service = manager(tmp_path, process_factory=ProcessFactory(successful_process()))

    status = service.start("gpu-1", "comic-tts")

    assert status.state == "failed"
    assert target.read_text() == "must remain"


def test_restore_stopped_does_not_spawn(tmp_path: Path):
    factory = ProcessFactory()
    service = manager(tmp_path, process_factory=factory)

    assert service.restore().state == "stopped"
    assert factory.calls == []


def test_restore_stopped_clears_stale_ownership_and_persists(tmp_path: Path):
    state_path = tmp_path / "state.json"
    state_path.write_text(json.dumps({
        "version": 1, "desired_running": False, "state": "failed",
        "host_id": "gpu-1", "alias": "comic-tts", "port": 2222,
        "pid": 999, "owner_token": "stale-token",
        "command_identity": "stale-command",
    }))
    service = manager(tmp_path, process_factory=ProcessFactory())

    assert service.restore().state == "stopped"
    persisted = json.loads(state_path.read_text())
    assert persisted["pid"] is None
    assert persisted["owner_token"] == ""
    assert persisted["command_identity"] == ""
    assert persisted["port"] is None


def test_restore_desired_running_restarts_when_pid_is_proven_dead(tmp_path: Path):
    (tmp_path / "state.json").write_text(json.dumps({
        "version": 1, "desired_running": True, "host_id": "gpu-1",
        "alias": "comic-tts", "port": 2222, "pid": 999,
        "owner_token": "old", "command_identity": "old-command",
    }))
    factory = ProcessFactory(successful_process(port=3333))
    service = manager(
        tmp_path,
        process_factory=factory,
        pid_identity=lambda pid: None,
        pid_exists=lambda pid: False,
    )

    status = service.restore()

    assert status.state == "running"
    assert status.port == 3333
    assert len(factory.calls) == 1


def test_restore_live_pid_with_unavailable_identity_does_not_spawn(tmp_path: Path):
    state_path = tmp_path / "state.json"
    state_path.write_text(json.dumps({
        "version": 1, "desired_running": True, "state": "running",
        "host_id": "gpu-1", "alias": "comic-tts", "port": 2222,
        "pid": 999, "owner_token": "old", "command_identity": "expected",
        "expected_argv": ["hostbridge", "mock-ssh"],
    }))
    factory = ProcessFactory(successful_process(port=3333))
    service = manager(
        tmp_path, process_factory=factory, pid_identity=lambda pid: None,
        pid_exists=lambda pid: True,
    )

    status = service.restore()

    assert status.state == "failed"
    assert status.desired_running is True
    assert "verify" in (status.error or "").lower()
    assert factory.calls == []
    persisted = json.loads(state_path.read_text())
    assert persisted["pid"] == 999
    assert persisted["owner_token"] == "old"


def test_restore_live_pid_with_mismatched_identity_does_not_spawn(tmp_path: Path):
    state_path = tmp_path / "state.json"
    state_path.write_text(json.dumps({
        "version": 1, "desired_running": True, "state": "running",
        "host_id": "gpu-1", "alias": "comic-tts", "port": 2222,
        "pid": 999, "owner_token": "old", "command_identity": "expected",
        "expected_argv": ["hostbridge", "mock-ssh"],
    }))
    factory = ProcessFactory(successful_process(port=3333))
    service = manager(
        tmp_path, process_factory=factory,
        pid_identity=lambda pid: {"argv": ["other"], "owner_token": "wrong"},
        pid_exists=lambda pid: True,
    )

    assert service.restore().state == "failed"
    assert factory.calls == []
    assert json.loads(state_path.read_text())["pid"] == 999


def test_restore_reuses_verified_owned_process(tmp_path: Path):
    argv = [
        "hostbridge", "mock-ssh", "start", "gpu-1", "--ssh-host-alias",
        "comic-tts", "--connect-timeout", "120", "--command-timeout", "300",
    ]
    identity = {
        "argv": argv,
        "owner_token": "owned-token",
    }
    (tmp_path / "state.json").write_text(json.dumps({
        "version": 1, "desired_running": True, "host_id": "gpu-1",
        "alias": "comic-tts", "port": 2222, "pid": 999,
        "owner_token": "owned-token", "command_identity": " ".join(argv),
    }))
    factory = ProcessFactory()
    service = manager(tmp_path, process_factory=factory, pid_identity=lambda pid: identity)

    status = service.restore()

    assert status.state == "running"
    assert factory.calls == []
    assert service.owns_running_alias("comic-tts") is True


def test_stop_rejects_pid_identity_mismatch_without_termination(tmp_path: Path):
    terminated = []
    factory = ProcessFactory(successful_process())
    identities = {}
    service = manager(
        tmp_path,
        process_factory=factory,
        pid_identity=lambda pid: identities.get(pid),
        terminator=lambda pid: terminated.append(pid),
    )
    service.start("gpu-1", "comic-tts")

    status = service.stop()

    assert status.state == "failed"
    assert status.desired_running is False
    assert terminated == []


def test_stop_persists_desired_stopped_before_termination(tmp_path: Path):
    observations = []
    state_path = tmp_path / "state.json"

    class ObservedProcess(FakeProcess):
        def terminate(self):
            observations.append(json.loads(state_path.read_text()))
            super().terminate()

    process = ObservedProcess(successful_process().stdout.read())
    factory = ProcessFactory(process)
    identity_by_pid = {}

    def identity(pid):
        return identity_by_pid.get(pid)

    service = manager(
        tmp_path, process_factory=factory, pid_identity=identity,
    )
    service.start("gpu-1", "comic-tts")
    persisted = json.loads((tmp_path / "state.json").read_text())
    identity_by_pid[persisted["pid"]] = {
        "argv": persisted["command_identity"].split(" "),
        "owner_token": persisted["owner_token"],
    }

    status = service.stop()

    assert observations[0]["desired_running"] is False
    assert status.state == "stopped"


def test_stop_retained_process_terminates_waits_and_reaps(tmp_path: Path):
    process = successful_process()
    service = manager(tmp_path, process_factory=ProcessFactory(process))
    service.start("gpu-1", "comic-tts")

    status = service.stop()

    assert status.state == "stopped"
    assert process.terminate_calls == 1
    assert process.wait_calls


def test_stop_retained_stubborn_process_escalates_to_kill(tmp_path: Path):
    class StubbornProcess(FakeProcess):
        def terminate(self):
            self.terminate_calls += 1

    process = StubbornProcess(successful_process().stdout.read())
    service = manager(tmp_path, process_factory=ProcessFactory(process))
    service.start("gpu-1", "comic-tts")

    status = service.stop()

    assert status.state == "stopped"
    assert process.terminate_calls == 1
    assert process.kill_calls == 1


def test_stop_never_reports_stopped_when_retained_exit_unconfirmed(tmp_path: Path):
    class UnstoppableProcess(FakeProcess):
        def terminate(self):
            self.terminate_calls += 1

        def kill(self):
            self.kill_calls += 1

    process = UnstoppableProcess(successful_process().stdout.read())
    service = manager(tmp_path, process_factory=ProcessFactory(process))
    service.start("gpu-1", "comic-tts")

    status = service.stop()

    assert status.state == "failed"
    persisted = json.loads((tmp_path / "state.json").read_text())
    assert persisted["pid"] == process.pid
    assert persisted["owner_token"]


def test_stop_restored_pid_confirms_exit_before_stopped(tmp_path: Path):
    argv = [
        "hostbridge", "mock-ssh", "start", "gpu-1", "--ssh-host-alias",
        "comic-tts", "--connect-timeout", "120", "--command-timeout", "300",
    ]
    state_path = tmp_path / "state.json"
    state_path.write_text(json.dumps({
        "desired_running": True, "state": "running", "host_id": "gpu-1",
        "alias": "comic-tts", "port": 2222, "pid": 9191,
        "owner_token": "owned", "command_identity": " ".join(argv),
        "expected_argv": argv,
    }))
    alive = {"value": True}
    signals = []

    def terminate(pid, force=False):
        signals.append((pid, force))
        alive["value"] = False

    service = manager(
        tmp_path,
        process_factory=ProcessFactory(),
        pid_identity=lambda pid: {"argv": argv, "owner_token": "owned"},
        pid_exists=lambda pid: alive["value"],
        terminator=terminate,
    )

    assert service.stop().state == "stopped"
    assert signals == [(9191, False)]


def test_stop_clears_stale_pid_without_requiring_identity(tmp_path: Path):
    argv = ["hostbridge", "mock-ssh", "start", "gpu-1"]
    state_path = tmp_path / "state.json"
    state_path.write_text(json.dumps({
        "desired_running": True, "state": "failed", "host_id": "gpu-1",
        "alias": "comic-tts", "port": None, "pid": 9190,
        "owner_token": "stale", "command_identity": " ".join(argv),
        "expected_argv": argv,
    }))
    terminated = []
    service = manager(
        tmp_path,
        process_factory=ProcessFactory(),
        pid_identity=lambda pid: None,
        pid_exists=lambda pid: False,
        terminator=lambda pid, force=False: terminated.append((pid, force)),
    )

    status = service.stop()

    assert status.state == "stopped"
    assert status.desired_running is False
    assert terminated == []
    persisted = json.loads(state_path.read_text())
    assert persisted["pid"] is None
    assert persisted["owner_token"] == ""


def test_stop_accepts_the_official_node_hostbridge_wrapper(tmp_path: Path):
    expected = [
        "/usr/local/bin/hostbridge", "mock-ssh", "start", "gpu-1",
        "--ssh-host-alias", "comic-tts", "--connect-timeout", "120",
        "--command-timeout", "300",
    ]
    actual = ["node", *expected]
    (tmp_path / "state.json").write_text(json.dumps({
        "desired_running": True, "state": "running", "host_id": "gpu-1",
        "alias": "comic-tts", "port": 2222, "pid": 9192,
        "owner_token": "owned", "command_identity": " ".join(expected),
        "expected_argv": expected,
    }))
    alive = {"value": True}

    def terminate(pid, force=False):
        alive["value"] = False

    service = manager(
        tmp_path,
        process_factory=ProcessFactory(),
        pid_identity=lambda pid: {"argv": actual, "owner_token": "owned"},
        pid_exists=lambda pid: alive["value"],
        terminator=terminate,
    )

    assert service.stop().state == "stopped"


def test_stop_accepts_node_wrapper_when_state_uses_bare_hostbridge_command(
    tmp_path: Path,
):
    expected = [
        "hostbridge", "mock-ssh", "start", "gpu-1",
        "--ssh-host-alias", "comic-tts", "--connect-timeout", "120",
        "--command-timeout", "300",
    ]
    actual = ["node", "/usr/local/bin/hostbridge", *expected[1:]]
    (tmp_path / "state.json").write_text(json.dumps({
        "desired_running": True, "state": "running", "host_id": "gpu-1",
        "alias": "comic-tts", "port": 2222, "pid": 9193,
        "owner_token": "owned", "command_identity": " ".join(expected),
        "expected_argv": expected,
    }))
    alive = {"value": True}

    def terminate(pid, force=False):
        alive["value"] = False

    service = manager(
        tmp_path,
        process_factory=ProcessFactory(),
        pid_identity=lambda pid: {"argv": actual, "owner_token": "owned"},
        pid_exists=lambda pid: alive["value"],
        terminator=terminate,
    )

    assert service.stop().state == "stopped"


def test_launcher_legacy_python_argv_matches_expected_v2_command():
    expected = [
        "/repo/scripts/hostbridge-cs-bridge", "mock-ssh", "start", "gpu-1",
        "--ssh-host-alias", "comic-tts", "--connect-timeout", "120",
        "--command-timeout", "300",
    ]
    actual = [
        "/usr/bin/python3.12", "-m", "server_control_mcp.server", "mock-ssh",
        "gpu-1", "--ssh-host-alias", "comic-tts", "--connect-timeout", "120",
        "--command-timeout", "300",
    ]

    assert _matches_expected_argv(actual, expected) is True


@pytest.mark.parametrize(
    "actual",
    [
        ["/usr/bin/python3", "-m", "other.module", "mock-ssh", "gpu-1", "--ssh-host-alias", "comic-tts"],
        ["/usr/bin/python3", "-m", "server_control_mcp.server", "mock-ssh", "gpu-2", "--ssh-host-alias", "comic-tts"],
        ["/usr/bin/python3", "-m", "server_control_mcp.server", "mock-ssh", "gpu-1", "--ssh-host-alias", "other"],
        ["/usr/bin/python3", "-m", "server_control_mcp.server", "mock-ssh", "gpu-1", "--ssh-host-alias", "comic-tts", "extra"],
        ["/usr/bin/python3", "server_control_mcp.server", "mock-ssh", "gpu-1", "--ssh-host-alias", "comic-tts"],
        ["/usr/bin/server_control", "-m", "server_control_mcp.server", "mock-ssh", "gpu-1", "--ssh-host-alias", "comic-tts"],
    ],
)
def test_launcher_identity_rejects_inexact_legacy_argv(actual: list[str]):
    expected = [
        "/repo/hostbridge-cs-bridge", "mock-ssh", "start", "gpu-1",
        "--ssh-host-alias", "comic-tts",
    ]

    assert _matches_expected_argv(actual, expected) is False


def test_non_launcher_expected_command_rejects_legacy_python_argv():
    expected = [
        "/usr/local/bin/hostbridge", "mock-ssh", "start", "gpu-1",
        "--ssh-host-alias", "comic-tts",
    ]
    actual = [
        "/usr/bin/python3", "-m", "server_control_mcp.server", "mock-ssh",
        "gpu-1", "--ssh-host-alias", "comic-tts",
    ]

    assert _matches_expected_argv(actual, expected) is False


def test_launcher_identity_supports_restore_status_and_stop(tmp_path: Path):
    expected = [
        "/repo/hostbridge-cs-bridge", "mock-ssh", "start", "gpu-1",
        "--ssh-host-alias", "comic-tts", "--connect-timeout", "120",
        "--command-timeout", "300",
    ]
    actual = [
        "/usr/bin/python3", "-m", "server_control_mcp.server", "mock-ssh",
        *expected[3:],
    ]
    (tmp_path / "state.json").write_text(json.dumps({
        "desired_running": True, "state": "running", "host_id": "gpu-1",
        "alias": "comic-tts", "port": 2222, "pid": 9293,
        "owner_token": "owned", "command_identity": " ".join(expected),
        "expected_argv": expected,
    }))
    alive = {"value": True}

    def terminate(pid, force=False):
        alive["value"] = False

    service = manager(
        tmp_path,
        process_factory=ProcessFactory(),
        pid_identity=lambda pid: {"argv": actual, "owner_token": "owned"},
        pid_exists=lambda pid: alive["value"],
        terminator=terminate,
    )

    assert service.restore().state == "running"
    assert service.status().state == "running"
    assert service.stop().state == "stopped"


def test_launcher_identity_supports_retained_reuse_and_stop(tmp_path: Path):
    launcher = "/repo/hostbridge-cs-bridge"
    factory = ProcessFactory(successful_process())

    def identity(pid):
        process = factory.processes_seen[0]
        actual = [
            "/usr/bin/python3", "-m", "server_control_mcp.server", "mock-ssh",
            *process.argv[3:],
        ]
        return {"argv": actual, "owner_token": process.owner_token}

    service = manager(
        tmp_path, executable=launcher, process_factory=factory,
        pid_identity=identity,
    )

    assert service.start("gpu-1", "comic-tts").state == "running"
    assert service.start("gpu-1", "comic-tts").reused is True
    assert service.status().state == "running"
    assert service.stop().state == "stopped"


def test_stop_restored_pid_does_not_report_stopped_when_exit_unconfirmed(
    tmp_path: Path,
):
    argv = [
        "hostbridge", "mock-ssh", "start", "gpu-1", "--ssh-host-alias",
        "comic-tts", "--connect-timeout", "120", "--command-timeout", "300",
    ]
    (tmp_path / "state.json").write_text(json.dumps({
        "desired_running": True, "state": "running", "host_id": "gpu-1",
        "alias": "comic-tts", "port": 2222, "pid": 9292,
        "owner_token": "owned", "command_identity": " ".join(argv),
        "expected_argv": argv,
    }))
    signals = []
    service = manager(
        tmp_path,
        process_factory=ProcessFactory(),
        pid_identity=lambda pid: {"argv": argv, "owner_token": "owned"},
        pid_exists=lambda pid: True,
        terminator=lambda pid, force=False: signals.append((pid, force)),
        shutdown_timeout=0.02,
    )

    status = service.stop()

    assert status.state == "failed"
    assert signals == [(9292, False), (9292, True)]
    persisted = json.loads((tmp_path / "state.json").read_text())
    assert persisted["pid"] == 9292
    assert persisted["owner_token"] == "owned"


def test_transient_identity_failure_does_not_spawn_competing_tunnel(tmp_path: Path):
    factory = ProcessFactory(successful_process(), successful_process(port=3333))
    calls = 0

    def identity(pid):
        nonlocal calls
        calls += 1
        if calls == 1:
            return None
        process = factory.processes_seen[0]
        return {"argv": process.argv, "owner_token": process.owner_token}

    service = manager(tmp_path, process_factory=factory, pid_identity=identity)
    service.start("gpu-1", "comic-tts")

    status = service.start("gpu-1", "comic-tts")

    assert status.state == "failed"
    assert "verify" in (status.error or "").lower()
    assert len(factory.calls) == 1
    assert service._process is factory.processes_seen[0]


def test_concurrent_starts_spawn_once(tmp_path: Path):
    factory = ProcessFactory(successful_process())
    service = manager(tmp_path, process_factory=factory)
    results = []
    barrier = threading.Barrier(3)

    def start():
        barrier.wait()
        results.append(service.start("gpu-1", "comic-tts"))

    threads = [threading.Thread(target=start) for _ in range(2)]
    for thread in threads:
        thread.start()
    barrier.wait()
    for thread in threads:
        thread.join()

    assert [result.state for result in results] == ["running", "running"]
    assert len(factory.calls) == 1


def test_in_memory_process_with_identity_mismatch_is_not_reused(tmp_path: Path):
    factory = ProcessFactory(successful_process(), successful_process(port=3333))
    service = manager(
        tmp_path,
        process_factory=factory,
        pid_identity=lambda pid: {"argv": ["other"], "owner_token": "wrong"},
    )
    service.start("gpu-1", "comic-tts")

    second = service.start("gpu-1", "comic-tts")

    assert second.state == "failed"
    assert "verify" in (second.error or "").lower()
    assert len(factory.calls) == 1


def test_parse_linux_process_bytes_preserves_argv_and_marker():
    identity = _parse_linux_process_bytes(
        b"/opt/hostbridge\0mock-ssh\0start\0gpu-1\0",
        b"PATH=/usr/bin\0AI_COMIC_MOCK_SSH_OWNER_TOKEN=opaque\0",
    )

    assert identity == {
        "argv": ["/opt/hostbridge", "mock-ssh", "start", "gpu-1"],
        "owner_token": "opaque",
    }


def test_parse_darwin_process_bytes_preserves_argv_and_marker():
    argv = ["/opt/hostbridge", "mock-ssh", "start", "gpu-1"]
    payload = (
        len(argv).to_bytes(4, byteorder=sys.byteorder, signed=True)
        + b"/opt/hostbridge\0\0"
        + b"\0".join(item.encode() for item in argv)
        + b"\0PATH=/usr/bin\0AI_COMIC_MOCK_SSH_OWNER_TOKEN=opaque\0"
    )

    assert _parse_darwin_process_bytes(payload) == {
        "argv": argv,
        "owner_token": "opaque",
    }


@pytest.mark.skipif(
    sys.platform not in {"darwin", "linux"},
    reason="process argv/environment inspection is supported on macOS and Linux",
)
def test_default_pid_identity_reads_argv_and_owner_marker():
    token = "opaque-test-token"
    argv = [sys.executable, "-c", "import time; time.sleep(5)"]
    env = {**os.environ, OWNER_TOKEN_ENV: token}
    process = subprocess.Popen(argv, env=env)
    try:
        deadline = time.monotonic() + 2
        identity = None
        while identity is None and time.monotonic() < deadline:
            identity = _default_pid_identity(process.pid)
            time.sleep(0.01)
        if identity is None:
            pytest.skip("process identity facility is unavailable")
        assert identity["owner_token"] == token
        assert identity["argv"] == argv
    finally:
        process.terminate()
        process.wait(timeout=2)


def test_status_reconciles_retained_child_exit_without_spawning(tmp_path: Path):
    process = successful_process()
    factory = ProcessFactory(process)
    service = manager(tmp_path, process_factory=factory)
    assert service.start("gpu-1", "comic-tts").state == "running"
    process.returncode = 7

    status = service.status()

    assert status.state == "failed"
    assert status.desired_running is True
    assert status.reused is False
    assert len(factory.calls) == 1
    assert service._process is None
    assert json.loads((tmp_path / "state.json").read_text())["state"] == "failed"


def test_status_reconciles_restored_pid_proven_absent(tmp_path: Path):
    state_path = tmp_path / "state.json"
    state_path.write_text(json.dumps({
        "desired_running": True, "state": "running", "host_id": "gpu-1",
        "alias": "comic-tts", "pid": 999, "owner_token": "owned",
        "command_identity": "expected", "expected_argv": ["hostbridge"],
    }))
    service = manager(
        tmp_path, process_factory=ProcessFactory(), pid_exists=lambda pid: False,
    )

    assert service.status().state == "failed"
    assert json.loads(state_path.read_text())["pid"] is None


def test_status_leaves_inconclusive_restored_liveness_unchanged(tmp_path: Path):
    state_path = tmp_path / "state.json"
    state_path.write_text(json.dumps({
        "desired_running": True, "state": "running", "host_id": "gpu-1",
        "alias": "comic-tts", "pid": 999, "owner_token": "owned",
        "command_identity": "expected", "expected_argv": ["hostbridge"],
    }))
    service = manager(
        tmp_path, process_factory=ProcessFactory(),
        pid_identity=lambda pid: None, pid_exists=lambda pid: None,
    )

    assert service.status().state == "running"
    assert json.loads(state_path.read_text())["state"] == "running"
