from pathlib import Path

from alembic import command
from alembic.config import Config
import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from comic_studio.db import run_migrations


def _database_url(path: Path) -> str:
    return f"sqlite:///{path}"


def _alembic_config(database_url: str) -> Config:
    api_root = Path(__file__).resolve().parents[1]
    config = Config(str(api_root / "alembic.ini"))
    config.set_main_option("script_location", str(api_root / "alembic"))
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    return config


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
            CREATE TABLE characters (
                id VARCHAR(36) PRIMARY KEY,
                project_id VARCHAR(36) NOT NULL,
                name VARCHAR(120) NOT NULL,
                role VARCHAR(80) NOT NULL,
                appearance_bible TEXT NOT NULL,
                personality TEXT NOT NULL,
                continuity_rules TEXT NOT NULL,
                negative_constraints TEXT NOT NULL,
                voice_speaker VARCHAR(80) NOT NULL,
                voice_instruction TEXT NOT NULL,
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
        connection.exec_driver_sql(
            """
            CREATE TABLE production_items (
                id VARCHAR(36) PRIMARY KEY,
                run_id VARCHAR(36) NOT NULL,
                stage VARCHAR(24) NOT NULL,
                target_type VARCHAR(24) NOT NULL,
                target_id VARCHAR(36) NOT NULL,
                position INTEGER NOT NULL,
                status VARCHAR(24) NOT NULL,
                attempt_count INTEGER NOT NULL,
                result_metadata JSON NOT NULL,
                error TEXT NOT NULL,
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
    for table in ("volumes", "storylines", "storyline_events"):
        assert table in inspector.get_table_names()
    for table in ("asset_variants", "asset_variant_states", "asset_variant_usages"):
        assert table in inspector.get_table_names()
    for table in ("visual_review_threads", "visual_annotations", "visual_review_messages", "visual_review_candidates"):
        assert table in inspector.get_table_names()
    for table in ("review_threads", "review_messages", "release_candidates", "publication_records"):
        assert table in inspector.get_table_names()
    for table in ("production_canvas_layouts", "production_workflow_bindings"):
        assert table in inspector.get_table_names()
    assert "volume_id" in {column["name"] for column in inspector.get_columns("episodes")}
    assert "position" in {column["name"] for column in inspector.get_columns("episodes")}
    assert "script_revision_id" in {
        column["name"] for column in inspector.get_columns("script_imports")
    }
    assert "video_prompt" in {column["name"] for column in inspector.get_columns("shots")}
    assert "regenerate_videos" in {
        column["name"] for column in inspector.get_columns("production_runs")
    }
    assert "guidance_asset_ids" in {
        column["name"] for column in inspector.get_columns("shot_cameras")
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
    for table in ("volumes", "storylines", "storyline_events"):
        assert table in inspector.get_table_names()
    for table in ("asset_variants", "asset_variant_states", "asset_variant_usages"):
        assert table in inspector.get_table_names()
    for table in ("visual_review_threads", "visual_annotations", "visual_review_messages", "visual_review_candidates"):
        assert table in inspector.get_table_names()
    for table in ("review_threads", "review_messages", "release_candidates", "publication_records"):
        assert table in inspector.get_table_names()
    for table in ("production_canvas_layouts", "production_workflow_bindings"):
        assert table in inspector.get_table_names()
    assert "active_video_asset_id" in {
        column["name"] for column in inspector.get_columns("shots")
    }


def test_single_script_migration_merges_duplicate_documents_and_adds_constraint(tmp_path):
    database_path = tmp_path / "duplicate-scripts.db"
    database_url = _database_url(database_path)
    config = _alembic_config(database_url)
    command.upgrade(config, "20260717_24")
    engine = create_engine(database_url)
    with engine.begin() as connection:
        connection.execute(text("""
            INSERT INTO projects (
                id, title, logline, story_bible, visual_style,
                aspect_ratio, language, created_at, updated_at
            ) VALUES (
                'project-1', 'Project', 'logline', 'bible', 'ink',
                '9:16', 'Chinese', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
        """))
        connection.execute(text("""
            INSERT INTO script_documents (
                id, project_id, title, source_type, status,
                current_revision_id, created_at, updated_at
            ) VALUES
                ('script-old', 'project-1', 'Old', 'upload', 'ready',
                 'revision-old', '2026-01-01', '2026-01-01'),
                ('script-current', 'project-1', 'Current', 'ai', 'draft',
                 'revision-current', '2026-02-01', '2026-02-01')
        """))
        connection.execute(text("""
            INSERT INTO script_revisions (
                id, document_id, revision_number, status, content, checksum,
                creation_method, original_filename, source_file_path,
                source_media_type, generation_brief, generation_metadata, created_at
            ) VALUES
                ('revision-old', 'script-old', 1, 'finalized', 'old', 'old-checksum',
                 'upload', 'old.txt', '', 'text/plain', '', '{}', '2026-01-01'),
                ('revision-current', 'script-current', 1, 'working', 'current', 'current-checksum',
                 'ai', '', '', '', 'brief', '{}', '2026-02-01')
        """))

    command.upgrade(config, "head")

    with engine.connect() as connection:
        documents = connection.execute(text(
            "SELECT id, current_revision_id FROM script_documents WHERE project_id='project-1'"
        )).all()
        revisions = connection.execute(text(
            "SELECT document_id, revision_number, content FROM script_revisions ORDER BY revision_number"
        )).all()
    assert documents == [("script-current", "revision-current")]
    assert revisions == [
        ("script-current", 1, "old"),
        ("script-current", 2, "current"),
    ]

    with pytest.raises(IntegrityError):
        with engine.begin() as connection:
            connection.execute(text("""
                INSERT INTO script_documents (
                    id, project_id, title, source_type, status,
                    current_revision_id, created_at, updated_at
                ) VALUES (
                    'script-duplicate', 'project-1', 'Duplicate', 'ai', 'draft',
                    NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
            """))
