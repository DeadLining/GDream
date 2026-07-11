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
