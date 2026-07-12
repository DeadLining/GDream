from pathlib import Path

from sqlalchemy import create_engine, inspect, text

from comic_studio.db import run_migrations


def _database_url(path: Path) -> str:
    return f"sqlite:///{path}"


def _create_legacy_database(path: Path) -> None:
    engine = create_engine(_database_url(path))
    with engine.begin() as connection:
        connection.exec_driver_sql(
            """
            CREATE TABLE projects (
                id VARCHAR(36) PRIMARY KEY,
                title VARCHAR(200) NOT NULL,
                logline TEXT NOT NULL,
                story_bible TEXT NOT NULL,
                visual_style TEXT NOT NULL,
                aspect_ratio VARCHAR(8) NOT NULL,
                language VARCHAR(32) NOT NULL,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
            """
        )
        connection.exec_driver_sql(
            """
            CREATE TABLE shots (
                id VARCHAR(36) PRIMARY KEY,
                scene_id VARCHAR(36) NOT NULL,
                position INTEGER NOT NULL,
                shot_type VARCHAR(80) NOT NULL,
                duration_seconds FLOAT NOT NULL,
                composition TEXT NOT NULL,
                camera_motion VARCHAR(80) NOT NULL,
                character_state JSON NOT NULL,
                image_prompt TEXT NOT NULL,
                negative_prompt TEXT NOT NULL,
                active_panel_asset_id VARCHAR(36),
                review_status VARCHAR(32) NOT NULL,
                render_status VARCHAR(32) NOT NULL
            )
            """
        )
        connection.exec_driver_sql(
            """
            CREATE TABLE production_runs (
                id VARCHAR(36) PRIMARY KEY,
                episode_id VARCHAR(36) NOT NULL,
                status VARCHAR(32) NOT NULL,
                stages JSON NOT NULL,
                concurrency INTEGER NOT NULL,
                regenerate_panels BOOLEAN NOT NULL,
                regenerate_speech BOOLEAN NOT NULL,
                pause_requested BOOLEAN NOT NULL,
                total_items INTEGER NOT NULL,
                queued_items INTEGER NOT NULL,
                running_items INTEGER NOT NULL,
                succeeded_items INTEGER NOT NULL,
                failed_items INTEGER NOT NULL,
                skipped_items INTEGER NOT NULL,
                summary_error TEXT NOT NULL,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
            """
        )
        connection.execute(
            text(
                """
                INSERT INTO projects (
                    id, title, logline, story_bible, visual_style,
                    aspect_ratio, language, created_at, updated_at
                ) VALUES (
                    'project-1', 'Existing project', 'logline', 'bible', 'ink',
                    '9:16', 'Chinese', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                """
            )
        )


def test_fresh_database_upgrades_to_current_schema(tmp_path):
    database_path = tmp_path / "fresh.db"

    run_migrations(_database_url(database_path))

    inspector = inspect(create_engine(_database_url(database_path)))
    assert "script_imports" in inspector.get_table_names()
    assert "character_references" in inspector.get_table_names()
    assert "script_documents" in inspector.get_table_names()
    assert "script_revisions" in inspector.get_table_names()
    assert "script_import_episodes" in inspector.get_table_names()
    assert "model_invocations" in inspector.get_table_names()
    for table in ("director_stages", "director_objects", "shot_cameras", "director_revisions", "director_suggestions"):
        assert table in inspector.get_table_names()
    assert "script_revision_id" in {
        column["name"] for column in inspector.get_columns("script_imports")
    }
    assert "video_prompt" in {column["name"] for column in inspector.get_columns("shots")}
    assert "regenerate_videos" in {
        column["name"] for column in inspector.get_columns("production_runs")
    }


def test_legacy_database_is_stamped_and_upgraded_without_data_loss(tmp_path):
    database_path = tmp_path / "legacy.db"
    _create_legacy_database(database_path)

    run_migrations(_database_url(database_path))

    engine = create_engine(_database_url(database_path))
    inspector = inspect(engine)
    with engine.connect() as connection:
        assert connection.scalar(
            text("SELECT title FROM projects WHERE id = 'project-1'")
        ) == "Existing project"
        assert connection.scalar(text("SELECT version_num FROM alembic_version"))
    assert "script_imports" in inspector.get_table_names()
    assert "character_references" in inspector.get_table_names()
    assert "script_documents" in inspector.get_table_names()
    assert "script_revisions" in inspector.get_table_names()
    assert "script_import_episodes" in inspector.get_table_names()
    assert "model_invocations" in inspector.get_table_names()
    for table in ("director_stages", "director_objects", "shot_cameras", "director_revisions", "director_suggestions"):
        assert table in inspector.get_table_names()
    assert "active_video_asset_id" in {
        column["name"] for column in inspector.get_columns("shots")
    }
