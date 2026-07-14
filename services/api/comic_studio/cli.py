"""M4.3 — Headless CLI for batch production and rendering.

The CLI reuses the same FastAPI app assembly (``create_app``) so that it talks
to the identical service stack as the HTTP API, but it never starts the web
server. It is intended for CI batches, cron jobs, and operators who want to
drive production without the UI.

Examples::

    # Apply migrations against the configured database.
    python -m comic_studio.cli migrate

    # List episodes for a project.
    python -m comic_studio.cli episodes --project-id <id>

    # Run panels + speech + videos for an episode (no final MP4 render).
    python -m comic_studio.cli produce --episode-id <id> --stages panels,speech,videos

    # Same as produce, then render the final MP4.
    python -m comic_studio.cli render --episode-id <id>

    # Print the current provider/infra health snapshot.
    python -m comic_studio.cli health
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from typing import Any, Sequence

from sqlalchemy import select

from comic_studio import models, schemas
from comic_studio.config import get_settings
from comic_studio.db import run_migrations
from comic_studio.jobs import JobStore
from comic_studio.main import create_app
from comic_studio.production import ProductionStore
from comic_studio.services.production_runs import ProductionRunService


def build_app(*, run_db_migrations: bool = True):
    """Assemble the headless app context without starting the HTTP server.

    Mock SSH is intentionally left unavailable: the CLI is meant for batch
    pipelines where spawning long-lived SSH daemons is undesirable. Any
    operation that needs it fails with a clear message instead of hanging.
    """
    from comic_studio.services.mock_ssh import UnavailableMockSshManager

    settings = get_settings()
    if run_db_migrations:
        run_migrations(settings.database_url)
    app = create_app(
        mock_ssh_manager=UnavailableMockSshManager("CLI does not start mock SSH")
    )
    # Mirror the lifespan startup recovery so a crashed run never blocks a new
    # batch and queued jobs from a previous process are cleaned up.
    app.state.model_runtime.recover_interrupted_jobs()
    app.state.recover_production_runs()
    app.state.recover_script_imports()
    app.state.recover_script_generations()
    return app


def _parse_stages(raw: str) -> list[str]:
    stages = [stage.strip() for stage in raw.split(",") if stage.strip()]
    if not stages:
        raise SystemExit("at least one stage is required (panels/speech/videos)")
    invalid = [stage for stage in stages if stage not in {"panels", "speech", "videos"}]
    if invalid:
        raise SystemExit(f"unknown stages: {', '.join(invalid)}")
    return stages


def cmd_migrate(app, args: argparse.Namespace) -> dict:
    # Migrations already ran in build_app(); re-running is idempotent and cheap.
    run_migrations(get_settings().database_url)
    return {"status": "ok", "database_url": get_settings().database_url}


def cmd_episodes(app, args: argparse.Namespace) -> dict:
    with app.state.session_factory() as session:
        statement = select(models.Episode).where(
            models.Episode.project_id == args.project_id
        ).order_by(models.Episode.position)
        episodes = [
            {
                "id": episode.id,
                "title": episode.title,
                "position": episode.position,
                "status": episode.status,
                "target_duration_seconds": episode.target_duration_seconds,
            }
            for episode in session.scalars(statement)
        ]
    return {"project_id": args.project_id, "episodes": episodes}


def cmd_health(app, args: argparse.Namespace) -> dict:
    return asyncio.run(app.state.model_runtime.health())


async def _produce_episode(
    app,
    episode_id: str,
    *,
    stages: list[str],
    concurrency: int,
    regenerate: bool,
) -> str:
    with app.state.session_factory() as session:
        if session.get(models.Episode, episode_id) is None:
            raise SystemExit(f"Episode not found: {episode_id}")
        data = schemas.ProductionRunCreate(
            stages=stages,
            concurrency=concurrency,
            regenerate_panels=regenerate,
            regenerate_speech=regenerate,
            regenerate_videos=regenerate,
        )
        try:
            run = ProductionRunService(session).create(episode_id, data)
        except RuntimeError as exc:
            raise SystemExit(f"Production run rejected: {exc}") from exc
        if run is None:
            raise SystemExit(f"Episode not found: {episode_id}")
        run_id = run.id
    await app.state.production_coordinator.run(run_id)
    return run_id


def cmd_produce(app, args: argparse.Namespace) -> dict:
    stages = _parse_stages(args.stages)
    regenerate = bool(args.regenerate)
    run_id = asyncio.run(
        _produce_episode(
            app,
            args.episode_id,
            stages=stages,
            concurrency=args.concurrency,
            regenerate=regenerate,
        )
    )
    with app.state.session_factory() as session:
        run = ProductionStore(session).get_run(run_id)
        payload = schemas.ProductionRunRead.model_validate(run).model_dump(mode="json")
    return {"run": payload}


def cmd_render(app, args: argparse.Namespace) -> dict:
    from comic_studio.routes.renders import run_render_job

    stages = _parse_stages(args.stages)
    regenerate = bool(args.regenerate)
    run_id = asyncio.run(
        _produce_episode(
            app,
            args.episode_id,
            stages=stages,
            concurrency=args.concurrency,
            regenerate=regenerate,
        )
    )
    with app.state.session_factory() as session:
        run = ProductionStore(session).get_run(run_id)
        run_payload = schemas.ProductionRunRead.model_validate(run).model_dump(mode="json")

    # Only render when the production run reached a terminal success state.
    if run.status not in {"completed", "completed_with_failures"}:
        raise SystemExit(
            f"Cannot render: production run {run.id} ended in status {run.status}"
        )

    with app.state.session_factory() as session:
        job = JobStore(session).create("render_episode", "episode", args.episode_id, {})
        job_id = job.id
    run_render_job(app, job_id, args.episode_id)

    with app.state.session_factory() as session:
        job = JobStore(session).get(job_id)
        job_payload = schemas.JobRead.model_validate(job).model_dump(mode="json")
    return {"run": run_payload, "render_job": job_payload}


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="comic-studio",
        description="Headless batch CLI for AI Comic Studio.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    migrate = sub.add_parser("migrate", help="Apply Alembic migrations to the configured database.")
    migrate.set_defaults(handler=cmd_migrate)

    episodes = sub.add_parser("episodes", help="List episodes for a project.")
    episodes.add_argument("--project-id", required=True)
    episodes.set_defaults(handler=cmd_episodes)

    health = sub.add_parser("health", help="Print provider and infrastructure health.")
    health.set_defaults(handler=cmd_health)

    produce = sub.add_parser("produce", help="Run production stages for an episode without final render.")
    produce.add_argument("--episode-id", required=True)
    produce.add_argument("--stages", default="panels,speech,videos")
    produce.add_argument("--concurrency", type=int, default=2, choices=[1, 2, 3, 4])
    produce.add_argument("--regenerate", action="store_true")
    produce.set_defaults(handler=cmd_produce)

    render = sub.add_parser("render", help="Run production stages then render the final MP4.")
    render.add_argument("--episode-id", required=True)
    render.add_argument("--stages", default="panels,speech,videos")
    render.add_argument("--concurrency", type=int, default=2, choices=[1, 2, 3, 4])
    render.add_argument("--regenerate", action="store_true")
    render.set_defaults(handler=cmd_render)

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    app = build_app()
    result: Any = args.handler(app, args)
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2, default=str)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised via `python -m comic_studio.cli`
    raise SystemExit(main())
