from __future__ import annotations

from dataclasses import dataclass, field

import pytest
from fastapi.testclient import TestClient

import comic_studio.main as main_module
from comic_studio.config import Settings, get_settings
from comic_studio.db import create_session_factory, create_tables
from comic_studio.main import create_app
from comic_studio.schemas import MockSshHostRead, MockSshStatusRead


def stopped_status() -> MockSshStatusRead:
    return MockSshStatusRead(desired_running=False, state="stopped")


@dataclass
class FakeMockSshManager:
    hosts: list[MockSshHostRead] = field(
        default_factory=lambda: [
            MockSshHostRead(id="gpu-1", name="Render GPU", type="ssh")
        ]
    )
    current: MockSshStatusRead = field(default_factory=stopped_status)
    list_error: Exception | None = None
    status_error: Exception | None = None
    start_error: Exception | None = None
    start_result: MockSshStatusRead | None = None
    stop_error: Exception | None = None
    restore_error: Exception | None = None
    restore_calls: int = 0
    start_calls: list[tuple[str, str]] = field(default_factory=list)
    stop_calls: int = 0

    def list_hosts(self) -> list[MockSshHostRead]:
        if self.list_error:
            raise self.list_error
        return self.hosts

    def status(self) -> MockSshStatusRead:
        if self.status_error:
            raise self.status_error
        return self.current

    def start(self, host_id: str, alias: str) -> MockSshStatusRead:
        self.start_calls.append((host_id, alias))
        if self.start_error:
            raise self.start_error
        if self.start_result is not None:
            self.current = self.start_result
            return self.current
        if (
            self.current.state == "running"
            and self.current.host_id == host_id
            and self.current.alias == alias
        ):
            return self.current.model_copy(update={"reused": True})
        self.current = MockSshStatusRead(
            desired_running=True,
            state="running",
            host_id=host_id,
            alias=alias,
            port=2222,
        )
        return self.current

    def stop(self) -> MockSshStatusRead:
        self.stop_calls += 1
        if self.stop_error:
            raise self.stop_error
        self.current = stopped_status()
        return self.current

    def restore(self) -> MockSshStatusRead:
        self.restore_calls += 1
        if self.restore_error:
            raise self.restore_error
        return self.current


@pytest.fixture
def mock_ssh_client(tmp_path, monkeypatch):
    monkeypatch.setenv(
        "AI_COMIC_DATABASE_URL", f"sqlite:///{tmp_path / 'studio.db'}"
    )
    monkeypatch.setenv("AI_COMIC_DATA_ROOT", str(tmp_path / "data"))
    monkeypatch.setenv(
        "AI_COMIC_PROVIDER_CHANNELS_PATH",
        str(tmp_path / "provider-channels.json"),
    )
    get_settings.cache_clear()
    manager = FakeMockSshManager()
    with TestClient(create_app(mock_ssh_manager=manager)) as client:
        yield client, manager
    get_settings.cache_clear()


def test_mock_ssh_routes_list_hosts_status_start_and_stop(mock_ssh_client):
    client, manager = mock_ssh_client

    assert client.get("/api/mock-ssh/hosts").json() == [
        {"id": "gpu-1", "name": "Render GPU", "type": "ssh"}
    ]
    assert client.get("/api/mock-ssh/status").json() == stopped_status().model_dump()

    started = client.post(
        "/api/mock-ssh/start",
        json={"host_id": "gpu-1", "alias": "comic-tts"},
    )
    assert started.status_code == 200
    assert started.json() == {
        "desired_running": True,
        "state": "running",
        "host_id": "gpu-1",
        "alias": "comic-tts",
        "port": 2222,
        "error": None,
        "reused": False,
    }
    assert manager.start_calls == [("gpu-1", "comic-tts")]

    stopped = client.post("/api/mock-ssh/stop")
    assert stopped.status_code == 200
    assert stopped.json() == stopped_status().model_dump()
    assert manager.stop_calls == 1


def test_duplicate_start_returns_reused_running_status(mock_ssh_client):
    client, manager = mock_ssh_client
    manager.current = MockSshStatusRead(
        desired_running=True,
        state="running",
        host_id="gpu-1",
        alias="comic-tts",
        port=2222,
    )

    response = client.post(
        "/api/mock-ssh/start",
        json={"host_id": "gpu-1", "alias": "comic-tts"},
    )

    assert response.status_code == 200
    assert response.json()["reused"] is True
    assert manager.current.reused is False
    assert client.get("/api/mock-ssh/status").json()["reused"] is False
    assert manager.start_calls == [("gpu-1", "comic-tts")]


def test_get_status_exposes_reconciled_child_exit_without_starting(
    mock_ssh_client,
):
    client, manager = mock_ssh_client
    started = client.post(
        "/api/mock-ssh/start",
        json={"host_id": "gpu-1", "alias": "comic-tts"},
    )
    assert started.json()["state"] == "running"
    manager.current = manager.current.model_copy(update={
        "state": "failed",
        "error": "Mock SSH process exited unexpectedly",
    })

    response = client.get("/api/mock-ssh/status")

    assert response.status_code == 200
    assert response.json()["state"] == "failed"
    assert response.json()["desired_running"] is True
    assert manager.start_calls == [("gpu-1", "comic-tts")]


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"host_id": "gpu-1"},
        {"host_id": "contains space", "alias": "comic-tts"},
        {"host_id": "gpu-1", "alias": "bad;alias"},
        {"host_id": "gpu-1", "alias": "comic-tts", "token": "secret"},
    ],
)
def test_start_request_validation_rejects_invalid_payloads(
    mock_ssh_client, payload
):
    client, manager = mock_ssh_client

    response = client.post("/api/mock-ssh/start", json=payload)

    assert response.status_code == 422
    assert manager.start_calls == []
    assert "secret" not in response.text


@pytest.mark.parametrize(
    ("error", "status_code", "detail"),
    [
        (
            ValueError("host=prod token=supersecret"),
            422,
            "Invalid mock SSH configuration",
        ),
        (
            FileNotFoundError("/secret/path/hostbridge"),
            503,
            "HostBridge is not available",
        ),
        (
            RuntimeError("ssh user:password@example.test"),
            503,
            "Unable to list HostBridge hosts",
        ),
        (
            Exception("Authorization: Bearer supersecret"),
            500,
            "Unable to list mock SSH hosts",
        ),
    ],
)
def test_host_errors_are_actionable_and_sanitized(
    mock_ssh_client, error, status_code, detail
):
    client, manager = mock_ssh_client
    manager.list_error = error

    response = client.get("/api/mock-ssh/hosts")

    assert response.status_code == status_code
    assert response.json() == {"detail": detail}
    assert "supersecret" not in response.text
    assert "password" not in response.text


@pytest.mark.parametrize(
    ("method", "error", "status_code", "detail"),
    [
        ("start", ValueError("alias token=supersecret"), 422, "Invalid mock SSH configuration"),
        ("start", FileNotFoundError("/private/hostbridge"), 503, "HostBridge is not available"),
        ("start", RuntimeError("command output password=hunter2"), 500, "Unable to start mock SSH"),
        ("stop", RuntimeError("command output password=hunter2"), 500, "Unable to stop mock SSH"),
    ],
)
def test_lifecycle_errors_are_sanitized(
    mock_ssh_client, method, error, status_code, detail
):
    client, manager = mock_ssh_client
    setattr(manager, f"{method}_error", error)

    response = (
        client.post(
            "/api/mock-ssh/start",
            json={"host_id": "gpu-1", "alias": "comic-tts"},
        )
        if method == "start"
        else client.post("/api/mock-ssh/stop")
    )

    assert response.status_code == status_code
    assert response.json() == {"detail": detail}
    assert "hunter2" not in response.text
    assert "supersecret" not in response.text


def test_disabled_or_missing_host_is_returned_without_starting_real_process(
    mock_ssh_client,
):
    client, manager = mock_ssh_client
    manager.hosts = []
    manager.start_result = MockSshStatusRead(
        desired_running=True,
        state="failed",
        host_id="missing-host",
        alias="comic-tts",
        error="HostBridge host is missing or disabled",
    )

    assert client.get("/api/mock-ssh/hosts").json() == []
    response = client.post(
        "/api/mock-ssh/start",
        json={"host_id": "missing-host", "alias": "comic-tts"},
    )
    assert response.status_code == 200
    assert response.json() == manager.start_result.model_dump()
    assert client.get("/api/mock-ssh/status").json() == manager.current.model_dump()


def test_manager_factory_is_deferred_until_lifespan(tmp_path, monkeypatch):
    monkeypatch.setenv(
        "AI_COMIC_DATABASE_URL", f"sqlite:///{tmp_path / 'studio.db'}"
    )
    monkeypatch.setenv("AI_COMIC_DATA_ROOT", str(tmp_path / "data"))
    monkeypatch.setenv(
        "AI_COMIC_PROVIDER_CHANNELS_PATH", str(tmp_path / "channels.json")
    )
    get_settings.cache_clear()


def test_production_manager_factory_wires_daemon_socket(tmp_path, monkeypatch):
    captured = {}
    sentinel = object()

    def construct(**kwargs):
        captured.update(kwargs)
        return sentinel

    monkeypatch.setattr(main_module, "MockSshManager", construct)
    settings = Settings(
        _env_file=None,
        data_root=tmp_path / "data",
        hostbridge_daemon_socket=tmp_path / "hostbridge/daemon.sock",
    )

    assert main_module._create_mock_ssh_manager(settings) is sentinel
    assert captured["daemon_socket"] == settings.hostbridge_daemon_socket
    manager = FakeMockSshManager()
    received = []

    def factory(settings):
        received.append(settings)
        return manager

    app = create_app(mock_ssh_manager_factory=factory)

    assert app.state.mock_ssh_manager is not manager
    assert app.state.mock_ssh_manager.status().state == "failed"
    assert received == []

    with TestClient(app) as client:
        assert received == [app.state.settings]
        assert app.state.mock_ssh_manager is manager
        assert client.get("/api/mock-ssh/status").status_code == 200

    get_settings.cache_clear()


def test_lifespan_restores_exactly_once_and_keeps_bridge_running(tmp_path, monkeypatch):
    monkeypatch.setenv(
        "AI_COMIC_DATABASE_URL", f"sqlite:///{tmp_path / 'studio.db'}"
    )
    monkeypatch.setenv("AI_COMIC_DATA_ROOT", str(tmp_path / "data"))
    monkeypatch.setenv(
        "AI_COMIC_PROVIDER_CHANNELS_PATH", str(tmp_path / "channels.json")
    )
    get_settings.cache_clear()
    manager = FakeMockSshManager(
        current=MockSshStatusRead(
            desired_running=True,
            state="running",
            host_id="gpu-1",
            alias="comic-tts",
            port=2222,
        )
    )
    app = create_app(mock_ssh_manager=manager)

    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 200
        assert manager.restore_calls == 1

    assert manager.restore_calls == 1
    assert manager.stop_calls == 0
    assert manager.current.state == "running"
    get_settings.cache_clear()


def test_restore_failure_does_not_abort_api_and_failed_status_is_queryable(
    tmp_path, monkeypatch, caplog
):
    monkeypatch.setenv(
        "AI_COMIC_DATABASE_URL", f"sqlite:///{tmp_path / 'studio.db'}"
    )
    monkeypatch.setenv("AI_COMIC_DATA_ROOT", str(tmp_path / "data"))
    monkeypatch.setenv(
        "AI_COMIC_PROVIDER_CHANNELS_PATH", str(tmp_path / "channels.json")
    )
    get_settings.cache_clear()
    create_tables(create_session_factory(get_settings().database_url))
    monkeypatch.setattr(main_module, "run_migrations", lambda _database_url: None)
    monkeypatch.setattr(main_module.logger, "disabled", False)
    manager = FakeMockSshManager(
        restore_error=RuntimeError("token=supersecret command output"),
    )

    with caplog.at_level("WARNING", logger="comic_studio.main"):
        app = create_app(mock_ssh_manager=manager)
        with TestClient(app) as client:
            assert client.get("/api/health").json()["status"] == "ok"
            response = client.get("/api/mock-ssh/status")
            assert response.status_code == 200
            assert response.json()["state"] == "failed"
            assert response.json()["error"] == "Unable to restore mock SSH"
            assert app.state.mock_ssh_manager is not manager

    assert manager.restore_calls == 1
    assert "Mock SSH manager restore failed" in caplog.text
    assert "supersecret" not in caplog.text
    assert "supersecret" not in response.text
    get_settings.cache_clear()


def test_corrupt_real_state_does_not_abort_startup(tmp_path, monkeypatch, caplog):
    data_root = tmp_path / "data"
    data_root.mkdir()
    (data_root / "mock-ssh.json").write_text("{token=supersecret")
    monkeypatch.setenv(
        "AI_COMIC_DATABASE_URL", f"sqlite:///{tmp_path / 'studio.db'}"
    )
    monkeypatch.setenv("AI_COMIC_DATA_ROOT", str(data_root))
    monkeypatch.setenv(
        "AI_COMIC_PROVIDER_CHANNELS_PATH", str(tmp_path / "channels.json")
    )
    get_settings.cache_clear()
    create_tables(create_session_factory(get_settings().database_url))
    monkeypatch.setattr(main_module, "run_migrations", lambda _database_url: None)
    monkeypatch.setattr(main_module.logger, "disabled", False)

    with caplog.at_level("WARNING", logger="comic_studio.main"):
        app = create_app()
        assert "supersecret" not in caplog.text
        with TestClient(app) as client:
            assert client.get("/api/health").json()["status"] == "ok"
            response = client.get("/api/mock-ssh/status")

    assert response.status_code == 200
    assert response.json()["state"] == "failed"
    assert response.json()["error"] == "Mock SSH is unavailable"
    assert "Mock SSH manager initialization failed" in caplog.text
    assert "supersecret" not in caplog.text
    assert "supersecret" not in response.text
    get_settings.cache_clear()
