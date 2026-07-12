import json
import os
import stat
import subprocess
from pathlib import Path

import pytest

from comic_studio.services.mock_ssh import MockSshManager


LAUNCHER = Path(__file__).parents[3] / "scripts/hostbridge-cs-bridge"


def _fake_runtime(tmp_path: Path) -> Path:
    root = tmp_path / "CS Bridge Runtime With Spaces"
    entrypoint = root / "server_control_mcp/server.py"
    entrypoint.parent.mkdir(parents=True)
    entrypoint.write_text("# fake entrypoint\n", encoding="ascii")
    return root


def _fake_python(tmp_path: Path) -> tuple[Path, Path]:
    capture_path = tmp_path / "python invocation.json"
    executable = tmp_path / "Python With Spaces/python3"
    executable.parent.mkdir(parents=True)
    executable.write_text(
        f"""#!{os.sys.executable}
import json
import os
import subprocess
import sys

if sys.argv[1:] == ["-c", "import mcp"]:
    raise SystemExit(0)
if sys.argv[1:2] == ["-c"]:
    completed = subprocess.run([sys.executable, *sys.argv[1:]], check=False)
    raise SystemExit(completed.returncode)

capture_path = os.environ["CAPTURE_PATH"]
calls = []
if os.path.exists(capture_path):
    with open(capture_path, encoding="utf-8") as existing:
        calls = json.load(existing)
calls.append({{
    "argv": sys.argv[1:],
    "pythonpath": os.environ.get("PYTHONPATH"),
    "dont_write_bytecode": os.environ.get("PYTHONDONTWRITEBYTECODE"),
}})
with open(capture_path, "w", encoding="utf-8") as output:
    json.dump(calls, output)

if sys.argv[1:] == ["-m", "server_control_mcp.server", "list"]:
    sys.stdout.write(os.environ.get("LEGACY_STDOUT", ""))
    sys.stderr.write(os.environ.get("LEGACY_STDERR", ""))
    raise SystemExit(int(os.environ.get("LEGACY_EXIT_CODE", "0")))
""",
        encoding="utf-8",
    )
    executable.chmod(executable.stat().st_mode | stat.S_IXUSR)
    return executable, capture_path


def _run_launcher(
    tmp_path: Path,
    *args: str,
    runtime_root: Path | None = None,
    legacy_stdout: str = "",
    legacy_stderr: str = "",
    legacy_exit_code: int = 0,
) -> tuple[subprocess.CompletedProcess[str], Path]:
    python, capture_path = _fake_python(tmp_path)
    env = {
        **os.environ,
        "CAPTURE_PATH": str(capture_path),
        "CS_BRIDGE_HOSTBRIDGE_ROOT": str(runtime_root or _fake_runtime(tmp_path)),
        "HOSTBRIDGE_PYTHON": str(python),
        "LEGACY_STDOUT": legacy_stdout,
        "LEGACY_STDERR": legacy_stderr,
        "LEGACY_EXIT_CODE": str(legacy_exit_code),
    }
    result = subprocess.run(
        [str(LAUNCHER), *args],
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )
    return result, capture_path


def _capture(path: Path) -> list[dict[str, object]]:
    return json.loads(path.read_text(encoding="utf-8"))


def test_hosts_list_normalizes_legacy_tsv_to_safe_json(tmp_path: Path):
    runtime_root = _fake_runtime(tmp_path)

    result, capture_path = _run_launcher(
        tmp_path,
        "hosts",
        "list",
        runtime_root=runtime_root,
        legacy_stdout=(
            "a800_94\tA800_94服务器\tssh\tssh blj\n"
            "local\tLocal command\tcommand\tsecret --token credential\n"
        ),
    )

    assert result.returncode == 0
    assert json.loads(result.stdout) == [
        {"id": "a800_94", "label": "A800_94服务器", "connection_type": "ssh"},
        {"id": "local", "label": "Local command", "connection_type": "command"},
    ]
    assert "ssh blj" not in result.stdout
    assert "credential" not in result.stdout
    assert _capture(capture_path) == [
        {
            "argv": ["-m", "server_control_mcp.server", "list"],
            "pythonpath": str(runtime_root),
            "dont_write_bytecode": "1",
        }
    ]


def test_hosts_list_uses_structured_json_for_quoted_tabs_newlines_and_unicode(
    tmp_path: Path,
):
    result, _ = _run_launcher(
        tmp_path,
        "hosts",
        "list",
        legacy_stdout='gpu-1\t"名称 ""甲""\t第二行\n继续"\tssh\t"ssh target"\n',
    )

    assert result.returncode == 0
    assert json.loads(result.stdout) == [
        {"id": "gpu-1", "label": '名称 "甲"\t第二行\n继续', "connection_type": "ssh"}
    ]


def test_hosts_list_rejects_malformed_tsv_without_partial_json(tmp_path: Path):
    result, _ = _run_launcher(
        tmp_path,
        "hosts",
        "list",
        legacy_stdout="good\tGood\tssh\nbad\tmissing-type\n",
    )

    assert result.returncode != 0
    assert result.stdout == ""
    assert "unable to normalize host list" in result.stderr.lower()
    assert "missing-type" not in result.stderr


def test_hosts_list_preserves_legacy_failure_and_stderr(tmp_path: Path):
    result, _ = _run_launcher(
        tmp_path,
        "hosts",
        "list",
        legacy_stderr="legacy list unavailable\n",
        legacy_exit_code=23,
    )

    assert result.returncode == 23
    assert result.stdout == ""
    assert result.stderr == "legacy list unavailable\n"


def test_manager_parses_launcher_normalized_host_list(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    runtime_root = _fake_runtime(tmp_path)
    python, _ = _fake_python(tmp_path)
    monkeypatch.setenv("CAPTURE_PATH", str(tmp_path / "manager invocation.json"))
    monkeypatch.setenv("CS_BRIDGE_HOSTBRIDGE_ROOT", str(runtime_root))
    monkeypatch.setenv("HOSTBRIDGE_PYTHON", str(python))
    monkeypatch.setenv(
        "LEGACY_STDOUT", "a800_94\tA800_94服务器\tssh\tssh blj\n"
    )
    manager = MockSshManager(
        state_path=tmp_path / "state.json",
        log_path=tmp_path / "mock-ssh.log",
        executable=str(LAUNCHER),
    )

    hosts = manager.list_hosts()

    assert [host.model_dump() for host in hosts] == [
        {"id": "a800_94", "name": "A800_94服务器", "type": "ssh"}
    ]


def test_mock_ssh_start_removes_only_start_and_preserves_arguments(tmp_path: Path):
    injected_path = tmp_path / "must-not-exist"
    hostile_argument = f"$(touch {injected_path})"

    result, capture_path = _run_launcher(
        tmp_path,
        "mock-ssh",
        "start",
        "gpu-1",
        "--ssh-host-alias",
        "alias with spaces",
        hostile_argument,
    )

    assert result.returncode == 0
    assert _capture(capture_path)[0]["argv"] == [
        "-m",
        "server_control_mcp.server",
        "mock-ssh",
        "gpu-1",
        "--ssh-host-alias",
        "alias with spaces",
        hostile_argument,
    ]
    assert not injected_path.exists()


@pytest.mark.parametrize(
    "args",
    [(), ("hosts",), ("hosts", "list", "extra"), ("daemon", "status")],
)
def test_unsupported_commands_fail_without_running_python(
    tmp_path: Path, args: tuple[str, ...]
):
    result, capture_path = _run_launcher(tmp_path, *args)

    assert result.returncode != 0
    assert "unsupported command" in result.stderr.lower()
    assert not capture_path.exists()


def test_missing_runtime_entrypoint_fails_without_running_python(tmp_path: Path):
    missing_root = tmp_path / "missing runtime"

    result, capture_path = _run_launcher(
        tmp_path, "hosts", "list", runtime_root=missing_root
    )

    assert result.returncode != 0
    assert "entrypoint not found" in result.stderr.lower()
    assert not capture_path.exists()


def test_configured_python_must_provide_hostbridge_dependencies(tmp_path: Path):
    runtime_root = _fake_runtime(tmp_path)
    python = tmp_path / "python-without-mcp"
    python.write_text(
        "#!/bin/sh\n"
        "if [ \"${1:-}\" = \"-c\" ]; then exit 1; fi\n"
        "printf 'gpu-1\\tGPU 1\\tssh\\n'\n",
        encoding="ascii",
    )
    python.chmod(python.stat().st_mode | stat.S_IXUSR)

    result = subprocess.run(
        [str(LAUNCHER), "hosts", "list"],
        capture_output=True,
        text=True,
        check=False,
        env={
            **os.environ,
            "CS_BRIDGE_HOSTBRIDGE_ROOT": str(runtime_root),
            "HOSTBRIDGE_PYTHON": str(python),
        },
    )

    assert result.returncode != 0
    assert "dependencies" in result.stderr.lower()
