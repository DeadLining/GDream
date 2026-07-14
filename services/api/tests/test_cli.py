"""M4.3 — Headless CLI tests."""

from __future__ import annotations

import argparse
import asyncio
import types

from comic_studio import models
from comic_studio.cli import _parse_stages, cmd_episodes, cmd_health, cmd_migrate, cmd_produce
from comic_studio.production import ProductionStore
from comic_studio.services.production_coordinator import ProductionCoordinator


def _seed_episode(app):
    """Create a project + episode + one scene + one shot via the app session."""
    with app.state.session_factory() as session:
        project = models.Project(
            title="CLI project",
            logline="logline",
            story_bible="bible",
            visual_style="ink",
        )
        episode = models.Episode(
            project=project,
            title="CLI episode",
            premise="premise",
            target_duration_seconds=60,
        )
        scene = models.Scene(
            episode=episode,
            position=0,
            location="studio",
            summary="summary",
        )
        shot = models.Shot(
            scene=scene,
            position=0,
            shot_type="medium",
            duration_seconds=2.0,
            composition="composition",
        )
        session.add(shot)
        session.commit()
        session.refresh(project)
        session.refresh(episode)
        return project.id, episode.id


def _install_noop_coordinator(app):
    async def _noop(item):
        return {"target": item.target_id}

    app.state.production_coordinator = ProductionCoordinator(
        app.state.session_factory,
        {"panel": _noop, "speech": _noop, "video": _noop},
    )


def test_parse_stages_splits_and_validates():
    assert _parse_stages("panels, speech") == ["panels", "speech"]
    try:
        _parse_stages("panels,bogus")
        raise AssertionError("expected SystemExit")
    except SystemExit:
        pass
    try:
        _parse_stages("")
        raise AssertionError("expected SystemExit")
    except SystemExit:
        pass


def test_cli_migrate_re_runs_idempotently(client):
    payload = cmd_migrate(client.app, argparse.Namespace())
    assert payload["status"] == "ok"
    assert "database_url" in payload


def test_cli_episodes_lists_project_episodes(client):
    project_id, episode_id = _seed_episode(client.app)
    payload = cmd_episodes(
        client.app, argparse.Namespace(project_id=project_id)
    )
    assert payload["project_id"] == project_id
    assert [e["id"] for e in payload["episodes"]] == [episode_id]
    assert payload["episodes"][0]["title"] == "CLI episode"


def test_cli_produce_runs_coordinator_with_noop_workers(client):
    project_id, episode_id = _seed_episode(client.app)
    _install_noop_coordinator(client.app)

    payload = cmd_produce(
        client.app,
        argparse.Namespace(
            episode_id=episode_id,
            stages="panels",
            concurrency=1,
            regenerate=True,
        ),
    )

    run = payload["run"]
    assert run["episode_id"] == episode_id
    assert run["status"] == "completed"
    assert run["succeeded_items"] >= 1


def test_cli_health_returns_model_runtime_health(client):
    async def fake_health():
        return {"capabilities": {}, "infrastructure": {}, "checked_at": "now"}

    client.app.state.model_runtime.health = fake_health
    payload = cmd_health(client.app, argparse.Namespace())
    assert payload["checked_at"] == "now"


def test_cli_produce_rejects_unknown_episode(client):
    try:
        cmd_produce(
            client.app,
            argparse.Namespace(
                episode_id="does-not-exist",
                stages="panels",
                concurrency=1,
                regenerate=False,
            ),
        )
        raise AssertionError("expected SystemExit")
    except SystemExit:
        pass
