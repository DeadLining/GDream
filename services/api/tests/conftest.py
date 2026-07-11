import pytest
from fastapi.testclient import TestClient

from comic_studio.config import get_settings
from comic_studio.db import create_session_factory, create_tables
from comic_studio.main import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv(
        "AI_COMIC_DATABASE_URL", f"sqlite:///{tmp_path / 'studio.db'}"
    )
    monkeypatch.setenv("AI_COMIC_DATA_ROOT", str(tmp_path / "data"))
    get_settings.cache_clear()
    with TestClient(create_app()) as test_client:
        yield test_client
    get_settings.cache_clear()


@pytest.fixture
def db_session(tmp_path):
    session_factory = create_session_factory(f"sqlite:///{tmp_path / 'jobs.db'}")
    create_tables(session_factory)
    with session_factory() as session:
        yield session
