import json
import ctypes
import os
import re
import secrets
import signal
import shlex
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Callable

from comic_studio.redaction import redact
from comic_studio.schemas import MockSshHostRead, MockSshStatusRead


_PORT_PATTERN = re.compile(r"listening on ssh://[^\s:]+:(\d{1,5})", re.IGNORECASE)
_ALIAS_PATTERN = re.compile(r"ssh host alias:\s*([A-Za-z0-9._-]{1,64})", re.IGNORECASE)
_SAFE_IDENTIFIER = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
OWNER_TOKEN_ENV = "AI_COMIC_MOCK_SSH_OWNER_TOKEN"


def _parse_linux_process_bytes(cmdline: bytes, environ: bytes) -> dict[str, Any] | None:
    argv = [
        item.decode("utf-8", errors="surrogateescape")
        for item in cmdline.split(b"\0")
        if item
    ]
    marker = f"{OWNER_TOKEN_ENV}=".encode()
    token = next(
        (
            item[len(marker) :].decode("utf-8", errors="strict")
            for item in environ.split(b"\0")
            if item.startswith(marker)
        ),
        "",
    )
    return {"argv": argv, "owner_token": token} if argv and token else None


def _parse_darwin_process_bytes(data: bytes) -> dict[str, Any] | None:
    integer_size = ctypes.sizeof(ctypes.c_int)
    if len(data) < integer_size:
        return None
    argc = int.from_bytes(data[:integer_size], byteorder=sys.byteorder, signed=True)
    cursor = integer_size
    executable_end = data.find(b"\0", cursor)
    if executable_end < 0:
        return None
    cursor = executable_end
    while cursor < len(data) and data[cursor] == 0:
        cursor += 1
    values: list[str] = []
    while cursor < len(data):
        end = data.find(b"\0", cursor)
        if end < 0:
            break
        if end > cursor:
            values.append(data[cursor:end].decode("utf-8", errors="surrogateescape"))
        cursor = end + 1
    if argc <= 0 or len(values) < argc:
        return None
    argv = values[:argc]
    marker = f"{OWNER_TOKEN_ENV}="
    token = next(
        (item[len(marker) :] for item in values[argc:] if item.startswith(marker)),
        "",
    )
    return {"argv": argv, "owner_token": token} if token else None


class _OutputDrainer:
    def __init__(self, process: Any, writer: Callable[[bytes], None]):
        self._process = process
        self._writer = writer
        self._condition = threading.Condition()
        self.alias: str | None = None
        self.port: int | None = None
        self.done = False
        self.error: Exception | None = None
        self.bytes_read = 0
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def wait(self, timeout: float) -> None:
        with self._condition:
            self._condition.wait(timeout)

    def join(self, timeout: float) -> bool:
        self._thread.join(timeout)
        return not self._thread.is_alive()

    @property
    def is_alive(self) -> bool:
        return self._thread.is_alive()

    def _run(self) -> None:
        try:
            stream = self._process.stdout
            if stream is None:
                return
            while True:
                line = stream.readline()
                if not line:
                    return
                if isinstance(line, str):
                    line = line.encode("utf-8", errors="replace")
                text = line.decode("utf-8", errors="replace")
                safe_line = str(redact(text)).encode("utf-8", errors="replace")
                self._writer(safe_line)
                with self._condition:
                    self.bytes_read += len(line)
                    port_match = _PORT_PATTERN.search(text)
                    alias_match = _ALIAS_PATTERN.search(text)
                    if port_match:
                        candidate = int(port_match.group(1))
                        if 1 <= candidate <= 65535:
                            self.port = candidate
                    if alias_match:
                        self.alias = alias_match.group(1)
                    self._condition.notify_all()
        except Exception as exc:
            self.error = exc
        finally:
            with self._condition:
                self.done = True
                self._condition.notify_all()


def _default_process_factory(argv: list[str], *, env: dict[str, str]):
    return subprocess.Popen(
        argv,
        shell=False,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )


def _default_runner(argv: list[str], **kwargs):
    return subprocess.run(argv, **kwargs)


def _default_pid_identity(pid: int) -> dict[str, Any] | None:
    proc_root = Path("/proc") / str(pid)
    try:
        if proc_root.exists():
            return _parse_linux_process_bytes(
                (proc_root / "cmdline").read_bytes(),
                (proc_root / "environ").read_bytes(),
            )

        if sys.platform == "darwin":
            return _darwin_pid_identity(pid)

        result = subprocess.run(
            ["ps", "-ww", "-p", str(pid), "-o", "command="],
            shell=False,
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
        environment_result = subprocess.run(
            ["ps", "eww", "-p", str(pid), "-o", "command="],
            shell=False,
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
    except (OSError, UnicodeError, subprocess.SubprocessError):
        return None
    command = result.stdout.strip()
    environment_command = environment_result.stdout
    token_match = re.search(
        rf"(?:^|\s){re.escape(OWNER_TOKEN_ENV)}=([^\s]+)",
        environment_command,
    )
    if result.returncode != 0 or not command or token_match is None:
        return None
    try:
        argv = shlex.split(command)
    except ValueError:
        return None
    return {"argv": argv, "owner_token": token_match.group(1)}


def _darwin_pid_identity(pid: int) -> dict[str, Any] | None:
    libc = ctypes.CDLL(None, use_errno=True)
    sysctl = libc.sysctl
    sysctl.argtypes = [
        ctypes.POINTER(ctypes.c_int),
        ctypes.c_uint,
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_size_t),
        ctypes.c_void_p,
        ctypes.c_size_t,
    ]
    argument_max = ctypes.c_int()
    argument_max_size = ctypes.c_size_t(ctypes.sizeof(argument_max))
    argument_max_mib = (ctypes.c_int * 2)(1, 8)
    if sysctl(
        argument_max_mib,
        2,
        ctypes.byref(argument_max),
        ctypes.byref(argument_max_size),
        None,
        0,
    ) != 0:
        return None

    buffer = ctypes.create_string_buffer(argument_max.value)
    buffer_size = ctypes.c_size_t(argument_max.value)
    process_args_mib = (ctypes.c_int * 3)(1, 49, pid)
    if sysctl(
        process_args_mib,
        3,
        buffer,
        ctypes.byref(buffer_size),
        None,
        0,
    ) != 0:
        return None
    return _parse_darwin_process_bytes(buffer.raw[: buffer_size.value])


def _default_terminator(pid: int, force: bool = False) -> None:
    os.kill(pid, signal.SIGKILL if force else signal.SIGTERM)


def _default_pid_exists(pid: int) -> bool | None:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return None
    except OSError:
        return None


def _default_listener_probe(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.2):
            return True
    except OSError:
        return False


def _default_listener_pids(port: int) -> list[int]:
    try:
        result = subprocess.run(
            ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"],
            shell=False,
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    if result.returncode != 0:
        return []
    return [int(line) for line in result.stdout.splitlines() if line.isdigit()]


def _matches_expected_argv(actual: object, expected: object) -> bool:
    if actual == expected:
        return True
    if (
        isinstance(actual, list)
        and isinstance(expected, list)
        and len(actual) >= 1
        and len(expected) >= 4
        and Path(str(expected[0])).name == "hostbridge-cs-bridge"
        and expected[1:3] == ["mock-ssh", "start"]
        and re.fullmatch(
            r"python(?:\d+(?:\.\d+)*)?",
            Path(str(actual[0])).name.casefold(),
        )
    ):
        return actual in (
            [
                actual[0],
                "-m",
                "server_control_mcp.server",
                "mock-ssh",
                *expected[3:],
            ],
            [
                actual[0],
                "-m",
                "server_control_mcp",
                "mock-ssh",
                "start",
                *expected[3:],
            ],
        )
    return (
        isinstance(actual, list)
        and isinstance(expected, list)
        and len(actual) == len(expected) + 1
        and Path(str(actual[0])).name in {"node", "nodejs"}
        and Path(str(actual[1])).name == Path(str(expected[0])).name
        and actual[2:] == expected[1:]
    )


class MockSshManager:
    """Own one HostBridge mock-SSH child and persist its desired lifecycle."""

    def __init__(
        self,
        *,
        state_path: Path,
        log_path: Path,
        executable: str = "hostbridge",
        daemon_socket: Path | str = "~/.hostbridge/daemon.sock",
        process_factory: Callable[..., Any] = _default_process_factory,
        runner: Callable[..., Any] = _default_runner,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
        startup_timeout: float = 5.0,
        pid_identity: Callable[[int], dict[str, Any] | None] = _default_pid_identity,
        pid_exists: Callable[[int], bool | None] = _default_pid_exists,
        terminator: Callable[..., None] = _default_terminator,
        listener_probe: Callable[[int], bool] = _default_listener_probe,
        listener_pids: Callable[[int], list[int]] = _default_listener_pids,
        shutdown_timeout: float = 2.0,
        max_log_bytes: int = 64 * 1024,
    ):
        requested_state = Path(state_path).expanduser()
        requested_log = Path(log_path).expanduser()
        self._state_path = requested_state.parent.resolve() / requested_state.name
        self._log_path = requested_log.parent.resolve() / requested_log.name
        self._executable = executable
        self._daemon_socket = Path(daemon_socket).expanduser().resolve()
        self._process_factory = process_factory
        self._runner = runner
        self._clock = clock
        self._sleep = sleep
        self._startup_timeout = startup_timeout
        self._pid_identity = pid_identity
        self._pid_exists = pid_exists
        self._terminator = terminator
        self._listener_probe = listener_probe
        self._listener_pids = listener_pids
        self._shutdown_timeout = shutdown_timeout
        self._max_log_bytes = max(1, max_log_bytes)
        self._hostbridge_python = os.environ.get("HOSTBRIDGE_PYTHON") or str(
            getattr(sys, "_base_executable", sys.executable)
        )
        self._lock = threading.RLock()
        self._process: Any | None = None
        self._drainer: _OutputDrainer | None = None
        self._state = self._load_state()

    def list_hosts(self) -> list[MockSshHostRead]:
        try:
            result = self._runner(
                [self._executable, "hosts", "list"],
                shell=False,
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
                env=self._hostbridge_env(),
            )
        except Exception as exc:
            raise RuntimeError("Unable to list HostBridge hosts") from exc
        if result.returncode != 0:
            raise RuntimeError("Unable to list HostBridge hosts")

        try:
            payload = json.loads(result.stdout)
        except (TypeError, json.JSONDecodeError) as exc:
            raise RuntimeError("Unable to list HostBridge hosts") from exc
        if not isinstance(payload, list):
            raise RuntimeError("Unable to list HostBridge hosts")

        hosts: list[MockSshHostRead] = []
        for item in payload:
            if not isinstance(item, dict):
                continue
            host_id = str(item.get("id", "")).strip()
            if not _SAFE_IDENTIFIER.fullmatch(host_id):
                continue
            name = str(item.get("label", host_id)).strip() or host_id
            inferred_type = next(
                (kind for kind in ("ssh", "script", "command") if kind in item),
                "unknown",
            )
            host_type = (
                str(item.get("connection_type", inferred_type)).strip() or "unknown"
            )
            hosts.append(MockSshHostRead(id=host_id, name=name, type=host_type))
        return hosts

    def status(self) -> MockSshStatusRead:
        with self._lock:
            self._reconcile_status()
            return self._status_from_state()

    def start(self, host_id: str, alias: str) -> MockSshStatusRead:
        with self._lock:
            if self._is_owned_live_process():
                if self._state.get("host_id") == host_id and self._state.get("alias") == alias:
                    self._state["state"] = "running"
                    return self._status_from_state().model_copy(
                        update={"reused": True}
                    )
                return MockSshStatusRead(
                    desired_running=True,
                    state="failed",
                    host_id=host_id,
                    alias=alias,
                    error="A different mock SSH tunnel is already running",
                )
            if self._process is not None and self._process.poll() is None:
                return MockSshStatusRead(
                    desired_running=True,
                    state="failed",
                    host_id=str(self._state.get("host_id", host_id)),
                    alias=str(self._state.get("alias", alias)),
                    port=self._state.get("port"),
                    error="Unable to verify ownership of the existing mock SSH tunnel",
                )

            argv = self._argv(host_id, alias)
            owner_token = secrets.token_urlsafe(24)
            command_identity = " ".join(argv)
            self._state = {
                "version": 1,
                "desired_running": True,
                "state": "starting",
                "host_id": host_id,
                "alias": alias,
                "port": None,
                "pid": None,
                "owner_token": owner_token,
                "command_identity": command_identity,
                "expected_argv": argv,
                "error": None,
            }
            self._persist_state()

            try:
                process = self._process_factory(
                    argv,
                    env=self._hostbridge_env(**{OWNER_TOKEN_ENV: owner_token}),
                )
                self._process = process
                self._state["pid"] = int(process.pid)
                self._persist_state()
                self._drainer = _OutputDrainer(process, self._append_log)
                self._drainer.start()
                port, observed_alias = self._wait_for_startup(process, self._drainer)
                if observed_alias != alias:
                    raise RuntimeError("HostBridge reported an unexpected SSH alias")
                listener_pid = self._find_owned_listener_pid(port)
                if listener_pid is not None and listener_pid != process.pid:
                    self._state["pid"] = listener_pid
                    self._process = None
                self._state.update(state="running", port=port, error=None)
                self._persist_state()
            except Exception as exc:
                if self._process is not None:
                    exited = self._terminate_retained_process(
                        self._process, verify=False
                    )
                    drained = self._join_drainer()
                    if exited and drained:
                        self._process = None
                self._state.update(state="failed", error=self._startup_error(exc))
                self._persist_state()
            return self._status_from_state()

    def stop(self) -> MockSshStatusRead:
        with self._lock:
            self._state["desired_running"] = False
            self._state["state"] = "stopping"
            self._state["error"] = None
            self._persist_state()

            pid = self._state.get("pid")
            if (
                pid is not None
                and self._process is not None
                and getattr(self._process, "pid", None) == pid
                and self._process.poll() is not None
            ):
                self._join_drainer(timeout=0.05)
                self._process = None
            if (
                pid is not None
                and self._process is None
                and self._probe_pid_exists(int(pid)) is False
            ):
                port = self._state.get("port")
                listener_pid = (
                    self._find_owned_listener_pid(int(port)) if port is not None else None
                )
                if listener_pid is not None:
                    pid = listener_pid
                    self._state["pid"] = listener_pid
                    self._persist_state()
                else:
                    self._clear_process_ownership()
                    pid = None
            if pid is not None:
                if not self._is_owned_live_process(require_identity=True):
                    self._state.update(
                        state="failed",
                        error="Refusing to stop a process whose ownership cannot be verified",
                    )
                    self._persist_state()
                    return self._status_from_state()
                if self._process is not None:
                    exited = self._terminate_retained_process(self._process)
                    exited = self._join_drainer() and exited
                else:
                    exited = self._terminate_restored_process(int(pid))
                if not exited:
                    self._state.update(state="failed", error="Unable to stop owned mock SSH process")
                    self._persist_state()
                    return self._status_from_state()

            self._clear_process_ownership()
            self._state.update(state="stopped", error=None)
            self._persist_state()
            return self._status_from_state()

    def restore(self) -> MockSshStatusRead:
        with self._lock:
            self._state = self._load_state()
            if not self._state.get("desired_running", False):
                self._state.update(
                    state="stopped",
                    port=None,
                    pid=None,
                    owner_token="",
                    command_identity="",
                    expected_argv=[],
                    error=None,
                )
                self._process = None
                self._persist_state()
                return self._status_from_state()
            if self._is_owned_live_process(require_identity=True):
                self._state.update(state="running", error=None)
                return self._status_from_state()
            host_id = str(self._state.get("host_id", ""))
            alias = str(self._state.get("alias", ""))
            pid = self._state.get("pid")
            if pid is not None:
                liveness = self._probe_pid_exists(int(pid))
                if liveness is not False:
                    self._state.update(
                        state="failed",
                        error=(
                            "Unable to verify the existing mock SSH process; "
                            "retry or stop it explicitly"
                        ),
                    )
                    self._persist_state()
                    return self._status_from_state()
                self._clear_process_ownership()
            return self.start(host_id, alias)

    def owns_running_alias(self, alias: str) -> bool:
        with self._lock:
            return (
                self._state.get("state") == "running"
                and self._state.get("alias") == alias
                and self._is_owned_live_process()
            )

    def _argv(self, host_id: str, alias: str) -> list[str]:
        return [
            self._executable,
            "mock-ssh",
            "start",
            host_id,
            "--ssh-host-alias",
            alias,
            "--connect-timeout",
            "120",
            "--command-timeout",
            "300",
        ]

    def _hostbridge_env(self, **updates: str) -> dict[str, str]:
        return {
            **os.environ,
            "HOSTBRIDGE_PYTHON": self._hostbridge_python,
            "HOSTBRIDGE_DAEMON_SOCKET": str(self._daemon_socket),
            **updates,
        }

    def _wait_for_startup(
        self, process: Any, drainer: _OutputDrainer
    ) -> tuple[int, str]:
        deadline = self._clock() + self._startup_timeout
        while self._clock() < deadline:
            if drainer.port is not None and drainer.alias is not None:
                return drainer.port, drainer.alias
            if drainer.error is not None:
                raise RuntimeError("Unable to persist sanitized HostBridge output")
            if process.poll() is not None:
                raise RuntimeError("HostBridge exited before startup completed")
            drainer.wait(min(0.01, max(0.001, deadline - self._clock())))

        if drainer.port is None and drainer.alias is not None:
            raise RuntimeError("HostBridge startup did not report a listening port")
        if drainer.alias is None and drainer.port is not None:
            raise RuntimeError("HostBridge startup did not report the SSH alias")
        raise TimeoutError("HostBridge startup timed out")

    def _append_log(self, chunk: bytes) -> None:
        if self._log_path.is_symlink():
            raise ValueError("Mock SSH log must not be a symlink")
        self._log_path.parent.mkdir(parents=True, exist_ok=True)
        existing = self._log_path.read_bytes() if self._log_path.exists() else b""
        retained = (existing + chunk)[-self._max_log_bytes :]
        flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
        flags |= getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(
            self._log_path,
            flags,
            0o600,
        )
        try:
            os.fchmod(descriptor, 0o600)
            os.write(descriptor, retained)
        finally:
            os.close(descriptor)

    def _is_owned_live_process(self, *, require_identity: bool = False) -> bool:
        pid = self._state.get("pid")
        if not pid or not self._state.get("owner_token") or not self._state.get("command_identity"):
            return False
        if self._process is not None and getattr(self._process, "pid", None) == pid:
            if self._process.poll() is not None:
                return False
        identity = self._pid_identity(int(pid))
        if not identity:
            return False
        expected_argv = self._state.get("expected_argv")
        if not expected_argv:
            try:
                expected_argv = shlex.split(self._state.get("command_identity", ""))
            except ValueError:
                return False
        return (
            _matches_expected_argv(identity.get("argv"), expected_argv)
            and identity.get("owner_token") == self._state.get("owner_token")
        )

    def _find_owned_listener_pid(self, port: int) -> int | None:
        expected_argv = self._state.get("expected_argv")
        owner_token = self._state.get("owner_token")
        if not expected_argv or not owner_token:
            return None
        try:
            candidates = self._listener_pids(port)
        except (OSError, ValueError, subprocess.SubprocessError):
            return None
        for pid in candidates:
            identity = self._pid_identity(pid)
            if (
                identity
                and _matches_expected_argv(identity.get("argv"), expected_argv)
                and identity.get("owner_token") == owner_token
            ):
                return pid
        return None

    def _terminate_retained_process(
        self, process: Any, *, verify: bool = True
    ) -> bool:
        if verify and not self._is_owned_live_process(require_identity=True):
            return False
        try:
            if process.poll() is None:
                process.terminate()
            process.wait(timeout=self._shutdown_timeout)
            return process.poll() is not None
        except subprocess.TimeoutExpired:
            pass
        except (OSError, ValueError):
            return False
        try:
            process.kill()
            process.wait(timeout=self._shutdown_timeout)
            return process.poll() is not None
        except (OSError, ValueError, subprocess.TimeoutExpired):
            return False

    def _terminate_restored_process(self, pid: int) -> bool:
        try:
            self._terminator(pid, False)
        except (OSError, ValueError):
            return self._probe_pid_exists(pid) is False
        if self._wait_for_pid_exit(pid):
            return True
        if not self._is_owned_live_process(require_identity=True):
            return False
        try:
            self._terminator(pid, True)
        except (OSError, ValueError):
            return self._probe_pid_exists(pid) is False
        return self._wait_for_pid_exit(pid)

    def _wait_for_pid_exit(self, pid: int) -> bool:
        deadline = self._clock() + self._shutdown_timeout
        while self._clock() < deadline:
            if self._probe_pid_exists(pid) is False:
                return True
            self._sleep(min(0.01, max(0, deadline - self._clock())))
        return self._probe_pid_exists(pid) is False

    def _join_drainer(self, timeout: float | None = None) -> bool:
        if self._drainer is None:
            return True
        drainer = self._drainer
        joined = drainer.join(
            self._shutdown_timeout if timeout is None else timeout
        )
        if joined:
            self._drainer = None
        return joined

    def _probe_pid_exists(self, pid: int) -> bool | None:
        try:
            result = self._pid_exists(pid)
        except (OSError, ValueError):
            return None
        return result if result in (True, False, None) else None

    def _clear_process_ownership(self) -> None:
        self._process = None
        self._state.update(
            port=None,
            pid=None,
            owner_token="",
            command_identity="",
            expected_argv=[],
        )

    def _reconcile_status(self) -> None:
        if not self._state.get("desired_running") or self._state.get("state") not in {
            "running",
            "starting",
        }:
            return
        if self._process is not None:
            if self._process.poll() is None:
                if self._listener_is_reachable():
                    return
                self._terminate_retained_process(self._process)
                self._join_drainer(timeout=0.05)
                self._clear_process_ownership()
                self._state.update(
                    state="failed",
                    error="Mock SSH listener is no longer reachable",
                )
                self._persist_state()
                return
            try:
                self._process.wait(timeout=0)
            except (OSError, ValueError, subprocess.TimeoutExpired):
                pass
            self._join_drainer(timeout=0.05)
            self._clear_process_ownership()
            self._state.update(
                state="failed",
                error="Mock SSH process exited unexpectedly",
            )
            self._persist_state()
            return
        pid = self._state.get("pid")
        if pid is not None and self._is_owned_live_process(require_identity=True):
            if self._listener_is_reachable():
                return
            self._terminate_restored_process(int(pid))
            self._clear_process_ownership()
            self._state.update(
                state="failed",
                error="Mock SSH listener is no longer reachable",
            )
            self._persist_state()
            return
        if pid is None or self._probe_pid_exists(int(pid)) is not False:
            return
        self._clear_process_ownership()
        self._state.update(
            state="failed",
            error="Mock SSH process exited unexpectedly",
        )
        self._persist_state()

    def _listener_is_reachable(self) -> bool:
        port = self._state.get("port")
        if not isinstance(port, int):
            return False
        try:
            return bool(self._listener_probe(port))
        except (OSError, ValueError):
            return False

    def _load_state(self) -> dict[str, Any]:
        self._reject_state_symlink()
        if not self._state_path.exists():
            return self._stopped_state()
        try:
            payload = json.loads(self._state_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError("Invalid mock SSH lifecycle state") from exc
        if not isinstance(payload, dict):
            raise ValueError("Invalid mock SSH lifecycle state")
        loaded = {**self._stopped_state(), **payload}
        if stat.S_IMODE(self._state_path.stat().st_mode) != 0o600:
            try:
                self._write_state_payload(loaded)
            except OSError as exc:
                raise ValueError("Unable to repair mock SSH state permissions") from exc
        return loaded

    @staticmethod
    def _stopped_state() -> dict[str, Any]:
        return {
            "version": 1,
            "desired_running": False,
            "state": "stopped",
            "host_id": "",
            "alias": "",
            "port": None,
            "pid": None,
            "owner_token": "",
            "command_identity": "",
            "expected_argv": [],
            "error": None,
        }

    def _persist_state(self) -> None:
        self._write_state_payload(self._state)

    def _write_state_payload(self, state: dict[str, Any]) -> None:
        self._reject_state_symlink()
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(state, ensure_ascii=True, indent=2).encode() + b"\n"
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                dir=self._state_path.parent,
                prefix=f"{self._state_path.name}.",
                suffix=".tmp",
                delete=False,
            ) as temporary:
                temporary_path = Path(temporary.name)
                os.fchmod(temporary.fileno(), 0o600)
                temporary.write(payload)
                temporary.flush()
                os.fsync(temporary.fileno())
            os.replace(temporary_path, self._state_path)
            temporary_path = None
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)

    def _reject_state_symlink(self) -> None:
        if self._state_path.is_symlink():
            raise ValueError(f"Mock SSH lifecycle state must not be a symlink: {self._state_path}")

    def _status_from_state(self) -> MockSshStatusRead:
        return MockSshStatusRead(
            desired_running=bool(self._state.get("desired_running")),
            state=self._state.get("state", "failed"),
            host_id=str(self._state.get("host_id", "")),
            alias=str(self._state.get("alias", "")),
            port=self._state.get("port"),
            error=self._state.get("error"),
        )

    @staticmethod
    def _startup_error(exc: Exception) -> str:
        if isinstance(exc, TimeoutError):
            return "HostBridge startup timed out"
        message = str(exc)
        allowed = (
            "HostBridge exited before startup completed",
            "HostBridge startup did not report the SSH alias",
            "HostBridge startup did not report a listening port",
            "HostBridge reported an unexpected SSH alias",
        )
        return message if message in allowed else "Unable to start HostBridge mock SSH"


class UnavailableMockSshManager:
    """Safe route-facing fallback when lifecycle initialization cannot complete."""

    def __init__(self, error: str = "Mock SSH is unavailable"):
        self._error = error

    def list_hosts(self) -> list[MockSshHostRead]:
        raise RuntimeError("Unable to list HostBridge hosts")

    def status(self) -> MockSshStatusRead:
        return MockSshStatusRead(
            desired_running=False,
            state="failed",
            error=self._error,
        )

    def start(self, host_id: str, alias: str) -> MockSshStatusRead:
        return MockSshStatusRead(
            desired_running=True,
            state="failed",
            host_id=host_id,
            alias=alias,
            error=self._error,
        )

    def stop(self) -> MockSshStatusRead:
        return self.status()

    def restore(self) -> MockSshStatusRead:
        return self.status()
